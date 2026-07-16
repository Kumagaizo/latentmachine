import assert from "node:assert/strict";
import { runJsonTransform } from "../src/intelligence/json-transform/engine.js";

const checks = [];

function check(name, fn) {
  checks.push({ name, fn });
}

check("ambiguous examples enter the refusal state", () => {
  const result = runJsonTransform({
    examples: [
      { input: { a: "X", b: "X" }, output: { value: "X" } },
      { input: { a: "Y", b: "Y" }, output: { value: "Y" } },
    ],
    newInput: { a: "A", b: "B" },
  });
  const ambiguity = result.diagnosis.ambiguities[0];
  const suggestion = result.diagnosis.suggestedExamples.find(item => item.type === "ambiguity");

  assert.equal(result.status, "ambiguous");
  assert.equal(result.diagnosis.ambiguities.length, 1);
  assert.ok(ambiguity.selectedReading.includes("Copy `$.a` to `$.value`."));
  assert.ok(ambiguity.alternativeReading.includes("Copy `$.b` to `$.value`."));
  assert.equal(suggestion.reason, "Add an example where $.a and $.b have different values.");
  assert.equal(suggestion.selectedReading, ambiguity.selectedReading);
  assert.equal(suggestion.alternativeReading, ambiguity.alternativeReading);
});

check("refusal language stays plain", () => {
  const result = runJsonTransform({
    examples: [
      { input: { a: "X", b: "X" }, output: { value: "X" } },
      { input: { a: "Y", b: "Y" }, output: { value: "Y" } },
    ],
    newInput: { a: "A", b: "B" },
  });
  const text = [
    result.diagnosis.ambiguities[0].selectedReading,
    result.diagnosis.ambiguities[0].alternativeReading,
    result.diagnosis.suggestedExamples[0].reason,
  ].join(" ");
  for (const forbidden of ["set(", "valueMap", "template", "candidate", "cost"]) {
    assert.ok(!text.includes(forbidden), `refusal should not expose ${forbidden}`);
  }
});

check("determined examples do not enter refusal", () => {
  const result = runJsonTransform({
    examples: [
      { input: { a: "X", b: "same" }, output: { value: "X" } },
      { input: { a: "Y", b: "same" }, output: { value: "Y" } },
    ],
    newInput: { a: "Z", b: "same" },
  });
  assert.equal(result.status, "safe");
  assert.equal(result.diagnosis.ambiguities.length, 0);
  assert.equal(result.diagnosis.suggestedExamples.some(item => item.type === "ambiguity"), false);
});

const failed = [];
for (const item of checks) {
  try {
    item.fn();
  } catch (error) {
    failed.push({ name: item.name, error: error.message });
  }
}

console.log(JSON.stringify({ total: checks.length, passed: checks.length - failed.length, failed }, null, 2));
if (failed.length) process.exit(1);
