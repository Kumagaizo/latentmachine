import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { verify } from "../src/index.js";

function inject(fixture, row, mutate) {
  const before = JSON.stringify(fixture.transformed[row]);
  mutate(fixture.transformed[row], fixture.original[row]);
  const after = JSON.stringify(fixture.transformed[row]);
  if (after === before) {
    throw new Error(`no-op drift injection at row ${row}: mutation did not change output`);
  }
}

function assertExact(result, expectedRows, message = "flagged rows must equal the injected rows") {
  const expected = [...expectedRows].sort((left, right) => left - right);
  const actual = result.flaggedRows.map(row => row.index).sort((left, right) => left - right);
  for (const row of expected) assert.ok(actual.includes(row), `${message}: missing row ${row}`);
  assert.equal(actual.length, expected.length, `${message}: unexpected collateral rows`);
  assert.deepEqual(actual, expected, message);
}

function nameFixture(count, alternateRows = [], seed = 0) {
  const alternate = new Set(alternateRows);
  const original = Array.from({ length: count }, (_, index) => ({
    first: `First${seed}-${index}`,
    last: `Last${(index * 7919 + seed * 104729) % 999983}`,
  }));
  return {
    original,
    transformed: original.map((row, index) => ({
      name: alternate.has(index) ? `${row.last}, ${row.first}` : `${row.first} ${row.last}`,
    })),
  };
}

function spacedRows(total, count, seed = 0) {
  const rows = [];
  let cursor = (seed * 17 + 3) % total;
  while (rows.length < count) {
    if (!rows.includes(cursor)) rows.push(cursor);
    cursor = (cursor + 37) % total;
  }
  return rows.sort((left, right) => left - right);
}

function numberFixture(count) {
  const original = Array.from({ length: count }, (_, index) => ({ cents: 100035 + index * 7919 }));
  return { original, transformed: original.map(row => ({ amount: row.cents / 100 })) };
}

function arrayFixture(count) {
  const original = Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    items: Array.from({ length: index % 5 }, (_, item) => `item-${index}-${item}`),
  }));
  return {
    original,
    transformed: original.map(row => ({ id: row.id, items: row.items, itemCount: row.items.length })),
  };
}

function constantArrayFixture(count) {
  const original = Array.from({ length: count }, (_, index) => ({ id: `row-${index}` }));
  return {
    original,
    transformed: original.map(row => ({ id: row.id, columns: ["name", "email", "status"] })),
  };
}

for (const count of [30, 60, 90, 150]) {
  const injectedRow = Math.floor(count * 0.61);

  const number = numberFixture(count);
  inject(number, injectedRow, row => { row.amount = String(row.amount); });
  assertExact(verify(number), [injectedRow], `number-as-string n=${count}`);

  const emptyArray = arrayFixture(count);
  const emptyRow = Array.from({ length: count }, (_, index) => index).find(index => emptyArray.original[index].items.length === 0 && index > 5);
  inject(emptyArray, emptyRow, row => { row.items = null; });
  assertExact(verify(emptyArray), [emptyRow], `empty-array-to-null n=${count}`);

  const reordered = constantArrayFixture(count);
  inject(reordered, injectedRow, row => { row.columns = [...row.columns].reverse(); });
  assertExact(verify(reordered), [injectedRow], `array-reordered n=${count}`);
}

for (const count of [30, 60, 150]) {
  const injectedRow = Math.floor(count * 0.61);
  const original = Array.from({ length: count }, (_, index) => ({
    firstAmount: 100035 + index * 7919,
    secondAmount: 300017 + index * 3571,
  }));
  const fixture = {
    original,
    transformed: original.map(row => ({
      firstTotal: row.firstAmount / 100,
      secondTotal: row.secondAmount / 100,
    })),
  };
  inject(fixture, injectedRow, row => {
    row.firstTotal = String(row.firstTotal);
    row.secondTotal = String(row.secondTotal);
  });
  const result = verify(fixture);
  assert.equal(result.verdict, "inconsistent", `multi-target recovery n=${count}`);
  assertExact(result, [injectedRow], `multi-target recovery n=${count}`);
}

{
  const original = Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}` }));
  const transformed = original.map((_, index) => ({
    first: `Private-${index * 7919}`,
    second: `Opaque-${index * 3571}`,
  }));
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "unverifiable", "multi-target opaque lookups must remain unverifiable");
  assert.deepEqual(result.flaggedRows, []);
}

{
  const original = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, name: `Customer ${index + 1}` }));
  const transformed = original.map(row => ({ customerId: row.id, name: row.name }));
  [transformed[3], transformed[4]] = [transformed[4], transformed[3]];
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "unverifiable", "a row permutation must not be reported as independent field defects");
  assert.deepEqual(result.flaggedRows, []);
}

for (let seed = 0; seed < 10; seed += 1) {
  for (const defectCount of [1, 2, 3, 5, 6, 8, 10, 30]) {
    const injectedRows = spacedRows(100, defectCount, seed);
    const fixture = nameFixture(100, [], seed);
    for (const row of injectedRows) {
      inject(fixture, row, (output, input) => { output.name = `${input.last}, ${input.first}`; });
    }
    const result = verify(fixture);
    assert.equal(result.verdict, "inconsistent", `density ${defectCount}/100 seed ${seed}`);
    assertExact(result, injectedRows, `density ${defectCount}/100 seed ${seed}`);
  }
}

for (const share of [0.15, 0.35, 0.5]) {
  const alternateRows = spacedRows(200, Math.round(200 * share), 11);
  const result = verify(nameFixture(200, alternateRows, 11));
  assert.deepEqual(result.clusters.map(cluster => cluster.support), [200 - alternateRows.length, alternateRows.length]);
  assert.deepEqual(result.clusters.map(cluster => cluster.label), ["Rule 1", "Rule 2"]);
  assert.notEqual(result.clusters[0].signature, result.clusters[1].signature, "cluster signatures must distinguish source order");
  assert.ok(result.clusters.every(cluster => !JSON.stringify(cluster).includes("First11")), "cluster metadata must not expose row values");
  assert.ok(result.flaggedRows.length < 200, `${share * 100}% split must not flag the whole batch`);
  if (share === 0.5) {
    assert.equal(result.verdict, "unverifiable");
    assert.deepEqual(result.flaggedRows, []);
  } else {
    assert.equal(result.verdict, "inconsistent");
    assertExact(result, alternateRows, `${share * 100}% minority cluster`);
  }
}

{
  const count = 300;
  const carrierRows = Array.from({ length: 25 }, (_, index) => count - 25 + index);
  const original = Array.from({ length: count }, (_, index) => ({
    first: `First${index}`,
    last: `Last${index}`,
    ...(carrierRows.includes(index) ? { middle: `Middle${index}` } : {}),
  }));
  const fixture = {
    original,
    transformed: original.map(row => ({
      name: row.middle ? `${row.first} ${row.middle} ${row.last}` : `${row.first} ${row.last}`,
    })),
  };
  const injectedRows = [281, 294];
  for (const row of injectedRows) {
    inject(fixture, row, (output, input) => { output.name = `${input.first} ${input.last}`; });
  }
  const result = verify(fixture);
  assert.equal(result.verdict, "inconsistent");
  assert.ok(result.flaggedRows.length <= carrierRows.length, "sparse optional drift must stay within its carrier domain");
  assert.ok(result.clusters.some(cluster => cluster.support >= carrierRows.length - injectedRows.length));
}

for (const [name, base, mutate] of [
  ["NBSP", "Ada Lovelace", value => value.replace(" ", "\u00a0")],
  ["zero-width space", "Ada Lovelace", value => `${value.slice(0, 3)}\u200b${value.slice(3)}`],
  ["NFC/NFD", "José Alvarez", value => value.normalize("NFD")],
  ["Cyrillic homoglyph", "Ada Lovelace", value => value.replace("a", "\u0430")],
  ["trailing space", "Ada Lovelace", value => `${value} `],
]) {
  const original = Array.from({ length: 120 }, (_, index) => ({ value: `${base} ${index}` }));
  const fixture = { original, transformed: original.map(row => ({ value: row.value })) };
  inject(fixture, 42, row => { row.value = mutate(row.value); });
  assertExact(verify(fixture), [42], name);
}

for (const count of [100, 400, 5000]) {
  const result = verify(nameFixture(count));
  assert.equal(result.verdict, "consistent", `clean n=${count}`);
  assert.deepEqual(result.flaggedRows, [], `clean n=${count}`);
  assert.deepEqual(result.clusters.map(cluster => cluster.support), [count], `clean n=${count}`);
}

{
  const injectedRows = spacedRows(5000, 2, 19);
  const fixture = nameFixture(5000, [], 19);
  for (const row of injectedRows) inject(fixture, row, (output, input) => { output.name = `${input.last}, ${input.first}`; });
  const started = performance.now();
  const result = verify(fixture);
  const durationMs = performance.now() - started;
  assertExact(result, injectedRows, "5000-row scale case");
  assert.ok(durationMs < 1000, `5000-row consensus verification took ${durationMs.toFixed(1)}ms`);
}

{
  const injectedRows = spacedRows(300, 24, 23);
  const fixture = nameFixture(300, [], 23);
  for (const row of injectedRows) inject(fixture, row, (output, input) => { output.name = `${input.last}, ${input.first}`; });
  const started = performance.now();
  const result = verify(fixture);
  const durationMs = performance.now() - started;
  assertExact(result, injectedRows, "300-row 8% drift case");
  assert.ok(durationMs < 500, `300-row 8% consensus verification took ${durationMs.toFixed(1)}ms`);
}

console.log("consensus-refit.test.js passed");
