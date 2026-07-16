import { createBenchmarkReport, createReliabilityProfile, createTraceEvent, evaluateBenchmarkAssertions } from "../contracts.js";
import { createCorrection, createMemoryStore, recordCorrection, recordFailedAttempt, recordSolvedExample } from "../memory.js";
import { JSON_TRANSFORM_BENCHMARKS } from "./benchmarks.js";
import { runJsonTransform } from "./engine.js";
import { assessConfidence } from "./reliability.js";

const ROUTE_BASE = "/tools/json-transform";

export const JSON_TRANSFORM_METADATA = {
  id: "json-transform",
  title: "Latentmachine",
  route: ROUTE_BASE,
  category: "example-learning",
  status: "prototype",
  lifecycle: "experimental",
  version: "0.1",
  summary: "Translate structured data from examples with deterministic, inspectable JSON, XML, CSV, TOML, YAML, and .env rules.",
  capabilities: [
    "json-csv-translation",
    "json-to-json-synthesis",
    "symbolic-program-ir",
    "ambiguity-inspection",
    "exact-example-tests",
    "correction-memory",
    "assertion-driven-benchmarks",
  ],
  schemas: {
    input: {
      type: "object",
      required: ["examples"],
      properties: {
        examples: { type: "array" },
        newInput: { type: "object", optional: true },
      },
    },
    output: {
      type: "object",
      required: ["rule", "output", "status", "confidence", "reliability", "diagnosis", "diagnostics", "telemetry"],
    },
  },
  routes: [
    { path: ROUTE_BASE, kind: "workbench", title: "Workbench" },
    { path: `${ROUTE_BASE}/benchmarks`, kind: "benchmarks", title: "Benchmarks" },
    { path: `${ROUTE_BASE}/memory`, kind: "history", title: "Memory" },
  ],
  benchmarkSuites: [
    { id: "unit", title: "Unit", categories: ["unit"] },
    { id: "composition", title: "Composition", categories: ["composition"] },
    { id: "adversarial", title: "Adversarial", categories: ["adversarial"] },
  ],
  primitiveIds: ["perception", "hypothesis-generation", "search", "scoring", "execution", "tracing", "benchmarking", "correction-memory"],
  reliability: {
    baselineSolved: 109,
    baselineTotal: 109,
    expectedFailures: [],
  },
};

export function validateJsonTransformInput(input) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== "object") errors.push("Input must be an object.");
  if (!Array.isArray(input?.examples) || !input.examples.length) errors.push("Input requires at least one example.");
  for (const [index, example] of (input?.examples || []).entries()) {
    if (!example || typeof example !== "object") errors.push(`Example ${index + 1} must be an object.`);
    if (example?.input === undefined) errors.push(`Example ${index + 1} requires input.`);
    if (example?.output === undefined) errors.push(`Example ${index + 1} requires output.`);
  }
  if ((input?.examples || []).length < 2) warnings.push("One example may leave multiple plausible rules. Add a second example to reduce ambiguity.");
  return { ok: errors.length === 0, errors, warnings };
}

export function createJsonTransformSession(options = {}) {
  return {
    id: options.id || `json-transform-session-${Date.now().toString(36)}`,
    seed: options.seed || "json-transform-v0.1",
    budgetMs: options.budgetMs ?? 500,
    memory: createMemoryStore(options.memory),
    telemetry: [],
    events: [createTraceEvent("session.created", "session", "Session created", { toolId: JSON_TRANSFORM_METADATA.id })],
  };
}

function blockedReliability(input, guardrails = []) {
  const evidence = {
    exactFit: false,
    examplesProvided: input?.examples?.length || 0,
    examplesMatched: 0,
    operations: 0,
    unexplainedPaths: [],
    meaningfulAmbiguities: [],
    triagedAmbiguities: [],
    schemaDrift: { blocking: [], advisory: [] },
    guardrails,
  };
  const confidence = { ...assessConfidence(evidence), risks: ["unsafe"] };
  return {
    status: "unsafe",
    supportLabel: confidence.label,
    supportNote: confidence.note,
    confidence,
    evidence,
    risks: ["unsafe"],
  };
}

export function runJsonTransformTool(input, session = createJsonTransformSession(), options = {}) {
  const validation = validateJsonTransformInput(input);
  const events = [
    createTraceEvent("task.validated", "validate", validation.ok ? "Input validated" : "Input invalid", { warnings: validation.warnings }, validation.ok ? "success" : "error"),
  ];
  if (!validation.ok) {
    const reliability = blockedReliability(input, validation.errors.map(message => ({ type: "invalid-input", field: null, message })));
    return {
      method: "invalid",
      error: true,
      validation,
      rule: null,
      output: null,
      status: "unsafe",
      confidence: reliability.confidence,
      reliability,
      diagnosis: { status: "unsafe", examplesProvided: input?.examples?.length || 0, examplesMatched: 0, contradictions: [], ambiguities: [], unexplained: [], guardrails: [], suggestedExamples: [] },
      diagnostics: { status: "unsafe", exact: false, tests: [], alternatives: [], ambiguity: [], unexplained: [], reliability },
      traces: events,
      events,
      logs: validation.errors,
      telemetry: { durationMs: 0, budgetMs: session.budgetMs, timedOut: false, method: "invalid" },
    };
  }

  try {
    const result = runJsonTransform({ ...input, budgetMs: options.budgetMs ?? session.budgetMs });
    events.push(...result.traces.map(trace => createTraceEvent(`json.${trace.phase}`, trace.phase, trace.message, trace.data, "success")));
    const output = {
      validation,
      ...result,
      traces: events,
      events,
      logs: events.map(event => event.message),
    };
    session.telemetry.push(result.telemetry);
    if (result.diagnostics.exact) recordSolvedExample(session.memory, { taskId: input.id || null, intent: "json-transform", hypothesis: result.rule.title });
    else recordFailedAttempt(session.memory, { taskId: input.id || null, method: result.method, failure: ["no-exact-json-program"] });
    return output;
  } catch (error) {
    const event = createTraceEvent("json.error", "execute", error.message, {}, "error");
    const reliability = blockedReliability(input, [{ type: "runtime-error", field: null, message: error.message }]);
    return {
      method: "jsonTransform",
      error: true,
      validation,
      rule: null,
      output: null,
      status: "unsafe",
      confidence: reliability.confidence,
      reliability,
      diagnosis: { status: "unsafe", examplesProvided: input?.examples?.length || 0, examplesMatched: 0, contradictions: [], ambiguities: [], unexplained: [], guardrails: [], suggestedExamples: [] },
      diagnostics: { status: "unsafe", exact: false, tests: [], alternatives: [], ambiguity: [], unexplained: [], reliability },
      traces: [...events, event],
      events: [...events, event],
      logs: [error.message],
      telemetry: { durationMs: 0, budgetMs: session.budgetMs, timedOut: false, method: "jsonTransform" },
    };
  }
}

export function explainJsonTransformResult(result) {
  return {
    summary: result.rule?.summary || "No JSON rule selected.",
    method: result.method,
    confidence: result.confidence,
    reliability: result.reliability,
    hypothesis: result.rule,
    diagnostics: result.diagnostics,
    traces: result.traces || [],
  };
}

export function benchmarkJsonTransform(options = {}) {
  const session = createJsonTransformSession(options);
  const results = JSON_TRANSFORM_BENCHMARKS.map(task => {
    const result = runJsonTransformTool(task, session, options);
    const exact = JSON.stringify(result.output) === JSON.stringify(task.expectedOutput);
    const row = {
      id: task.id,
      name: task.id,
      category: task.category,
      suite: task.suite,
      exact,
      status: result.status,
      method: result.method,
      explanation: `${result.rule?.title || ""}: ${(result.rule?.display || []).join("; ")}`,
      confidence: result.confidence,
      reliability: result.reliability,
      diagnosis: result.diagnosis,
      warnings: result.warnings || result.diagnostics?.warnings || [],
      telemetry: result.telemetry,
      expected: task.expectedOutput,
      predicted: result.output,
      outputText: JSON.stringify(result.output),
      traces: result.traces || [],
      events: result.events || [],
    };
    const assertions = evaluateBenchmarkAssertions(row, {
      exact: true,
      expectedMethod: "jsonTransform",
      explanationIncludes: task.explanationIncludes,
      minConfidence: task.minConfidence,
      maxDurationMs: task.assertions?.maxDurationMs,
      predictedEquals: task.expectedOutput,
      requiredEventTypes: ["json.perceive", "json.hypothesize", "json.score", "json.execute"],
      diagnosisStatus: task.expectedDiagnosis?.status,
      expectedWarnings: task.expectedDiagnosis?.expectedWarnings,
      suggestedExampleExists: task.expectedDiagnosis?.suggestedExampleExists,
      expectedContradictions: task.expectedDiagnosis?.expectedContradictions,
      expectedAmbiguities: task.expectedDiagnosis?.expectedAmbiguities,
      expectedTriagedAmbiguities: task.expectedDiagnosis?.expectedTriagedAmbiguities,
      expectedSchemaDrift: task.expectedDiagnosis?.expectedSchemaDrift,
    });
    return { ...row, passed: assertions.passed, assertionChecks: assertions.checks, assertionFailures: assertions.failures };
  });
  return createBenchmarkReport(results, session.telemetry);
}

export function reliabilityJsonTransform(options = {}) {
  return createReliabilityProfile(benchmarkJsonTransform(options), { expectedFailures: [] });
}

export function correctJsonTransform(session, payload) {
  const correction = createCorrection({ toolId: JSON_TRANSFORM_METADATA.id, ...payload });
  recordCorrection(session.memory, correction);
  session.events.push(createTraceEvent("correction.recorded", "memory", "User correction recorded", { correctionId: correction.id }, "info"));
  return correction;
}

export const jsonTransformTool = {
  metadata: () => JSON_TRANSFORM_METADATA,
  validate: validateJsonTransformInput,
  createSession: createJsonTransformSession,
  run: runJsonTransformTool,
  explain: explainJsonTransformResult,
  benchmark: benchmarkJsonTransform,
  reliability: reliabilityJsonTransform,
  correct: correctJsonTransform,
  benchmarks: JSON_TRANSFORM_BENCHMARKS,
};
