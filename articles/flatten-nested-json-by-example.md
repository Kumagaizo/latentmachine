---
title: "How to Flatten Nested JSON Without Writing a Script"
description: "Deeply nested API payloads need to become flat records for databases, spreadsheets, and CSV exports. Instead of writing recursive flattening logic, show a before-and-after example and let a rule engine infer the mapping. Handles Stripe, Shopify, HubSpot, and any arbitrarily nested structure."
date: "2026-08-24"
tags: "json,flatten,transform,api,csv"
---

You received a webhook payload from Stripe. The data you need is three levels deep: `data.object.charges.data[0].billing_details.address.city`. You need it as a flat row with a column called `city`.

Every API nests differently. Stripe wraps everything in `data.object`. HubSpot puts contact fields inside `properties`. Shopify buries line items inside arrays inside orders. GitHub nests repository metadata inside organization objects inside event payloads.

The usual fix: write a function that walks the tree, picks the fields you need, and outputs a flat object. For five fields, that takes ten minutes. For twenty fields across three nesting levels with optional arrays and nullable parents, it takes an hour. And then the API adds a field or changes a nesting level, and you update the function.

There is a faster approach. Show one example of the nested input and the flat output you need. Let a rule engine figure out the extraction paths, the renames, and the type coercions. Get a reusable function back.

## What "flatten by example" looks like

Take a GitHub webhook payload for a push event. The raw structure looks something like this:

```json
{
  "ref": "refs/heads/main",
  "repository": {
    "id": 12345,
    "full_name": "acme/webapp",
    "owner": {
      "login": "acme",
      "type": "Organization"
    },
    "private": true
  },
  "pusher": {
    "name": "ana",
    "email": "ana@acme.com"
  },
  "head_commit": {
    "id": "abc123def",
    "message": "fix: update pricing logic",
    "timestamp": "2026-08-20T14:30:00Z"
  }
}
```

You need a flat record for your logging table:

```json
{
  "branch": "main",
  "repo": "acme/webapp",
  "org": "acme",
  "isPrivate": true,
  "pushedBy": "ana",
  "commitId": "abc123def",
  "commitMessage": "fix: update pricing logic",
  "pushedAt": "2026-08-20T14:30:00Z"
}
```

Paste both into [Latentmachine](/infer). The engine infers eight operations:

```
substring($.ref, 11) → $.branch
$.repository.full_name → $.repo
$.repository.owner.login → $.org
$.repository.private → $.isPrivate
$.pusher.name → $.pushedBy
$.head_commit.id → $.commitId
$.head_commit.message → $.commitMessage
$.head_commit.timestamp → $.pushedAt
```

Each operation is independently readable. The `branch` field strips the `refs/heads/` prefix. The `org` field reaches two levels into the `repository` object. Everything else is a direct extraction with a rename.

The diagnosis says safe. The exported JavaScript is a standalone function you can paste into a webhook handler, an n8n Code node, or a serverless function.

## Why recursive flattening is the wrong tool

Generic JSON flattening libraries (like `flat` in npm) take every nested key and concatenate the path with dots or underscores. The GitHub payload above would become:

```json
{
  "ref": "refs/heads/main",
  "repository.id": 12345,
  "repository.full_name": "acme/webapp",
  "repository.owner.login": "acme",
  "repository.owner.type": "Organization",
  "repository.private": true,
  "pusher.name": "ana",
  "pusher.email": "ana@acme.com",
  "head_commit.id": "abc123def",
  "head_commit.message": "fix: update pricing logic",
  "head_commit.timestamp": "2026-08-20T14:30:00Z"
}
```

Every field is present. Every key is a mechanical concatenation of the path. No field is renamed, no field is dropped, no value is transformed. This is flat, but it is not useful. You still need to rename `repository.owner.login` to `org`, drop the fields you do not want, and strip the prefix from `ref`.

Generic flattening solves the easy part (removing nesting) and leaves you with the hard part (choosing which fields matter, what to call them, and how to transform the values).

Example-based flattening solves both at once. The output you demonstrate is the output you get. If you only need eight fields out of twenty, the engine only maps those eight. If a field needs renaming, the rename is inferred from the example. If a value needs a substring or type conversion, that operation is inferred too.

## Flattening with arrays

Arrays are where most flattening scripts get complicated. A Shopify order contains an array of line items, each with its own nested structure:

```json
{
  "id": 1001,
  "email": "customer@example.com",
  "line_items": [
    {
      "title": "Widget A",
      "quantity": 2,
      "price": "19.99"
    }
  ],
  "shipping_address": {
    "city": "Berlin",
    "country_code": "DE"
  }
}
```

If you need one flat record per order (not per line item), you might want:

```json
{
  "orderId": 1001,
  "email": "customer@example.com",
  "firstItemTitle": "Widget A",
  "firstItemQty": 2,
  "firstItemPrice": 19.99,
  "shipCity": "Berlin",
  "shipCountry": "DE"
}
```

The engine infers that `firstItemTitle` maps to `$.line_items[0].title`, that `firstItemPrice` carries a string-to-number coercion, and that the shipping fields are extracted from the nested `shipping_address` object. The array access is explicit in the rule, not hidden inside a loop.

If you need one record per line item instead, show that shape in the output and the engine adjusts. The point is that the output you demonstrate is the structure the engine reproduces.

## Flattening for a CSV export

When the destination is a spreadsheet or a CSV import, every value needs to be a string and the structure needs to be completely flat. The engine handles this because it infers type coercions from the example.

If the input has `"private": true` and your flat output has `"isPrivate": "true"`, the engine infers a boolean-to-string conversion. If the input has `"amount": 4999` and the output has `"amount": "49.99"`, it infers a division and a type conversion. You do not specify these operations. They fall out of the difference between the two structures.

For export to CSV, [Latentmachine](/infer) accepts JSON on the input side and CSV on the output side. The same inference runs, and the exported code writes flat rows instead of objects.

## Handling missing fields in nested structures

The dangerous part of nested JSON is not the nesting itself. It is the optional nesting. A payment webhook might have `data.object.customer.address.city` on most payloads and no `address` field at all on others. A hand-written flattening function throws unless every intermediate access uses optional chaining.

Latentmachine's exported JavaScript includes optional chaining (`?.`) on every nested access by default. The engine does not need you to demonstrate the missing-field case. It assumes any intermediate path segment could be absent and generates defensive access for all of them.

If you want stricter behavior, if a missing field should halt the transformation instead of producing null, the diagnosis system helps here too. Show two examples where the nested field is present, and the engine marks it as a required path. If a new payload arrives without that path, the guardrail fires before the output is produced.

## When you do not need this

If the payload is one level deep and you need to rename three fields, writing the function by hand is faster than opening any tool. If you need to flatten an entire object recursively without choosing which fields to keep, a library like `flat` does that in one line.

The example-based approach earns its value when the payload is deeply nested, the target structure is selectively flat (not every field, not every path), and the transformation includes renames, type changes, or value extractions alongside the flattening. That is the zone where showing a before-and-after example is genuinely faster than writing the function, and the exported code handles edge cases you would have forgotten.

[Open Latentmachine →](/infer)
