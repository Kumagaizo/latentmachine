---
title: "What Is Programming by Example (and Why It Keeps Coming Back)"
description: "Latentmachine belongs to a field called Programming by Example that has existed since the 1970s. This article explains the idea, traces the lineage from early research through Flash Fill to ARC, and shows where Latentmachine fits."
date: "2026-05-19"
---

The idea behind Latentmachine is not new. It has a name, a history, and a research community that has been working on it for over fifty years. The field is called Programming by Example, and if you have ever used Flash Fill in Excel, you have already used a product built on it.

This article traces the lineage. Not as a history lesson, but because understanding where the idea comes from makes it clearer what Latentmachine can and cannot do, and why it works the way it does.

## The core idea

Programming by Example (PBE) is a simple premise: instead of writing a program, you show examples of what the program should do, and the system figures out the program for you.

You do not describe the transformation in words. You do not write pseudocode. You do not specify operations. You show input-output pairs, and the system infers the rule that connects them.

This is fundamentally different from how most software works. A typical tool asks: "What do you want to do?" PBE asks: "What does the result look like?" The distinction matters because people often know what they want but struggle to express it as instructions. Showing is easier than telling.

## The 1970s: where it started

The earliest PBE research dates to the mid-1970s. Researchers explored whether systems could infer simple programs (sorting routines, string manipulations, arithmetic sequences) from input-output traces. The work was theoretical and limited by the hardware of the era, but it established the core framework: generate candidate programs, test them against examples, prefer the simplest one that fits.

Two ideas from this period survived into every modern PBE system, including Latentmachine:

**The search space must be bounded.** You cannot search over all possible programs. The system needs a defined vocabulary of operations (what it knows how to do) and a grammar (how operations can be combined). The richer the vocabulary, the more transformations it can learn, but the slower the search.

**Simplicity is a proxy for correctness.** When multiple programs fit the same examples, the shortest one is most likely to be right. This is Occam's razor formalized as a search heuristic. It was later grounded in information theory as the Minimum Description Length principle, which gives it a mathematical basis rather than just an intuition.

## Flash Fill: the breakthrough product

In 2011, Sumit Gulwani at Microsoft Research published a paper on a system that could infer string transformations from examples. The system watched what you typed in a spreadsheet column, figured out the pattern, and filled in the rest. Microsoft shipped it as Flash Fill in Excel 2013.

Flash Fill brought PBE to hundreds of millions of users who had never heard the term. You type "John" in column B next to "John Smith" in column A, and Excel fills in the first names for the entire column. You type "2024-03-15" next to "March 15, 2024" and it reformats every date.

The research behind Flash Fill established several principles that Latentmachine inherits:

**Domain-specific languages (DSLs) beat general-purpose search.** Flash Fill does not search over all possible programs. It searches over a specific language of string operations: concatenation, substring extraction, case changes, constant insertions. This makes the search tractable. Latentmachine does the same for structured data: it searches over a bounded vocabulary of operations, not over arbitrary JavaScript.

**Two examples are dramatically better than one.** With one example, many programs fit. With two examples that have different values, most coincidences are eliminated. Flash Fill learned this empirically. Latentmachine encodes it in the confidence model: one example fails the two-example evidence check and may trigger an "insufficient" diagnosis.

**Users do not need to understand the inferred program.** Flash Fill shows the result, not the rule. Most users never see the underlying program. Latentmachine takes a different approach here: it always shows the symbolic rule, because data transformations often run in automated pipelines where inspectability matters more than in a spreadsheet.

## ARC: the reasoning benchmark

In 2019, Francois Chollet (creator of Keras) published the Abstraction and Reasoning Corpus. ARC is a collection of visual grid puzzles where each task has a different rule, and the system must figure out the rule from a few examples.

ARC is not a PBE system in the product sense. It is a benchmark designed to test a specific hypothesis: that real intelligence requires the ability to learn new rules from small amounts of data, without relying on large training sets or pretrained knowledge. This hypothesis directly challenges the dominant paradigm in machine learning, where performance comes from scale (more data, more parameters, more compute).

ARC matters to Latentmachine's story because it formalized three ideas that became design principles:

**No pretraining.** An ARC solver cannot memorize solutions. Each puzzle is unique. The system must reason from the examples provided, using only general-purpose primitives. Latentmachine follows this principle: the engine has no training data, no learned weights, no prior knowledge of specific APIs or payload formats. It infers every rule from scratch.

**Validation must be exact.** In ARC, a hypothesis is valid only if it reproduces the output grid pixel by pixel for every training example. "Close enough" is not enough. Latentmachine applies the same standard: a candidate operation must produce the exact output value for every example. One mismatch and the candidate is discarded.

**Failure should be informative.** ARC research highlighted that knowing *why* a solver fails is as valuable as knowing when it succeeds. The failure mode reveals what the system is missing. Latentmachine's diagnosis system, which classifies failures as contradictions, ambiguities, or insufficient examples and suggests specific remedies, was directly inspired by this insight.

Latentmachine started as an experiment building an ARC solver. The grid-domain engine still exists in the codebase as a research prototype. The data transformation engine was built after, using the reasoning model and design principles that emerged from that experiment.

## Minimum Description Length: the theoretical backbone

Across the PBE lineage, one principle appears everywhere: when multiple programs fit the same examples, prefer the shortest one. This is not just a heuristic. It has a theoretical foundation in information theory.

Minimum Description Length (MDL) says: the best model for a dataset is the one that compresses the data most efficiently. A model that says "copy this field" compresses every possible input into one rule. A model that says "look up this value in a table of three entries" only compresses three specific inputs. The copy rule is shorter, so MDL prefers it.

In Latentmachine, MDL is implemented as the cost model. Each operation type has a cost prior that reflects its description length. A direct field copy is cheap (very short description: "copy path A to path B"). A value map is expensive (longer description: "if value is X, output Y; if value is Z, output W; otherwise unknown"). When two operations both fit the examples, the engine picks the one with the lower cost, which is the one with the shorter description, which is the one that generalizes better.

This is not a coincidence. It is a mathematical relationship. Shorter descriptions make fewer assumptions. Fewer assumptions mean fewer ways to be wrong on unseen data. MDL formalizes the intuition that simplicity and generalization are the same thing.

## Where Latentmachine fits

Latentmachine is a PBE system for structured data transformations across JSON, CSV, YAML, TOML, XML, and .env. It sits in a specific spot in the landscape:

It is narrower than Flash Fill in some ways (Flash Fill handles arbitrary string patterns; Latentmachine handles structured data with typed operations) and broader in others (Flash Fill operates within a single column; Latentmachine handles nested objects, arrays, cross-field operations, type conversions, and cross-format translation).

It is more practical than ARC solvers (which target abstract reasoning puzzles) but shares their insistence on exact validation, informative failure, and no pretraining.

It is more inspectable than LLM-based approaches (which produce code but cannot explain why they chose one transformation over another) but less flexible (it cannot handle natural language instructions or arbitrary business logic).

The design choices are inherited, not invented. The bounded search space comes from the 1970s PBE research. The domain-specific operation vocabulary comes from Flash Fill. The exact validation and informative failure come from ARC. The cost model comes from MDL theory. The zero-pretraining constraint comes from both ARC and a practical privacy requirement (no server calls means no pretrained model on the server).

## Why it keeps coming back

PBE has been rediscovered roughly once per decade since the 1970s. Each time, the implementation changes (better hardware, new programming languages, different application domains), but the core idea stays the same: showing is easier than telling.

It keeps coming back because the problem it solves is permanent. People will always need to transform data from one shape into another. Most of those transformations are structural and repetitive. Writing code for them is tedious. Describing them in natural language is imprecise. Showing examples is fast and unambiguous.

The LLM era has not made PBE obsolete. If anything, it has clarified where PBE is the better tool. When you need determinism (the same rule every time), inspectability (see the symbolic program, not just the output), privacy (no data sent to a server), and honest failure (know when the rule is ambiguous or insufficient), a PBE system provides guarantees that a language model cannot.

Latentmachine is a PBE system. It belongs to a lineage that started half a century ago and keeps finding new applications. The structured data transformation engine is the latest one.

[Open Latentmachine →](/infer)
