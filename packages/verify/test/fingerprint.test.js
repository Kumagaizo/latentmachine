import assert from "node:assert/strict";
import { canonicalize, fingerprint, formatPath, profileStructure, structuralDiff } from "../src/index.js";

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

console.log("fingerprint.test.js passed");
