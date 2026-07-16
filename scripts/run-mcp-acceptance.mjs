import assert from "node:assert/strict";
import handler, { handleFingerprint, handleJsonRpc, handleTransform, handleVerify, TOOLS } from "../api/mcp.js";
import { SECURITY_LIMITS } from "../packages/verify/src/index.js";

async function callHandler(req) {
  const res = {
    body: undefined,
    headers: new Map(),
    statusCode: 200,
    writes: [],
    setHeader(key, value) {
      this.headers.set(key.toLowerCase(), value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    write(chunk) {
      this.writes.push(chunk);
      return true;
    },
    end() {
      return this;
    },
  };
  await handler({
    headers: {},
    method: "POST",
    ...req,
  }, res);
  return res;
}

function parseToolText(response) {
  assert.equal(response.jsonrpc, "2.0");
  assert.ok(response.result, "Expected JSON-RPC result");
  const text = response.result.content?.[0]?.text;
  assert.equal(typeof text, "string", "Expected text content");
  return JSON.parse(text);
}

{
  const response = handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      clientInfo: { name: "acceptance", version: "1.0.0" },
      capabilities: {},
    },
  });
  assert.equal(response.result.serverInfo.name, "latentmachine");
  assert.ok(response.result.capabilities.tools);
  console.log("OK MCP initialize");
}

{
  const response = handleJsonRpc({
    jsonrpc: "2.0",
    id: 101,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      clientInfo: { name: "acceptance", version: "1.0.0" },
      capabilities: {},
    },
  });
  assert.equal(response.result.protocolVersion, "2025-06-18");
  console.log("OK MCP initialize version negotiation");
}

{
  const response = handleJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(response.result.tools.length, 5);
  assert.deepEqual(response.result.tools.map((tool) => tool.name), TOOLS.map((tool) => tool.name));
  console.log("OK MCP tools/list");
}

{
  const response = await callHandler({
    body: '{"jsonrpc":"2.0","id":20,"method":"tools/list","params":{}}',
    headers: { "mcp-protocol-version": "2025-06-18" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.result.tools.length, 5);
  console.log("OK MCP HTTP string body");
}

{
  const response = await callHandler({
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  assert.equal(response.statusCode, 202);
  console.log("OK MCP HTTP notification accepted");
}

{
  const response = await callHandler({
    body: { jsonrpc: "2.0", id: 21, method: "tools/list", params: {} },
    headers: { "mcp-protocol-version": "2099-01-01" },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error.message, /Unsupported MCP protocol version/);
  console.log("OK MCP protocol version rejection");
}

{
  const response = await callHandler({
    body: { jsonrpc: "2.0", id: 22, method: "tools/list", params: {} },
    headers: { origin: "https://example.com" },
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body.error.message, /Origin is not allowed/);
  console.log("OK MCP origin rejection");
}

{
  const previousVercelEnv = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  const response = await callHandler({
    body: { jsonrpc: "2.0", id: 23, method: "tools/list", params: {} },
    headers: { origin: "http://localhost:5173" },
  });
  if (previousVercelEnv === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = previousVercelEnv;
  }
  assert.equal(response.statusCode, 403);
  assert.match(response.body.error.message, /Origin is not allowed/);
  console.log("OK MCP production localhost origin rejection");
}

{
  const response = await callHandler({
    body: " ".repeat(SECURITY_LIMITS.maxRequestCharacters + 1),
  });
  assert.equal(response.statusCode, 413);
  assert.match(response.body.error.message, /Request body is too large/);
  console.log("OK MCP oversized body rejection");
}

{
  const response = await callHandler({
    body: Array.from({ length: SECURITY_LIMITS.maxMcpBatchLength + 1 }, (_, index) => ({
      jsonrpc: "2.0",
      id: index,
      method: "ping",
    })),
  });
  assert.equal(response.statusCode, 413);
  assert.match(response.body.error.message, /JSON-RPC batch is too large/);
  console.log("OK MCP oversized batch rejection");
}

{
  const result = handleVerify({
    original: '[{"id":1,"name":"Ada"},{"id":2,"name":"Bo"}]',
    transformed: '[{"userId":1,"fullName":"Ada"},{"userId":2,"fullName":"Bo"}]',
  });
  assert.equal(result.verdict, "consistent");
  assert.equal(result.matchedRows, 2);
  assert.equal(result.flaggedRows.length, 0);
  console.log("OK MCP verify consistent");
}

{
  const result = handleVerify({
    original: JSON.stringify([
      { id: 1, date: "2026-01-01" },
      { id: 2, date: "2026-01-02" },
      { id: 3, date: "2026-01-03" },
      { id: 4, date: "2026-01-04" },
      { id: 5, date: "2026-01-05" },
    ]),
    transformed: JSON.stringify([
      { id: 1, date: "2026-01-01" },
      { id: 2, date: "2026-01-02" },
      { id: 3, date: "2026-01-03" },
      { id: 4, date: "01/04/2026" },
      { id: 5, date: "01/05/2026" },
    ]),
  });
  assert.equal(result.verdict, "inconsistent");
  assert.ok(result.flaggedRows.length > 0);
  console.log(`OK MCP verify inconsistent (${result.flaggedRows.length} flagged)`);
}

let inferredRule;
{
  const response = handleJsonRpc({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "infer_transformation_rule",
      arguments: {
        examples: JSON.stringify([
          { input: { first: "Ada", last: "Lovelace" }, output: { name: "Ada Lovelace" } },
          { input: { first: "Bo", last: "Singh" }, output: { name: "Bo Singh" } },
        ]),
      },
    },
  });
  const result = parseToolText(response);
  assert.equal(result.status, "safe");
  assert.ok(result.rule?.program);
  inferredRule = result.rule;
  console.log("OK MCP infer");
}

{
  const result = handleTransform({
    rule: JSON.stringify(inferredRule),
    input: '{"first":"Clara","last":"Diaz"}',
  });
  assert.equal(result.name, "Clara Diaz");
  console.log("OK MCP transform");
}

{
  const response = handleJsonRpc({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "detect_data_format",
      arguments: { text: '[{"id":1}]' },
    },
  });
  const result = parseToolText(response);
  assert.equal(result.format, "json");
  console.log("OK MCP detect format");
}

{
  const first = handleFingerprint({ data: '{"b":2,"a":1}' });
  const second = handleFingerprint({ data: '{"a":1,"b":2}' });
  assert.equal(first.fingerprint.hex, second.fingerprint.hex);
  assert.equal(first.fingerprint.bits, 64);
  assert.equal(first.profile.counts.leaves, 2);
  console.log("OK MCP fingerprint stability");
}

{
  const response = handleJsonRpc({
    jsonrpc: "2.0",
    id: 61,
    method: "tools/call",
    params: {
      name: "fingerprint_data",
      arguments: {
        data: '{"rows":[{"id":1,"name":"Ada"},{"id":2,"name":"Grace"}]}',
        compare_to: '{"rows":[{"id":1,"name":"Ada"},{"id":2,"name":"Hopper"},{"id":3,"name":"Linus"}]}',
      },
    },
  });
  const result = parseToolText(response);
  assert.deepEqual(result.counts, { added: 2, changed: 1, removed: 0, same: 3 });
  assert.equal(result.changed.items[0].path, "$.rows[1].name");
  console.log("OK MCP fingerprint diff");
}

{
  const left = Array.from({ length: 105 }, (_, index) => index);
  const right = Array.from({ length: 105 }, (_, index) => index + 1000);
  const result = handleFingerprint({ data: JSON.stringify(left), compare_to: JSON.stringify(right) });
  assert.equal(result.counts.changed, 105);
  assert.equal(result.changed.items.length, 100);
  assert.equal(result.changed.capped, true);
  console.log("OK MCP fingerprint cap");
}

{
  const response = handleJsonRpc({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "verify_data_transformation",
      arguments: {
        original: '[{"id":1}]',
        transformed: "not valid json",
      },
    },
  });
  assert.equal(response.result.isError, true);
  const result = parseToolText(response);
  assert.match(result.error, /Could not detect|JSON|parse|format/i);
  console.log("OK MCP structured error");
}

console.log("\nAll MCP acceptance tests passed.");
