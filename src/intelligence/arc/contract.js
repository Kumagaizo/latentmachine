import { ARC_BENCHMARKS } from "./benchmarks.js";
import { Library, eq, solve, validateGrid } from "./engine.js";
import { ARC_GOLDEN } from "./golden.js";
import { createBenchmarkReport, createReliabilityProfile, createTraceEvent, evaluateBenchmarkAssertions } from "../contracts.js";
import { createCorrection, createMemoryStore, recordCorrection, recordFailedAttempt, recordSolvedExample } from "../memory.js";

export const ARC_TASK_SCHEMA = {
  type: "object",
  required: ["train"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    cat: { type: "string", enum: ["unit", "comp", "adv", "draw"] },
    train: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["input", "output"],
        properties: {
          input: { ref: "ArcGrid" },
          output: { ref: "ArcGrid" },
        },
      },
    },
    test: {
      type: "array",
      items: {
        type: "object",
        required: ["input"],
        properties: {
          input: { ref: "ArcGrid" },
          output: { ref: "ArcGrid", optional: true },
        },
      },
    },
  },
};

export const ARC_RESULT_SCHEMA = {
  type: "object",
  required: ["method", "logs", "traces", "confidence", "telemetry"],
  properties: {
    method: { type: "string" },
    best: { type: "object", optional: true },
    testPred: { ref: "ArcGrid", optional: true },
    testSurp: { type: "number", optional: true },
    traces: { type: "array" },
    confidence: { type: "object" },
    telemetry: { type: "object" },
  },
};

const ROUTE_BASE = "/tools/arc-grid-reasoner";

export const ARC_TOOL_METADATA = {
  id: "arc-grid-reasoner",
  title: "ARC Grid Reasoner",
  route: ROUTE_BASE,
  category: "symbolic-reasoning",
  status: "prototype",
  lifecycle: "validated",
  version: "0.5",
  summary: "Symbolic grid reasoning workbench for object, relation, and abstract drawing rules.",
  capabilities: [
    "grid-transforms",
    "object-perception",
    "relational-rules",
    "abstract-drawing-rules",
    "benchmark-evaluation",
    "assertion-driven-benchmarks",
    "structured-traces",
    "confidence-scoring",
  ],
  schemas: {
    input: ARC_TASK_SCHEMA,
    output: ARC_RESULT_SCHEMA,
  },
  routes: [
    { path: ROUTE_BASE, kind: "workbench", title: "Workbench" },
    { path: `${ROUTE_BASE}/examples`, kind: "examples", title: "Examples" },
    { path: `${ROUTE_BASE}/benchmarks`, kind: "benchmarks", title: "Benchmarks" },
    { path: `${ROUTE_BASE}/history`, kind: "history", title: "History" },
  ],
  benchmarkSuites: [
    { id: "unit", title: "Unit", categories: ["unit"] },
    { id: "composition", title: "Composition", categories: ["comp"] },
    { id: "adversarial", title: "Adversarial", categories: ["adv"] },
    { id: "drawing", title: "Drawing", categories: ["draw"] },
    { id: "golden", title: "Golden", taskIds: Object.keys(ARC_GOLDEN.tasks) },
  ],
  primitiveIds: ["perception", "hypothesis-generation", "search", "scoring", "execution", "tracing", "benchmarking", "correction-memory"],
  reliability: {
    baselineSolved: 22,
    baselineTotal: 22,
    expectedFailures: ARC_GOLDEN.expectedFailures,
  },
};

export function validateArcTask(task) {
  const errors = [];
  const warnings = [];
  if (!task || typeof task !== "object") errors.push("Task must be an object.");
  if (!Array.isArray(task?.train) || task.train.length === 0) errors.push("Task requires at least one training pair.");
  for (const [idx, pair] of (task?.train || []).entries()) {
    if (!validateGrid(pair.input)) errors.push(`train[${idx}].input is not a valid ARC grid.`);
    if (!validateGrid(pair.output)) errors.push(`train[${idx}].output is not a valid ARC grid.`);
  }
  for (const [idx, pair] of (task?.test || []).entries()) {
    if (!validateGrid(pair.input)) errors.push(`test[${idx}].input is not a valid ARC grid.`);
    if (pair.output && !validateGrid(pair.output)) errors.push(`test[${idx}].output is not a valid ARC grid.`);
    if (!pair.output) warnings.push(`test[${idx}] has no ground truth output; confidence will be lower.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function createArcSession(options = {}) {
  return {
    id: options.id || `arc-session-${Date.now().toString(36)}`,
    library: new Library(),
    memory: createMemoryStore(options.memory),
    seed: options.seed || "arc-v0.5",
    budgetMs: options.budgetMs ?? 1500,
    telemetry: [],
    events: [createTraceEvent("session.created", "session", "Session created", { toolId: ARC_TOOL_METADATA.id }, "info")],
  };
}

export function runArcTask(task, session = createArcSession(), options = {}) {
  const validation = validateArcTask(task);
  if (!validation.ok) {
    const traces = validation.errors.map((message, index) => ({ id: `validation-${index}`, type: "validation.error", phase: "validate", severity: "error", message, data: {} }));
    return {
      method: "invalid",
      error: true,
      validation,
      logs: validation.errors.map(e => `✗ ${e}`),
      traces,
      events: traces,
      confidence: { value: 0, label: "very-low", risks: ["invalid-input"] },
      telemetry: { durationMs: 0, budgetMs: session.budgetMs, timedOut: false, seed: session.seed, candidateCount: 0, traceCount: validation.errors.length, method: "invalid" },
    };
  }
  session.events.push(createTraceEvent("task.validated", "validate", "Task input validated", { taskId: task.id || null, warnings: validation.warnings }, "success"));
  const result = solve(task, session.library, {
    seed: options.seed || session.seed,
    budgetMs: options.budgetMs ?? session.budgetMs,
    maxDepth: options.maxDepth,
    beamWidth: options.beamWidth,
  });
  result.validation = validation;
  result.events = [
    ...session.events.slice(-1),
    ...(result.traces || []).map(t => ({ ...t, type: t.type || `solver.${t.phase}` })),
  ];
  if (result.testSurp === 0) recordSolvedExample(session.memory, { taskId: task.id, method: result.method, explanation: result.best?.explain || null });
  else recordFailedAttempt(session.memory, { taskId: task.id, method: result.method, failure: result.fail || ["test-mismatch"] });
  session.telemetry.push(result.telemetry);
  return result;
}

export function explainArcResult(result) {
  return {
    summary: result.best?.explain || "No rule selected.",
    method: result.method,
    confidence: result.confidence,
    traces: result.traces || [],
    risks: result.confidence?.risks || [],
  };
}

export function benchmarkArcTool(options = {}) {
  const session = createArcSession(options);
  const results = ARC_BENCHMARKS.map(task => {
    const result = runArcTask(task, session, options);
    const expected = task.test?.[0]?.output || null;
    const exact = expected ? eq(result.testPred, expected) : false;
    const golden = ARC_GOLDEN.tasks[task.id] || {};
    const row = {
      id: task.id,
      name: task.name,
      category: task.cat,
      suite: task.cat === "comp" ? "composition" : task.cat === "adv" ? "adversarial" : task.cat === "draw" ? "drawing" : "unit",
      exact,
      method: result.method,
      explanation: result.best?.explain || null,
      confidence: result.confidence,
      telemetry: result.telemetry,
      expected,
      predicted: result.testPred,
      traces: result.traces || [],
      events: result.events || [],
    };
    const assertions = evaluateBenchmarkAssertions(row, {
      exact: !!expected,
      expectedMethod: golden.method,
      explanationIncludes: golden.explanationIncludes,
      minConfidence: golden.minConfidence,
      maxDurationMs: golden.maxDurationMs,
      requiredTraceTypes: golden.requiredTraceTypes,
      requiredEventTypes: golden.requiredEventTypes,
    });
    return {
      ...row,
      passed: assertions.passed,
      assertionChecks: assertions.checks,
      assertionFailures: assertions.failures,
    };
  });
  return createBenchmarkReport(results, session.telemetry);
}

export function reliabilityArcTool(options = {}) {
  return createReliabilityProfile(benchmarkArcTool(options), { expectedFailures: ARC_GOLDEN.expectedFailures });
}

export function correctArcResult(session, payload) {
  const correction = createCorrection({ toolId: ARC_TOOL_METADATA.id, ...payload });
  recordCorrection(session.memory, correction);
  session.events.push(createTraceEvent("correction.recorded", "memory", "User correction recorded", { correctionId: correction.id, taskId: correction.taskId }, "info"));
  return correction;
}

export const arcGridReasonerTool = {
  metadata: () => ARC_TOOL_METADATA,
  validate: validateArcTask,
  createSession: createArcSession,
  run: runArcTask,
  explain: explainArcResult,
  benchmark: benchmarkArcTool,
  reliability: reliabilityArcTool,
  correct: correctArcResult,
  benchmarks: ARC_BENCHMARKS,
};
