---
title: "From Inferred Rule to Working Code: How Latentmachine Generates JavaScript"
description: "Latentmachine infers a symbolic rule, then exports it as runnable JavaScript. This article explains how the rule-to-code translation works, what the generated code looks like, and why it handles edge cases you did not think about."
date: "2026-05-19"
---

Latentmachine does two distinct things. First, it infers a symbolic rule from your examples. Then, separately, it translates that rule into JavaScript you can copy into your project or automation workflow.

These are two different steps, and understanding the boundary between them explains why the exported code tends to be more defensive than what you would write by hand.

## The rule is not the code

When the engine infers a transformation, the result is a symbolic program. Not JavaScript. Not any programming language. It is a data structure that describes a sequence of operations:

```json
{
  "ops": [
    { "op": "concat", "sources": ["$.user.first", "$.user.last"], "separators": [" "], "target": "$.name" },
    { "op": "set", "source": "$.account.id", "target": "$.accountId" },
    { "op": "coerce", "source": "$.login_count", "to": "number", "target": "$.logins" }
  ]
}
```

This is the rule. It says: concatenate two source fields with a space, copy one field directly, and convert a string to a number. The rule is platform-agnostic. It does not know about JavaScript, n8n, or Make.com. It knows about paths, types, and operations.

The export step translates this rule into code for a specific target. Each export format (standalone JavaScript, n8n Code node, Make.com module, and the JSON/CSV CLI export) has its own generator that reads the rule and produces code for that runtime.

## How path access is translated

Every source path in the rule (like `$.user.first`) needs to become a property access in JavaScript (like `input?.user?.first`). The generator walks each path segment and produces an access chain with optional chaining throughout:

```
$.user.first          → input?.user?.first
$.data.object.id      → input?.data?.object?.id
$.items[0].name       → input?.items?.[0]?.name
```

The optional chaining (`?.`) is not optional. If any segment in the path is missing at runtime, the expression returns `undefined` instead of throwing a TypeError. This matters because the rule was inferred from complete examples, but production data often has missing fields. A webhook payload that was complete last Tuesday might be missing a field today because the upstream service changed something.

You probably would not write `input?.data?.object?.metadata?.order_id` by hand. You would write `input.data.object.metadata.order_id` and find out it throws when `metadata` is undefined. The generator is more cautious than you are, which is the point.

## How each operation becomes code

Each operation type has a dedicated code generator. Here is what the main ones produce:

**Direct copy** becomes a path access:

```javascript
output.accountId = input?.account?.id;
```

**Type coercion** wraps the access in a conversion:

```javascript
output.logins = Number(input?.login_count ?? 0);
```

The `?? 0` fallback prevents `Number(undefined)` from producing `NaN`. In your hand-written code, you would probably forget this until you get a `NaN` in your database. The generator never forgets because it does not have other things on its mind.

**String concatenation** joins multiple accesses:

```javascript
output.name = String(input?.user?.first ?? "") + " " + String(input?.user?.last ?? "");
```

**Template** uses a template literal:

```javascript
output.greeting = `Hello, ${input?.user?.first ?? ""} from ${input?.city ?? ""}`;
```

**String case** wraps the access in a chain:

```javascript
output.email = String(input?.email ?? "").toLowerCase();
```

**Composed string operations** (like trim + title case) nest the calls:

```javascript
output.name = String(String(input?.Name ?? "").trim() ?? "")
  .toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
```

**Date formatting** uses regex extraction:

```javascript
output.date = (String(input?.created_at ?? "")
  .match(/^(\d{4})-(\d{2})-(\d{2})/)?.slice(1, 4).join("-") ?? "");
```

**Array operations** produce filter-map chains:

```javascript
output.products = Array.isArray(input?.lineItems ?? [])
  ? (input?.lineItems ?? [])
    .filter(row => JSON.stringify(row?.type) === '"product"')
    .map(row => { const record = {}; record.name = row?.name; record.qty = row?.qty; return record; })
  : [];
```

**Value maps** produce lookup tables:

```javascript
const map_12345 = { '"active"': true, '"inactive"': false };
output.live = (map_12345[JSON.stringify(input?.status)] ?? null);
```

The JSON.stringify key encoding ensures that value maps work correctly for all JSON types: strings, numbers, booleans, and null. A hand-written version would use string equality and break on numeric or boolean values.

## The comment header

Every exported function starts with a comment block:

```javascript
// Latentmachine - inferred transformation
// Status: safe | Confidence: proven (5/5 checks)
//
// Rule: Compose 3 deterministic steps
// Operations:
//   concat($.user.first, " ", $.user.last) -> $.name
//   $.account.id -> $.accountId
//   number($.login_count) -> $.logins
```

This is documentation that writes itself. When you revisit the code in six months, the header tells you exactly what the rule does, how confident the engine was, and what each operation maps. You do not need to reverse-engineer the code to understand the intent.

## Platform-specific exports

The standalone JavaScript export produces a `transform(input)` function that takes a parsed value and returns a transformed value. No dependencies, no framework, no assumptions about the runtime.

The n8n export wraps the same logic in n8n's expected pattern:

```javascript
const items = $input.all();
return items.map(item => {
  const input = item.json;
  const output = {};
  // ... operations ...
  return { json: output };
});
```

The Make.com export uses `inputData` as the root variable:

```javascript
const input = inputData || {};
const output = {};
// ... operations ...
return output;
```

The logic is identical across all formats. The only difference is the wrapper: how the input enters the function and how the output leaves it. The operation-level code is generated once and reused.

## Why not generate "cleaner" code

The generated code is verbose. It uses optional chaining everywhere, wraps every value in defensive type conversions, and serializes lookup keys as JSON strings. A human developer would write tighter code.

This is intentional. The generated code optimizes for correctness across the widest range of inputs, not for readability or elegance. It assumes that any field might be missing, any value might have the wrong type, and any array might not be an array.

You could simplify the code after pasting it. Remove the optional chaining if you know the fields will always be present. Remove the nullish coalescing if you know the values are never undefined. The generator gives you a correct starting point. Making it pretty is your call.

The **Copy rule** action exists for people who want to inspect or store the symbolic program. It gives you the inferred program as data, and you can compare it across versions or translate it into another runtime.

[Open Latentmachine →](/infer)
