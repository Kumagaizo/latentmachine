---
title: "Build jq Queries by Clicking, Not Typing"
description: "Latentmachine's jq Builder generates jq expressions from selected JSON values or a desired output shape. It verifies the query, shows JSONPath equivalents, and asks when your selection is ambiguous. No jq syntax required."
date: "2026-06-16"
---

jq is a good tool. It is fast, composable, and available on almost every machine. But it has a learning curve that punishes you at the worst time: when you are in the middle of something else and just need to extract three fields from a JSON payload.

You know which fields you want. You can see them in the data. You could point to them. What you cannot always do is write `.data.users[] | select(.active == true) | .email` from memory at 11pm on a Wednesday.

The [jq Builder](/jq) lets you point.

## Two modes

The jq Builder has two ways to build a query.

**Pick mode.** Paste your JSON, then click the values you want. The engine generates the jq expression that extracts exactly those values. Click a single field, get `.data.email`. Click three fields from inside an array, get `.data.users[] | {name, email, role}`. Click a value inside a nested object, get `.config.database.host`.

**Reshape mode.** Paste your JSON in the input panel, then write the shape you want in the output panel. The engine infers the jq expression that transforms the input into the output. This is the same by-example approach Infer uses, but the result is a jq expression instead of a symbolic rule.

Pick mode is faster for simple extractions. Reshape mode handles structural changes: renaming fields, filtering arrays, flattening nested objects, or building a new shape from scattered values.

## Verified preview

Before you see the jq expression, the engine runs it against your input and compares the actual output to what you asked for. If the result does not match your selections (in pick mode) or your desired output (in reshape mode), the expression is not shown.

This sounds like a small detail. It is not. The usual jq workflow is: write expression, run it, check output, fix typo, run again. The jq Builder compresses this to: select, see verified result, copy. The verification happens before the expression is displayed.

## JSONPath output

Some environments do not use jq. REST APIs, JavaScript codebases, and certain integration platforms use JSONPath instead. Where the jq expression has a JSONPath equivalent, the jq Builder shows both.

Not every jq expression can be represented as JSONPath. Array filters (`select()`), object construction, and pipe chains do not have JSONPath equivalents. When the jq Builder detects this, it shows only the jq expression and omits the JSONPath line rather than showing an inaccurate translation.

## Ambiguity handling

If you click two values from inside an array and the engine cannot determine whether you want those specific elements (by index) or all elements matching a pattern (by field), it asks.

This is the same refusal principle that applies across all of Latentmachine's tools. When the selection is ambiguous, the engine does not pick an interpretation. It presents both, explains the difference, and lets you choose.

For example, clicking the emails from the first and third users in a list of three could mean "extract emails from items at index 0 and 2" or "extract emails from all users where active is true" (if those happen to be the active ones). The engine flags this and shows you both interpretations.

## What it does not do

The jq Builder generates queries for extraction and simple reshaping. It does not handle jq's full language: no variables, no `def` functions, no `reduce`, no recursive descent with `..`, no string interpolation with `\(...)`.

If you need the full power of jq, you need jq. The Builder is for the 80% of cases where you know what you want from the data and just need the expression that gets it.

## When to use this instead of Infer

Infer infers a symbolic rule and exports JavaScript. The jq Builder produces a jq expression. Choose based on where the result needs to run.

If you are building a shell script, a CI pipeline, or anything that pipes JSON through command-line tools, the jq expression is what you need. If you are building an n8n workflow, a Make.com automation, or a Node.js function, the JavaScript export in Infer is more useful.

Both tools use the same inference engine underneath. The difference is the output format.

[Open jq Builder →](/jq)
