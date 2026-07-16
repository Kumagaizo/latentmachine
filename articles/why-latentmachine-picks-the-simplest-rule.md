---
title: "Why Latentmachine Picks the Simplest Rule (and How the Cost Model Works)"
description: "When multiple transformation rules fit the same examples, Latentmachine picks the simplest one. This article explains the cost-based scoring model, why simplicity matters for correctness, and how the engine handles ties."
date: "2026-05-19"
---

Here is a problem that comes up more often than you would expect: you show the engine two examples, and three different rules all produce correct output for both. Which one should it pick?

Example input: `{ "status": "active" }` maps to output `{ "status": "active" }`.

Three rules fit:

1. **Direct copy.** Take `$.status` from the input and put it in `$.status` in the output. Lowest cost.
2. **Value map.** Look up "active" in a table and return "active". Cost: 2.25.
3. **Constant.** Always write "active" regardless of input. Cost: 1.90.

All three produce the correct output for this example. But they predict very different things for the next input. A direct copy passes through any value. A value map breaks on unseen values. A constant ignores the input entirely.

The engine picks the direct copy. Not because it is "smarter" but because it is cheaper. And cheaper, in this system, means simpler. This article explains why that works.

## The idea behind cost-based selection

The cost model implements a principle from information theory called Minimum Description Length, which is a formal version of Occam's razor: among all explanations that fit the evidence, prefer the shortest one.

The intuition is practical. A rule that says "copy this field" makes fewer assumptions than a rule that says "look up this value in a table I built from one example." The lookup table is more specific, which sounds like precision but is actually brittleness. It encodes the exact values it has seen and breaks on everything else.

A direct copy generalizes to all values. A composed string transform generalizes to all strings. A value map generalizes only to the values it has memorized. The cost model penalizes operations in proportion to how many assumptions they bake in.

## What the costs actually are

Every operation type has a base prior that reflects its structural complexity:

```
Direct copy:              1.05
Date format:              1.22
String case change:       1.35
String split:             1.40
Extract between markers:  1.42
Type coercion:            1.45
Numeric binary:           1.45
Numeric transform:        1.55
Template:                 1.58
Concatenation:            1.65
Array count:              1.65
Array map:                1.85
Constant:                 1.90
Array project:            2.15
Array find:               2.18
Value map:                2.25
```

The costs are not arbitrary. They encode a hierarchy of generalization. A direct copy is the most general: it works for any input value. A type coercion is slightly less general: it assumes the source value is convertible. A value map is the least general: it only works for values it has seen.

## How cost breaks ties

When two candidates both produce correct output for all examples, the engine picks the one with the lower cost. In most cases, the gap is clear. A direct copy always beats a value map.

The interesting cases are closer. Consider a field where the input is "2024-03-15T09:30:00" and the output is "2024-03-15". Two candidates match:

1. **Date format** (parse as date, output ISO date): cost 1.22.
2. **Split on "T", take first part**: cost 1.90.

Both produce the same result for any ISO timestamp. But the date format operation is cheaper because it understands the structure of the value rather than treating it as an arbitrary string. If the input were "2024-03-15 09:30:00" (with a space instead of "T"), the date formatter would still work. The string split would not.

The cost model does not know this explicitly. It just knows that date formatting is a more constrained, well-understood operation, so it gets a lower cost. The side effect is that it also happens to be more robust.

## Dynamic cost adjustments

Some costs are adjusted based on context. These adjustments are capped to one prior step, so they can break ties inside a structural family without letting a hint overturn the operation hierarchy. The value map operation gets small penalties or bonuses depending on how related the source and target field names are:

A source field named `status` mapping to a target named `label` gets a bonus (they are semantically related). A source field named `id` mapping to a target named `category` gets a penalty (ID fields are unlikely to be categorical lookup sources). A source whose name shares no tokens or trigrams with the target gets a small penalty unless it is a known categorical pairing such as `tier` to `plan`.

These adjustments are not machine-learned. They are documented, bounded heuristics based on common patterns in API payloads. The effect is that the engine prefers value maps when the field names suggest a categorical relationship and avoids them when the names suggest the mapping is coincidental.

## What happens with genuine ambiguity

Sometimes two candidates have costs close enough that the engine cannot confidently prefer one. The engine defines "close enough" in prior-step units. When this happens, it reports both candidates as an ambiguity.

But not all ambiguities are equal. The engine classifies each one:

**Equivalent:** the two rules behave identically for all practical inputs. A concatenation and a template that produce the same string are equivalent. The engine picks one and notes the other, but does not ask you for clarification.

**Weak:** one rule is simpler by a meaningful margin (0.25 or more in cost), but both fit the examples. The engine picks the simpler one and notes the alternative without flagging it as a problem.

**Meaningful:** both rules are genuinely plausible and would produce different output on unseen inputs. The engine reports this as an ambiguity that needs resolution and suggests what kind of example would disambiguate. This is the only case where you are asked to add another example.

**Resolved by new input:** one candidate would trigger a runtime warning on the current new input (like an unseen value), while the other would not. The engine picks the warning-free candidate and notes that the ambiguity was resolved by the specific input you provided.

## Why the engine does not use machine learning for this

A machine learning model could learn cost weights from a dataset of transformations. The engine does not do this because the cost model needs to be inspectable and predictable.

If a user asks "why did you pick this rule over that one?", the answer needs to be "because it costs 1.05 and the alternative costs 2.25, and here is what each cost means." Not "because a model trained on 10,000 examples assigned a higher probability to this one."

The fixed cost model also means the engine behaves the same way every time. Same examples, same costs, same selection. If you add an example and the selection changes, you can trace exactly why: the new example invalidated a candidate, or it disambiguated two candidates by changing their validation status.

Determinism is the product. The moment the engine starts guessing, it stops being useful for the kind of work it is designed for: transformations you need to trust.

[Open Latentmachine →](/infer)
