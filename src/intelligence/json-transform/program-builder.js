import { explainOp } from "./explain.js";
import { entries, getPath, parsePath, uniqueBy } from "./core.js";
import { COST_PRIOR_STEP } from "./costs.js";
import { inferArrayGroupBy, inferTargetCandidates } from "./candidates.js";
import { executeJsonTransform, runtimeWarnings } from "./runtime.js";
import { deepEqual, opSources } from "./shared.js";

const AMBIGUITY_TRIAGE = {
  weakCostGap: COST_PRIOR_STEP,
  closeCostGap: COST_PRIOR_STEP * 1.6,
};

function candidateWarnings(op, input) {
  return runtimeWarnings({ ops: [op] }, input);
}

function selectCandidate(candidates, newInput) {
  if (!candidates.length) return null;
  if (candidates[0].id === "template-conflict") return candidates[0];
  if (newInput === undefined) return candidates[0];
  const noWarning = candidates.find(item => item.id !== "template-conflict" && !candidateWarnings(item.op, newInput).length);
  return noWarning || candidates[0];
}

function candidateWarningTypes(candidate, newInput) {
  if (!candidate || newInput === undefined) return [];
  return candidateWarnings(candidate.op, newInput).map(warning => warning.type);
}

function isEquivalentNumericBinary(selected, alternative) {
  const left = selected?.op;
  const right = alternative?.op;
  if (left?.op !== "numericBinary" || right?.op !== "numericBinary") return false;
  if (left.target !== right.target || left.mode !== right.mode) return false;
  if (!["add", "multiply"].includes(left.mode)) return false;
  return [left.left, left.right].sort().join("\u0000") === [right.left, right.right].sort().join("\u0000");
}

function isDominatedConditionalLookup(selected, alternative) {
  return selected?.op?.op === "conditional"
    && alternative?.op?.op === "valueMap"
    && selected.op.source === alternative.op.source;
}

function templateAsConcat(op) {
  if (op?.op !== "template") return null;
  const parts = op.parts || [];
  const sourceParts = parts.filter(part => part.kind === "source");
  if (sourceParts.length < 2) return null;
  if (sourceParts.some(part => part.transform && part.transform !== "identity")) return null;
  if (parts[0]?.kind !== "source" || parts.at(-1)?.kind !== "source") return null;
  const separators = [];
  for (let index = 0; index < sourceParts.length - 1; index++) {
    const start = parts.findIndex(part => part === sourceParts[index]);
    const end = parts.findIndex(part => part === sourceParts[index + 1]);
    const between = parts.slice(start + 1, end);
    if (between.length > 1 || between.some(part => part.kind !== "literal")) return null;
    separators.push(between[0]?.value || "");
  }
  return {
    sources: sourceParts.map(part => part.path),
    separators,
    target: op.target,
  };
}

function isEquivalentConcatTemplate(first, second) {
  const concat = [first, second].find(item => item?.op?.op === "concat")?.op;
  const template = templateAsConcat([first, second].find(item => item?.op?.op === "template")?.op);
  if (!concat || !template) return false;
  return concat.target === template.target
    && (concat.sources || []).length === template.sources.length
    && (concat.sources || []).every((source, index) => source === template.sources[index])
    && (concat.separators || []).length === template.separators.length
    && (concat.separators || []).every((separator, index) => separator === template.separators[index]);
}

function isRedundantStringModeAmbiguity(first, second) {
  const ops = [first?.op, second?.op];
  if (!ops.every(op => op?.op === "stringCase")) return false;
  if (ops[0].source !== ops[1].source || ops[0].target !== ops[1].target) return false;
  const modes = ops.map(op => op.mode);
  const simple = modes.find(mode => !mode.includes("+"));
  const composed = modes.find(mode => mode.includes("+"));
  if (!simple || !composed) return false;
  return composed.split("+").includes(simple);
}

function ambiguityStrength(selected, alternative, newInput) {
  if (isEquivalentConcatTemplate(selected, alternative) || isRedundantStringModeAmbiguity(selected, alternative) || isEquivalentNumericBinary(selected, alternative)) return "equivalent";
  const selectedWarnings = candidateWarningTypes(selected, newInput);
  const alternativeWarnings = candidateWarningTypes(alternative, newInput);
  if (!selectedWarnings.length && alternativeWarnings.length) return "resolved-by-new-input";
  if (alternative.cost - selected.cost >= AMBIGUITY_TRIAGE.weakCostGap) return "weak";
  return "meaningful";
}

function ambiguityReason(strength) {
  if (strength === "resolved-by-new-input") return "The selected rule works on the current input while the alternative would trigger a guardrail.";
  if (strength === "weak") return "The alternative fits the examples, but the selected rule is simpler or more plausible.";
  if (strength === "equivalent") return "The alternatives behave the same for this transformation.";
  return "Both rules fit the examples and remain plausible for the current input.";
}

function isGroupByOutputShape(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length > 0
    && Object.values(value).every(Array.isArray);
}

function isDescendantPath(path, ancestor) {
  const parts = parsePath(path);
  const ancestorParts = parsePath(ancestor);
  return parts.length > ancestorParts.length
    && ancestorParts.every((part, index) => part === parts[index]);
}

function outputEntriesForExamples(examples) {
  const leaves = entries(examples[0].output, [], { includeArrayLeaves: true });
  const groupedContainers = entries(examples[0].output, [], { includeContainers: true, includeArrayLeaves: true })
    .filter(entry => isGroupByOutputShape(entry.value))
    .filter(entry => {
      const targetValues = examples.map(example => getPath(example.output, entry.path));
      return inferArrayGroupBy(examples, entry.path, targetValues).length > 0;
    });
  if (!groupedContainers.length) return leaves;
  return [
    ...leaves.filter(leaf => !groupedContainers.some(container => isDescendantPath(leaf.path, container.path))),
    ...groupedContainers,
  ];
}

export function buildProgram(examples, newInput = undefined, version = 3) {
  const outputEntries = outputEntriesForExamples(examples);
  const sourceEntries = entries(examples[0].input, [], { includeArrayLeaves: true });
  const targetCandidates = outputEntries.map(target => ({
    target,
    candidates: inferTargetCandidates(examples, target, sourceEntries),
  }));
  const selected = targetCandidates.map(row => selectCandidate(row.candidates, newInput)).filter(Boolean);
  const selectedByTarget = new Map(selected.map(item => [item.target, item]));
  const program = {
    version,
    ops: selected.map(item => item.op),
  };
  const predictions = examples.map(example => executeJsonTransform(program, example.input));
  const exact = predictions.every((prediction, index) => deepEqual(prediction, examples[index].output));
  const unexplained = targetCandidates.filter(row => !row.candidates.length).map(row => row.target.path);
  const ambiguityTriage = targetCandidates
    .map(row => {
      const selectedCandidate = selectedByTarget.get(row.target.path) || row.candidates[0];
      const alternative = row.candidates.find(candidate => (
        candidate !== selectedCandidate
        && !deepEqual(candidate.op, selectedCandidate?.op)
        && !isDominatedConditionalLookup(selectedCandidate, candidate)
      ));
      if (!selectedCandidate || !alternative || Math.abs(alternative.cost - selectedCandidate.cost) > AMBIGUITY_TRIAGE.closeCostGap) return null;
      const strength = ambiguityStrength(selectedCandidate, alternative, newInput);
      const selectedSources = opSources(selectedCandidate.op);
      const alternativeSources = opSources(alternative.op);
      const distinguishFields = uniqueBy([...selectedSources, ...alternativeSources], value => value);
      return {
        target: row.target.path,
        selected: selectedCandidate.title,
        alternative: alternative.title,
        selectedReading: explainOp(selectedCandidate.op),
        alternativeReading: explainOp(alternative.op),
        selectedSources,
        alternativeSources,
        distinguishFields,
        strength,
        reason: ambiguityReason(strength),
        selectedWarnings: candidateWarningTypes(selectedCandidate, newInput),
        alternativeWarnings: candidateWarningTypes(alternative, newInput),
        suggestion: distinguishFields.length >= 2
          ? `Add an example where ${distinguishFields.slice(0, 2).join(" and ")} have different values.`
          : "Add one more example that separates the competing interpretations.",
      };
    })
    .filter(Boolean);
  const ambiguous = ambiguityTriage.filter(item => item.strength === "meaningful");
  return { program, targetCandidates, predictions, exact, unexplained, ambiguous, ambiguityTriage };
}
