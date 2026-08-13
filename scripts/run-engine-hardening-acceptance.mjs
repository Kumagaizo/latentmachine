import assert from "node:assert/strict";
import { consumeMcpRateLimit } from "../api/mcp.js";
import { SECURITY_LIMITS, assertSerializedLimit } from "../packages/verify/src/limits.js";
import { learnContract } from "../src/intelligence/contracts/builder.js";
import { clone } from "../src/intelligence/json-transform/core.js";
import { runJsonTransform, jsonTransformInternals } from "../src/intelligence/json-transform/engine.js";
import { deepEqual } from "../src/intelligence/json-transform/shared.js";

const cases = [
  ["same-input conflicts are preserved and block inference", () => {
    const result = runJsonTransform({
      examples: [
        { input: { x: "a" }, output: { y: "FIRST" } },
        { input: { x: "a" }, output: { y: "SECOND" } },
      ],
    });
    assert.equal(result.status, "contradictory");
    assert.equal(result.diagnosis.examplesProvided, 2);
    assert.ok(result.warnings.some(warning => warning.type === "same-input-conflict"));
    assert.ok(result.diagnosis.contradictions.some(item => item.type === "same-input-conflict"));
    assert.doesNotMatch(JSON.stringify(result.confidence.reasons), /1\/1 examples matched exactly/);
  }],
  ["explicit corrections still supersede stale evidence", () => {
    const result = runJsonTransform({
      examples: [
        { input: { x: "a" }, output: { y: "STALE" } },
        { input: { x: "a" }, output: { y: "CURRENT" }, correction: true },
      ],
    });
    assert.equal(result.status, "safe");
    assert.deepEqual(result.output, { y: "CURRENT" });
  }],
  ["learned contracts retain contradictory evidence", () => {
    const contract = learnContract({
      examples: [
        { input: { x: "a" }, output: { y: "FIRST" } },
        { input: { x: "a" }, output: { y: "SECOND" } },
      ],
    });
    assert.equal(contract.evidence.count, 2);
    assert.equal(contract.inference.status, "contradictory");
    assert.ok(contract.evidence.contradictions.some(item => item.type === "same-input-conflict"));
  }],
  ["equality distinguishes non-JSON numeric values", () => {
    assert.equal(deepEqual(NaN, null), false);
    assert.equal(deepEqual(Infinity, null), false);
    assert.equal(deepEqual(-Infinity, null), false);
    assert.equal(deepEqual(-0, 0), false);
    assert.equal(deepEqual(NaN, NaN), true);
  }],
  ["clone preserves special numeric values", () => {
    const value = clone({ nan: NaN, infinity: Infinity, negativeZero: -0 });
    assert.equal(Number.isNaN(value.nan), true);
    assert.equal(value.infinity, Infinity);
    assert.equal(Object.is(value.negativeZero, -0), true);
  }],
  ["parsed paths are cached as immutable values", () => {
    const first = jsonTransformInternals.parsePath("$.account.profile[0].name");
    const second = jsonTransformInternals.parsePath("$.account.profile[0].name");
    assert.equal(first, second);
    assert.equal(Object.isFrozen(first), true);
  }],
  ["formatted paths round-trip escaped object keys", () => {
    const parts = ["quoted\"key", "single'key", "back\\slash", 2];
    const path = jsonTransformInternals.formatPath(parts);
    assert.deepEqual(jsonTransformInternals.parsePath(path), parts);
  }],
  ["malformed paths and unknown operations fail closed", () => {
    for (const path of ["garbage", "$.a garbage", "$.a..b", "$[not-json]"]) {
      assert.throws(() => jsonTransformInternals.parsePath(path), /Invalid object path/);
    }
    assert.throws(
      () => jsonTransformInternals.executeJsonTransform({ ops: [{ op: "unsupported", target: "$.value" }] }, {}),
      /Unsupported transform operation/,
    );
  }],
  ["unenforced runtime budgets are not reported", () => {
    const transform = runJsonTransform({
      budgetMs: 1,
      examples: [{ input: { x: "a" }, output: { y: "A" } }],
    });
    assert.equal("budgetMs" in transform.telemetry, false);
    assert.equal("timedOut" in transform.telemetry, false);
  }],
  ["serialized capacity supports realistic 5,000-row data", () => {
    const rows = Array.from({ length: SECURITY_LIMITS.maxRows }, (_, index) => ({
      id: `record-${index}`,
      firstName: "Alexandra",
      lastName: "Example",
      department: "Data Operations",
      region: "Europe",
      status: "active",
      source: "workflow-export",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
      note: "reviewed by the transformation team",
    }));
    const characters = JSON.stringify(rows).length;
    assert.ok(characters > 750_000);
    assert.ok(characters < SECURITY_LIMITS.maxSerializedCharacters);
    assert.doesNotThrow(() => assertSerializedLimit(rows, "Rows"));
  }],
  ["MCP limiter caps request count and character cost", () => {
    const countClient = `acceptance-count-${Date.now()}`;
    for (let index = 0; index < SECURITY_LIMITS.maxMcpRequestsPerWindow; index += 1) {
      assert.equal(consumeMcpRateLimit({ clientId: countClient, characters: 1, now: 1 }).limited, false);
    }
    assert.equal(consumeMcpRateLimit({ clientId: countClient, characters: 1, now: 1 }).limited, true);

    const costClient = `acceptance-cost-${Date.now()}`;
    assert.equal(consumeMcpRateLimit({
      clientId: costClient,
      characters: SECURITY_LIMITS.maxMcpCharactersPerWindow,
      now: 1,
    }).limited, false);
    assert.equal(consumeMcpRateLimit({ clientId: costClient, characters: 1, now: 1 }).limited, true);
  }],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error?.message || error}`);
  }
}

if (failed) {
  console.error(`\n${failed} engine hardening acceptance case${failed === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log(`\nEngine hardening acceptance passed (${cases.length}/${cases.length}).`);
