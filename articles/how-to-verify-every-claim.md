---
title: "How to Verify Every Claim This Tool Makes"
description: "Latentmachine claims zero server calls, deterministic inference, and honest diagnosis. Every one of these claims is verifiable in your browser without access to the source code repository. Here is how to check them yourself."
date: "2026-05-19"
---

Latentmachine makes several claims: it sends no data to any server, the inference is deterministic, the diagnosis catches contradictions and ambiguity, the exported code matches the inferred rule, and typical inference runs in milliseconds.

These are not things you need to take on faith. Every claim is testable in your browser, right now, without signing up for anything, installing anything, or having access to the source code repository. This article walks through each verification step.

## Verify: no data leaves your browser

Open [Latentmachine](/infer). Before you paste anything, open your browser's developer tools (F12 or Cmd+Option+I on Mac) and switch to the **Network** tab. Clear the log.

Now paste a JSON example, add an output, and run the transformation. Watch the Network tab.

You will see nothing. No fetch calls, no XHR requests, no WebSocket connections, no image beacons, no analytics pings. The page loaded its static files when you first visited. After that, the connection to the server is over.

If you want to be thorough, right-click in the Network tab, enable "Preserve log", and use the tool for five minutes. Paste production data, export rules, switch between samples. The log will show the initial page load and nothing else.

You can take this further. Disconnect from the internet after the page loads. The already-loaded tab keeps working: inference, diagnosis, and export all run locally. There is no server to call during use.

## Verify: the engine code is readable

Latentmachine ships its JavaScript unminified and unbundled. The full source code of the inference engine is served to your browser as plain, human-readable files.

Open developer tools and switch to the **Sources** tab (Chrome/Edge) or **Debugger** tab (Firefox). Navigate the file tree. You will find the engine code under `src/intelligence/`. The JSON transformation engine, the diagnosis system, the export generators, the cost model, the benchmark suite: all of it is there, in readable JavaScript, with meaningful variable names and function names.

This means you do not need access to a GitHub repository to read the code. Your browser already has it. You can search for specific functions, set breakpoints, and step through the inference pipeline as it runs on your data.

If you want to understand how a specific operation was inferred, set a breakpoint in the candidate generation function and watch it evaluate each operation type against your examples. The code is not obfuscated. It reads like the engine described in the other articles on this site, because it is the same code.

## Verify: inference is deterministic

Paste two examples into Latentmachine and note the inferred rule, the confidence label, the evidence checks, and the diagnosis status. Now refresh the page, paste the exact same examples, and check again.

The rule will be identical. The confidence assessment will be identical. The diagnosis will be identical. The exported code will be identical, character for character.

Do this ten times if you want. The result never varies. There is no randomness in the pipeline, no model sampling, no temperature parameter. The engine is a deterministic function: same input, same output, every time.

This is verifiable because it is structural. The engine generates candidates, validates them against examples, scores them by cost, and picks the cheapest valid candidate. The rule-selection path has no model sampling, random tie-breaking, or external API calls that could introduce variation. The UI may use timestamps or random suffixes for element/session IDs, but those values do not decide which rule is inferred.

## Verify: contradictions are caught

Create two examples that disagree. For instance:

Example 1 input: `{ "role": "admin" }`, output: `{ "access": "full" }`
Example 2 input: `{ "role": "admin" }`, output: `{ "access": "limited" }`

Both examples map the same input value ("admin") to different outputs ("full" vs "limited"). The engine should catch this.

Check the diagnosis. It will report a contradiction on the `access` field, identify both examples, and show the conflicting values. The status will be "contradictory." The engine will not silently pick one and ignore the other.

Now fix the contradiction. Change example 2 so the input role is "editor" instead of "admin." Re-run. The contradiction disappears and the engine infers a value map. This confirms the detection is not a false positive: it responds to the actual structure of your examples.

## Verify: ambiguity is reported

Create a single example where the input has `{ "status": "active" }` and the output has `{ "status": "active" }`. With only one example, multiple rules fit: a direct copy, a constant, a value map. The engine should flag this.

Check the diagnosis. Depending on the specific structure, it may report the status as "insufficient" (one example is not enough) or flag specific ambiguities between competing candidates. It will suggest adding a second example with a different value.

Now add a second example with `{ "status": "inactive" }` mapping to `{ "status": "inactive" }`. The ambiguity resolves. The engine identifies a direct copy (cheapest candidate) and the diagnosis changes to "safe." The constant and value map candidates are eliminated because the direct copy is cheaper and fits both examples.

## Verify: unseen values trigger guardrails

Create two examples with a value map. For instance:

Example 1: `{ "type": "a" }` maps to `{ "label": "Alpha" }`
Example 2: `{ "type": "b" }` maps to `{ "label": "Beta" }`

Now set the new input to `{ "type": "c" }`. The engine has learned a value map (a becomes Alpha, b becomes Beta), but it has never seen "c."

Check the output. The engine will not guess what "c" should map to. It will flag the field as unresolved and produce a runtime warning identifying the unseen value. The diagnosis will suggest adding an example that covers additional values.

This is the guardrail that prevents silent failures in production. A value map that encounters an unseen value does not produce null, does not pick the nearest match, and does not default to the first entry. It stops and tells you.

## Verify: the exported code matches the rule

Run a transformation and note the symbolic rule the engine displays. Then export the JavaScript. Read both.

The exported code should implement exactly the operations listed in the symbolic rule. If the rule shows `concat($.user.first, " ", $.user.last) → $.name`, the exported code should contain a concatenation of those two fields with a space separator, targeting `output.name`.

You can test this further. Copy the exported function into your browser console, call it with the same input you gave Latentmachine, and compare the output to what the tool displays. They will match.

If you want to be exhaustive, call the exported function with inputs that differ from your examples. The function should handle missing fields gracefully (returning undefined, not throwing) and should produce consistent results regardless of how many times you call it.

## Verify: performance claims

Open the developer tools **Performance** tab (or **Console** tab with timing). Run a transformation and note the time.

For a typical payload with 5-10 fields, inference completes in single-digit milliseconds. You can measure this more precisely by setting a breakpoint at the start of the synthesis function and another at the end, or by checking the trace output if the tool displays timing information.

The "milliseconds" claim refers to typical payloads. Complex compositions with array operations and multiple string transforms may take longer. The engine does not make network calls during inference, so the time you measure is local computation rather than server latency.

## What you cannot verify without the source repository

A few things are not verifiable from the browser alone:

The build process. You can see the shipped code in the Sources tab, but you cannot verify that the build script does not inject anything beyond what is in the source files. This requires trusting the build pipeline or reading the build script in the repository.

The benchmark suite. The benchmarks exist in the shipped code (you can find them in the Sources tab), but running them requires a development environment. You can read the test cases and assertions, but you cannot execute them from the production site.

Historical changes. You can see the current version of the code, but not its history, diffs, or commit messages. This requires a version control repository.

For everything else, the tool provides its own evidence. The network tab proves privacy. The Sources tab proves readability. Repeated runs prove determinism. Crafted examples prove the diagnosis system. The exported code proves consistency. Each claim has a corresponding test you can run yourself, in your browser, in under five minutes.

[Open Latentmachine →](/infer)
