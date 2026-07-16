---
title: "Verify AI Data Transformations in Node.js"
description: "Use @latentmachine/verify to check whether AI-generated data transformations are consistent, infer deterministic rules from examples, and apply them to new data. Zero dependencies. Works in any Node.js pipeline, CI job, or automation script."
date: "2026-06-29"
tags: "npm,node,verify,llm,data-quality,pipeline,ci"
---

You used an LLM to reshape 500 records. The output looks correct. You spot-checked ten rows. They were fine. You imported the batch.

Two days later someone finds that rows 211 through 214 use a different date format. Row 387 has an extra field. Row 412 maps a status value to a label that does not exist in your system.

You could have caught all of this in one function call before importing anything.

## The package

`@latentmachine/verify` is the same engine that powers [Latentmachine's browser tools](/verify), prepared as a Node.js package. It exposes three functions — `verify`, `infer`, and `transform` — plus format detection utilities for JSON, CSV, YAML, TOML, XML, and .env.

Zero dependencies. ESM only. Works in Node 18 and later.

Availability: implemented and prepared for npm publishing. Until `@latentmachine/verify` is available on npm, use the browser tools or the live HTTP MCP endpoint.

Release target:

```bash
npm install @latentmachine/verify
```

## Verify a batch

Pass the original records and whatever the AI gave you back. The engine infers the majority rule from the batch and flags every row that breaks it.

```js
import { verify } from "@latentmachine/verify";

const result = verify({
  original: [
    { first: "Ana", last: "Meyer", joined: "2026-03-02" },
    { first: "Bo", last: "Singh", joined: "2026-03-04" },
    { first: "Clara", last: "Diaz", joined: "2026-03-05" },
  ],
  transformed: [
    { name: "Ana Meyer", joinedDate: "2026-03-02" },
    { name: "Bo Singh", joinedDate: "March 4, 2026" },
    { name: "Clara Diaz", joinedDate: "2026-03-05" },
  ],
});

console.log(result.verdict);
// "inconsistent"

console.log(result.flaggedRows[0]);
// { index: 1, input: {...}, expected: {...}, actual: {...} }
// Row 1 switched from ISO date to US date format.
```

You do not need to write the expected rule. You do not need to know what the transformation was supposed to be. The batch tells the engine what the majority did, and the engine tells you where the exceptions are.

## What the result contains

`verify()` returns a flat object with everything you need to act on:

- `verdict` — `"consistent"` or `"inconsistent"`.
- `totalRows` — how many rows were checked.
- `matchedRows` — how many followed the majority rule.
- `flaggedRows` — an array of `{ index, input, expected, actual }` for each row that broke the pattern. The `expected` field shows what the majority rule predicted. The `actual` field shows what the AI produced. The difference between the two is the drift.
- `ruleStatus` — the engine's confidence: `safe`, `ambiguous`, `contradictory`, `unsafe`, or `insufficient`.

## Infer a rule from examples

If Verify found inconsistencies and you want to define the correct transformation, use `infer`. Show one or more input/output examples. The engine infers the simplest deterministic rule that explains all of them.

```js
import { infer } from "@latentmachine/verify";

const result = infer({
  examples: [
    {
      input: { first: "Ana", last: "Meyer", joined: "2026-03-02T10:00:00Z" },
      output: { name: "Ana Meyer", joinedDate: "2026-03-02" },
    },
    {
      input: { first: "Bo", last: "Singh", joined: "2026-03-04T14:30:00Z" },
      output: { name: "Bo Singh", joinedDate: "2026-03-04" },
    },
  ],
});

console.log(result.status);
// "safe"
```

If the examples are ambiguous — two rules fit equally well — the engine reports both and tells you what kind of additional example would resolve the ambiguity. If the examples contradict each other, the engine identifies the conflicting fields. It does not silently pick one interpretation.

## Apply the rule to new data

Once you have a safe rule, apply it to any input. The transformation is deterministic. Same input, same rule, same output. Every time.

```js
import { infer, transform } from "@latentmachine/verify";

const { rule, status } = infer({
  examples: [
    { input: { first: "Ana", last: "Meyer" }, output: { name: "Ana Meyer" } },
    { input: { first: "Bo", last: "Singh" }, output: { name: "Bo Singh" } },
  ],
});

if (status === "safe") {
  const output = transform({ rule, input: { first: "Clara", last: "Diaz" } });
  console.log(output);
  // { name: "Clara Diaz" }
}
```

You can also pass an array. The engine transforms every row with the same rule.

```js
const outputs = transform({
  rule,
  input: [
    { first: "Clara", last: "Diaz" },
    { first: "Dana", last: "Park" },
  ],
});
// [{ name: "Clara Diaz" }, { name: "Dana Park" }]
```

## String input and format detection

`verify` accepts raw strings too. The engine auto-detects JSON, CSV, YAML, TOML, XML, and .env.

```js
import { verify, detectFormat } from "@latentmachine/verify";

detectFormat('[{"id": 1}]');      // "json"
detectFormat('id,name\n1,Ada');   // "csv"
detectFormat('key: value');       // "yaml"

const result = verify({
  original: '[{"id":1,"status":"active"},{"id":2,"status":"inactive"}]',
  transformed: '[{"id":1,"state":"active"},{"id":2,"state":"Inactive"}]',
});
// Works the same way.
```

## Use it in a CI pipeline

The package includes a CLI. It exits with code 0 if the batch is consistent, code 1 if it is not. This makes it composable in any script or pipeline step after the npm package is published.

```bash
npx @latentmachine/verify original.json ai-output.json
```

In GitHub Actions:

```yaml
- name: Verify transformation
  run: npx @latentmachine/verify fixtures/input.json fixtures/expected.json
```

The step fails automatically if any row breaks the pattern. No assertion library needed.

## When to use this

Use `verify` after any non-deterministic step touches structured data: an LLM transformation, a ChatGPT batch conversion, a one-off script you wrote in a hurry, a manual cleanup in a spreadsheet, or a migration export from a system you do not fully control.

Use `infer` when you need a reusable, inspectable rule instead of a script you cannot audit. The rule is a symbolic program — a list of named operations you can read, test, and trust.

Use `transform` when you want the same rule to run the same way every time, without re-inferring it on each call.

The engine does not use an LLM. It does not call any server. It does not guess. If the evidence is insufficient, it says so. If two rules tie, it reports both. If a value is unseen, it stops.

[Full developer documentation →](/developers)
