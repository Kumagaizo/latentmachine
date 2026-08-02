import { explainOp } from "./explain.js";
import { entries, getPath, omitPaths, parsePath, uniqueBy } from "./core.js";
import { COST_PRIOR_STEP } from "./costs.js";
import { inferArrayGroupBy, inferTargetCandidates } from "./candidates.js";
import { instrumentProgramMemorisation, memorisationForProgram, MEMORISATION_MINIMUM_ROWS, MEMORISATION_RATIO_THRESHOLD } from "./memorisation.js";
import { applyNumericFormula, NUMERIC_FORMULA_ROUNDING } from "./operations.js";
import { executeJsonTransform, runtimeWarnings } from "./runtime.js";
import { deepEqual, opSources, stableStringify } from "./shared.js";

const AMBIGUITY_TRIAGE = {
  weakCostGap: COST_PRIOR_STEP,
  closeCostGap: COST_PRIOR_STEP * 1.6,
};
export const INFERENCE_EXAMPLE_LIMIT = 200;

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

function isDominatedMemorisedLookup(selected, alternative, rowCount) {
  if (rowCount < MEMORISATION_MINIMUM_ROWS) return false;
  if (selected?.op?.op !== "valueMap" || alternative?.op?.op !== "valueMap") return false;
  const alternativeRatio = Object.keys(alternative.op.map || {}).length / rowCount;
  return alternativeRatio >= MEMORISATION_RATIO_THRESHOLD;
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

function mergedEntries(examples, select, options) {
  const byPath = new Map();
  for (const example of examples) {
    for (const entry of entries(select(example), [], options)) {
      if (!byPath.has(entry.path)) byPath.set(entry.path, entry);
    }
  }
  return [...byPath.values()];
}

function sampleInferenceExamples(examples, targetPath, limit = INFERENCE_EXAMPLE_LIMIT) {
  if (examples.length <= limit) return examples;
  const selectedIndices = new Set();
  const firstByTargetValue = new Map();
  for (const [index, example] of examples.entries()) {
    const key = stableStringify(getPath(example.output, targetPath));
    if (!firstByTargetValue.has(key)) firstByTargetValue.set(key, index);
  }
  if (firstByTargetValue.size <= Math.floor(limit / 2)) {
    for (const index of firstByTargetValue.values()) selectedIndices.add(index);
  }
  const available = examples.map((_, index) => index).filter(index => !selectedIndices.has(index));
  const remaining = limit - selectedIndices.size;
  for (let index = 0; index < remaining; index++) {
    const availableIndex = remaining === 1 ? 0 : Math.round(index * (available.length - 1) / (remaining - 1));
    selectedIndices.add(available[availableIndex]);
  }
  return [...selectedIndices].sort((left, right) => left - right).map(index => examples[index]);
}

function outputEntriesForExamples(examples) {
  const leaves = mergedEntries(examples, example => example.output, { includeArrayLeaves: true });
  const groupedContainers = mergedEntries(examples, example => example.output, { includeContainers: true, includeArrayLeaves: true })
    .filter(entry => isGroupByOutputShape(entry.value))
    .filter(entry => {
      const domainExamples = examples.filter(example => getPath(example.output, entry.path) !== undefined);
      const targetValues = domainExamples.map(example => getPath(example.output, entry.path));
      return inferArrayGroupBy(domainExamples, entry.path, targetValues).length > 0;
    });
  if (!groupedContainers.length) return leaves;
  return [
    ...leaves.filter(leaf => !groupedContainers.some(container => isDescendantPath(leaf.path, container.path))),
    ...groupedContainers,
  ];
}

function domainForTarget(examples, targetPath, sourceEntries) {
  const present = examples.filter(example => getPath(example.output, targetPath) !== undefined);
  if (present.length === examples.length) return null;
  const guardSources = sourceEntries
    .map(entry => entry.path)
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .filter(path => examples.every(example => (
      (getPath(example.output, targetPath) !== undefined)
      === (getPath(example.input, path) !== undefined)
    )));
  guardSources.sort((left, right) => (
    Number(right === targetPath) - Number(left === targetPath)
    || left.localeCompare(right)
  ));
  const coverage = Number((present.length / examples.length).toFixed(4));
  return {
    target: targetPath,
    optional: true,
    supportCount: present.length,
    totalRows: examples.length,
    coverage,
    guardSources,
    // Only treat a field as optional when its presence is explained by an
    // input field with the same domain. Otherwise a missing or invented
    // output field is schema drift, not evidence of optionality.
    assumeRequired: !guardSources.length,
  };
}

function candidateWithDomain(candidate, domain) {
  if (!domain || domain.assumeRequired) return candidate;
  const candidateSources = opSources(candidate.op);
  const source = candidateSources.find(path => domain.guardSources.includes(path))
    || domain.guardSources[0]
    || null;
  const unverifiable = domain.supportCount < MEMORISATION_MINIMUM_ROWS || !source;
  return {
    ...candidate,
    op: {
      ...candidate.op,
      domain: {
        optional: true,
        source,
        supportCount: domain.supportCount,
        totalRows: domain.totalRows,
        coverage: domain.coverage,
        unverifiable,
        reason: domain.supportCount < MEMORISATION_MINIMUM_ROWS ? "insufficient-support" : !source ? "unproven-domain" : null,
      },
    },
  };
}

function candidateWithInference(candidate, inferenceExamples, supportedExamples) {
  if (inferenceExamples.length === supportedExamples.length || !["valueMap", "valueMapConflict"].includes(candidate.op.op)) return candidate;
  return {
    ...candidate,
    op: {
      ...candidate.op,
      inference: {
        sampled: true,
        rowCount: inferenceExamples.length,
        supportCount: supportedExamples.length,
        limit: INFERENCE_EXAMPLE_LIMIT,
      },
    },
  };
}

function resolveNumericFormulaCandidate(candidate, examples) {
  if (candidate?.op?.op !== "numericFormula") return candidate;
  const current = candidate.op;
  const variants = [];
  for (const evaluationOrder of [current.evaluationOrder, "integer-rate", "base-first"].filter((value, index, values) => value && values.indexOf(value) === index)) {
    for (const rounding of [current.rounding, ...NUMERIC_FORMULA_ROUNDING].filter((value, index, values) => value && values.indexOf(value) === index)) {
      const op = { ...current, evaluationOrder, rounding };
      const matchCount = examples.filter(example => (
        applyNumericFormula(getPath(example.input, op.base), getPath(example.input, op.rate), op)
        === getPath(example.output, op.target)
      )).length;
      variants.push({ op, matchCount });
    }
  }
  const bestMatchCount = Math.max(...variants.map(item => item.matchCount));
  const best = variants.filter(item => item.matchCount === bestMatchCount);
  const selected = best[0];
  const roundingValues = new Set(best.map(item => item.op.rounding));
  const evaluationValues = new Set(best.map(item => item.op.evaluationOrder));
  return {
    ...candidate,
    op: {
      ...selected.op,
      roundingEvidence: roundingValues.size === 1 ? "determined" : "underdetermined",
      evaluationEvidence: evaluationValues.size === 1 ? "determined" : "underdetermined",
    },
  };
}

function comparableTargets(program) {
  return memorisationForProgram(program).unverifiableTargets || [];
}

export function buildProgram(examples, newInput = undefined, version = 3) {
  const outputEntries = outputEntriesForExamples(examples);
  const sourceEntries = mergedEntries(examples, example => example.input, { includeArrayLeaves: true });
  const targetCandidates = outputEntries.map(target => {
    const domain = domainForTarget(examples, target.path, sourceEntries);
    const domainExamples = domain
      ? examples.filter(example => getPath(example.output, target.path) !== undefined)
      : examples;
    const inferenceExamples = sampleInferenceExamples(domainExamples, target.path);
    const domainSources = mergedEntries(domainExamples, example => example.input, { includeArrayLeaves: true });
    const candidates = inferTargetCandidates(inferenceExamples, target, domainSources)
      .map(candidate => candidateWithDomain(candidate, domain))
      .map(candidate => candidateWithInference(candidate, inferenceExamples, domainExamples));
    const fieldDomain = domain && !domain.assumeRequired ? {
      target: target.path,
      supportCount: domain.supportCount,
      totalRows: domain.totalRows,
      coverage: domain.coverage,
      source: candidates[0]?.op?.domain?.source || domain.guardSources[0] || null,
      unverifiable: domain.supportCount < MEMORISATION_MINIMUM_ROWS || !candidates.length || !domain.guardSources.length,
      reason: domain.supportCount < MEMORISATION_MINIMUM_ROWS
        ? "insufficient-support"
        : !candidates.length ? "no-rule" : !domain.guardSources.length ? "unproven-domain" : null,
    } : null;
    return { target, domainExamples, inferenceExamples, fieldDomain, candidates };
  });
  const selected = targetCandidates
    .map(row => resolveNumericFormulaCandidate(selectCandidate(row.candidates, newInput), row.domainExamples))
    .filter(Boolean);
  const selectedByTarget = new Map(selected.map(item => [item.target, item]));
  const fieldDomains = targetCandidates.map(row => row.fieldDomain).filter(Boolean);
  const program = instrumentProgramMemorisation({
    version,
    ...(fieldDomains.length ? { fieldDomains } : {}),
    ops: selected.map(item => item.op),
  }, examples);
  const predictions = examples.map(example => executeJsonTransform(program, example.input));
  const ignoredTargets = comparableTargets(program);
  const matches = predictions.map((prediction, index) => deepEqual(
    omitPaths(prediction, ignoredTargets),
    omitPaths(examples[index].output, ignoredTargets),
  ));
  const exact = matches.every(Boolean);
  const unexplained = targetCandidates
    .filter(row => !row.candidates.length && !row.fieldDomain?.unverifiable)
    .map(row => row.target.path);
  const ambiguityTriage = targetCandidates
    .map(row => {
      const selectedCandidate = selectedByTarget.get(row.target.path) || row.candidates[0];
      const alternative = row.candidates.find(candidate => (
        candidate !== selectedCandidate
        && !deepEqual(candidate.op, selectedCandidate?.op)
        && !isDominatedConditionalLookup(selectedCandidate, candidate)
        && !isDominatedMemorisedLookup(selectedCandidate, candidate, row.inferenceExamples.length)
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
  return { program, targetCandidates, predictions, matches, exact, unexplained, ambiguous, ambiguityTriage };
}
