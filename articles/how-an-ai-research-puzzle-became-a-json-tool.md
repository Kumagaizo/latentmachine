---
title: "How an AI Research Puzzle Became a JSON Transformation Tool"
description: "Latentmachine started as an experiment with ARC, a reasoning benchmark from AI research. The core idea: figure out rules from examples, not training data. This article explains the origin, what transferred, and why it matters for a tool that reshapes your data."
date: "2026-05-19"
---

Latentmachine did not start as a data transformation tool. It started as an experiment with colored grid puzzles.

There is a benchmark in AI research called ARC, the Abstraction and Reasoning Corpus, created by Francois Chollet. It poses a simple challenge: here are a few pairs of small colored grids, input and output. Figure out the rule. Apply it to a grid you have never seen.

The puzzles look like something from a children's logic book. A grid gets rotated. A shape gets flipped. The smallest object disappears. A line connects two shapes. But ARC was designed to be hard for machines, because every puzzle has a different rule. You cannot memorize your way through it. You have to reason from the examples, every time, from scratch.

Working on an engine that solves these puzzles is what led to Latentmachine. Not because grids and JSON have anything in common on the surface, but because the reasoning process turned out to be the same.

## The idea that transferred

An ARC puzzle works like this:

You see that a 3x3 grid with a shape in the top-left corner becomes a 3x3 grid with the shape in the top-right corner. You see a second example where a different shape moves from top-left to top-right. You infer the rule: flip horizontally. You apply that rule to a new grid.

A JSON transformation works like this:

You see that `{ "user": { "first": "Ana", "last": "Lopez" } }` becomes `{ "name": "Ana Lopez" }`. You see a second example with different names. You infer the rule: concatenate first and last with a space. You apply that rule to new data.

The domain is different. The data structures are different. The operations are different. But the reasoning steps are identical:

1. Look at the examples.
2. Notice what changed between input and output.
3. Generate hypotheses for what rule could explain the change.
4. Check each hypothesis against all examples.
5. Keep only the ones that produce exact matches.
6. Pick the simplest.

This is the idea that transferred from ARC experimentation to Latentmachine. Not code, not grid operations, not object detection algorithms. The reasoning model itself.

## What "simplest" means (and why it matters)

One of the key learnings from working on ARC puzzles is that multiple rules often fit the same examples. A grid where every color 1 becomes color 3 could be explained by "swap 1 and 3" or by "replace all non-background colors with 3" or by "apply this specific lookup table." All three produce correct output for the training examples. But they predict different things for a new grid.

The solution, both in ARC and in Latentmachine, is to prefer the simplest rule. In information theory this is called Minimum Description Length: among all programs that fit the evidence, the shortest one is most likely to be correct.

For ARC, this meant scoring hypotheses by complexity. A rotation (one operation) beats a sequence of pixel-level swaps (many operations) even when both produce the same output. For Latentmachine, this became the cost model: a direct field copy beats a value map when both explain the examples. The cheaper rule makes fewer assumptions, which means it is more likely to work on data you have not seen yet.

This was not an obvious design choice. It was a lesson from watching the ARC engine pick overfit rules when the scoring was wrong, and seeing them fail on the test grid. That experience is why Latentmachine's cost model exists and why it is tuned the way it is.

## What "honest failure" means (and where it came from)

The second big lesson from ARC: sometimes the engine cannot solve the puzzle. And when it cannot, the worst thing it can do is pretend it can.

Early versions of the ARC engine would pick the best partial match and present it as a result. The output looked plausible. It was wrong. It was worse than no answer at all, because it looked like it might be right.

The fix was a failure classifier. When the engine cannot find a rule that exactly fits all training examples, it stops and explains what it observed: objects were added, the grid changed size, relationships between shapes suggest a rule the engine does not know yet. Specific observations, not vague error messages.

This became the diagnosis system in Latentmachine. When the JSON engine detects contradictory examples, it reports which examples disagree and on which field. When it finds ambiguous rules, it reports both interpretations and suggests what example would disambiguate. When a value appears that was not in any example, it flags it instead of guessing.

The refusal to guess is the single most important thing that transferred from ARC to Latentmachine. It is the difference between a tool that produces output and a tool you can trust.

## What "validate against all examples" means

In ARC, a hypothesis is only valid if it produces the exact correct output grid for every training pair. Not most of them. All of them. One wrong pixel and the hypothesis is discarded.

This strictness felt aggressive at first. Many "almost right" hypotheses get thrown away. But the strictness is what makes the surviving hypotheses trustworthy. If a rule produces exact output for three different input-output pairs, each with different values, the probability that it is a coincidence drops sharply.

Latentmachine applies the same standard. A candidate operation for a JSON field is only valid if it produces the correct output value for every example. One mismatch and it is discarded. This is why adding a second example matters so much: it eliminates candidates that matched the first example by coincidence.

## What did not transfer

The actual operations are completely unrelated. ARC has rotations, flips, flood fills, gravity, object detection, shape matching, spatial relationships, and beam search over multi-step compositions. Latentmachine has field mapping, string concatenation, type coercion, date formatting, array projection, and value maps.

The ARC engine's perception system, which finds connected colored regions and builds a spatial relationship graph, has no equivalent in the JSON engine. JSON has structure (nested keys, arrays, types) but not spatial layout.

The ARC engine's beam search, which combines operations into sequences up to depth 2, does not exist in the JSON engine. JSON transformations are flat: one operation per output field. The ARC engine needs composition because grid rules often chain operations. JSON rarely does.

None of the ARC engine's 1,500 lines of grid logic are used by the JSON tool. The two engines are independent. What transferred was the architecture and the lessons, not the implementation.

## Why this matters for you

You do not need to know any of this to use Latentmachine. Paste your JSON, show the output you need, export the rule.

But if you have ever wondered why the tool behaves the way it does, why it insists on exact matches, why it picks the simplest rule, why it refuses to guess, why it tells you specifically what is ambiguous and what would fix it, the answer is: because an engine that solves colored grid puzzles taught those lessons first.

The JSON tool is the practical application. The ARC experiment is where the thinking came from.

[Open Latentmachine →](/infer)
