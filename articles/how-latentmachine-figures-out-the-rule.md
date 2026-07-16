---
title: "How Latentmachine Figures Out the Rule: A Plain Explanation of Program Synthesis"
description: "Latentmachine infers data transformation rules from examples using program synthesis. This article explains the pipeline step by step: structural diffing, candidate generation, validation, cost-based selection, and diagnosis."
date: "2026-05-19"
---

When you paste two examples into Latentmachine and it returns a working transformation in 8 milliseconds, it can feel like magic. It is not. The engine follows a specific pipeline with clear steps, and every step is inspectable. This article explains what happens between "paste" and "result" in plain terms.

## The pipeline in one sentence

The engine compares the structure of your input and output examples, generates every plausible operation that could explain each difference, validates each candidate against all examples, picks the simplest program that produces exact matches, and then checks its own work.

That is program synthesis. Not AI in the machine-learning sense. No training, no weights, no neural network. Just structured search over a space of candidate programs, constrained by your examples.

## Step 1: Parse the structures

The engine parses the input and output data and produces a flat list of leaf entries for each. Each entry records its path (like `$.data.user.firstName`), its type (string, number, boolean, array), and its value.

The data can be in any supported format — JSON, CSV, YAML, TOML, XML, or .env. A format layer handles parsing each format into a common internal representation before the inference engine sees it. The engine works on the parsed structure, not on raw text.

For the input `{ "user": { "first": "Ana", "last": "Lopez" } }`, the engine sees two leaf entries:

```
$.user.first → "Ana" (string)
$.user.last → "Lopez" (string)
```

For the output `{ "name": "Ana Lopez" }`, it sees one:

```
$.name → "Ana Lopez" (string)
```

This structural parsing is what lets the engine handle deeply nested objects. It does not care about depth or key names. It just flattens every path and records what lives there.

## Step 2: Generate candidates for each output field

For every leaf in the output, the engine asks: "What operation on the input could have produced this value?" It tries every operation type it knows against every source field in the input, and keeps the ones that produce the correct output value for all examples.

For the output field `$.name` with value "Ana Lopez", the engine tries:

**Direct mapping.** Is there a source field whose value is already "Ana Lopez"? No. Move on.

**String concatenation.** Are there two source fields that, joined with some separator, produce "Ana Lopez"? Yes: `$.user.first` ("Ana") + " " + `$.user.last` ("Lopez") = "Ana Lopez". Candidate found.

**Template.** Is "Ana Lopez" a string where source values appear at fixed positions with stable text around them? Yes: `{$.user.first} {$.user.last}`. Another candidate.

**String case, type coercion, date formatting, split, value map...** The engine tries each operation type. Most do not match. The ones that do become candidates.

Each candidate gets a simplicity cost. Simpler operations cost less. A direct field copy starts around 1.05, a concatenation around 1.65, and a value map around 2.25 before small evidence adjustments. The costs reflect a preference: if a simpler operation explains the data, prefer it over a complex one. This is Occam's razor encoded as arithmetic.

## Step 3: Validate across all examples

A candidate is only valid if it produces the correct output for every example, not just the first one. This is the critical constraint.

If you provide two examples and a concatenation candidate produces the right output for both, it survives. If it matches the first example but fails on the second, it is discarded. No exceptions.

This is why two examples are better than one. With one example, many candidates might match by coincidence. With two, most coincidences are eliminated.

## Step 4: Select the cheapest program

For each output field, the engine now has a list of validated candidates sorted by cost. It picks the cheapest one. If the cheapest candidate would trigger a runtime warning on the new input (like a missing source field), it looks for the next candidate that would not.

The final program is the collection of selected operations, one per output field. If the output has five fields, the program has five operations.

```
concat($.user.first, " ", $.user.last) → $.name        cost: 1.65
$.account.id → $.accountId                              cost: 1.05
number($.login_count) → $.logins                        cost: 1.45
```

The total program cost is the sum of individual operation costs. This number is not shown to you directly, but it drives every selection decision internally.

## Step 5: Test the program

The engine runs the selected program against every example and checks whether the output matches exactly. If it does, the program is marked as exact. If it does not, something went wrong in selection, and the engine reports which examples failed and why.

In practice, exact matches are the norm when candidates exist. The engine only selects validated candidates, so the program should reproduce every example by construction. But the verification step exists because composed operations can interact in unexpected ways, and the engine does not trust its own intermediate results without checking.

## Step 6: Diagnose

This is where the engine earns its keep. After building the program, it runs a diagnosis pass:

**Contradictions.** If two examples map the same input value to different outputs for the same field, the engine catches it and reports which examples conflict.

**Ambiguity.** If two candidates for the same field have similar costs and both survive validation, the engine reports both interpretations and suggests what kind of additional example would distinguish them.

**Unexplained fields.** If an output field has no valid candidates at all, the engine flags it. This means no operation it knows can explain how the input produces that output.

**Runtime warnings.** If the selected program depends on a source field missing from the new input, or uses a value map containing a value not seen in any example, the engine warns before producing output.

The diagnosis is not an afterthought. It is what makes the tool trustworthy. Any engine can produce output. The useful question is whether you should trust that output, and if not, what to do next.

## Why this is fast

The engine runs quickly for typical payloads because the search space is bounded. The number of candidate operations per output field is roughly: (number of source fields) times (number of relevant operation families). For a payload with 15 source fields and several operation families, the engine can generate and validate thousands of candidates without searching arbitrary JavaScript.

There is no recursion over arbitrary program depth. Each output field is handled independently. The program is always a flat list of operations, one per target. This is a deliberate design constraint: Latentmachine infers shallow, composable transformations, not arbitrary programs. This keeps inference fast and the results inspectable.

## The operation vocabulary

The engine currently knows a bounded vocabulary of operation types, including:

**Structural:** direct copy, constant value.
**String:** case change, trim, concatenation, splitting, template fill, extract between markers.
**Numeric:** addition, multiplication, binary math between two fields, type coercion.
**Boolean:** inversion, string-to-boolean coercion.
**Date:** format conversion between ISO, US, European, year-month, and year-only.
**Array:** map, project, filter, count, join, find.
**Lookup:** value map with guardrails for unseen values.

Each operation type has its own inference function that checks whether it can explain the difference between input and output. The functions are independent and stateless. Adding a new operation type means writing one inference function and one execution function. Everything else (validation, diagnosis, export) works automatically.

## The format layer

The engine works on parsed JavaScript objects — trees of typed values with named paths. It does not know whether those objects came from JSON, CSV, YAML, TOML, XML, .env, or any future format. Parsing and serialization happen in a separate format layer that wraps the engine.

This separation is deliberate. Adding a new format requires zero changes to the inference engine. The format parser converts text into objects. The format serializer converts objects back. The engine in the middle sees the same structural representation regardless of the source format.

The format layer also handles type coercion at the parsing boundary. CSV and .env fields are strings by default, but `"true"` becomes a boolean, `"28"` becomes a number, and `"00123"` stays a string (preserving leading zeros). XML text values stay as strings and are coerced only when the output example demonstrates the conversion. These decisions happen at parse time, not inference time. The engine never sees the raw text.

Cross-format translation — JSON to CSV, YAML to .env, XML to JSON — works automatically because the engine infers the structural transformation between the parsed objects. The output is then serialized in whatever format the user selected. The engine does not know a format change happened.

## What you get back

The final result is not just the output. It is a structured artifact containing:

The **program** (the list of operations), the **confidence assessment** (label, checks, and reasons), the **status** (safe, ambiguous, contradictory, unsafe, or insufficient), the **preconditions** (which input fields the rule depends on), the **evidence** (which examples support each operation), the **diagnosis** (contradictions, ambiguities, warnings, suggested next examples), and the **explanation** (why each operation was selected over alternatives).

Every field in this artifact is inspectable. You can see not just what the engine decided, but why it decided it, what it considered, and what would change its mind.

[Open Latentmachine →](/infer)
