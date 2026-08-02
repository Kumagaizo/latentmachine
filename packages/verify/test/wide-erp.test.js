import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { transform, verify } from "../src/index.js";
import { generateJavaScriptTransform, generateJqQuery } from "../../../src/intelligence/json-transform/exporters.js";
import { roundNumericFormulaValue } from "../../../src/intelligence/json-transform/operations.js";

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

assert.equal(roundNumericFormulaValue(-1.5, "half-up"), -1);
assert.equal(roundNumericFormulaValue(-1.5, "half-even"), -2);
assert.equal(roundNumericFormulaValue(2.5, "half-even"), 2);
assert.equal(roundNumericFormulaValue(3.5, "half-even"), 4);
assert.equal(roundNumericFormulaValue(-1.5, "half-away"), -2);

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

function injectDrift(fixture, index, label, mutate) {
  const before = JSON.stringify(fixture.transformed[index]);
  mutate(fixture.original[index], fixture.transformed[index]);
  assert.notEqual(JSON.stringify(fixture.transformed[index]), before, `${label} mutation must change the expected output`);
}

function percentageFixture(roundValue, count = 40) {
  const original = Array.from({ length: count }, (_, index) => ({
    net_cents: index === 7 ? 216650 : 10001 + index * 173,
    tax_rate_pct: index === 7 ? 19 : [5, 7, 19][index % 3],
  }));
  const transformed = original.map(row => ({
    grossAmount: roundValue(row.net_cents * (100 + row.tax_rate_pct) / 100) / 100,
  }));
  return { original, transformed };
}

{
  const fixture = erpFixture(40);
  const result = verify(fixture);
  const opByTarget = new Map(result.rule.program.ops.map(op => [op.target, op.op]));
  assert.equal(result.flaggedRows.length, 0);
  assert.equal(opByTarget.get("$.totalQty"), "arraySum");
  assert.equal(opByTarget.get("$.grossAmount"), "numericFormula");
  assert.equal(opByTarget.get("$.primaryEmail"), "arrayIndex");
  assert.equal(opByTarget.get("$.orderRef"), "stringReplace");
  const grossFormula = result.rule.program.ops.find(op => op.target === "$.grossAmount");
  assert.ok(grossFormula.rounding, "numericFormula must expose its rounding semantics");
  assert.ok(grossFormula.evaluationOrder, "numericFormula must expose its arithmetic association");
  assert.ok(result.memorisation.memorisedTargets.length <= 1, result.summary);
  for (const target of ["$.orderRef", "$.totalQty", "$.grossAmount", "$.primaryEmail"]) {
    assert.ok(!result.memorisation.memorisedTargets.includes(target), `${target} must use a reusable rule`);
  }
  assert.deepEqual(transform({ rule: result.rule, input: fixture.original.slice(0, 3) }), fixture.transformed.slice(0, 3));
  const generatedSource = generateJavaScriptTransform({ rule: result.rule, status: result.ruleStatus });
  const generatedTransform = Function(`${generatedSource}; return transform;`)();
  assert.deepEqual(fixture.original.slice(0, 3).map(generatedTransform), fixture.transformed.slice(0, 3));
  const reusableOps = result.rule.program.ops.filter(op => ["$.orderRef", "$.totalQty", "$.grossAmount", "$.primaryEmail"].includes(op.target));
  assert.match(generateJqQuery({ ops: reusableOps }), /add|floor|split/);
}

{
  const fixture = percentageFixture(Math.round);
  const tieRaw = fixture.original[7].net_cents * (100 + fixture.original[7].tax_rate_pct) / 100;
  assert.equal(tieRaw % 1, 0.5, "fixture must contain an exact positive half tie");
  const result = verify(fixture);
  const formula = result.rule.program.ops.find(op => op.target === "$.grossAmount");
  assert.equal(result.verdict, "consistent");
  assert.equal(result.flaggedRows.length, 0);
  assert.equal(formula.op, "numericFormula");
  assert.equal(formula.rounding, "half-up");
  assert.equal(formula.evaluationOrder, "integer-rate");
  assert.deepEqual(transform({ rule: result.rule, input: fixture.original }), fixture.transformed);
  const generatedSource = generateJavaScriptTransform({ rule: result.rule, status: result.ruleStatus });
  const generatedTransform = Function(`${generatedSource}; return transform;`)();
  assert.deepEqual(fixture.original.map(generatedTransform), fixture.transformed);
}

{
  const fixture = percentageFixture(Math.floor);
  const clean = verify(fixture);
  const cleanFormula = clean.rule.program.ops.find(op => op.target === "$.grossAmount");
  assert.equal(clean.verdict, "consistent");
  assert.equal(cleanFormula.rounding, "floor");
  const cleanGeneratedSource = generateJavaScriptTransform({ rule: clean.rule, status: clean.ruleStatus });
  const cleanGeneratedTransform = Function(`${cleanGeneratedSource}; return transform;`)();
  assert.deepEqual(fixture.original.map(cleanGeneratedTransform), fixture.transformed);
  assert.match(generateJqQuery(clean.rule.program), /floor/);
  const driftRow = fixture.original.findIndex((row, index) => (
    Math.round(row.net_cents * (100 + row.tax_rate_pct) / 100)
    !== Math.floor(row.net_cents * (100 + row.tax_rate_pct) / 100)
    && index > 7
  ));
  injectDrift(fixture, driftRow, "round-instead-of-floor", (original, output) => {
    output.grossAmount = Math.round(original.net_cents * (100 + original.tax_rate_pct) / 100) / 100;
  });
  const drifted = verify(fixture);
  assert.equal(drifted.verdict, "inconsistent");
  assert.deepEqual(drifted.flaggedRows.map(row => row.index), [driftRow]);
}

{
  const original = Array.from({ length: 40 }, (_, index) => ({
    net_cents: index === 9 ? -3 : -201 - index * 17,
    tax_rate_pct: index === 9 ? -50 : [-10, 5, 20][index % 3],
  }));
  const transformed = original.map(row => ({
    grossAmount: Math.round(row.net_cents * (100 + row.tax_rate_pct) / 100) / 100,
  }));
  assert.equal(original[9].net_cents * (100 + original[9].tax_rate_pct) / 100, -1.5);
  const result = verify({ original, transformed });
  const formula = result.rule.program.ops.find(op => op.target === "$.grossAmount");
  assert.equal(result.verdict, "consistent");
  assert.equal(result.flaggedRows.length, 0);
  assert.equal(formula.rounding, "half-up", "negative ties must preserve JavaScript Math.round semantics");
  assert.deepEqual(transform({ rule: result.rule, input: original }), transformed);
  const generatedSource = generateJavaScriptTransform({ rule: result.rule, status: result.ruleStatus });
  const generatedTransform = Function(`${generatedSource}; return transform;`)();
  assert.deepEqual(original.map(generatedTransform), transformed);
}

{
  const fixture = erpFixture(1000);
  const aggregationRow = 300;
  const indexRow = 500;
  const compoundRow = 700;
  const replacementRow = 850;
  const roundingRow = fixture.original.findIndex((row, index) => {
    if (index <= compoundRow) return false;
    const raw = (row.net_cents / 100) * (1 + row.tax_rate_pct / 100);
    return Math.floor(raw * 100) / 100 !== roundCurrency(raw);
  });
  injectDrift(fixture, aggregationRow, "aggregation", (original, output) => { output.totalQty -= original.lines[0].quantity; });
  injectDrift(fixture, indexRow, "array-index", (original, output) => { output.primaryEmail = original.contacts.at(-1); });
  injectDrift(fixture, compoundRow, "compound", (original, output) => {
    output.grossAmount = roundCurrency(output.grossAmount * (1 + original.tax_rate_pct / 100));
  });
  injectDrift(fixture, roundingRow, "rounding", (original, output) => {
    const raw = (original.net_cents / 100) * (1 + original.tax_rate_pct / 100);
    output.grossAmount = Math.floor(raw * 100) / 100;
  });
  injectDrift(fixture, replacementRow, "global-replacement", (original, output) => {
    output.orderRef = original.order_ref.replace("-", "");
  });
  const result = verify(fixture);
  assert.equal(result.verdict, "inconsistent");
  assert.deepEqual(result.flaggedRows.map(row => row.index), [aggregationRow, indexRow, compoundRow, roundingRow, replacementRow]);
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
  assert.ok(wide.result.memorisation.memorisedTargets.length <= 1, wide.result.summary);
  assert.ok(wide.durationMs < 10_000, `2,000-row wide verification took ${wide.durationMs.toFixed(1)}ms`);
  assert.ok(wide.durationMs <= medium.durationMs * 5 + 250, `500→2,000 rows scaled from ${medium.durationMs.toFixed(1)}ms to ${wide.durationMs.toFixed(1)}ms`);
  performanceEvidence = { medium, wide };
}

console.log(`wide-erp.test.js passed (500 rows ${performanceEvidence.medium.durationMs.toFixed(1)}ms; 2,000 rows ${performanceEvidence.wide.durationMs.toFixed(1)}ms; 500-row payload ${performanceEvidence.medium.inputCharacters}/${performanceEvidence.medium.outputCharacters} chars)`);
