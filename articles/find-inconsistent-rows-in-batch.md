---
title: "Find the Inconsistent Rows in Any Batch"
description: "When a batch of transformed records looks mostly right, Latentmachine Verify can identify the exact rows that break the pattern by inferring the majority rule."
date: "2026-06-23"
tags: "verify,batch-validation,data-quality"
---

The hardest row to find is the row that is almost right.

Not the broken row. Not the row with invalid JSON or missing columns or a value that clearly does not belong. Those are loud failures.

The dangerous row is the one that follows the general shape of the batch but quietly uses a different rule.

A date is formatted differently. A value is rounded instead of preserved. A string is title-cased in one row and left as-is in another. A nested field is copied from `customer.id` everywhere except one record where it came from `account.id`.

The batch looks consistent until you compare it as a rule.

## Batch validation usually checks the wrong thing

Most validation checks answer structural questions:

- Is this valid JSON?
- Does this CSV have the right headers?
- Are required fields present?
- Are the values the right type?
- Does each row fit the target schema?

Those checks matter, but they miss a different class of error: row-to-row inconsistency.

A transformed batch can fit the target schema perfectly while still being produced by multiple rules. For data cleanup, migrations, automation output, and LLM-generated transformations, that is often the real problem.

You do not only want valid rows. You want rows that agree about what happened.

## The majority-rule approach

[Latentmachine Verify](/verify) treats a batch as evidence.

You paste the original records and the transformed records. Verify tries to infer the transformation rule that explains the batch. If every row follows the same rule, the verdict is consistent. If some rows do not, it flags the specific rows that break the pattern.

The key idea is majority rule. Verify does not blindly trust the first row. It looks for the rule that best explains the batch and then checks every row against that rule.

That makes it useful when you do not know the expected rule in advance.

You might not remember whether `status: "A"` was supposed to become `"active"` or `"enabled"`. But if 198 rows map it one way and 2 rows map it another way, those 2 rows deserve inspection.

This is different from writing validation rules by hand. Hand-written validation requires you to already know every rule you care about. Majority-rule checking starts from the evidence in front of you. It asks what the batch itself appears to be doing, then highlights the records that disagree with that pattern. That is why it works well for cleanup jobs, vendor files, and LLM outputs where the expected transformation was never formally documented.

## What counts as an inconsistent row?

An inconsistent row is a row where the transformed output differs from what the inferred rule predicts for that original input.

That can happen in many small ways:

- a copied field comes from a different source path;
- a string cleanup step was skipped;
- a date or number uses a different format;
- an enum value is mapped differently;
- a field is present in some rows and missing in others;
- an array is joined with a different separator;
- a nested object is flattened differently.

The row may still be valid. It may even be understandable. It is flagged because it does not match the rule the rest of the batch appears to follow.

That is exactly the kind of issue that human review misses, because the row does not look broken on its own.

## A practical workflow

Use Verify after a batch has already been transformed.

Good moments:

- after an LLM reformats a set of records;
- after a migration script produces an import file;
- after a spreadsheet formula or manual cleanup pass;
- after an automation exports normalized payloads;
- after a vendor sends "cleaned" data back to you.

Keep the original batch. Keep the transformed batch. Paste both into Verify. If the verdict is consistent, download the report or move on. If rows are flagged, inspect the differences before the data goes downstream.

The point is not to add ceremony. The point is to replace vague anxiety with a small list of concrete rows.

It also changes the order of review. Instead of scanning from the top and slowly losing patience, you start with the rows most likely to matter. If Verify flags nothing, you can move forward with a clean consistency signal. If it flags five rows, those five rows become the review queue. The workflow gets smaller instead of fuzzier.

## The report is part of the workflow

When a batch fails, you need something you can share or file with the migration notes. A screenshot is not enough.

Verify can download a JSON report containing the verdict, inferred rule steps, total row count, and flagged rows with predicted versus actual output. That report is useful when you need to hand the issue to someone else, compare two migration runs, or document why a file was rejected.

It turns data QA from "I think row 47 is weird" into "row 47 does not match the inferred rule; here is the expected output."

That distinction matters when the batch is part of a real workflow.

## Consistency before correctness

Finding inconsistent rows is not the same as proving the whole batch is correct. If every row follows the wrong rule, Verify will call it consistent.

That is by design. Correctness requires intent. Consistency requires evidence.

Use the [Infer](/infer) when you want to define and inspect the intended rule. Use Verify when you already have a batch and need to know whether the rows agree with each other.

Together, they give you the calm version of data transformation:

Build the rule. Inspect the rule. Run the batch. Verify the batch. Fix only the rows that actually break.

No panic scrolling. No random spot-checking. No "looks fine to me" before an import.

Just the rows that need your attention.

[Open Verify ->](/verify)
