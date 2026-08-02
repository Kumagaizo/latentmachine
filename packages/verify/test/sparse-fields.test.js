import assert from "node:assert/strict";
import { infer, transform, verify } from "../src/index.js";
import { generateJavaScriptTransform } from "../../../src/intelligence/json-transform/exporters.js";

function sparseFixture(present, count = 40) {
  const firstPresent = count - present;
  const original = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `User ${index + 1}`,
    ...(index >= firstPresent ? { note: `  note ${index + 1}  ` } : {}),
  }));
  return {
    original,
    transformed: original.map(row => ({
      id: row.id,
      name: row.name,
      ...(row.note !== undefined ? { note: row.note.trim() } : {}),
    })),
  };
}

for (const present of [1, 2, 5, 20, 30, 40]) {
  const result = verify(sparseFixture(present));
  assert.equal(result.flaggedRows.length, 0, `${present}/40 optional rows must not accuse absent rows`);
  assert.equal(result.verdict, present < 8 ? "unverifiable" : "consistent");
  if (present < 8) {
    assert.equal(result.ruleStatus, "unverified");
    assert.equal(result.confidence.label, "unverified");
    assert.deepEqual(result.memorisation.insufficientSupportTargets, ["$.note"]);
    assert.deepEqual(result.memorisation.unverifiableTargets, ["$.note"]);
    assert.match(result.summary, /support was insufficient/i);
  }
}

{
  const fixture = sparseFixture(20);
  const examples = fixture.original.map((input, index) => ({ input, output: fixture.transformed[index] }));
  const inferred = infer({ examples });
  const inputs = [
    { id: 41, name: "User 41" },
    { id: 42, name: "User 42", note: "  keep me  " },
  ];
  const expected = [
    { id: 41, name: "User 41" },
    { id: 42, name: "User 42", note: "keep me" },
  ];
  assert.deepEqual(transform({ rule: inferred.rule, input: inputs }), expected);

  const source = generateJavaScriptTransform({ rule: inferred.rule, status: inferred.status });
  const generatedTransform = Function(`${source}; return transform;`)();
  assert.deepEqual(inputs.map(generatedTransform), expected);
}

{
  const fixture = sparseFixture(20);
  const before = JSON.stringify(fixture.transformed[27]);
  fixture.transformed[27].note = "drifted note";
  assert.notEqual(JSON.stringify(fixture.transformed[27]), before, "optional-field drift must change the expected output");
  const result = verify(fixture);
  assert.equal(result.verdict, "inconsistent");
  assert.deepEqual(result.flaggedRows.map(row => row.index), [27]);
}

{
  const original = Array.from({ length: 40 }, (_, index) => ({
    id: index + 1,
    email: `person${index + 1}@example.com`,
  }));
  const transformed = original.map(row => ({ id: row.id, email: row.email }));
  const before = JSON.stringify(transformed[17]);
  delete transformed[17].email;
  assert.notEqual(JSON.stringify(transformed[17]), before, "optional-field omission must change the expected output");
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "inconsistent");
  assert.deepEqual(result.flaggedRows.map(row => row.index), [17]);
}

function claimsFixture(count, { sparseNotes = true } = {}) {
  const original = Array.from({ length: count }, (_, index) => {
    const first = index % 3 === 0 ? "José" : ["Ada", "Bo", "Cy"][index % 3];
    const diagnoses = Array.from({ length: (index % 4) + 1 }, (_, item) => `D${index}-${item}`);
    return {
      claim_id: `claim_${100000 + index}`,
      patient: { first, last: `Surname${index}` },
      email: `patient${index}@example.com`,
      payer: ["aetna", "cigna", "united"][index % 3],
      amount_cents: 100035 + ((index * 7919) % 490000),
      diagnoses,
      submitted_at: `2026-02-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
      approved: index % 3 !== 0,
      prior_auth: index % 5 === 0 ? null : `PA-${index}`,
      provider: { id: `provider_${index % 7}`, region: ["north", "south"][index % 2] },
      ...(sparseNotes && index % 17 === 0 ? { notes: `  extended claim ${index}  ` } : {}),
    };
  });
  const transformed = original.map(row => ({
    claimId: row.claim_id,
    patientName: `${row.patient.first} ${row.patient.last}`,
    email: row.email,
    payer: row.payer.toUpperCase(),
    amount: row.amount_cents / 100,
    diagnosisCount: row.diagnoses.length,
    submittedDate: row.submitted_at.slice(0, 10),
    status: row.approved ? "approved" : "pending",
    priorAuth: row.prior_auth,
    provider: row.provider,
    ...(row.notes !== undefined ? { notes: row.notes.trim() } : {}),
  }));
  return { original, transformed };
}

{
  const fixture = claimsFixture(50);
  const started = Date.now();
  const result = verify(fixture);
  const durationMs = Date.now() - started;
  assert.equal(result.flaggedRows.length, 0);
  assert.notEqual(result.verdict, "inconsistent");
  assert.ok(durationMs < 3000, `50-row sparse rich-schema verification took ${durationMs}ms`);
}

{
  const original = Array.from({ length: 40 }, (_, index) => ({
    id: index + 1,
    name: `User ${index + 1}`,
    ...(index % 4 !== 0 ? { nickname: `Nick ${index + 1}` } : {}),
    ...(index % 13 === 0 ? { note: `  variant ${index}  ` } : {}),
  }));
  const transformed = original.map(row => ({
    id: row.id,
    name: row.name,
    ...(row.nickname !== undefined ? { nickname: row.nickname } : {}),
    ...(row.note !== undefined ? { note: row.note.trim() } : {}),
  }));
  const result = verify({ original, transformed });
  assert.equal(result.flaggedRows.length, 0);
  assert.notEqual(result.verdict, "inconsistent");
}

const driftCases = [
  ["case", 3, (rows) => { rows[3].payer = "Aetna"; }],
  ["unit", 4, (rows, original) => { rows[4].amount = original[4].amount_cents; }],
  ["derived-count", 5, (rows) => { rows[5].diagnosisCount += 1; }],
  ["unicode-normalisation", 6, (rows) => { rows[6].patientName = rows[6].patientName.normalize("NFD"); }],
  ["float-precision", 7, (rows) => { rows[7].amount = Number(rows[7].amount.toFixed(1)); }],
  ["timezone-date", 8, (rows) => { rows[8].submittedDate = "2026-02-10"; }],
  ["null-to-empty", 10, (rows) => { rows[10].priorAuth = ""; }],
];

for (const [name, injectedRow, mutate] of driftCases) {
  const fixture = claimsFixture(40, { sparseNotes: false });
  const before = JSON.stringify(fixture.transformed);
  mutate(fixture.transformed, fixture.original);
  assert.notEqual(JSON.stringify(fixture.transformed), before, `${name} mutation must change the expected output`);
  const result = verify(fixture);
  assert.equal(result.verdict, "inconsistent", `${name} drift must remain inconsistent`);
  assert.deepEqual(result.flaggedRows.map(row => row.index), [injectedRow], `${name} must flag only its injected row`);
}

console.log("sparse-fields.test.js passed");
