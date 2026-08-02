import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { transform, verify } from "../src/index.js";
import { generateJavaScriptTransform, generateJqQuery } from "../../../src/intelligence/json-transform/exporters.js";

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function transformedOrder(row) {
  return {
    orderId: row.order_id,
    orderRef: row.order_ref.replaceAll("-", ""),
    email: row.customer.email,
    primaryEmail: row.contacts[0],
    totalQty: row.lines.reduce((sum, line) => sum + line.quantity, 0),
    lineCount: row.lines.length,
    netAmount: row.net_cents / 100,
    grossAmount: roundCurrency((row.net_cents / 100) * (1 + row.tax_rate_pct / 100)),
    createdDate: row.created_at.slice(0, 10),
    createdHour: Number(row.created_at.slice(11, 13)),
    isExpress: row.is_express,
    status: row.status.toUpperCase(),
    active: !row.cancelled,
    region: row.region,
    tagCount: row.tags.length,
    notes: row.notes.trim(),
  };
}

function erpFixture(count) {
  const original = Array.from({ length: count }, (_, index) => {
    const lineCount = (index % 4) + 2;
    return {
      order_id: `order_${100000 + index}`,
      order_ref: `REF-${((index * 7919) % 99991).toString(36).padStart(4, "0")}-${((index * 3571) % 46633).toString(36)}`,
      customer: { email: `buyer${index}@example.com` },
      contacts: [`primary${index}@example.com`, `backup${index}@example.net`],
      lines: Array.from({ length: lineCount }, (_, item) => ({
        sku: `SKU-${index}-${item}`,
        quantity: ((index + item * 3) % 5) + 1,
        unit_cents: 500 + ((index * 97 + item * 211) % 9000),
      })),
      net_cents: 10035 + ((index * 7919) % 490000),
      tax_rate_pct: [5, 7, 19][index % 3],
      created_at: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:15:00.000Z`,
      is_express: index % 3 === 0,
      status: ["pending", "paid", "shipped", "cancelled"][index % 4],
      cancelled: index % 4 === 3,
      region: ["eu", "us", "apac"][index % 3],
      tags: Array.from({ length: (index % 3) + 1 }, (_, tag) => `tag-${tag}`),
      notes: `  warehouse order ${index}  `,
    };
  });
  return { original, transformed: original.map(transformedOrder) };
}

{
  const fixture = erpFixture(40);
  const result = verify(fixture);
  const opByTarget = new Map(result.rule.program.ops.map(op => [op.target, op.op]));
  assert.equal(result.flaggedRows.length, 0);
  assert.equal(opByTarget.get("$.totalQty"), "arraySum");
  assert.equal(opByTarget.get("$.grossAmount"), "numericFormula");
  assert.equal(opByTarget.get("$.primaryEmail"), "arrayIndex");
  assert.ok(result.memorisation.memorisedTargets.length <= 2, result.summary);
  for (const target of ["$.totalQty", "$.grossAmount", "$.primaryEmail"]) {
    assert.ok(!result.memorisation.memorisedTargets.includes(target), `${target} must use a reusable rule`);
  }
  assert.deepEqual(transform({ rule: result.rule, input: fixture.original.slice(0, 3) }), fixture.transformed.slice(0, 3));
  const generatedSource = generateJavaScriptTransform({ rule: result.rule, status: result.ruleStatus });
  const generatedTransform = Function(`${generatedSource}; return transform;`)();
  assert.deepEqual(fixture.original.slice(0, 3).map(generatedTransform), fixture.transformed.slice(0, 3));
  const reusableOps = result.rule.program.ops.filter(op => ["$.totalQty", "$.grossAmount", "$.primaryEmail"].includes(op.target));
  assert.match(generateJqQuery({ ops: reusableOps }), /add|round/);
}

{
  const fixture = erpFixture(1000);
  const aggregationRow = 300;
  const indexRow = 500;
  const compoundRow = 700;
  const roundingRow = fixture.original.findIndex((row, index) => {
    if (index <= compoundRow) return false;
    const raw = (row.net_cents / 100) * (1 + row.tax_rate_pct / 100);
    return Math.floor(raw * 100) / 100 !== roundCurrency(raw);
  });
  const aggregationTruth = transformedOrder(fixture.original[aggregationRow]);
  const indexTruth = transformedOrder(fixture.original[indexRow]);
  const compoundTruth = transformedOrder(fixture.original[compoundRow]);
  const roundingTruth = transformedOrder(fixture.original[roundingRow]);
  fixture.transformed[aggregationRow].totalQty -= fixture.original[aggregationRow].lines[0].quantity;
  fixture.transformed[indexRow].primaryEmail = fixture.original[indexRow].contacts.at(-1);
  fixture.transformed[compoundRow].grossAmount = roundCurrency(
    compoundTruth.grossAmount * (1 + fixture.original[compoundRow].tax_rate_pct / 100),
  );
  const rawRoundingAmount = (fixture.original[roundingRow].net_cents / 100) * (1 + fixture.original[roundingRow].tax_rate_pct / 100);
  fixture.transformed[roundingRow].grossAmount = Math.floor(rawRoundingAmount * 100) / 100;
  assert.notEqual(fixture.transformed[aggregationRow].totalQty, aggregationTruth.totalQty, "aggregation mutation must change the expected value");
  assert.notEqual(fixture.transformed[indexRow].primaryEmail, indexTruth.primaryEmail, "array-index mutation must change the expected value");
  assert.notEqual(fixture.transformed[compoundRow].grossAmount, compoundTruth.grossAmount, "compound mutation must change the expected value");
  assert.notEqual(fixture.transformed[roundingRow].grossAmount, roundingTruth.grossAmount, "rounding mutation must change the expected value");
  const result = verify(fixture);
  assert.equal(result.verdict, "inconsistent");
  assert.deepEqual(result.flaggedRows.map(row => row.index), [aggregationRow, indexRow, compoundRow, roundingRow]);
}

{
  const original = Array.from({ length: 1000 }, (_, index) => ({
    id: index + 1,
    category: index === 301 ? "rare" : "standard",
  }));
  const transformed = original.map(row => ({
    id: row.id,
    label: row.category === "rare" ? "Needs review" : "Ready",
  }));
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "consistent", "bounded inference must retain rare low-cardinality output variants");
  assert.equal(result.flaggedRows.length, 0);
}

{
  const original = Array.from({ length: 1000 }, (_, index) => ({ lookupKey: `key-${Math.floor(index / 2)}` }));
  const transformed = original.map(row => ({ opaqueLabel: `Label for ${row.lookupKey}` }));
  transformed[401].opaqueLabel = "Conflicting label";
  const result = verify({ original, transformed });
  const lookup = result.memorisation.lookups.find(item => item.target === "$.opaqueLabel");
  assert.equal(result.verdict, "unverifiable");
  assert.equal(result.flaggedRows.length, 0, "unverifiable lookup conflicts must remain diagnostic rather than row accusations");
  assert.equal(lookup?.conflictingSourceValues, 1);
  assert.match(result.summary, /1 repeated source value had conflicting outputs/i);
}

function timedVerify(count) {
  const fixture = erpFixture(count);
  const started = performance.now();
  const result = verify(fixture);
  return {
    durationMs: performance.now() - started,
    inputCharacters: JSON.stringify(fixture.original).length,
    outputCharacters: JSON.stringify(fixture.transformed).length,
    result,
  };
}

let performanceEvidence;
{
  const medium = timedVerify(500);
  const wide = timedVerify(2000);
  assert.equal(medium.result.flaggedRows.length, 0);
  assert.equal(wide.result.flaggedRows.length, 0);
  assert.deepEqual(wide.result.inference, {
    strategy: "bounded-output-aware",
    maximumEvidenceRows: 200,
    sampled: true,
    validationRows: 2000,
  });
  assert.ok(wide.result.memorisation.memorisedTargets.length <= 2, wide.result.summary);
  assert.ok(wide.durationMs < 10_000, `2,000-row wide verification took ${wide.durationMs.toFixed(1)}ms`);
  assert.ok(wide.durationMs <= medium.durationMs * 5 + 250, `500→2,000 rows scaled from ${medium.durationMs.toFixed(1)}ms to ${wide.durationMs.toFixed(1)}ms`);
  performanceEvidence = { medium, wide };
}

console.log(`wide-erp.test.js passed (500 rows ${performanceEvidence.medium.durationMs.toFixed(1)}ms; 2,000 rows ${performanceEvidence.wide.durationMs.toFixed(1)}ms; 500-row payload ${performanceEvidence.medium.inputCharacters}/${performanceEvidence.medium.outputCharacters} chars)`);
