---
title: "How to Validate a Data Migration Before You Go Live"
description: "Data migrations fail silently. Records drift, fields get misformatted, edge cases slip through. This guide shows how to verify that every migrated record followed one deterministic rule, whether you migrated with a script, an ETL tool, or an LLM."
date: "2026-08-24"
tags: "verify,migration,data-quality,batch-validation"
---

You migrated 12,000 customer records from your old CRM to the new one. The import completed without errors. The row count matches. A quick spot-check on the first twenty records looks clean.

Three weeks later someone notices that 340 records have phone numbers in the email field. Another 90 have the company name duplicated into the address line. Seventeen records have dates formatted as MM/DD/YYYY instead of the ISO format every other record uses.

Nobody catches these during the migration because the migration "succeeded." The data moved. The counts matched. The spot-check passed. The failures were not crashes. They were inconsistencies, spread across thousands of records, invisible unless you check every row against a single rule.

This is the core problem with data migration validation: the question is not "did the data arrive?" but "did every record follow the same transformation?"

## What migration validation actually requires

A complete migration validation checks three things:

**Structural consistency.** Every record in the target has the same fields in the same shape. No record is missing a column that every other record has. No record has an extra field that others lack.

**Value consistency.** When the same source value appears in different records, it produces the same target value. If `country_code: "DE"` maps to `country: "Germany"` in row 1, it maps to `country: "Germany"` in row 8,000 too. Not `country: "DE"`. Not `country: "deutschland"`.

**Rule consistency.** Every record was transformed by the same set of operations. The same field was renamed the same way. The same type conversion was applied. The same string formatting was used. Not "mostly the same." The same.

Most migration testing stops at row counts and spot-checks. That covers the first requirement and part of the second. It does not cover the third at all.

## How to verify the batch

Take the original records and the migrated records. Align them by row: original record 1 next to migrated record 1, original record 2 next to migrated record 2.

Paste both sets into [Latentmachine Verify](/verify).

Verify does not ask you to define the expected transformation. It infers the rule from the batch itself. It looks at all the original-to-migrated pairs, finds the transformation that explains the majority of rows, and then applies that rule back to every original record. Any migrated record that does not match what the inferred rule predicts gets flagged.

Each flagged row shows three values: the original input, what the majority rule says the output should be, and what the migrated record actually contains. The difference between "should be" and "actually is" tells you exactly what went wrong and where.

This inverts the usual approach. Instead of defining test cases before the migration and hoping they cover enough scenarios, you let the migrated data tell you what the rule is and then check whether the data follows its own rule. Inconsistencies surface automatically.

## Common migration failures this catches

**Date format drift.** A migration script formats most dates as ISO 8601 (`2026-03-15`) but a handful come through as `15/03/2026` or `March 15, 2026`. This happens when the script encounters dates stored as free text in the source system and parses them with locale-dependent logic. Verify catches every row where the date format deviates from the majority pattern.

**Null handling inconsistency.** Some records map a missing value to `null`. Others map it to an empty string. Others map it to `"N/A"` or `"none"`. The migration script handles the common case but falls through to different defaults for edge cases. Verify flags every row where the null representation differs from the majority.

**Field concatenation mismatches.** The migration merges `first_name` and `last_name` into a `full_name` field. Most records produce `"Ana Lopez"`. Some produce `"Lopez, Ana"` because the source record had the names in a different order or a different separator. Verify identifies the rows where the concatenation pattern breaks.

**Encoding and whitespace.** A source record has a non-breaking space or a smart quote that the migration script handles differently from a regular space or straight quote. The output looks identical in a spreadsheet but fails string comparison. Verify operates on the actual bytes, so invisible characters are caught.

**Type coercion failures.** The source stores prices as strings (`"49.99"`). The target expects numbers (`49.99`). Most rows convert cleanly, but a few have currency symbols (`"$49.99"`) or thousands separators (`"1,299.00"`) that the conversion logic does not handle. Verify flags these because the inferred rule is a clean string-to-number conversion and the flagged rows did not follow it.

## A practical validation workflow

**Step 1: Export a sample from both systems.** You do not need every record. A few hundred is usually enough to surface patterns. Export the same set of records from the old system and the new system, ordered identically.

**Step 2: Paste into Verify.** Original records on the left, migrated records on the right. Verify handles JSON, CSV, YAML, and TOML on both sides, so use whatever format your export produces.

**Step 3: Read the inferred rule.** Before looking at flagged rows, read the transformation the engine inferred from the batch. Does it match what you intended? If the rule says `$.phone → $.email`, something is structurally wrong. If the rule says `string($.price) → $.price` and you expected a number, the migration has a type problem across all rows, not just flagged ones.

**Step 4: Examine the flagged rows.** Each flagged row tells you which field deviated and how. Group the flags by failure type. If 15 rows all have the same date format issue, that is one bug in the migration script. If each flagged row has a different problem, the migration logic has multiple code paths producing inconsistent output.

**Step 5: Fix and re-verify.** After fixing the migration script or manually correcting the flagged records, run Verify again on the updated batch. Zero flags means every row follows one rule.

## Validating migrations you did not write

This workflow is especially useful when you did not write the migration yourself. You inherited a migration from a vendor, a contractor, or a different team. You have the before data and the after data, but you do not have the transformation logic. You cannot review the code. You can only review the output.

Verify does not need the code. It infers the rule from the data itself. If the vendor's migration is consistent, Verify says so. If it is not, Verify tells you exactly which records broke the pattern and how.

This also applies to migrations performed by an LLM. If you asked ChatGPT or Claude to transform a batch of records, the output may look clean but contain the subtle row-by-row drift that language models are prone to. Verify catches exactly this: it does not care how the transformation was produced. It checks whether the result is deterministic.

## When spot-checking is actually enough

For a migration of fewer than 50 records where you can visually inspect every row, Verify adds no value. Read the data. Check the fields. Move on.

For a one-time migration where the data will be manually reviewed and corrected by users after import (a CMS migration where editors will touch every page anyway), structural validation may be enough. Verify the schema. Check that required fields are present. Let the editors handle the rest.

Verify earns its place when the record count is too large to inspect manually, when the migrated data enters a system that trusts it without human review, and when downstream processes depend on consistency across the full dataset. In those cases, the difference between a spot-check and a deterministic verification is the difference between hoping the migration worked and knowing.

[Open Verify →](/verify)
