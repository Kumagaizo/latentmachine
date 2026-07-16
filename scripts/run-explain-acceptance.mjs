import assert from "node:assert/strict";
import { explainAssumptions, explainProgram } from "../src/intelligence/json-transform/explain.js";

const program = {
  version: 2,
  ops: [
    { op: "set", source: "$.name", target: "$.displayName" },
    { op: "constant", value: "import", target: "$.source" },
    { op: "concat", sources: ["$.first", "$.last"], separators: [" "], target: "$.fullName" },
    { op: "template", parts: [{ kind: "source", path: "$.year" }, { kind: "literal", value: "-" }, { kind: "source", path: "$.month" }], target: "$.period" },
    { op: "splitPart", source: "$.email", separator: "@", index: 0, target: "$.username" },
    { op: "extractBetween", source: "$.href", prefix: "/users/", suffix: "?tab", target: "$.userId" },
    { op: "stringCase", source: "$.title", mode: "title", target: "$.title" },
    { op: "stringNormalize", source: "$.phone", mode: "phone", target: "$.phone" },
    { op: "stringSplit", source: "$.tags", separator: ",", trim: true, target: "$.tags" },
    { op: "coerce", source: "$.age", to: "number", target: "$.age" },
    { op: "numericBinary", left: "$.subtotal", right: "$.tax", mode: "add", target: "$.total" },
    { op: "numericTransform", source: "$.price", mode: "multiply", value: 100, target: "$.cents" },
    { op: "quantityTransform", source: "$.memory", factor: 1024, unit: "Mi", target: "$.memoryMi" },
    { op: "booleanNot", source: "$.disabled", target: "$.enabled" },
    { op: "dateFormat", source: "$.created", mode: "iso-date", target: "$.createdAt" },
    { op: "valueMap", source: "$.status", map: { "\"active\"": "Active", "\"pending\"": "Pending" }, target: "$.label" },
    { op: "arrayMap", source: "$.items", extract: "$.sku", target: "$.skus" },
    { op: "arrayProject", source: "$.items", where: { path: "$.kind", equals: "book" }, fields: [{ source: "$.sku", target: "$.id" }, { source: "$.title", target: "$.name" }], target: "$.products" },
    { op: "arrayCount", source: "$.items", where: { path: "$.available", equals: true }, target: "$.availableCount" },
    { op: "arrayJoin", source: "$.items", where: { path: "$.kind", equals: "book" }, extract: "$.title", separator: ", ", target: "$.titles" },
    { op: "arrayFind", source: "$.items", where: { path: "$.primary", equals: true }, extract: "$.sku", target: "$.primarySku" },
    { op: "arrayStringTransform", source: "$.emails", mode: "trim", target: "$.emails" },
    { op: "templateConflict", sources: ["$.first", "$.last"], target: "$.name" },
    { op: "valueMapConflict", source: "$.role", target: "$.access" },
  ],
};

const forbidden = [
  "arrayProject",
  "arrayMap",
  "arrayFind",
  "arrayJoin",
  "arrayCount",
  "arrayStringTransform",
  "valueMap",
  "templateConflict",
  "valueMapConflict",
  "coerce(",
  "concat(",
];

const explanations = explainProgram(program);
const assumptions = explainAssumptions(program, [
  { field: "$.email", type: "string", required: true, usedBy: "$.username" },
  { field: "$.items", type: "array", required: true, usedBy: "$.products" },
]);

assert.equal(explanations.length, program.ops.length);

for (const [index, explanation] of explanations.entries()) {
  const op = program.ops[index];
  assert.ok(explanation.sentence, `${op.op} should have a sentence`);
  assert.ok(explanation.sentence.includes(op.target || "$"), `${op.op} should name target ${op.target}`);
  for (const source of explanation.sourceFields) {
    assert.ok(explanation.sentence.includes(source), `${op.op} should name source ${source}`);
  }
  for (const word of forbidden) {
    assert.ok(!explanation.sentence.includes(word), `${op.op} sentence should not expose ${word}`);
  }
}

const expectedAssumptions = [
  ["$.email", "contains \"@\""],
  ["$.status", "one of \"active\" and \"pending\""],
  ["$.href", "\"/users/\" and \"?tab\""],
  ["$.items", "is an array"],
  ["$.items", "$.kind"],
  ["$.items", "$.sku"],
];

for (const [field, phrase] of expectedAssumptions) {
  assert.ok(
    assumptions.some(item => item.field === field && item.sentence.includes(phrase)),
    `assumption for ${field} should include ${phrase}`,
  );
}

for (const item of assumptions) {
  assert.ok(item.sentence.startsWith("Assumes "), `assumption should be explicit: ${item.sentence}`);
  assert.ok(item.field && item.sentence.includes(item.field), `assumption should name its field: ${item.sentence}`);
  for (const word of forbidden) {
    assert.ok(!item.sentence.includes(word), `assumption should not expose ${word}`);
  }
}

console.log(JSON.stringify({ total: explanations.length + assumptions.length, passed: explanations.length + assumptions.length, failed: [] }, null, 2));
