import assert from "node:assert/strict";
import { costOf } from "../src/intelligence/json-transform/costs.js";
import { assessConfidence } from "../src/intelligence/json-transform/reliability.js";

function evidence(overrides = {}) {
  return {
    exactFit: true,
    examplesProvided: 2,
    examplesMatched: 2,
    operations: 1,
    unexplainedPaths: [],
    meaningfulAmbiguities: [],
    triagedAmbiguities: [],
    schemaDrift: { blocking: [], advisory: [] },
    guardrails: [],
    ...overrides,
  };
}

const cases = [
  ["cost orders representative operations", () => {
    const direct = costOf({ op: "set", source: "$.name", target: "$.name" }, { pathMatch: true });
    const coerce = costOf({ op: "coerce", source: "$.age", to: "number", target: "$.age" });
    const template = costOf({ op: "template", parts: [{ kind: "source", path: "$.first" }, { kind: "literal", value: " " }, { kind: "source", path: "$.last" }], target: "$.name" }, { sourceCount: 2, literalCount: 1 });
    const valueMap = costOf({ op: "valueMap", source: "$.status", map: { "\"a\"": "active", "\"p\"": "pending" }, target: "$.label" });
    assert.ok(direct < coerce, `direct ${direct} should be simpler than coerce ${coerce}`);
    assert.ok(coerce < template, `coerce ${coerce} should be simpler than template ${template}`);
    assert.ok(template < valueMap, `template ${template} should be simpler than valueMap ${valueMap}`);
  }],
  ["size term stays inside one prior step", () => {
    const small = costOf({ op: "template", parts: [{ kind: "source", path: "$.a" }], target: "$.out" });
    const large = costOf({
      op: "template",
      parts: Array.from({ length: 20 }, (_, index) => index % 2 ? { kind: "literal", value: `literal-${index}` } : { kind: "source", path: `$.field${index}` }),
      target: "$.out",
    });
    assert.ok(large >= small);
    assert.ok(large - small < 0.25, `size delta ${large - small} should stay below one prior step`);
  }],
  ["positive adjustment cannot cross a prior step", () => {
    const op = { op: "valueMap", source: "$.id", map: { "\"1\"": "Admin", "\"2\"": "Editor" }, target: "$.label" };
    const base = costOf(op);
    const adjusted = costOf(op, {
      idPenalty: true,
      numericToTextPenalty: true,
      templatedStringPenalty: true,
      unrelated: true,
      affinity: 10,
    });
    assert.ok(adjusted - base <= 0.25, `positive adjustment ${adjusted - base} should stay within one prior step`);
  }],
  ["negative adjustment cannot cross a prior step", () => {
    const op = { op: "templateConflict", target: "$.label", sources: ["$.role"] };
    const base = costOf(op);
    const adjusted = costOf(op, {
      sourceReward: 10,
      suggestions: 10,
      affinity: -10,
      categorical: -10,
      semantic: -10,
    });
    assert.ok(base - adjusted <= 0.25, `negative adjustment ${base - adjusted} should stay within one prior step`);
  }],
  ["confidence labels follow evidence table", () => {
    assert.equal(assessConfidence(evidence({ exactFit: false, examplesMatched: 1 })).label, "blocked");
    assert.equal(assessConfidence(evidence({ schemaDrift: { blocking: [{ type: "schema-missing-field", path: "$.id" }], advisory: [] } })).label, "unsafe");
    assert.equal(assessConfidence(evidence({ unexplainedPaths: ["$.missing"] })).label, "needs-proof");
    assert.equal(assessConfidence(evidence({ examplesProvided: 1, examplesMatched: 1 })).label, "supported");
    assert.equal(assessConfidence(evidence()).label, "proven");
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
