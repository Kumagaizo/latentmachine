---
title: "Export a CLI Tool From Your Transformation Rule"
description: "Turn a Latentmachine rule into a standalone command-line tool you can run in scripts, CI pipelines, and cron jobs. One file. No dependencies. No internet. The same guardrails as the browser, printed to your terminal."
date: "2026-05-25"
---

You taught Latentmachine a rule. You pasted examples, verified the diagnosis, checked the output. It works. Now you want to run it again next Monday, on a fresh export, without opening a browser.

The CLI export does that. It takes your frozen rule and wraps it in a self-contained JavaScript file you can run from the terminal. Same transformation. Same precondition checks. Same warnings. No browser, no server, no npm install.

## What you get

A single `.mjs` file. It contains the rule you taught, a minimal runtime to execute it, a CSV parser, a JSON parser, format detection, precondition validation, runtime warnings, batch processing, and a self-test. Everything needed to execute your exported rule, minus the UI.

The file has no dependencies. It runs with `node latentmachine-transform.mjs` on Node 18 or later. You can copy it to another machine, drop it into a Docker container, or commit it to a repository. It works offline, forever, without calling any server.

## How to export

1. Teach a rule in the browser as usual. Paste input, write output, add examples until the diagnosis is safe.

2. Click **Export CLI** in the actions row, next to the existing copy and download buttons.

3. A preview dialog shows the rule summary, the file name, the input and output formats, and a ready-to-copy CI command. Review it.

4. Click **Download CLI**. The file saves to your downloads folder.

That is all. The file is ready to use.

## First thing to do after downloading

Run the self-test:

```bash
node latentmachine-transform.mjs --self-test
```

This verifies that the exported file works correctly. The file contains a baked copy of your example input and its expected output. The self-test parses the input, runs the transformation, and compares the result to the expected output. If they match, it prints `OK`. If not, it tells you what went wrong.

Run this once, right after downloading, before you trust the file with real data. It takes less than a second.

## Basic usage

Transform a file and print the result:

```bash
node latentmachine-transform.mjs payments.json
```

Pipe data from another command:

```bash
cat export.csv | node latentmachine-transform.mjs
```

Write the result to a file instead of the terminal:

```bash
node latentmachine-transform.mjs data.json --out result.json
```

Pipe from an API:

```bash
curl -s https://api.example.com/records | node latentmachine-transform.mjs --pretty
```

The transformed output goes to stdout by default. Warnings and errors go to stderr. This means standard Unix piping works as expected: the next tool in the pipeline only sees clean output.

## Reading the help

```bash
node latentmachine-transform.mjs --help
```

This prints the usage summary, the baked rule metadata (title, creation date, operation count, formats, confidence label and evidence checks), and the preconditions: which fields the rule requires, their expected types, and which are mandatory. This is the same information you see in the diagnosis panel in the browser, condensed for the terminal.

For a longer guide:

```bash
node latentmachine-transform.mjs --readme
```

This prints a fuller usage document including quick-start commands, exit code meanings, and CI patterns.

## Batch processing

If you pass a JSON array of objects, or a CSV file with multiple rows, the CLI treats the input as a batch and applies the same frozen rule to each record.

```bash
node latentmachine-transform.mjs records.json --out results.json
```

The default behavior is conservative. If any row has a blocking precondition failure, such as a required field missing before transformation starts, the CLI blocks the whole batch and exits 2 without writing partial output. That is safer for scripts and CI pipelines, where downstream tools usually expect complete files.

Warnings are different. If a row produces a non-blocking warning, such as an unseen value in a learned value map, the CLI can still write output and report per-row diagnostics on stderr:

```
Warning: Row 12: $.status contains a value that was not in the examples.
```

The exit code reflects the run outcome. If anything is blocked, the exit code is 2. If output was produced with warnings, it is 1. If every row is clean, it is 0.

## Exit codes

The CLI uses three exit codes, following standard Unix conventions:

**0** means clean success. Every record transformed without issues. Safe to pipe the output to the next tool.

**1** means the output was produced, but with warnings. A value map encountered a value not seen in the teaching examples, or a field had an unexpected type. The output is usable but you should review the warnings. This is comparable to a compiler warning: the result is probably fine, but something deserves attention.

**2** means blocked. No output was produced, or a critical precondition failed. A required field is missing, a type mismatch prevents safe execution, or the rule could not produce valid output for one or more records. Details are on stderr.

These exit codes work directly with shell conditionals, CI job success criteria, and monitoring tools.

## Using it in a CI pipeline

A typical CI pattern:

```bash
node latentmachine-transform.mjs input.json \
  --out output.json \
  --report report.json \
  --strict
```

The `--strict` flag treats any warning as a blocking failure. The job exits 2 if anything is not perfectly clean. Use this when you want zero tolerance for unexpected data.

The `--report` flag writes a structured JSON file containing the full run metadata: rule info, timing, input/output sources, per-record diagnostics, and a summary with counts of clean, warned, and blocked records. Use this when another script or dashboard needs to read the results programmatically.

If you want warnings reported but not treated as failures:

```bash
node latentmachine-transform.mjs input.csv \
  --out output.json \
  --warnings-ok
```

This produces the output and exits 0 even when warnings are present. Warnings still appear on stderr so they are visible in logs, but they do not fail the job.

## Validating without transforming

```bash
node latentmachine-transform.mjs data.json --dry-run
```

This parses the input, checks all preconditions, and reports any issues without producing output. Use it as a pre-flight check: is this file going to work before you commit to running the full transformation?

If the input is clean, it prints `OK: input validates against the rule preconditions.` and exits 0. If there are issues, it reports them and exits 1 or 2.

## Inspecting the baked rule

```bash
node latentmachine-transform.mjs --info
```

This prints the full baked rule metadata as JSON: the rule program, the preconditions, the operation list, and the sample data. Use this when you want to understand exactly what the exported file does, or when you want to store the rule metadata alongside the file in version control.

## Printing the baked sample

```bash
node latentmachine-transform.mjs --sample-input
node latentmachine-transform.mjs --sample-output
```

These print the baked example input and expected output that the self-test uses. Useful when you need a reference for what the rule expects, or when you want to pipe the sample into another tool for comparison.

## Format handling

The CLI detects the input format automatically. If you pass a `.json` file, it parses JSON. If you pass a `.csv` file, it parses CSV with automatic separator detection (commas, semicolons, and tabs). You can override the detection:

```bash
node latentmachine-transform.mjs data.txt --format csv
```

The output format defaults to whatever format the rule was taught with. You can override it:

```bash
node latentmachine-transform.mjs data.csv --output json --pretty
```

The `--pretty` flag applies to JSON output only. Without it, JSON is minified for piping efficiency.

## Diagnostics format

By default, diagnostics print as human-readable text on stderr. For machine consumption:

```bash
node latentmachine-transform.mjs data.json --diagnostics json 2> diagnostics.json
```

This writes the diagnostics array as JSON to stderr, which the redirect captures to a file. Each diagnostic entry includes the issue type, the affected field, whether it is blocking, and a human-readable message.

To suppress diagnostics entirely:

```bash
node latentmachine-transform.mjs data.json --quiet
```

The exit code still reflects the outcome. Quiet mode silences stderr, not the judgment.

## What the CLI does not do

It does not infer new rules. The inference engine is not included in the exported file. If you need a different rule, go back to the browser.

It does not call any server. No telemetry, no update checks, no phoning home. The file runs offline.

It does not modify your input file. It reads from the file or stdin and writes to stdout or a specified output file. The original data is never touched.

It does not require installation. No `npm install`, no `package.json`, no `node_modules`. One file, one command.

It does not manage state between runs. Each invocation is independent. No config files, no caches, no local databases. Run it ten times and you get ten identical results.

## What the CLI does do

It runs the same generated transformation logic as the browser export. The `transform()` function inside the exported file is generated from the same symbolic rule as the standalone JavaScript export. The CLI wraps it with format parsing, precondition checking, runtime warnings, batch processing, exit codes, and reporting.

It checks every precondition before producing output. If the rule expects `$.user.email` as a string and it is missing, the CLI tells you before anything else happens. These are the same guardrails that the diagnosis panel shows in the browser, translated to stderr messages and exit codes.

It handles edge cases the same way. CSV separator detection, quoted fields, escaped quotes, leading-zero preservation on identifiers, formula injection escaping, type coercion with identifier protection. The CSV parser in the exported file is a full implementation, not a shortcut.

## A practical example

You taught Latentmachine to transform Stripe payment events into a flat accounting format. Two examples, both safe. You exported the CLI.

Now every week, your finance team sends you the latest Stripe export. Instead of opening the browser:

```bash
node latentmachine-stripe-payments-cli.mjs payments.json \
  --out accounting-import.csv \
  --report report.json
```

The output goes to a CSV file ready for the accounting system. The report goes to a JSON file that your monitoring can check. If a payment has a status value that was not in your examples, the CLI tells you in the report instead of silently producing garbage.

Set this up as a cron job or a CI step and it runs without you. The rule is frozen. The guardrails are built in. The output is deterministic.

When Stripe changes their payload format and a new field appears or an existing one moves, the CLI catches it as a precondition failure and exits 2. You go back to the browser, re-teach the rule with the new shape, export a fresh CLI, and replace the file. The cycle takes five minutes.

[Open Latentmachine →](/infer)
