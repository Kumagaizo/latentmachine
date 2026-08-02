import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractJsonRpcIdFromHead,
  MAX_JSON_RPC_LINE_CHARACTERS,
} from "../src/server.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "bin", "latentmachine-mcp.js");

const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
let stderr = "";
const pending = new Map();

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

child.on("error", (error) => {
  throw error;
});

child.on("exit", (code, signal) => {
  const error = new Error(`MCP server exited before smoke completion (${signal || code}).${stderr ? `\n${stderr}` : ""}`);
  for (const resolve of pending.values()) resolve({ error });
  pending.clear();
});

function requestLine(id, line, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ error: new Error(`Timed out waiting for JSON-RPC id ${id}.`) });
    }, timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${line}\n`);
  });
}

function request(message, timeoutMs = 3000) {
  return requestLine(message.id, JSON.stringify({ jsonrpc: "2.0", ...message }), timeoutMs);
}

function requestLineOfLength(id, length) {
  const message = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "detect_data_format", arguments: { text: "" } },
  };
  const emptyLength = JSON.stringify(message).length;
  message.params.arguments.text = "x".repeat(length - emptyLength);
  const line = JSON.stringify(message);
  assert.equal(line.length, length);
  return line;
}

try {
  const initialize = await request({
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke", version: "1.0.0" },
    },
  });
  if (initialize.error) throw initialize.error;
  assert.equal(initialize.result.serverInfo.name, "latentmachine");

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  const tools = await request({ id: 2, method: "tools/list", params: {} });
  if (tools.error) throw tools.error;
  assert.equal(tools.result.tools.length, 11);
  assert.ok(tools.result.tools.some(tool => tool.name === "learn_transformation_contract"));
  assert.ok(tools.result.tools.some(tool => tool.name === "check_transformation_contract"));

  const verify = await request({
    id: 3,
    method: "tools/call",
    params: {
      name: "verify_data_transformation",
      arguments: {
        original: '[{"id":1,"name":"Ada"},{"id":2,"name":"Bo"}]',
        transformed: '[{"userId":1,"fullName":"Ada"},{"userId":2,"fullName":"Bo"}]',
      },
    },
  });
  if (verify.error) throw verify.error;
  const verifyResult = JSON.parse(verify.result.content[0].text);
  assert.equal(verifyResult.verdict, "consistent");

  const detect = await request({
    id: 4,
    method: "tools/call",
    params: {
      name: "detect_data_format",
      arguments: { text: "id,name\n1,Ada" },
    },
  });
  if (detect.error) throw detect.error;
  assert.equal(JSON.parse(detect.result.content[0].text).format, "csv");

  const fingerprint = await request({
    id: 5,
    method: "tools/call",
    params: {
      name: "fingerprint_data",
      arguments: {
        data: '{"b":2,"a":1}',
        compare_to: '{"a":1,"b":3}',
      },
    },
  });
  if (fingerprint.error) throw fingerprint.error;
  const fingerprintResult = JSON.parse(fingerprint.result.content[0].text);
  assert.equal(fingerprintResult.fingerprint.bits, 64);
  assert.deepEqual(fingerprintResult.counts, { added: 0, changed: 1, removed: 0, same: 1 });

  const learnedResponse = await request({
    id: 6,
    method: "tools/call",
    params: {
      name: "learn_transformation_contract",
      arguments: {
        examples: JSON.stringify([
          {
            input: { id: "evt_1", status: "created" },
            output: { eventId: "evt_1", state: "NEW" },
          },
          {
            input: { id: "evt_2", status: "paid" },
            output: { eventId: "evt_2", state: "READY" },
          },
        ]),
      },
    },
  });
  const learned = JSON.parse(learnedResponse.result.content[0].text);
  assert.equal(learned.summary.inferenceStatus, "unverified");
  assert.equal(learned.summary.sourceInferenceStatus, "safe");
  assert.equal(learned.summary.targetCoverage, 1);
  assert.ok(learned.summary.mutationGapCount > 0);
  assert.equal(learned.review.required, true);
  assert.equal(learned.review.humanApprovalCreated, false);
  assert.equal(learned.contract.lifecycle.approvalState, "unreviewed");

  const challengesResponse = await request({
    id: 7,
    method: "tools/call",
    params: {
      name: "get_contract_challenges",
      arguments: { contract: JSON.stringify(learned) },
    },
  });
  const challenges = JSON.parse(challengesResponse.result.content[0].text);
  assert.equal(challenges.humanApprovalCreated, false);

  const unapprovedRunResponse = await request({
    id: 8,
    method: "tools/call",
    params: {
      name: "run_transformation_contract",
      arguments: {
        contract: JSON.stringify(learned.contract),
        input: '[{"id":"evt_3","status":"paid"}]',
      },
    },
  });
  const unapprovedRun = JSON.parse(unapprovedRunResponse.result.content[0].text);
  assert.equal(unapprovedRun.summary.verdict, "invalid_contract");
  assert.equal(unapprovedRun.summary.reviewRequired, true);

  const { approveContract } = await import("../../verify/src/index.js");
  const approved = approveContract(learned, {
    coreFingerprint: learned.contract.identity.coreFingerprint,
    acknowledgedChallenges: learned.contract.challenges
      .filter(item => item.severity === "advisory" && ["open", "deferred"].includes(item.status))
      .map(item => item.id),
  });

  const runResponse = await request({
    id: 9,
    method: "tools/call",
    params: {
      name: "run_transformation_contract",
      arguments: {
        contract: JSON.stringify(approved),
        input: '[{"id":"evt_3","status":"paid"}]',
      },
    },
  });
  const run = JSON.parse(runResponse.result.content[0].text);
  assert.equal(run.summary.verdict, "pass");
  assert.equal(run.summary.reviewRequired, false);

  const checkResponse = await request({
    id: 10,
    method: "tools/call",
    params: {
      name: "check_transformation_contract",
      arguments: {
        contract: JSON.stringify(approved),
        input: '[{"id":"evt_3","status":"paid"}]',
        output: '[{"eventId":"evt_3","state":"WRONG"}]',
        privacy_safe: true,
      },
    },
  });
  const check = JSON.parse(checkResponse.result.content[0].text);
  assert.equal(check.summary.verdict, "quarantine");
  assert.equal(check.records[0].status, "quarantined");

  const testResponse = await request({
    id: 11,
    method: "tools/call",
    params: {
      name: "test_transformation_contract",
      arguments: { contract: JSON.stringify(learned) },
    },
  });
  const mutation = JSON.parse(testResponse.result.content[0].text);
  assert.ok(mutation.summary.mutationCount > 0);
  assert.ok(mutation.summary.coverage.operationTargetCount > 0);
  assert.equal(mutation.summary.coverage.targetCoverage, 1);
  assert.ok(mutation.summary.mutationCount >= mutation.summary.coverage.operationTargetCount * 2);
  assert.equal(mutation.summary.inferenceStatus, "unverified");
  assert.equal("report" in mutation, false);

  const comparisonResponse = await request({
    id: 12,
    method: "tools/call",
    params: {
      name: "compare_transformation_contracts",
      arguments: {
        baseline: JSON.stringify(learned.contract),
        candidate: JSON.stringify(approved),
      },
    },
  });
  const comparison = JSON.parse(comparisonResponse.result.content[0].text);
  assert.equal(comparison.summary.relation, "non_behavioral_change");
  assert.equal(comparison.summary.requiresReapproval, false);

  const richOriginal = Array.from({ length: 1000 }, (_, index) => ({
    claim_id: `claim_${index}`,
    first_name: ["Ada", "Bo", "Cy"][index % 3],
    last_name: `Surname${index}`,
    payer: ["aetna", "cigna", "united"][index % 3],
    amount_cents: 100035 + ((index * 7919) % 490000),
    diagnoses: Array.from({ length: (index % 4) + 1 }, (_, item) => `D${index}-${item}`),
    submitted_at: `2026-02-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
    approved: index % 3 !== 0,
    provider: `provider_${index % 7}`,
    ...(index % 251 === 0 ? { notes: `  extended claim ${index}  ` } : {}),
  }));
  const richTransformed = richOriginal.map(row => ({
    claimId: row.claim_id,
    patientName: `${row.first_name} ${row.last_name}`,
    payer: row.payer.toUpperCase(),
    amount: row.amount_cents / 100,
    diagnosisCount: row.diagnoses.length,
    submittedDate: row.submitted_at.slice(0, 10),
    status: row.approved ? "approved" : "pending",
    provider: row.provider,
    ...(row.notes !== undefined ? { notes: row.notes.trim() } : {}),
  }));
  const richOriginalText = JSON.stringify(richOriginal);
  const richTransformedText = JSON.stringify(richTransformed);
  assert.ok(richOriginalText.length < 500_000);
  assert.ok(richTransformedText.length < 500_000);
  const richVerify = await request({
    id: 13,
    method: "tools/call",
    params: {
      name: "verify_data_transformation",
      arguments: {
        original: richOriginalText,
        transformed: richTransformedText,
      },
    },
  }, 30_000);
  if (richVerify.error) throw richVerify.error;
  const richVerifyResult = JSON.parse(richVerify.result.content[0].text);
  assert.equal(richVerifyResult.verdict, "unverifiable");
  assert.equal(richVerifyResult.flaggedRowCount, 0);
  assert.deepEqual(richVerifyResult.memorisation.insufficientSupportTargets, ["$.notes"]);

  const oversizedBatch = await new Promise((resolve) => {
    pending.set(null, resolve);
    child.stdin.write(`${JSON.stringify([
      { jsonrpc: "2.0", id: 99, method: "ping" },
      { jsonrpc: "2.0", id: 100, method: "ping" },
      { jsonrpc: "2.0", id: 101, method: "ping" },
      { jsonrpc: "2.0", id: 102, method: "ping" },
      { jsonrpc: "2.0", id: 103, method: "ping" },
    ])}\n`);
  });
  assert.equal(oversizedBatch.error.code, -32600);

  assert.equal(extractJsonRpcIdFromHead('{"jsonrpc":"2.0","id":"job\\n42","method":"ping"}'), "job\n42");

  const justUnder = await requestLine(
    41,
    requestLineOfLength(41, MAX_JSON_RPC_LINE_CHARACTERS),
  );
  if (justUnder.error) throw justUnder.error;
  assert.equal(justUnder.id, 41);
  assert.equal(justUnder.result.isError, true);
  assert.match(justUnder.result.content[0].text, /too large/i);

  const justOver = await requestLine(
    42,
    requestLineOfLength(42, MAX_JSON_RPC_LINE_CHARACTERS + 1),
  );
  if (justOver.error instanceof Error) throw justOver.error;
  assert.equal(justOver.id, 42);
  assert.equal(justOver.error.code, -32600);
  assert.match(justOver.error.message, /too large/i);

  console.log("mcp smoke.js passed");
} finally {
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 500))]);
}
