---
title: "Translate Between JSON, CSV, YAML, TOML, XML, and .env — With Structural Transformation"
description: "Most format converters change the syntax but not the structure. Latentmachine does both: convert between JSON, CSV, YAML, TOML, XML, and .env while renaming fields, flattening nesting, coercing types, splitting strings, and filtering arrays. All from examples."
date: "2026-05-24"
---

There are hundreds of tools that convert JSON to CSV. They take your JSON keys, make them column headers, and dump the values into rows. The format changes. The structure does not.

But when you need to go from a Stripe webhook (deeply nested JSON) to an accounting spreadsheet (flat CSV with different column names), format conversion is only half the job. You also need to rename fields, extract nested values, convert cents to dollars, and drop fields you don't need. That structural transformation is the part you end up writing a script for.

Latentmachine does both at once. You paste the input in one format, paste the output in another format, and the engine infers the structural transformation and the format conversion simultaneously.

## What cross-format translation looks like

Here is a real scenario. Your input is a JSON API response:

```json
{
  "user": { "first": "Ana", "last": "Lopez" },
  "account": { "id": "a1" },
  "login_count": "12",
  "role": "admin"
}
```

Your target is a CSV row for a user audit spreadsheet:

```csv
name,account_id,logins,role
Ana Lopez,a1,12,admin
```

Show two examples. The engine infers four operations: concatenate `user.first` and `user.last` into `name`, extract `account.id` as `account_id`, coerce `login_count` from string to number as `logins`, and copy `role`. Then it serializes the result as CSV.

This is not something a format converter can do. And it is not something a JSON-to-CSV library does. It is structural transformation plus format translation, inferred from examples.

## Six formats, any direction

The engine does not have a preferred format. JSON, CSV, YAML, TOML, XML, and .env are all equal. Any combination works:

**JSON → CSV.** Flatten a webhook payload into spreadsheet rows. Extract nested fields, rename columns, coerce types.

**CSV → JSON.** Turn spreadsheet data into API-ready payloads. Add nesting, combine columns, convert string booleans to real booleans.

**JSON → YAML.** Convert API responses to config files. Restructure and rename in the process.

**YAML → JSON.** Flatten Kubernetes manifests or Docker Compose definitions into JSON records for a dashboard or database.

**YAML → CSV.** Extract config values into a spreadsheet for review or auditing.

**CSV → YAML.** Generate config entries from a spreadsheet of parameters.

**TOML → JSON.** Convert a `pyproject.toml` or Cargo config into a JSON record for an internal tool.

**XML → CSV.** Extract RSS feed items or SOAP response fields into flat rows for a spreadsheet.

**.env → JSON.** Restructure flat environment variables into a nested config object with typed values.

**JSON → .env.** Flatten a config object into deployment-ready environment variables.

**Same format with changes.** JSON → JSON, CSV → CSV, YAML → YAML — but with field renames, type coercions, string operations, and structural changes.

The engine infers the transformation from the structural difference between your examples. The formats are just how the data enters and leaves the tool.

## How it works under the hood

The architecture has three layers:

**Format layer.** Detects the input format (JSON, CSV, YAML, TOML, XML, or .env) and parses it into a plain JavaScript object. Detects the output format and prepares the serializer. This layer handles all format-specific concerns: CSV quoting, YAML anchors and the Norway problem, TOML table syntax, XML attributes and element nesting, .env key-value parsing.

**Inference engine.** Takes the parsed objects — input and output — and infers the transformation rule. This layer does not know which format the data came from. It sees typed fields, paths, and values. It generates candidate operations, scores them by simplicity, validates against all examples, and diagnoses ambiguity or contradictions.

**Serialization.** Takes the transformed output object and converts it to the target format. JSON gets pretty-printed. CSV gets proper header rows and escaped fields. YAML gets clean indentation with safe quoting. TOML gets table grouping. XML gets element and attribute structure. .env gets flat key-value lines.

The inference engine is identical for every format combination. Adding a new format means writing a parser and a serializer. The intelligence layer does not change.

## Auto-detection

You do not need to select a format. The engine detects it from the content:

If the text starts with `{` or `[` and parses as valid JSON, it is JSON. If it has a header row with comma-separated values and consistent column counts, it is CSV. If it has key-value pairs with colon separators and indentation-based nesting, it is YAML. If it uses `[table]` headers and `key = value` syntax, it is TOML. If it starts with `<` and contains tag-like markup, it is XML. If it uses `KEY=value` lines without nesting, it is .env.

The detection runs independently on each editor. Your input example can be XML and your output example can be CSV. The engine handles the mismatch automatically.

If you want to override the detection — because your CSV uses semicolons, or your YAML is ambiguous — each editor has a format selector that lets you specify the format explicitly.

## Batch translation

Cross-format batch works the same as single-format batch. Paste a JSON array with 500 records and set the output format to CSV. The engine infers the rule from your examples, applies it to all 500 records, and produces a downloadable CSV file.

Or paste a CSV with 200 rows and set the output to JSON. You get a JSON array of 200 transformed objects.

The rule is inferred once from the examples. Execution is applying the same deterministic program to each record. Typical batches complete quickly in a modern browser; unusually wide or deeply nested records take longer because more candidate paths need to be checked.

## What stays the same across formats

Everything that makes Latentmachine trustworthy in JSON-only mode carries through to cross-format translation:

**Diagnosis.** The engine still checks for contradictions, ambiguities, unseen values, and missing fields. A contradiction between an XML input example and a CSV output example is caught the same way as a contradiction between two JSON examples.

**Confidence assessment.** The status badge still says safe, ambiguous, or unsafe. The confidence label and evidence checks explain how well the examples constrain the rule; it is an assessment, not a probability.

**Exports.** The JavaScript export produces a function that takes a parsed value and returns a transformed value; file parsing and serialization are handled by the caller. The n8n and Make.com exports produce code that works with the automation platform's native data handling. For JSON, CSV, TOML, and .env rules, Latentmachine can also export a standalone CLI that includes parsing, serialization, diagnostics, reports, and a baked self-test. Standalone CLI export is not yet available for XML because it would need to inline the XML parser into every generated file.

**Inspectability.** The inferred rule is displayed the same way regardless of format. You see the operations, the sources, the targets. The rule is a structural program, not a format-specific script.

## When to use cross-format translation

Use it when you have data in one format and need it in another format with structural changes. This is different from pure format conversion (use any online converter for that) and different from structural transformation within one format (Latentmachine handles that too, but you don't need cross-format for it).

Common scenarios: CMS migration exports (JSON or CSV) that need to become import-ready records in a different shape. API responses (JSON or XML) that need to become spreadsheet rows (CSV) with renamed and flattened fields. Config files (YAML or TOML) that need to become flat records (JSON or CSV) for a dashboard. Spreadsheet data (CSV) that needs to become nested API payloads (JSON) for an import. Environment variable files (.env) that need to become structured config objects (JSON or YAML) with proper nesting and types.

If you can show one example of the input and one example of the output — in any format combination — the engine will figure out the rest.

[Open Latentmachine →](/infer)
