---
title: "How to Transform JSON: Five Approaches and When Each One Breaks"
description: "You have JSON in one shape and need it in another. There are five ways to get there: write it by hand, use a query language, use a library, ask an LLM, or show an example. Each one works until it does not. This guide covers all five honestly."
date: "2026-08-25"
tags: "json,transform,compare,api"
---

You have a JSON payload from one system and another system that expects a different shape. The field names are wrong. The nesting is wrong. Some values are strings that should be numbers. An array needs to be flattened. A nested object needs to be pulled to the root.

This is the most common problem in software that nobody talks about as a problem. It is not algorithmically hard. It is not architecturally interesting. It is just tedious, repetitive, and surprisingly easy to get wrong. Every developer has written this code. Most have written it dozens of times. Nobody enjoys it.

There are five approaches. Each one is the right choice in some situations and a slow-burning mistake in others.

## 1. Write it by hand in JavaScript

The most common approach. You know the source shape. You know the target shape. You write a function.

```javascript
function transform(input) {
  return {
    id: input.data.object.id,
    amount: input.data.object.amount / 100,
    currency: input.data.object.currency,
    customer: input.data.object.customer,
    orderId: input.data.object.metadata?.order_id ?? null,
  };
}
```

This works. It is fast to write for simple mappings. You own the code completely. You can add business logic, conditionals, and error handling wherever you need them.

**When it breaks.** It breaks at scale and over time. The function handles the fields you thought about and silently ignores the ones you did not. A new enum value appears in the source payload. A nested field that was always present becomes optional. A type changes from number to string in a minor API version bump. The function does not know about any of this. It either throws or returns subtly wrong output.

The second failure mode is maintenance. You wrote this function six months ago. The source API changed twice since then. Each time, someone patched the function. Now it has three conditional branches, two of which handle edge cases that may or may not still exist. Nobody wants to touch it because nobody fully understands it.

**Best for:** one-off transformations on small payloads where you will verify the output by eye. Prototyping. Cases where the logic is genuinely conditional or business-specific.

## 2. Use jq or JSONata

Query languages designed for JSON. jq runs in the terminal. JSONata runs in the browser or in Node.

A jq expression to extract and reshape fields:

```
{
  id: .data.object.id,
  amount: (.data.object.amount / 100),
  currency: .data.object.currency,
  customer: .data.object.customer,
  orderId: .data.object.metadata.order_id
}
```

This is concise, powerful, and expressive. For people who know the syntax, jq is faster than writing JavaScript for pure structural transformations.

**When it breaks.** It breaks at the learning curve. jq's syntax is not obvious. The difference between `.[]` and `.[] | .name` and `[.[] | .name]` is meaningful, and getting it wrong produces confusing errors or wrong output without an error. Most developers do not write jq often enough to keep the syntax in memory. Every time they come back to it, they spend fifteen minutes re-learning the pipe model.

JSONata has a gentler syntax but smaller community and tooling. Both languages are also hard to debug: when the output is wrong, the query gives you no clue about which part of the expression produced the bad value.

**Best for:** command-line scripting, CI pipelines, and developers who use jq regularly enough to stay fluent. One-off terminal transformations on files you already have.

## 3. Use a library (lodash, Ramda, object-mapper)

Libraries that provide higher-order functions for reshaping objects. lodash gives you `_.get`, `_.set`, `_.pick`, `_.mapKeys`. Dedicated mapping libraries let you declare source-to-target paths.

```javascript
const _ = require("lodash");

function transform(input) {
  return {
    id: _.get(input, "data.object.id"),
    amount: _.get(input, "data.object.amount", 0) / 100,
    currency: _.get(input, "data.object.currency"),
    customer: _.get(input, "data.object.customer"),
    orderId: _.get(input, "data.object.metadata.order_id", null),
  };
}
```

This is the hand-written function from approach 1 with safer path access. `_.get` returns undefined instead of throwing when a path segment is missing. Defaults are explicit.

**When it breaks.** It breaks for the same reasons as hand-written code, just with better null handling. The mapping is still implicit in the function body. When the source shape changes, you still edit the function. lodash does not tell you that a new field appeared in the source or that a path you depend on is now sometimes absent. You get safety from `_.get` and nothing else.

The dependency is also worth noting. lodash is 70KB. If the transformation is the only reason it is in your bundle, you are shipping 70KB for something that five lines of optional chaining could replace.

**Best for:** codebases that already use lodash. Complex transformations that benefit from `_.groupBy`, `_.keyBy`, or `_.merge`.

## 4. Ask an LLM

The newest approach. Paste the source payload and a natural language description of the target shape into ChatGPT, Claude, or Copilot. Get a transformation function back.

This is fast. It handles nesting, renames, and type conversions without you specifying each one. For a first draft of a complex transformation, an LLM can save thirty minutes.

**When it breaks.** It breaks in three ways, all of them quiet.

First, non-determinism. Ask the same model for the same transformation twice and you may get different variable names, different error handling, and occasionally different field mappings. For a single generation this does not matter. For a pipeline that regenerates code on deploy, it matters.

Second, drift across rows. When an LLM transforms a batch of records directly (not by generating code, but by producing the transformed output), each row is a separate completion. Row 1 might format a date as ISO. Row 47 might switch to a human-readable format. Both are plausible. The batch is inconsistent.

Third, hallucinated semantics. The model infers meaning from field names. If a field is called `status` and the value is `1`, the model might decide that means `"active"`. It might be right. But it is guessing from the name, not following a rule.

**Best for:** generating a first draft of transformation code that you will review, test, and own. Exploratory work when you are not sure what the target shape should be. Creative transformations where the output is not strictly defined (generating descriptions, classifying records, summarizing data).

**Not for:** unattended pipelines, batch processing without verification, or any situation where "almost right" causes downstream damage.

## 5. Show an example

The approach most developers have not encountered. Instead of writing the transformation or describing it, you demonstrate it: paste one or two before-and-after examples and let an inference engine figure out the rule.

You paste a source payload:

```json
{
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

And the output you want:

```json
{
  "id": "pi_xyz",
  "amount": 49.99,
  "currency": "usd",
  "customer": "cus_123",
  "orderId": "order_500"
}
```

The engine infers the rule: extract five paths, rename `order_id` to `orderId`, divide `amount` by 100. Each operation is visible. The rule is deterministic. Same input, same rule, same output. Always.

This is called programming by example. It has existed in computer science since the 1970s and powers features like Excel's Flash Fill. Applied to structured data, it generates the same kind of function you would write by hand, but inferred from the structural difference between input and output instead of manually specified.

[Latentmachine](/) does this in the browser. It produces a readable list of operations, a diagnosis that tells you whether the rule is safe or ambiguous, and an exportable JavaScript function with no dependencies.

**When it breaks.** It breaks when the transformation requires knowledge the examples cannot demonstrate. Business logic, conditional rules that depend on external state, or creative output (generating descriptions, classifying records) are outside its scope. If the rule depends on something other than the structural relationship between input and output, examples alone are not enough.

It also requires that you know the target shape. If you are still exploring what the output should look like, writing code or talking to an LLM is a better starting point. Example-based inference solves the "I know exactly what I want, I just do not want to write the code" problem.

**Best for:** any structural transformation (renames, flattening, type coercion, string splitting, array extraction, value maps) that you would otherwise write by hand and that will run more than once.

## Choosing by failure mode, not by feature

The useful comparison between these five approaches is not which one is fastest or most elegant. It is which failure mode you are willing to accept.

**Hand-written code fails by not knowing what it does not handle.** Missing fields, unseen values, and schema changes are invisible until they break production.

**jq fails by being hard to return to.** The syntax is powerful but unfamiliar enough that every revisit costs re-learning time.

**Libraries fail by adding weight without adding safety.** They make path access safer but do not warn you about schema changes or missing fields.

**LLMs fail by being non-deterministic.** The output is plausible but not provably consistent, and there is no mechanism to check after the fact.

**Example-based engines fail by requiring you to know the target shape.** They cannot help you explore or handle business logic outside the structural domain.

Pick the approach whose failure mode is least damaging for your situation. For a one-off script, hand-written code is fine because you are watching. For an unattended pipeline, you need determinism and diagnosis, which means either a query language you maintain yourself or an inferred rule that tells you when the input has changed.

## The part nobody thinks about

Most developers pick their transformation approach based on what is fastest to write. That optimizes for the first run. The first run is the only run where you are paying attention.

The value of a transformation is in the hundredth run. The run where the data changed and you did not notice. The run where a new field appeared. The run where an enum gained a value. The run where a nested object became optional.

Every approach above handles the first run well. They differ in how they handle the hundredth. The approaches that surface problems early (diagnosis, type checking, schema validation) cost more upfront and save more over time. The approaches that are fastest to write (hand-written code, LLM-generated functions) get you to production sooner and leave you alone when production surprises you.

There is no universal right answer. But there is a question worth asking before you write the function: will I be watching when this runs for the hundredth time?

If the answer is no, invest in the approach that watches for you.

[Try transforming by example →](/infer)
