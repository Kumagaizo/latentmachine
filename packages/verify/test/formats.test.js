import assert from "node:assert/strict";
import { detectFormat, parseWithFormat, serializeWithFormat } from "../src/index.js";

assert.equal(detectFormat('[{"id":1}]'), "json");
assert.equal(detectFormat("id,name\n1,Ada"), "csv");
assert.equal(detectFormat("name: Ada\nid: 1"), "yaml");
assert.equal(detectFormat('name = "Ada"\nid = 1'), "toml");
assert.equal(detectFormat("<users><user><id>1</id></user></users>"), "xml");
assert.equal(detectFormat("API_KEY=abc123\nDEBUG=true"), "env");

{
  const parsed = parseWithFormat('[{"id":1}]', "json");
  assert.deepEqual(parsed, [{ id: 1 }]);
  assert.equal(serializeWithFormat(parsed, "json"), '[\n  {\n    "id": 1\n  }\n]');
}

{
  const parsed = parseWithFormat("id,name\n1,Ada", "csv");
  assert.deepEqual(parsed, [{ id: "1", name: "Ada" }]);
  assert.match(serializeWithFormat(parsed, "csv"), /id,name/);
}

{
  const parsed = parseWithFormat("name: Ada\nid: 1", "yaml");
  assert.equal(parsed.name, "Ada");
  assert.match(serializeWithFormat(parsed, "yaml"), /name: Ada/);
}

{
  const parsed = parseWithFormat('name = "Ada"\nid = 1', "toml");
  assert.equal(parsed.name, "Ada");
  assert.match(serializeWithFormat(parsed, "toml"), /name = "Ada"/);
}

{
  const parsed = parseWithFormat("<user><id>1</id><name>Ada</name></user>", "xml");
  assert.ok(parsed.user || parsed.id);
  assert.match(serializeWithFormat(parsed, "xml"), /<.*>/);
}

{
  const parsed = parseWithFormat("API_KEY=abc123\nDEBUG=true", "env");
  assert.equal(parsed.API_KEY, "abc123");
  assert.match(serializeWithFormat(parsed, "env"), /API_KEY=abc123/);
}

for (const [format, text] of [
  ["json", "{\"__proto__\":{\"polluted\":true}}"],
  ["csv", "__proto__,name\nx,Ada"],
  ["yaml", "__proto__:\n  polluted: true"],
  ["toml", "__proto__ = \"polluted\""],
  ["xml", "<__proto__><polluted>true</polluted></__proto__>"],
  ["env", "__proto__=polluted"],
  ["sql", "INSERT INTO users (__proto__) VALUES ('polluted');"],
]) {
  assert.throws(
    () => parseWithFormat(text, format),
    /unsafe key/i,
    `${format} should reject unsafe object keys`,
  );
}
assert.equal({}.polluted, undefined);

console.log("formats.test.js passed");
