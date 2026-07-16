export const REQUIRED_TOOL_METHODS = ["metadata", "validate", "createSession", "run", "explain", "benchmark"];

export const TOOL_LIFECYCLE_STATES = ["draft", "experimental", "validated", "production", "deprecated"];

export const BENCHMARK_SUITE_TYPES = ["unit", "composition", "adversarial", "drawing", "regression", "real-world", "golden"];
export const BENCHMARK_ASSERTION_TYPES = [
  "exact",
  "expectedMethod",
  "explanationIncludes",
  "minConfidence",
  "maxDurationMs",
  "predictedEquals",
  "absentInOutput",
  "requiredTraceTypes",
  "requiredEventTypes",
  "diagnosisStatus",
  "expectedWarnings",
  "suggestedExampleExists",
  "expectedContradictions",
  "expectedAmbiguities",
  "expectedTriagedAmbiguities",
];

export function assertToolContract(tool) {
  const missing = REQUIRED_TOOL_METHODS.filter(key => typeof tool?.[key] !== "function");
  if (missing.length) throw new Error(`Tool contract missing: ${missing.join(", ")}`);
  const meta = tool.metadata();
  for (const key of ["id", "title", "route", "category", "status", "lifecycle", "version", "capabilities", "schemas", "routes"]) {
    if (meta[key] === undefined) throw new Error(`Tool metadata missing: ${key}`);
  }
  if (!TOOL_LIFECYCLE_STATES.includes(meta.lifecycle)) throw new Error(`Invalid lifecycle state: ${meta.lifecycle}`);
  return true;
}

export function validateToolInput(validator, input) {
  const result = validator(input);
  return {
    ok: !!result.ok,
    errors: result.errors || [],
    warnings: result.warnings || [],
  };
}

export function createTraceEvent(type, phase, message, data = {}, severity = "info") {
  return {
    id: `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    phase,
    severity,
    message,
    data,
    at: new Date().toISOString(),
  };
}

function stableJson(value) {
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

function hasEventType(events, expectedType) {
  return (events || []).some(event => event?.type === expectedType || event?.phase === expectedType);
}

function warningTypes(row) {
  return [
    ...(row.warnings || []),
    ...(row.diagnosis?.guardrails || []),
    ...(row.diagnosis?.contradictions || []),
    ...(row.diagnostics?.warnings || []),
  ].map(warning => warning?.type).filter(Boolean);
}

function confidenceComparable(confidence = {}) {
  if (Number.isFinite(confidence.value)) return confidence.value;
  if (Number.isFinite(confidence.checks?.passed) && Number.isFinite(confidence.checks?.total) && confidence.checks.total > 0) {
    return confidence.checks.passed / confidence.checks.total;
  }
  return 0;
}

export function evaluateBenchmarkAssertions(row, assertions = {}) {
  const failures = [];
  const checks = [];
  const addCheck = (type, passed, expected, actual) => {
    checks.push({ type, passed, expected, actual });
    if (!passed) failures.push({ type, expected, actual });
  };

  if (assertions.exact !== undefined) {
    addCheck("exact", !!row.exact === !!assertions.exact, !!assertions.exact, !!row.exact);
  }
  if (assertions.expectedMethod) {
    addCheck("expectedMethod", row.method === assertions.expectedMethod, assertions.expectedMethod, row.method || null);
  }
  if (assertions.explanationIncludes) {
    const expected = Array.isArray(assertions.explanationIncludes) ? assertions.explanationIncludes : [assertions.explanationIncludes];
    for (const fragment of expected) {
      addCheck("explanationIncludes", !!row.explanation?.includes(fragment), fragment, row.explanation || null);
    }
  }
  if (assertions.minConfidence !== undefined) {
    const actual = confidenceComparable(row.confidence);
    addCheck("minConfidence", actual >= assertions.minConfidence, assertions.minConfidence, actual);
  }
  if (assertions.maxDurationMs !== undefined) {
    const actual = row.telemetry?.durationMs ?? Infinity;
    addCheck("maxDurationMs", actual <= assertions.maxDurationMs, assertions.maxDurationMs, actual);
  }
  if (assertions.predictedEquals !== undefined) {
    addCheck("predictedEquals", stableJson(row.predicted) === stableJson(assertions.predictedEquals), assertions.predictedEquals, row.predicted);
  }
  if (assertions.absentInOutput?.length) {
    const output = row.outputText || "";
    for (const fragment of assertions.absentInOutput) {
      addCheck("absentInOutput", !output.includes(fragment), fragment, output.includes(fragment) ? "present" : "absent");
    }
  }
  if (assertions.requiredTraceTypes?.length) {
    for (const type of assertions.requiredTraceTypes) {
      addCheck("requiredTraceTypes", hasEventType(row.traces, type), type, (row.traces || []).map(t => t?.type || t?.phase));
    }
  }
  if (assertions.requiredEventTypes?.length) {
    for (const type of assertions.requiredEventTypes) {
      addCheck("requiredEventTypes", hasEventType(row.events, type), type, (row.events || []).map(e => e?.type || e?.phase));
    }
  }
  if (assertions.diagnosisStatus) {
    const actual = row.diagnosis?.status || row.status || row.diagnostics?.status || null;
    addCheck("diagnosisStatus", actual === assertions.diagnosisStatus, assertions.diagnosisStatus, actual);
  }
  if (assertions.expectedWarnings?.length) {
    const actual = warningTypes(row);
    for (const warningType of assertions.expectedWarnings) {
      addCheck("expectedWarnings", actual.includes(warningType), warningType, actual);
    }
  }
  if (assertions.suggestedExampleExists !== undefined) {
    const actual = (row.diagnosis?.suggestedExamples || []).length > 0;
    addCheck("suggestedExampleExists", actual === !!assertions.suggestedExampleExists, !!assertions.suggestedExampleExists, actual);
  }
  if (assertions.expectedContradictions?.length) {
    const actual = (row.diagnosis?.contradictions || []).map(item => item.type || item.field).filter(Boolean);
    for (const contradiction of assertions.expectedContradictions) {
      addCheck("expectedContradictions", actual.includes(contradiction), contradiction, actual);
    }
  }
  if (assertions.expectedAmbiguities?.length) {
    const actual = (row.diagnosis?.ambiguities || []).map(item => item.target || item.type).filter(Boolean);
    for (const ambiguity of assertions.expectedAmbiguities) {
      addCheck("expectedAmbiguities", actual.includes(ambiguity), ambiguity, actual);
    }
  }
  if (assertions.expectedTriagedAmbiguities?.length) {
    const triage = row.diagnosis?.ambiguityTriage || row.diagnostics?.ambiguityTriage || [];
    for (const expected of assertions.expectedTriagedAmbiguities) {
      const match = triage.find(item => item.target === expected.target && item.strength === expected.strength);
      addCheck("expectedTriagedAmbiguities", !!match, expected, triage.map(item => ({ target: item.target, strength: item.strength })));
    }
  }
  if (assertions.expectedSchemaDrift?.length) {
    const drift = row.diagnosis?.schemaDrift || row.diagnostics?.schemaDrift || {};
    const actual = [...(drift.blocking || []), ...(drift.advisory || [])];
    for (const expected of assertions.expectedSchemaDrift) {
      const match = actual.find(item =>
        (!expected.type || item.type === expected.type)
        && (!expected.path || item.path === expected.path || item.source === expected.path)
      );
      addCheck("expectedSchemaDrift", !!match, expected, actual.map(item => ({ type: item.type, path: item.path || item.source })));
    }
  }

  return {
    passed: failures.length === 0,
    checks,
    failures,
  };
}

export function createBenchmarkReport(results, telemetry = []) {
  return {
    total: results.length,
    solved: results.filter(r => r.exact).length,
    passed: results.filter(r => r.passed ?? r.exact).length,
    failed: results.filter(r => !r.exact).map(r => r.id),
    assertionFailed: results.filter(r => !(r.passed ?? r.exact)).map(r => r.id),
    assertionFailureCount: results.reduce((sum, row) => sum + (row.assertionFailures?.length || 0), 0),
    bySuite: results.reduce((acc, row) => {
      if (!acc[row.suite]) acc[row.suite] = { total: 0, solved: 0, passed: 0, failed: [], assertionFailed: [] };
      acc[row.suite].total++;
      if (row.exact) acc[row.suite].solved++;
      else acc[row.suite].failed.push(row.id);
      if (row.passed ?? row.exact) acc[row.suite].passed++;
      else acc[row.suite].assertionFailed.push(row.id);
      return acc;
    }, {}),
    results,
    telemetry,
  };
}

export function createReliabilityProfile(benchmarkReport, options = {}) {
  const total = benchmarkReport.total || 0;
  const solved = benchmarkReport.passed ?? benchmarkReport.solved ?? 0;
  const solveRate = total ? solved / total : 0;
  const avgDurationMs = Math.round((benchmarkReport.telemetry || []).reduce((sum, t) => sum + (t.durationMs || 0), 0) / Math.max(1, (benchmarkReport.telemetry || []).length));
  const label = solveRate >= 0.95 ? "excellent" : solveRate >= 0.85 ? "strong" : solveRate >= 0.65 ? "promising" : "fragile";
  return {
    label,
    solveRate,
    solved,
    total,
    failed: benchmarkReport.failed || [],
    assertionFailed: benchmarkReport.assertionFailed || [],
    assertionFailureCount: benchmarkReport.assertionFailureCount || 0,
    averageDurationMs: avgDurationMs,
    expectedFailures: options.expectedFailures || [],
    updatedAt: new Date().toISOString(),
  };
}
