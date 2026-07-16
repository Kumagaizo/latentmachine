---
title: "How to Transform YAML Configs by Example — Kubernetes, Docker Compose, and CI/CD"
description: "Reshape Kubernetes manifests, flatten Docker Compose services, convert YAML configs to JSON or CSV, and clean up CI/CD pipelines by showing before-and-after examples. Handles the Norway problem, anchors, multi-line strings, and nested structures."
date: "2026-05-24"
---

If you work with Kubernetes, Docker Compose, rendered Helm output, GitHub Actions, or other YAML-shaped infrastructure files, you spend a meaningful part of your week reshaping YAML. Extracting deployment details into a summary. Flattening nested service configs for a spreadsheet. Converting CI/CD pipeline definitions between formats. Normalizing environment variables across configs.

Most of this work is structural: the data is the same, it just needs to be in a different shape. You know the transformation in your head but expressing it as a script takes longer than it should.

Latentmachine handles YAML as a first-class format. Paste a YAML config, show what you need, and the engine infers the transformation rule — the same way it handles JSON and CSV. This article walks through real scenarios.

## Kubernetes manifest to flat summary

A Kubernetes Deployment manifest contains useful metadata buried in nested structure:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
  namespace: production
  labels:
    app: web
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: web
          image: myapp:1.2.3
```

You need a flat record for a deployment inventory:

```json
{
  "name": "web-app",
  "namespace": "production",
  "app": "web",
  "replicas": 3,
  "image": "myapp:1.2.3"
}
```

Show two examples of this transformation. The engine infers five operations that extract from nested YAML paths into flat JSON keys. Status: safe. Each operation is a direct mapping from a specific YAML path to a JSON field.

The output format is whatever you need. Want CSV instead of JSON? Change the output example to a CSV row. The same structural transformation applies, serialized differently.

[Try this example in Latentmachine →](/?sample=k8s-config-yaml)

## Docker Compose service extraction

A Docker Compose file defines multiple services with their images, ports, and restart policies:

```yaml
services:
  web:
    image: nginx:1.25
    ports:
      - "80:80"
    restart: always
  db:
    image: postgres:16
    ports:
      - "5432:5432"
    restart: unless-stopped
```

You need a service inventory for documentation or monitoring setup:

```json
{
  "service": "web",
  "image": "nginx:1.25",
  "restart": "always"
}
```

The engine extracts the service name from the YAML key structure and maps nested properties to flat fields. Ports are dropped because they don't appear in the output — the engine only includes fields that appear in your examples.

## YAML to CSV for spreadsheet review

When you need to review infrastructure configs in a spreadsheet — for auditing, for a meeting, for a change request — you need CSV, not YAML.

Show one YAML input and one CSV output:

```yaml
name: web-app
namespace: production
replicas: 3
image: myapp:1.2.3
```

```csv
name,namespace,replicas,image
web-app,production,3,myapp:1.2.3
```

The engine infers the field mapping and format conversion simultaneously. Paste a batch of YAML configs and download a CSV file with all entries.

## Config format conversion — YAML to JSON

Some tools expect JSON configs. Some expect YAML. Converting between them seems trivial until you need to rename fields, flatten nesting, or change the structure at the same time.

```yaml
database:
  host: localhost
  port: 5432
  name: mydb
redis:
  host: localhost
  port: 6379
```

Becomes:

```json
{
  "db_host": "localhost",
  "db_port": 5432,
  "db_name": "mydb",
  "cache_host": "localhost",
  "cache_port": 6379
}
```

This is not a simple format conversion — the field names changed and the nesting was flattened with prefixes. A format converter would give you `{ "database": { "host": "localhost" } }`. Latentmachine gives you the structural transformation you actually need.

## Why YAML parsing is harder than it looks

YAML has more parsing gotchas than JSON and CSV combined. Latentmachine handles the common ones deliberately, but it is worth knowing what can go wrong if you parse YAML yourself.

**The Norway problem.** In YAML 1.1, the unquoted string `NO` is parsed as boolean `false`. The country code for Norway silently becomes a boolean in your data. Same for `YES`, `ON`, `OFF`, and all their case variants. Latentmachine uses YAML 1.2 parsing, where only `true` and `false` are booleans. Your country codes stay strings.

**Octal numbers.** In YAML 1.1, `0777` is octal (decimal 511, not 777). In YAML 1.2, it's the integer 777. Latentmachine parses as 1.2, so file permissions and similar values behave as expected.

**Version numbers becoming floats.** `10.23` in a list of version numbers becomes a float, while `9.5.25` stays a string (two dots can't be a number). This creates mixed-type arrays. Latentmachine's diagnosis layer can detect and warn about mixed types.

**Anchors and aliases.** YAML supports `&anchor` and `*alias` for reusing values, and `<<: *merge` for merging mappings. These are common in Kubernetes and Docker Compose configs. Latentmachine resolves them before inference — the engine sees the expanded values, not the YAML shorthand.

**Multi-line strings.** Literal blocks (`|`) preserve newlines. Folded blocks (`>`) join lines. Both are valid YAML that the parser handles correctly.

**Duplicate keys.** YAML technically allows duplicate keys, with the last value winning silently. Latentmachine rejects duplicate keys and reports an error instead of silently losing data.

## YAML to YAML with structural changes

Sometimes the input and output are both YAML, but the structure changes:

```yaml
first_name: Ana
last_name: Lopez
department: Engineering
level: senior
```

Becomes:

```yaml
fullName: Ana Lopez
dept: Engineering
seniority: senior
```

The engine infers a string concatenation for the name, a rename for department, and a rename for level. The output is serialized as clean YAML with plain (unquoted) string values where safe, and quoted strings where necessary to avoid ambiguity.

## Security and limits

The YAML parser is a vendored copy of the `yaml` library (version 2.9.0, ISC license), shipped with the static app rather than fetched from a CDN at runtime.

Anchor expansion is capped at 64 aliases to limit billion-laughs style expansion attacks. Explicit YAML tags (`!!python/object`, etc.) are rejected, Helm templates are rejected until rendered, and input is limited to 1MB.

All parsing happens in the browser. No YAML data is sent to any server.

[Open Latentmachine →](/infer)
