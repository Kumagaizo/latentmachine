import assert from "node:assert/strict";
import { detectCSV, detectCSVSeparator, detectEnv, detectFormat, detectSQL, detectTOML, detectUnsupportedFormat, detectXML, parseCSV, parseEnv, parseSQLInsert, parseSQLInsertWithWarnings, parseTOML, parseWithFormat, parseXML, parseYAMLWithWarnings, serializeWithFormat } from "../src/intelligence/data-formats/index.js";
import { runTransform } from "../src/intelligence/json-transform/translator.js";

const cases = [
  ["csv bom is ignored", () => assert.deepEqual(parseCSV("\uFEFFname,email\nAna,ana@example.com", { singleRowAsObject: true }), { name: "Ana", email: "ana@example.com" })],
  ["csv quoted newline is preserved", () => assert.deepEqual(parseCSV("name,note\nAna,\"Line 1\nLine 2\"", { singleRowAsObject: true }), { name: "Ana", note: "Line 1\nLine 2" })],
  ["csv duplicate headers fail clearly", () => assert.throws(() => parseCSV("name,name\nAna,Bo"), /duplicated/)],
  ["semicolon csv is detected", () => assert.equal(detectCSVSeparator("name;email\nAna;ana@example.com"), ";")],
  ["semicolon csv parses", () => assert.deepEqual(parseCSV("name;email\nAna;ana@example.com", { singleRowAsObject: true }), { name: "Ana", email: "ana@example.com" })],
  ["tsv is detected as csv-compatible", () => assert.equal(detectCSV("name\temail\nAna\tana@example.com"), true)],
  ["tsv parses", () => assert.deepEqual(parseCSV("name\temail\nAna\tana@example.com", { singleRowAsObject: true }), { name: "Ana", email: "ana@example.com" })],
  ["csv formula values are escaped on serialize", () => assert.equal(serializeWithFormat({ name: "Ana", note: "=IMPORTXML(\"https://example.com\")" }, "csv"), "name,note\nAna,\"'=IMPORTXML(\"\"https://example.com\"\")\"")],
  ["csv phone plus values are not treated as formulas", () => assert.equal(serializeWithFormat({ phone: "+14155550123" }, "csv"), "phone\n+14155550123")],
  ["csv object cells stay json serialized", () => assert.equal(serializeWithFormat({ tags: ["a", "b"] }, "csv"), "tags\n\"[\"\"a\"\",\"\"b\"\"]\"")],
  ["env is auto detected", () => assert.equal(detectFormat("APP_ENV=production\nPORT=3000"), "env")],
  ["env detector accepts common single key", () => assert.equal(detectEnv("DATABASE_URL=postgres://localhost/app"), true)],
  ["env parses all values as strings", () => assert.deepEqual(parseEnv("PORT=3000\nDEBUG=true\nEMPTY="), { PORT: "3000", DEBUG: "true", EMPTY: "" })],
  ["env parses quoted values and comments", () => assert.deepEqual(parseEnv("APP_NAME=\"Latent Machine\"\nSECRET='a#b'\nURL=https://example.com/path # comment"), { APP_NAME: "Latent Machine", SECRET: "a#b", URL: "https://example.com/path" })],
  ["env parses export prefix and double quoted escapes", () => assert.deepEqual(parseEnv("export NOTE=\"Line 1\\nLine 2\\tTabbed\""), { NOTE: "Line 1\nLine 2\tTabbed" })],
  ["env parses multiline quoted values", () => assert.deepEqual(parseEnv("PRIVATE_KEY=\"line1\nline2\""), { PRIVATE_KEY: "line1\nline2" })],
  ["env preserves quoted padding", () => assert.deepEqual(parseEnv("PADDED=\"  keep spaces  \""), { PADDED: "  keep spaces  " })],
  ["env preserves hash fragments without whitespace", () => assert.equal(parseEnv("PUBLIC_URL=https://example.com/app#section").PUBLIC_URL, "https://example.com/app#section")],
  ["env preserves unquoted windows paths", () => assert.equal(parseEnv("WINDOWS_PATH=C:\\Users\\app\\data").WINDOWS_PATH, "C:\\Users\\app\\data")],
  ["env supports spaces around equals", () => assert.deepEqual(parseEnv("APP_ENV = production"), { APP_ENV: "production" })],
  ["env preserves variable references", () => assert.equal(parseEnv("API_URL=${HOST}/v1").API_URL, "${HOST}/v1")],
  ["env comments only fail clearly", () => assert.throws(() => parseEnv("# comment\n\n# another"), /no variables found/i)],
  ["env invalid lines fail clearly", () => assert.throws(() => parseEnv("APP_ENV=production\nnot a variable"), /missing '='/i)],
  ["env unexpected quoted trailing text fails clearly", () => assert.throws(() => parseEnv("APP_ENV=\"production\" trailing"), /unexpected text/i)],
  ["env duplicate keys fail clearly", () => assert.throws(() => parseEnv("TOKEN=a\nTOKEN=b"), /duplicate key/i)],
  ["env serializes flat objects", () => assert.equal(serializeWithFormat({ APP_ENV: "production", EMPTY: "", NOTE: "Line 1\nLine 2" }, "env"), "APP_ENV=production\nEMPTY=\"\"\nNOTE=\"Line 1\\nLine 2\"\n")],
  ["env serializes empty flat object to empty text", () => assert.equal(serializeWithFormat({}, "env"), "")],
  ["env rejects nested serialization", () => assert.throws(() => serializeWithFormat({ APP: { NAME: "api" } }, "env"), /Flatten the structure first/i)],
  ["sql insert is auto detected", () => assert.equal(detectFormat("INSERT INTO users (id, name) VALUES (1, 'Ana');"), "sql")],
  ["sql detector accepts insert and rejects select", () => {
    assert.equal(detectSQL("INSERT INTO users VALUES (1, 'Ana');"), true);
    assert.equal(detectSQL("SELECT * FROM users;"), false);
    assert.equal(detectSQL("CREATE TABLE users (id int);"), false);
  }],
  ["sql insert with columns parses to object rows", () => assert.deepEqual(parseSQLInsert("INSERT INTO users (id, name, email) VALUES (1, 'Ana', 'ana@example.com');"), [{ id: 1, name: "Ana", email: "ana@example.com" }])],
  ["sql insert without columns parses to array rows", () => assert.deepEqual(parseSQLInsert("INSERT INTO users VALUES (1, 'Ana', 'ana@example.com');"), [[1, "Ana", "ana@example.com"]])],
  ["sql multi-row insert parses to one row array", () => assert.deepEqual(parseSQLInsert("INSERT INTO users (id, name) VALUES (1, 'Ana'), (2, 'Bo');"), [{ id: 1, name: "Ana" }, { id: 2, name: "Bo" }])],
  ["sql multiple insert statements combine same table", () => assert.deepEqual(parseSQLInsert("INSERT INTO users (id, name) VALUES (1, 'Ana'); INSERT INTO users (id, name) VALUES (2, 'Bo');"), [{ id: 1, name: "Ana" }, { id: 2, name: "Bo" }])],
  ["sql multiple tables group by table name", () => assert.deepEqual(parseSQLInsert("INSERT INTO users (id, name) VALUES (1, 'Ana'); INSERT INTO posts (id, title) VALUES (10, 'Hello');"), { users: [{ id: 1, name: "Ana" }], posts: [{ id: 10, title: "Hello" }] })],
  ["sql escaping handles doubled and backslash quotes", () => assert.deepEqual(parseSQLInsert("INSERT INTO users (name, note) VALUES ('O''Neil', 'it\\'s fine');"), [{ name: "O'Neil", note: "it's fine" }])],
  ["sql prefixed escaped strings are decoded", () => assert.deepEqual(parseSQLInsert("INSERT INTO users (name, note) VALUES (N'Ana', E'Line 1\\nLine 2');"), [{ name: "Ana", note: "Line 1\nLine 2" }])],
  ["sql scalars parse null booleans integers and floats", () => assert.deepEqual(parseSQLInsert("INSERT INTO flags (id, active, archived, score, ratio, note) VALUES (1, TRUE, FALSE, -12, 3.14, NULL);"), [{ id: 1, active: true, archived: false, score: -12, ratio: 3.14, note: null }])],
  ["sql quoted identifiers are decoded", () => assert.deepEqual(parseSQLInsert("INSERT INTO `users` (`first name`, \"role\") VALUES ('Ana', 'admin');"), [{ "first name": "Ana", role: "admin" }])],
  ["sql expressions become descriptive strings", () => assert.deepEqual(parseSQLInsert("INSERT INTO events (id, created_at, code) VALUES (1, NOW(), UUID());"), [{ id: 1, created_at: "[SQL expression: NOW()]", code: "[SQL expression: UUID()]" }])],
  ["sql parses through format wrapper", () => assert.deepEqual(parseWithFormat("INSERT INTO users (id, name) VALUES (1, 'Ana');", "sql"), [{ id: 1, name: "Ana" }])],
  ["sql dump comments and wrapper statements are ignored", () => assert.deepEqual(parseSQLInsert("-- dump header\nCREATE TABLE users (id int);\n/* seed rows */\nLOCK TABLES users WRITE;\nINSERT INTO users (id, note) VALUES (1, 'keep -- not comment'), (2, 'keep # too');\nUNLOCK TABLES;"), [{ id: 1, note: "keep -- not comment" }, { id: 2, note: "keep # too" }])],
  ["sql insert modifiers are accepted", () => assert.deepEqual(parseSQLInsert("INSERT IGNORE INTO users (id, name) VALUES (1, 'Ana'); INSERT LOW_PRIORITY INTO users (id, name) VALUE (2, 'Bo');"), [{ id: 1, name: "Ana" }, { id: 2, name: "Bo" }])],
  ["sql replace and sqlite insert-or-replace are accepted", () => assert.deepEqual(parseSQLInsert("REPLACE INTO users (id, name) VALUES (1, 'Ana'); INSERT OR REPLACE INTO users (id, name) VALUES (2, 'Bo');"), [{ id: 1, name: "Ana" }, { id: 2, name: "Bo" }])],
  ["sql insert set syntax parses to object rows", () => assert.deepEqual(parseSQLInsert("INSERT INTO users SET id = 1, name = 'Ana', active = TRUE;"), [{ id: 1, name: "Ana", active: true }])],
  ["sql upsert and returning tails are ignored after rows", () => assert.deepEqual(parseSQLInsert("INSERT INTO users (id, name) VALUES (1, 'Ana') ON DUPLICATE KEY UPDATE name = VALUES(name); INSERT INTO users (id, name) VALUES (2, 'Bo') RETURNING id;"), [{ id: 1, name: "Ana" }, { id: 2, name: "Bo" }])],
  ["sql conflict tails are ignored after rows", () => assert.deepEqual(parseSQLInsert("INSERT INTO users (id, name) VALUES (1, 'Ana') ON CONFLICT(id) DO UPDATE SET name = excluded.name;"), [{ id: 1, name: "Ana" }])],
  ["sql bracket identifiers are decoded", () => assert.deepEqual(parseSQLInsert("INSERT INTO [users] ([first name], [role]) VALUES ('Ana', 'admin');"), [{ "first name": "Ana", role: "admin" }])],
  ["sql duplicate columns fail clearly", () => assert.throws(() => parseSQLInsert("INSERT INTO users (id, id) VALUES (1, 2);"), /duplicate column/i)],
  ["sql wrapper statements surface ignored-statement warnings", () => {
    const parsed = parseSQLInsertWithWarnings("SET sql_mode='NO_AUTO_VALUE_ON_ZERO';\nCREATE TABLE users (id int);\nINSERT INTO users (id, name) VALUES (1, 'Ana');");
    assert.deepEqual(parsed.value, [{ id: 1, name: "Ana" }]);
    assert.equal(parsed.stats.skippedStatements, 2);
    assert.match(parsed.warnings.map(warning => warning.message).join("\n"), /Ignored 2 non-INSERT SQL statements/i);
  }],
  ["sql insert select fails with row-data guidance", () => assert.throws(() => parseSQLInsert("INSERT INTO archive SELECT * FROM users;"), /VALUES or INSERT \.\.\. SET|INSERT \.\.\. VALUES/i)],
  ["sql default values fails with clear guidance", () => assert.throws(() => parseSQLInsert("INSERT INTO users DEFAULT VALUES;"), /DEFAULT VALUES/i)],
  ["sql row limit fails clearly", () => assert.throws(() => parseSQLInsert("INSERT INTO users (id) VALUES (1), (2);", { maxRows: 1 }), /limited to 1 rows/i)],
  ["sql statement limit fails clearly", () => assert.throws(() => parseSQLInsert("INSERT INTO users (id) VALUES (1); INSERT INTO users (id) VALUES (2);", { maxStatements: 1 }), /limited to 1 INSERT statements/i)],
  ["sql character limit fails clearly", () => assert.throws(() => parseSQLInsert("INSERT INTO users (id) VALUES (1);", { maxCharacters: 10 }), /limited to 10 characters/i)],
  ["sql output serialization fails clearly", () => assert.throws(() => serializeWithFormat([{ id: 1 }], "sql"), /input-only/i)],
  ["toml is auto detected", () => assert.equal(detectFormat("[server]\nhost = \"localhost\"\nport = 8080"), "toml")],
  ["toml detector does not steal env", () => assert.equal(detectTOML("APP_ENV=production\nPORT=3000"), false)],
  ["env with typed-looking values still auto detects as env", () => assert.equal(detectFormat("DEBUG=true\nPORT=3000"), "env")],
  ["toml lower-case typed assignment is detected", () => assert.equal(detectFormat("port = 3000"), "toml")],
  ["toml parses tables and typed values", () => assert.deepEqual(parseTOML("[server]\nhost = \"localhost\"\nport = 8080\nenabled = true\nstarted = 2024-01-15"), { server: { host: "localhost", port: 8080, enabled: true, started: "2024-01-15" } })],
  ["toml parses dotted keys", () => assert.deepEqual(parseTOML("server.host = \"localhost\"\nserver.port = 8080"), { server: { host: "localhost", port: 8080 } })],
  ["toml parses arrays and inline tables", () => assert.deepEqual(parseTOML("ports = [8000, 8001]\nowner = { name = \"Ana\", active = true }"), { ports: [8000, 8001], owner: { name: "Ana", active: true } })],
  ["toml parses array tables", () => assert.deepEqual(parseTOML("[[fruits]]\nname = \"apple\"\n\n[[fruits]]\nname = \"banana\""), { fruits: [{ name: "apple" }, { name: "banana" }] })],
  ["toml duplicate keys fail clearly", () => assert.throws(() => parseTOML("name = \"Ana\"\nname = \"Bo\""), /duplicate key/i)],
  ["toml serializes nested objects", () => assert.equal(serializeWithFormat({ server: { host: "localhost", port: 8080 } }, "toml"), "[server]\nhost = \"localhost\"\nport = 8080\n")],
  ["toml serializes array tables", () => assert.equal(serializeWithFormat({ fruits: [{ name: "apple" }, { name: "banana" }] }, "toml"), "[[fruits]]\nname = \"apple\"\n\n[[fruits]]\nname = \"banana\"\n")],
  ["toml translates through format wrapper", () => assert.deepEqual(runTransform({
    examples: [
      { input: "[service]\nname = \"api\"\nport = 3000", inputFormat: "toml", output: { service: "api", port: 3000 } },
      { input: "[service]\nname = \"web\"\nport = 8080", inputFormat: "toml", output: { service: "web", port: 8080 } },
    ],
    newInput: "[service]\nname = \"worker\"\nport = 9000",
    inputFormat: "toml",
    outputFormat: "json",
  }).output, { service: "worker", port: 9000 })],
  ["xml is auto detected", () => assert.equal(detectFormat("<?xml version=\"1.0\"?><user><name>Ana</name></user>"), "xml")],
  ["xml detector accepts html-like fragments", () => assert.equal(detectXML("<article><h1>Hello</h1></article>"), true)],
  ["xml parses elements and attributes", () => assert.deepEqual(parseXML("<user id=\"1\"><name>Ana</name><active>true</active></user>"), { user: { "@id": "1", name: "Ana", active: "true" } })],
  ["xml parses repeated sibling elements", () => assert.deepEqual(parseXML("<items><item>A</item><item>B</item></items>"), { items: { item: ["A", "B"] } })],
  ["xml parses mixed content as text", () => assert.deepEqual(parseXML("<p>Hello <em>world</em></p>"), { p: { em: "world", "#text": "Hello " } })],
  ["xml parses cdata and entities", () => assert.deepEqual(parseXML("<note><![CDATA[A < B]]> &amp; &#x43;</note>"), { note: "A < B & C" })],
  ["xml strips namespace prefixes and declarations", () => assert.deepEqual(parseXML("<ns:user xmlns:ns=\"urn:test\"><ns:name>Ana</ns:name></ns:user>"), { user: { name: "Ana" } })],
  ["xml parses self closing elements as null", () => assert.deepEqual(parseXML("<root><empty/><named value=\"x\"/></root>"), { root: { empty: null, named: { "@value": "x" } } })],
  ["xml rejects malformed nesting clearly", () => assert.throws(() => parseXML("<root><name>Ana</root>"), /line .*expected <\/name>/i)],
  ["xml serializes nested objects", () => assert.equal(serializeWithFormat({ user: { "@id": "1", name: "Ana", active: true, empty: null } }, "xml"), "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<user id=\"1\">\n  <name>Ana</name>\n  <active>true</active>\n  <empty/>\n</user>\n")],
  ["xml translates through format wrapper", () => assert.deepEqual(runTransform({
    examples: [
      { input: "<user id=\"1\"><name>Ana</name><role>admin</role></user>", inputFormat: "xml", output: { id: "1", person: "Ana", access: "admin" } },
      { input: "<user id=\"2\"><name>Bo</name><role>viewer</role></user>", inputFormat: "xml", output: { id: "2", person: "Bo", access: "viewer" } },
    ],
    newInput: "<user id=\"3\"><name>Tim</name><role>editor</role></user>",
    inputFormat: "xml",
    outputFormat: "json",
  }).output, { id: "3", person: "Tim", access: "editor" })],
  ["kubernetes yaml is supported", () => assert.equal(detectUnsupportedFormat("apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api"), null)],
  ["yaml is auto detected", () => assert.equal(detectFormat("apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api"), "yaml")],
  ["yaml parses nested objects", () => assert.deepEqual(parseWithFormat("metadata:\n  name: api\nspec:\n  replicas: 3", "yaml"), { metadata: { name: "api" }, spec: { replicas: 3 } })],
  ["yaml norway value remains string", () => assert.equal(parseWithFormat("country: NO", "yaml").country, "NO")],
  ["yaml yes remains string", () => assert.equal(parseWithFormat("active: yes", "yaml").active, "yes")],
  ["yaml duplicate keys fail clearly", () => assert.throws(() => parseWithFormat("name: Ana\nname: Bo", "yaml"), /Map keys must be unique|duplicate/i)],
  ["yaml explicit tags fail clearly", () => assert.throws(() => parseWithFormat("value: !!str 123", "yaml"), /explicit tags are not supported/i)],
  ["yaml serializes dangerous strings quoted", () => assert.match(serializeWithFormat({ country: "NO", active: "yes" }, "yaml"), /country: "NO"\nactive: "yes"/)],
  ["yaml multi-document warning is captured", () => assert.match(parseYAMLWithWarnings("name: Ana\n---\nname: Bo").warnings.join("\n"), /multiple documents/i)],
  ["terraform hcl is detected as unsupported", () => assert.equal(detectUnsupportedFormat("resource \"aws_instance\" \"api\" {\n  instance_type = \"t3.large\"\n}")?.id, "terraform-hcl")],
  ["helm templates are detected as unsupported", () => assert.equal(detectUnsupportedFormat("resources:\n  cpu: {{ .Values.cpu }}")?.id, "helm-template")],
  ["helm templates block before yaml parsing", () => assert.throws(() => runTransform({
    examples: [{ input: { resources: { cpu: "500m" } }, output: { resources: { limits: { cpu: "500m" } } } }],
    newInput: "resources:\n  cpu: {{ .Values.cpu }}",
    outputFormat: "json",
  }), /Helm templates are not supported yet/)],
  ["yaml translates through format wrapper", () => assert.deepEqual(runTransform({
    examples: [
      { input: "name: Ana\nrole: admin", inputFormat: "yaml", output: { person: "Ana", access: "admin" } },
      { input: "name: Bo\nrole: viewer", inputFormat: "yaml", output: { person: "Bo", access: "viewer" } },
    ],
    newInput: "name: Tim\nrole: editor",
    inputFormat: "yaml",
    outputFormat: "json",
  }).output, { person: "Tim", access: "editor" })],
  ["yaml translator exposes format warnings", () => assert.match(runTransform({
    examples: [
      { input: "name: Ana", inputFormat: "yaml", output: { person: "Ana" } },
      { input: "name: Bo", inputFormat: "yaml", output: { person: "Bo" } },
    ],
    newInput: "name: Tim\n---\nname: Mina",
    inputFormat: "yaml",
    outputFormat: "json",
  }).formatWarnings.map(warning => warning.message).join("\n"), /multiple documents/i)],
  ["env translates through format wrapper", () => assert.deepEqual(runTransform({
    examples: [
      { input: "APP_NAME=api\nAPP_ENV=production", inputFormat: "env", output: { service: "api", environment: "production" } },
      { input: "APP_NAME=web\nAPP_ENV=staging", inputFormat: "env", output: { service: "web", environment: "staging" } },
    ],
    newInput: "APP_NAME=worker\nAPP_ENV=production",
    inputFormat: "env",
    outputFormat: "json",
  }).output, { service: "worker", environment: "production" })],
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
