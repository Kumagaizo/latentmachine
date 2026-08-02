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

- `verify_data_transformation`: returns `consistent`, `inconsistent`, or field-attributed `unverifiable` for memorised, incomplete, or insufficiently supported rules. Candidate inference is bounded to 200 output-diverse examples, while every supplied row is still validated. Dominant reusable rules take precedence over memorised lookups at 95% or greater full-domain support, with exact contradicting rows reported in `memorisation.ruleDemotions`. Low-cardinality candidates fitting 80% to less than 95% stay unverifiable and are surfaced as non-accusing `nearFit` evidence with exact contradiction indices. Signed magnitude and zero-comparison rules are inferred only with evidence on both sides of zero. Optional fields are checked only inside their inferred source domain; unverifiable fields cannot contribute row flags. Row details are capped and lookup table bodies are omitted.
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

Learn and mutation-test summaries report `targetCoverage`, mutation counts, and undetected gaps. The summary's effective `inferenceStatus` is `unverified` when a nominally safe inference has mutation gaps or covers less than half of its operation targets; `sourceInferenceStatus` preserves the engine's pre-mutation status.

`get_contract_challenges` and `test_transformation_contract` accept either a bare contract or the complete `{ summary, review, contract }` result returned by `learn_transformation_contract`. Verification responses contain a compact, non-executable rule; call `infer_transformation_rule` when the next step is `apply_transformation_rule`.

## Transport limits

The local stdio server caps each complete JSON-RPC line at 1,000,000 characters. Individual text arguments are capped at 500,000 characters, so either limit may be reached first depending on payload shape. Audited rich fixtures fit roughly 900–1,200 rows per call: the 16-output ERP fixture reaches the input limit near 900 rows, while the narrower claims fixture fits about 1,200. Callers should size batches by serialized characters rather than assuming a universal row limit. Oversized requests with a recoverable request ID receive a correlated JSON-RPC error.

## Privacy

This package is the local stdio transport. Examples, contracts, input, and output stay on the machine running the MCP server. `privacy_safe: true` additionally redacts raw record values from returned runtime reports.

The hosted endpoint at `https://latentmachine.com/api/mcp` is different: payloads travel to Latentmachine's Vercel function for stateless processing. Its contract run/check tools default to privacy-safe report shaping, but that does not make the network transfer local.

The hosted adapter separately rejects request bodies over 1,000,000 characters, tool text fields over 500,000 characters, JSON-RPC batches over four calls, and per-client bursts over 30 requests or 2,000,000 request characters per minute. The in-function limiter is a safety valve; production deployments should also configure a Vercel WAF rate-limit rule for `/api/mcp` so enforcement happens globally before function execution.

## Local smoke test

```sh
npm --workspace packages/mcp run smoke
npx @latentmachine/mcp --help
```
