import { explainOp } from "./explain.js";
import { arrayPaths, entries, formatPath, getPath, objectFields, parsePath, setPath, typeOf } from "./core.js";
import { costOf } from "./costs.js";
import { buildDiagnosis, diagnosisStatus, reliabilityEvidenceFor, reliabilityFor, riskTypes, assessConfidence } from "./reliability.js";
import { parseJson } from "./operations.js";
import { buildProgram } from "./program-builder.js";
import { memorisationForProgram } from "./memorisation.js";
import { evidenceForProgram, explanationForProgram, preconditionsForProgram, programTitle, summarizeProgram } from "./program-view.js";
import { executeJsonTransform, runtimeWarnings } from "./runtime.js";
import { schemaDriftForProgram, schemaPathKey } from "./schema.js";
import { deepEqual, stableStringify } from "./shared.js";

export { executeJsonTransform };
export { applySuggestions, hasValuableSuggestions, suggestTransformations } from "./suggestions.js";

const JSON_TRANSFORM_VERSION = 3;
function makeTrace(phase, message, data = {}) {
  return { phase, message, data };
}

function normalizeExamples(input = {}) {
  const raw = input.examples || [];
  const parsed = raw.map((example, index) => ({
    id: example.id || `example-${index + 1}`,
    input: parseJson(example.input, `Example ${index + 1} input`),
    output: parseJson(example.output, `Example ${index + 1} output`),
    correction: !!example.correction,
  }));

  const byInput = new Map();
  for (const example of parsed) {
    const key = stableStringify(example.input);
    const group = byInput.get(key) || [];
    const duplicate = group.find(existing => deepEqual(existing.output, example.output));
    if (duplicate) {
      duplicate.correction ||= example.correction;
      continue;
    }
    if (example.correction) group.splice(0, group.length);
    group.push(example);
    byInput.set(key, group);
  }

  const contradictions = [...byInput.values()]
    .filter(group => group.length > 1)
    .map(group => {
      const exampleIds = group.map(example => example.id);
      return {
        type: "same-input-conflict",
        message: `${exampleIds.join(", ")} use the same input but require different outputs. Resolve the conflicting expected outputs before trusting a rule.`,
        exampleIds,
      };
    });

  return {
    examples: [...byInput.values()].flat(),
    contradictions,
  };
}

function perceive(examples) {
  const inputFields = objectFields(examples[0]?.input);
  const outputFields = objectFields(examples[0]?.output);
  return {
    examples: examples.length,
    inputFields,
    outputFields,
    inputArrays: arrayPaths(examples[0]?.input),
    outputArrays: arrayPaths(examples[0]?.output),
  };
}

export function runJsonTransform(input = {}) {
  const started = Date.now();
  const traces = [];
  const normalized = normalizeExamples(input);
  let examples = normalized.examples;
  if (!examples.length) throw new Error("At least one input/output example is required.");
  const perception = perceive(examples);
  traces.push(makeTrace("perceive", `${perception.inputFields.length} input fields and ${perception.outputFields.length} output fields detected.`, perception));

  const newInput = input.newInput !== undefined ? parseJson(input.newInput, "New input") : examples.at(-1).input;
  const built = buildProgram(examples, newInput, JSON_TRANSFORM_VERSION);
  const memorisation = memorisationForProgram(built.program);
  const totalCandidates = built.targetCandidates.reduce((sum, row) => sum + row.candidates.length, 0);
  traces.push(makeTrace("hypothesize", `${totalCandidates} candidate rules generated for ${built.targetCandidates.length} output target paths.`));
  traces.push(makeTrace("score", built.exact ? "Simplest exact program selected." : "No exact program found for all examples.", {
    mdl: Number(built.program.ops.reduce((sum, op) => sum + (op.cost || 1), 0).toFixed(2)),
    ambiguous: built.ambiguous,
    unexplained: built.unexplained,
  }));

  const output = executeJsonTransform(built.program, newInput);
  const schemaDrift = schemaDriftForProgram(built.program, examples, newInput);
  const warnings = [...normalized.contradictions, ...runtimeWarnings(built.program, newInput), ...schemaDrift.blocking];
  traces.push(makeTrace("execute", `Rule executed with ${built.program.ops.length} step${built.program.ops.length === 1 ? "" : "s"}.`));
  if (schemaDrift.blocking.length || schemaDrift.advisory.length) {
    traces.push(makeTrace("schema", `${schemaDrift.blocking.length} blocking and ${schemaDrift.advisory.length} advisory schema drift item${schemaDrift.blocking.length + schemaDrift.advisory.length === 1 ? "" : "s"} detected.`, schemaDrift));
  }

  const alternatives = built.targetCandidates.map(row => ({
    target: row.target.path,
    candidates: row.candidates.slice(0, 4).map(item => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      cost: Number(item.cost.toFixed(2)),
      program: item.op,
    })),
  }));
  const tests = examples.map((example, index) => ({
    id: example.id,
    index,
    passed: built.matches[index],
    expected: example.output,
    predicted: built.predictions[index],
  }));
  const status = diagnosisStatus({ built, warnings, examples, memorisation });
  const risks = riskTypes({ status, warnings, ambiguous: built.ambiguous });
  const preconditions = preconditionsForProgram(built.program, examples);
  const evidence = evidenceForProgram(built.program, examples, JSON_TRANSFORM_VERSION);
  const explanation = explanationForProgram({ program: built.program, built, perception, preconditions });
  const diagnosis = buildDiagnosis({ status, built, warnings, tests, alternatives, examples, schemaDrift, memorisation });
  const ruleId = built.program.ops.map(op => op.op).join("+") || "empty";
  const createdAt = new Date(started).toISOString();
  const reliabilityEvidence = reliabilityEvidenceFor({ built, warnings, tests, schemaDrift, memorisation });
  const shapedConfidence = { ...assessConfidence(reliabilityEvidence), risks };
  const reliability = reliabilityFor({ status, confidence: shapedConfidence, evidence: reliabilityEvidence, risks });

  return {
    method: "jsonTransform",
    status,
    rule: {
      version: JSON_TRANSFORM_VERSION,
      id: ruleId,
      title: programTitle(built.program.ops),
      summary: summarizeProgram(built.program.ops) || "No output targets were present.",
      status,
      memorisation,
      confidence: shapedConfidence,
      reliability,
      preconditions,
      program: built.program,
      display: built.program.ops.map(explainOp),
      explanations: explanation.ruleSentences,
      warnings,
      evidence,
      explanation,
      createdAt,
    },
    output,
    traces,
    confidence: shapedConfidence,
    reliability,
    memorisation,
    preconditions,
    warnings,
    evidence,
    explanation,
    diagnosis,
    diagnostics: {
      status,
      exact: built.exact,
      ambiguity: built.ambiguous,
      ambiguityTriage: built.ambiguityTriage,
      unexplained: built.unexplained,
      warnings,
      schemaDrift,
      tests,
      alternatives,
      diagnosis,
      reliability,
    },
    telemetry: {
      durationMs: Date.now() - started,
      method: "jsonTransform",
      exampleCount: examples.length,
      operationCount: built.program.ops.length,
    },
  };
}

export const jsonTransformInternals = {
  entries,
  typeOf,
  formatPath,
  parsePath,
  getPath,
  setPath,
  schemaPathKey,
  costOf,
  assessConfidence,
  reliabilityEvidenceFor,
  executeJsonTransform,
  runtimeWarnings,
};
