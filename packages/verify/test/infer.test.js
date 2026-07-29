import assert from "node:assert/strict";
import { infer } from "../src/index.js";

{
  const result = infer({
    examples: [
      { input: { first: "Ada", last: "Lovelace" }, output: { name: "Ada Lovelace" } },
      { input: { first: "Bo", last: "Singh" }, output: { name: "Bo Singh" } },
    ],
  });
  assert.equal(result.status, "safe");
  assert.ok(result.rule?.program);
}

{
  const result = infer({
    examples: [
      { input: { code: "A" }, output: { label: "Alpha" } },
      { input: { code: "A" }, output: { label: "Beta" } },
    ],
  });
  assert.notEqual(result.status, "safe");
  assert.equal(result.status, "contradictory");
  assert.equal(result.diagnosis.examplesProvided, 2);
  assert.ok(result.warnings.some(warning => warning.type === "same-input-conflict"));
}

{
  const result = infer({
    examples: [
      { input: { first: "Ada", handle: "ada" }, output: { name: "Ada" } },
      { input: { first: "Bo", handle: "bo" }, output: { name: "Bo" } },
    ],
  });
  assert.ok(["ambiguous", "safe"].includes(result.status));
  assert.ok(result.rule || result.diagnosis);
}

assert.throws(
  () => infer({ examples: [] }),
  /at least one/,
);

assert.throws(
  () => infer({ examples: [{ input: { id: 1 } }] }),
  /input and an output/,
);

console.log("infer.test.js passed");
