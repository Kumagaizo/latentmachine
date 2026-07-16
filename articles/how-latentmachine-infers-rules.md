---
title: "How Latentmachine Infers a Data Transformation Rule From Examples"
description: "A walkthrough of the symbolic inference engine behind Latentmachine — how it perceives structure, generates candidates, scores by simplicity, refuses to guess, and earns the right to say 'safe'. No neural networks. No language models. Just search and discipline."
date: "2026-05-21"
---

Latentmachine takes two or three before-and-after examples of structured data and infers the transformation rule as a symbolic program. The rule is deterministic, inspectable, and correctable. This article explains how the engine works — not as a code walkthrough, but as a series of design decisions and the reasoning behind them.

## The pipeline

Every transformation follows the same six-step pipeline:

```
perceive → generate candidates → score → select → diagnose → execute
```

Each step produces structured, traceable output. If the engine fails, the failure is specific: "no candidate explains this field" or "two candidates tie on this field" or "the input has a value the rule has never seen." The engine never shrugs.

## Step 1: Perceive structure

The engine parses each example pair into a structural representation. For every field in the input and output, it records: the path (including nesting), the type (string, number, boolean, array, object, null), and the value.

A flat object like `{ "name": "Ana", "age": 28 }` produces two entries: `$.name` (string) and `$.age` (number). A nested object like `{ "user": { "first": "Ana" } }` produces `$.user.first` (string). Arrays are walked recursively to find their element schemas.

This perception step is deliberately simple. There is no heuristic about what a field "means." The engine does not know that `email` is an email address or that `created_at` is a timestamp. It sees types, paths, and values. Meaning comes from the structural relationship between input and output, not from field names.

## Step 2: Generate candidates

For each field in the output, the engine asks: where could this value have come from?

It tries every plausible operation family. Each family has a cost prior, and the engine adds small evidence-based adjustments for things like path distance, composed string modes, or lookup-table risk:

**Direct mapping** (low prior). Does any input field have exactly the same value in every example? If `$.output.name` equals `$.input.first_name` across all examples, that is a direct set. Cheapest possible operation. If this matches, the engine knows this field is explained and skips all expensive generation for it.

**Type coercion** (low-to-medium prior). Does any input field become this output value after a type conversion? The string `"28"` becoming the number `28`. The string `"true"` becoming the boolean `true`. Simple, well-defined conversions.

**String case transforms** (low-to-medium prior). Does any input string become this output string after lowercasing, uppercasing, title-casing, trimming, or a composition like trim-then-title? The engine tries each mode and checks whether it produces the exact output for every example. Composed modes (trim+lower, trim+title) cost slightly more than single modes.

**Date formatting** (low-to-medium prior). Does the output look like a reformatted version of an input date? The engine tries common date transformations: ISO to US format, ISO to EU format, datetime to date-only.

**String templates** (cost: 1.58+). Is the output a string that contains fragments from multiple input fields with literal separators? `"Ana Lopez"` built from `$.first` + `" "` + `$.last`. The engine finds the template by locating each source value as a substring of the target and checking that the literal parts between them are stable across all examples.

**Concatenation** (medium prior). Similar to templates but modeled as an explicit list of sources with separators. The engine distinguishes templates (which can have arbitrary literal fragments) from concatenation (which has uniform separators between sources).

**Value mapping** (high prior). Does the same input value consistently produce the same output value? `"shipped"` always becomes `"On the way"`. The engine builds a lookup table from the examples and validates it. If the new input contains a value not in the table, the engine flags it as an unseen value instead of guessing.

**Split operations** (medium prior). Does the output look like a substring of the input? Split by a delimiter and take part N. Or split a comma-separated string into an array. Or extract text between brackets.

**Array operations** (cost: varies). Filter an array by a property, extract a field from each element, project into a new shape, count matching elements, join into a string, find a specific element.

**Constants** (high prior). Is the output value identical across all examples regardless of input? Then it is a constant. This is an expensive "explanation" because it means the output is unrelated to the input -- the engine only falls back to this when nothing else works.

Each candidate generator returns zero or more candidates, each with a cost. Lower cost means simpler. The candidates are collected and sorted.

## Step 3: Score by simplicity

This is where the engine's taste lives.

The scoring follows a Minimum Description Length principle: prefer the shortest program that exactly fits all examples. A direct field mapping beats a value map. A two-source template beats a three-source template. A string case transform beats a composed trim+case transform.

The costs are not arbitrary. They encode a belief about what is "more likely to generalize." A direct mapping generalizes perfectly — if the field exists in new input, the output will be correct. A value map only generalizes if the new input contains values the map has seen. A constant generalizes trivially but carries no information. The cost ordering reflects this gradient of generalization strength.

When two candidates sit in the same broad cost neighborhood, the engine prefers the one whose source field name is more similar to the target field name. `$.first_name` mapping to `$.firstName` gets a small bonus over `$.email` mapping to `$.firstName`. This is a soft adjustment, not a hard rule -- it breaks ties, not decisions.

## Step 4: Select the best candidate per field

For each output field, the engine picks the lowest-cost candidate that produces exact output for every example. If no candidate produces exact output for every example, the field is marked as "unexplained."

If the new input is available (the user has pasted data in the Try editor), the engine also checks whether any candidates would trigger guardrail warnings on the new input. A candidate with no warnings is preferred over one with warnings, even if the warned candidate has a slightly lower cost. This means the engine actively avoids rules that would produce uncertain output for the specific data the user is transforming.

## Step 5: Diagnose

This is the step that makes the engine trustworthy. After selecting the best program, the engine runs a full diagnosis:

**Contradiction detection.** For each output field, if two examples produce different output values from the same input pattern, the engine identifies the specific examples that conflict and the field they conflict on. It does not pick one and hope. It reports the contradiction and marks the rule as unsafe.

**Ambiguity detection.** For each output field, if two candidates have similar costs (within a threshold), the engine reports both candidates and suggests what additional example would disambiguate. "Two rules fit for `$.name`: merge first and last with a space, or use a string template. Add an example where `$.first` contains a space to test which is correct."

The engine also filters out "equivalent" ambiguities — when a concat and a template produce identical behavior (same sources, same separators), it suppresses the ambiguity because the operations are functionally identical. This avoids noise.

**Unseen value detection.** For value maps, the engine tracks which input values were seen in the examples. If the new input contains a value not in the map, the output field gets a marker: `[unresolved: unseen value at $.status]`. The engine never invents a mapping it has not observed.

**Missing field detection.** If the rule expects a source field that does not exist in the new input, the engine flags it with a specific warning identifying which field is missing and which operation depends on it.

**Suggested examples.** When ambiguity exists, the engine suggests what kind of example would resolve it. "Add an example where `$.year` differs from `$.month` to distinguish the date template ordering." These suggestions are derived from the competing candidates — the engine identifies which input variation would produce different outputs under the two competing rules.

The diagnosis output is a structured object with a status label: `safe`, `ambiguous`, `contradictory`, `unsafe`, or `insufficient`. This status drives the UI — when the status is not safe, the output is visually muted and the diagnosis is displayed prominently.

## Step 6: Execute

The selected program is applied to the new input. Each operation reads from the input, transforms, and writes to the output. The operations are independent — they do not depend on each other's output. This means the program is trivially parallelizable and order-independent.

If any operation encounters a runtime issue (missing source field, unseen value), it produces a marker string in the output instead of failing silently. The user sees exactly which fields have issues and why.

## The short-circuit: why most transformations are fast

The engine handles 20+ operation types, but most real-world transformations are simple renames and type coercions. A 20-field payload where 18 fields are direct mappings and 2 are coercions should not trigger template permutation analysis for the 18 simple fields.

The engine implements a short-circuit: for each output field, it first tries direct mapping and coercion. If either explains the field exactly, it skips all expensive generators (templates, concats, value maps) for that field entirely. This means a 20-field rename completes in 20 milliseconds instead of timing out — the expensive generators only run for fields that actually need them.

When the expensive generators do run, the engine pre-filters source fields by value relevance. A source field is only considered for template generation if its value actually appears as a substring of the target value. For a 20-field payload where only 3 source fields are relevant to a given template target, this reduces the permutation space from thousands to dozens.

These are not optimizations bolted on after the fact. They reflect the same principle as the scoring: prefer simple explanations. If a cheap operation works, do not waste time looking for an expensive one.

## The format layer: why the engine does not know about formats

The engine works on JavaScript objects — trees of typed values with named paths. It does not know whether those objects came from JSON, CSV, YAML, TOML, XML, .env, or any other format. Parsing and serialization happen in a separate format layer that wraps the engine.

This separation is deliberate. Adding a new format requires zero changes to the inference engine. Each format has a parser that converts text into objects and a serializer that converts objects back. The engine in the middle sees the same structural representation it always sees.

The format layer also handles type coercion at the parsing boundary. CSV and .env fields are strings by default, but `"true"` becomes a boolean, `"28"` becomes a number, and `"00123"` stays a string (preserving leading zeros). XML text values stay as strings until the output example demonstrates a type change. These decisions happen at parse time, not inference time. The engine never sees the raw text.

Cross-format translation — JSON to CSV, YAML to .env, XML to JSON — works automatically because the engine infers the structural transformation between the parsed objects. The output is then serialized in whatever format the user selected. The engine does not know a format change happened.

## Benchmarks as the product's spine

The engine runs through the current benchmark and acceptance suite before build: JSON transformations, cross-format translation, YAML parsing, TOML reliability, XML reliability, export correctness, CLI behavior, presets, fixtures, performance, ARC grid reasoning, text pattern matching, and engine regression.

Every new operation type ships with benchmark cases before it ships in the UI. Every performance fix ships with timing assertions. Every correctness fix ships with an adversarial test case that reproduces the exact failure.

The benchmarks are not a quality gate that runs before release. They are the product's spine — they define what the engine promises and verify that the promise holds. When a benchmark fails, the engine is broken. When all benchmarks pass, the engine works. There is no gap between the two.

This discipline came from the project's origins in ARC-style reasoning, where the benchmark is the entire product. A solver either produces the correct grid or it does not. There is no "close enough." That same binary discipline — exact match or failure — carries through to the data transformation engine.

## What the engine refuses to do

The engine does not guess. When the examples do not prove a rule, it says so. When two rules tie, it reports both. When an input value is unseen, it marks the output. When a source field is missing, it warns.

This refusal is not a limitation. It is the core product feature. The market is full of tools that confidently produce questionable output. An LLM will write a transformation function that works on the first three records and silently mangles record 47. A visual mapping tool will let you wire fields together without checking whether the mapping is consistent across examples.

Latentmachine earns trust by refusing to act when it is not sure. The diagnosis status — safe, ambiguous, contradictory, unsafe — is a contract between the engine and the user. When the engine says "safe," it means: the simplest rule that fits all examples has been found, no contradictions exist, no ambiguities remain, and every value in the new input has been accounted for. That is a specific, verifiable promise.

The engine's honesty about its limits is more valuable than its ability to transform data. Any tool can transform data. Very few tools can tell you whether the transformation is trustworthy.

[Open Latentmachine →](/infer)
