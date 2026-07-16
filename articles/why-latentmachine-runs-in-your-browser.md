---
title: "Why Latentmachine Runs Entirely in Your Browser"
description: "Latentmachine processes all data client-side with zero server calls. Here is why that matters for sensitive payloads, and how the architecture works."
date: "2026-05-19"
---

When you paste a Stripe webhook payload into a transformation tool, that payload contains customer IDs, payment amounts, and metadata. When you paste a CRM export, it contains names, emails, and account details. When you paste an internal API response, it may contain data you are contractually obligated to keep off third-party servers.

Latentmachine never sees your data. The entire transformation engine runs in the browser. No server calls, no telemetry, no analytics, no accounts. This is not a privacy policy promise. It is an architectural constraint.

## How it works

Latentmachine is a static site served from Vercel. The HTML, CSS, and JavaScript files are delivered to your browser, and after that, nothing goes back during use. The transformation engine, the diagnosis system, and the export generators run in your browser's JavaScript runtime.

There is no backend API. There is no database. There is no session. The URL does not change when you paste data, so nothing sensitive ends up in server logs or browser history parameters.

The inference engine is written in plain JavaScript. The only parser dependency used at runtime is a vendored copy of the YAML library, which is a frozen file shipped with the tool, not fetched from a CDN or package registry. There are no analytics scripts, no tracking pixels, no third-party imports. You can verify this yourself by opening the Network tab in your browser's developer tools while using the tool: you will see the initial page load and nothing else.

## What this means in practice

You can paste production data. Real API keys in metadata fields. Real customer records. Real financial payloads. None of it leaves your machine.

If the page is already loaded, you can disconnect from the internet and keep using inference, diagnosis, and exports in that tab. For repeat offline use, save or mirror the static assets deliberately; the product does not rely on a backend, but normal browser caching is still browser-dependent.

You can inspect the network tab in your browser's developer tools while using the tool. You will see the initial page load and nothing else. No fetch calls, no WebSocket connections, no image beacons.

## Why not use an LLM instead

Language models are excellent at writing transformation code from a description or a couple of examples. For many use cases, they are the faster option. But they require sending your data to a remote server for processing.

If you are reshaping a public dataset or a sample payload with fake values, this is fine. If you are reshaping a production webhook payload with real customer data, PII, or access tokens, it is a different conversation. Depending on your industry, your compliance requirements, or your company's data handling policy, sending that payload to a third-party API may not be an option.

Latentmachine sidesteps this entirely. The tradeoff is that it can only infer transformations from structural patterns in your examples. It cannot understand natural language instructions, look up external documentation, or apply arbitrary business logic. But for the class of problems it handles, the result is deterministic, inspectable, and private by default.

## Performance without a server

Because the engine runs locally, inference speed depends on your device rather than network latency or API rate limits. Typical inference completes in milliseconds, and complex compositions with multiple array operations or string transforms remain bounded by the local candidate search. There is no queue, no cold start, and no token budget.

The benchmark and acceptance suite validates the engine across unit operations, cross-format translation, real-world scenarios, adversarial edge cases, export correctness, CLI behavior, presets, and performance budgets. You can run it yourself from the developer build to verify that the engine behaves as documented.

## A note on exports

When you export a transformation as JavaScript, n8n code, Make.com code, or a standalone CLI file, the generated artifact is created in your browser. It is not uploaded, stored, or logged anywhere. The same applies to the copied rule program and transformed output.

If you want to save a rule for later, you copy it. If you want to share it with a teammate, you send it however you normally send code. Latentmachine does not manage storage, sharing, or collaboration. That is your workflow, not the tool's.

[Open Latentmachine →](/infer)
