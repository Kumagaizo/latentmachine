# Changelog

## Unreleased

### Breaking

- `verify()` can now return `verdict: "unverifiable"` when a fitted lookup memorises at least half of eight or more training rows. Its `ruleStatus` and confidence label are `unverified`, and affected fields are listed in `memorisation` and `summary`.
- The CLI treats `unverifiable` as a failing verdict unless `--allow-unverifiable` is supplied.

### Migration

- Temporarily pass `legacyVerdict: true` to `verify()` to map `unverifiable` back to `consistent`; a deprecation warning names the affected fields.
- MCP verification responses now cap row details and return a non-executable compact rule without lookup bodies. Use `infer_transformation_rule` when an executable rule is required.
