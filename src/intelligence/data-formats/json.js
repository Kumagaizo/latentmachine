import { assertSafeParsedValue } from "./safety.js";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function detectJSON(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function parseJSON(text) {
  if (typeof text !== "string") return assertSafeParsedValue(clone(text), "JSON");
  try {
    return assertSafeParsedValue(JSON.parse(text), "JSON");
  } catch (error) {
    const message = error?.message || "could not parse value";
    const position = Number(message.match(/position\s+(\d+)/i)?.[1]);
    if (!Number.isFinite(position)) throw new Error(`Invalid JSON: ${message}`);

    const before = text.slice(0, position);
    const line = before.split(/\r\n|\r|\n/).length;
    const column = before.length - before.lastIndexOf("\n");
    const preview = text.slice(Math.max(0, position - 24), Math.min(text.length, position + 24)).replace(/\s+/g, " ").trim();
    throw new Error(`Invalid JSON at line ${line}, column ${column}: ${message}${preview ? ` Near "${preview}"` : ""}`);
  }
}

export function serializeJSON(value) {
  return JSON.stringify(value, null, 2);
}

export const jsonFormat = {
  id: "json",
  label: "JSON",
  fileExtension: "json",
  mimeType: "application/json",
  detect: detectJSON,
  parse: parseJSON,
  serialize: serializeJSON,
};
