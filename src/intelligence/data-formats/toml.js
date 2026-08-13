import { assertSafeObjectKey } from "./safety.js";
import { normalizeLineEndings } from "./shared.js";

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[-+]\d{2}:?\d{2})?)?$/;

function tomlError(message, line) {
  return new Error(line ? `line ${line}: ${message}` : message);
}

function stripComment(line) {
  let quote = null;
  let triple = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line.slice(index, index + 3);
    if (!quote && (next === "\"\"\"" || next === "'''")) {
      quote = char;
      triple = true;
      index += 2;
      continue;
    }
    if (!quote && (char === "\"" || char === "'")) {
      quote = char;
      continue;
    }
    if (quote) {
      if (triple && next === quote.repeat(3)) {
        quote = null;
        triple = false;
        index += 2;
        continue;
      }
      if (!triple && char === quote && (quote === "'" || !isEscaped(line, index))) quote = null;
      continue;
    }
    if (char === "#") return line.slice(0, index);
  }
  return line;
}

function isEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) slashCount += 1;
  return slashCount % 2 === 1;
}

function findEquals(line) {
  let quote = null;
  let triple = false;
  let depth = 0;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line.slice(index, index + 3);
    if (quote) {
      if (triple && next === quote.repeat(3)) {
        quote = null;
        triple = false;
        index += 2;
      } else if (!triple && char === quote && (quote === "'" || !isEscaped(line, index))) {
        quote = null;
      }
      continue;
    }
    if (next === "\"\"\"" || next === "'''") {
      quote = char;
      triple = true;
      index += 2;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    if (char === "]" || char === "}") depth -= 1;
    if (char === "=" && depth === 0) return index;
  }
  return -1;
}

function isBalanced(value) {
  let quote = null;
  let triple = false;
  let square = 0;
  let curly = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const next = value.slice(index, index + 3);
    if (!quote && (next === "\"\"\"" || next === "'''")) {
      quote = char;
      triple = true;
      index += 2;
      continue;
    }
    if (!quote && (char === "\"" || char === "'")) {
      quote = char;
      continue;
    }
    if (quote) {
      if (triple && next === quote.repeat(3)) {
        quote = null;
        triple = false;
        index += 2;
      } else if (!triple && char === quote && (quote === "'" || !isEscaped(value, index))) {
        quote = null;
      }
      continue;
    }
    if (char === "[") square += 1;
    else if (char === "]") square -= 1;
    else if (char === "{") curly += 1;
    else if (char === "}") curly -= 1;
  }
  return !quote && square === 0 && curly === 0;
}

function splitTopLevel(value, separator = ",") {
  const items = [];
  let quote = null;
  let triple = false;
  let square = 0;
  let curly = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const next = value.slice(index, index + 3);
    if (quote) {
      if (triple && next === quote.repeat(3)) {
        quote = null;
        triple = false;
        index += 2;
      } else if (!triple && char === quote && (quote === "'" || !isEscaped(value, index))) {
        quote = null;
      }
      continue;
    }
    if (next === "\"\"\"" || next === "'''") {
      quote = char;
      triple = true;
      index += 2;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[") square += 1;
    else if (char === "]") square -= 1;
    else if (char === "{") curly += 1;
    else if (char === "}") curly -= 1;
    else if (char === separator && square === 0 && curly === 0) {
      items.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) items.push(last);
  return items;
}

function parseKeyPath(text, line) {
  const parts = splitTopLevelDots(text.trim()).map(part => parseKey(part.trim(), line));
  if (!parts.length || parts.some(part => part === "")) throw tomlError(`invalid key "${text}".`, line);
  return parts;
}

function splitTopLevelDots(text) {
  const parts = [];
  let quote = null;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote && (quote === "'" || !isEscaped(text, index))) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === ".") {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function parseKey(text, line) {
  if (/^[A-Za-z0-9_-]+$/.test(text)) {
    assertSafeObjectKey(text, `TOML line ${line}`);
    return text;
  }
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    const key = text[0] === "\"" ? decodeBasicString(text.slice(1, -1), line) : text.slice(1, -1);
    assertSafeObjectKey(key, `TOML line ${line}`);
    return key;
  }
  throw tomlError(`invalid key "${text}".`, line);
}

function decodeBasicString(text, line) {
  return text.replace(/\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|([btnfr"\\]))/g, (_, shortCode, longCode, char) => {
    if (shortCode || longCode) return String.fromCodePoint(parseInt(shortCode || longCode, 16));
    if (char === "b") return "\b";
    if (char === "t") return "\t";
    if (char === "n") return "\n";
    if (char === "f") return "\f";
    if (char === "r") return "\r";
    return char;
  }).replace(/\\./g, match => {
    throw tomlError(`unsupported escape sequence "${match}".`, line);
  });
}

function parseValue(raw, line) {
  const value = raw.trim();
  if (!value) throw tomlError("missing value.", line);
  if (value.startsWith("\"\"\"") || value.startsWith("'''")) return parseTripleString(value, line);
  if (value.startsWith("\"")) {
    if (!value.endsWith("\"") || value.length === 1) throw tomlError("unterminated string.", line);
    return decodeBasicString(value.slice(1, -1), line);
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length === 1) throw tomlError("unterminated literal string.", line);
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith("[") && value.endsWith("]")) return parseArray(value, line);
  if (value.startsWith("{") && value.endsWith("}")) return parseInlineTable(value, line);
  if (DATETIME_RE.test(value)) return value;
  if (/^[+-]?0x[0-9A-Fa-f_]+$/.test(value)) return parseInt(value.replace(/_/g, "").replace(/^[+]?0x/i, ""), 16);
  if (/^[+-]?0o[0-7_]+$/.test(value)) return parseInt(value.replace(/_/g, "").replace(/^[+]?0o/i, ""), 8);
  if (/^[+-]?0b[01_]+$/.test(value)) return parseInt(value.replace(/_/g, "").replace(/^[+]?0b/i, ""), 2);
  if (/^[+-]?(?:\d[\d_]*)(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?$/.test(value)) {
    const number = Number(value.replace(/_/g, ""));
    if (Number.isFinite(number)) return number;
  }
  throw tomlError(`unsupported value "${value}".`, line);
}

function parseTripleString(value, line) {
  const quote = value[0];
  if (!value.endsWith(quote.repeat(3)) || value.length < 6) throw tomlError("unterminated multiline string.", line);
  let body = value.slice(3, -3);
  if (body.startsWith("\n")) body = body.slice(1);
  return quote === "\"" ? decodeBasicString(body, line) : body;
}

function parseArray(value, line) {
  const body = value.slice(1, -1).trim();
  if (!body) return [];
  return splitTopLevel(body).map(item => parseValue(item, line));
}

function parseInlineTable(value, line) {
  const body = value.slice(1, -1).trim();
  const result = {};
  if (!body) return result;
  for (const item of splitTopLevel(body)) {
    const eqIndex = findEquals(item);
    if (eqIndex < 0) throw tomlError("inline table entry is missing '='.", line);
    setNestedValue(result, parseKeyPath(item.slice(0, eqIndex), line), parseValue(item.slice(eqIndex + 1), line), line);
  }
  return result;
}

function getOrCreateTable(root, path, line) {
  let target = root;
  for (const part of path) {
    if (target[part] === undefined) target[part] = {};
    if (Array.isArray(target[part])) {
      const last = target[part].at(-1);
      if (!last || typeof last !== "object" || Array.isArray(last)) throw tomlError(`"${part}" is not a table.`, line);
      target = last;
      continue;
    }
    if (!target[part] || typeof target[part] !== "object" || Array.isArray(target[part])) {
      throw tomlError(`"${part}" is not a table.`, line);
    }
    target = target[part];
  }
  return target;
}

function setNestedValue(root, path, value, line) {
  let target = root;
  path.forEach((part, index) => {
    const last = index === path.length - 1;
    if (last) {
      if (Object.prototype.hasOwnProperty.call(target, part)) throw tomlError(`duplicate key "${path.join(".")}".`, line);
      target[part] = value;
      return;
    }
    if (target[part] === undefined) target[part] = {};
    if (!target[part] || typeof target[part] !== "object" || Array.isArray(target[part])) {
      throw tomlError(`"${path.slice(0, index + 1).join(".")}" is not a table.`, line);
    }
    target = target[part];
  });
}

function readValueLines(lines, index, initial) {
  let raw = stripComment(initial);
  let endIndex = index;
  const startsMultilineString = /^(\s*)("""|''')/.test(raw);
  if (startsMultilineString && !isBalanced(raw)) {
    while (!isBalanced(raw) && endIndex + 1 < lines.length) {
      endIndex += 1;
      raw += `\n${lines[endIndex]}`;
    }
    return { raw: stripComment(raw), endIndex };
  }
  while (!isBalanced(raw) && endIndex + 1 < lines.length) {
    endIndex += 1;
    raw += `\n${stripComment(lines[endIndex])}`;
  }
  return { raw, endIndex };
}

export function parseTOML(text) {
  if (typeof text !== "string") throw tomlError("input must be a string.");
  const source = normalizeLineEndings(text);
  if (!source.trim()) throw tomlError("input is empty.");

  const root = {};
  const explicitTables = new Set();
  const lines = source.split("\n");
  let current = root;

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const cleaned = stripComment(lines[index]).trim();
    if (!cleaned) continue;

    const arrayTable = cleaned.match(/^\[\[\s*(.+?)\s*]]$/);
    if (arrayTable) {
      const path = parseKeyPath(arrayTable[1], lineNumber);
      const parent = getOrCreateTable(root, path.slice(0, -1), lineNumber);
      const key = path.at(-1);
      if (parent[key] === undefined) parent[key] = [];
      if (!Array.isArray(parent[key])) throw tomlError(`"${path.join(".")}" is not an array table.`, lineNumber);
      const next = {};
      parent[key].push(next);
      current = next;
      continue;
    }

    const table = cleaned.match(/^\[\s*(.+?)\s*]$/);
    if (table) {
      const path = parseKeyPath(table[1], lineNumber);
      const key = path.join(".");
      if (explicitTables.has(key)) throw tomlError(`duplicate table "${key}".`, lineNumber);
      explicitTables.add(key);
      current = getOrCreateTable(root, path, lineNumber);
      continue;
    }

    const eqIndex = findEquals(cleaned);
    if (eqIndex < 0) throw tomlError("expected a table header or key-value pair.", lineNumber);
    const key = cleaned.slice(0, eqIndex);
    const valueStart = cleaned.slice(eqIndex + 1);
    const { raw, endIndex } = readValueLines(lines, index, valueStart);
    index = endIndex;
    if (!isBalanced(raw)) throw tomlError("unterminated array, inline table, or string.", lineNumber);
    setNestedValue(current, parseKeyPath(key, lineNumber), parseValue(raw, lineNumber), lineNumber);
  }

  return root;
}

export function detectTOML(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  const source = normalizeLineEndings(text).trim();
  if (/^\s*[\[{]/.test(source) && !source.includes("=")) return false;
  const dataLines = source.split("\n").map(line => stripComment(line).trim()).filter(Boolean);
  const envLike = dataLines.length > 0 && dataLines.every(line => /^(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=/.test(line));
  const startsEnvLike = /^(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=/.test(dataLines[0] || "");
  if ((envLike || startsEnvLike) && !/^\s*\[{1,2}/m.test(source)) return false;
  const hasTableHeader = /^\s*\[{1,2}\s*[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)*\s*]{1,2}\s*$/m.test(source);
  const hasTypedAssignment = /^\s*[A-Za-z0-9_.-]+\s*=\s*(?:"[^"]*"|'[^']*'|[+-]?\d|true|false|\[|\{)/m.test(source);
  if (!hasTableHeader && !hasTypedAssignment) return false;
  const hasTOMLFeature = /^\s*[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\s*=/m.test(source)
    || /=\s*[\[{]/m.test(source)
    || /=\s*(?:true|false)\s*(?:#.*)?$/m.test(source)
    || /=\s*[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?\s*(?:#.*)?$/m.test(source)
    || /=\s*\d{4}-\d{2}-\d{2}/m.test(source);
  return hasTableHeader || hasTOMLFeature;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function keyText(key) {
  assertSafeObjectKey(key, "TOML output");
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function primitiveValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw tomlError("TOML cannot serialize non-finite numbers.");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  throw tomlError(`TOML cannot serialize ${value === null ? "null" : typeof value}.`);
}

function inlineValue(value) {
  if (Array.isArray(value)) {
    if (value.some(isPlainObject)) throw tomlError("arrays of objects must be serialized as table arrays.");
    return `[${value.map(inlineValue).join(", ")}]`;
  }
  if (isPlainObject(value)) {
    return `{ ${Object.entries(value).map(([key, item]) => `${keyText(key)} = ${inlineValue(item)}`).join(", ")} }`;
  }
  return primitiveValue(value);
}

function serializeTable(value, path = [], lines = []) {
  const nested = [];
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined) continue;
    if (Array.isArray(item) && item.every(isPlainObject)) {
      nested.push([key, item, "array"]);
    } else if (isPlainObject(item)) {
      nested.push([key, item, "table"]);
    } else {
      lines.push(`${keyText(key)} = ${inlineValue(item)}`);
    }
  }

  for (const [key, item, type] of nested) {
    const nextPath = [...path, key];
    if (type === "array") {
      for (const row of item) {
        if (lines.length && lines.at(-1) !== "") lines.push("");
        lines.push(`[[${nextPath.map(keyText).join(".")}]]`);
        serializeTable(row, nextPath, lines);
      }
      continue;
    }
    if (lines.length && lines.at(-1) !== "") lines.push("");
    lines.push(`[${nextPath.map(keyText).join(".")}]`);
    serializeTable(item, nextPath, lines);
  }
  return lines;
}

export function serializeTOML(value) {
  if (!isPlainObject(value)) throw tomlError("TOML output must be an object.");
  const lines = serializeTable(value);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

export const tomlFormat = {
  id: "toml",
  label: "TOML",
  fileExtension: "toml",
  mimeType: "application/toml",
  detect: detectTOML,
  parse: parseTOML,
  serialize: serializeTOML,
};
