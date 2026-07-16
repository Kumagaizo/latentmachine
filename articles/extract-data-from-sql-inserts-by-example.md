---
title: "Extract Data from SQL INSERTs by Example"
description: "Use Latentmachine to parse SQL INSERT statements from dumps or seed files, turn rows into JSON-compatible data, and reshape them into JSON, CSV, YAML, TOML, or .env output from examples."
date: 2026-06-23
---

SQL dumps are often the quickest way to move real data between systems, but they are awkward when the next step needs JSON, CSV, YAML, or a smaller API-shaped payload.

Latentmachine can read `INSERT INTO ... VALUES ...` statements as input. You paste the SQL rows, show the output shape you need, and Infer works from structured rows instead of raw SQL text.

## Example: SQL INSERT to JSON

```sql
INSERT INTO users (id, name, email, role, created_at)
VALUES (1, 'Ana Lopez', 'ANA@EXAMPLE.COM', 'admin', NOW());
```

Show the JSON output you want:

```json
[
  {
    "user_id": 1,
    "name": "Ana Lopez",
    "email": "ana@example.com",
    "access": "admin"
  }
]
```

Latentmachine parses the SQL row into a normal structured record first. Then it can infer the useful transformation: copy `id`, rename fields, lowercase the email address, keep the role under a new key, and drop fields that are not part of the output.

## What SQL INSERT support handles

- Column-based inserts such as `INSERT INTO users (id, name) VALUES (...)`.
- Inserts without column names as array rows.
- Multi-row `VALUES (...), (...)` statements.
- Multiple `INSERT` statements in one pasted dump.
- Common dump noise such as comments, `CREATE TABLE`, `SET`, and lock/unlock statements around the inserts.
- MySQL-style `INSERT IGNORE`, priority modifiers, `REPLACE INTO`, and `INSERT ... SET ...`.
- SQLite-style `INSERT OR REPLACE`.
- Upsert or returning tails after parsed rows, such as `ON DUPLICATE KEY UPDATE`, `ON CONFLICT`, and `RETURNING`.
- Backtick and double-quoted identifiers.
- SQL Server-style bracket identifiers.
- SQL strings using `''` escaping or MySQL-style `\'` escapes.
- PostgreSQL-style escaped strings such as `E'line\nline'` and Unicode-prefixed strings such as `N'Ana'`.
- `NULL`, `TRUE`, `FALSE`, integers, and floats.
- SQL expressions such as `NOW()` as descriptive strings, for example `[SQL expression: NOW()]`.

When the SQL includes column names, rows become objects. When it does not, rows become arrays. If the pasted SQL includes multiple tables, Latentmachine groups the parsed rows by table name.

## Safety and diagnostics

Large dumps can contain a lot more than row data. Latentmachine ignores common non-row statements around the inserts and reports that they were skipped. If the SQL uses unsupported row sources such as `INSERT INTO ... SELECT ...` or `DEFAULT VALUES`, it fails with a clear message instead of pretending the data was extracted.

The browser parser also has safety limits for pasted dumps. By default, SQL parsing is capped at 10,000 rows, 1,000 INSERT statements, and roughly 2 MB of SQL text. For larger migrations, split the dump into smaller slices and transform each slice with the same verified rule.

## Input-only by design

SQL INSERT is intentionally input-only. Latentmachine can parse SQL seed data or dump rows and transform them into another format, but it does not generate new SQL dumps.

That keeps the feature focused on the most common workflow: extracting usable structured data from database exports, then reshaping it for APIs, audits, migrations, or reports.

## Useful workflows

- Turn a SQL seed file into JSON fixtures.
- Extract selected columns from SQL dumps into CSV.
- Normalize emails, names, roles, or status labels from imported rows.
- Group data from multiple inserted tables before mapping it to another schema.
- Audit migrated rows by comparing the inferred output against expected examples.

If a transformation is ambiguous, Latentmachine asks for another example instead of guessing. That matters especially with dump data, where one wrong assumption can quietly spread across many rows.

[Open Infer →](/infer)
