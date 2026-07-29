import { detectFormat, parseWithFormat } from "../intelligence/data-formats/index.js";
import { inferVerifyRule } from "../intelligence/json-transform/verify-inference.js";

function normalizeRows(value, label) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  throw new Error(`${label} must parse to an object or an array of records.`);
}

function parsePane({ text, format, label }) {
  try {
    const parsed = parseWithFormat(text, format, { singleRowAsObject: false });
    return {
      rows: normalizeRows(parsed, label),
      format: format === "auto" ? detectFormat(text) : format,
    };
  } catch (error) {
    throw new Error(`${label} could not be parsed. ${error?.message || "Check the input format."}`);
  }
}

self.addEventListener("message", event => {
  const { id, originalText, transformedText, formats } = event.data || {};
  try {
    const original = parsePane({ text: originalText, format: formats?.original || "auto", label: "Original" });
    const transformed = parsePane({ text: transformedText, format: formats?.transformed || "auto", label: "Transformed" });
    if (original.rows.length !== transformed.rows.length) {
      throw new Error(`Original has ${original.rows.length} record${original.rows.length === 1 ? "" : "s"}, AI output has ${transformed.rows.length} record${transformed.rows.length === 1 ? "" : "s"}. Rows must align 1:1 because Verify compares rows by pasted order.`);
    }
    if (!original.rows.length) throw new Error("Paste at least one aligned record on each side.");
    self.postMessage({
      id,
      original,
      transformed,
      inference: inferVerifyRule(original.rows, transformed.rows),
    });
  } catch (error) {
    self.postMessage({ id, error: error?.message || "Verify could not parse or verify this transformation." });
  }
});
