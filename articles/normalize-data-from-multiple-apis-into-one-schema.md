---
title: "How to Normalize Data From Multiple APIs Into One Schema"
description: "Stripe, HubSpot, Shopify, and your internal API all return different JSON shapes for the same concepts. This guide shows how to build a normalization layer by example instead of writing a mapping function for each source."
date: "2026-08-24"
tags: "json,transform,api,normalize"
---

You pull customer data from three sources. HubSpot stores the name inside a `properties` object. Stripe stores it as `name` at the root level. Your internal API splits it into `first_name` and `last_name`. All three represent the same thing. None of them agree on how.

This is the normalization problem. It is not about converting formats. It is about taking structurally different representations of the same entities and producing one consistent schema that your database, dashboard, or automation can rely on.

The standard approach is to write a transformation function per source. One for Stripe. One for HubSpot. One for the internal API. Each function maps the source-specific fields to your canonical schema. When a fourth source arrives, you write a fourth function. When one API changes its payload structure, you update the corresponding function. The normalization layer becomes a growing collection of bespoke glue code.

There is a different approach: demonstrate the normalization once per source using an input-output example, let a rule engine infer each mapping, and export a standalone function for each one. The functions have no dependencies, no shared state, and no coordination problems. Each one maps its source to the same target shape.

## The problem, concretely

Here are three payloads representing the same customer from three different systems:

From Stripe:

```json
{
  "id": "cus_abc",
  "name": "Ana Lopez",
  "email": "ana@acme.com",
  "created": 1710500000,
  "metadata": { "plan": "pro" }
}
```

From HubSpot:

```json
{
  "vid": 90210,
  "properties": {
    "firstname": { "value": "Ana" },
    "lastname": { "value": "Lopez" },
    "email": { "value": "ana@acme.com" },
    "hs_object_id": { "value": "90210" },
    "plan_tier": { "value": "pro" }
  }
}
```

From your internal API:

```json
{
  "user_id": "u_456",
  "first_name": "Ana",
  "last_name": "Lopez",
  "email_address": "ana@acme.com",
  "created_at": "2026-03-15T10:00:00Z",
  "subscription": { "tier": "pro" }
}
```

Your canonical schema:

```json
{
  "sourceId": "cus_abc",
  "fullName": "Ana Lopez",
  "email": "ana@acme.com",
  "plan": "pro"
}
```

Three different nesting patterns. Three different naming conventions. Three different ways to represent the same four fields. Each one needs its own mapping to the canonical shape, and each mapping is straightforward once you see the two structures side by side.

## Building each mapping by example

Open [Latentmachine](/infer). Paste the Stripe payload as input and your canonical schema as output. The engine infers:

```
$.id → $.sourceId
$.name → $.fullName
$.email → $.email
$.metadata.plan → $.plan
```

Four operations. Status: safe. Export the JavaScript.

Now do the same for HubSpot. Paste the HubSpot payload as input and the same canonical output. The engine infers:

```
string($.vid) → $.sourceId
concat($.properties.firstname.value, " ", $.properties.lastname.value) → $.fullName
$.properties.email.value → $.email
$.properties.plan_tier.value → $.plan
```

This mapping is more complex. The engine detected that `sourceId` requires a number-to-string conversion, that `fullName` is a concatenation of two nested fields with a space separator, and that every contact property lives two levels deep inside the `properties` object. Status: safe.

The internal API mapping:

```
$.user_id → $.sourceId
concat($.first_name, " ", $.last_name) → $.fullName
$.email_address → $.email
$.subscription.tier → $.plan
```

Three mappings. Three exported functions. Each one is a standalone JavaScript function with no dependencies. Each one produces the same output shape. Your normalization layer is three files, each one short enough to read in thirty seconds.

## Why per-source functions beat a universal mapper

The temptation is to build a single function that detects the source format and routes to the right mapping logic. This works until it does not.

A universal mapper introduces coupling between sources. A change to the HubSpot handler can break the Stripe path if they share any logic. A new source requires touching the same file that handles every other source. The routing logic itself becomes a maintenance burden: which field do you check to determine the source format? What happens when two sources have the same field name with different semantics?

Per-source functions avoid all of this. Each function is independent. Each one can be tested, deployed, and updated without touching any other. If HubSpot changes their payload structure, you re-demonstrate the mapping with an updated example and export a new function. The Stripe function and the internal API function are unaffected.

This maps naturally to how normalization actually works in production. In an n8n or Make.com workflow, each source has its own webhook trigger or API call node. Each trigger feeds into its own transformation node. The transformation nodes share no code. They just happen to produce the same output shape.

## Handling value maps across sources

Each source may use different labels for the same concept. Stripe might send `"plan": "pro"`. HubSpot might send `"plan_tier": "professional"`. Your internal API might send `"tier": "premium_monthly"`. Your canonical schema expects `"plan": "pro"`.

For this, show two or three examples per source where the plan values differ. The engine infers a value map:

```
"professional" → "pro"
"premium_monthly" → "pro"
"basic" → "basic"
"enterprise" → "enterprise"
```

If a new value appears that is not in the map, the engine flags it as unresolved instead of guessing. This matters because a new pricing tier added to HubSpot should not silently map to null in your database. The guardrail catches it before the record enters your system.

## Verifying consistency after normalization

Once all three sources are producing records in your canonical schema, you can verify that the merged dataset is consistent. Paste all the normalized records into [Verify](/verify) with their original-source records.

Verify infers the majority rule from the batch and flags any record that deviates. If the Stripe function maps `created` to a Unix timestamp while the internal API function maps `created_at` to an ISO string, and your canonical schema expects one format, Verify catches the records that used the wrong format.

This is useful as a periodic audit. Run the normalization pipeline. Sample a few hundred records from the combined output. Verify the sample. If all rows follow one rule, the normalization layer is consistent. If some rows break the pattern, you know which source produced the inconsistency and which field drifted.

## Adding a new source

When a fourth API arrives, the process is the same: paste one payload from the new source and the canonical output it should produce. The engine infers the mapping. You export the function. The new source joins the normalization layer without touching any existing function.

This is where example-based normalization saves the most time. Writing a new mapping function from scratch requires reading the API documentation, understanding the nesting structure, deciding on field names, handling nullable fields, and testing the result. Demonstrating the mapping requires pasting two JSON objects and reading the inferred rule to confirm it matches your intent.

The engine's diagnosis also tells you something documentation will not: whether the new source's payload has values your canonical schema does not handle. If the new API sends a status field with values none of your other sources use, the diagnosis flags it before those values enter your database.

## When this approach does not fit

If the normalization involves business logic that depends on more than the payload itself, example-based mapping cannot capture it. If the customer's `plan` field depends on a lookup against a pricing table, or if the `fullName` format depends on the customer's locale, those rules cannot be inferred from structural examples.

If the sources share an identical schema and the normalization is just a field rename or two, writing the function by hand is faster than any tool.

The sweet spot is: multiple sources with meaningfully different structures that all need to converge on one canonical shape, with the mapping being structural (renames, extractions, type conversions, concatenations, value maps) rather than business-logical. That covers most webhook integrations, CRM syncs, analytics pipelines, and API aggregation layers.

[Open Latentmachine →](/infer)
