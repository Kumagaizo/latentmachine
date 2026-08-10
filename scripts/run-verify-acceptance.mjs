import { inferVerifyRule } from "../src/intelligence/json-transform/verify-inference.js";
import { VERIFY_ACCEPTANCE_CASES } from "../src/intelligence/json-transform/verify-samples.js";

let failed = 0;

for (const sample of VERIFY_ACCEPTANCE_CASES) {
  const startedAt = performance.now();
  const result = inferVerifyRule(sample.original, sample.transformed);
  const elapsed = Math.round(performance.now() - startedAt);
  const flaggedRows = result.flagged.map(row => row.i + 1);
  const expectedRows = sample.expectedFlaggedRows || [];
  const expectedStatus = sample.expectedRuleStatus || "safe";
  const countPassed = result.flagged.length === sample.expectedFlagged;
  const rowsPassed = JSON.stringify(flaggedRows) === JSON.stringify(expectedRows);
  const statusPassed = result.result.status === expectedStatus;
  const verdictPassed = !sample.expectedVerdict || result.verdict === sample.expectedVerdict;
  const clustersPassed = !sample.expectedClusters
    || JSON.stringify(result.clusters.map(cluster => cluster.support)) === JSON.stringify(sample.expectedClusters);
  const passed = countPassed && rowsPassed && statusPassed && verdictPassed && clustersPassed;
  if (!passed) failed += 1;
  const details = flaggedRows.length ? ` rows ${flaggedRows.join(", ")}` : "";
  const expected = expectedRows.length ? ` expected rows ${expectedRows.join(", ")}` : "";
  const clusters = result.clusters.length ? `; clusters ${result.clusters.map(cluster => cluster.support).join("+")}` : "";
  console.log(`${passed ? "PASS" : "FAIL"} ${sample.label}: ${result.flagged.length} flagged${details}${expected}; status ${result.result.status}${clusters} (${elapsed}ms)`);
}

if (failed) {
  console.error(`\n${failed} Verify acceptance case${failed === 1 ? "" : "s"} failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${VERIFY_ACCEPTANCE_CASES.length} Verify acceptance cases passed.`);
}
