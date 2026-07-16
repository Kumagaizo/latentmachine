import assert from "node:assert/strict";
import {
  detectFormat,
  detectUnsupportedFormat,
  parseYAML,
  parseYAMLWithWarnings,
  serializeYAML,
} from "../src/intelligence/data-formats/index.js";

function roundTrip(value) {
  return parseYAML(serializeYAML(value));
}

const aliasBomb = `
a: &a ["lol", "lol", "lol"]
b: &b [*a, *a, *a]
c: &c [*b, *b, *b]
d: &d [*c, *c, *c]
e: &e [*d, *d, *d]
f: [*e, *e, *e]
`;

const cases = [
  ["detects yaml mapping", () => assert.equal(detectFormat("name: Ana\nrole: admin"), "yaml")],
  ["detects yaml sequence", () => assert.equal(detectFormat("- name: Ana\n  role: admin"), "yaml")],
  ["does not steal valid json", () => assert.equal(detectFormat("{\"name\":\"Ana\"}"), "json")],
  ["duplicate keys reject", () => assert.throws(() => parseYAML("name: Ana\nname: Bo"), /Map keys must be unique|duplicate/i)],
  ["multi-document parses first with warning", () => {
    const result = parseYAMLWithWarnings("name: Ana\n---\nname: Bo");
    assert.deepEqual(result.value, { name: "Ana" });
    assert.match(result.warnings.join("\n"), /multiple documents/i);
  }],
  ["anchors and merge keys resolve", () => assert.deepEqual(parseYAML("defaults: &defaults\n  timeout: 30\nserver:\n  <<: *defaults\n  name: prod"), { defaults: { timeout: 30 }, server: { timeout: 30, name: "prod" } })],
  ["alias expansion is bounded", () => assert.throws(() => parseYAML(aliasBomb), /Excessive alias count|alias/i)],
  ["explicit local tags reject", () => assert.throws(() => parseYAML("value: !custom 123"), /explicit tags are not supported/i)],
  ["explicit global tags reject", () => assert.throws(() => parseYAML("value: !!str 123"), /explicit tags are not supported/i)],
  ["norway problem values stay strings", () => assert.deepEqual(parseYAML("country: NO\nyes_value: yes\non_value: on\noff_value: off"), { country: "NO", yes_value: "yes", on_value: "on", off_value: "off" })],
  ["true false stay booleans", () => assert.deepEqual(parseYAML("active: true\ndisabled: false"), { active: true, disabled: false })],
  ["legacy octal-looking number is decimal", () => assert.equal(parseYAML("permissions: 0777").permissions, 777)],
  ["version-like number remains string", () => assert.equal(parseYAML("version: 9.5.25").version, "9.5.25")],
  ["date-like scalar remains string", () => assert.equal(parseYAML("released: 2024-01-15").released, "2024-01-15")],
  ["literal block preserves newlines", () => assert.deepEqual(parseYAML("bio: |\n  Line one\n  Line two"), { bio: "Line one\nLine two\n" })],
  ["folded block folds lines", () => assert.deepEqual(parseYAML("bio: >\n  Line one\n  Line two"), { bio: "Line one Line two\n" })],
  ["invalid indentation gives location", () => assert.throws(() => parseYAML("root:\n child: ok\n  bad: nope"), /line/i)],
  ["top-level scalar rejects", () => assert.throws(() => parseYAML("just a string"), /top-level value must be an object or array/i)],
  ["empty yaml rejects", () => assert.throws(() => parseYAML("  \n"), /input is empty/i)],
  ["oversized yaml rejects", () => assert.throws(() => parseYAML(`name: ${"x".repeat(1_000_001)}`), /exceeds 1MB/i)],
  ["comments are stripped", () => assert.deepEqual(parseYAML("# owner\nname: Ana # inline\nrole: admin"), { name: "Ana", role: "admin" })],
  ["yaml sequence becomes records", () => assert.deepEqual(parseYAML("- name: Ana\n  role: admin\n- name: Bo\n  role: viewer"), [{ name: "Ana", role: "admin" }, { name: "Bo", role: "viewer" }])],
  ["safe strings serialize plain", () => assert.match(serializeYAML({ person: "Tim", city: "Berlin", role: "admin" }), /person: Tim\ncity: Berlin\nrole: admin/)],
  ["dangerous strings serialize quoted", () => assert.match(serializeYAML({ country: "NO", flag: "yes", enabled: "on", released: "2024-01-15" }), /country: "NO"\nflag: "yes"\nenabled: "on"\nreleased: "2024-01-15"/)],
  ["round trip preserves structured data", () => assert.deepEqual(roundTrip({ name: "Ana", flags: ["NO", "yes"], config: { port: 3000, active: true } }), { name: "Ana", flags: ["NO", "yes"], config: { port: 3000, active: true } })],
  ["helm templates remain unsupported", () => assert.equal(detectUnsupportedFormat("resources:\n  cpu: {{ .Values.cpu }}")?.id, "helm-template")],
  ["terraform hcl remains unsupported", () => assert.equal(detectUnsupportedFormat("resource \"aws_instance\" \"api\" {\n  instance_type = \"t3.large\"\n}")?.id, "terraform-hcl")],
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
