---
title: "Use Latentmachine as an MCP Server for Claude and Cursor"
description: "Connect Latentmachine to Claude Desktop, Claude Code, or Cursor as an MCP server. The AI does the data transformation, then calls a deterministic engine to verify whether every row is consistent. Setup takes one line."
date: "2026-06-29"
tags: "mcp,claude,cursor,verify,ai-agent,data-quality"
---

When you ask Claude or ChatGPT to transform a batch of records, the AI does the work. Nobody checks it. You glance at the first few rows, import the file, and move on.

Latentmachine can now check it for you — from inside the AI conversation. Connect the MCP server, and your AI assistant gains access to a deterministic verification engine that is not an LLM. When you ask "did the transformation get every row right?", the AI calls Latentmachine, runs the check, and tells you exactly which rows drifted.

## What is MCP

The [Model Context Protocol](https://modelcontextprotocol.io) is an open standard that lets AI assistants call external tools. Instead of relying on its own output, the AI can invoke a function hosted somewhere else — a database query, a file operation, or in this case, a data verification engine.

Latentmachine exposes four tools through MCP: one to verify batch consistency, one to infer rules from examples, one to apply rules to new data, and one to detect data formats. The AI chooses the right tool based on your request.

## Connect the remote server

The fastest setup. No install. The server runs at `latentmachine.com/api/mcp` and handles the MCP protocol over HTTP.

For clients that accept a remote MCP URL, add:

```json
{
  "mcpServers": {
    "latentmachine": {
      "url": "https://latentmachine.com/api/mcp"
    }
  }
}
```

For Claude Code when HTTP transport is enabled:

```bash
claude mcp add --transport http latentmachine https://latentmachine.com/api/mcp
```

For clients that read `.cursor/mcp.json`-style workspace files:

```json
{
  "mcpServers": {
    "latentmachine": {
      "url": "https://latentmachine.com/api/mcp"
    }
  }
}
```

Restart your client. Latentmachine should appear in the tool list with four available tools.

## Connect a local server

If you want data to stay on your machine, run the MCP server locally over stdio. The package is implemented and prepared for npm publishing; until `@latentmachine/mcp` is available on npm, use the remote MCP endpoint above.

Release target:

```bash
npm install -g @latentmachine/mcp
```

Then point your client at the local binary:

```json
{
  "mcpServers": {
    "latentmachine": {
      "command": "latentmachine-mcp"
    }
  }
}
```

Or without a global install:

```json
{
  "mcpServers": {
    "latentmachine": {
      "command": "npx",
      "args": ["@latentmachine/mcp"]
    }
  }
}
```

The local server uses stdio transport. The AI client spawns it as a process, sends JSON-RPC over stdin, and reads results from stdout. Your data never touches a network.

## What the AI can do with it

Once connected, the AI has access to four tools. It picks the right one based on your natural language request.

**verify_data_transformation** — the main tool. The AI sends original records and transformed records. Latentmachine infers the majority rule, replays it against every row, and returns which rows matched and which ones broke the pattern.

**infer_transformation_rule** — when you want to define a correct rule from examples. The AI sends input/output pairs. Latentmachine infers the simplest deterministic rule that explains them, or reports ambiguity and contradictions.

**apply_transformation_rule** — after inferring a rule, the AI can apply it to new data. Same input, same rule, same output. Deterministic.

**detect_data_format** — a utility. The AI sends a string, Latentmachine returns whether it is JSON, CSV, YAML, TOML, XML, .env, or unknown.

## What a conversation looks like

You paste a batch of records into the chat and say: "I asked ChatGPT to transform these customer records into a flat schema. Can you check if it got every row right?"

The AI recognizes this is a verification task. It calls `verify_data_transformation` with the original and transformed data. The engine infers the majority rule — say, concatenate `first` and `last` into `name`, rename `id` to `customerId`, and keep `joined` as an ISO date.

It replays that rule against all rows. 197 match. Three do not. It returns the flagged rows with the input, what the rule expected, and what the AI actually produced.

The AI reports back: "197 of 200 rows are consistent. Rows 44, 89, and 156 have date format drift — the rule expects ISO dates but those three switched to US format. Here are the differences."

You did not leave the conversation. You did not open another tab. You did not write any code. The AI called a non-AI engine to check its own kind's work.

## Why this is different from asking the AI to check itself

An LLM checking its own output is the same probabilistic system reviewing its own probabilistic output. If it made a mistake once, it can make the same mistake again during review. It has no independent ground truth.

Latentmachine is a symbolic engine. It infers the rule by program synthesis — generating every candidate rule that fits the examples, scoring them by structural simplicity, and selecting the cheapest one. The rule is a concrete, inspectable list of operations: "rename this field, concatenate these two, coerce this type." It runs deterministically. Same input, same rule, same output.

When the AI calls this engine, it gets an answer from a fundamentally different system. Not another guess. A proof.

## Supported AI clients

Any client that supports the MCP Streamable HTTP transport can connect to the remote server at `latentmachine.com/api/mcp`. Clients that support stdio transport can run the local server via `@latentmachine/mcp` after the package is available on npm.

The protocol is an open standard. As more AI tools adopt MCP, the Latentmachine server works with them automatically.

## When to use this

Use the MCP server when you are already working inside an AI assistant and want verification without switching context. The typical workflow:

- Ask the AI to transform data.
- Ask the AI to verify the result.
- The AI calls Latentmachine, reports the flagged rows.
- Fix the flagged rows in the conversation, or ask the AI to infer a correct rule and re-apply.

If you want verification in a script, pipeline, or CI job instead of a conversation, use the [npm package](/latentlog/verify-ai-data-transformations-in-node-js) or the [CLI](/developers). Same engine, different interface.

[Full developer documentation →](/developers)
