import { benchmarkSignal } from "../src/intelligence/signal/contract.js";

const report = benchmarkSignal({ seed: "golden-signal" });
const failed = [];

if (report.passed !== report.total) {
  failed.push(`Passed ${report.passed}/${report.total}; expected all Signal benchmarks to pass.`);
}

for (const row of report.results.filter(result => result.assertionFailures?.length)) {
  const failures = row.assertionFailures.map(failure => `${failure.type}: expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.actual)}`).join("; ");
  failed.push(`${row.id}: benchmark assertion failed (${failures}).`);
}

console.log(JSON.stringify({
  total: report.total,
  solved: report.solved,
  passed: report.passed,
  failed: report.failed,
  assertionFailed: report.assertionFailed,
  averageDurationMs: Math.round(report.results.reduce((sum, row) => sum + (row.telemetry?.durationMs || 0), 0) / Math.max(1, report.results.length)),
}, null, 2));

if (failed.length) {
  console.error(failed.map(failure => `- ${failure}`).join("\n"));
  process.exit(1);
}
