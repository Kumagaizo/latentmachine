---
title: "How to Map Between Two APIs Without Writing Glue Code"
description: "Every integration between two systems needs a transformation layer. Usually you write it by hand. This article shows how to infer the mapping from examples instead — for webhooks, REST APIs, CRM syncs, and payment processors."
date: "2026-05-24"
---

Every time you connect two systems, there is a moment where the data from system A does not match what system B expects. The field names are different. The nesting is different. The types are different. A string in one system is a number in the other. An array in one is a comma-separated string in the other.

This is glue code. It is the least interesting code you write and the most likely to break when one of the two systems changes its schema. It is also the code you write most often — because every integration needs it.

Latentmachine infers glue code from examples. You paste what system A sends and what system B needs. The engine figures out the mapping and gives you the code.

## The typical integration problem

You are connecting a payment processor to your database. The webhook sends:

```json
{
  "id": "evt_abc",
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

Your database expects:

```json
{
  "paymentId": "pi_xyz",
  "amount": 4999,
  "currency": "usd",
  "customerId": "cus_123",
  "orderId": "order_500"
}
```

You need to extract nested fields, rename them, and flatten the structure. The transformation is obvious when you look at it. Writing the function takes five minutes. Testing it takes another ten. Handling edge cases (missing metadata, null customer) takes another twenty.

Or you paste two examples into Latentmachine and get the function in seconds — with edge case handling built into the exported code (optional chaining, nullish defaults) and diagnosis telling you if your examples prove the mapping.

## CRM sync: HubSpot to Mailchimp

Two systems, two schemas, same contacts:

```json
{
  "properties": {
    "firstname": "Ana",
    "lastname": "Lopez",
    "email": "ana@acme.com",
    "company": "Acme Corp",
    "lifecyclestage": "lead"
  }
}
```

Needs to become:

```json
{
  "email_address": "ana@acme.com",
  "merge_fields": {
    "FNAME": "Ana",
    "LNAME": "Lopez",
    "COMPANY": "Acme Corp"
  },
  "status": "subscribed"
}
```

This involves extracting from a nested `properties` object, restructuring into a different nesting pattern (`merge_fields`), and adding a constant (`status: "subscribed"` — same for every contact regardless of lifecycle stage).

The engine infers all of this from two examples. The constant is detected because the output value is identical across examples regardless of input. The nested restructuring is detected from the path relationships between input and output fields.

## Analytics event normalization

You receive events from multiple sources with different payload shapes. They all need to become the same internal format:

```json
{
  "event": "page_view",
  "properties": {
    "page": "/pricing",
    "referrer": "google.com",
    "session_id": "s1"
  },
  "timestamp": "2024-03-15T10:00:00Z",
  "user_id": "u1"
}
```

Becomes:

```json
{
  "type": "page_view",
  "page": "/pricing",
  "userId": "u1"
}
```

Three operations: rename `event` to `type`, extract `properties.page` to the root level, rename `user_id` to `userId` with camelCase. The `referrer`, `session_id`, and `timestamp` fields are dropped because they don't appear in the output.

The engine does not need to be told which fields to drop. It infers the rule from what is present in the output, not what is absent from the input.

## The diagnosis catches real problems

Two examples from different API versions might contradict each other. The `status` field might map to `"active"` in one example and `"enabled"` in another for the same input value. A naive mapping tool would pick one silently. Latentmachine identifies the contradiction, names the specific field, and shows you the conflicting examples.

If the source API sends a value your examples have not covered — a new payment status, a new event type, a new lifecycle stage — the engine marks that field as unresolved in the output. The diagnosis tells you exactly which value was unseen and suggests adding an example that covers it.

This matters because API integrations break silently. A new enum value passes through a mapping that does not handle it, and the downstream system receives garbage. Latentmachine's guardrails catch this before the bad data propagates.

## What you get at the end

The engine gives you four things:

**The transformed output** — the input data in the target shape, ready to verify.

**The inferred rule** — a list of operations: rename this, extract that, coerce this type, merge these fields. Readable, inspectable, and verifiable against your examples.

**The diagnosis** — safe or not safe, with specific warnings for any field that might produce incorrect output on unseen data.

**The exported code** — a standalone JavaScript function you can paste into your codebase. Or an n8n Code node snippet. Or a Make.com module. The exported code includes optional chaining for nested access, nullish defaults for missing fields, and a comment header documenting the inferred rule.

The code has no dependencies. It is a pure function that takes an object and returns an object. You own it completely.

## When to use this instead of writing the function

Not always. If the mapping is three field renames, writing it by hand takes less time than opening a tool. If the mapping involves complex business logic — conditional fields based on customer tier, lookups against a reference table, calculations with external data — Latentmachine cannot help because those rules cannot be inferred from structural examples alone.

The sweet spot is: 5 to 25 fields, nested structures, mixed types, and a transformation that is structural but tedious to express in code. That is the zone where showing two examples is genuinely faster than writing and testing a function. The diagnosis is a bonus — most hand-written functions do not check whether the input matches expectations before transforming it.

## Maintaining the mapping over time

API schemas change. New fields appear. Existing fields change types. The mapping breaks.

When this happens, run Latentmachine again with updated examples that reflect the new schema. The engine infers a new rule. Export the new code and replace the old snippet. Because the exported code is a self-contained function with no dependencies, replacing it is a clean swap — no dependency updates, no migration steps.

This is faster than updating a hand-written transformation because you do not need to find the specific line that broke. You show the new shape and get a new function. The old function and the new function are both complete, standalone programs — not patches on top of each other.

[Open Latentmachine →](/infer)
