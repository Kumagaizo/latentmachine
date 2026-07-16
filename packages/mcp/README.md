# @latentmachine/mcp

MCP server for Latentmachine. It exposes deterministic verification, rule inference, rule application, data fingerprints, and format detection to MCP clients.

The server speaks JSON-RPC over stdio directly. Its only package dependency is `@latentmachine/verify`; it does not depend on the MCP SDK or any validation library at runtime.

## Claude Desktop

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

If installed globally:

```json
{
  "mcpServers": {
    "latentmachine": {
      "command": "latentmachine-mcp"
    }
  }
}
```

## Tools

- `verify_data_transformation`: checks whether transformed rows follow one deterministic rule.
- `infer_transformation_rule`: infers a symbolic rule from input/output examples.
- `apply_transformation_rule`: applies a previously inferred rule to new input.
- `detect_data_format`: detects JSON, CSV, YAML, TOML, XML, `.env`, SQL INSERT, or unknown data.
- `fingerprint_data`: computes a deterministic non-cryptographic structural fingerprint, or compares two datasets and returns path-level added, changed, and removed counts with capped path lists.

Example:

```json
{
  "name": "fingerprint_data",
  "arguments": {
    "data": "{\"a\":1,\"b\":[2,3]}",
    "compare_to": "{\"b\":[2,4],\"a\":1}"
  }
}
```

Use it when an agent needs to assert output stability after a refactor or detect drift between two config versions.

## Local smoke test

```sh
npm --workspace packages/mcp run smoke
npx @latentmachine/mcp --help
```
