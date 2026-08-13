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
  const before = JSON.stringify(transformed[7]);
  delete transformed[7].email;
  assert.notEqual(JSON.stringify(transformed[7]), before, "missing-field mutation must change the expected output");
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "inconsistent");
  assert.deepEqual(result.flaggedRows.map(row => row.index), [7]);
}

{
  const fake = {
    verdict: "inconsistent",
    flaggedRows: Array.from({ length: 75 }, (_, index) => ({ index })),
    unexplained: Array.from({ length: 75 }, (_, index) => index),
    rule: null,
  };
  const compact = compactVerificationResult(fake);
  assert.equal(compact.flaggedRows.length, 50);
  assert.equal(compact.flaggedRowCount, 75);
  assert.equal(compact.omittedFlaggedRows, 25);
  assert.equal(compact.unexplained.length, 50);
  assert.equal(compact.unexplainedRowCount, 75);
  assert.equal(compact.omittedUnexplainedRows, 25);

  const bounded = compactVerificationResult(fake, { flaggedRowLimit: 10_000 });
  assert.equal(bounded.flaggedRowLimit, 100);
  assert.equal(bounded.flaggedRows.length, 75);
}

{
  const first = ["Anna", "Bernd", "Clara", "Dieter", "Eva", "Franz", "Greta", "Hans", "Ilse", "Jens"];
  const last = ["Meier", "Schulz", "Weber", "Kunz", "Bauer", "Roth", "Lang", "Fuchs", "Vogel", "Krause"];
  const build = (count, badIndices) => {
    const original = [];
    const transformed = [];
    for (let index = 0; index < count; index += 1) {
      const firstName = first[index % 10];
      const lastName = last[(index * 3) % 10];
      original.push({ id: index + 1, first: firstName, last: lastName });
      transformed.push({
        id: index + 1,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@corp.${badIndices.has(index) ? "com" : "de"}`,
      });
    }
    return { original, transformed };
  };

  const singleDefect = build(100, new Set([50]));
  const singleResult = verify(singleDefect);
  assert.equal(singleResult.clusteringSkipped, true);
  assert.deepEqual(singleResult.unexplained, []);
  assert.ok(singleResult.unexplained.length + singleResult.matchedRows <= singleResult.totalRows);
  const compactSingle = compactVerificationResult(singleResult, { flaggedRowLimit: 3 });
  assert.equal(compactSingle.unexplainedRowCount, 0);

  const absorbedIndices = Array.from({ length: 12 }, (_, index) => index * 7 + 3);
  const absorbedResult = verify(build(200, new Set(absorbedIndices)));
  assert.equal(absorbedResult.verdict, "unverifiable");
  assert.deepEqual(absorbedResult.absorbedIntoLookup, absorbedIndices);
  assert.equal(absorbedResult.flaggedRows.length, 0);
  const compactAbsorbed = compactVerificationResult(absorbedResult, { flaggedRowLimit: 3 });
  assert.deepEqual(compactAbsorbed.absorbedIntoLookup, absorbedIndices.slice(0, 3));
  assert.equal(compactAbsorbed.absorbedIntoLookupCount, 12);
}

{
  const first = ["Anna", "Bernd", "Clara", "Dieter", "Eva", "Franz", "Greta", "Hans", "Ilse", "Jens"];
  const last = ["Meier", "Schulz", "Weber", "Kunz", "Bauer", "Roth", "Lang", "Fuchs", "Vogel", "Krause"];
  for (let poison = 5; poison <= 95; poison += 5) {
    const original = [];
    const transformed = [];
    for (let index = 0; index < 200; index += 1) {
      const firstName = first[index % 10];
      const lastName = last[(index * 7) % 10];
      original.push({ id: index + 1, first: firstName, last: lastName });
      transformed.push({
        id: index + 1,
        full_name: index % 100 < poison ? `${firstName} ${lastName.toUpperCase()}` : `${firstName} ${lastName}`,
      });
    }
    const result = verify({ original, transformed });
    if (result.clusters.length > 1) {
      assert.ok(result.clusters[0].share >= result.clusters[1].share, `cluster order at ${poison}%`);
      assert.equal(result.clusters[0].label, "Rule 1");
    }
    if (poison === 35) {
      assert.equal(result.verdict, "inconsistent");
      assert.equal(result.matchedRows, 130);
      assert.equal(result.clusters[0].support, 130);
    }
  }
}

{
  const original = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, date: `2026-01-0${index + 1}` }));
  const transformed = original.map(row => ({ ...row }));
  for (const index of [3, 4]) {
    const before = JSON.stringify(transformed[index]);
    transformed[index].date = `01/0${index + 1}/2026`;
    assert.notEqual(JSON.stringify(transformed[index]), before, `date drift at row ${index} must change the expected output`);
  }
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "inconsistent");
  assert.deepEqual(result.flaggedRows.map(row => row.index), [3, 4]);
}

{
  const names = ["Ada", "Bo", "Cy", "Dee", "Eli"];
  const original = names.map((name, index) => ({ id: index + 1, name }));
  const transformed = original.map(row => ({ userId: row.id, fullName: row.name }));
  const before = JSON.stringify(transformed[4]);
  transformed[4].fullName = "Elliot";
  assert.notEqual(JSON.stringify(transformed[4]), before, "composition drift must change the expected output");
  const result = verify({ original, transformed });
  assert.equal(result.verdict, "inconsistent");
  assert.deepEqual(result.flaggedRows.map(row => row.index), [4]);
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
