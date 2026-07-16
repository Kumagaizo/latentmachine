---
title: "The Tool That Refuses to Guess"
description: "Most data transformation tools optimize for producing output. Latentmachine optimizes for telling you when it should not. Here is why a tool that refuses to guess is more useful than one that always has an answer."
date: "2026-05-19"
---

Every tool you use for data transformation has the same instinct: produce output. Give it input, get output. The faster, the better. If something is unclear, make a reasonable assumption and keep going. If something is ambiguous, pick the most likely interpretation. If something is contradictory, pick one and hope.

This instinct is useful right up until it is not.

A Stripe webhook payload with a new event type arrives, and your transformation silently maps it to null because nobody taught the function what "payment_intent.requires_action" should become. A CMS export with a new author role flows through the pipeline, and the status field gets a default value that makes no sense for that role. An API response drops a nested field, and the transformation throws at 2am on a Saturday.

These are not dramatic failures. They are quiet ones. The output looks plausible. It passes a spot check. It enters the database. Somebody notices three weeks later, or nobody notices at all.

Latentmachine was designed around a different instinct: when something is unclear, stop and say so.

## What "refuse to guess" looks like

When you show Latentmachine two examples of a JSON transformation, the engine does not just infer a rule and produce output. It runs a diagnosis pass that asks five specific questions:

**Do the examples agree with each other?** If one example maps `status: "admin"` to `access: "full"` and another maps `status: "admin"` to `access: "limited"`, the engine does not pick one. It reports a contradiction, identifies the exact field and examples that disagree, and stops.

**Is there only one plausible rule?** If two different rules both produce correct output for all examples, the engine reports both. It classifies the ambiguity: is it meaningful (the rules would behave differently on new data), weak (one is clearly simpler), or equivalent (they do the same thing)? For meaningful ambiguities, it tells you what kind of example would separate the two interpretations.

**Has the new input been covered by examples?** If the inferred rule includes a value map and the new input contains a value not seen in any example, the engine marks that field as unresolved. It does not guess what "viewer" should map to just because it knows what "admin" and "editor" map to.

**Are the required fields present?** If the rule depends on `$.account.metadata.region` and the new input has no `metadata` field at all, the engine flags it. It names the missing field and the operation that depends on it.

**Is one example enough?** If you provided a single example, the engine may find multiple rules that fit. It marks the result as "insufficient" and asks for a second example with different values.

Every one of these checks can prevent a silent failure downstream. And every one of them means the engine sometimes produces no output, or output with explicit warnings, instead of clean-looking results that happen to be wrong.

## Why this matters more than it sounds

The value of a data transformation is not in the first run. It is in the hundredth run. The first run, you are watching. You check the output. You catch mistakes. The hundredth run, you are not watching. The transformation is buried in a workflow, a cron job, a webhook handler. It runs on data you have never seen, and you assume it works because it worked last time.

Silent failures compound. A transformation that maps an unseen value to null does not crash. It inserts null into the database. The next system reads null and applies its own default. The default propagates through three more services. By the time someone notices, the root cause is five steps back and three weeks old.

A tool that refuses to guess catches this at the source. The unseen value triggers a guardrail at transformation time, not at debugging time. The missing field triggers a warning before the output enters the pipeline, not after.

## The diagnosis as a conversation

The diagnosis system is not an error report. It is a conversation. When the engine says "ambiguous," it also says "add an example where $.status and $.role have different values." When it says "contradictory," it identifies the specific examples that disagree. When it says "insufficient," it explains that one example cannot prove the rule generalizes.

Each diagnosis comes with a specific next step. Not "something went wrong" but "here is what I still need to learn, and here is the cheapest way to teach me."

This changes how you use the tool. Instead of paste-and-pray, it becomes iterative. You show two examples. The engine says "safe" or it says "I need one more example where this specific field varies." You add the example. The engine updates. Two or three rounds, and you have a rule that the engine is willing to stand behind.

## What other tools do instead

An LLM asked to write a transformation function will always write one. It does not say "your requirements are ambiguous, here are two interpretations, which do you mean?" It picks one and writes confident code. If you ask it to handle an edge case it did not consider, it says "good catch!" and writes a new version. It never preemptively tells you what could go wrong.

A visual field mapper draws lines between source and target fields. If you connect a field that might be absent in some records, the mapper does not warn you. It draws the line. If the value needs a type conversion that could fail, the mapper does not flag it. It connects the fields.

A hand-written transformation function does whatever you tell it to. If you forget to handle a missing field, it throws. If you forget to handle an unseen value, it returns undefined. The function does not know what it does not know.

Latentmachine knows what it does not know. It tracks which input values it has seen, which fields it depends on, which rules it considered and rejected, and which ambiguities remain unresolved. And it tells you all of this before you use the rule.

## The trust contract

There is a product contract behind Latentmachine that makes this explicit:

*Never silently guess when examples are ambiguous.*
*Never produce output without an evidence assessment.*
*Never hide the symbolic program from the user.*
*Never claim support for transformations that cannot be verified against examples.*

This is not a mission statement. It is an engineering constraint. The diagnosis system is not optional. It runs on every inference. The confidence assessment is not a nice-to-have. It is part of the output structure. The symbolic program is not hidden behind a "show details" toggle. It is the primary result.

The output you copy into your codebase is a side effect. The product is the diagnosis: knowing whether the rule is safe, what it assumes, and what would break it.

## When you do not need this

If you are doing a one-off transformation on a small dataset and you can manually verify the output, you do not need a diagnosis system. Paste the data, check the result, move on.

If the transformation is trivial (rename three fields, no type changes, no arrays), the engine will mark it as safe with a supported or proven confidence label and you will never see a warning. The diagnosis exists but stays out of your way.

The diagnosis earns its value when the transformation runs unattended. When it processes data you have not seen. When it encounters values, structures, or edge cases that were not in your examples. In those moments, the difference between a tool that guesses and a tool that refuses is the difference between a silent failure and a caught one.

Latentmachine would rather give you a warning you ignore than an output you should not trust.

[Open Latentmachine →](/infer)
