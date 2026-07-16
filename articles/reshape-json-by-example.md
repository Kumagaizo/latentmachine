---
title: "How to Reshape JSON Data by Showing Examples"
description: "Learn how to transform JSON payloads, reshape API responses, and clean messy exports by showing before-and-after examples instead of writing scripts. Includes Stripe, WordPress, HubSpot, and Airtable examples with exportable JavaScript."
date: "2026-05-19"
---

Most developers write a script when they need to transform a webhook payload, reshape an API response, or clean a data export. There is a faster approach: show two before-and-after examples and let a rule engine figure out the transformation. This guide walks through real scenarios with real payloads.

## The problem with writing transformation code

Every API speaks a different dialect of JSON. A Stripe webhook wraps payment data three levels deep. A WordPress REST response nests the post title inside an object. A HubSpot contact buries fields inside a "properties" key. An Airtable export has inconsistent casing and extra whitespace.

When you need this data in a different shape — for a database, a CMS import, a downstream API, or an automation workflow — you write a transformation function. For simple renames, that takes five minutes. For nested structures with type conversions, array filtering, and string cleanup, it takes thirty minutes to an hour. And every time the source format changes, you update the script.

There is an alternative: instead of writing the transformation, you demonstrate it. You show two or three examples of what the input looks like and what the output should be. A rule engine analyzes the structural difference, infers the simplest program that maps one to the other, and produces a reusable function.

This is called programming by example. It has been studied in computer science since the 1970s, and it powers features like Flash Fill in Excel. But until recently, no standalone tool applied it to structured data transformations across formats with full structural support — nested objects, arrays, type conversions, string operations, and composable rules.

[Latentmachine](/infer) is a browser-based tool that does this. The examples below use it to demonstrate the approach. Each example shows the input payload, the desired output, the inferred rule, and the exported JavaScript — which you can copy directly into your codebase, an n8n Code node, or a Make.com module.

## Stripe webhook to database record

Stripe sends payment events as deeply nested JSON. A typical `payment_intent.succeeded` webhook looks like this:

```json
{
  "id": "evt_1abc",
  "type": "payment_intent.succeeded",
  "data": {
    "object": {
      "id": "pi_xyz",
      "amount": 4999,
      "currency": "usd",
      "customer": "cus_123",
      "metadata": { "order_id": "order_500" }
    }
  }
}
```

For your database, you need a flat record:

```json
{
  "paymentId": "pi_xyz",
  "amount": 4999,
  "currency": "usd",
  "customerId": "cus_123",
  "orderId": "order_500"
}
```

Show two examples of this transformation. Latentmachine infers five operations:

```
$.data.object.id → $.paymentId
$.data.object.amount → $.amount
$.data.object.currency → $.currency
$.data.object.customer → $.customerId
$.data.object.metadata.order_id → $.orderId
```

Status: safe. Confidence: proven. All five are direct field mappings from nested source paths to flat target keys. No ambiguity, no guessing.

The exported JavaScript:

```javascript
function transform(input) {
  return {
    paymentId: input?.data?.object?.id,
    amount: input?.data?.object?.amount,
    currency: input?.data?.object?.currency,
    customerId: input?.data?.object?.customer,
    orderId: input?.data?.object?.metadata?.order_id,
  };
}
```

For an n8n workflow, the export wraps this in the `$input.all()` pattern so you can paste it directly into a Code node.

[Try a Stripe accounting preset →](/?sample=stripe-accounting-csv)

## WordPress REST API to Webflow CMS

The WordPress REST API returns posts with the title nested inside an object and the date as a full ISO timestamp:

```json
{
  "id": 101,
  "title": { "rendered": "Solar Panel Guide" },
  "date": "2024-03-15T09:30:00",
  "slug": "solar-panel-guide",
  "status": "publish"
}
```

Webflow's CMS import expects a flatter structure with just the date, not the time:

```json
{
  "name": "Solar Panel Guide",
  "slug": "solar-panel-guide",
  "date": "2024-03-15",
  "status": "publish"
}
```

Two examples are enough. The engine infers:

```
$.title.rendered → $.name
$.slug → $.slug
splitPart($.date, "T", 0) → $.date
$.status → $.status
```

The date conversion is not a rename — the engine detected that the output date is the portion of the input date before the "T" character and inferred a `splitPart` operation. This is a structural inference, not a string match.

If you feed this rule a post with status "draft" — a value not seen in the examples — the engine passes it through directly because "status" is a direct mapping, not a value map. It does not need to have seen every possible value.

[Try the CMS migration preset →](/?sample=cms-migration)

## Cleaning messy Airtable exports

Data exported from Airtable, Google Sheets, or manual entry often has inconsistent formatting — extra whitespace, wrong casing, fields that should be arrays stored as comma-separated strings:

```json
{
  "Name": "  john doe ",
  "Email": "JOHN@EXAMPLE.COM",
  "Tags": "solar, renewable, diy",
  "Status": "Active"
}
```

You need:

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "tags": ["solar", "renewable", "diy"],
  "status": "Active"
}
```

The engine infers four operations from two examples:

```
trim+title($.Name) → $.name
lower($.Email) → $.email
split($.Tags, ", ") → $.tags
$.Status → $.status
```

Three different operation types in one rule: a composed string transform (trim then title-case), a case conversion (lowercase), and a string-to-array split. The engine composes these because no single operation explains the change — "John Doe" requires both trimming and title-casing applied in sequence.

The "status" field passes through unchanged because the input and output values are identical across all examples. The engine does not apply a transformation where none is needed.

[Try a messy data cleanup preset →](/?sample=messy-csv-cleanup)

## Normalizing API payloads for a unified schema

When integrating multiple APIs — a CRM, a payment processor, an analytics service — you often need to normalize their different response shapes into a single internal format:

```json
{
  "user": { "first": "Ana", "last": "Lopez" },
  "account": { "id": "a1" },
  "login_count": "12"
}
```

Becomes:

```json
{
  "name": "Ana Lopez",
  "accountId": "a1",
  "logins": 12
}
```

The engine infers:

```
concat($.user.first, " ", $.user.last) → $.name
$.account.id → $.accountId
number($.login_count) → $.logins
```

Three operation types: string concatenation (merging first and last name with a space), nested field extraction (pulling "id" out of the "account" object), and type coercion (converting the string "12" to the number 12). Each operation is independent and verifiable.

[Try this example in Latentmachine →](/?sample=api-normalization)

## Filtering and reshaping arrays

Order payloads often contain mixed line item types — products, shipping, tax — and you need only the products:

```json
{
  "lineItems": [
    { "type": "product", "name": "Widget", "qty": 2, "unitPrice": 10 },
    { "type": "shipping", "name": "Express", "qty": 1, "unitPrice": 5 },
    { "type": "product", "name": "Gadget", "qty": 1, "unitPrice": 25 }
  ]
}
```

You need:

```json
{
  "products": [{ "name": "Widget", "qty": 2 }, { "name": "Gadget", "qty": 1 }]
}
```

The engine infers an array filter with projection:

```
filter($.lineItems, type="product") project(name, qty) → $.products
```

It detected that the output array contains only items where type equals "product", and that only the "name" and "qty" fields are kept. The "unitPrice" and "type" fields are dropped from the projection. This is not a simple rename — it is a structural operation on the array contents.

[Open Latentmachine →](/infer)

## What happens when examples are not enough

Not every transformation can be inferred from two examples. When the engine detects a problem, it tells you — specifically and actionably.

**Contradictory examples:** if one example maps "admin" to "full access" and another maps "admin" to "limited access", the engine flags the contradiction and identifies which examples conflict and on which field. It does not pick one and hope for the best.

**Ambiguous rules:** if two different rules both produce correct output for all examples, the engine reports both candidates and suggests what additional example would disambiguate them. For instance, "are you renaming all fields to camelCase, or just these specific fields?"

**Unseen values:** if the rule includes a value mapping (like "shipped" to "On the way") and the new input contains a value not seen in examples (like "returned"), the engine marks that field as unresolved instead of guessing the output.

**Missing fields:** if the rule expects a source field that is absent from the new input, the engine flags it with a specific message identifying which field is missing and which operation depends on it.

This diagnostic layer is not optional polish. It is the core of how the tool works. An inferred rule is only useful if you know whether to trust it.

## Exporting rules for automation workflows

Once a rule is marked as safe, you can export it in several formats.

**n8n Code node:** a ready-to-paste JavaScript snippet that wraps the transformation in n8n's `$input.all()` pattern and returns items in the `{ json: { ... } }` shape n8n expects. Copy it into a Code node and connect it between your webhook trigger and the next node.

**Make.com module:** a snippet formatted for Make.com's JavaScript transformation runtime, using the `inputData` convention.

**Standalone JavaScript:** a self-contained `transform()` function with no dependencies. Use it in Node.js scripts, serverless functions, or any JavaScript environment.

**Copy rule:** the raw program representation as a JSON object, including the operation list, preconditions, confidence assessment, and diagnosis metadata. Useful for storing rules programmatically or building your own tooling on top.

Every exported function includes a comment header with the rule status, confidence label, evidence checks, and operation list, so the code documents itself.

## How this differs from using an LLM

You can ask an LLM to write a transformation function from a natural language description or a couple of examples. In many cases it will produce correct code on the first try. But there are structural differences worth understanding.

**Determinism:** an LLM may produce different code on different runs for the same prompt. Latentmachine produces the same rule every time for the same examples. If you add an example or change one, the rule updates predictably.

**Inspectability:** an LLM gives you code you read and verify. Latentmachine gives you the rule as a symbolic program and the code as an export. You can inspect the rule independently of the code — see each operation, check which examples support it, and understand why it was chosen.

**Diagnosis:** an LLM does not tell you when your examples are ambiguous or contradictory. It produces its best guess. Latentmachine refuses to guess — it reports the specific issue and suggests how to resolve it.

**Privacy:** Latentmachine runs entirely in the browser. No data is sent to any server. An LLM-based approach requires sending your data to a remote API.

For complex, one-off transformations that require natural language understanding or arbitrary logic, an LLM is the better tool. For structured, repeatable transformations where you need determinism, inspectability, and trust — example-based inference is more reliable.

## Technical details

Latentmachine is a browser-based tool written in JavaScript. The transformation engine follows a program synthesis pipeline:

- Parse input and output structures (field types, nesting, arrays)
- Compute structural diffs across all example pairs
- Generate candidate operations for each structural change
- Validate candidates against all examples (exact match required)
- Score candidates by complexity (simpler rules preferred)
- Run diagnosis (contradictions, ambiguities, guardrails)
- Select the simplest complete program that fits all examples
- Execute on new input and return output with full trace

Typical inference completes in milliseconds for ordinary payloads, and the build runs the current benchmark and acceptance suite across unit operations, real-world scenarios, cross-format translation, YAML parsing, adversarial edge cases, export correctness, CLI behavior, presets, and performance.

The tool is free to use and requires no account. All data stays in the browser.

[Open Latentmachine →](/infer)
