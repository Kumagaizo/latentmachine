import { createBenchmarkReport, createReliabilityProfile, createTraceEvent, evaluateBenchmarkAssertions } from "../contracts.js";
import { createCorrection, createMemoryStore, recordCorrection, recordFailedAttempt, recordSolvedExample } from "../memory.js";
import { PATTERN_LAB_BENCHMARKS } from "./benchmarks.js";
import { runPatternLab } from "./engine.js";

const ROUTE_BASE = "/tools/pattern-lab";

export const PATTERN_LAB_METADATA = {
  id: "pattern-lab",
  title: "Teach It Once",
  route: ROUTE_BASE,
  category: "example-learning",
  status: "prototype",
  lifecycle: "experimental",
  version: "0.1",
  summary: "A single window for showing examples once and applying the learned rule to new items.",
  capabilities: [
    "example-to-rule",
    "automatic-job-inference",
    "hypothesis-generation",
    "confidence-scoring",
    "correction-memory",
    "assertion-driven-benchmarks",
  ],
  schemas: {
    input: {
      type: "object",
      required: ["examplesText"],
      properties: {
        intent: { type: "string", enum: ["transform", "extract", "complete", "classify", "explain"], optional: true },
        examplesText: { type: "string", optional: true },
        tryText: { type: "string", optional: true },
      },
    },
    output: {
      type: "object",
      required: ["hypothesis", "output", "confidence", "telemetry"],
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
    baselineSolved: 11,
    baselineTotal: 11,
    expectedFailures: [],
  },
};

export function validatePatternLabInput(input) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== "object") errors.push("Input must be an object.");
  if (input?.intent && !["transform", "extract", "complete", "classify", "explain"].includes(input.intent)) errors.push("Input intent must be valid when provided.");
  if (typeof input?.examplesText !== "string" && typeof input?.tryText !== "string") errors.push("Input requires examplesText or tryText.");
  if (!String(input?.examplesText || "").trim() && !String(input?.tryText || "").trim()) errors.push("Input requires examplesText or tryText.");
  if ((input?.examplesText || "").length > 75000) warnings.push("Large example sets may be slower in the browser workbench.");
  return { ok: errors.length === 0, errors, warnings };
}

export function createPatternLabSession(options = {}) {
  return {
    id: options.id || `pattern-lab-session-${Date.now().toString(36)}`,
    seed: options.seed || "pattern-lab-v0.1",
    budgetMs: options.budgetMs ?? 500,
    memory: createMemoryStore(options.memory),
    telemetry: [],
    events: [createTraceEvent("session.created", "session", "Session created", { toolId: PATTERN_LAB_METADATA.id })],
  };
}

export function runPatternLabTool(input, session = createPatternLabSession(), options = {}) {
  const validation = validatePatternLabInput(input);
  const events = [
    createTraceEvent("task.validated", "validate", validation.ok ? "Input validated" : "Input invalid", { warnings: validation.warnings }, validation.ok ? "success" : "error"),
  ];
  if (!validation.ok) {
    return {
      method: "invalid",
      error: true,
      validation,
      hypothesis: null,
      output: "",
      confidence: { value: 0, label: "very-low" },
      traces: events,
      events,
      logs: validation.errors,
      telemetry: { durationMs: 0, budgetMs: session.budgetMs, timedOut: false, method: "invalid" },
    };
  }

  const result = runPatternLab({ ...input, budgetMs: options.budgetMs ?? session.budgetMs });
  events.push(createTraceEvent("pattern.perceived", "perceive", "Examples parsed into pattern candidates", { examples: result.examples.length, intent: result.intent }, "success"));
  events.push(createTraceEvent("hypothesis.selected", "hypothesize", "Best pattern hypothesis selected", { id: result.hypothesis.id, title: result.hypothesis.title }, "success"));
  events.push(createTraceEvent("pattern.applied", "execute", "Pattern applied to try input", { outputCharacters: result.output.length }, "success"));

  const output = {
    validation,
    ...result,
    traces: events,
    events,
    logs: events.map(event => event.message),
  };
  session.telemetry.push(result.telemetry);
  if (result.confidence.value >= 0.55) recordSolvedExample(session.memory, { taskId: input.id || null, intent: result.intent, hypothesis: result.hypothesis.title });
  else recordFailedAttempt(session.memory, { taskId: input.id || null, method: result.method, failure: ["low-confidence-pattern"] });
  return output;
}

export function explainPatternLabResult(result) {
  return {
    summary: result.hypothesis?.summary || "No pattern selected.",
    method: result.method,
    intent: result.intent,
    confidence: result.confidence,
    hypothesis: result.hypothesis,
    traces: result.traces || [],
  };
}

export function benchmarkPatternLab(options = {}) {
  const session = createPatternLabSession(options);
  const results = PATTERN_LAB_BENCHMARKS.map(task => {
    const result = runPatternLabTool(task, session, options);
    const exact = task.expectedOutput !== undefined ? result.output === task.expectedOutput : (task.expectedOutputIncludes || []).every(fragment => result.output.includes(fragment));
    const row = {
      id: task.id,
      name: task.id,
      category: task.suite,
      suite: task.suite,
      exact,
      method: result.method,
      explanation: `${result.hypothesis?.title || ""}: ${result.hypothesis?.summary || ""}`,
      confidence: result.confidence,
      telemetry: result.telemetry,
      expected: task.expectedOutput || task.expectedOutputIncludes,
      predicted: result.output,
      outputText: result.output,
      traces: result.traces || [],
      events: result.events || [],
    };
    const assertions = evaluateBenchmarkAssertions(row, {
      exact: true,
      expectedMethod: task.expectedMethod,
      explanationIncludes: task.explanationIncludes,
      minConfidence: task.minConfidence,
      predictedEquals: task.expectedOutput,
      requiredEventTypes: ["pattern.perceived", "hypothesis.selected", "pattern.applied"],
    });
    return { ...row, passed: assertions.passed, assertionChecks: assertions.checks, assertionFailures: assertions.failures };
  });
  return createBenchmarkReport(results, session.telemetry);
}

export function reliabilityPatternLab(options = {}) {
  return createReliabilityProfile(benchmarkPatternLab(options), { expectedFailures: [] });
}

export function correctPatternLab(session, payload) {
  const correction = createCorrection({ toolId: PATTERN_LAB_METADATA.id, ...payload });
  recordCorrection(session.memory, correction);
  session.events.push(createTraceEvent("correction.recorded", "memory", "User correction recorded", { correctionId: correction.id }, "info"));
  return correction;
}

export const patternLabTool = {
  metadata: () => PATTERN_LAB_METADATA,
  validate: validatePatternLabInput,
  createSession: createPatternLabSession,
  run: runPatternLabTool,
  explain: explainPatternLabResult,
  benchmark: benchmarkPatternLab,
  reliability: reliabilityPatternLab,
  correct: correctPatternLab,
  benchmarks: PATTERN_LAB_BENCHMARKS,
};
