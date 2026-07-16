import assert from "node:assert/strict";
import { SECURITY_LIMITS, verify } from "../src/index.js";

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
