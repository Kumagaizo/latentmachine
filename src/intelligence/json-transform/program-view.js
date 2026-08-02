import { explainAssumptions, explainProgram } from "./explain.js";
import { clone, getPath, typeOf, uniqueBy } from "./core.js";
import { executeJsonTransform } from "./runtime.js";
import { deepEqual, opSources } from "./shared.js";

export function programTitle(ops) {
  if (!ops.length) return "No transformation";
  if (ops.length === 1) {
    const op = ops[0];
    if (op.op === "concat") return `Merge ${op.sources.map(source => source.replace(/^\$\.?/, "")).join(" and ")} into ${op.target.replace(/^\$\.?/, "")}`;
    if (op.op === "template") return `Build ${op.target.replace(/^\$\.?/, "")} from a string template`;
    if (op.op === "templateConflict") return `Examples conflict for ${op.target.replace(/^\$\.?/, "")}`;
    if (op.op === "valueMapConflict") return `Examples conflict for ${op.target.replace(/^\$\.?/, "")}`;
    if (op.op === "stringCase") return `Change text case for ${op.target.replace(/^\$\.?/, "")}`;
    if (op.op === "numericTransform" || op.op === "numericBinary" || op.op === "quantityTransform") return `Compute ${op.target.replace(/^\$\.?/, "")}`;
    if (op.op === "dateFormat") return `Format ${op.target.replace(/^\$\.?/, "")} as a date`;
    if (op.op === "extractBetween") return `Extract ${op.target.replace(/^\$\.?/, "")} from text`;
    if (op.op === "regexExtract") return `Extract patterned text into ${op.target.replace(/^\$\.?/, "")}`;
    if (op.op === "booleanNot") return `Invert ${op.target.replace(/^\$\.?/, "")}`;
    if (op.op === "fallback") return `Resolve ${op.target.replace(/^\$\.?/, "")} from available fields`;
    if (op.op === "conditional") return `Choose ${op.target.replace(/^\$\.?/, "")} from ${op.source.replace(/^\$\.?/, "")}`;
    if (op.op === "arrayMap" && op.where) return `Filter ${op.source.replace(/^\$\.?/, "")} into ${op.target.replace(/^\$\.?/, "")}`;
    if (op.op === "arrayProject") return `Reshape ${op.source.replace(/^\$\.?/, "")} into ${op.target.replace(/^\$\.?/, "")}`;
    if (op.op === "arrayCount") return `Count ${op.source.replace(/^\$\.?/, "")}`;
    if (op.op === "arrayJoin") return `Join ${op.source.replace(/^\$\.?/, "")}`;
    if (op.op === "arrayFind") return `Find in ${op.source.replace(/^\$\.?/, "")}`;
    if (op.op === "arrayGroupBy") return `Group ${op.source.replace(/^\$\.?/, "")} into ${op.target.replace(/^\$\.?/, "")}`;
    if (op.op === "stringSplit") return `Split ${op.source.replace(/^\$\.?/, "")} into ${op.target.replace(/^\$\.?/, "")}`;
    if (op.op === "splitPart") return `Split ${op.source.replace(/^\$\.?/, "")}`;
    if (op.op === "coerce") return `Convert ${op.source.replace(/^\$\.?/, "")}`;
    return `Map ${op.source || op.op} to ${op.target.replace(/^\$\.?/, "")}`;
  }
  const kinds = [...new Set(ops.map(op => op.op))];
  if (kinds.every(kind => kind === "set")) return "Restructure fields";
  return `Compose ${ops.length} deterministic steps`;
}

export function summarizeProgram(ops) {
  if (!ops.length) return "";
  return `${ops.length} deterministic step${ops.length === 1 ? "" : "s"}`;
}

export function preconditionsForProgram(program, examples) {
  const preconditions = (program.ops || []).flatMap(op => (
    [...new Set([...opSources(op), op.domain?.source].filter(Boolean))]
  ).map(source => {
    const supportingInput = examples.find(example => getPath(example.input, source) !== undefined)?.input || {};
    const value = getPath(supportingInput, source);
    return {
      field: source,
      type: typeOf(value),
      required: op.op !== "fallback" && !op.domain?.optional,
      usedBy: op.target,
    };
  }));
  return uniqueBy(preconditions, item => `${item.field}:${item.usedBy}`);
}

export function evidenceForProgram(program, examples, version) {
  return (program.ops || []).map((op, opIndex) => {
    const single = { version, ops: [op] };
    const sourcePaths = opSources(op);
    const exampleEvidence = examples.map(example => {
      const predicted = executeJsonTransform(single, example.input);
      const got = getPath(predicted, op.target);
      const expected = getPath(example.output, op.target);
      return {
        exampleId: example.id,
        passed: deepEqual(got, expected),
        sources: sourcePaths.reduce((acc, source) => ({ ...acc, [source]: clone(getPath(example.input, source)) }), {}),
        expected: clone(expected),
        predicted: clone(got),
      };
    });
    return {
      opIndex,
      target: op.target,
      op: op.op,
      examplesMatched: exampleEvidence.filter(row => row.passed).map(row => row.exampleId),
      examples: exampleEvidence,
    };
  });
}

function roleForOp(op) {
  if (op.op === "set") return "mapped";
  if (op.op === "constant") return "constant";
  if (op.op === "valueMap") return "value map";
  if (op.op?.includes("Conflict")) return "conflict";
  if (op.op === "dateFormat") return "date formatted";
  if (op.op === "extractBetween") return "extracted";
  if (op.op === "quantityTransform") return "scaled";
  if (op.op === "stringSplit") return "split";
  if (op.op === "stringNormalize") return "normalized";
  if (op.op === "arrayStringTransform") return "cleaned";
  if (op.op === "arrayJoin") return "joined";
  if (op.op === "arrayFind") return "found";
  return "computed";
}

function typeSummary(fields = []) {
  return fields.map(field => `${field.path}: ${field.type}`);
}

export function explanationForProgram({ program, built, perception, preconditions }) {
  const ops = program.ops || [];
  const ruleSentences = explainProgram(program);
  const selectedByTarget = new Map(ops.map(op => [op.target, op]));
  const outputRoles = ops.map(op => ({
    target: op.target,
    role: roleForOp(op),
    sources: opSources(op),
    operation: op.op,
  }));
  const selectionReasons = built.targetCandidates
    .filter(row => row.candidates.length)
    .map(row => {
      const selected = row.candidates.find(candidate => deepEqual(candidate.op, selectedByTarget.get(row.target.path))) || row.candidates[0];
      const alternative = row.candidates.find(candidate => candidate !== selected);
      const costGap = alternative ? Number((alternative.cost - selected.cost).toFixed(2)) : null;
      return {
        target: row.target.path,
        selected: selected.title,
        alternative: alternative?.title || null,
        reason: alternative
          ? costGap > 0
            ? "Chosen because it is the simpler exact rule."
            : "Chosen because it fits the current input without guardrails."
          : "Chosen because it is the only exact rule found.",
        costGap,
      };
    });
  const assumptions = explainAssumptions(program, preconditions);
  return {
    ruleSentences,
    sourceFieldsConsidered: typeSummary(perception.inputFields),
    inputShape: typeSummary(perception.inputFields.slice(0, 12)),
    outputRoles,
    selectionReasons,
    assumptions,
  };
}
