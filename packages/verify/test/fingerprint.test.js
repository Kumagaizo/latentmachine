import assert from "node:assert/strict";
import { annotateStructuralDiffHazards, canonicalize, fingerprint, formatPath, inspectJsonPrecision, profileStructure, structuralDiff } from "../src/index.js";

assert.equal(canonicalize({ b: 2, a: 1 }), "{\"a\":1,\"b\":2}");
assert.equal(canonicalize([1, "x", true, null, undefined]), "[1,\"x\",true,null,null]");
assert.equal(fingerprint({ b: 2, a: 1 }).hex, fingerprint({ a: 1, b: 2 }).hex);
assert.notEqual(fingerprint([1, 2, 3]).hex, fingerprint([1, 3, 2]).hex);
assert.equal(fingerprint({ a: 1 }).bits, 64);

const profile = profileStructure({
  rows: [
    { id: 1, score: 10 },
    { id: 2, score: 11 },
    { id: 3, score: 12 },
    { id: 4, score: 13 },
    { id: 5, score: 14 },
    { id: 6, score: 15 },
    { id: 7, score: 16 },
    { id: 8, score: 80 },
  ],
});
assert.equal(profile.recordArrays, 1);
assert.equal(profile.outliers, 1);

const diff = structuralDiff(
  { users: [{ id: 1, name: "Ada" }], keep: true, old: "x" },
  { users: [{ id: 1, name: "Grace", admin: false }], keep: true },
);
assert.deepEqual(diff.counts, { added: 1, changed: 1, removed: 1, same: 2 });
assert.equal(diff.status["$.users[0].admin"], "add");
assert.equal(diff.status["$.users[0].name"], "chg");
assert.equal(diff.removed[0].path, "$.old");

assert.equal(formatPath(["rows", 3, "weird.key"]), "$.rows[3][\"weird.key\"]");
assert.equal(formatPath(["1bad", "x[y]"]), "$[\"1bad\"][\"x[y]\"]");

const normalizationDiff = annotateStructuralDiffHazards(structuralDiff(
  [{ "caf\u00e9": 1 }],
  [{ "cafe\u0301": 1 }],
));
assert.equal(normalizationDiff.added[0].renderHazard, "unicode-normalization");
assert.equal(normalizationDiff.removed[0].renderHazard, "unicode-normalization");
assert.match(normalizationDiff.added[0].pathEscaped, /\\u0301/);

const invisibleDiff = annotateStructuralDiffHazards(structuralDiff(
  [{ name: "admin" }],
  [{ name: "ad\u200bmin" }],
));
assert.equal(invisibleDiff.changed[0].renderHazard, "invisible-character");
assert.equal(invisibleDiff.changed[0].valueEscaped, "ad\\u200bmin");

const bidiDiff = annotateStructuralDiffHazards(structuralDiff(
  [{ name: "admin" }],
  [{ name: "ad\u202emin" }],
));
assert.equal(bidiDiff.changed[0].renderHazard, "bidi-control");
assert.equal(bidiDiff.changed[0].securityRelevant, true);

assert.equal(inspectJsonPrecision('[{"id":9007199254740991}]'), null);
const precision = inspectJsonPrecision('[{"id":9007199254740993},{"nested":{"value":-9007199254740994}}]');
assert.equal(precision.unsafeIntegerLiterals, 2);
assert.deepEqual(precision.paths, ["$[0].id", "$[1].nested.value"]);
assert.deepEqual(precision.items.map(item => item.literal), ["9007199254740993", "-9007199254740994"]);

console.log("fingerprint.test.js passed");
