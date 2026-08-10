import assert from "node:assert/strict";
import { verify } from "../src/index.js";

function enumFixture(count) {
  const labels = ["Pending", "Paid", "Shipped"];
  const original = Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, code: index % labels.length }));
  const transformed = original.map(row => ({ id: row.id, status: labels[row.code] }));
  return { original, transformed };
}

function injectEnumDrift(fixture, indices) {
  for (const index of indices) {
    const before = JSON.stringify(fixture.transformed[index]);
    fixture.transformed[index].status = `Wrong-${index}`;
    assert.notEqual(JSON.stringify(fixture.transformed[index]), before, `row ${index} drift must change the expected output`);
  }
}

for (const count of [20, 40, 1000]) {
  const fixture = enumFixture(count);
  injectEnumDrift(fixture, [5]);
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
  assert.deepEqual(result.memorisation.nearFits, []);
}

{
  const fixture = enumFixture(40);
  injectEnumDrift(fixture, [2, 5, 8, 11]);
  const result = verify(fixture);
  assert.equal(result.verdict, "inconsistent", "consensus recovery must localise systematic drift below the old 95% cliff");
  assert.deepEqual(result.flaggedRows.map(row => row.index), [2, 5, 8, 11]);
  assert.deepEqual(result.memorisation.ruleDemotions, []);
  assert.deepEqual(result.memorisation.nearFits, []);
  assert.deepEqual(result.memorisation.memorisedTargets, []);
}

{
  const original = Array.from({ length: 40 }, (_, index) => ({ id: `row-${index}`, express: index % 3 === 0 }));
  const transformed = original.map(row => ({ id: row.id, isExpress: row.express }));
  const before = JSON.stringify(transformed[25]);
  transformed[25].isExpress = !transformed[25].isExpress;
  assert.notEqual(JSON.stringify(transformed[25]), before, "boolean-alias drift must change the expected output");
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
  assert.deepEqual(result.memorisation.nearFits, []);
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
  assert.deepEqual(result.memorisation.nearFits, []);
  assert.ok(result.memorisation.memorisedTargets.includes("$.opaqueLabel"));
}

{
  const driftRows = [100, 101, 102];
  const supportedRows = new Set([...Array.from({ length: 40 }, (_, index) => index), ...driftRows]);
  const labels = ["Bronze", "Silver", "Gold"];
  const original = Array.from({ length: 120 }, (_, index) => ({
    id: `row-${index}`,
    ...(supportedRows.has(index) ? { tier_code: index % labels.length } : {}),
  }));
  const transformed = original.map(row => ({
    id: row.id,
    ...(row.tier_code === undefined ? {} : { tier: labels[row.tier_code] }),
  }));
  for (const index of driftRows) {
    const before = JSON.stringify(transformed[index]);
    transformed[index].tier = `Wrong-${index}`;
    assert.notEqual(JSON.stringify(transformed[index]), before, `row ${index} drift must change the expected output`);
  }
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "unverifiable");
  assert.deepEqual(result.flaggedRows, [], "a near-fit must remain non-accusing");
  assert.deepEqual(result.nearFit, {
    target: "$.tier",
    candidate: "valueMap($.tier_code -> $.tier)",
    source: "$.tier_code",
    fitRatio: 0.9302,
    promotionThreshold: 0.95,
    reportingThreshold: 0.8,
    supportCount: 40,
    rowCount: 43,
    contradictingRows: driftRows,
    note: "A rule explained 93% of rows. 7% contradicted it, above the 5% exception limit for promoting a rule.",
  });
  assert.match(result.summary, /near-fit rule was retained as non-accusing evidence/i);
}

for (const [cleanRows, driftCount, promoted] of [
  [40, 1, true],
  [40, 2, true],
  [40, 3, true],
  [80, 3, true],
  [100, 5, true],
  [40, 10, true],
  [300, 10, true],
  [1000, 50, true],
  [1000, 90, true],
]) {
  const fixture = enumFixture(cleanRows + driftCount);
  const driftRows = Array.from({ length: driftCount }, (_, index) => cleanRows + index);
  injectEnumDrift(fixture, driftRows);
  const result = verify(fixture);
  if (promoted) {
    assert.equal(result.verdict, "inconsistent", `${driftCount}/${cleanRows + driftCount} exceptions should retain the rule`);
    assert.deepEqual(result.flaggedRows.map(row => row.index), driftRows, "only injected rows may be flagged");
    assert.deepEqual(result.memorisation.nearFits, []);
  } else {
    assert.equal(result.verdict, "unverifiable", `${driftCount}/${cleanRows + driftCount} exceptions should remain non-accusing`);
    assert.deepEqual(result.flaggedRows, []);
    assert.deepEqual(result.nearFit?.contradictingRows, driftRows);
    assert.equal(result.nearFit?.promotionThreshold, 0.95);
  }
}

{
  const labels = ["Pending", "Paid", "Shipped"];
  const original = Array.from({ length: 43 }, (_, index) => ({
    id: `row-${index}`,
    code: index % labels.length,
    correlated_code: index < 40 ? index % labels.length : (index + 1) % labels.length,
  }));
  const transformed = original.map(row => ({ status: labels[row.code] }));
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "consistent", "a weaker correlated near-fit must not hide an exact reusable rule");
  assert.deepEqual(result.flaggedRows, []);
  assert.equal(result.rule.program.ops.find(op => op.target === "$.status")?.source, "$.code");
  assert.deepEqual(result.memorisation.nearFits, []);
}

console.log("rule-demotion.test.js passed");
