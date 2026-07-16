---
title: "How to Verify LLM Data Transformations"
description: "LLMs can reshape data quickly, but batch outputs can drift row by row. This guide shows how to verify ChatGPT-style data transformations by checking whether every transformed record follows one deterministic rule."
date: "2026-06-23"
tags: "verify,llm,data-validation"
---

You asked an LLM to transform a batch of records. It responded with clean JSON. The shape looks right. The field names are better. The dates are readable. The first few rows pass a quick glance.

That is the dangerous part.

LLM data transformations usually do not fail by turning into nonsense. They fail by being almost consistent. Row 1 formats a status as `"active"`. Row 27 formats the same source value as `"Active"`. Row 93 keeps an empty string where every other row uses `null`. Row 144 changes a date format because the original value looked slightly different.

Every individual row can look reasonable. The batch is still not safe.

This is the verification problem: not "does this output look plausible?" but "did the same transformation rule run on every row?"

## Why LLM batch transformations drift

When you ask a language model to transform records, the transformation rule lives inside the model's next-token behavior. It is not a program with a stable set of operations. It is an interpretation of your instruction, the examples in the prompt, the current row, and the surrounding context.

For a small one-off conversion, that can be useful. For a batch of data, it creates three failure modes.

**Format drift.** Dates, booleans, enum labels, currency values, and null-like values are especially vulnerable. A model may infer the same intent but express it differently across rows.

**Schema drift.** The model may include a field for some records and omit it for others. It may invent a missing value for one row and leave the field blank for another.

**Semantic drift.** The model may map the same source value to different labels depending on context. A `"1"` may become `"active"` in one row and `"enabled"` in another. Both are plausible. Only one can be the rule.

Prompting can reduce these failures, but it cannot give you proof. A stricter prompt is still an instruction to a probabilistic system. What you need after the fact is a deterministic check.

## The verification test

Take the original records and the transformed records. Keep them aligned by row: original row 1 next to transformed row 1, original row 2 next to transformed row 2, and so on.

Then ask one question:

Can a single deterministic rule explain this whole batch?

If the answer is yes, the transformation is at least internally consistent. That does not prove the rule matches your intent, but it proves every row followed the same logic.

If the answer is no, the next question is more important:

Which rows break the rule?

This is what [Latentmachine Verify](/verify) does. Paste the original records on the left and the transformed records on the right. Verify infers the majority rule from the batch, applies that rule back to every original row, and flags the transformed rows that do not match what the rule predicts.

You get three pieces of evidence:

- the inferred rule, written as readable transformation steps;
- the count of rows that follow the rule;
- each flagged row with input, predicted output, and actual output.

That last comparison is the useful part. It turns "something feels off" into a concrete diff.

## A simple example

Imagine an LLM transformed customer records from this:

```json
[
  { "first": "Ana", "last": "Meyer", "joined": "2026-03-02" },
  { "first": "Bo", "last": "Singh", "joined": "2026-03-04" }
]
```

Into this:

```json
[
  { "name": "Ana Meyer", "joinedDate": "2026-03-02" },
  { "name": "Bo Singh", "joinedDate": "March 4, 2026" }
]
```

Both rows are readable. Both rows might pass a human spot-check. But they do not follow the same date rule.

A consistency verifier sees that the majority pattern preserves the ISO date and flags the row where the transformed date switched formats. You do not need to write the expected rule by hand. The batch itself provides the evidence.

## What consistency does and does not prove

Consistency is not correctness.

If every row maps `status: 1` to `"enabled"` but your system expects `"active"`, the batch is consistent and still wrong. Verify is not a business-rule oracle. It does not know your target system.

What it proves is narrower and very useful: the transformed batch follows one rule. Once you know the rule is consistent, you can inspect that rule and decide whether it is the right one.

For intent, use a small set of examples in the [Infer](/infer). Show the source shape and desired target shape. Let the engine infer the rule, inspect it, and export it. For batch QA, use Verify after an LLM, script, migration, or manual cleanup has already produced output.

The two workflows fit together:

1. Use examples to define the transformation you want.
2. Run or receive a batch transformation.
3. Verify that the whole batch followed one deterministic rule.
4. Fix only the rows that broke the pattern.

## When to verify LLM output

Verify whenever the output will enter another system: a database import, CRM sync, analytics pipeline, CMS migration, automation workflow, or customer-facing file.

Verify especially when:

- the batch has more rows than you can inspect manually;
- dates, statuses, currencies, or null values are involved;
- the LLM returned transformed data directly instead of code;
- you regenerated the output after changing the prompt;
- downstream errors would be hard to trace back to the source row.

Spot-checking is a comfort ritual. Verification is evidence.

## The small habit that saves the batch

Keep the originals. Keep the transformed output. Paste both into Verify before importing anything permanent.

If all rows are consistent, you have a stronger reason to trust the batch. If some rows are not, you know exactly where to look and what each row should have been.

That is the difference between using an LLM as a helpful assistant and letting it silently become a data pipeline.

[Open Verify ->](/verify)
