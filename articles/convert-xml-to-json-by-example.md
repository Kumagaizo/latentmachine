---
title: "Convert XML to JSON by Example"
description: "Use Latentmachine to convert XML, RSS, SOAP-like payloads, Maven POMs, and HTML-like fragments into JSON, CSV, YAML, TOML, or .env output while reshaping fields from examples."
date: 2026-06-15
---

XML is still everywhere: RSS feeds, SOAP-style APIs, Maven POM files, Android manifests, government feeds, legacy enterprise exports, and HTML-like fragments from scraping workflows.

A normal XML-to-JSON converter changes syntax. Latentmachine can do that, but the useful part is teaching a transformation at the same time. You paste XML input, show the JSON shape you want, and Latentmachine infers a deterministic rule you can inspect.

## Example: XML to JSON

```xml
<order id="o1">
  <customer>Ana</customer>
  <total>119.50</total>
  <status>paid</status>
</order>
```

Show the output you need:

```json
{
  "order_id": "o1",
  "customer": "Ana",
  "total": 119.5,
  "paid": true
}
```

Latentmachine parses the XML into structured data, compares it with the output, and learns the rule: copy the `id` attribute, copy the customer, coerce the total to a number, and map the status to a boolean.

## XML Mapping Convention

XML has concepts JSON does not, so Latentmachine uses a predictable convention:

- Attributes become `@` keys, such as `@id`.
- Elements with only text become strings.
- Repeated sibling elements become arrays.
- Text mixed with child elements is stored as `#text`.
- CDATA becomes plain text.
- Self-closing elements become `null`.
- Namespace prefixes are stripped by default.

XML text values stay strings when parsed. If you need numbers or booleans, show that in your output example and the engine infers the conversion.

## More Than Syntax Conversion

You can convert XML to JSON, but also reshape it:

- Flatten Maven POM metadata into a deployment record.
- Extract RSS feed items into CSV rows.
- Turn XML attributes into normal API fields.
- Convert SOAP-like response payloads into smaller JSON objects.
- Generate XML from JSON when another system needs XML output.

If the examples are ambiguous, Latentmachine tells you what extra example would prove the rule instead of silently guessing.

## Exports

For XML rules marked safe, Latentmachine can copy or download the transformed output and export JavaScript, n8n code, Make.com code, or a plain JavaScript function.

Standalone CLI export is intentionally not enabled for XML yet because it would need to inline the XML parser into every generated file. JSON, CSV, TOML, and .env rules already support standalone CLI export.
