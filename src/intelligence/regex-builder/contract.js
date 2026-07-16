import { createBenchmarkReport, createReliabilityProfile, createTraceEvent, evaluateBenchmarkAssertions } from "../contracts.js";
import { REGEX_BUILDER_BENCHMARKS } from "./benchmarks.js";
import { explainRegexResult, runRegexBuilder } from "./engine.js";

const ROUTE_BASE = "/regex";

export const REGEX_BUILDER_METADATA = {
  id: "regex-builder",
  title: "Regex Builder",
  route: ROUTE_BASE,
  category: "example-learning",
  status: "prototype",
  lifecycle: "experimental",
  version: "0.1",
  summary: "Build regular expressions from match and reject examples, with verification and refusal states.",
  capabilities: [
    "regex-from-examples",
    "positive-negative-generalization",
    "verification-gate",
    "ambiguity-refusal",
    "named-captures",
    "plain-english-explanations",
  ],
  schemas: {
    input: {
      type: "object",
      required: ["positives"],
      properties: {
        positives: { type: "array", items: { type: "string" } },
        negatives: { type: "array", items: { type: "string" }, optional: true },
        captures: { type: "array", optional: true },
        anchored: { type: "boolean", optional: true },
        flavor: { type: "string", enum: ["js", "pcre", "python", "java"], optional: true },
      },
    },
    output: {
      type: "object",
      required: ["status", "pattern", "verification", "diagnosis"],
    },
  },
  routes: [
    { path: ROUTE_BASE, kind: "workbench", title: "Regex Builder" },
  ],
  benchmarkSuites: [
    { id: "golden", title: "Golden", categories: ["golden"] },
    { id: "composition", title: "Composition", categories: ["composition"] },
    { id: "adversarial", title: "Adversarial", categories: ["adversarial"] },
  ],
  primitiveIds: ["perception", "hypothesis-generation", "search", "scoring", "execution", "tracing", "benchmarking"],
  reliability: {
    baselineSolved: 5,
    baselineTotal: 5,
    expectedFailures: [],
  },
};

export function validateRegexBuilderInput(input) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== "object") errors.push("Input must be an object.");
  if (!Array.isArray(input?.positives)) errors.push("Input requires positives as an array.");
  if (input?.negatives !== undefined && !Array.isArray(input.negatives)) errors.push("Negatives must be an array when provided.");
  if ((input?.positives || []).some(value => typeof value !== "string")) errors.push("Positive examples must be strings.");
  if ((input?.negatives || []).some(value => typeof value !== "string")) errors.push("Negative examples must be strings.");
  if ((input?.positives || []).length > 200 || (input?.negatives || []).length > 200) warnings.push("Large regex example sets may be slower in the browser workbench.");
  return { ok: errors.length === 0, errors, warnings };
}

export function createRegexBuilderSession(options = {}) {
  return {
    id: options.id || `regex-builder-session-${Date.now().toString(36)}`,
    seed: options.seed || "regex-builder-v0.1",
    budgetMs: options.budgetMs ?? 500,
    telemetry: [],
    events: [createTraceEvent("session.created", "session", "Session created", { toolId: REGEX_BUILDER_METADATA.id })],
  };
}

export function runRegexBuilderTool(input, session = createRegexBuilderSession()) {
  const validation = validateRegexBuilderInput(input);
  const events = [
    createTraceEvent("task.validated", "validate", validation.ok ? "Input validated" : "Input invalid", { warnings: validation.warnings }, validation.ok ? "success" : "error"),
  ];

  if (!validation.ok) {
    return {
      method: "invalid",
      status: "contradictory",
      pattern: "",
      patterns: {},
      verification: { ok: false, positiveFailures: [], negativeFailures: [] },
      diagnosis: { status: "contradictory", contradictions: validation.errors.map(message => ({ type: "invalid-input", message })), ambiguities: [], suggestedExamples: [] },
      validation,
      explanation: [],
      events,
      traces: events,
      telemetry: { durationMs: 0, method: "invalid" },
    };
  }

  const result = runRegexBuilder(input);
  events.push(createTraceEvent("examples.tokenized", "perceive", "Examples tokenized into regex runs", { positives: result.input.positives.length, negatives: result.input.negatives.length }, "success"));
  events.push(createTraceEvent("regex.synthesized", "hypothesize", "Candidate regex synthesized", { status: result.status, pattern: result.pattern }, result.status === "contradictory" ? "warn" : "success"));
  events.push(createTraceEvent("regex.verified", "execute", result.verification.ok ? "Regex verified against all examples" : "Regex failed verification", result.verification, result.verification.ok ? "success" : "error"));
  session.telemetry.push(result.telemetry);

  return {
    ...result,
    validation,
    events,
    traces: events,
    logs: events.map(event => event.message),
  };
}

export function explainRegexBuilderResult(result) {
  return explainRegexResult(result);
}

export function benchmarkRegexBuilder(options = {}) {
  const session = createRegexBuilderSession(options);
  const results = REGEX_BUILDER_BENCHMARKS.map(task => {
    const result = runRegexBuilderTool(task.input, session, options);
    const exact = result.status === task.expectedStatus
      && (!task.expectedPattern || result.pattern === task.expectedPattern)
      && (result.status !== "safe" || result.verification.ok);
    const row = {
      id: task.id,
      name: task.id,
      category: task.suite,
      suite: task.suite,
      exact,
      method: result.method,
      status: result.status,
      diagnosis: result.diagnosis,
      explanation: result.explanation.join(" "),
      confidence: { value: result.verification.ok ? 1 : 0.2, label: result.verification.ok ? "high" : "low" },
      telemetry: result.telemetry,
      expected: task.expectedPattern || task.expectedStatus,
      predicted: result.pattern,
      outputText: result.pattern,
      traces: result.traces || [],
      events: result.events || [],
    };
    const assertions = evaluateBenchmarkAssertions(row, {
      exact: true,
      expectedMethod: "regexBuilder",
      explanationIncludes: task.explanationIncludes,
      diagnosisStatus: task.expectedStatus,
      suggestedExampleExists: task.suggestedExampleExists,
      expectedContradictions: task.expectedContradiction ? [task.expectedContradiction] : undefined,
      requiredEventTypes: ["examples.tokenized", "regex.synthesized", "regex.verified"],
    });
    return { ...row, passed: assertions.passed, assertionChecks: assertions.checks, assertionFailures: assertions.failures };
  });
  return createBenchmarkReport(results, session.telemetry);
}

export function reliabilityRegexBuilder(options = {}) {
  return createReliabilityProfile(benchmarkRegexBuilder(options), { expectedFailures: [] });
}

export const regexBuilderTool = {
  metadata: () => REGEX_BUILDER_METADATA,
  validate: validateRegexBuilderInput,
  createSession: createRegexBuilderSession,
  run: runRegexBuilderTool,
  explain: explainRegexBuilderResult,
  benchmark: benchmarkRegexBuilder,
  reliability: reliabilityRegexBuilder,
  benchmarks: REGEX_BUILDER_BENCHMARKS,
};
