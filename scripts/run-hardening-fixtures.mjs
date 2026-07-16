import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWithFormat } from "../src/intelligence/data-formats/index.js";
import { generateCLIExport } from "../src/intelligence/json-transform/exporters.js";
import { runTransform } from "../src/intelligence/json-transform/translator.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(root, "fixtures", "hardening");

async function readFixture(name) {
  return readFile(path.join(fixtureDir, name), "utf8");
}

function normalize(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").trim();
}

function parseJson(text) {
  return JSON.parse(text);
}

function assertSerialized(result, expected) {
  if (!expected) return;
  if (result.outputFormat === "json") {
    assert.deepEqual(JSON.parse(result.serializedOutput), expected);
    return;
  }
  assert.equal(normalize(result.serializedOutput), normalize(expected));
}

const cases = [
  {
    id: "fixture-stripe-payment-json-to-json",
    fixture: "stripe-payment.json",
    task(input) {
      return {
        examples: [
          { input: { id: "pi_100", amount: 1299, currency: "usd", customer: "cus_100", metadata: { order_id: "ORDER-100", account_id: "00100" } }, output: { payment_id: "pi_100", amount_cents: 1299, currency: "USD", customer_id: "cus_100", order_id: "ORDER-100", account_id: "00100" } },
          { input: { id: "pi_200", amount: 5900, currency: "eur", customer: "cus_200", metadata: { order_id: "ORDER-200", account_id: "00200" } }, output: { payment_id: "pi_200", amount_cents: 5900, currency: "EUR", customer_id: "cus_200", order_id: "ORDER-200", account_id: "00200" } },
        ],
        newInput: parseJson(input),
        outputFormat: "json",
      };
    },
    expectedOutput: { payment_id: "pi_300", amount_cents: 24075, currency: "USD", customer_id: "cus_300", order_id: "ORDER-300", account_id: "00123" },
    expectedStatus: "safe",
  },
  {
    id: "fixture-shopify-product-json-to-csv",
    fixture: "shopify-product.json",
    task(input) {
      return {
        examples: [
          { input: { id: 101, title: "Desk Lamp", vendor: "Latent Supply", product_type: "Lighting", status: "active", variants: [{ sku: "DL-001", price: "39.00", inventory_quantity: 12 }] }, output: "product_id,title,sku,status\n101,Desk Lamp,DL-001,ACTIVE", outputFormat: "csv" },
          { input: { id: 202, title: "Wall Shelf", vendor: "Latent Supply", product_type: "Storage", status: "draft", variants: [{ sku: "WS-002", price: "55.00", inventory_quantity: 4 }] }, output: "product_id,title,sku,status\n202,Wall Shelf,WS-002,DRAFT", outputFormat: "csv" },
        ],
        newInput: parseJson(input),
        outputFormat: "csv",
      };
    },
    expectedOutput: { product_id: "303", title: "Cable Box", sku: "CB-003", status: "ACTIVE" },
    expectedSerialized: "product_id,title,sku,status\n303,Cable Box,CB-003,ACTIVE",
    expectedStatus: "ambiguous",
  },
  {
    id: "fixture-hubspot-contacts-csv-to-json-batch",
    fixture: "hubspot-contacts.csv",
    task(input) {
      return {
        examples: [
          { input: "Contact ID,First Name,Last Name,Email,Phone,Lifecycle Stage,Score,Tags\n000101,Ana,Lopez,ANA@EXAMPLE.COM,+1 415 555 0101,lead,120,\"sales; vip\"", inputFormat: "csv", output: { contact_id: "000101", name: "Ana Lopez", email: "ana@example.com", phone: "+1 415 555 0101", stage: "lead", score: 120, tags: ["sales", "vip"] } },
          { input: "Contact ID,First Name,Last Name,Email,Phone,Lifecycle Stage,Score,Tags\n000202,Bo,Smith,BO@EXAMPLE.COM,+1 415 555 0102,customer,80,\"support; product\"", inputFormat: "csv", output: { contact_id: "000202", name: "Bo Smith", email: "bo@example.com", phone: "+1 415 555 0102", stage: "customer", score: 80, tags: ["support", "product"] } },
        ],
        newInput: input,
        inputFormat: "csv",
        outputFormat: "json",
      };
    },
    expectedOutput: [
      { contact_id: "000101", name: "Ana Lopez", email: "ana@example.com", phone: "+1 415 555 0101", stage: "lead", score: 120, tags: ["sales", "vip"] },
      { contact_id: "000202", name: "Bo Smith", email: "bo@example.com", phone: "+1 415 555 0102", stage: "customer", score: 80, tags: ["support", "product"] },
      { contact_id: "000303", name: "Tim Berg", email: "tim@example.com", phone: "+1 415 555 0103", stage: "customer", score: 145, tags: ["sales", "product"] },
    ],
    expectedStatus: "safe",
    expectedBatchApplied: true,
  },
  {
    id: "fixture-airtable-export-csv-to-csv",
    fixture: "airtable-export.csv",
    task(input) {
      return {
        examples: [
          { input: "Record ID,Title,Owner Email,Status,Tags,Active\nrec001,Roadmap,ANA@EXAMPLE.COM,In progress,\"strategy; planning\",true", inputFormat: "csv", output: "id,title,owner_email,status,tags,active\nrec001,Roadmap,ana@example.com,in_progress,strategy | planning,true", outputFormat: "csv" },
          { input: "Record ID,Title,Owner Email,Status,Tags,Active\nrec002,QA Checklist,BO@EXAMPLE.COM,Done,\"quality; release\",false", inputFormat: "csv", output: "id,title,owner_email,status,tags,active\nrec002,QA Checklist,bo@example.com,done,quality | release,false", outputFormat: "csv" },
        ],
        newInput: input,
        inputFormat: "csv",
        outputFormat: "csv",
      };
    },
    expectedOutput: [
      { id: "rec001", title: "Roadmap", owner_email: "ana@example.com", status: "in_progress", tags: "strategy | planning", active: true },
      { id: "rec002", title: "QA Checklist", owner_email: "bo@example.com", status: "done", tags: "quality | release", active: false },
      { id: "rec003", title: "Launch Notes", owner_email: "tim@example.com", status: "in_progress", tags: "[unresolved: unseen value at $.Tags]", active: true },
    ],
    expectedSerialized: "id,title,owner_email,status,tags,active\nrec001,Roadmap,ana@example.com,in_progress,strategy | planning,true\nrec002,QA Checklist,bo@example.com,done,quality | release,false\nrec003,Launch Notes,tim@example.com,in_progress,[unresolved: unseen value at $.Tags],true",
    expectedStatus: "unsafe",
    expectedWarnings: ["unseen-value-map"],
    expectedBatchApplied: true,
  },
  {
    id: "fixture-make-webhook-json-to-json",
    fixture: "make-webhook.json",
    task(input) {
      return {
        examples: [
          { input: { scenario: { id: "9001" }, bundle: { input: { order: { id: "ORD-100", customer: { email: "ana@example.com" }, total: "129.99", items: [{ sku: "DL-001", qty: 1 }] } } }, metadata: { execution_id: "exec-100" } }, output: { scenario_id: "9001", execution_id: "exec-100", order_id: "ORD-100", customer_email: "ana@example.com", total: "129.99", skus: ["DL-001"] } },
          { input: { scenario: { id: "9002" }, bundle: { input: { order: { id: "ORD-200", customer: { email: "bo@example.com" }, total: "59.00", items: [{ sku: "WS-002", qty: 2 }] } } }, metadata: { execution_id: "exec-200" } }, output: { scenario_id: "9002", execution_id: "exec-200", order_id: "ORD-200", customer_email: "bo@example.com", total: "59.00", skus: ["WS-002"] } },
        ],
        newInput: parseJson(input),
        outputFormat: "json",
      };
    },
    expectedOutput: { scenario_id: "9003", execution_id: "exec-300", order_id: "ORD-300", customer_email: "tim@example.com", total: "240.75", skus: ["CB-003", "HD-010"] },
    expectedStatus: "safe",
  },
  {
    id: "fixture-n8n-webhook-json-to-csv",
    fixture: "n8n-webhook.json",
    task(input) {
      return {
        examples: [
          { input: { body: { event: "signup", user: { id: "u001", email: "ana@example.com", plan: "pro" }, timestamp: "2024-03-15T09:30:00Z" }, query: { source: "website" } }, output: "event,user_id,email,plan,event_date,source\nsignup,u001,ana@example.com,pro,2024-03-15,website", outputFormat: "csv" },
          { input: { body: { event: "purchase", user: { id: "u002", email: "bo@example.com", plan: "starter" }, timestamp: "2024-06-01T14:00:00Z" }, query: { source: "campaign" } }, output: "event,user_id,email,plan,event_date,source\npurchase,u002,bo@example.com,starter,2024-06-01,campaign", outputFormat: "csv" },
        ],
        newInput: parseJson(input),
        outputFormat: "csv",
      };
    },
    expectedOutput: { event: "signup", user_id: "u003", email: "tim@example.com", plan: "enterprise", event_date: "2024-09-20", source: "website" },
    expectedSerialized: "event,user_id,email,plan,event_date,source\nsignup,u003,tim@example.com,enterprise,2024-09-20,website",
    expectedStatus: "safe",
  },
];

const results = [];
const tempDir = await mkdtemp(path.join(os.tmpdir(), "latentmachine-hardening-cli-"));

try {
  for (const testCase of cases) {
    const started = Date.now();
    try {
      const fixture = await readFixture(testCase.fixture);
      const result = runTransform(testCase.task(fixture));
      assert.deepEqual(result.output, testCase.expectedOutput);
      assertSerialized(result, testCase.expectedSerialized || testCase.expectedOutput);
      if (testCase.expectedStatus) assert.equal(result.status, testCase.expectedStatus);
      if (testCase.expectedWarnings?.length) {
        const warningTypes = new Set([
          ...(result.warnings || []).map(warning => warning.type),
          ...(result.diagnosis?.guardrails || []).map(warning => warning.type),
        ]);
        for (const warning of testCase.expectedWarnings) {
          assert.equal(warningTypes.has(warning), true, `Expected warning ${warning}, got ${JSON.stringify([...warningTypes])}`);
        }
      }
      if (testCase.expectedBatchApplied !== undefined) {
        assert.equal(result.translator?.batchApplied, testCase.expectedBatchApplied);
      }
      if (result.status === "safe" && ["json", "csv"].includes(result.inputFormat) && ["json", "csv"].includes(result.outputFormat)) {
        const filename = `${testCase.id}.mjs`;
        const cliPath = path.join(tempDir, filename);
        const outputPath = path.join(tempDir, `${testCase.id}.out`);
        const reportPath = path.join(tempDir, `${testCase.id}.report.json`);
        await writeFile(cliPath, generateCLIExport(result, { filename, sampleInputText: fixture, sampleOutput: result.output }), "utf8");

        const selfTest = spawnSync(process.execPath, [cliPath, "--self-test"], { encoding: "utf8" });
        assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
        const readme = spawnSync(process.execPath, [cliPath, "--readme"], { encoding: "utf8" });
        assert.equal(readme.status, 0, readme.stderr || readme.stdout);
        assert.match(readme.stdout, new RegExp(`node ${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} --self-test`));

        const cli = spawnSync(process.execPath, [cliPath, "--out", outputPath, "--report", reportPath], {
          input: fixture,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        });
        assert.equal(cli.status, 0, cli.stderr || cli.stdout);
        const cliOutputText = await readFile(outputPath, "utf8");
        const parsedCliOutput = parseWithFormat(cliOutputText, result.outputFormat);
        assert.deepEqual(result.outputFormat === "csv" && !Array.isArray(result.output) && Array.isArray(parsedCliOutput) && parsedCliOutput.length === 1 ? parsedCliOutput[0] : parsedCliOutput, result.output);
        const report = JSON.parse(await readFile(reportPath, "utf8"));
        assert.equal(report.status, "success");
        assert.equal(report.meta.cliVersion, 3);
      }
      results.push({ id: testCase.id, passed: true, durationMs: Date.now() - started });
    } catch (error) {
      results.push({ id: testCase.id, passed: false, error: error?.message || "Unknown error", durationMs: Date.now() - started });
    }
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const failed = results.filter(result => !result.passed);
console.log(JSON.stringify({
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.map(result => result.id),
  averageDurationMs: Math.round(results.reduce((sum, result) => sum + result.durationMs, 0) / Math.max(1, results.length)),
}, null, 2));

if (failed.length) {
  console.error(failed.map(result => `- ${result.id}: ${result.error}`).join("\n"));
  process.exit(1);
}
