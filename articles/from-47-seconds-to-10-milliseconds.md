---
title: "From 47 Seconds to 10 Milliseconds: How We Fixed the Inference Engine"
description: "Latentmachine's rule inference engine timed out on payloads with more than 10 fields. The fix was not caching, parallelism, or a faster language. It was asking a better question before doing expensive work."
date: "2026-05-21"
---

The engine worked beautifully on small payloads. Five fields, instant. Seven fields, under a second. Then someone would paste a real Stripe webhook — 15 fields, deeply nested — and the browser would freeze.

This is the story of what went wrong and how we fixed it. The fix was not what you would expect.

## The symptom

We tested the engine on payloads of increasing width — the same simple transformation (rename every field) with 5, 8, 10, 15, and 20 fields:

```
5 fields:   885ms
8 fields:   12,465ms
10 fields:  47,488ms
12 fields:  never finished
```

That is exponential growth. The engine was doing something combinatorial that scaled with the number of fields. For a tool that promises to handle real-world data, this was a critical failure — real payloads routinely have 15 to 30 fields.

## The root cause

The engine generates candidate operations for each output field. For simple operations like direct mapping ("this input field equals this output field"), the work is linear: check each source field once. But for template inference ("this output string is built from fragments of multiple input fields"), the work is combinatorial.

The template generator tries every permutation of source fields at lengths 1 through 4, and for each permutation, it tries multiple string transformation modes (identity, lowercase, uppercase, title case). For N source fields, that means:

```
Length 1: N × M candidates
Length 2: N × (N-1) × M² candidates
Length 3: N × (N-1) × (N-2) × M³ candidates
Length 4: N × (N-1) × (N-2) × (N-3) × M⁴ candidates
```

Where M is the number of string modes (up to 5 for string fields).

For 20 string fields at length 4 with 5 modes: 20 × 19 × 18 × 17 × 5⁴ = over 72 million candidates. Per output field. Times 20 output fields. That is over a billion candidates for a 20-field rename — a transformation that should take microseconds.

## Why this happened

The template generator was correct. It was designed to find string templates that combine multiple source fields with literal separators — transformations like `"Ana Lopez"` built from `$.first` + `" "` + `$.last`. For that use case, trying permutations is necessary because the source fields could appear in any order in the template.

The problem was that the template generator ran on every output field, even fields that had already been explained by a cheaper operation. A simple rename (`$.first_name` → `$.firstName`) was resolved instantly by the direct mapping generator, but the template generator still explored all 72 million permutations looking for a template explanation of the same field. It did not know that a simpler answer already existed.

## The fix: three ideas, one principle

The principle: do not do expensive work when cheap work has already answered the question.

### Idea 1: Short-circuit on cheap candidates

Before running any expensive generator, the engine now checks: did a direct mapping or type coercion already explain this field? If yes, skip all template, concatenation, and value map generation for that field entirely.

```
For each output field:
  1. Try direct mapping (cheap structural prior)
  2. Try type coercion (cheap structural prior)
  3. If either matched → skip expensive generators, move to next field
  4. If neither matched → proceed with full candidate generation
```

For a 20-field rename, this means all 20 fields are resolved at step 2 and the template generator never runs. The total work is 20 fields × ~20 source checks = ~400 operations, not 20 fields × 72 million permutations.

### Idea 2: Filter sources by relevance

When the expensive generators do run (because no cheap candidate was found), the engine now pre-filters source fields by value relevance. A source field is only considered for template generation if its value actually appears somewhere in the target value — as a substring, after case transformation, or as a string representation.

For a target value of `"Ana Lopez"`, only source fields whose values include `"Ana"`, `"Lopez"`, `"ana"`, `"lopez"`, or similar are considered. The field `$.age` with value `28` is excluded because `"28"` does not appear in `"Ana Lopez"`.

This typically reduces the source set from 20 fields to 2-4 relevant fields. Permutations of 4 fields are thousands, not millions.

### Idea 3: Cap and prioritize

Even with relevance filtering, the engine caps the source set for template generation at 8 fields. Beyond that, the permutation space is too large for any practical benefit. The cap prioritizes sources by their relevance score — how often and how completely their values appear in the target values across examples.

The mode combinations were also reduced. Instead of trying all 5 string modes for every source, the engine now only tries modes that could plausibly help: lowercase if the target contains lowercase text that the source does not, uppercase if the target is all caps, and so on. For most fields, this reduces the mode set from 5 to 1-2.

## The result

After the fix:

```
5 fields:   9ms
10 fields:  10ms
15 fields:  20ms
20 fields:  20ms
30 fields:  72ms
```

The 10-field case went from 47,488ms to 10ms — a 4,749x improvement. The 20-field case went from infinite to 20ms. The 30-field case, which was previously impossible, completes in 72ms.

The engine now handles payloads with 30+ fields comfortably in the benchmark that exposed the issue. Real-world data from Stripe, Shopify, HubSpot, and Airtable, which typically has many nested fields but only a smaller set of relevant paths for a given transform, now stays in the milliseconds range on modern machines.

## What did not change

The fix did not change the scoring system. The fix did not change which candidates are selected. The fix did not reduce the operation type coverage. The fix did not add caching, parallelism, Web Workers, or WebAssembly.

Every transformation that worked before still produces the same output. The current benchmark and acceptance suite still passes. The diagnosis still catches contradictions, ambiguities, and unseen values. The engine still refuses to guess.

The only thing that changed is which candidates are *generated*. The engine now asks "is there already a simple answer?" before asking "what are all possible answers?" That single question — asked at the right moment — eliminated billions of unnecessary computations.

## The lesson

Performance problems in program synthesis engines are rarely about slow execution. They are about unnecessary generation. The engine was not slow at evaluating candidates. It was generating candidates that could never be selected — templates for fields that were already explained by direct mappings, permutations of irrelevant source fields, mode combinations that could never match.

The fix was not a faster algorithm. It was a better question: do I already know the answer?

This is the same principle that guides the engine's entire design. Prefer simple explanations. Do cheap work first. Only do expensive work when cheap work fails. Score by simplicity. Refuse to guess. Each of these rules exists because the alternative — exhaustive generation, uniform scoring, silent guessing — leads to the same place: a system that does enormous amounts of work to produce output that is no better than the simple answer it could have found in milliseconds.

[Open Latentmachine →](/infer)
