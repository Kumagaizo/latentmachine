import { csvFormat } from "./csv.js";
import { envFormat } from "./env.js";
import { jsonFormat } from "./json.js";
import { sqlFormat } from "./sql.js";
import { tomlFormat } from "./toml.js";
import { xmlFormat } from "./xml.js";
import { yamlFormat } from "./yaml.js";

export { detectCSV, detectCSVSeparator, escapeCSVField, parseCSV, parseCSVRecords, serializeCSV, serializeCSVBatch, splitCSVLine } from "./csv.js";
export { detectEnv, parseEnv, serializeEnv } from "./env.js";
export { detectJSON, parseJSON, serializeJSON } from "./json.js";
export { detectSQL, parseSQLInsert, parseSQLInsertWithWarnings, serializeSQLInsert, SQL_DEFAULT_LIMITS } from "./sql.js";
export { detectTOML, parseTOML, serializeTOML } from "./toml.js";
export { detectUnsupportedFormat } from "./unsupported.js";
export { detectXML, parseXML, serializeXML } from "./xml.js";
export { detectYAML, parseYAML, parseYAMLWithWarnings, serializeYAML, serializeYAMLBatch } from "./yaml.js";

export const FORMAT_ORDER = ["json", "xml", "csv", "toml", "env", "sql", "yaml"];

export const FORMATS = {
  json: jsonFormat,
  xml: xmlFormat,
  csv: csvFormat,
  toml: tomlFormat,
  env: envFormat,
  sql: sqlFormat,
  yaml: yamlFormat,
};

export const OUTPUT_FORMAT_ORDER = FORMAT_ORDER.filter(formatId => !FORMATS[formatId]?.inputOnly);

export function normalizeFormatId(formatId) {
  if (!formatId || formatId === "auto") return "auto";
  const normalized = String(formatId).trim().toLowerCase();
  if (!FORMATS[normalized]) throw new Error(`Unsupported format: ${formatId}`);
  return normalized;
}

export function detectFormat(text, options = {}) {
  if (typeof text !== "string" || !text.trim()) return "empty";
  for (const formatId of options.order || FORMAT_ORDER) {
    const format = FORMATS[formatId];
    if (format?.detect(text, options)) return formatId;
  }
  return "unknown";
}

export function resolveFormat(text, formatId = "auto", options = {}) {
  const normalized = normalizeFormatId(formatId);
  if (normalized !== "auto") return normalized;

  const detected = detectFormat(text, options);
  if (detected === "empty") throw new Error("Cannot detect format from empty input.");
  if (detected === "unknown") throw new Error("Could not detect a supported data format.");
  return detected;
}

export function parseWithFormat(text, formatId = "auto", options = {}) {
  const resolved = resolveFormat(text, formatId, options);
  try {
    return FORMATS[resolved].parse(text, options);
  } catch (error) {
    throw new Error(`${FORMATS[resolved].label}: ${error?.message || "could not parse input"}`);
  }
}

export function serializeWithFormat(value, formatId = "json", options = {}) {
  const normalized = normalizeFormatId(formatId);
  const resolved = normalized === "auto" ? "json" : normalized;
  if (FORMATS[resolved]?.inputOnly || typeof FORMATS[resolved]?.serialize !== "function") {
    throw new Error(`${FORMATS[resolved]?.label || resolved} is input-only and cannot be used as an output format.`);
  }
  return FORMATS[resolved].serialize(value, options);
}

export function formatLabel(formatId) {
  if (formatId === "auto") return "Auto";
  if (formatId === "empty") return "Empty";
  if (formatId === "unknown") return "Unknown";
  return FORMATS[formatId]?.label || String(formatId || "Unknown");
}
