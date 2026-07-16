---
title: "The Complete Guide to Transforming Structured Data by Example"
description: "Everything you need to know about transforming JSON, CSV, YAML, TOML, XML, and .env data by showing before-and-after examples instead of writing code. Covers real-world scenarios, cross-format conversion, the diagnosis system, code export, and when to use a different tool."
date: "2026-06-16"
---

You need to turn a Stripe webhook into a database record. Or flatten a Kubernetes manifest into a spreadsheet. Or reshape a CMS export for a different platform. Or convert an API response from one nesting structure to another. Or clean up a CSV where every field has the wrong type, the wrong casing, and trailing whitespace.

You know what the output should look like. You can picture it. You could write it by hand for one record. The tedious part is making it work for every record — and keeping it working when the source format changes next month.

This guide covers a different approach: instead of writing the transformation, you demonstrate it. You show two examples of what the input looks like and what the output should be, and a rule engine figures out the rest.

## What "by example" means

Most data transformation tools ask you to describe what you want. Write a jq expression. Configure a mapping. Build a pipeline. Drag lines between fields. Prompt an LLM.

Transformation by example flips this. You show what you have and what you need. The engine analyzes the structural difference, infers the simplest program that maps one to the other, and gives you a verified, inspectable rule.

This is not a new idea. The concept is called Programming by Example (PBE) and dates back to the 1970s. If you have ever used Flash Fill in Excel — type "John" next to "John Smith" and Excel fills in the first names for the whole column — you have used PBE. The difference is that [Latentmachine](/) applies the approach to structured data across six formats, with a full diagnosis system that tells you when the rule is not safe.

The practical result: instead of writing a transformation function, you paste two examples. Instead of testing it yourself, the engine verifies it against your examples. Instead of hoping it handles edge cases, the engine tells you which edge cases it cannot handle yet.

## A real example: Stripe webhook to database record

A Stripe `payment_intent.succeeded` webhook sends deeply nested JSON:

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

Your database expects a flat record:

```json
{
  "paymentId": "pi_xyz",
  "amountUsd": 49.99,
  "customerId": "cus_123",
  "orderId": "order_500"
}
```

Paste both into Latentmachine's [Infer](/infer) as an example pair. Add a second example with different values. The engine infers:

```
$.data.object.id → $.paymentId
$.data.object.amount / 100 → $.amountUsd
$.data.object.customer → $.customerId
$.data.object.metadata.order_id → $.orderId
```

Four operations: extract from nested paths, divide cents by 100, rename fields. The engine figured out the division because 4999 in the input became 49.99 in the output, and a second example confirmed the pattern.

The rule status shows "safe." The exported JavaScript includes optional chaining, nullish defaults, and a comment header documenting every operation. You paste it into an n8n Code node, a Make.com module, or a standalone Node.js script.

## Cross-format transformation: CSV to nested JSON

Most format converters change syntax without changing structure. They turn CSV columns into JSON keys with the same flat layout. But real-world conversions almost always involve structural change too.

Your spreadsheet has flat rows:

```csv
name,email,company,role
Ana Lopez,ana@acme.com,Acme Corp,admin
```

Your API expects nested JSON:

```json
{
  "user": {
    "fullName": "Ana Lopez",
    "email": "ana@acme.com"
  },
  "organization": "Acme Corp",
  "permissions": { "role": "admin" }
}
```

Show two example pairs. The engine infers: move `name` into `user.fullName`, move `email` into `user.email`, rename `company` to `organization`, and nest `role` inside `permissions`. The format change (CSV to JSON) and the structural change (flat to nested) happen in one step.

This works for any format combination. JSON to CSV. YAML to JSON. XML to CSV. TOML to .env. The engine parses both formats into a common structure, infers the transformation between them, and serializes the output in the target format.

## Config reshaping: YAML to flat records

A Kubernetes Deployment manifest buries useful information in nested structure:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
  namespace: production
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: web
          image: myapp:1.2.3
```

You need a flat record for a deployment inventory:

```json
{
  "name": "web-app",
  "namespace": "production",
  "replicas": 3,
  "image": "myapp:1.2.3"
}
```

The engine infers four extractions from different nesting levels. The YAML anchors, multi-line strings, and the Norway problem (where the country code `NO` is mistakenly parsed as boolean `false`) are all handled by the format layer before inference begins.

## Data cleaning: messy exports to clean imports

Exports from Airtable, Google Sheets, or manual entry often arrive with inconsistent formatting:

```json
{
  "Name": "  john doe ",
  "Email": "JOHN@EXAMPLE.COM",
  "Tags": "solar, renewable, diy",
  "Active": "true"
}
```

You need:

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "tags": ["solar", "renewable", "diy"],
  "active": true
}
```

The engine infers four different operation types from two examples: trim and title-case the name (a composed string operation), lowercase the email, split the comma-separated tags into an array, and coerce the string `"true"` to the boolean `true`. Each operation is independent and verifiable.

## How the engine works

The inference pipeline has six steps:

**Parse.** The engine parses input and output data (in any supported format) into a common structural representation: paths, types, and values.

**Generate candidates.** For each output field, the engine tries every operation it knows: direct copy, type coercion, string case change, concatenation, template, value map, date formatting, array operations, split, numeric operations. Each candidate that produces the correct output value across all examples survives.

**Score by simplicity.** Each surviving candidate gets a cost based on the Minimum Description Length principle: simpler operations cost less. A direct copy beats a value map. A two-field concatenation beats a three-field template.

**Select.** For each output field, the engine picks the cheapest valid candidate. The result is a flat program: one operation per output field.

**Diagnose.** The engine checks its own work: contradictions (examples disagree), ambiguity (two rules tie), unseen values (new input has values the examples never covered), missing fields (a required source field is absent).

**Execute.** The program is applied to the new input. Any runtime issue produces a specific warning, not silent failure.

The entire process runs in the browser. No server calls. No data leaves your machine. Typical inference completes in milliseconds.

## The diagnosis system: why it matters more than speed

The diagnosis is what makes inference trustworthy. Every other tool — hand-written code, jq, JSONata, LLMs, visual mappers — produces output and hopes for the best. The engine produces output and tells you whether to trust it.

**Contradictions.** If one example maps `status: "admin"` to `access: "full"` and another maps `status: "admin"` to `access: "limited"`, the engine identifies the conflicting examples and the specific field. It does not pick one silently.

**Ambiguity.** If two rules fit equally well (a direct copy and a value map both produce correct output for all examples), the engine reports both and tells you exactly what kind of additional example would distinguish them.

**Unseen values.** If the rule includes a value map and the new input contains a value the engine has not seen in any example, it flags the field instead of guessing. This is how the engine prevents the most common silent failure in production: a new enum value flowing through a mapping that does not handle it.

**Missing fields.** If the rule depends on a source field that is absent from the new input, the engine warns before producing output. The warning names the missing field and the operation that depends on it.

Each diagnosis comes with a next step. Not "something went wrong" but "add an example where this specific field has a different value." Two or three rounds, and the engine is willing to say "safe."

## What you get: rule, code, and CLI

Once the engine marks a rule as safe, you can export it in several ways:

**Transformed output.** Copy or download the result in any supported format — JSON, CSV, YAML, TOML, XML, or .env.

**Symbolic rule.** The program as a readable specification: which field maps where, what operation is applied, which examples support it.

**JavaScript.** A standalone `transform()` function with no dependencies. Uses optional chaining, nullish defaults, and a comment header documenting the rule. Paste it into any JavaScript environment.

**n8n Code.** A ready-to-paste snippet using n8n's `$input.all()` pattern.

**Make.com JavaScript.** A snippet using Make.com's `inputData` convention.

**Standalone CLI.** A single JavaScript file you run from a terminal. It includes the transformation logic, input validation, guardrail checks, a diagnostic report, and a baked self-test. No dependencies. No internet. Use it in shell scripts, cron jobs, and CI pipelines.

## Six formats, any combination

Infer handles JSON, CSV, YAML, TOML, XML, and .env as both input and output. The formats do not need to match. You can paste YAML on the left and JSON on the right, or XML on the left and CSV on the right.

The engine auto-detects the format from the content. If auto-detection gets it wrong (some edge cases between YAML and .env, for example), each editor has a manual format selector.

Type handling varies by format. JSON has native types. CSV and .env values are strings by default — the engine coerces types based on what your output example demonstrates. XML text values stay as strings until your output shows a number or boolean. TOML preserves its native types. YAML handles the Norway problem (country code `NO` stays a string, not boolean `false`).

## When to use a different tool

Transformation by example handles structural, repetitive data mapping. It does not handle everything.

**Write code yourself if** the transformation depends on external state (database lookups, feature flags, user roles at runtime), requires conditional branching beyond value maps, or involves logic that cannot be inferred from before-and-after examples.

**Use jq or JSONata if** the transformation is part of a shell pipeline, needs recursion, variables, or computed values, or needs the full power of a query language. For simpler jq needs, the [jq Builder](/jq) can generate the expression by letting you click the values you want.

**Use an LLM if** you need natural language as the interface, the transformation involves understanding intent rather than structure, or the data is not sensitive. If you used an LLM to transform a batch, the [Verify](/verify) can verify consistency across all rows.

**Use a visual mapper if** non-technical users need to build and maintain the mapping, or audit trails and team collaboration are requirements.

The honest summary: Latentmachine wins on diagnosis, privacy, and inference. It loses on flexibility. If the transformation is structural, inference is faster and safer. If it is not structural, use something else.

## Beyond Infer: three more tools

Latentmachine includes three additional tools that share the same design principles.

**[Verify](/verify).** Paste original and transformed records side by side. Verify infers the majority rule and flags every row that deviates from it. This catches LLM output drift (row 47 has a flipped boolean), manual conversion inconsistency (one row formatted differently), and pipeline regressions (an upstream schema change broke five rows out of 200).

**[Regex Builder](/regex).** Provide strings that should match and strings that should not. The engine synthesizes a verified regular expression with named captures, multi-flavor output (JavaScript, PCRE, Python, Java), and a plain-English explanation. It asks for more examples when the pattern is ambiguous and refuses to produce unverified patterns.

**[jq Builder](/jq).** Paste JSON and click the values you want, or show the desired output shape. The engine generates a verified jq expression with JSONPath equivalents where possible. It handles the 80% of jq use cases where you know what you want from the data but do not want to write the syntax.

All four tools run entirely in the browser.

## Frequently asked questions

**Does this use AI or a language model?**
No. The engine is a deterministic program synthesis system. It generates candidate operations, validates them against your examples, and selects the simplest rule. There is no neural network, no training data, no randomness. The same examples always produce the same rule.

**Is my data sent to a server?**
No. The entire engine runs in the browser. There are no server calls during use, no analytics, no telemetry, and no account system. You can verify this by opening your browser's Network tab while using the tool.

**How many examples do I need?**
Usually two. One example is enough for simple field renames. Two examples let the engine distinguish between a direct copy and a coincidence. If the engine needs more, the diagnosis tells you exactly what kind of example to add.

**Can it handle arrays?**
Yes. The engine supports array filtering, projection, extraction, counting, joining, and element lookup. If the output contains a filtered subset of an input array, the engine infers the filter condition and the projection fields from your examples.

**What if the source format changes?**
Run Latentmachine again with the new payload shape. The engine infers a new rule. Export the new code and replace the old snippet. Because the exports are self-contained with no dependencies, replacing them is a clean swap.

**Can I transform data in bulk?**
Yes. Paste an array of records (or a multi-row CSV) and the engine applies the inferred rule to every record. The result is downloadable in any supported format.

**How is this different from a JSON-to-CSV converter?**
A format converter changes syntax. Latentmachine changes structure and syntax simultaneously. A converter turns JSON keys into CSV column headers. Latentmachine renames fields, flattens nesting, coerces types, splits strings, filters arrays, and converts formats — all inferred from your examples.

**How is this different from asking ChatGPT to write the function?**
Three ways. Determinism: Latentmachine produces the same rule every time for the same examples. Diagnosis: it tells you when the rule is ambiguous or contradictory instead of guessing. Privacy: your data never leaves the browser. The tradeoff is flexibility: an LLM can handle natural language instructions and arbitrary logic. Latentmachine handles structural transformations only.

**Is it free?**
Yes. No account, no paywall, no usage limit.

[Open Latentmachine →](/infer)
