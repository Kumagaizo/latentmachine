import { benchmarkJsonTransform } from "../src/intelligence/json-transform/index.js";

const report = benchmarkJsonTransform({ seed: "golden-json-transform" });
const failed = [];

if (report.passed !== report.total) {
  failed.push(`Passed ${report.passed}/${report.total}; expected all Rule Foundry benchmarks to pass.`);
}

for (const row of report.results.filter(r => r.assertionFailures?.length)) {
  const failures = row.assertionFailures.map(f => `${f.type}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`).join("; ");
  failed.push(`${row.id}: benchmark assertion failed (${failures}).`);
}

const summary = {
  total: report.total,
  solved: report.solved,
  passed: report.passed,
  failed: report.failed,
  assertionFailed: report.assertionFailed,
  averageDurationMs: Math.round(report.telemetry.reduce((sum, t) => sum + (t.durationMs || 0), 0) / Math.max(1, report.telemetry.length)),
};

console.log(JSON.stringify(summary, null, 2));

if (failed.length) {
  console.error(failed.map(f => `- ${f}`).join("\n"));
  process.exit(1);
}
