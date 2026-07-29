import { createBenchmarkReport, createReliabilityProfile, createTraceEvent, evaluateBenchmarkAssertions } from "../contracts.js";
import { detectFormat, parseWithFormat } from "../data-formats/index.js";
import { TRACE_BENCHMARKS } from "./benchmarks.js";
import { analyzeTrace } from "./analyze.js";
import { compareTrace } from "./compare.js";
import {
  buildBoardLayout,
  fingerprint,
  formatPath,
  groupedFingerprint,
  profileStructure,
  structuralDiff,
  summarizeProfile,
} from "./engine.js";

const ROUTE_BASE = "/trace";

export const TRACE_FIELD_PROFILE_SCHEMA = {
  type: "object",
  required: ["path", "label", "parentPath", "parsedTypes", "role", "completeness", "distinct", "examples", "insightIds"],
  properties: {
    path: { type: "string" },
    label: { type: "string" },
    parentPath: { type: ["string", "null"] },
    parsedTypes: { type: "object" },
    role: { type: "object", required: ["id", "confidence", "evidence"] },
    completeness: { type: "object", required: ["total", "present", "absent", "null", "emptyString", "whitespaceOnly", "presentRate"] },
    distinct: { type: "object", required: ["count", "exact", "ratio"] },
    numeric: { type: ["object", "null"] },
    categorical: { type: ["object", "null"] },
    temporal: { type: ["object", "null"] },
    temporalInference: { type: ["object", "null"] },
    string: { type: ["object", "null"] },
    examples: { type: "array" },
    insightIds: { type: "array" },
  },
};

export const TRACE_INSIGHT_SCHEMA = {
  type: "object",
  required: ["id", "kind", "level", "confidence", "title", "message", "fieldPaths", "evidence", "affected", "visual", "action", "rank"],
  properties: {
    id: { type: "string" },
    kind: { type: "string" },
    level: { enum: ["attention", "notable", "context"] },
    confidence: { type: "object", required: ["value", "label"] },
    title: { type: "string" },
    message: { type: "string" },
    fieldPaths: { type: "array" },
    evidence: { type: "array" },
    affected: { type: "object", required: ["count", "recordRefs", "capped"] },
    visual: { type: ["object", "null"] },
    action: { type: ["object", "null"] },
    rank: { type: "object", required: ["score", "components"] },
  },
};

export const TRACE_ANALYSIS_RESULT_SCHEMA = {
  type: "object",
  required: ["version", "status", "source", "coverage", "shape", "fields", "insights", "portrait", "recordSet", "warnings", "telemetry"],
  properties: {
    version: { const: "trace-analysis/1" },
    status: { enum: ["ready", "invalid", "cancelled"] },
    source: { type: "object", required: ["format", "bytes", "name", "contentFingerprint", "schemaFingerprint"] },
    coverage: { type: "object", required: ["mode", "totalRecords", "analyzedRecords", "totalLeaves", "analyzedLeaves", "sampleSeed", "sampleStrategy"] },
    shape: { type: "object", required: ["rootKind", "recordSetPath", "recordCount", "fieldCount", "maxDepth", "objectCount", "arrayCount", "scalarCount", "recordSetCandidates"] },
    fields: { type: "array", items: TRACE_FIELD_PROFILE_SCHEMA },
    insights: { type: "array", items: TRACE_INSIGHT_SCHEMA },
    portrait: { type: "object" },
    recordSet: { type: ["object", "null"] },
    warnings: { type: "array" },
    telemetry: { type: "object", required: ["durationMs", "method"] },
  },
};

export const TRACE_COMPARISON_RESULT_SCHEMA = {
  type: "object",
  required: ["version", "status", "baseline", "candidate", "fields", "rows", "keySuggestion", "settings", "insights", "overviewInsightIds", "summary"],
  properties: {
    version: { const: "trace-comparison/1" },
    status: { enum: ["ready", "invalid", "cancelled"] },
    baseline: TRACE_ANALYSIS_RESULT_SCHEMA,
    candidate: TRACE_ANALYSIS_RESULT_SCHEMA,
    fields: { type: "array" },
    rows: { type: ["object", "null"] },
    keySuggestion: { type: ["object", "null"] },
    settings: { type: "object" },
    insights: { type: "array", items: TRACE_INSIGHT_SCHEMA },
    overviewInsightIds: { type: "array" },
    summary: { type: "string" },
  },
};

export const TRACE_METADATA = {
  id: "trace",
  title: "Trace",
  route: ROUTE_BASE,
  category: "structural-identity",
  status: "stable",
  lifecycle: "stable",
  version: "1.0",
  summary: "Explain the shape, patterns, gaps, and unusual values in structured data, then compare profile changes when requested.",
  capabilities: [
    "deterministic-fingerprint",
    "canonical-serialization",
    "structural-diff",
    "outlier-detection",
    "deterministic-board-layout",
    "data-profiling",
    "ranked-insights",
    "keyed-record-comparison",
    "deterministic-sampling",
    "privacy-safe-report",
    "print-export",
    "evidence-linked-fields-records",
    "profile-comparison",
  ],
  schemas: {
    input: {
      type: "object",
      required: ["data"],
      properties: {
        data: { type: ["string", "object", "array", "number", "boolean", "null"] },
        compareTo: { type: ["string", "object", "array", "number", "boolean", "null"], optional: true },
        format: { type: "string", optional: true },
      },
    },
    output: {
      type: "object",
      required: ["status", "fingerprint", "profile", "layout"],
      properties: {
        analysis: TRACE_ANALYSIS_RESULT_SCHEMA,
        comparison: { ...TRACE_COMPARISON_RESULT_SCHEMA, optional: true },
      },
    },
  },
  routes: [
    { path: ROUTE_BASE, kind: "workbench", title: "Trace" },
  ],
  benchmarkSuites: [
    { id: "golden", title: "Golden", categories: ["golden"] },
    { id: "regression", title: "Regression", categories: ["regression"] },
    { id: "real-world", title: "Real-world", categories: ["real-world"] },
  ],
  primitiveIds: ["perception", "execution", "tracing", "benchmarking"],
  reliability: {
    baselineSolved: 4,
    baselineTotal: 4,
    expectedFailures: [],
  },
};

function parseInput(value, format = "auto") {
  if (typeof value !== "string") return { value, format: "value", bytes: JSON.stringify(value)?.length || 0 };
  return {
    value: parseWithFormat(value, format),
    format: format === "auto" ? detectFormat(value) : format,
    bytes: value.length,
  };
}

export function validateTraceInput(input) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== "object") errors.push("Input must be an object.");
  if (!("data" in (input || {}))) errors.push("Input requires data.");
  if (typeof input?.data === "string" && input.data.length > 25 * 1024 * 1024) errors.push("Data is too large. Limit is 25 MiB of text.");
  if (typeof input?.compareTo === "string" && input.compareTo.length > 25 * 1024 * 1024) errors.push("Compare data is too large. Limit is 25 MiB of text.");
  if (typeof input?.data === "string" && input.data.length > 500_000) warnings.push("Large record sets may use deterministic sampling for profiles; content fingerprints still cover all parsed data.");
  return { ok: errors.length === 0, errors, warnings };
}

export function createTraceSession(options = {}) {
  return {
    id: options.id || `trace-session-${Date.now().toString(36)}`,
    seed: options.seed || "trace-v0.1",
    telemetry: [],
    events: [createTraceEvent("session.created", "session", "Session created", { toolId: TRACE_METADATA.id })],
  };
}

export function runTraceTool(input, session = createTraceSession()) {
  const startedAt = performance.now();
  const validation = validateTraceInput(input);
  const events = [
    createTraceEvent("task.validated", "validate", validation.ok ? "Input validated" : "Input invalid", { warnings: validation.warnings }, validation.ok ? "success" : "error"),
  ];

  if (!validation.ok) {
    return {
      status: "invalid",
      validation,
      fingerprint: null,
      profile: null,
      layout: null,
      events,
      traces: events,
      telemetry: { durationMs: Math.round(performance.now() - startedAt), method: "trace" },
    };
  }

  const parsed = parseInput(input.data, input.format || "auto");
  events.push(createTraceEvent("input.parsed", "perception", "Input parsed", { format: parsed.format, bytes: parsed.bytes }, "success"));
  const profile = profileStructure(parsed.value);
  events.push(createTraceEvent("structure.profiled", "perception", "Structure profiled", profile, "success"));
  const primaryFingerprint = fingerprint(parsed.value);
  events.push(createTraceEvent("fingerprint.computed", "execution", "Fingerprint computed", primaryFingerprint, "success"));

  let diff = null;
  let comparison = null;
  let layoutValue = parsed.value;
  let layoutOptions = {};
  if ("compareTo" in input && input.compareTo !== undefined) {
    const parsedCompare = parseInput(input.compareTo, input.format || "auto");
    diff = structuralDiff(parsed.value, parsedCompare.value);
    comparison = compareTrace(parsed.value, parsedCompare.value, {
      baselineSource: { format: parsed.format, bytes: parsed.bytes, name: "Baseline" },
      candidateSource: { format: parsedCompare.format, bytes: parsedCompare.bytes, name: "Candidate" },
    });
    layoutValue = parsedCompare.value;
    layoutOptions = { diffStatus: diff.status, changed: diff.changed, removed: diff.removed };
    events.push(createTraceEvent("diff.computed", "execution", "Structural diff computed", diff.counts, "success"));
  }

  const layout = buildBoardLayout(layoutValue, layoutOptions);
  events.push(createTraceEvent("layout.built", "execution", "Board layout built", { cells: layout.cells.length, texts: layout.texts?.length || 0, bars: layout.bars?.length || 0, truncated: layout.truncated }, "success"));

  const analysis = analyzeTrace(layoutValue, {
    format: diff ? "value" : parsed.format,
    bytes: diff ? JSON.stringify(layoutValue)?.length || 0 : parsed.bytes,
    name: diff ? "Candidate" : "Pasted data",
  });
  events.push(createTraceEvent("analysis.completed", "perception", "Data analysis completed", { fields: analysis.fields.length, insights: analysis.insights.length, rootKind: analysis.shape.rootKind }, "success"));

  const telemetry = { durationMs: Math.round(performance.now() - startedAt), method: "trace" };
  session.telemetry.push(telemetry);

  return {
    status: "safe",
    fingerprint: primaryFingerprint,
    profile,
    layout,
    analysis,
    comparison,
    diff,
    validation,
    events,
    traces: events,
    telemetry,
  };
}

export function explainTraceResult(result) {
  if (!result || result.status !== "safe") return ["Trace could not build a fingerprint for this input."];
  const lines = [
    `${summarizeProfile(result.profile)}.`,
    `Fingerprint ${groupedFingerprint(result.fingerprint.hex)}.`,
  ];
  if (result.diff) {
    const c = result.diff.counts;
    lines.push(`${c.added} added, ${c.changed} changed, ${c.removed} removed, ${c.same} unchanged paths.`);
  }
  if (result.layout?.truncated) {
    lines.push(`${result.layout.truncated} values sampled out of the drawing; the fingerprint covers all data.`);
  }
  return lines;
}

function layoutSummary(layout) {
  return {
    bounds: layout.bounds,
    cells: layout.cells.length,
    panels: layout.panels.length,
    texts: layout.texts?.length || 0,
    bars: layout.bars?.length || 0,
    truncated: layout.truncated,
  };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function benchmarkTrace(options = {}) {
  const session = createTraceSession(options);
  const results = TRACE_BENCHMARKS.map(task => {
    const result = runTraceTool({
      data: task.input.data,
      compareTo: task.compare,
    }, session);
    const predicted = result.fingerprint?.hex;
    const layout = layoutSummary(result.layout);
    const exact = result.status === "safe"
      && predicted === task.expectedFingerprint
      && (!task.expectedCompareFingerprint || result.diff?.fingerprints.b === task.expectedCompareFingerprint)
      && (!task.expectedDiffCounts || sameJson(result.diff?.counts, task.expectedDiffCounts))
      && (!task.expectedProfile || sameJson(result.profile, task.expectedProfile))
      && (!task.expectedLayout || sameJson(layout, task.expectedLayout));
    const row = {
      id: task.id,
      name: task.id,
      category: task.suite,
      suite: task.suite,
      exact,
      method: "trace",
      status: result.status,
      diagnosis: { status: result.status },
      explanation: explainTraceResult(result).join(" "),
      confidence: { value: exact ? 1 : 0.4, label: exact ? "high" : "low" },
      telemetry: result.telemetry,
      expected: task.expectedFingerprint,
      predicted,
      outputText: `${predicted || ""} ${result.diff ? JSON.stringify(result.diff.counts) : ""}`,
      traces: result.traces || [],
      events: result.events || [],
    };
    const assertions = evaluateBenchmarkAssertions(row, {
      exact: true,
      expectedMethod: "trace",
      predictedEquals: task.expectedFingerprint,
      maxDurationMs: 250,
      requiredEventTypes: ["input.parsed", "fingerprint.computed", "layout.built"],
      diagnosisStatus: "safe",
    });
    return { ...row, passed: assertions.passed, assertionChecks: assertions.checks, assertionFailures: assertions.failures };
  });
  return createBenchmarkReport(results, session.telemetry);
}

export function reliabilityTrace(options = {}) {
  return createReliabilityProfile(benchmarkTrace(options), { expectedFailures: [] });
}

export const traceTool = {
  metadata: () => TRACE_METADATA,
  validate: validateTraceInput,
  createSession: createTraceSession,
  run: runTraceTool,
  explain: explainTraceResult,
  benchmark: benchmarkTrace,
  reliability: reliabilityTrace,
  benchmarks: TRACE_BENCHMARKS,
};

export { formatPath };
