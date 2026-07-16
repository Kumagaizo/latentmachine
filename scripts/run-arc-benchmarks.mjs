import { ARC_GOLDEN, benchmarkArcTool } from "../src/intelligence/arc/index.js";

const report = benchmarkArcTool({ budgetMs: 2500, seed: "golden" });
const failed = [];

if (report.solved < ARC_GOLDEN.minSolved) {
  failed.push(`Solved ${report.solved}/${report.total}, expected at least ${ARC_GOLDEN.minSolved}.`);
}

if ((report.assertionFailed || []).length) {
  for (const row of report.results.filter(r => r.assertionFailures?.length)) {
    const failures = row.assertionFailures.map(f => `${f.type}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`).join("; ");
    failed.push(`${row.id}: benchmark assertion failed (${failures}).`);
  }
}

const actualFailures = [...report.failed].sort();
const expectedFailures = [...ARC_GOLDEN.expectedFailures].sort();
if (actualFailures.join(",") !== expectedFailures.join(",")) {
  failed.push(`Failure set changed. Expected [${expectedFailures.join(", ")}], got [${actualFailures.join(", ")}].`);
}

for (const [id, golden] of Object.entries(ARC_GOLDEN.tasks)) {
  const row = report.results.find(r => r.id === id);
  if (!row) {
    failed.push(`Missing golden task ${id}.`);
    continue;
  }
  if (golden.method && row.method !== golden.method) failed.push(`${id}: expected method ${golden.method}, got ${row.method}.`);
  if (golden.explanationIncludes && !row.explanation?.includes(golden.explanationIncludes)) failed.push(`${id}: explanation does not include "${golden.explanationIncludes}".`);
  if (golden.expectedTestSurp === 0 && !row.exact) failed.push(`${id}: expected exact test prediction.`);
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
