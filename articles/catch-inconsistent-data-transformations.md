---
title: "How to Catch Inconsistent Data Transformations Before They Reach Your Database"
description: "Latentmachine Verify checks whether transformed records follow one deterministic rule. Paste original and transformed data, and it flags the rows that break the pattern. Works for LLM-generated output, manual conversions, and automated pipeline output."
date: "2026-06-16"
---

You asked an LLM to transform 200 product records from your CMS export into a clean import format. It did a convincing job. The first ten records look right. The last ten look right. You spot-check five in the middle. Everything checks out.

Row 47 has a flipped boolean. Row 112 concatenated the fields in the wrong order. Row 183 invented a category that does not exist in the source data.

You will not find these by spot-checking. The output is plausible enough to pass a visual scan, and the errors are distributed randomly across 200 rows.

This is the problem the [Verify](/verify) was built for.

## What Verify does

Paste two sets of aligned records: the originals on the left, the transformed versions on the right. Verify infers the majority transformation rule from your data and then applies that rule to every row. Any row where the applied rule produces a different result than the output you pasted gets flagged.

The output is a verdict: consistent (every row follows the inferred rule) or inconsistent (some rows break it). For inconsistent results, you see the flagged rows with three values side by side: the input, what the rule predicts, and what was actually provided.

The rule itself is displayed as a specification with named steps, so you can verify not just which rows are wrong, but what Verify thinks the transformation should be doing.

## The LLM drift problem

Language models are good at understanding the intent behind a transformation. They are less good at applying it identically across hundreds of rows. The failure mode is not random garbage. It is subtle variation: a date formatted differently in row 89, a string trimmed in row 134 but not in row 135, a numeric field rounded in one record and truncated in another.

This kind of inconsistency is hard to catch because each individual output looks reasonable. The problem is not that any single row is obviously wrong. The problem is that the rows do not agree with each other about what the rule is.

Verify inverts the problem. Instead of checking each row against your expectations, it checks all rows against each other. If 195 rows follow one rule and 5 do not, those 5 get flagged. You do not need to know the expected rule in advance. The data tells Verify what the rule should be.

## How the majority rule works

Verify does not assume the first row is correct. It tries to infer a rule that explains all rows, and if that fails, it runs a leave-one-out analysis: for each row, it asks whether removing that row from the training set produces a rule that explains more of the remaining data.

This means Verify can identify outliers even when the majority rule is not perfectly captured by any contiguous subset. If rows 1-50 follow one pattern and rows 51-200 follow another, Verify identifies the split. If one row in 200 was transformed differently, Verify flags it and shows you the discrepancy.

The underlying inference is the same engine that powers Infer. Verify adds a verification layer on top: infer the rule from the batch, apply the rule to every row, compare.

## Not just LLMs

Verify works on any paired data where you need to verify consistency:

**Manual conversions.** A colleague manually reformatted 50 records in a spreadsheet. Did they apply the same logic to every row? Paste the originals and the reformatted versions.

**Pipeline output.** A transformation step in your data pipeline produced unexpected results after an upstream schema change. Paste the raw input records and the pipeline output. Verify tells you which rows diverged.

**Migration QA.** You migrated records between two systems and need to verify the migration script handled every edge case. Paste the source records and the migrated records. If the script silently dropped a field or coerced a type differently on some records, Verify surfaces it.

**Vendor data.** A data provider sends you records that are supposed to follow a consistent schema. Paste a batch and check whether every row actually conforms.

## Supported formats

Verify supports the same formats as Infer: JSON, CSV, YAML, TOML, XML, and .env. Records can be in any of these formats on either side, and the formats do not need to match. You can paste JSON originals and CSV transformed output if that is what you have.

The format is auto-detected, or you can override it manually if the auto-detection picks the wrong one.

## What it does not catch

Verify catches inconsistency, not incorrectness. If every row is transformed the same way but that way is wrong, Verify marks the data as consistent because every row follows the same rule. It verifies that the transformation is uniform, not that it matches your intent.

For verifying intent, the diagnosis system in Infer is a better fit. Infer the rule from a few examples, inspect it, and confirm it does what you expect before applying it to the full dataset.

Verify and Infer solve adjacent problems: Infer helps you build the right rule, Verify helps you verify that a batch of data actually follows one.

[Open Verify →](/verify)
