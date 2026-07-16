import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  detectFormat,
  detectTOML,
  parseTOML,
  serializeTOML,
} from "../src/intelligence/data-formats/index.js";
import { generateCLIExport, runTransform } from "../src/intelligence/json-transform/index.js";

function roundTrip(value) {
  return parseTOML(serializeTOML(value));
}

function deepEqual(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

const fixtureDir = new URL("../fixtures/translator/", import.meta.url);
const [pyproject, cargo, netlify] = await Promise.all([
  readFile(new URL("pyproject.toml", fixtureDir), "utf8"),
  readFile(new URL("Cargo.toml", fixtureDir), "utf8"),
  readFile(new URL("netlify.toml", fixtureDir), "utf8"),
]);

const cases = [
  ["detects TOML table before env", () => assert.equal(detectFormat("[service]\nname = \"api\""), "toml")],
  ["does not steal conventional env", () => assert.equal(detectTOML("APP_ENV=production\nPORT=3000"), false)],
  ["parses quoted dotted keys as literal keys", () => assert.deepEqual(parseTOML("\"site.name\" = \"Latentmachine\""), { "site.name": "Latentmachine" })],
  ["parses multiline strings without stripping hashes", () => {
    assert.deepEqual(parseTOML("description = \"\"\"\nLine # keep\nLine two\n\"\"\" # trailing comment"), {
      description: "Line # keep\nLine two\n",
    });
  }],
  ["parses multiline arrays with comments", () => assert.deepEqual(parseTOML("features = [\n  \"api\",\n  \"worker\", # inline\n]"), { features: ["api", "worker"] })],
  ["parses numeric bases", () => assert.deepEqual(parseTOML("hex = 0x2A\noctal = 0o52\nbinary = 0b101010"), { hex: 42, octal: 42, binary: 42 })],
  ["parses nested inline tables", () => assert.deepEqual(parseTOML("owner = { name = \"Ana\", contact.email = \"ana@example.com\" }"), { owner: { name: "Ana", contact: { email: "ana@example.com" } } })],
  ["parses subtables below the current array table", () => assert.deepEqual(parseTOML("[[plugins]]\nname = \"search\"\n[plugins.settings]\nenabled = true"), { plugins: [{ name: "search", settings: { enabled: true } }] })],
  ["duplicate keys reject", () => assert.throws(() => parseTOML("name = \"Ana\"\nname = \"Bo\""), /duplicate key/i)],
  ["invalid escapes reject", () => assert.throws(() => parseTOML("name = \"bad\\qescape\""), /unsupported escape/i)],
  ["pyproject fixture parses", () => {
    const parsed = parseTOML(pyproject);
    assert.equal(parsed.project.name, "latent-config-tools");
    assert.equal(parsed.project.description, "Config helpers for #ops workflows.\nBuilt for small automation teams.\n");
    assert.deepEqual(parsed.project.dependencies, ["fastapi>=0.110", "pydantic>=2.7"]);
    assert.equal(parsed.tool.ruff["line-length"], 100);
  }],
  ["cargo fixture parses", () => {
    const parsed = parseTOML(cargo);
    assert.equal(parsed.package.name, "latent_cli");
    assert.deepEqual(parsed.bin, [{ name: "latent", path: "src/main.rs" }]);
  }],
  ["netlify fixture parses nested redirect headers", () => {
    const parsed = parseTOML(netlify);
    assert.equal(parsed.context.production.environment.ENABLE_CHECKER, true);
    assert.equal(parsed.redirects[0].headers["X-From"], "Netlify");
  }],
  ["round trip preserves nested config shape", () => assert.deepEqual(roundTrip({
    service: { name: "api", port: 3000, enabled: true },
    redirects: [{ from: "/old", to: "/new", status: 301 }],
  }), {
    service: { name: "api", port: 3000, enabled: true },
    redirects: [{ from: "/old", to: "/new", status: 301 }],
  })],
];

const results = cases.map(([name, run]) => {
  try {
    run();
    return { name, passed: true };
  } catch (error) {
    return { name, passed: false, error: error?.message || "Unknown error" };
  }
});

const tempDir = await mkdtemp(path.join(os.tmpdir(), "latentmachine-toml-reliability-"));
let cliFailure = null;
try {
  const task = {
    examples: [
      {
        input: "[service]\nname = \"api\"\nport = 3000\ndescription = \"\"\"\nAPI # primary\nservice\n\"\"\"",
        inputFormat: "toml",
        output: { app: "api", port: 3000, description: "API # primary\nservice\n" },
      },
      {
        input: "[service]\nname = \"web\"\nport = 8080\ndescription = \"\"\"\nWeb # public\nservice\n\"\"\"",
        inputFormat: "toml",
        output: { app: "web", port: 8080, description: "Web # public\nservice\n" },
      },
    ],
    newInput: "[service]\nname = \"worker\"\nport = 0x2328\ndescription = \"\"\"\nWorker # jobs\nservice\n\"\"\"",
    inputFormat: "toml",
    outputFormat: "json",
  };
  const result = runTransform(task);
  const cliPath = path.join(tempDir, "latentmachine-toml-reliability-cli.mjs");
  await writeFile(cliPath, generateCLIExport(result, {
    filename: "latentmachine-toml-reliability-cli.mjs",
    sampleInputText: task.newInput,
    sampleOutput: result.output,
  }), "utf8");

  const autoRun = spawnSync(process.execPath, [cliPath, "--output", "json"], {
    input: task.newInput,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (autoRun.status !== 0) throw new Error(`generated CLI auto-detect failed: ${autoRun.stderr}`);
  if (!deepEqual(JSON.parse(autoRun.stdout), result.output)) throw new Error(`generated CLI output mismatch: ${autoRun.stdout}`);

  const explicitRun = spawnSync(process.execPath, [cliPath, "--format", "toml", "--output", "json"], {
    input: task.newInput,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (explicitRun.status !== 0) throw new Error(`generated CLI explicit TOML failed: ${explicitRun.stderr}`);
  if (!deepEqual(JSON.parse(explicitRun.stdout), result.output)) throw new Error("generated CLI explicit TOML output mismatch");

  const selfTest = spawnSync(process.execPath, [cliPath, "--self-test"], { encoding: "utf8" });
  if (selfTest.status !== 0 || !selfTest.stdout.includes("self-test passed")) {
    throw new Error(`generated CLI TOML self-test failed: ${selfTest.stderr || selfTest.stdout}`);
  }
} catch (error) {
  cliFailure = error?.message || String(error);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

if (cliFailure) results.push({ name: "generated CLI handles multiline and numeric TOML", passed: false, error: cliFailure });
else results.push({ name: "generated CLI handles multiline and numeric TOML", passed: true });

const failed = results.filter(result => !result.passed);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map(result => result.name) }, null, 2));

if (failed.length) {
  console.error(failed.map(result => `- ${result.name}: ${result.error}`).join("\n"));
  process.exit(1);
}
