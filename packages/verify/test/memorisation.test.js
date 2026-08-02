import assert from "node:assert/strict";
import { learnContract, verify } from "../src/index.js";

function productionRows(count) {
  const original = Array.from({ length: count }, (_, index) => {
    const dateCardinality = count < 28 ? 4 : 28;
    const day = String((index % dateCardinality) + 1).padStart(2, "0");
    return {
      customer_id: `cus_${100000 + index}`,
      first_name: ["Ada", "Bo", "Cy", "Dee", "Eli"][index % 5],
      last_name: `Surname${index}`,
      email: `person${index}@example.com`,
      plan: ["free", "pro", "team", "enterprise"][index % 4],
      mrr_cents: 1000 + ((index * 7919) % 49000),
      seats: (index % 8) + 1,
      is_active: index % 3 !== 0,
      created_at: `2026-01-${day}T12:00:00.000Z`,
    };
  });
  const transformed = original.map(row => ({
    customerId: row.customer_id,
    fullName: `${row.first_name} ${row.last_name}`,
    email: row.email,
    plan: row.plan,
    mrr: row.mrr_cents / 100,
    seats: row.seats,
    status: row.is_active ? "active" : "inactive",
    joinDate: row.created_at.slice(0, 10),
  }));
  return { original, transformed };
}

{
  const fixture = productionRows(300);
  fixture.original = fixture.original.map(row => ({
    customer_id: row.customer_id,
    plan: row.plan,
    mrr_cents: row.mrr_cents,
    is_active: row.is_active,
  }));
  fixture.transformed = fixture.transformed.map(row => ({
    customerId: row.customerId,
    plan: row.plan,
    mrr: row.mrr,
    status: row.status,
  }));
  const started = Date.now();
  const result = verify(fixture);
  const durationMs = Date.now() - started;
  assert.equal(result.verdict, "consistent");
  assert.equal(result.ruleStatus, "safe");
  assert.equal(result.memorisation.memorisedTargets.includes("$.mrr"), false);
  assert.deepEqual(
    result.rule.program.ops.find(operation => operation.target === "$.mrr"),
    { op: "numericTransform", source: "$.mrr_cents", mode: "divide", value: 100, target: "$.mrr" },
  );
  assert.ok(durationMs < 1000, `300-row verification took ${durationMs}ms`);
}

{
  const fixture = productionRows(1600);
  const before = JSON.stringify(fixture.transformed[1544]);
  fixture.transformed[1544].mrr = fixture.original[1544].mrr_cents;
  assert.notEqual(JSON.stringify(fixture.transformed[1544]), before, "large-batch unit mutation must change the expected output");
  const result = verify(fixture);
  assert.equal(result.verdict, "inconsistent");
  assert.ok(result.flaggedRows.some(row => row.index === 1544));
  assert.equal(result.memorisation.memorisedTargets.includes("$.mrr"), false);
}

const driftCases = [
  ["format", (rows) => { rows[1].joinDate = "01/02/2026"; }],
  ["case", (rows) => { rows[2].status = "Active"; }],
  ["unit", (rows, original) => { rows[3].mrr = original[3].mrr_cents; }],
  ["type", (rows) => { rows[4].seats = String(rows[4].seats); }],
  ["composition", (rows, original) => { rows[5].fullName = `${original[5].last_name}, ${original[5].first_name}`; }],
  ["omission", (rows) => { delete rows[6].email; }],
  ["corruption", (rows) => { rows[7].email = "silently-corrupted@example.com"; }],
];

for (const [name, mutate] of driftCases) {
  const fixture = productionRows(12);
  const before = JSON.stringify(fixture.transformed);
  mutate(fixture.transformed, fixture.original);
  assert.notEqual(JSON.stringify(fixture.transformed), before, `${name} mutation must change the expected output`);
  const result = verify(fixture);
  assert.notEqual(result.verdict, "consistent", `${name} drift must not be reported consistent`);
  if (result.verdict === "unverifiable") {
    assert.ok(result.memorisation.memorisedTargets.length > 0, `${name} must name memorised targets`);
  }
}

{
  const fixture = {
    original: Array.from({ length: 12 }, (_, index) => ({ id: `account-${index + 1}` })),
    transformed: Array.from({ length: 12 }, (_, index) => ({ label: `Segment ${index + 1}` })),
  };
  const contract = learnContract({
    examples: fixture.original.map((input, index) => ({ input, output: fixture.transformed[index] })),
  });
  assert.equal(contract.inference.status, "unverified");
  assert.equal(contract.lifecycle.approvalState, "review_required");
  assert.ok(contract.challenges.some(challenge => challenge.affectedPaths.includes("$.label")));
}

console.log("memorisation.test.js passed");
