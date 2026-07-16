---
title: "When Your Transformation Rule Is Wrong (And How to Know Before It Breaks)"
description: "Most data transformation tools give you output and hope for the best. Latentmachine gives you a diagnosis first. Learn how confidence assessment, contradiction detection, and ambiguity triage work under the hood."
date: "2026-05-19"
---

The output of a data transformation is easy to check when you have five records. It is much harder when you have five thousand, and the rule was inferred rather than written by hand. The question is not "did it work on my test data?" The question is "will it keep working on data I have not seen yet?"

Latentmachine was built around this problem. The transformation engine does not just produce output. It produces a diagnosis that tells you whether the inferred rule is safe, ambiguous, contradictory, or insufficiently proven. This article explains what each status means, how confidence assessment works, and what to do when the engine tells you something is off.

## The five statuses

Every rule that Latentmachine infers gets one of five statuses:

**Safe** means the engine found exactly one rule that fits all examples, no contradictions exist, no ambiguities remain, and the rule executed on the new input without warnings. This is the only status where export is recommended without reservations.

**Ambiguous** means the engine found more than one meaningful rule that fits all examples. Both rules produce correct output for the examples you gave, but they would behave differently on unseen inputs. The engine tells you which fields are ambiguous and suggests what kind of example would resolve it.

**Contradictory** means your examples disagree with each other. One example says "admin" maps to "Full Access", another says "admin" maps to "Limited". The engine identifies the conflicting field and the specific examples that disagree. It does not pick a winner.

**Unsafe** means the rule works on the examples, but there is a runtime concern with the new input. Typically this means a value appeared in the new input that was not covered by any example, and the engine cannot predict the correct output for that value.

**Insufficient** means there are not enough examples to distinguish between competing interpretations. Usually this means you provided only one example and the engine found multiple plausible rules. Adding a second example with different values almost always resolves it.

## How confidence assessment works

The confidence label is not a probability. It is an evidence assessment built from checks that ask whether the rule is exactly fitted, covered, unambiguous, sufficiently demonstrated, and free of guardrail warnings:

```
Exact fit: pass/fail
No blocking guardrails: pass/fail
All paths explained: pass/fail
No meaningful ambiguity: pass/fail
At least two examples: pass/fail
```

The label is derived from those checks: proven, supported, needs-proof, unsafe, or blocked. Runtime warnings push the result toward unsafe because the engine cannot guarantee correct output for the new input.

Latentmachine never claims certainty, because the engine can only validate against the examples you gave it, not against every possible input. The label tells you what evidence exists, which checks passed, and which reasons still matter.

## What ambiguity looks like in practice

Suppose you provide two examples where a "status" field maps from "active" to "enabled" and from "inactive" to "disabled". Two rules fit:

1. A value map: "active" becomes "enabled", "inactive" becomes "disabled".
2. A structural rule: the word is always replaced with a synonym.

Both rules produce correct output for the two examples. But they would behave differently if the input contained "pending". The value map would flag it as unseen. The structural rule (if it existed as an operation) would try to guess a synonym.

Latentmachine reports this as an ambiguity with a triage assessment. It classifies the ambiguity as "meaningful" (both rules are genuinely plausible), "weak" (one is clearly simpler), or "equivalent" (both rules behave identically for all practical cases). For meaningful ambiguities, it suggests: "Add an example where the status value is different from both 'active' and 'inactive'."

## Contradictions are caught, not hidden

Many transformation tools silently pick the last value when examples disagree. Latentmachine does the opposite. If two examples map the same input value to different outputs, the engine marks the field as contradictory and stops.

```
$.status maps "admin" to "Full Access" in example 1
$.status maps "admin" to "Limited" in example 2

Status: contradictory
```

This is intentional. A contradictory rule cannot be trusted. The engine would rather refuse to produce output than produce output that is correct half the time.

## Unseen values trigger guardrails

When a rule includes a value map and the new input contains a value the engine has not seen in any example, it does not guess. It marks the output field as unresolved:

```
[unresolved: unseen value at $.role]
```

The diagnosis includes a suggested action: "Add an example covering another value for $.role." This guardrail exists because value maps are the most common source of silent failures in data transformations. A rule that maps "admin" to 1 and "editor" to 2 will break on "viewer" unless someone explicitly teaches it what to do.

## Missing fields are flagged, not ignored

If the inferred rule expects a source field that is absent from the new input, the engine catches it:

```
$.account.id is required by the learned rule but is missing from the new input.
```

This matters more than it sounds. In webhook payloads and API responses, optional fields are common. A rule inferred from a complete payload will break on a partial one. The diagnosis tells you exactly which field is missing and which operation depends on it, so you can adjust the rule or add an example that handles the missing case.

## Using the diagnosis in practice

If the status is safe, export the rule and move on. If it is anything else, the diagnosis gives you a specific next step:

For **ambiguous**: add one more example that separates the competing interpretations. The engine tells you which fields need different values.

For **contradictory**: fix the conflicting examples. One of them is wrong, or you need a third field to explain the difference.

For **unsafe**: check the warnings. Usually you need one more example that covers the unseen value or the missing field.

For **insufficient**: add a second example. One example is often not enough for the engine to prove the rule generalizes.

The diagnosis is not an error message. It is the engine telling you what it still needs to learn. Treat it like a conversation: give it another example, and it will update the rule accordingly.

[Open Latentmachine →](/infer)
