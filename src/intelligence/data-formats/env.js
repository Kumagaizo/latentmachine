import { assertSafeObjectKey } from "./safety.js";

function normalizeLineEndings(text) {
  return String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function envError(message) {
  return new Error(message || "could not parse input");
}

function isEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) slashCount += 1;
  return slashCount % 2 === 1;
}

function closingQuoteIndex(text, quote) {
  for (let index = 1; index < text.length; index++) {
    if (text[index] === quote && (quote === "'" || !isEscaped(text, index))) return index;
  }
  return -1;
}

function decodeDoubleQuotedValue(text) {
  return text.replace(/\\([nrt"\\])/g, (_, char) => {
    if (char === "n") return "\n";
    if (char === "r") return "\r";
    if (char === "t") return "\t";
    return char;
  });
}

function stripInlineComment(value) {
  const match = String(value).match(/(^|\s)#/);
  return match ? value.slice(0, match.index).trimEnd() : value;
}

function parseQuotedValue(lines, startIndex, initialValue, quote) {
  let raw = initialValue;
  let endIndex = startIndex;
  let closeIndex = closingQuoteIndex(raw, quote);

  while (closeIndex < 0 && endIndex + 1 < lines.length) {
    endIndex += 1;
    raw += `\n${lines[endIndex]}`;
    closeIndex = closingQuoteIndex(raw, quote);
  }

  if (closeIndex < 0) {
    throw envError(`line ${startIndex + 1}: unterminated quoted value.`);
  }

  const value = raw.slice(1, closeIndex);
  const trailing = raw.slice(closeIndex + 1).trim();
  if (trailing && !trailing.startsWith("#")) {
    throw envError(`line ${startIndex + 1}: unexpected text after quoted value.`);
  }

  return {
    value: quote === "\"" ? decodeDoubleQuotedValue(value) : value,
    endIndex,
  };
}

function parseEnvLine(lines, index, result) {
  const rawLine = lines[index];
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) return index;

  const cleaned = line.replace(/^export\s+/, "");
  const eqIndex = cleaned.indexOf("=");
  if (eqIndex < 0) {
    throw envError(`line ${index + 1}: missing '='.`);
  }

  const key = cleaned.slice(0, eqIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw envError(`line ${index + 1}: invalid key "${key || "(empty)"}".`);
  }
  assertSafeObjectKey(key, `.env line ${index + 1}`);
  if (Object.prototype.hasOwnProperty.call(result, key)) {
    throw envError(`line ${index + 1}: duplicate key "${key}".`);
  }

  const rawValue = cleaned.slice(eqIndex + 1).trim();
  if (rawValue.startsWith("\"") || rawValue.startsWith("'")) {
    const parsed = parseQuotedValue(lines, index, rawValue, rawValue[0]);
    result[key] = parsed.value;
    return parsed.endIndex;
  }

  result[key] = stripInlineComment(rawValue).trim();
  return index;
}

export function parseEnv(text) {
  if (typeof text !== "string") throw envError("input must be a string.");
  const source = normalizeLineEndings(text);
  if (!source.trim()) throw envError("input is empty.");

  const result = {};
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index++) {
    index = parseEnvLine(lines, index, result);
  }
  if (!Object.keys(result).length) throw envError("no variables found.");
  return result;
}

export function detectEnv(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  const source = normalizeLineEndings(text).trim();
  if (/^\s*[\[{]/.test(source)) return false;
  if (/^\s*\[{1,2}[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)*]{1,2}\s*$/m.test(source)) return false;

  try {
    const keys = Object.keys(parseEnv(source));
    const hasConventionalKey = keys.some(key => /^[A-Z_][A-Z0-9_]*$/.test(key));
    return hasConventionalKey || keys.length >= 2;
  } catch {
    return false;
  }
}

function assertFlatEnvObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw envError("output must be a flat object.");
  }
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw envError(`invalid key "${key}".`);
    }
    assertSafeObjectKey(key, ".env output");
    if (item && typeof item === "object") {
      throw envError(`cannot represent nested objects or arrays (key: "${key}"). Flatten the structure first.`);
    }
  }
}

function quoteEnvValue(value) {
  const text = value === null || value === undefined ? "" : String(value);
  const needsQuotes = text === "" || /[\s#"'\\\r\n\t]/.test(text) || text !== text.trim();
  if (!needsQuotes) return text;
  return `"${text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

export function serializeEnv(value) {
  assertFlatEnvObject(value);
  const entries = Object.entries(value);
  if (!entries.length) return "";
  return `${entries.map(([key, item]) => `${key}=${quoteEnvValue(item)}`).join("\n")}\n`;
}

export const envFormat = {
  id: "env",
  label: ".env",
  fileExtension: "env",
  mimeType: "text/plain",
  detect: detectEnv,
  parse: parseEnv,
  serialize: serializeEnv,
};
