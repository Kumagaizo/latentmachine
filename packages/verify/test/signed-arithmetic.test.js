import assert from "node:assert/strict";
import { transform, verify } from "../src/index.js";
import { generateJavaScriptTransform, generateJqQuery } from "../../../src/intelligence/json-transform/exporters.js";

function signedFixture(count = 40) {
  const original = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    amount_cents: (index % 2 ? -1 : 1) * (101 + index * 37),
    quantity: (index % 5) + 1,
    unit_price: 2.5 + (index % 7),
  }));
  const transformed = original.map(row => ({
    amount: row.amount_cents / 100,
    magnitude: Math.abs(row.amount_cents) / 100,
    isCredit: row.amount_cents < 0,
    isDebit: row.amount_cents > 0,
    product: row.quantity * row.unit_price,
  }));
  return { original, transformed };
}

{
  const fixture = signedFixture();
  const result = verify(fixture);
  const opByTarget = new Map(result.rule.program.ops.map(op => [op.target, op]));
  assert.equal(result.verdict, "consistent");
  assert.deepEqual(result.flaggedRows, [], "zero-drift signed canary must remain clean");
  assert.deepEqual(result.memorisation.memorisedTargets, []);
  assert.equal(opByTarget.get("$.amount")?.mode, "divide");
  assert.equal(opByTarget.get("$.magnitude")?.op, "numericTransform");
  assert.equal(opByTarget.get("$.magnitude")?.mode, "absolute");
  assert.equal(opByTarget.get("$.magnitude")?.value, 100);
  assert.equal(opByTarget.get("$.isCredit")?.op, "numericCompare");
  assert.equal(opByTarget.get("$.isCredit")?.comparison, "lessThan");
  assert.equal(opByTarget.get("$.isCredit")?.value, 0);
  assert.equal(opByTarget.get("$.isDebit")?.op, "numericCompare");
  assert.equal(opByTarget.get("$.isDebit")?.comparison, "greaterThan");
  assert.equal(opByTarget.get("$.product")?.op, "numericBinary", "exact two-field multiplication already has a reusable operator");
  assert.deepEqual(transform({ rule: result.rule, input: fixture.original }), fixture.transformed);

  const generatedSource = generateJavaScriptTransform({ rule: result.rule, status: result.ruleStatus });
  const generatedTransform = Function(`${generatedSource}; return transform;`)();
  assert.deepEqual(fixture.original.map(generatedTransform), fixture.transformed);
  const jq = generateJqQuery({ ops: [opByTarget.get("$.magnitude"), opByTarget.get("$.isCredit")] });
  assert.match(jq, /if \$number < 0/);
  assert.match(jq, /tonumber\) < 0/);
}

{
  const fixture = signedFixture();
  const magnitudeRow = 1;
  const creditRow = 3;
  const magnitudeBefore = JSON.stringify(fixture.transformed[magnitudeRow]);
  fixture.transformed[magnitudeRow].magnitude = fixture.original[magnitudeRow].amount_cents / 100;
  assert.notEqual(JSON.stringify(fixture.transformed[magnitudeRow]), magnitudeBefore, "magnitude drift must change the expected output");
  const creditBefore = JSON.stringify(fixture.transformed[creditRow]);
  fixture.transformed[creditRow].isCredit = !fixture.transformed[creditRow].isCredit;
  assert.notEqual(JSON.stringify(fixture.transformed[creditRow]), creditBefore, "credit drift must change the expected output");

  const result = verify(fixture);
  assert.equal(result.verdict, "inconsistent");
  assert.deepEqual(result.flaggedRows.map(row => row.index), [magnitudeRow, creditRow], "only injected signed-drift rows may be flagged");
  assert.ok(!result.memorisation.memorisedTargets.includes("$.magnitude"));
  assert.ok(!result.memorisation.memorisedTargets.includes("$.isCredit"));
}

{
  const original = Array.from({ length: 40 }, (_, index) => ({
    id: index + 1,
    amount_cents: (index % 2 ? -1 : 1) * (1001 + index * 29),
    fx_rate: 0.912345 + (index % 5) / 10000,
  }));
  const transformed = original.map(row => ({ converted: Math.round(row.amount_cents * row.fx_rate) / 100 }));
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "unverifiable", "rounded and scaled two-field products must not be mislabeled as exact multiplication");
  assert.deepEqual(result.flaggedRows, []);
  assert.ok(result.memorisation.memorisedTargets.includes("$.converted"));
}

console.log("signed-arithmetic.test.js passed");
