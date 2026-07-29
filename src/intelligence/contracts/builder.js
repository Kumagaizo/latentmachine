import { buildTransformTask, runBuiltTransform } from "../json-transform/translator.js";
import { clone } from "../json-transform/core.js";
import { deepEqual, stableStringify } from "../json-transform/shared.js";
import { generateTransformationChallenges } from "./challenges.js";
import { withTransformationContractIdentity } from "./identity.js";
import { withTransformationInvariantSuggestions } from "./invariants.js";
import { inferInputSchema, inferOutputSchema } from "./schema-inference.js";
import {
  TRANSFORMATION_CONTRACT_KIND,
  TRANSFORMATION_CONTRACT_VERSION,
  TRANSFORMATION_INFERENCE_STATUSES,
  validateTransformationContract,
} from "./schema.js";

export const TRANSFORMATION_CONTRACT_ARTIFACT_VERSION = 1;

function cloneJson(value) {
  return clone(value);
}

function normalizedEvidenceExamples(examples = []) {
  const parsed = examples.map((example, index) => ({
    id: example.id ? String(example.id) : `example-${index + 1}`,
    input: cloneJson(example.input),
    output: cloneJson(example.output),
    correction: !!example.correction,
    formats: cloneJson(example.formats || { input: "json", output: "json" }),
  }));
  const byInput = new Map();
  for (const example of parsed) {
    const key = stableStringify(example.input);
    const group = byInput.get(key) || [];
    const duplicate = group.find(existing => deepEqual(existing.output, example.output));
    if (duplicate) {
      duplicate.correction ||= example.correction;
    } else {
      if (example.correction) group.splice(0, group.length);
      group.push(example);
    }
    byInput.set(key, group);
  }

  const usedIds = new Set();
  return [...byInput.values()].flat().map(example => {
    const sourceId = example.id;
    let id = sourceId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${sourceId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return id === sourceId ? example : { ...example, id, sourceId };
  });
}

function contractInputFormat(task) {
  const formats = [...new Set((task.examples || []).map(example => example.formats?.input || "json"))];
  return formats.length === 1 ? formats[0] : "value";
}

function evidenceLinks(result, examples) {
  return (result.evidence || [])
    .map(row => {
      const observations = (row.examples || []).map((observation, index) => ({
        ...cloneJson(observation),
        exampleId: examples[index]?.id || String(observation.exampleId || `example-${index + 1}`),
      }));
      return {
        operationIndex: row.opIndex,
        exampleIds: observations.filter(observation => observation.passed).map(observation => observation.exampleId),
        target: row.target,
        operation: row.op,
        observations,
      };
    })
    .filter(link => link.exampleIds.length);
}

function sourceArtifactExtension(result, task) {
  return {
    sourceMethod: result.method,
    rule: {
      id: result.rule?.id || null,
      title: result.rule?.title || "",
      summary: result.rule?.summary || "",
      status: result.rule?.status || result.status,
      display: cloneJson(result.rule?.display || []),
      explanations: cloneJson(result.rule?.explanations || []),
      explanation: cloneJson(result.rule?.explanation || {}),
    },
    formats: cloneJson(result.formats || {}),
    translator: cloneJson(result.translator || {}),
    formatWarnings: cloneJson(result.formatWarnings || []),
    newInput: cloneJson(task.newInput),
    newInputFormat: task.newInputFormat,
    applyAsBatch: !!task.applyAsBatch,
  };
}

function validationFailure(validation) {
  const details = validation.errors
    .slice(0, 5)
    .map(error => `${error.path} [${error.code}] ${error.message}`)
    .join("; ");
  return new Error(`Learned Transformation Contract failed validation: ${details}`);
}

export function buildTransformationContract({
  task,
  result,
  options = {},
} = {}) {
  if (!task || !Array.isArray(task.examples)) {
    throw new Error("buildTransformationContract requires a normalized transform task.");
  }
  if (!result?.rule?.program || !TRANSFORMATION_INFERENCE_STATUSES.includes(result.status)) {
    throw new Error("buildTransformationContract requires a completed LatentMachine inference result.");
  }

  const examples = normalizedEvidenceExamples(task.examples);
  const diagnosis = cloneJson(result.diagnosis || {});
  const confidence = cloneJson(result.confidence || {});
  const lifecycleState = result.status === "safe" ? "unreviewed" : "review_required";
  const contract = {
    kind: TRANSFORMATION_CONTRACT_KIND,
    contractVersion: TRANSFORMATION_CONTRACT_VERSION,
    engine: {
      name: "latentmachine",
      transformVersion: result.rule.version,
      artifactVersion: TRANSFORMATION_CONTRACT_ARTIFACT_VERSION,
    },
    identity: null,
    lifecycle: {
      approvalState: lifecycleState,
      revision: options.lifecycle?.revision ?? 1,
      supersedes: options.lifecycle?.supersedes ?? null,
    },
    title: options.title || result.rule.title || "Learned transformation",
    description: options.description ?? result.rule.summary ?? "",
    formats: {
      input: contractInputFormat(task),
      output: task.outputFormat || result.outputFormat || "json",
    },
    evidence: {
      examples,
      count: examples.length,
      coverage: {
        examplesProvided: diagnosis.examplesProvided ?? examples.length,
        examplesMatched: diagnosis.examplesMatched ?? 0,
        exact: !!result.diagnostics?.exact,
        tests: cloneJson((result.diagnostics?.tests || []).map((test, index) => ({
          exampleId: examples[index]?.id || String(test.id || `example-${index + 1}`),
          passed: !!test.passed,
        }))),
      },
      contradictions: cloneJson(diagnosis.contradictions || []),
      source: options.evidenceSource || "user-provided",
    },
    inference: {
      status: result.status,
      confidence,
      candidatesConsidered: cloneJson(diagnosis.candidates || result.diagnostics?.alternatives || []),
      ambiguities: cloneJson(diagnosis.ambiguities || []),
      reasons: cloneJson(confidence.reasons || []),
      diagnosis,
      reliability: cloneJson(result.reliability || {}),
      warnings: cloneJson(result.warnings || []),
    },
    input: {
      schema: inferInputSchema(examples),
      preconditions: cloneJson(result.preconditions || result.rule.preconditions || []),
      unknownFieldPolicy: "allow",
    },
    output: {
      schema: inferOutputSchema(examples),
      unknownFieldPolicy: "block",
      unresolvedValuePolicy: "block",
    },
    program: cloneJson(result.rule.program),
    invariants: [],
    challenges: [],
    runtimePolicy: {
      requireApproval: true,
      onRecordViolation: "quarantine",
      onBatchViolation: "block",
      warningThreshold: 0,
    },
    evidenceLinks: evidenceLinks(result, examples),
    approval: null,
    extensions: {
      ...(cloneJson(options.extensions) || {}),
      latentmachine: {
        ...(cloneJson(options.extensions?.latentmachine) || {}),
        ...sourceArtifactExtension(result, task),
      },
    },
    metadata: {
      builder: "learnContract",
      ...(cloneJson(options.metadata) || {}),
    },
  };

  const identified = withTransformationContractIdentity(contract);
  const validation = validateTransformationContract(identified);
  if (!validation.ok) throw validationFailure(validation);
  return withTransformationInvariantSuggestions(generateTransformationChallenges(identified));
}

export function learnContract(input = {}, options = {}) {
  const task = buildTransformTask(input);
  const result = runBuiltTransform(input, task, { applyBatch: options.applyBatch ?? true });
  return buildTransformationContract({ task, result, options });
}
