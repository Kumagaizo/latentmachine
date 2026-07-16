---
title: "Using Latentmachine with n8n and Make.com Workflows"
description: "How to use Latentmachine to generate transformation code for n8n Code nodes and Make.com JavaScript modules. Paste a webhook payload, show the shape you need, and export ready-to-use code. Works with JSON, CSV, YAML, TOML, XML, and .env inputs."
date: "2026-05-19"
---

If you build automations in n8n or Make.com, you have written a Code node before. Probably more than once. Probably to do something that felt like it should take two minutes but took twenty: renaming nested fields, converting types, flattening an object, splitting a comma-separated string into an array.

Latentmachine generates that code for you. You paste the webhook payload you received, paste the shape your next node expects, and export a working snippet. This article walks through the workflow for both platforms.

## The typical scenario

You have a webhook trigger that receives a payload from Stripe, HubSpot, Typeform, Airtable, or whatever system you are connecting. The payload has nested objects, inconsistent field names, and types that do not match what your database, CRM, or downstream API expects.

You need a Code node between the trigger and the next step that reshapes the data. The transformation itself is not complicated. The tedious part is reading the source payload, figuring out the path to each field, writing the mapping, and testing edge cases.

Latentmachine shortens this to three steps:

1. Paste the source payload as the input example.
2. Paste (or type) the shape you need as the output example.
3. Export the inferred rule in your platform's format.

The input does not need to be JSON. If your trigger receives CSV data, YAML configs, XML payloads, TOML files, or .env variables, paste them as-is. Latentmachine auto-detects the format and parses it before running inference. You can even paste the input in one format and the output in another — the engine handles cross-format transformation.

## Step by step with n8n

Open [Latentmachine](/infer) and add an example pair. In the input field, paste the payload your webhook trigger produces. You can find this in n8n by running the workflow once and checking the output of the trigger node.

In the output field, type the structure your next node expects. You do not need to use the exact same values. Just make sure the field names and structure are correct, and the values show the right type and format.

Add a second example with different values. This is important. One example is enough for simple renames, but two examples let the engine distinguish between a direct mapping and a coincidence. If the engine can only see one data point, it cannot tell whether "Ana Lopez" in the output came from concatenating first and last name or from a hardcoded constant.

Once the rule status shows "safe", use the action row to copy **n8n Code**. The export produces JavaScript that uses n8n's `$input.all()` pattern:

```javascript
// Latentmachine - inferred transformation
// Status: safe | Confidence: proven (5/5 checks)

const items = $input.all();
return items.map(item => {
  const input = item.json;
  const output = {};
  output.name = `${input?.user?.first ?? ""} ${input?.user?.last ?? ""}`;
  output.accountId = input?.account?.id;
  output.logins = Number(input?.login_count ?? 0);
  return { json: output };
});
```

Paste this directly into an n8n Code node. The snippet handles optional chaining and nullish values, so it will not throw on missing fields.

## Step by step with Make.com

The process is the same. Paste your payload, show the desired output, and export as **Make.com JavaScript**. The export uses Make's `inputData` convention:

```javascript
// Latentmachine - Make.com JavaScript transformation

const input = inputData || {};
const output = {};
output.name = `${input?.user?.first ?? ""} ${input?.user?.last ?? ""}`;
output.accountId = input?.account?.id;
output.logins = Number(input?.login_count ?? 0);

return output;
```

Add this to a JavaScript module in your Make.com scenario. The variable name `inputData` matches what Make passes to the module at runtime.

## What gets exported

Every exported snippet includes a comment header with the rule status, confidence label, evidence checks, and operation list. This is not decoration. If you revisit the Code node in six months, the header tells you what the transformation does and how well the examples supported the generated rule.

The code itself uses optional chaining (`?.`) throughout. If a field is missing at runtime, the expression returns `undefined` instead of throwing. For numeric conversions, it defaults to zero. For string operations, it defaults to empty strings. These are safe defaults for automation workflows where one malformed payload should not stop the entire run.

## When to add more examples

If you are mapping five flat fields from one name to another, one example is enough. The engine infers five direct moves and marks the rule as safe.

If your transformation involves concatenation, type conversion, string splitting, or value maps, add at least two examples. The engine needs variation to distinguish between operations. For instance, if every example has `status: "active"` mapping to `live: true`, the engine cannot tell whether this is a value map (active means true, inactive means false) or a constant (always true). A second example with `status: "inactive"` mapping to `live: false` resolves this immediately.

If the engine shows a status of "ambiguous" or "insufficient", the diagnosis will tell you exactly what kind of example to add. Follow its suggestion. It is usually one more example with a different value in one specific field.

## Beyond the Code node

For rules marked safe, Latentmachine can also export a **standalone CLI tool** — a single JavaScript file with no dependencies that you can run from a terminal, a cron job, or a CI pipeline. The CLI includes the same transformation logic, plus input validation, guardrail checks, and a baked self-test. This is useful when the transformation runs outside of n8n or Make.com, or when you want to process files in a shell script.

## Keeping the code in sync

When the source API changes its payload structure, run Latentmachine again with the new payload shape. The engine will infer a new rule, and you can re-export. Since the code is a self-contained snippet with no dependencies, replacing it in your Code node is a clean swap.

The copied rule program is also useful here. If you store it alongside your workflow documentation, you can compare the old and new rules to see exactly what changed in the transformation.

[Try the API normalization example →](/?sample=api-normalization)
