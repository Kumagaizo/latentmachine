# Changelog

## Unreleased

### Breaking

- `verify()` can now return `verdict: "unverifiable"` when a fitted lookup memorises at least half of eight or more training rows. Its `ruleStatus` and confidence label are `unverified`, and affected fields are listed in `memorisation` and `summary`.
- The CLI treats `unverifiable` as a failing verdict unless `--allow-unverifiable` is supplied.
- Memorisation metadata now separates `ruleVerifiedTargets`, `passthroughTargets`, and `nonMemorisedTargets` instead of overstating all non-memorised targets as verified.

### Fixed

- Scope optional output fields to their source-presence domain, so absent optional values no longer produce false row-level flags.
- Discover optional fields across the full batch instead of assuming the first row contains the complete schema.
- Classify optional-field rules with fewer than eight supporting examples as `unverifiable`; these fields cannot contribute inconsistent row flags.
- Preserve detection of dominant case, normalization, date, composition, array-count, and direct-copy rules when a genuine drift affects a small minority of supported rows.
- Avoid sparse-field inference work on out-of-domain rows, preventing the rich-schema performance collapse found in the audit.
- Infer explicit numeric division when multiplication by a reciprocal would introduce IEEE-754 drift, including cents-to-currency transformations.
- Preserve JSON-RPC request IDs when the local MCP server rejects an oversized line, preventing clients from waiting indefinitely.
- Generate target-directed contract mutations for omission, type, case, unit, date-format, and composition drift, and disclose an effective mutation-evidence status.

### Migration

- Temporarily pass `legacyVerdict: true` to `verify()` to map `unverifiable` back to `consistent`; a deprecation warning names the affected fields.
- MCP verification responses now cap row details and return a non-executable compact rule without lookup bodies. Use `infer_transformation_rule` when an executable rule is required.
