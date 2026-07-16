---
title: "Nulls, Empty Arrays, and Deeply Nested Nightmares: How the Engine Handles Edge Cases"
description: "What happens when you paste ugly JSON into Latentmachine? Deeply nested payloads, null values, empty arrays, mixed types, missing fields. This article walks through the edge cases and what the engine does with each one."
date: "2026-05-19"
---

The examples in most documentation are clean. The payloads are well-structured, the fields are present, the types are consistent. Production data is not like that.

Production data has null where you expected a string. It has empty arrays where you expected three items. It has objects nested six levels deep because someone designed an API during a meeting. It has fields that exist in one record and vanish in the next.

This article is about what happens when you feed that kind of data to Latentmachine. Not the clean cases. The ugly ones.

## Null values

Paste an example where a field is null:

```json
Input:  { "user": { "name": "Ana", "bio": null } }
Output: { "name": "Ana", "bio": null }
```

The engine treats null as a value like any other. It infers a direct copy for both fields. The null passes through unchanged. No error, no warning, no special handling.

Where it gets interesting is when null appears in one example but not another:

```json
Example 1 input:  { "user": { "name": "Ana", "bio": "Engineer" } }
Example 1 output: { "name": "Ana", "bio": "Engineer" }

Example 2 input:  { "user": { "name": "Bo", "bio": null } }
Example 2 output: { "name": "Bo", "bio": null }
```

The engine still infers a direct copy. Both examples map `$.user.bio` to `$.bio` with matching values. The fact that one is a string and the other is null does not change the operation. A direct copy handles both because it does not care about the type of the value it copies.

If the output for the null case were different, say an empty string instead of null, the engine would need a more complex rule (a conditional or a value map with null as a key). It would flag this as a value map and apply the usual guardrails: if a new input has a bio value the engine has not seen, it would flag it as unseen.

## Empty arrays

```json
Input:  { "items": [] }
Output: { "products": [] }
```

An empty array is a valid value. The engine infers a direct copy from `$.items` to `$.products`. If you also provide an example with a populated array, the engine has to decide whether it is a direct copy (move the whole array) or an array operation (filter, map, project).

This is where the second example matters. If both examples just move the array without modifying its contents, the engine picks a direct copy. If the second example shows a populated array that gets filtered or projected, the engine infers the array operation and applies it. The empty array passes through the filter and produces an empty array, which is correct.

The edge case to watch: if your only example has an empty array, the engine cannot distinguish between "copy the array" and "filter the array" because both produce the same result (empty). It will pick the direct copy (cheaper) and may not flag this as ambiguous because no alternative produces a different output. If your real data has populated arrays, include at least one populated example.

## Deeply nested objects

```json
Input: {
  "response": {
    "data": {
      "user": {
        "profile": {
          "contact": {
            "email": "ana@test.com"
          }
        }
      }
    }
  }
}

Output: { "email": "ana@test.com" }
```

The engine handles arbitrary depth. It flattens every path in the input and every path in the output, then matches them. The path `$.response.data.user.profile.contact.email` is just a longer string than `$.user.email`. The candidate generation does not care about depth. It tries every source path against every target path, regardless of how many levels deep they go.

The cost model adds a small penalty for depth difference (0.08 per level). A mapping from `$.response.data.user.profile.contact.email` to `$.email` costs slightly more than from `$.email` to `$.email`. This rarely matters in practice because there is usually only one candidate that matches the value, but it means the engine prefers shallower mappings when two paths contain the same value.

The exported JavaScript uses optional chaining at every level:

```javascript
output.email = input?.response?.data?.user?.profile?.contact?.email;
```

If any level is missing at runtime, the expression returns undefined instead of throwing. This is where the defensive code generation pays off most. A six-level access chain has six opportunities to fail if a parent object is missing.

## Mixed types across examples

What if a field is a string in one example and a number in another?

```json
Example 1 input:  { "count": "5" }
Example 1 output: { "total": 5 }

Example 2 input:  { "count": 12 }
Example 2 output: { "total": 12 }
```

The engine infers a type coercion (`number($.count) → $.total`). Applying `Number()` to the string "5" produces 5. Applying `Number()` to the number 12 produces 12. The operation is valid for both examples.

This works because the engine validates candidates against all examples. The direct copy candidate would fail on example 1 (output expects number 5, input has string "5"), so it is discarded. The type coercion candidate succeeds on both, so it survives.

If the types are mixed in a way that no single operation handles, the engine flags the field as unexplained. For instance, if one example maps a string to a number and another maps a boolean to an array, no operation in the vocabulary covers both. The engine will not invent an operation. It will report the failure and leave the field unresolved.

## Missing fields in the new input

Your examples have a field. Your new input does not.

```json
Example input:  { "user": { "name": "Ana", "role": "admin" } }
Example output: { "name": "Ana", "role": "admin" }

New input:      { "user": { "name": "Bo" } }
```

The rule depends on `$.user.role`. The new input does not have it. The engine catches this and produces a runtime warning:

```
$.user.role is required by the learned rule but is missing from the new input.
```

The diagnosis status changes to "unsafe" because the engine cannot guarantee the output is correct. The output will contain `undefined` for the missing field, and the warning tells you exactly which field and which operation are affected.

This is one of the most common edge cases in production. Webhook payloads have optional fields. API responses vary between endpoints. CMS exports differ between record types. The engine does not assume every field will always be present, even if it was present in every example.

## Single-field objects

```json
Input:  { "x": 1 }
Output: { "y": 1 }
```

Minimal input. One field in, one field out. The engine infers a direct copy from `$.x` to `$.y`. Confidence will be lower than usual because with a single field and a single example, many operations could explain the mapping: a direct copy, a constant (always 1), or a value map (1 maps to 1). The engine picks the direct copy (cheapest) and may flag the result as insufficient.

Add a second example with `{ "x": 2 }` mapping to `{ "y": 2 }` and the constant candidate is eliminated. The confidence assessment improves and the status becomes safe.

Single-field objects are a good way to test the engine's behavior at the boundary. They force the cost model to do its job because there is only one field to explain and the candidates are closely matched.

## Fields with special characters in keys

```json
Input:  { "first-name": "Ana", "last_name": "Lopez", "email.work": "ana@test.com" }
Output: { "firstName": "Ana", "lastName": "Lopez", "workEmail": "ana@test.com" }
```

The engine does not care about key naming conventions. It matches fields by value, not by name similarity (though name similarity affects value map scoring). Hyphens, underscores, dots in key names are all handled. The exported JavaScript uses bracket notation when a key contains characters that would break dot notation:

```javascript
output.firstName = input?.["first-name"];
```

## Very large payloads

The engine flattens every path in the input and every path in the output. For a payload with 50 leaf fields mapping to an output with 20 leaf fields, the engine generates candidates for each output field by testing relevant source paths against its bounded operation vocabulary. That can mean thousands of candidates, but it is still a constrained search rather than arbitrary code generation.

This usually completes in milliseconds on a modern browser. The engine does not call a server during inference, so performance depends on the local device and the shape of the payload. Typical payloads are fast; unusually wide or deeply nested payloads take longer but remain bounded by the candidate-generation limits.

If you hit a payload large enough to cause noticeable delay, it is worth asking whether you need to transform all 50 fields or just the 10 you actually use. The engine processes every field in the output, so a smaller output means fewer candidates and faster inference.

## The general pattern

The engine does not have special-case handling for edge cases. It applies the same pipeline to every input: flatten, generate candidates, validate, score, select, diagnose. Nulls, empty arrays, missing fields, and mixed types are handled by the same logic that handles clean data.

When the pipeline encounters something it cannot explain, it says so. When it encounters something it can explain multiple ways, it says so. The edge cases are not hidden. They surface through the same diagnosis system that handles normal cases.

The best way to test edge cases specific to your data is to paste them into the tool and see what happens. The engine is deterministic. If it handles your edge case today, it will handle it the same way tomorrow.

[Open Latentmachine →](/infer)
