---
title: "Reshaping CMS Exports for Migration Without Writing a Script"
description: "How to use Latentmachine to transform WordPress, Airtable, and other CMS exports into import-ready JSON for Webflow, Contentful, or any target system. Covers date formatting, tag splitting, field cleanup, and type conversion."
date: "2026-05-19"
---

CMS migrations are tedious in a specific way. The data is not complicated. It is posts, pages, products, or contacts. But every system stores it differently. WordPress nests the title inside an object. Airtable exports tags as comma-separated strings. One CMS uses ISO timestamps, the other wants just the date. One stores booleans as "true" and "false" strings, the other expects actual booleans.

You end up writing a transformation script that is 80% boilerplate and 20% actual logic. Then the client adds three more fields, and you update the script. Then you find out the export has inconsistent whitespace, and you add trim calls everywhere.

Latentmachine handles this class of problem well. You paste a row from the source export, paste the shape the target system expects, and the engine infers the transformation. This article walks through three common migration scenarios.

## WordPress to Webflow

A typical WordPress REST API export looks like this:

```json
{
  "id": 42,
  "title": { "rendered": "Heat Pump Maintenance Guide" },
  "date": "2024-06-15T10:30:00",
  "slug": "heat-pump-maintenance-guide",
  "status": "publish"
}
```

Webflow's CMS import expects a flatter structure. The title should be a plain string, not nested inside an object. The date should be just the date portion, without the time:

```json
{
  "name": "Heat Pump Maintenance Guide",
  "slug": "heat-pump-maintenance-guide",
  "date": "2024-06-15",
  "status": "publish"
}
```

Two examples of this transformation are enough for the engine to infer four operations: extract the title from the nested object, pass the slug through directly, split the date at the "T" character and keep the first part, and pass the status through. The date operation is structural, not a string hack. The engine detects that the output is the date portion of an ISO timestamp and applies a `splitPart` operation.

Test it with a draft post. The status field passes through as "draft" even though the examples only showed "publish", because the engine identified it as a direct mapping, not a value map.

[Try the CMS migration example →](/?sample=cms-migration)

## Airtable cleanup

Airtable exports are often messy in small, annoying ways. Extra whitespace around names. Uppercase emails. Tags stored as a single comma-separated string instead of an array:

```json
{
  "Name": "  maria garcia  ",
  "Email": "MARIA@COMPANY.COM",
  "Tags": "solar, installation, residential",
  "Active": "true"
}
```

Your target system needs clean, normalized data:

```json
{
  "name": "Maria Garcia",
  "email": "maria@company.com",
  "tags": ["solar", "installation", "residential"],
  "active": true
}
```

The engine infers four operations from two examples: trim and title-case the name (a composed `trim+title` operation), lowercase the email, split the tags string on `", "` to produce an array, and coerce the "true" string to the boolean `true`.

Each operation is independent. If a future record has clean whitespace, the trim is harmless. If the email is already lowercase, the lowercase operation is a no-op. The operations are safe to apply to data that does not need them.

## Handling inconsistent date formats

Some exports mix date formats within the same dataset. One record has "2024-03-15", another has "15/03/2024". Latentmachine does not handle mixed formats in a single rule because that would require guessing which format a given row uses. But it handles consistent format conversions well.

If all your source dates are in "DD/MM/YYYY" format and you need "YYYY-MM-DD", the engine infers a `dateFormat` operation. It recognizes common date patterns including ISO dates, US slash format (MM/DD/YYYY), European slash format (DD/MM/YYYY), and partial formats like year-month or year-only.

For mixed-format datasets, the practical approach is to sort the export by format first (usually easy to detect by checking whether the first segment is greater than 12), run each group through Latentmachine separately, and concatenate the results.

## Field renaming at scale

When the source and target systems use different field names but the same structure, Latentmachine infers direct mappings. `post_title` becomes `name`. `post_author` becomes `author`. `post_date` becomes `publishedAt`.

For flat records with ten or fifteen fields, this saves the most time not because the mapping is hard, but because writing it by hand means checking every field name twice: once in the source, once in the target. The engine does this comparison automatically and produces a verified mapping.

The exported JavaScript uses optional chaining, so missing fields in the source produce `undefined` in the output rather than runtime errors. This matters for CMS exports where optional fields like featured images or custom metadata may be absent on some records.

## A practical workflow

1. Export a few representative records from the source system.
2. Open Latentmachine and add two records as example pairs: source as input, desired shape as output.
3. Check the status. If it is safe, the rule covers your transformation. If not, the diagnosis tells you what to add.
4. Export as standalone JavaScript.
5. Run the export function over your full dataset in a Node.js script or a spreadsheet tool.

For large migrations, the exported function has no dependencies and runs in any JavaScript environment. You can process thousands of records in a loop without network calls or rate limits.

[Open Latentmachine →](/infer)
