---
title: "Transform Structured Data Without Writing Code"
description: "Latentmachine infers data transformation rules from before-and-after examples. No scripting, no query language, no syntax. Show the input, show the output, and the engine figures out the rule. Works for JSON, CSV, YAML, TOML, XML, and .env."
date: "2026-06-16"
---

There are two common ways to transform structured data. You write code, or you use a visual mapper that draws lines between fields. Both work. Both have costs.

Writing code gives you full control but takes time, especially when you are not transforming data as your primary job. You are building an automation, integrating an API, cleaning a CMS export, or migrating between systems. The transformation is a step in a larger process, and the time you spend writing a mapping function is time you are not spending on the actual problem.

Visual mappers remove the code, but they replace it with a different complexity: dragging lines between fields, configuring operations through dropdown menus, and debugging a transformation by hovering over connector icons. And most of them are tied to a platform you pay for.

There is a third option: show what you have, show what you need, and let the machine figure out the rule.

## How it works

Open the [Infer](/infer) and paste your data on the left. This is the input: a JSON payload, a CSV export, a YAML config, a TOML file, an XML document, or an `.env` file.

On the right, paste what the output should look like. Same data, different shape.

The engine compares the two, identifies the structural differences, generates candidate operations, validates each against your examples, and selects the simplest rule that produces an exact match. The entire process runs in your browser and typically completes in milliseconds.

The result is a symbolic rule you can read:

```
$.data.user.firstName + " " + $.data.user.lastName → $.name
lower($.data.user.contactEmail) → $.email
$.data.subscription.plan → $.plan
$.data.subscription.status = "active" → $.active (value map)
```

Each operation tells you what happens: which source field feeds which target, what transformation is applied, and which of your examples supports the inference.

## No syntax to learn

There is no query language, no expression builder, no configuration format. The interface is two text areas: what you have, what you need. If you can paste two JSON objects, you can use the tool.

This does not mean it is limited. The engine infers field renaming, nesting and flattening, type coercion, string concatenation and splitting, case changes, value maps, numeric operations, array projection, date formatting, and composed operations that combine several of these. It learns all of this from the structure of your examples.

The difference from code is not capability. It is the interface. Instead of expressing the transformation as a program, you express it as an example.

## The part that matters more than speed

The engine does not just infer a rule. It diagnoses it. If your examples are ambiguous (two rules fit equally well), it tells you which fields are ambiguous and what kind of example would resolve it. If your examples contradict each other, it identifies the conflict. If the new input contains a value the engine has not seen, it flags it instead of guessing.

This matters because the usual failure mode of data transformation is not a crash. It is a silent wrong value. A field mapped to null because the rule did not account for a new variant. A type coerced incorrectly because the first example happened to have a value that looked like a number. A string concatenated in the wrong order because the engine picked one interpretation and you meant the other.

The diagnosis system catches these at inference time, before the rule is applied to real data.

## Formats and cross-format transforms

Infer supports JSON, CSV, YAML, TOML, XML, and `.env`. The input and output formats do not need to match. You can paste a CSV on the left and JSON on the right, or YAML on the left and `.env` on the right. The engine parses both into a common structure, infers the transformation, and serializes the output in the target format.

Cross-format transformation is one of the tool's strongest uses. Converting a Kubernetes YAML manifest into a flat CSV for a deployment inventory, or turning CSV export rows into nested JSON for an API import, involves both format change and structural change. Showing a before-and-after example handles both at once.

## Exports

Once the engine marks a rule as safe, you can copy the transformed output, download it in any supported format, or export the rule as JavaScript code.

The JavaScript export comes in four flavors: a standalone function you paste anywhere, an n8n Code node you paste directly into a workflow, a Make.com JavaScript module, or a standalone CLI tool you can run from a terminal or CI pipeline.

The exported code is dependency-free. It uses optional chaining, nullish defaults, and a comment header documenting what the rule does. It looks like code a careful developer would write — because that is what program synthesis produces.

## Four tools under one roof

Infer is the core tool, but Latentmachine includes three more:

The [Verify](/verify) verifies whether a batch of transformed records all follow one rule. Paste originals and transformed data side by side, and it flags any row that breaks the pattern. This is useful for auditing LLM output, verifying migration scripts, and catching inconsistency in manual conversions.

The [Regex Builder](/regex) synthesizes regular expressions from match and reject examples. You show strings that should match and strings that should not, and the engine produces a verified pattern with named captures and a plain-English explanation.

The [jq Builder](/jq) generates jq expressions from selected JSON values or a desired output shape. Click the values you want, and the engine produces the jq query. It shows JSONPath equivalents where possible and asks when your selection is ambiguous.

All four tools share the same principles: inference from examples, verification before output, refusal when evidence is insufficient, and everything runs in the browser.

## Privacy

Nothing leaves your machine. There is no account system, no server-side processing, and no telemetry on your data. The inference engine runs entirely in the browser. Your examples, inputs, outputs, and rules stay on your device unless you choose to copy or export them.

This is not a policy statement. It is an architectural decision. The engine has zero runtime dependencies and makes zero network calls. You can verify this yourself by opening your browser's network tab while using the tool.

[Open Infer →](/infer)
