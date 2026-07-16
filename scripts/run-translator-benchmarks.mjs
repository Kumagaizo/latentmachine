import { benchmarkTranslator } from "../src/intelligence/json-transform/translator-benchmarks.js";

const report = benchmarkTranslator();
const failed = report.results.filter(result => !result.passed);

const summary = {
  total: report.total,
  passed: report.passed,
  failed: report.failed,
  averageDurationMs: Math.round(report.telemetry.reduce((sum, item) => sum + (item.durationMs || 0), 0) / Math.max(1, report.telemetry.length)),
};

console.log(JSON.stringify(summary, null, 2));

if (failed.length) {
  console.error(failed.map(result => `- ${result.id}: ${result.failures.join("; ")}`).join("\n"));
  process.exit(1);
}
