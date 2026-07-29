# Intelligence Baselayer

The current split keeps the inference engine, runtime primitives, scoring, schema, and reliability concerns separate:

- `src/intelligence/json-transform/engine.js`: deterministic JSON rule inference engine.
- `src/intelligence/json-transform/core.js`: shared clone, path parsing, path access, and structural entry traversal helpers.
- `src/intelligence/json-transform/operations.js`: JSON parsing, type coercion, string/date/phone/quantity normalization, and operation-level formatting helpers.
- `src/intelligence/json-transform/suggestions.js`: input cleanup suggestions for type coercion and list-field splitting before inference.
- `src/intelligence/json-transform/runtime.js`: operation execution and new-input runtime guardrail warnings.
- `src/intelligence/json-transform/program-builder.js`: output target discovery, candidate selection, ambiguity triage, and program assembly.
- `src/intelligence/json-transform/program-view.js`: rule titles, summaries, evidence, preconditions, and explanation shaping.
- `src/intelligence/json-transform/candidates.js`: candidate-rule discovery for copy, coercion, string cleanup, templates, extraction, arrays, grouping, conditionals, and value maps.
- `src/intelligence/json-transform/costs.js`: MDL-style operation priors, bounded adjustment weights, and candidate cost scoring.
- `src/intelligence/json-transform/schema.js`: schema path normalization and blocking/advisory schema drift detection.
- `src/intelligence/json-transform/reliability.js`: confidence labels, reliability evidence, risk classification, and diagnosis shaping.
- `src/intelligence/json-transform/translator.js`: cross-format task builder and runner.
- `src/intelligence/json-transform/exporters.js`: JavaScript, CLI, jq, JSONPath, n8n, and Make export generation.
- `src/intelligence/json-transform/benchmarks.js`: local fixtures for JSON transform regression checks.
- `src/intelligence/json-transform/contract.js`: tool-contract wrapper for the JSON transform engine.
- `src/intelligence/data-formats/`: JSON, XML, CSV, TOML, .env, SQL INSERT, and YAML adapters.
- `src/intelligence/regex-builder/engine.js`: regex synthesis and verification engine.
- `src/intelligence/regex-builder/benchmarks.js`: local fixtures for regex builder regression checks.
- `src/intelligence/signal/`: deterministic line segmentation, structural template grouping, transition-grammar hypotheses, observable feature detection, bounded compression novelty, component scoring, explanations, and the Signal tool contract.
- `src/intelligence/arc/engine.js`: pure reasoning engine, no React.
- `src/intelligence/arc/benchmarks.js`: local fixtures for regression checks.
- `src/intelligence/arc/contract.js`: strict tool contract implementation.
- `src/intelligence/arc/modules/`: smaller perception, execution, scoring, search, and tracing entrypoints.
- `src/intelligence/pattern-lab/engine.js`: example-learning engine with automatic job inference.
- `src/intelligence/pattern-lab/benchmarks.js`: transform, extraction, completion, classification, and no-mode fixtures.
- `src/intelligence/pattern-lab/contract.js`: product contract, benchmark runner, and reliability profile.
- `src/intelligence/contracts.js`: shared lifecycle, schema, trace event, and reliability helpers.
- `src/intelligence/memory.js`: in-memory solved example, failure, and correction interfaces.
- `src/intelligence/primitives.js`: shared primitive catalog for specialized tools.
- `src/local/app.js`: Infer page state, event binding, and workflow orchestration.
- `src/local/verify.js`: Verify page state, event binding, and workflow orchestration.
- `src/local/regex.js`: Regex Builder page state, event binding, and workflow orchestration.
- `src/local/jq.js`: jq Builder page state, event binding, and workflow orchestration.
- `src/local/signal.js`: Signal page state, evidence review, and evidence-pack export.
- `src/local/render-helpers.js`: shared HTML rendering helpers for the vanilla UI.
- `src/intelligence/tools/registry.js`: tool-page registry.
- `scripts/run-benchmarks.mjs`: main product regression suite.
- `scripts/run-ui-smoke.mjs`: built-page wiring smoke check.
- `scripts/run-deploy-preflight.mjs`: source and dist deploy guardrails.

## Primary Window

`index.html` is the landing and orientation surface. `infer.html` is the structured data translator: a browser-based workbench for teaching deterministic JSON, XML, CSV, TOML, YAML, .env, and SQL INSERT transformations from examples, inspecting the inferred rule, correcting it, and exporting reusable code or a CLI. This is the product-facing main tool and the origin point for Latentmachine.

Verify, Regex Builder, jq Builder, Trace, and Signal are dedicated static pages over the same intelligence layer. ARC Studio and Pattern Lab remain in the intelligence layer as research/development workbenches, not public first-screen product surfaces.

## Platform Skeleton

The baselayer now has lightweight versions of the ten platform concepts:

1. Tool lifecycle metadata: `draft`, `experimental`, `validated`, `production`, `deprecated`.
2. Tool schemas: each tool publishes input and output schema descriptors.
3. Structured trace events: solver phases emit first-class events for validation, perception, hypothesis generation, scoring, selection, execution, search, and failure classification.
4. Confidence and reliability: per-result confidence assessments plus per-tool reliability profiles.
5. Benchmark suites: unit, composition, adversarial, drawing, and golden suites.
6. Tool contracts: registry metadata, schemas, suites, and primitives for intelligence modules.
7. Memory interface: solved examples, failed attempts, accepted outputs, and corrections.
8. Human correction model: pending-review correction records.
9. Shared primitives: perception, hypothesis generation, search, scoring, execution, tracing, benchmarking, correction memory.
10. Static product shell: `index.html`, `infer.html`, `verify.html`, `regex.html`, `jq.html`, `trace.html`, and `signal.html`.

## Current ARC Baseline

The ARC benchmark now solves `23/23` local tasks. The former known failures are covered by golden composition checks:

- `c-cs2`: `cropBBox -> Scale 2x`
- `c-fc`: `flipH -> Recolor`

## Example-Learning Surface

The example-learning surface is `pattern-lab` internally and Teach It Once conceptually. It targets the dead zone between manual cleanup, LLM prompting, and throwaway scripts: repetitive semi-structured transformations where the human knows the rule but does not want to write code.

- Registered route: `/tools/pattern-lab`
- Local shell: internal benchmark/workbench module, not a public page
- Processing model: infer the job from examples, then apply transform, extraction, completion, classification, or explanation behavior
- Output: editable result rows, selected hypothesis, confidence, correction feedback, and exportable approved output
- Benchmark: `node scripts/run-pattern-lab-benchmarks.mjs`
- Current local baseline: `11/11`, covering row transforms, filename transforms, sequence completion, extraction, classification, automatic job inference, numeric input overriding stale examples, inline examples, separated teach/apply rows, variable-length comma rows, and correction-driven template overrides

## Symbolic Reasoning Fit

The ARC Grid Reasoner is still valuable as a symbolic-reasoning lab: small visual transformation tasks with inspectable hypotheses, objective outputs, reusable primitives, structured traces, and benchmarkable behavior. It should remain available for research and tool-development purposes without displacing the structured data translator as the flagship surface.

- Registered route: `/tools/arc-grid-reasoner`
- Local shell: internal benchmark/workbench module, not a public page
- Benchmark: `node scripts/run-arc-benchmarks.mjs`
- Current local baseline: `23/23`

The local static shell uses `fonts/StackSansText-VariableFont_wght.ttf` for interface text and `fonts/MartianMono-VariableFont_wdth,wght.ttf` for code/data text through `src/local/styles.css`.

## Learnings From Retired Experiments

The retired privacy-redaction experiment was useful as a baselayer stress test, but not as a flagship product. It exposed platform lessons that now live in shared contracts instead of one-off tool code:

1. Benchmarks must check the feared failure directly, not only broad category presence.
2. Golden tests should assert behavior, method, explanation, confidence, latency, and trace coverage when those matter.
3. A tool should be favored when wrong outputs are observable and testable, not when quality depends on endless edge-case recall.
4. Structured traces are product infrastructure, not decoration: they let the platform explain why a result happened and what changed.
5. Adversarial fixtures belong in every serious tool suite, but the assertion engine should be reusable across domains.

The shared benchmark layer now supports reusable assertions for exactness, expected methods, explanation fragments, confidence floors or evidence-check ratios, duration ceilings, required trace/event types, and forbidden output fragments.

## Next Reliability Upgrades

1. Replace lightweight validators with a typed schema library when the app has dependencies.
2. Expand golden predictions to include more real ARC tasks and user workflows.
3. Add trace coverage requirements to more golden tasks once phases are consistently emitted.
4. Turn traces from parsed log compatibility into first-class events emitted by each engine phase.
5. Split hypothesis generation into its own modules once the rule vocabulary grows.
6. Add failure taxonomies with recommended next actions, not only "unsolved".
7. Add persistent telemetry storage for solve time, candidate count, selected rule type, failures, and overfit warnings.

## Web Tool Direction

Each dedicated subpage should be a thin product surface over a registered tool. The page owns UX, examples, and workflow. The intelligence module owns task validation, solving, explanation, benchmarking, and confidence.

## Signal Attention Surface

Signal extends the baselayer to line-oriented logs, reports, and technical documents without taking over Trace's structured-data responsibilities. Its evidence grammar is a novel composition of existing primitives:

1. Perception creates stable source segments and normalized structural templates.
2. Hypothesis generation learns recurring template-to-template transitions as a local artifact grammar.
3. Scoring tests each line against global repetition, section structure, neighboring lines, observable language features, and bounded byte predictability.
4. Tracing records privacy-safe method events with counts rather than source content.
5. Correction memory is expressed through manual pins and an explicitly reviewed evidence-pack selection.
6. Benchmarking gates heuristic weights, adversarial language cases, routing behavior, deterministic IDs, and the 20,000-line performance target.

The measurements remain separate in the result artifact. Compression novelty cannot create a finding by itself, and Signal does not decide which source lines matter to the user's business.
