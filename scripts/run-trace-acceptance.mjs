import assert from "node:assert/strict";
import fs from "node:fs";
import { TRACE_BENCHMARKS } from "../src/intelligence/trace/benchmarks.js";
import {
  runTraceTool,
  TRACE_ANALYSIS_RESULT_SCHEMA,
  TRACE_COMPARISON_RESULT_SCHEMA,
  TRACE_FIELD_PROFILE_SCHEMA,
  TRACE_INSIGHT_SCHEMA,
} from "../src/intelligence/trace/contract.js";
import { analyzeTrace, deterministicSampleIndices } from "../src/intelligence/trace/analyze.js";
import { compareTrace } from "../src/intelligence/trace/compare.js";
import { recordsToCsv, serializeTraceReport } from "../src/intelligence/trace/reports.js";
import { parseWithFormat } from "../src/intelligence/data-formats/index.js";

let failed = 0;

function stableLayout(layout) {
  return JSON.parse(JSON.stringify(layout));
}

function deterministicAnalysisCore(analysis) {
  const core = JSON.parse(JSON.stringify(analysis));
  delete core.telemetry;
  return core;
}

for (const task of TRACE_BENCHMARKS) {
  try {
    const first = runTraceTool({ data: task.input.data, compareTo: task.compare });
    const second = runTraceTool({ data: task.input.data, compareTo: task.compare });
    assert.equal(first.status, "safe", `${task.id} should be safe`);
    assert.equal(first.fingerprint.hex, task.expectedFingerprint, `${task.id} fingerprint`);
    assert.deepEqual(stableLayout(first.layout), stableLayout(second.layout), `${task.id} layout should be deterministic`);
    if (task.expectedCompareFingerprint) assert.equal(first.diff.fingerprints.b, task.expectedCompareFingerprint, `${task.id} compare fingerprint`);
    if (task.expectedDiffCounts) assert.deepEqual(first.diff.counts, task.expectedDiffCounts, `${task.id} diff counts`);
    if (task.expectedProfile) assert.deepEqual(first.profile, task.expectedProfile, `${task.id} profile`);
    if (task.expectedLayout) {
      assert.deepEqual({
        bounds: first.layout.bounds,
        cells: first.layout.cells.length,
        panels: first.layout.panels.length,
        texts: first.layout.texts?.length || 0,
        bars: first.layout.bars?.length || 0,
        truncated: first.layout.truncated,
      }, task.expectedLayout, `${task.id} layout summary`);
    }
    console.log(`PASS ${task.id}: ${first.fingerprint.hex}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${task.id}: ${error.message}`);
  }
}

function readFixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`../fixtures/trace/${name}.json`, import.meta.url), "utf8"));
}

function readFixtureText(name, extension) {
  return fs.readFileSync(new URL(`../fixtures/trace/${name}.${extension}`, import.meta.url), "utf8");
}

const visualCases = [
  {
    id: "viz-small-config",
    data: readFixture("viz-small-config"),
    assert(result) {
      assert.equal(result.status, "safe");
      assert.equal(result.layout.panels.length, 0, "small config should have no shelf panels");
      assert.ok(result.layout.texts.length > result.layout.bars.length, "small config should be typography-led");
      assert.ok(result.layout.cells.some(cell => cell.path === "$.sensors[7].temp" && cell.out), "planted table outlier should be hit-testable");
      assert.ok(result.layout.texts.some(item => item.text === "null" && item.opacity < 0.5), "null should render as reduced-opacity text");
    },
  },
  {
    id: "viz-dense-telemetry",
    data: readFixture("viz-dense-telemetry"),
    assert(result) {
      assert.equal(result.status, "safe");
      assert.equal(result.layout.panels.length, 0, "dense telemetry should have no shelf panels");
      assert.ok(result.layout.lines.some(line => line.dash), "strip chart should include a dashed mean line");
      assert.ok(result.layout.bars.length >= 150, "dense telemetry should render strip/table bars");
      assert.ok(result.layout.texts.some(item => /2 outlier 30,31/.test(item.text)), "strip annotation should name both adjacent outlier indices");
      assert.ok(result.layout.cells.some(cell => cell.path === "$.events[45].temp" && cell.out), "dense table outlier should stay literal and hit-testable");
    },
  },
  {
    id: "viz-diff",
    data: readFixture("viz-diff-a"),
    compareTo: readFixture("viz-diff-b"),
    assert(result) {
      assert.deepEqual(result.diff.counts, { added: 1, changed: 2, removed: 1, same: 3 });
      assert.ok(result.layout.texts.some(item => item.strike), "changed leaves should render struck-through old values");
      assert.ok(result.layout.texts.some(item => item.role === "safe" && item.text.startsWith("+ ")), "added leaf should render as safe + value");
      assert.ok(result.layout.texts.some(item => item.role === "danger" && item.text.startsWith("- removed")), "removed leaf should render as one danger line");
    },
  },
];

for (const task of visualCases) {
  try {
    const first = runTraceTool({ data: task.data, compareTo: task.compareTo });
    const second = runTraceTool({ data: task.data, compareTo: task.compareTo });
    assert.deepEqual(stableLayout(first.layout), stableLayout(second.layout), `${task.id} layout should be deterministic`);
    task.assert(first);
    console.log(`PASS ${task.id}: visual grammar v2`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${task.id}: ${error.message}`);
  }
}

const insightCases = [
  {
    id: "analysis-nested-records",
    run() {
      const rows = Array.from({ length: 30 }, (_, index) => ({
        customer_id: `C-${String(index + 1).padStart(3, "0")}`,
        amount: index === 29 ? 9999 : 80 + index,
        status: index % 5 ? "paid" : "pending",
        created_at: `2026-06-${String((index % 28) + 1).padStart(2, "0")}T10:00:00Z`,
        note: index === 7 ? null : "ok",
      }));
      const first = analyzeTrace({ payload: { rows } });
      const second = analyzeTrace({ payload: { rows } });
      assert.deepEqual(deterministicAnalysisCore(first), deterministicAnalysisCore(second), "analysis core contract should be deterministic");
      assert.equal(first.shape.recordSetPath, "$.payload.rows");
      assert.equal(first.shape.recordCount, 30);
      assert.equal(first.fields.find(field => field.label === "customer_id")?.role.id, "identifier");
      assert.equal(first.fields.find(field => field.label === "created_at")?.role.id, "datetime");
      assert.ok(first.insights.some(insight => insight.kind === "unusual-numeric"), "planted unusual amount should be surfaced");
      assert.ok(first.insights.some(insight => insight.kind === "missingness"), "planted null should be surfaced");
    },
  },
  {
    id: "comparison-keyed-reorder",
    run() {
      const baseline = Array.from({ length: 25 }, (_, index) => ({ id: `R-${index}`, value: index, tags: ["a", "b"] }));
      const candidate = [...baseline].reverse();
      const result = compareTrace(baseline, candidate);
      assert.equal(result.rows.status, "ready");
      assert.deepEqual(result.rows.counts, { added: 0, removed: 0, changed: 0, unchanged: 25 });
      assert.equal(result.rows.orderChanged, true);
      assert.ok(result.insights.some(insight => insight.kind === "record-order-change"));
    },
  },
  {
    id: "comparison-keyed-changes",
    run() {
      const baseline = Array.from({ length: 25 }, (_, index) => ({ id: `R-${index}`, value: index }));
      const candidate = baseline.slice(1).map(row => row.id === "R-8" ? { ...row, value: 88 } : row).concat({ id: "R-25", value: 25, extra: true });
      const result = compareTrace(baseline, candidate);
      assert.deepEqual(result.rows.counts, { added: 1, removed: 1, changed: 1, unchanged: 23 });
      assert.equal(result.fields.filter(field => field.status === "added").length, 1, "schema addition should be counted once");
    },
  },
  {
    id: "comparison-duplicate-key-guardrail",
    run() {
      const baseline = Array.from({ length: 22 }, (_, index) => ({ id: index < 2 ? "duplicate" : `R-${index}`, value: index }));
      const candidate = baseline.map(row => ({ ...row }));
      const result = compareTrace(baseline, candidate, { keyPath: "$[*].id" });
      assert.equal(result.rows.status, "duplicate-keys");
      assert.ok(result.insights.some(insight => insight.kind === "duplicate-key"));
    },
  },
  {
    id: "comparison-settings",
    run() {
      const baseline = Array.from({ length: 20 }, (_, index) => ({ id: `R-${index}`, value: index, tags: ["a", "b"] }));
      const candidate = baseline.map(row => ({ ...row, value: row.value + 0.001, tags: ["b", "a"] }));
      const result = compareTrace(baseline, candidate, { absoluteTolerance: 0.01, ignoreArrayOrder: true });
      assert.deepEqual(result.rows.counts, { added: 0, removed: 0, changed: 0, unchanged: 20 });
    },
  },
  {
    id: "analysis-deterministic-full-range-sampling",
    run() {
      const rows = Array.from({ length: 1000 }, (_, index) => ({ id: `R-${index}`, value: index, tail_pattern: index > 950 ? "tail" : "body" }));
      const options = { exactRecordLimit: 100, sampleSize: 80 };
      const first = analyzeTrace(rows, options);
      const second = analyzeTrace(rows, options);
      assert.equal(first.coverage.mode, "sampled");
      assert.equal(first.coverage.totalRecords, 1000);
      assert.equal(first.coverage.analyzedRecords, 80);
      assert.equal(first.recordSet.sampleRecordRefs.length, 80);
      assert.ok(first.recordSet.sampleRecordRefs.some(index => index >= 900), "sample should reach the tail of the record set");
      assert.notDeepEqual(first.recordSet.sampleRecordRefs, Array.from({ length: 80 }, (_, index) => index), "sample must not be first-N");
      assert.deepEqual(deterministicAnalysisCore(first), deterministicAnalysisCore(second), "sampled analysis core should be deterministic");
      assert.ok(first.insights.every(insight => insight.message.includes("analyzed sample")), "every sampled claim should disclose sampling");
      assert.deepEqual(deterministicSampleIndices(1000, 80, first.coverage.sampleSeed), first.recordSet.sampleRecordRefs);
    },
  },
  {
    id: "report-privacy-and-determinism",
    run() {
      const marker = "RAW_PRIVATE_MARKER";
      const analysis = analyzeTrace(Array.from({ length: 20 }, (_, index) => ({ id: `R-${index}`, secret: index ? "ordinary" : marker, formula: index ? "ok" : "=2+2" })));
      const safe = serializeTraceReport(analysis, { privacySafe: true });
      const safeAgain = serializeTraceReport(analysis, { privacySafe: true });
      const full = serializeTraceReport(analysis, { privacySafe: false });
      assert.equal(safe, safeAgain, "report serialization should be byte-deterministic");
      assert.ok(!safe.includes(marker), "privacy-safe report should exclude raw examples and values");
      assert.ok(full.includes(marker), "full report should retain explicitly requested examples");
      const dominantMarker = "RAW_DOMINANT_SECRET";
      const dominant = analyzeTrace(Array.from({ length: 24 }, (_, index) => ({ id: `R-${index}`, status: index < 23 ? dominantMarker : "other" })));
      assert.ok(!serializeTraceReport(dominant, { privacySafe: true }).includes(dominantMarker), "privacy-safe report should redact raw values embedded in insight messages");
      const duplicateMarker = "RAW_DUPLICATE_SECRET";
      const duplicateRows = Array.from({ length: 24 }, (_, index) => ({ id: index < 2 ? duplicateMarker : `R-${index}`, value: index }));
      const duplicateComparison = compareTrace(duplicateRows, duplicateRows, { keyPath: "$[*].id" });
      assert.equal(duplicateComparison.rows.status, "duplicate-keys");
      assert.ok(!serializeTraceReport(duplicateComparison, { privacySafe: true }).includes(duplicateMarker), "privacy-safe report should redact duplicate matching keys");
      const csv = recordsToCsv([{ formula: "=2+2", note: "a,b" }], [
        { label: "formula", relativeSegments: ["formula"] },
        { label: "note", relativeSegments: ["note"] },
      ]);
      assert.ok(csv.includes("'=2+2"), "CSV export should neutralize spreadsheet formulas");
      assert.ok(csv.includes('"a,b"'), "CSV export should quote delimiter-containing cells");
    },
  },
  {
    id: "analysis-document-array-completeness",
    run() {
      const document = analyzeTrace({ service: "api", ports: [8000, 8001, 8002], tags: ["primary", "public"] });
      for (const field of document.fields) {
        assert.ok(field.completeness.presentRate <= 1, `${field.path} completeness must not exceed 100%`);
      }
      assert.equal(document.fields.find(field => field.label === "ports")?.parsedTypes.array, 1);
      const series = analyzeTrace([1, 2, 3]);
      assert.equal(series.shape.rootKind, "series");
      assert.equal(series.fields[0].numeric.count, 3, "root primitive series should retain numeric profiling");
    },
  },
  {
    id: "analysis-outlier-record-reference",
    run() {
      const rows = Array.from({ length: 24 }, (_, index) => ({ id: `R-${index}`, amount: index === 0 ? null : index === 23 ? 9999 : 100 + index }));
      const analysis = analyzeTrace(rows);
      const finding = analysis.insights.find(item => item.kind === "unusual-numeric" && item.fieldPaths.some(path => path.endsWith(".amount")));
      assert.deepEqual(finding.affected.recordRefs, [23], "outlier evidence must retain the original record index after null filtering");
      assert.equal(finding.evidence.find(item => item.metric === "unusual-value")?.recordRef, 23);
    },
  },
  {
    id: "analysis-sampled-schema-and-evidence",
    run() {
      const base = Array.from({ length: 1000 }, (_, index) => ({ id: `R-${index}`, value: index, ...(index % 2 ? { note: "present" } : {}) }));
      const rare = base.map((row, index) => index === 0 ? { ...row, rare_tail_field: true } : row);
      const options = { exactRecordLimit: 100, sampleSize: 80 };
      const baseline = analyzeTrace(base, options);
      const analysis = analyzeTrace(rare, options);
      assert.equal(analysis.coverage.mode, "sampled");
      assert.notEqual(analysis.source.schemaFingerprint, baseline.source.schemaFingerprint, "schema fingerprint must cover fields outside the profile sample");
      assert.notEqual(analysis.fields.find(field => field.label === "id")?.role.id, "identifier", "estimated distinctness alone must not produce a high-confidence identifier");
      const missing = analysis.insights.find(item => item.kind === "missingness" && item.fieldPaths.some(path => path.endsWith(".note")));
      assert.ok(missing.affected.count > 0);
      assert.ok(missing.affected.recordRefs.length > 0, "sampled absent values must retain evidence record references");
    },
  },
  {
    id: "analysis-date-and-identifier-guardrails",
    run() {
      const invalidDates = analyzeTrace(Array.from({ length: 24 }, (_, index) => ({ id: `R-${index}`, date: "2026-02-30" })));
      assert.equal(invalidDates.fields.find(field => field.label === "date")?.role.id, "text", "invalid calendar dates must remain text");
      const misleading = Array.from({ length: 24 }, (_, index) => ({ valid: `value-${index}`, amount: index }));
      const misleadingAnalysis = analyzeTrace(misleading);
      assert.notEqual(misleadingAnalysis.fields.find(field => field.label === "valid")?.role.id, "identifier", "words that merely end in id must not become identifiers");
      assert.equal(compareTrace(misleading, [...misleading].reverse()).rows, null, "comparison must stay profile-only without a reliable key");
    },
  },
  {
    id: "corpus-nested-record-selection",
    run() {
      const value = readFixture("nested-api-response");
      const automatic = analyzeTrace(value);
      const selected = analyzeTrace(value, { recordSetPath: "$.audit" });
      assert.equal(automatic.shape.recordSetPath, "$.results");
      assert.equal(automatic.shape.recordSetCandidates.length, 2);
      assert.equal(selected.shape.recordSetPath, "$.audit");
      assert.equal(selected.shape.recordCount, 4);
    },
  },
  {
    id: "corpus-document-and-ambiguous-dates",
    run() {
      const config = analyzeTrace(parseWithFormat(readFixtureText("service-config", "yaml"), "yaml"));
      assert.equal(config.shape.rootKind, "document");
      assert.equal(config.shape.recordSetPath, null);
      const dates = analyzeTrace(parseWithFormat(readFixtureText("ambiguous-dates", "csv"), "csv"));
      assert.equal(dates.fields.find(field => field.label === "iso_date")?.role.id, "date");
      const ambiguous = dates.fields.find(field => field.label === "ambiguous_date");
      assert.equal(ambiguous?.role.id, "text");
      assert.equal(ambiguous?.temporalInference.applied, false);
    },
  },
  {
    id: "corpus-dirty-and-finite",
    run() {
      const dirty = analyzeTrace(parseWithFormat(readFixtureText("dirty-import", "csv"), "csv"));
      assert.ok(dirty.insights.some(insight => insight.kind === "mixed-types"));
      assert.ok(dirty.recordSet.duplicate.duplicateRecordCount >= 1);
      const constants = analyzeTrace(readFixture("constant-and-empty"));
      const serialized = JSON.stringify(constants);
      assert.ok(!serialized.includes("NaN") && !serialized.includes("Infinity"));
    },
  },
  {
    id: "corpus-schema-comparison",
    run() {
      const result = compareTrace(readFixture("compare-schema-a"), readFixture("compare-schema-b"), { matchByOrder: true });
      assert.equal(result.fields.filter(field => field.status === "added").length, 1);
      assert.equal(result.fields.filter(field => field.status === "removed").length, 1);
      assert.equal(result.fields.filter(field => field.status === "type-changed").length, 1);
    },
  },
  {
    id: "corpus-customer-and-category-long-tail",
    run() {
      const customers = analyzeTrace(parseWithFormat(readFixtureText("customer-export", "csv"), "csv"));
      assert.equal(customers.shape.recordCount, 1000);
      assert.equal(customers.fields.find(field => field.label === "customer_id")?.role.id, "identifier");
      assert.ok(customers.insights.some(insight => insight.kind === "mixed-types"));
      assert.ok(customers.insights.some(insight => insight.kind === "missingness"));
      assert.ok(customers.overviewInsightIds.length <= 6);
      const longTail = analyzeTrace(parseWithFormat(readFixtureText("category-long-tail", "csv"), "csv"));
      assert.equal(longTail.fields.find(field => field.label === "category")?.role.id, "category");
      assert.ok(!longTail.fields.some(field => field.role.id === "identifier"), "long-tail categories must not become identifiers");
    },
  },
  {
    id: "corpus-telemetry-and-large-sampling",
    run() {
      const telemetry = analyzeTrace(readFixture("telemetry-series"));
      assert.ok(telemetry.insights.some(insight => insight.kind === "temporal-gap"));
      assert.ok(telemetry.insights.some(insight => insight.kind === "unusual-numeric"));
      const large = analyzeTrace(parseWithFormat(readFixtureText("large-sampled", "csv"), "csv"));
      assert.equal(large.coverage.mode, "sampled");
      assert.equal(large.coverage.totalRecords, 60000);
      assert.equal(large.coverage.analyzedRecords, 20000);
      assert.ok(large.recordSet.sampleRecordRefs.some(index => index >= 59000), "committed large fixture sample must reach its planted tail");
      assert.ok(large.insights.every(insight => insight.message.includes("analyzed sample")));
    },
  },
  {
    id: "corpus-keyed-reorder-and-duplicate-guard",
    run() {
      const reordered = compareTrace(readFixture("compare-reordered-a"), readFixture("compare-reordered-b"));
      assert.deepEqual(reordered.rows.counts, { added: 0, removed: 0, changed: 0, unchanged: 30 });
      assert.equal(reordered.rows.orderChanged, true);
      const blocked = compareTrace(readFixture("compare-keyed-rows-a"), readFixture("compare-keyed-rows-b"), { keyPath: "$[*].id" });
      assert.equal(blocked.rows.status, "duplicate-keys");
      assert.ok(blocked.insights.some(insight => insight.kind === "duplicate-key"));
    },
  },
  {
    id: "corpus-distribution-and-missingness-drift",
    run() {
      const distribution = compareTrace(readFixture("compare-distribution-a"), readFixture("compare-distribution-b"));
      assert.ok(distribution.insights.some(insight => insight.kind === "numeric-distribution-change"));
      assert.ok(distribution.insights.some(insight => insight.kind === "category-change"));
      assert.equal(distribution.fields.find(field => field.label === "value")?.deltas.numeric.ks, 1);
      const missingness = compareTrace(readFixture("compare-missingness-a"), readFixture("compare-missingness-b"));
      assert.ok(missingness.insights.some(insight => insight.kind === "missingness-change"));
      assert.equal(missingness.fields.find(field => field.label === "note")?.deltas.presentRate, -0.2);
    },
  },
  {
    id: "corpus-numeric-tolerance",
    run() {
      const baseline = readFixture("compare-tolerance-a");
      const candidate = readFixture("compare-tolerance-b");
      const exact = compareTrace(baseline, candidate);
      const tolerant = compareTrace(baseline, candidate, { absoluteTolerance: 0.01 });
      assert.equal(exact.rows.counts.changed, 24);
      assert.equal(tolerant.rows.counts.changed, 0);
      assert.equal(tolerant.settings.absoluteTolerance, 0.01);
      assert.ok(serializeTraceReport(tolerant, { privacySafe: true }).includes('"absoluteTolerance": 0.01'));
    },
  },
  {
    id: "versioned-result-contract-schemas",
    run() {
      assert.equal(TRACE_ANALYSIS_RESULT_SCHEMA.properties.version.const, "trace-analysis/1");
      assert.equal(TRACE_COMPARISON_RESULT_SCHEMA.properties.version.const, "trace-comparison/1");
      assert.ok(TRACE_FIELD_PROFILE_SCHEMA.required.includes("completeness"));
      assert.ok(TRACE_INSIGHT_SCHEMA.required.includes("evidence"));
      const analysis = analyzeTrace([{ id: "R-1", value: 1 }, { id: "R-2", value: 2 }]);
      const comparison = compareTrace([{ id: "R-1", value: 1 }], [{ id: "R-1", value: 2 }]);
      assert.equal(analysis.version, TRACE_ANALYSIS_RESULT_SCHEMA.properties.version.const);
      assert.equal(comparison.version, TRACE_COMPARISON_RESULT_SCHEMA.properties.version.const);
      for (const key of TRACE_ANALYSIS_RESULT_SCHEMA.required) assert.ok(key in analysis, `analysis contract requires ${key}`);
      for (const key of TRACE_COMPARISON_RESULT_SCHEMA.required) assert.ok(key in comparison, `comparison contract requires ${key}`);
      for (const field of analysis.fields) {
        for (const key of TRACE_FIELD_PROFILE_SCHEMA.required) assert.ok(key in field, `field contract requires ${key}`);
      }
    },
  },
  {
    id: "comparison-compound-key",
    run() {
      const baseline = Array.from({ length: 24 }, (_, index) => ({ tenant: `T-${index % 3}`, id: `R-${Math.floor(index / 3)}`, value: index }));
      const candidate = baseline.map(row => row.tenant === "T-1" && row.id === "R-4" ? { ...row, value: 999 } : row).reverse();
      const single = compareTrace(baseline, candidate, { keyPath: "$[*].id" });
      assert.equal(single.rows.status, "duplicate-keys", "single repeated key must remain blocked");
      const compound = compareTrace(baseline, candidate, { keyPaths: ["$[*].tenant", "$[*].id"] });
      assert.equal(compound.rows.status, "ready");
      assert.deepEqual(compound.rows.counts, { added: 0, removed: 0, changed: 1, unchanged: 23 });
      assert.deepEqual(compound.rows.key.baselinePaths, ["$[*].tenant", "$[*].id"]);
      assert.equal(compound.rows.key.mode, "selected-compound");
      assert.deepEqual(compound.settings.keyPaths, ["$[*].tenant", "$[*].id"]);
    },
  },
];

for (const task of insightCases) {
  try {
    task.run();
    console.log(`PASS ${task.id}: insight engine`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${task.id}: ${error.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} Trace acceptance case${failed === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log(`\nAll ${TRACE_BENCHMARKS.length + visualCases.length + insightCases.length} Trace acceptance cases passed.`);
