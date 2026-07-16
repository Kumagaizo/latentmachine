---
title: "Build a Regex by Showing Examples, Not Writing Syntax"
description: "Latentmachine's Regex Builder synthesizes a regular expression from match and reject examples. It verifies the pattern before showing it, explains each token in plain English, supports named captures, and refuses when your examples are ambiguous."
date: "2026-06-16"
---

You know what the pattern should match. You can point to five strings and say "these are valid" and three strings and say "these are not." What you cannot always do is translate that knowledge into `^(?:[A-Z]{2})-\d{4,6}$` on the first try.

The gap between knowing the pattern and writing the syntax is where most regex frustration lives. Not in the concept, but in the notation.

Latentmachine's Regex Builder closes that gap. You provide match examples and reject examples, and the engine synthesizes a verified regular expression. No syntax required.

## How it works

Open the [Regex Builder](/regex) and add strings that should match:

```
INV-2024-001
INV-2024-1337
INV-2025-42
```

Then add strings that should not match:

```
inv-2024-001
INV-24-001
INVOICE-2024-001
2024-001
```

The engine aligns your examples character by character, identifies which positions are literal and which vary, infers character classes and length ranges, and produces a pattern. For the examples above, something like:

```
^INV-\d{4}-\d{1,4}$
```

Before you see it, the engine verifies the pattern against every example you provided. If a match example does not match or a reject example still matches, the engine does not show you the pattern. It reports the failure.

## Verification is not optional

Every regex tool lets you test a pattern after you write it. The Regex Builder tests it before you see it. The distinction matters because it changes the workflow from "write, test, fix" to "demonstrate, verify, done."

If the engine cannot produce a single pattern that satisfies all your examples, it tells you what went wrong. A reject string that is identical to a match string triggers a contradiction. A reject string that cannot be excluded without also excluding a match string triggers a diagnostic that explains why.

The engine does not produce unverified patterns. Ever.

## Named captures

Suppose you need to extract parts of the match. Highlight a substring in one of your match examples and name it:

```
INV-2024-001
    ^^^^       → year
         ^^^   → number
```

The engine incorporates the capture groups into the pattern:

```
^INV-(?<year>\d{4})-(?<number>\d{1,4})$
```

The captures are part of the synthesis, not a manual edit applied after the fact. If the capture boundaries conflict with the inferred character classes, the engine adjusts and re-verifies.

## Ambiguity detection

If your match examples are all the same length, the engine does not know whether length is significant. It flags this as an ambiguity and suggests a concrete example to resolve it: "Add a too-short or too-long reject to pin down the boundary."

This is the same principle that drives the diagnosis system in Infer. The engine tracks what it knows, what it does not know, and what example would resolve the gap. It tells you the cheapest next step instead of guessing.

## Multi-flavor output

The synthesized pattern renders in four regex flavors: JavaScript, PCRE, Python, and Java. The differences are usually minor (named capture syntax varies between `(?<name>...)` and `(?P<name>...)`), but seeing the right flavor means you can paste directly into your codebase without translating.

## Plain-English explanation

Every segment of the pattern gets a human-readable explanation:

- "Anchor the pattern to the whole string."
- "Match literal `INV-`."
- "Match 4 digits."
- "Match literal `-`."
- "Match 1 to 4 digits."

If you are reviewing someone else's regex, or revisiting your own six months later, the explanation tells you what each part does without decoding the syntax.

## When this is the right tool

The Regex Builder handles structural patterns: strings with consistent delimiters, fixed prefixes or suffixes, character class segments that vary in value but not in kind. Invoice numbers, product codes, log line formats, date strings, email-adjacent patterns, phone formats, filenames with version numbers.

It handles these well because they are exactly the kind of pattern where examples are more expressive than descriptions. Saying "starts with two uppercase letters, then a dash, then four to six digits" is a specification. Showing five examples of that is faster and less ambiguous.

## When it is not

The Regex Builder does not handle patterns that require lookaheads, lookbehinds, backreferences, recursive patterns, or context-sensitive matching. If you need `(?<=\$)\d+\.\d{2}` (match digits that follow a dollar sign without capturing the sign), you need to write that yourself.

It also does not handle patterns where the match and reject examples do not contain enough information to infer character boundaries. If every example has exactly five characters and you do not tell the engine whether length matters, it will ask, but it cannot read your mind.

For the structural, delimiter-based patterns that make up the majority of regex tasks in integration work, it is faster than writing the syntax and safer than hoping you got the quantifiers right.

[Open Regex Builder →](/regex)
