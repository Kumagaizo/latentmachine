---
title: "Convert .env Files to JSON, YAML, or TOML by Example"
description: "Use Latentmachine to convert .env files to JSON, YAML, TOML, or CSV — and back — while renaming keys, restructuring flat variables into nested configs, coercing types, and filtering entries. All from examples."
date: "2026-06-16"
---

A `.env` file is the simplest configuration format: one key-value pair per line, no nesting, no types.

```
DATABASE_HOST=db.internal.example.com
DATABASE_PORT=5432
DATABASE_NAME=production
APP_SECRET=not-a-real-secret
DEBUG=false
```

Every framework reads it. Every deployment system writes it. And every time you need to convert these flat key-value pairs into a structured config, you write a small script to do it.

Latentmachine treats `.env` as a first-class data format. You can paste a `.env` file as input, show the structured output you need, and the engine infers the rule.

## .env to JSON

Paste the `.env` above as input. Show the JSON shape you need:

```json
{
  "database": {
    "host": "db.internal.example.com",
    "port": 5432,
    "name": "production"
  },
  "debug": false
}
```

The engine infers the mapping: `DATABASE_HOST` becomes `database.host`, `DATABASE_PORT` becomes `database.port` as a number, `DEBUG` becomes `debug` as a boolean. It also notices that `APP_SECRET` was omitted from the output and treats it as a dropped field.

The rule is inspectable. You can see each operation: which key maps where, which values are coerced, which fields are filtered out. If you add a second example with different values, the engine validates the rule against both.

## .env to YAML

The same approach works for YAML output:

```yaml
database:
  host: db.internal.example.com
  port: 5432
  name: production
debug: false
```

The engine infers the same structural rule. The difference is the output format. You choose JSON or YAML depending on what your target system expects.

## JSON or YAML back to .env

The reverse direction works too. Paste a structured config as input and show the `.env` format you need:

```
DB_HOST=db.internal.example.com
DB_PORT=5432
DB_NAME=production
```

The engine infers the flattening rule: `database.host` becomes `DB_HOST`, `database.port` becomes `DB_PORT` as a string, and so on. This is useful when you need to generate `.env` files from structured configs for Docker, CI pipelines, or local development setups.

## Why .env needs reshaping

Most `.env` converters change the syntax. They turn `KEY=value` into `{"KEY": "value"}` and call it done. That handles the format but not the structure. In practice, you almost never want a flat JSON object with screaming-case keys.

You want the keys renamed, the values typed, the flat namespace restructured into nested objects, and the secrets filtered out. That is a transformation, not a conversion. Showing the output you need is faster than describing these changes to a converter or writing a script.

## Type handling

`.env` files have no types. Every value is a string. When you show a JSON output with `"port": 5432` (a number) or `"debug": false` (a boolean), the engine infers a type coercion for those fields. It learns from your example that `5432` should be a number and `false` should be a boolean.

If a value cannot be safely coerced (it is not a valid number, or it is not `true`/`false`), the diagnosis system flags it instead of silently producing a wrong type.

## Exports

For `.env` rules marked safe, Infer can export JavaScript code for n8n, Make.com, or standalone scripts. The generated code handles the parsing, renaming, nesting, and type coercion in a single function.

The CLI export is available for `.env` transformations, so you can pipe `.env` files through the inferred rule in a shell script or CI job.

[Open Infer →](/infer)
