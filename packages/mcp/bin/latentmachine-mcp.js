#!/usr/bin/env node
import readline from "node:readline";
import {
  extractJsonRpcIdFromHead,
  handleJsonRpc,
  MAX_JSON_RPC_LINE_CHARACTERS,
} from "../src/server.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: latentmachine-mcp

Run the Latentmachine MCP server over stdio.

Configure an MCP client to launch this command. The server exposes tools for
verification, rule inference, rule application, and structured format detection.`);
  process.exit(0);
}

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

async function handleLine(line) {
  if (!line.trim()) return;
  if (line.length > MAX_JSON_RPC_LINE_CHARACTERS) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: extractJsonRpcIdFromHead(line),
      error: { code: -32600, message: `JSON-RPC request is too large. Limit is ${MAX_JSON_RPC_LINE_CHARACTERS} characters.` },
    })}\n`);
    return;
  }

  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Invalid JSON request." },
    })}\n`);
    return;
  }

  const response = await handleJsonRpc(message);
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
}

input.on("line", (line) => {
  handleLine(line).catch((error) => {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: extractJsonRpcIdFromHead(line),
      error: { code: -32603, message: error?.message || "Internal error." },
    })}\n`);
  });
});

console.error("Latentmachine MCP server running on stdio");
