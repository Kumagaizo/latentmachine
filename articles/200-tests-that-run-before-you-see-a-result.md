---
title: "Hundreds of Checks That Run Before You See a Result: How Latentmachine Validates Its Own Engine"
description: "Latentmachine runs hundreds of checks across rule inference, format translation, YAML handling, export generation, CLI behavior, fixtures, presets, and performance. This article explains how the test system works and why it exists."
date: "2026-05-19"
---

You are trusting a tool to produce transformation logic for you. That trust needs a foundation. Latentmachine's foundation is a build-time check suite that validates the inference engine, format layer, exporters, CLI runtime, fixtures, and presets before the static site is built.

This article explains what those checks test, how they are structured, and why some of them are designed to make the engine fail on purpose.

## Why benchmarks matter more here than usual

Most software tests verify that code does what the developer intended. Latentmachine's benchmarks do something subtler: they verify that an inference engine produces the right symbolic program from examples, not just the right output.

The distinction matters. An engine could produce correct output for the wrong reason. If the examples happen to have `status: "active"` in every row, the engine might learn "always output active" instead of "copy the status field." Both produce correct output for the test cases, but only one generalizes.

The benchmark suite catches this by testing not just the output, but the method, the diagnosis, and in some cases, the specific operations the engine selected. If the engine produces correct output via a constant instead of a copy, the test fails even though the output matches.

## What the build checks

The checks are organized around layers of the product:

**JSON transformation benchmarks** validate the core inference engine: field renames, string operations, type coercions, value maps, array operations, templates, compositions, adversarial edge cases, performance budgets, and real-world payloads modeled on Stripe, WordPress, Airtable, Shopify, HubSpot, and GitHub APIs.

**Cross-format translator benchmarks** validate that the engine correctly handles JSON to CSV, CSV to JSON, JSON to YAML, YAML to JSON, CSV to YAML, YAML to CSV, and same-format transformations with structural changes. These test the format layer and the translator wrapper around the core engine.

**YAML reliability checks** validate YAML-specific parsing and serialization: the Norway problem (country code `NO` must stay a string, not become boolean false), octal number handling, nested YAML structures, anchors and aliases, multi-line literal blocks, Kubernetes manifests, Docker Compose files, and round-trip consistency.

**Export checks** verify generated JavaScript, plain module exports, n8n code, Make.com code, and standalone CLI files. The suite syntax-checks generated code across safe benchmarks, evaluates exported functions, runs CLI self-tests, checks report behavior, and guards regressions like duplicate value-map declarations.

**Preset and fixture checks** validate the examples that users see in the UI. Presets should open in a safe, useful state. Fixture checks cover realistic payloads such as Stripe payments, Shopify products, HubSpot contacts, Airtable exports, n8n webhooks, and Make.com webhooks.

**Acceptance checks** cover file import behavior, data-format parsing and serialization, smart suggestions, hardening fixtures, ARC grid reasoning, and the pattern-lab engine that still informs parts of the architecture.

## What gets asserted

Each benchmark can assert multiple properties about the engine's result. Common assertion types include:

**exact:** did the engine reproduce all example outputs correctly?

**expectedMethod:** did the engine use the expected inference method?

**minConfidence / evidence checks:** does the confidence label or evidence-check ratio meet the expected threshold?

**maxDurationMs:** did inference complete within a time budget?

**predictedEquals:** does the output for a specific input match an expected value?

**diagnosisStatus:** is the diagnosis status what we expected (safe, ambiguous, contradictory, unsafe)?

**expectedWarnings:** did the engine produce specific warning types?

**expectedContradictions:** did the engine detect contradictions in specific fields?

**expectedAmbiguities:** did the engine detect ambiguities in specific targets?

**suggestedExampleExists:** did the engine suggest adding another example?

A single test can combine multiple assertions. A real-world test might assert exact output, diagnosis status `safe`, and inference under a time budget. If any assertion fails, the report identifies which assertion broke and why.

## How adversarial tests work

The most interesting tests are the adversarial ones. They verify that the engine fails gracefully rather than producing overconfident garbage.

One test provides two examples where `role: "admin"` maps to `access: "full"` in one example and `access: "limited"` in another. The engine is expected to detect this as a contradiction, set the diagnosis status to `contradictory`, and identify the conflicting field. If the engine picks one mapping and ignores the conflict, the test fails.

Another test provides one example where the output could be explained by either a direct copy or a value map. The engine is expected to report the ambiguity, classify its severity, and suggest what kind of additional example would resolve it. If the engine silently picks one without reporting the alternative, the test fails.

These tests encode the contract: the engine must be honest about what it does not know. Producing output is easy. Knowing when to stop and ask for help is the hard part.

## The reliability profile

The build prints a summary for each layer. A recent local run includes checks like:

```
JSON transform benchmarks: 171 passed
Translator benchmarks:     78 passed
Export checks:             174 passed, 520 syntax checks
Preset checks:             29 passed
```

The exact counts change as the product grows. The important contract is stable: the build fails if a required benchmark, acceptance check, export check, or preset check fails. This means the version of the engine you see in your browser has passed the current check suite for that build.

## Reading the checks yourself

The benchmark suite ships with the tool. Because Latentmachine serves its JavaScript unminified and unbundled, you can read the relevant cases in your browser's developer tools.

Open DevTools, switch to the **Sources** tab, and navigate the file tree to find the benchmark files under `src/intelligence/` and the runner scripts under `scripts/`. Each benchmark is a plain JavaScript object with examples, assertions, and expected outcomes. You can read the test cases, see what inputs they use, check what they assert, and understand exactly what the engine is tested against.

The checks are not hidden infrastructure. They are part of the shipped code. If you want to know whether the engine handles a transformation similar to yours, search the benchmark files for a similar test case. If it exists, the engine handles it. If it does not, you have found a gap that might be worth reporting.

## What the checks do not test

The suite validates the intelligence layer, format layer, exporters, CLI behavior, fixtures, and presets. It does not replace visual QA. Layout, spacing, browser rendering, and interaction polish still need to be checked in the browser.

This separation is intentional. If the engine produces a correct rule and the UI renders it poorly, that is a UI bug, not an inference bug. The checks catch inference and export regressions. The browser catches product-surface regressions.

[Open Infer ->](/infer)
