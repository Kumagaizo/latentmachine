import { createBenchmarkReport, createReliabilityProfile, evaluateBenchmarkAssertions } from "../contracts.js";
import { SIGNAL_BENCHMARKS } from "./benchmarks.js";
import { analyzeSignal } from "./engine.js";
import { createEvidencePack } from "./explain.js";

export const SIGNAL_RESULT_SCHEMA = {
  type: "object",
  required: ["version", "status", "source", "mode", "summary", "segments", "templates", "findings", "warnings", "events", "telemetry"],
  properties: {
    version: { const: "signal-analysis/1" },
    status: { enum: ["ready", "invalid", "cancelled"] },
    source: { type: "object", required: ["name", "bytes", "lines", "fingerprint"] },
    mode: { type: ["object", "null"] },
    summary: { type: "object", required: ["nonblankLines", "uniqueTemplates", "repeatedShare", "attentionCount", "notableCount"] },
    segments: { type: "array" },
    templates: { type: "array" },
    findings: { type: "array" },
    warnings: { type: "array" },
    events: { type: "array" },
    telemetry: { type: "object" },
  },
};

export const SIGNAL_METADATA = {
  id: "signal",
  title: "Signal",
  route: "/signal",
  category: "line-oriented-analysis",
  status: "experimental",
  lifecycle: "experimental",
  version: "0.1",
  summary: "Inspect line-oriented artifacts for repeated structures, local pattern breaks, concrete constraints, exceptions, and severity markers.",
  capabilities: [
    "exact-repetition",
    "template-clustering",
    "pattern-break-detection",
    "transition-grammar",
    "compression-novelty",
    "constraint-markers",
    "severity-markers",
    "evidence-linked-lines",
    "reviewed-evidence-pack",
    "deterministic-analysis",
    "local-processing",
  ],
  schemas: {
    input: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", maxLength: 2 * 1024 * 1024 },
        name: { type: "string", optional: true },
        mode: { enum: ["auto", "stream", "document"], optional: true },
        settings: {
          type: "object",
          optional: true,
          properties: {
            localWindow: { type: "number", minimum: 2, maximum: 12 },
            includeCompressionNovelty: { type: "boolean" },
            minimumTemplateGroup: { type: "number", minimum: 2, maximum: 20 },
          },
        },
      },
    },
    output: SIGNAL_RESULT_SCHEMA,
  },
  routes: [{ path: "/signal", kind: "workbench", title: "Signal" }],
  benchmarkSuites: [
    { id: "golden", title: "Golden", categories: ["golden"] },
    { id: "adversarial", title: "Adversarial", categories: ["adversarial"] },
    { id: "real-world", title: "Real-world", categories: ["real-world"] },
  ],
  primitiveIds: ["perception", "hypothesis-generation", "scoring", "tracing", "benchmarking", "correction-memory"],
  reliability: {
    baselineSolved: SIGNAL_BENCHMARKS.length,
    baselineTotal: SIGNAL_BENCHMARKS.length,
    expectedFailures: [],
  },
};

export function validateSignalToolInput(input) {
  const probe = analyzeSignal(input);
  return {
    ok: probe.status === "ready",
    errors: probe.validation?.errors || (probe.routing?.detected ? ["Structured data requires explicit line-analysis confirmation."] : []),
    warnings: (probe.warnings || []).map(warning => warning.message),
  };
}

export function createSignalSession(options = {}) {
  return {
    id: options.id || `signal-session-${options.seed || "v0.1"}`,
    seed: options.seed || "signal-v0.1",
    telemetry: [],
    events: [],
  };
}

export function runSignalTool(input, session = createSignalSession()) {
  const result = analyzeSignal(input);
  session.telemetry.push(result.telemetry);
  session.events.push(...result.events);
  return result;
}

export function explainSignalResult(result) {
  if (!result || result.status !== "ready") return ["Signal could not establish a valid line-oriented analysis."];
  return [
    `${result.summary.nonblankLines} nonblank lines form ${result.summary.uniqueTemplates} normalized templates.`,
    `${result.summary.attentionCount} attention and ${result.summary.notableCount} notable observations are backed by named evidence components.`,
    "Signal ranks observable evidence, not business importance.",
  ];
}

function benchmarkExpectation(task, result) {
  if (result.status !== "ready") return false;
  if (task.assertion === "fatal-top") return result.findings[0]?.kind === "failure" && result.findings[0]?.level === "attention";
  if (task.assertion === "single-template") return result.templates.length === 1 && result.summary.attentionCount === 0;
  if (task.assertion === "rejections-visible") return result.segments.filter(segment => segment.roles.includes("failure")).length >= 2;
  if (task.assertion === "constraints-linked") return result.segments.some(segment => segment.roles.includes("exception") && segment.relatedSegmentIds.length);
  if (task.assertion === "prohibition-visible") return result.segments.filter(segment => segment.text.includes("must not")).every(segment => segment.level === "attention");
  if (task.assertion === "restatement-linked") return result.segments.some(segment => segment.evidence.some(item => item.kind === "probable-restatement"));
  if (task.assertion === "warning-visible") return result.segments.some(segment => segment.roles.includes("warning") && segment.level !== "context");
  if (task.assertion === "weak-evidence") return result.summary.attentionCount === 0;
  return false;
}

export function benchmarkSignal(options = {}) {
  const session = createSignalSession(options);
  const results = SIGNAL_BENCHMARKS.map(task => {
    const startedAt = performance.now();
    const result = runSignalTool({ text: task.text, name: `${task.id}.txt`, mode: "auto" }, session);
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const exact = benchmarkExpectation(task, result);
    const pack = result.status === "ready" ? createEvidencePack(result, { includeAttention: true, reviewed: true }) : null;
    const row = {
      id: task.id,
      name: task.id,
      category: task.suite,
      suite: task.suite,
      exact,
      method: "signal-evidence-grammar-v1",
      status: result.status,
      diagnosis: { status: result.status },
      explanation: explainSignalResult(result).join(" "),
      confidence: { value: exact ? 1 : 0.35, label: exact ? "strong" : "limited" },
      telemetry: { ...result.telemetry, durationMs },
      expected: task.assertion,
      predicted: exact ? task.assertion : "assertion-failed",
      outputText: pack?.text || "",
      traces: result.events,
      events: result.events,
    };
    const assertions = evaluateBenchmarkAssertions(row, {
      exact: true,
      expectedMethod: "signal-evidence-grammar-v1",
      maxDurationMs: 250,
      requiredEventTypes: [
        "input.validated",
        "input.mode-inferred",
        "segments.created",
        "templates.normalized",
        "clusters.created",
        "features.detected",
        "candidates.generated",
        "findings.scored",
        "analysis.completed",
      ],
      diagnosisStatus: "ready",
    });
    return { ...row, passed: assertions.passed, assertionChecks: assertions.checks, assertionFailures: assertions.failures };
  });
  return createBenchmarkReport(results, session.telemetry);
}

export function reliabilitySignal(options = {}) {
  return createReliabilityProfile(benchmarkSignal(options), { expectedFailures: [] });
}

export const signalTool = {
  metadata: () => SIGNAL_METADATA,
  validate: validateSignalToolInput,
  createSession: createSignalSession,
  run: runSignalTool,
  explain: explainSignalResult,
  benchmark: benchmarkSignal,
  reliability: reliabilitySignal,
  benchmarks: SIGNAL_BENCHMARKS,
};
