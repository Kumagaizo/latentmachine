# Latentmachine Product Contract

Latentmachine is a deterministic example workbench for data transformations.

The product is not just the transformed output. The product is confidence in the inferred rule: what rule was found, whether the examples prove it, what remains ambiguous, and what could break when the rule is reused.

## Promises

- Infer deterministic transformation rules from input/output examples.
- Expose every inferred rule as an inspectable symbolic program.
- Diagnose contradictory examples instead of hiding them behind a plausible output.
- Detect ambiguity when multiple rules fit the same examples.
- Warn on missing fields, unseen mapped values, unsafe edge cases, and unresolved output targets.
- Report confidence honestly, including when a rule is unsafe or insufficiently proven.
- Let corrections constrain the rule space through additional examples.
- Execute the selected rule deterministically: same input, same rule, same output.

## Refusals

- Never silently guess when examples are ambiguous.
- Never produce output without a confidence assessment.
- Never hide the symbolic program from the user.
- Never claim confidence for transformations that cannot be verified against examples.
- Never use an LLM, neural model, or statistical black box for inference.
- Never send user data to a server for the core transformation loop.

## Rule Artifact

Every engine run must produce a stable artifact with:

- `status`: `safe`, `ambiguous`, `contradictory`, `unsafe`, or `insufficient`.
- `confidence`: evidentiary label, risk level, check count, reasons, and risk types.
- `preconditions`: required input paths and types the rule depends on.
- `program`: the executable symbolic operations.
- `warnings`: runtime or inference risks.
- `evidence`: per-operation example matches.
- `diagnosis`: contradictions, ambiguities, guardrails, candidates considered, and suggested examples.

The UI, export, CLI, and benchmark suite should read from this artifact rather than inventing their own interpretation of engine state.
