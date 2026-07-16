---
title: "How to Convert CSV to JSON (and JSON to CSV) by Example"
description: "Convert CSV to JSON, flatten JSON into CSV, and clean tabular exports by showing before-and-after examples instead of writing a parser. Covers headers, type conversion, nested fields, delimiters, and exportable JavaScript."
date: "2026-05-22"
---

Converting CSV to JSON sounds simple until the details show up. A column needs to become a number instead of a string. A "tags" column holds comma-separated values that should be an array. Two name columns need to merge into one field. The output needs to be nested, not flat. At that point the online converters stop helping and you start writing a parser. There is a faster path: show one or two before-and-after examples and let a rule engine infer the conversion. This guide walks through CSV-to-JSON, JSON-to-CSV, and the messy cases in between.

## Why CSV conversion is harder than it looks

A CSV file is a grid of strings. JSON has types, nesting, and arrays. The gap between them is where the work lives.

Every value in a CSV cell is text. The number `4999` arrives as the string `"4999"`. The boolean `true` arrives as the string `"true"`. An empty cell might mean null, an empty string, or zero depending on the system that produced it. A column called `tags` might hold `solar, renewable, diy` — one string that should become three array items. A flat row might need to become a nested object, with `address_city` and `address_zip` folded under an `address` key.

A generic CSV-to-JSON converter does none of this. It gives you an array of objects where every value is a string and the structure is flat. So you write code: parse the file, loop the rows, coerce the types, split the multi-value columns, nest the fields. For a one-off migration, that is thirty minutes you did not want to spend. And the moment the column order or the delimiter changes, you edit the script again.

The alternative is to demonstrate the conversion. You paste one CSV row and the JSON object it should become. The engine compares the two structures, infers the smallest set of operations that explains the difference — type coercion, splitting, nesting, renaming — and produces a reusable rule.

[Latentmachine](/infer) does this in the browser. It accepts CSV and JSON on both sides, so the same example-based approach works for converting in either direction. The examples below show the input, the desired output, the inferred rule, and the exported JavaScript.

## CSV to JSON with type conversion

Here is a typical export. Every value is a string because that is all a CSV can hold:

```
id,name,price,in_stock,quantity
sku_001,Solar Panel,299.00,true,12
```

You need a properly typed JSON object:

```json
{
  "id": "sku_001",
  "name": "Solar Panel",
  "price": 299,
  "inStock": true,
  "quantity": 12
}
```

Show this as one input-output pair. The engine infers:

```
$.id → $.id
$.name → $.name
number($.price) → $.price
boolean($.in_stock) → $.inStock
number($.quantity) → $.quantity
```

Status: safe. Three of the five fields carry a type coercion: the price and quantity strings become numbers, and the `in_stock` string `"true"` becomes the boolean `true`. The `in_stock` column is also renamed to `inStock`. The `id` and `name` columns pass through unchanged because their input and output values are identical.

The exported JavaScript:

```javascript
function transform(input) {
  return {
    id: input?.id,
    name: input?.name,
    price: Number(input?.price),
    inStock: input?.in_stock === "true",
    quantity: Number(input?.quantity),
  };
}
```

One example is often enough for direct conversions like this, but the engine will mark a single-example result as needing a second pair if more than one rule could explain it. Adding a second row with different values removes the doubt.

[Open Latentmachine →](/infer)

## Splitting a column into an array

CSV has no native way to store a list, so people cram lists into a single cell:

```
title,categories
Heat Pump Guide,"heating, efficiency, retrofit"
```

You need the categories as a real array:

```json
{
  "title": "Heat Pump Guide",
  "categories": ["heating", "efficiency", "retrofit"]
}
```

The engine infers:

```
$.title → $.title
split($.categories, ", ") → $.categories
```

It detected that the single `categories` string maps to an array whose items are the substrings between `, ` separators. This is a structural inference, not a guess: the engine tested candidate separators against the example and selected the one that exactly reproduces the output array. If your file uses a different separator — a semicolon, a pipe, a plain comma without the space — show the example with that separator and the engine infers it instead.

[Open Latentmachine →](/infer)

## Flat CSV columns to a nested JSON object

Spreadsheets are flat. APIs and databases are often not. A common need is to gather flat columns under a nested key:

```
name,address_street,address_city,address_zip
Ana Lopez,12 Main St,Berlin,10115
```

You need:

```json
{
  "name": "Ana Lopez",
  "address": {
    "street": "12 Main St",
    "city": "Berlin",
    "zip": "10115"
  }
}
```

The engine infers four mappings, three of them into the same nested target:

```
$.name → $.name
$.address_street → $.address.street
$.address_city → $.address.city
$.address_zip → $.address.zip
```

The output structure tells the engine where each value belongs. It does not infer nesting from the column names alone — it reads the shape of the output you provided and routes each source field to its target path. If you wanted the zip as a number, you would show it as a number in the output and the engine would add a coercion to that one field.

[Open Latentmachine →](/infer)

## JSON to CSV: flattening for a spreadsheet import

The conversion runs the other direction too. When a system needs a flat CSV — an accounting import, a spreadsheet review, a bulk upload template — you start from JSON:

```json
{
  "orderId": "ord_900",
  "customer": { "name": "Ana Lopez", "email": "ana@example.com" },
  "total": 4999
}
```

And you need a single flat row:

```json
{
  "order_id": "ord_900",
  "customer_name": "Ana Lopez",
  "customer_email": "ana@example.com",
  "total": "4999"
}
```

The engine infers:

```
$.orderId → $.order_id
$.customer.name → $.customer_name
$.customer.email → $.customer_email
string($.total) → $.total
```

Nested source fields are pulled up to flat target columns, the keys are renamed to the snake_case a CSV header expects, and the numeric `total` is coerced back to a string because CSV cells are text. Export the result as CSV and you get a header row plus your data row, ready to paste into a spreadsheet or hand to an import tool.

The point worth noticing: the same engine handles both directions because it does not care which side is CSV and which is JSON. It compares two structures and infers the operations that connect them.

[Try a JSON to CSV preset →](/?sample=json-to-csv)

## When the conversion cannot be inferred safely

Not every difference between a CSV row and a JSON object can be explained by the example you provided. When that happens, the engine says so instead of producing something that looks right.

**Unseen values in a value map.** If your example maps a `status` column value `A` to `"Active"` and `I` to `"Inactive"`, and a later row contains `P`, the engine marks that field unresolved rather than inventing an output for `P`. It has no example that says what `P` means.

**Contradictions.** If one example row maps the country code `DE` to `"Germany"` and another maps `DE` to `"Deutschland"`, the engine reports the contradiction and names the rows and the field. It will not silently pick one.

**Ambiguity.** If a column could plausibly be split on either a comma or a space and both reproduce the example, the engine reports the competing rules and tells you what kind of example would separate them — typically a value where the two separators would produce different results.

**Missing columns.** If the rule depends on a `quantity` column and a row arrives without one, the engine flags the missing field and the operation that needs it, before that row enters your output.

This diagnosis is the part a plain converter cannot give you. Converting one clean file is easy. Converting a hundred files where row forty-seven has a value you have never seen is where silent errors hide, and where a tool that refuses to guess earns its place.

## Exporting the conversion for reuse

Once a rule is marked safe, you can take it out of the browser:

- **Standalone JavaScript** — a dependency-free `transform()` function you can call from Node.js, a serverless function, or a build script.
- **n8n Code node** — the same logic wrapped in n8n's `$input.all()` pattern, ready to paste between a CSV-read node and the next step.
- **Make.com module** — formatted for Make.com's JavaScript transformation runtime.
- **Copy rule** — the symbolic program itself, including operation list, preconditions, confidence assessment, and diagnosis metadata, if you want to store conversions or build your own tooling.

Each export carries a comment header with the rule status and the operation list, so the generated code documents what it does.

## A practical workflow for a whole file

1. Take one representative row from your CSV and write out the JSON object it should become. Keep it honest: if a value should be a number, write it as a number.

2. Open Latentmachine, paste the row as the input and the object as the output.

3. If the engine asks for a second example, add a row with different values so it can rule out coincidental matches.

4. Read the inferred rule. Confirm each operation is what you intended — especially type coercions and splits.

5. Export the JavaScript and run it over the full file. Because the rule is deterministic, the same row always produces the same result.

The work shifts from writing and debugging a parser to writing two honest examples and reading what the engine inferred. For tabular data that has to move between systems repeatedly, that is the difference between a maintenance task and a solved problem.

[Open Latentmachine →](/infer)
