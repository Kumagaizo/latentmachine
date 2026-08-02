import assert from "node:assert/strict";
import { compactVerificationResult, SECURITY_LIMITS, verify } from "../src/index.js";

{
  const result = verify({
    original: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bo" },
    ],
    transformed: [
      { userId: 1, fullName: "Ada" },
      { userId: 2, fullName: "Bo" },
    ],
  });
  assert.equal(result.verdict, "consistent");
  assert.equal(result.totalRows, 2);
  assert.equal(result.flaggedRows.length, 0);
}

{
  const original = Array.from({ length: 60 }, (_, index) => ({
    id: index + 1,
    plan: ["free", "pro", "team"][index % 3],
  }));
  const transformed = original.map(row => ({
    id: row.id,
    planLabel: { free: "Starter", pro: "Growth", team: "Scale" }[row.plan],
  }));
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "consistent");
  assert.equal(result.ruleStatus, "safe");
  assert.deepEqual(result.memorisation.memorisedTargets, []);
  assert.deepEqual(result.memorisation.passthroughTargets, ["$.id"]);
  assert.deepEqual(result.memorisation.ruleVerifiedTargets, ["$.planLabel"]);
  assert.deepEqual(result.memorisation.nonMemorisedTargets, ["$.id", "$.planLabel"]);
  assert.equal("verifiedTargets" in result.memorisation, false);
  assert.equal(result.memorisation.lookups[0].ratio, 0.05);
}

{
  const original = Array.from({ length: 40 }, (_, index) => ({
    id: `customer-${index + 1}`,
    created_at: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
  }));
  const transformed = original.map(row => ({ joinDate: row.created_at.slice(0, 10) }));
  const before = JSON.stringify(transformed[1]);
  transformed[1].joinDate = "01/02/2026";
  assert.notEqual(JSON.stringify(transformed[1]), before, "date-format mutation must change the expected output");
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "inconsistent");
  assert.deepEqual(result.flaggedRows.map(row => row.index), [1]);
  assert.equal(result.rule.program.ops[0].op, "dateFormat");
}

{
  const original = Array.from({ length: 40 }, (_, index) => ({ id: `customer-${index + 1}` }));
  const transformed = original.map((row, index) => ({ id: row.id, label: `Private segment ${index + 1}` }));
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "unverifiable");
  assert.equal(result.flaggedRows.length, 0);
  assert.equal(result.ruleStatus, "unverified");
  assert.equal(result.confidence.label, "unverified");
  assert.ok(result.memorisation.memorisedTargets.includes("$.label"));
  assert.ok(result.confidence.reasons.some(reason => reason.kind === "memorised-lookup"));
  assert.doesNotMatch(result.summary, /only field|drifted values/i);

  const compact = compactVerificationResult(result);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(result).length / 2);
  assert.equal("map" in compact.rule.program.ops.find(op => op.op === "valueMap"), false);
  assert.equal(compact.rule.executable, false);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const legacy = verify({ original, transformed, legacyVerdict: true });
    assert.equal(legacy.verdict, "consistent");
    assert.equal(legacy.actualVerdict, "unverifiable");
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
}

{
  const original = Array.from({ length: 20 }, (_, index) => ({
    id: `customer-${index + 1}`,
    cents: 1000 + index * 137,
    email: `person${index}@example.com`,
  }));
  const transformed = original.map(row => ({
    amount: row.cents / 100,
    email: row.email,
  }));
  delete transformed[7].email;
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "inconsistent");
  assert.ok(result.flaggedRows.some(row => row.index === 7));
}

{
  const fake = {
    verdict: "inconsistent",
    flaggedRows: Array.from({ length: 75 }, (_, index) => ({ index })),
    rule: null,
  };
  const compact = compactVerificationResult(fake);
  assert.equal(compact.flaggedRows.length, 50);
  assert.equal(compact.flaggedRowCount, 75);
  assert.equal(compact.omittedFlaggedRows, 25);

  const bounded = compactVerificationResult(fake, { flaggedRowLimit: 10_000 });
  assert.equal(bounded.flaggedRowLimit, 100);
  assert.equal(bounded.flaggedRows.length, 75);
}

{
  const result = verify({
    original: [
      { id: 1, date: "2026-01-01" },
      { id: 2, date: "2026-01-02" },
      { id: 3, date: "2026-01-03" },
      { id: 4, date: "2026-01-04" },
      { id: 5, date: "2026-01-05" },
    ],
    transformed: [
      { id: 1, date: "2026-01-01" },
      { id: 2, date: "2026-01-02" },
      { id: 3, date: "2026-01-03" },
      { id: 4, date: "01/04/2026" },
      { id: 5, date: "01/05/2026" },
    ],
  });
  assert.equal(result.verdict, "inconsistent");
  assert.ok(result.flaggedRows.some((row) => row.index === 3 || row.index === 4));
}

{
  const result = verify({
    original: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bo" },
      { id: 3, name: "Cy" },
      { id: 4, name: "Dee" },
      { id: 5, name: "Eli" },
    ],
    transformed: [
      { userId: 1, fullName: "Ada" },
      { userId: 2, fullName: "Bo" },
      { userId: 3, fullName: "Cy" },
      { userId: 4, fullName: "Dee" },
      { userId: 5, fullName: "Elliot" },
    ],
  });
  assert.equal(result.verdict, "inconsistent");
  assert.ok(result.flaggedRows.some((row) => row.index === 4));
}

assert.throws(
  () => verify({ original: [{ id: 1 }], transformed: [{ id: 1 }, { id: 2 }] }),
  /Row count mismatch/,
);

assert.throws(
  () => verify({ original: [], transformed: [] }),
  /Empty input/,
);

assert.throws(
  () => verify({
    original: Array.from({ length: SECURITY_LIMITS.maxRows + 1 }, (_, id) => ({ id })),
    transformed: Array.from({ length: SECURITY_LIMITS.maxRows + 1 }, (_, id) => ({ id })),
  }),
  /Original rows is too large/,
);

{
  const result = verify({
    original: '[{"id":1,"name":"Ada"},{"id":2,"name":"Bo"}]',
    transformed: '[{"userId":1,"fullName":"Ada"},{"userId":2,"fullName":"Bo"}]',
  });
  assert.equal(result.verdict, "consistent");
  assert.equal(result.detectedFormats.original, "json");
}

{
  const result = verify({
    original: "id,name\n1,Ada\n2,Bo",
    transformed: "userId,fullName\n1,Ada\n2,Bo",
  });
  assert.equal(result.verdict, "consistent");
  assert.equal(result.detectedFormats.original, "csv");
}

console.log("verify.test.js passed");
