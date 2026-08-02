import assert from "node:assert/strict";
import { verify } from "../src/index.js";

function enumFixture(count) {
  const labels = ["Pending", "Paid", "Shipped"];
  const original = Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, code: index % labels.length }));
  const transformed = original.map(row => ({ id: row.id, status: labels[row.code] }));
  return { original, transformed };
}

for (const count of [20, 40, 1000]) {
  const fixture = enumFixture(count);
  fixture.transformed[5].status = "Wrong";
  const result = verify(fixture);
  assert.equal(result.verdict, "inconsistent");
  assert.deepEqual(result.flaggedRows.map(row => row.index), [5]);
  assert.deepEqual(result.memorisation.memorisedTargets, []);
  assert.deepEqual(result.memorisation.ruleDemotions, [{
    target: "$.status",
    demotedFrom: "valueMap",
    source: "$.code",
    contradictingRows: [5],
    ruleFitRatio: Number(((count - 1) / count).toFixed(4)),
    supportCount: count - 1,
    rowCount: count,
  }]);
}

{
  const fixture = enumFixture(40);
  const result = verify(fixture);
  assert.equal(result.verdict, "consistent");
  assert.deepEqual(result.flaggedRows, []);
  assert.deepEqual(result.memorisation.ruleDemotions, []);
}

{
  const fixture = enumFixture(40);
  for (const index of [2, 5, 8, 11]) fixture.transformed[index].status = `Wrong-${index}`;
  const result = verify(fixture);
  assert.equal(result.verdict, "unverifiable", "a rule below 95% support must not accuse individual rows");
  assert.deepEqual(result.flaggedRows, []);
  assert.deepEqual(result.memorisation.ruleDemotions, []);
  assert.ok(result.memorisation.memorisedTargets.includes("$.status"));
}

{
  const original = Array.from({ length: 40 }, (_, index) => ({ id: `row-${index}`, express: index % 3 === 0 }));
  const transformed = original.map(row => ({ id: row.id, isExpress: row.express }));
  transformed[25].isExpress = !transformed[25].isExpress;
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "inconsistent");
  assert.deepEqual(result.flaggedRows.map(row => row.index), [25]);
  assert.equal(result.rule.program.ops.find(op => op.target === "$.isExpress")?.op, "set");
}

{
  const original = Array.from({ length: 40 }, (_, index) => ({ id: `row-${index}` }));
  const transformed = original.map((_, index) => ({ opaqueLabel: `Private-${index}` }));
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "unverifiable");
  assert.deepEqual(result.flaggedRows, []);
  assert.deepEqual(result.memorisation.ruleDemotions, []);
  assert.ok(result.memorisation.memorisedTargets.includes("$.opaqueLabel"));
}

{
  const original = Array.from({ length: 40 }, (_, index) => ({ lookupKey: index < 3 ? "shared" : `key-${index}` }));
  const transformed = original.map((row, index) => ({
    opaqueLabel: row.lookupKey === "shared" ? (index === 2 ? "Wrong" : "Stable") : `Private-${index}`,
  }));
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "unverifiable", "a dominant high-cardinality lookup is still not a reusable rule");
  assert.deepEqual(result.flaggedRows, []);
  assert.deepEqual(result.memorisation.ruleDemotions, []);
  assert.ok(result.memorisation.memorisedTargets.includes("$.opaqueLabel"));
}

console.log("rule-demotion.test.js passed");
