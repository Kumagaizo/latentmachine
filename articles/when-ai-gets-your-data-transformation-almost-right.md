---
title: "When AI Gets Your Data Transformation Almost Right"
description: "Language models are fast at reshaping data. They are also non-deterministic, quietly inconsistent across rows, and impossible to audit after the fact. This article explains the specific failure modes and what to use when you need every row to be correct."
date: "2026-06-17"
---

You pasted a Stripe webhook payload into ChatGPT and asked it to flatten the nested fields into a database row. It gave you clean JavaScript. You tested it on three payloads. It worked. You deployed it.

Two weeks later you discover that refunded payments have a slightly different structure. The `charge` field is null instead of an object. The function does not crash — it returns `undefined` for the customer ID, which your database happily stores as an empty string. Forty-seven records now have no customer attached to them.

This is not a dramatic failure. The LLM did not hallucinate or refuse or return garbage. It gave you a function that works on most inputs. The problem is that "most" is not "all," and there is no mechanism in the generated code that tells you which inputs it has never seen.

## The three ways it goes wrong

Language models applied to data transformation fail in three specific patterns. Each one is structural, not accidental, and each one is hard to catch by inspection.

**Non-determinism across runs.** Ask the same model to write the same transformation twice. The variable names will differ. The error handling will differ. Sometimes the field access order will differ. For a single run this does not matter. For a pipeline that regenerates code on each deploy, it means the transformation is subtly different every time, and the differences are invisible unless you diff the generated code line by line.

**Drift across rows.** When you ask a language model to transform a batch of records, each record is processed through the same probabilistic machinery, but the model does not enforce consistency across records. Row 1 might format a date as `2024-03-15`. Row 89 might format the same date field as `March 15, 2024`. Row 134 might use `15/03/2024`. Each output is reasonable. The batch is not consistent. If you spot-check the first ten rows and the last ten rows, you will likely miss this.

**Hallucinated structure.** The model infers intent from the field names and values, not from a verified rule. If a field is named `status` and its value is `1`, the model might decide that `1` means `"active"`. It might be right. It also might not. There is no way to know without checking the source system's documentation, which is exactly the step you were hoping to skip by using the model.

These three patterns share a root cause: the model is optimizing for plausibility, not for determinism. Every output is its best guess. But a data transformation is not a guess. It is a function. The same input must always produce the same output, and different inputs that share the same structure must be handled by the same rule.

## Why this is hard to fix with prompting

The obvious response is "write a better prompt." Be more specific. Give more examples. Add constraints. This helps. It does not solve the problem.

A better prompt reduces the frequency of inconsistencies. It does not eliminate them. The model is still probabilistic. Even with temperature set to zero, different inputs activate different token paths. The transformation is still implicit in the model's weights, not explicit in a verifiable rule. You cannot inspect the rule the model is following because there is no rule. There is a probability distribution.

Structured output modes (JSON mode, function calling, response schemas) help with format consistency but not semantic consistency. The model will return valid JSON every time. Whether field `tier` maps to `"premium"` or `"pro"` for the same input value depends on which tokens the model samples for that particular completion.

## What deterministic inference looks like

A different approach: instead of asking a model to write a transformation function from a description, show a machine two or three examples of the transformation (input and output), and let it infer the rule.

This is what program synthesis does. The engine generates every candidate rule that could explain the examples, scores them by structural simplicity, and selects the cheapest one. The result is not code generated from a prompt. It is a symbolic program, verified against every example, with an explicit list of operations:

```
Copy $.data.object.id to $.paymentId.
Multiply $.data.object.amount by 0.01 and write the result to $.amountUsd.
Copy $.data.object.currency to $.currency.
Copy $.data.object.customer to $.customerId.
```

Each operation is independently auditable. You can see which source field feeds which target, what transformation is applied, and which examples support the inference. The rule is deterministic: same input, same rule, same output. Always.

The difference is not speed — both approaches produce results in seconds. The difference is verifiability. The symbolic rule is a thing you can read, check, and trust. The LLM output is a thing you can run and hope.

## The part where it catches problems

The more important difference is what happens when something is wrong.

When a program synthesis engine encounters ambiguity — two rules fit the examples equally well — it does not pick one silently. It reports both rules, classifies the ambiguity, and tells you what kind of example would resolve it. When the new input contains a value that was not covered by any example, it does not guess the output. It flags the field as unresolved and tells you which value is unseen.

This matters because the silent failures in LLM-generated transformations are exactly the failures that a diagnosis system catches at the source. The unseen enum value. The missing nested field. The ambiguous mapping between two status codes. These are not exotic edge cases. They are the normal variation in real-world API payloads.

An LLM will transform the unseen value into something plausible. A synthesis engine will tell you it has never seen that value and ask for another example. The first approach gives you clean output that might be wrong. The second gives you a warning that is definitely right.

## Verifying LLM output after the fact

If you have already used an LLM to transform a batch of records, you can still check whether the result is consistent. Paste the original records and the transformed records into Verify. It infers the majority rule from the batch and flags every row that deviates from it.

This inverts the problem. Instead of checking each row against your expectations, you check all rows against each other. If 195 rows follow one rule and 5 do not, those 5 get flagged. You do not need to know the expected rule in advance. The data tells Verify what the rule should be.

[Latentmachine Verify](/verify) does exactly this. It uses the same synthesis engine to infer the rule from the batch, then applies the rule to every row and reports discrepancies. The flagged rows show three values side by side: the input, what the inferred rule predicts, and what the LLM actually produced.

## When the LLM is the right tool

This is not a blanket argument against using language models for data work. There are cases where an LLM is genuinely the better choice:

When the transformation involves business logic that depends on domain knowledge ("if the product is in category X and the customer is in region Y, apply tax rate Z"). A synthesis engine cannot infer business rules from structural examples. An LLM can at least attempt to follow natural language instructions, even if the result needs verification.

When the transformation is creative rather than structural. Writing product descriptions from structured data. Generating summaries from tabular records. Classifying records by content. These are tasks where the output is not deterministically defined by the input, and a probabilistic approach is appropriate.

When you are exploring. You have a payload and you are not sure what the target shape should be yet. Talking to an LLM about the data is a fast way to understand the structure and sketch out a transformation. Once you know the shape, you can demonstrate it with examples and let a deterministic engine take over.

## The actual distinction

The question is not "AI or no AI." The question is whether the task requires determinism.

Renaming fields is deterministic. Flattening nested objects is deterministic. Converting types is deterministic. Reformatting dates is deterministic. Filtering arrays by a field value is deterministic. Joining strings with a separator is deterministic.

For deterministic operations, a tool that infers the exact rule and verifies it against examples is structurally superior to a tool that generates plausible code from a description. Not because the code is better, but because the rule is inspectable, the diagnosis is explicit, and the behavior on unseen inputs is predictable.

For everything else, use the LLM. It is good at what it is good at.

But when you need every row to be right — not most rows, not a plausible batch, every row — you need a rule you can read, not a completion you can run.

[Open Latentmachine →](/infer)
