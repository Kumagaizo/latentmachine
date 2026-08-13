import { assertSafeObjectKey } from "./safety.js";
import { normalizeLineEndings } from "./shared.js";

const DEFAULT_SEPARATOR = ",";
const AUTO_SEPARATORS = [",", ";", "\t"];

// NOTE: CLI-runtime copies of these helpers exist in json-transform/exporters.js
// with a "cli" prefix. Keep behavior in sync when changing CSV parsing or
// serialization here.

function hasLeadingZeroNumber(text) {
  return /^[-+]?0\d+(\.\d+)?$/.test(text);
}

function looksNumeric(text) {
  return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(text);
}

function shouldPreserveString(header, text) {
  const key = String(header ?? "").trim().toLowerCase();
  if (/^(id|.*_id|.* id|sku|zip|postal_code|postcode|phone|tel|mobile)$/.test(key)) return true;
  if (/^\+\d[\d\s().-]{6,}$/.test(String(text ?? "").trim())) return true;
  return false;
}

function coerceCSVValue(value, options = {}) {
  const text = options.trim === false ? String(value ?? "") : String(value ?? "").trim();
  if (text === "") return "";
  if (shouldPreserveString(options.header, text)) return text;
  if (text === "true") return true;
  if (text === "false") return false;
  if (hasLeadingZeroNumber(text)) return text;
  if (looksNumeric(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) return number;
  }
  return text;
}

export function parseCSVRecords(text, options = {}) {
  const separator = options.separator || DEFAULT_SEPARATOR;
  const source = normalizeLineEndings(text).trim();
  if (!source) throw new Error("CSV is empty.");

  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;
  let wasQuoted = false;
  let line = 1;
  let quoteStartLine = null;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      quoteStartLine = inQuotes ? line : null;
      wasQuoted = true;
      continue;
    }

    if (char === separator && !inQuotes) {
      row.push({ value: current, quoted: wasQuoted });
      current = "";
      wasQuoted = false;
      continue;
    }

    if (char === "\n" && !inQuotes) {
      row.push({ value: current, quoted: wasQuoted });
      rows.push(row);
      row = [];
      current = "";
      wasQuoted = false;
      line += 1;
      continue;
    }

    if (char === "\n") line += 1;
    current += char;
  }

  if (inQuotes) throw new Error(`CSV has an unterminated quoted field starting near line ${quoteStartLine || line}.`);
  row.push({ value: current, quoted: wasQuoted });
  rows.push(row);

  return rows.filter(cells => cells.some(cell => String(cell.value).trim() !== ""));
}

export function splitCSVLine(line, separator = DEFAULT_SEPARATOR) {
  return parseCSVRecords(line, { separator })[0]?.map(cell => cell.value) || [];
}

export function detectCSVSeparator(text, options = {}) {
  if (options.separator) return options.separator;
  if (typeof text !== "string" || !/\r|\n/.test(text)) return DEFAULT_SEPARATOR;
  const candidates = AUTO_SEPARATORS
    .filter(separator => text.includes(separator))
    .map(separator => {
      try {
        const rows = parseCSVRecords(text, { separator });
        const width = rows[0]?.length || 0;
        const consistent = rows.length >= 2 && width >= 2 && rows.every(row => row.length === width);
        return { separator, rows: rows.length, width, consistent };
      } catch {
        return { separator, rows: 0, width: 0, consistent: false };
      }
    })
    .filter(candidate => candidate.consistent)
    .sort((first, second) => second.width - first.width || second.rows - first.rows);
  return candidates[0]?.separator || DEFAULT_SEPARATOR;
}

export function parseCSV(text, options = {}) {
  const separator = detectCSVSeparator(text, options);
  const rows = parseCSVRecords(text, { separator });
  if (rows.length < 2) throw new Error("CSV requires a header row and at least one data row.");

  const width = rows[0].length;
  if (width < 1) throw new Error("CSV requires at least one header.");
  const unevenRowIndex = rows.findIndex(row => row.length !== width);
  if (unevenRowIndex >= 0) {
    throw new Error(`CSV row ${unevenRowIndex + 1} has ${rows[unevenRowIndex].length} columns; expected ${width}.`);
  }

  const headers = rows[0].map(cell => String(cell.value).trim());
  const seen = new Set();
  for (const [index, header] of headers.entries()) {
    if (!header) throw new Error(`CSV header ${index + 1} is empty.`);
    assertSafeObjectKey(header, "CSV header");
    if (seen.has(header)) throw new Error(`CSV header "${header}" is duplicated.`);
    seen.add(header);
  }

  const records = rows.slice(1).map(row => {
    const record = {};
    headers.forEach((header, index) => {
      const cell = row[index];
      const value = cell.quoted ? cell.value : String(cell.value).trim();
      record[header] = options.coerce === false ? value : coerceCSVValue(value, { header, trim: !cell.quoted });
    });
    return record;
  });

  return options.singleRowAsObject && records.length === 1 ? records[0] : records;
}

export function escapeCSVField(value, separator = DEFAULT_SEPARATOR) {
  const raw = value === undefined || value === null ? "" : String(value);
  const trimmedStart = raw.trimStart();
  const formulaRisk = /^[=@]/.test(trimmedStart)
    || (/^[+-]/.test(trimmedStart) && !/^[+-]?\d+(\.\d+)?$/.test(trimmedStart) && !/^\+\d[\d\s().-]{6,}$/.test(trimmedStart));
  const text = formulaRisk ? `'${raw}` : raw;
  if (text.includes(separator) || text.includes("\"") || text.includes("\n") || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function collectKeys(values) {
  const keys = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const key of Object.keys(value)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export function serializeCSVBatch(values, options = {}) {
  const separator = options.separator || DEFAULT_SEPARATOR;
  const rows = Array.isArray(values) ? values : [values];
  if (!rows.length) return "";

  const keys = options.headers || collectKeys(rows);
  if (!keys.length) return "";

  const header = keys.map(key => escapeCSVField(key, separator)).join(separator);
  const body = rows.map(row =>
    keys.map(key => {
      const value = row?.[key];
      return escapeCSVField(value && typeof value === "object" ? JSON.stringify(value) : value, separator);
    }).join(separator)
  );

  return [header, ...body].join("\n");
}

export function serializeCSV(value, options = {}) {
  return serializeCSVBatch(Array.isArray(value) ? value : [value], options);
}

export function detectCSV(text, options = {}) {
  if (typeof text !== "string" || !text.trim()) return false;
  const envLikeLines = normalizeLineEndings(text).trim().split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
  if (envLikeLines.length && envLikeLines.every(line => /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line))) return false;
  const separator = detectCSVSeparator(text, options);
  if (!text.includes(separator) || !/\r|\n/.test(text)) return false;

  try {
    const rows = parseCSVRecords(text, { separator });
    if (rows.length < 2) return false;
    const width = rows[0].length;
    return width >= 2 && rows.every(row => row.length === width);
  } catch {
    return false;
  }
}

export const csvFormat = {
  id: "csv",
  label: "CSV",
  fileExtension: "csv",
  mimeType: "text/csv",
  detect: detectCSV,
  parse: parseCSV,
  serialize: serializeCSV,
};
