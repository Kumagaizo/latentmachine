# @latentmachine/mcp

MCP server for Latentmachine. It exposes deterministic verification, Transformation Contracts, rule inference/application, data fingerprints, and format detection to MCP clients.

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
- `learn_transformation_contract`: learns an explicitly unapproved or review-required contract from examples.
- `get_contract_challenges`: returns unresolved review questions without answering or approving them.
- `test_transformation_contract`: mutation-tests the contract and reports detected behavior plus visible gaps.
- `run_transformation_contract`: runs an already-approved contract.
- `check_transformation_contract`: checks external output against an already-approved contract.
- `compare_transformation_contracts`: classifies behavioral, evidence, policy, review, and metadata changes.

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

## Contract approval boundary

MCP can prepare a contract for review, surface challenges, mutation-test it, and use an approved artifact. It cannot create `local-human-review` approval or describe a learned contract as human-approved. `run_transformation_contract` and `check_transformation_contract` fail closed when the supplied contract still requires approval.

Approve the exact core fingerprint in Contract Studio or with the CLI. Automated approval must use the distinct `automated-policy` method outside MCP.

Contract tools return concise summaries by default. Runtime record summaries are capped at 20 unless `record_limit` is set, and full reports require `include_report: true`.

## Privacy

This package is the local stdio transport. Examples, contracts, input, and output stay on the machine running the MCP server. `privacy_safe: true` additionally redacts raw record values from returned runtime reports.

The hosted endpoint at `https://latentmachine.com/api/mcp` is different: payloads travel to Latentmachine's Vercel function for stateless processing. Its contract run/check tools default to privacy-safe report shaping, but that does not make the network transfer local.

## Local smoke test

```sh
npm --workspace packages/mcp run smoke
npx @latentmachine/mcp --help
```
