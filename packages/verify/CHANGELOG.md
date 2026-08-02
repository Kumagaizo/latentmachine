# Changelog

## Unreleased

### Breaking

- `verify()` can now return `verdict: "unverifiable"` when a fitted lookup memorises at least half of eight or more training rows. Its `ruleStatus` and confidence label are `unverified`, and affected fields are listed in `memorisation` and `summary`.
- The CLI treats `unverifiable` as a failing verdict unless `--allow-unverifiable` is supplied.
- Memorisation metadata now separates `ruleVerifiedTargets`, `passthroughTargets`, and `nonMemorisedTargets` instead of overstating all non-memorised targets as verified.

### Added

- Retain 80% to less than 95% low-cardinality mapping candidates as non-accusing `nearFit` evidence, with explicit reporting and promotion thresholds plus exact full-batch contradiction indices.
- Infer signed magnitudes with absolute-value numeric transforms and boolean sign flags with zero-based numeric comparisons; both require evidence on both sides of zero.
- Recover reusable rules that explain at least 95% of a field domain instead of letting a high-cardinality lookup absorb the exceptions. `memorisation.ruleDemotions` reports the rule, fit ratio, and exact contradicting rows; genuinely high-cardinality fields remain unverifiable.
- Extend `arraySum` with two proven numeric item factors and a stable divisor for weighted commercial totals such as `sum(quantity × unit_cents) / 100`.
- Infer reusable `arraySum`, primitive-array `arrayIndex`, and percentage-based `numericFormula` operations with explicit rounding semantics.
- Infer proven global literal-delimiter replacements for identifier-like fields with `stringReplace`; repeated-delimiter evidence is required before the global rule is selected.
- Bound hypothesis generation to 200 deterministic, output-diverse examples while continuing to validate every supplied row.
- Report full per-field support plus repeated-source consistency and conflict counts for lookup-backed fields.

### Fixed

- Require drift fixtures to assert the exact injected row set as well as a non-no-op mutation, preventing unrelated false positives from masquerading as detection.
- Preserve percentage-formula evaluation order and explicit `half-up`, `half-even`, `half-away`, `floor`, `ceil`, `trunc`, or `none` rounding semantics. Full-batch validation resolves associations that the bounded inference sample cannot distinguish, preventing false financial drift at exact half ties.
- Make drift regressions self-validating so a no-op mutation fails the fixture instead of being recorded as detection ground truth.
- Remove the single-run memorisation drift hint: memorisation reflects rule expressiveness and is not evidence of drift without a comparable baseline.
- Prevent superlinear wide-schema inference and cap leave-one-out reinference to small batches.
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
