import assert from "node:assert/strict";
import { infer, transform } from "../src/index.js";

const inferred = infer({
  examples: [
    { input: { first: "Ada", last: "Lovelace" }, output: { name: "Ada Lovelace" } },
    { input: { first: "Bo", last: "Singh" }, output: { name: "Bo Singh" } },
  ],
});

{
  const output = transform({
    rule: inferred.rule,
    input: { first: "Clara", last: "Diaz" },
  });
  assert.equal(output.name, "Clara Diaz");
}

{
  const output = transform({
    rule: inferred,
    input: [
      { first: "Clara", last: "Diaz" },
      { first: "Dev", last: "Patel" },
    ],
  });
  assert.deepEqual(output, [
    { name: "Clara Diaz" },
    { name: "Dev Patel" },
  ]);
}

assert.throws(
  () => transform({ rule: {}, input: { first: "Ada" } }),
  /Invalid rule/,
);

assert.throws(
  () => transform({
    rule: {
      program: {
        ops: [{ op: "constant", target: "$.__proto__.polluted", value: true }],
      },
    },
    input: {},
  }),
  /Unsafe object path segment/,
);
assert.equal({}.polluted, undefined);

assert.throws(
  () => transform({
    rule: {
      program: {
        ops: [{ op: "regexExtract", source: "$.text", pattern: "(a+)+$", group: 0, target: "$.match" }],
      },
    },
    input: { text: "aaaaaaaaaaaaaaaaaaaaaaaa!" },
  }),
  /Unsafe regex extraction pattern/,
);

console.log("transform.test.js passed");
