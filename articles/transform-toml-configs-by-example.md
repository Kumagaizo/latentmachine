---
title: "Convert TOML to JSON or YAML by Example"
description: "Use Latentmachine to convert TOML configs into JSON, YAML, CSV, or .env output while reshaping fields, preserving types, and inspecting the inferred rule."
date: 2026-06-15
---

TOML is pleasant to read and common in real projects: `Cargo.toml`, `pyproject.toml`, static-site config, deploy settings, and tool manifests all use it. The annoyance starts when another system wants the same data as JSON, YAML, CSV, or environment variables.

A plain converter can change TOML syntax into JSON syntax. Latentmachine can do that, but the more useful part is structural transformation. You can rename fields, flatten nested tables, pull values out of arrays of tables, coerce types, and produce the shape your next tool expects.

## Example: TOML to JSON

```toml
[service]
name = "api"
port = 3000
enabled = true

[deploy]
region = "eu-central-1"
```

Show the output you want:

```json
{
  "app": "api",
  "port": 3000,
  "region": "eu-central-1",
  "enabled": true
}
```

Latentmachine parses the TOML into plain structured data, compares it with your output example, and infers a deterministic rule. The rule is format-independent: TOML is only how the data enters the system.

## What TOML Support Handles

- Tables such as `[service]` become nested objects.
- Dotted keys such as `server.host = "localhost"` become nested fields.
- Arrays such as `ports = [3000, 3001]` stay arrays.
- Inline tables such as `owner = { name = "Ana" }` become objects.
- Arrays of tables such as `[[packages]]` become arrays of objects.
- Strings, numbers, booleans, and dates preserve their useful JavaScript types. Dates are represented as strings.

## Why Examples Matter

If all you need is syntax conversion, any TOML-to-JSON converter can help. If you need to produce a different structure, examples are faster than writing a one-off script.

You show one or two before-and-after pairs. Latentmachine infers the smallest rule that explains them, then applies that rule to the next TOML config. If the examples are ambiguous or contradictory, it tells you instead of guessing.

## Exports

For TOML rules marked safe, Latentmachine can export JavaScript, n8n code, Make.com code, and a standalone CLI. The CLI includes TOML parsing and can run locally in scripts or CI without installing packages.

That keeps the loop simple: teach the rule in the browser, inspect it, export it, and run the same transformation wherever the config files live.
