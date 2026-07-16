---
title: "You Do Not Need to Write That Transformation Function"
description: "A calm but honest look at the time developers spend writing data transformation code that a rule engine could infer in milliseconds. Includes a self-assessment for when to write it yourself and when to let the machine figure it out."
date: "2026-05-19"
---

There is a function in your codebase right now that looks roughly like this:

```javascript
function transformPayload(input) {
  return {
    name: input.data.user.firstName + " " + input.data.user.lastName,
    email: input.data.user.contactEmail.toLowerCase(),
    plan: input.data.subscription.plan,
    active: input.data.subscription.status === "active",
  };
}
```

You wrote it six months ago. It took fifteen minutes. You tested it once. It has been running in production without issues. You will never think about it again.

Until the upstream API adds a field, changes the nesting, or renames `contactEmail` to `emailAddress`, and then you will spend fifteen minutes finding the function, fifteen minutes understanding what it does, and fifteen minutes updating it. Forty-five minutes for a function that has four lines of actual logic.

This is not a crisis. It is a paper cut. But paper cuts add up.

## The transformation tax

Every integration between two systems includes at least one transformation step. Webhook payloads need reshaping. API responses need flattening. CMS exports need cleanup. Database imports need type conversions. Each one is a small function that is easy to write, easy to test, and easy to forget about.

The cost is not in writing the function. It is in the lifecycle. Someone has to understand what the source payload looks like. Someone has to understand what the target expects. Someone has to write the mapping between the two. Someone has to test it with real data. And someone, eventually, has to update it when something changes.

For a single integration, this is twenty minutes. For a company with thirty integrations, it is a quiet, persistent tax on the engineering team that never shows up in a sprint retro because no individual instance is worth talking about.

## A quick self-assessment

Not every transformation function needs to be inferred by a machine. Here is a honest checklist:

**Write it yourself if:**
- The logic depends on external state (database lookups, feature flags, user roles at runtime)
- The transformation includes conditional branching that changes based on business rules
- You are doing something creative with the data, not just reshaping it
- You genuinely enjoy writing it (this is valid)

**Let the machine figure it out if:**
- You are renaming fields
- You are flattening nested objects
- You are converting types (string to number, "true" to boolean)
- You are concatenating or splitting strings
- You are filtering arrays by a field value
- You are reformatting dates
- You are lowercasing emails for the third time this quarter
- You are converting between formats (JSON to CSV, YAML to JSON, XML to .env)

If you read that second list and thought "that is literally what I did yesterday", then you are the person this tool was built for.

## What "let the machine figure it out" actually means

Latentmachine is a program synthesis engine. You give it two or three examples of a data transformation (before and after), and it infers the simplest deterministic rule that maps one to the other. The input can be JSON, CSV, YAML, TOML, XML, or .env — the engine handles all six formats and any cross-format combination.

It does not use a language model. It does not guess. It generates candidate operations for structural differences between input and output, validates each candidate against all examples, and selects the cheapest program that produces exact matches. For typical payloads, the process completes in milliseconds.

The result is a symbolic rule you can inspect:

```
$.data.user.firstName + " " + $.data.user.lastName → $.name
lower($.data.user.contactEmail) → $.email
$.data.subscription.plan → $.plan
$.data.subscription.status = "active" → $.active (value map)
```

Each operation is independently verifiable. You can see which source field feeds which target, what transformation is applied, and which examples support the inference.

## The part where it tells you when it is wrong

This is the part that matters more than the speed. When the engine infers a rule, it also runs a diagnosis. If your examples are ambiguous (two rules fit equally well), it tells you which fields are ambiguous and what kind of example would resolve it. If your examples contradict each other, it identifies the conflict. If the new input contains a value not seen in any example, it flags it instead of guessing.

Compare this to writing the function yourself. When you write `plan: input.data.subscription.plan`, you are implicitly assuming that `data.subscription.plan` will always exist. If it does not, the function throws at runtime. The machine-inferred version makes that assumption explicit as a precondition: `$.data.subscription.plan` is required, type is string, used by `$.plan`.

You already knew this. You just did not write it down because it felt like overkill for a four-line function. The engine writes it down for you because it does not know how to cut corners.

## The exported code is yours

The rule exports as dependency-free JavaScript, with dedicated formats for standalone code, n8n Code nodes, Make.com JavaScript modules, and standalone CLI tools. The generated snippets use optional chaining, nullish defaults, and a comment header documenting what the rule does.

It looks like code a careful developer would write. Because that is what program synthesis produces: the mechanical, correct, boring version of the function you would have written if you had unlimited patience and no other tasks.

## When this saves real time

The biggest time saving is not on the first write. It is on the rewrite. When the source payload changes, you paste the new shape, re-run the inference, and export. No reading the old code, no tracing which field was renamed, no second-guessing whether the type conversion is still correct.

For teams maintaining dozens of integrations, each with its own transformation layer, the compound effect is significant. Not because any individual function is hard, but because the lifecycle of each function is a recurring cost that scales with the number of integrations.

Or you can keep writing them by hand. That works too. Nobody is going to judge you. Well, the engine might, silently, in a few milliseconds.

[Open Latentmachine →](/infer)
