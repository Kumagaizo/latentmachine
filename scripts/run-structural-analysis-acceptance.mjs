import assert from "node:assert/strict";
import { parseWithFormat } from "../src/intelligence/data-formats/index.js";
import { analyzeStructure } from "../src/intelligence/json-transform/analysis.js";

function field(result, path) {
  return result.fields.find(item => item.path === path);
}

const cases = [
  ["single object reports fields and depth", () => {
    const result = analyzeStructure({ user: { name: "Ana", active: true }, amount: 12 });
    assert.equal(result.summary.format, "object");
    assert.equal(result.summary.fieldCount, 3);
    assert.equal(result.summary.depth, 2);
    assert.deepEqual(result.fields.map(item => item.path), ["$.user", "$.user.name", "$.user.active", "$.amount"]);
    assert.equal(field(result, "$.user.name").type, "string");
    assert.equal(field(result, "$.user.active").type, "boolean");
  }],
  ["record arrays report aggregates", () => {
    const result = analyzeStructure([
      { status: "active", amount: 100, currency: "usd" },
      { status: "active", amount: 200, currency: "usd" },
      { status: "pending", amount: 50, currency: "usd" },
    ]);
    assert.equal(result.summary.format, "array-of-objects");
    assert.equal(result.summary.recordCount, 3);
    assert.equal(field(result, "$.status").uniqueCount, 2);
    assert.equal(field(result, "$.status").valueCounts.active, 2);
    assert.deepEqual(field(result, "$.amount").numeric, { min: 50, max: 200, median: 100 });
    assert.equal(field(result, "$.currency").constant, true);
    assert.equal(field(result, "$.currency").constantValue, "usd");
  }],
  ["patterns stay string-only", () => {
    const result = analyzeStructure([
      { email: "ana@example.com", amount: 12 },
      { email: "bo@example.com", amount: 40 },
    ]);
    assert.equal(field(result, "$.email").pattern, "email");
    assert.equal(field(result, "$.amount").pattern, null);
    assert.equal(result.patterns.some(item => item.path === "$.amount"), false);
  }],
  ["arrays summarize without inflating field count", () => {
    const result = analyzeStructure([
      { name: "Ana", tags: ["a", "b"] },
      { name: "Bo", tags: ["c"] },
    ]);
    assert.equal(result.summary.fieldCount, 2);
    assert.deepEqual(field(result, "$.tags").arrayStats, {
      minLength: 1,
      maxLength: 2,
      itemTypes: ["string"],
    });
  }],
  ["completeness includes missing and empty values", () => {
    const result = analyzeStructure([
      { name: "Ana", notes: "hello" },
      { name: "Bo" },
      { name: "Cal", notes: "" },
    ]);
    const note = result.completeness.find(item => item.path === "$.notes");
    assert.equal(note.present, 2);
    assert.equal(note.emptyCount, 1);
    assert.match(note.message, /missing/);
    assert.match(note.message, /empty/);
  }],
  ["csv tables analyze as record sets", () => {
    const parsed = parseWithFormat("id,email,status\n001,ana@example.com,active\n002,bo@example.com,pending", "csv", { singleRowAsObject: false });
    const result = analyzeStructure(parsed);
    assert.equal(result.summary.recordCount, 2);
    assert.deepEqual(result.fields.map(item => item.path), ["$.id", "$.email", "$.status"]);
    assert.equal(field(result, "$.id").pattern, "identifier");
    assert.equal(field(result, "$.email").pattern, "email");
  }],
  ["large batches report total and sample size separately", () => {
    const data = Array.from({ length: 150 }, (_, index) => ({ id: `user-${index}`, status: index % 2 ? "active" : "pending" }));
    const result = analyzeStructure(data, { maxArraySample: 40 });
    assert.equal(result.summary.recordCount, 150);
    assert.equal(result.summary.sampledRecordCount, 40);
    assert.equal(field(result, "$.status").total, 40);
  }],
];

const results = cases.map(([name, run]) => {
  try {
    run();
    return { name, passed: true };
  } catch (error) {
    return { name, passed: false, error: error?.message || "Unknown error" };
  }
});

const failed = results.filter(result => !result.passed);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map(result => result.name) }, null, 2));

if (failed.length) {
  console.error(failed.map(result => `- ${result.name}: ${result.error}`).join("\n"));
  process.exit(1);
}
