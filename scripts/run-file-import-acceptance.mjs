import assert from "node:assert/strict";
import {
  FILE_IMPORT_MAX_BYTES,
  importedFileFormat,
  unsafeTextReason,
  validateImportFile,
  validateImportText,
} from "../src/local/file-import.js";
import { normalizeVerifyInputText } from "../src/local/verify-input.js";

const file = (name, size = 128) => ({ name, size });

const cases = [
  ["csv accepted", () => assert.deepEqual(validateImportFile(file("data.csv")), { ok: true, format: "csv" })],
  ["tsv accepted as csv-compatible", () => assert.deepEqual(validateImportFile(file("data.tsv")), { ok: true, format: "csv" })],
  ["env accepted", () => assert.deepEqual(validateImportFile(file(".env")), { ok: true, format: "env" })],
  ["json accepted", () => assert.deepEqual(validateImportFile(file("DATA.JSON")), { ok: true, format: "json" })],
  ["sql accepted", () => assert.deepEqual(validateImportFile(file("seed.sql")), { ok: true, format: "sql" })],
  ["xml accepted", () => assert.deepEqual(validateImportFile(file("feed.xml")), { ok: true, format: "xml" })],
  ["toml accepted", () => assert.deepEqual(validateImportFile(file("config.toml")), { ok: true, format: "toml" })],
  ["yaml accepted", () => assert.deepEqual(validateImportFile(file("config.yaml")), { ok: true, format: "yaml" })],
  ["yml accepted", () => assert.deepEqual(validateImportFile(file("config.yml")), { ok: true, format: "yaml" })],
  ["txt rejected", () => assert.equal(validateImportFile(file("data.txt")).ok, false)],
  ["exe rejected", () => assert.equal(validateImportFile(file("data.exe")).ok, false)],
  ["large rejected", () => assert.equal(validateImportFile(file("data.csv", FILE_IMPORT_MAX_BYTES + 1)).ok, false)],
  ["scoped larger limit accepted", () => assert.equal(validateImportFile(file("data.csv", FILE_IMPORT_MAX_BYTES + 1), { maxBytes: 25 * 1024 * 1024 }).ok, true)],
  ["null byte rejected", () => assert.equal(validateImportText("a\0b").ok, false)],
  ["control char rejected", () => assert.equal(validateImportText("a\x07b").ok, false)],
  ["tabs and newlines allowed", () => assert.deepEqual(validateImportText("a\tb\nc"), { ok: true })],
  ["format detection by extension", () => assert.equal(importedFileFormat(file("people.csv")), "csv")],
  ["tsv format detection by extension", () => assert.equal(importedFileFormat(file("people.tsv")), "csv")],
  ["env format detection by extension", () => assert.equal(importedFileFormat(file(".env")), "env")],
  ["xml format detection by extension", () => assert.equal(importedFileFormat(file("rss.xml")), "xml")],
  ["toml format detection by extension", () => assert.equal(importedFileFormat(file("Cargo.toml")), "toml")],
  ["sql format detection by extension", () => assert.equal(importedFileFormat(file("seed.sql")), "sql")],
  ["yaml format detection by extension", () => assert.equal(importedFileFormat(file("config.yaml")), "yaml")],
  ["unsafe text reports clean text as safe", () => assert.equal(unsafeTextReason("Name,Email\nAna,a@example.com"), "")],
  ["verify paste strips fenced json", () => assert.equal(normalizeVerifyInputText("```json\n[{\"id\":1}]\n```"), "[{\"id\":1}]")],
  ["verify paste strips unlabeled fence", () => assert.equal(normalizeVerifyInputText("```\nid,name\n1,Ana\n```"), "id,name\n1,Ana")],
  ["verify paste strips standalone format label", () => assert.equal(normalizeVerifyInputText("CSV:\nid,name\n1,Ana"), "id,name\n1,Ana")],
  ["verify paste strips inline data label", () => assert.equal(normalizeVerifyInputText("JSON: [{\"id\":1}]"), "[{\"id\":1}]")],
  ["verify paste strips bom", () => assert.equal(normalizeVerifyInputText("\uFEFF[{\"id\":1}]"), "[{\"id\":1}]")],
  ["verify paste preserves ordinary csv headers", () => assert.equal(normalizeVerifyInputText("name,json\nAna,true"), "name,json\nAna,true")],
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
