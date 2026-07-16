import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

function request(message) {
  return new Promise((resolve) => {
    pending.set(message.id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  });
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
  assert.equal(tools.result.tools.length, 5);

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

  console.log("mcp smoke.js passed");
} finally {
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 500))]);
}
