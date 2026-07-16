import { parsePath } from "./core.js";
import { opSources } from "./shared.js";

function pathToAccess(path, root = "input") {
  return parsePath(path).reduce((expr, part) => {
    if (typeof part === "number") return `${expr}?.[${part}]`;
    return /^[A-Za-z_$][\w$]*$/.test(part) ? `${expr}?.${part}` : `${expr}?.[${JSON.stringify(part)}]`;
  }, root);
}

function pathToSet(path, valueExpr, root = "output") {
  const parts = parsePath(path);
  if (!parts.length) return [`${root} = ${valueExpr};`];
  const lines = [];
  let cursor = root;
  parts.forEach((part, index) => {
    const key = typeof part === "number" ? `[${part}]` : /^[A-Za-z_$][\w$]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`;
    if (index === parts.length - 1) {
      lines.push(`${cursor}${key} = ${valueExpr};`);
      return;
    }
    const next = parts[index + 1];
    lines.push(`${cursor}${key} ??= ${typeof next === "number" ? "[]" : "{}"};`);
    cursor = `${cursor}${key}`;
  });
  return lines;
}

function stringTransformExpr(expr, mode = "identity", options = {}) {
  return String(mode).split("+").reduce((current, nextMode) => {
    if (nextMode === "identity") return current;
    if (nextMode === "upper") return `String(${current} ?? "").toUpperCase()`;
    if (nextMode === "lower") return `String(${current} ?? "").toLowerCase()`;
    if (nextMode === "trim") return `String(${current} ?? "").trim()`;
    if (nextMode === "title") return `String(${current} ?? "").toLowerCase().replace(/\\b\\w/g, c => c.toUpperCase())`;
    if (nextMode === "collapseWhitespace") return `String(${current} ?? "").trim().replace(/\\s+/g, " ")`;
    if (nextMode === "phone") {
      const policy = options.phonePolicy || {};
      return `(() => { const text = String(${current} ?? "").trim(); const digits = text.replace(/\\D/g, ""); if (!digits) return null; if (text.startsWith("+")) return digits.length >= 7 ? "+" + digits : null; const defaultCountryCode = ${literal(policy.defaultCountryCode || null)}; const localDigits = ${literal(policy.localDigits || 10)}; if (defaultCountryCode && digits.length === localDigits) return "+" + defaultCountryCode + digits; if (${literal(!!policy.requireCountryCode)}) return ${literal(`[unresolved: phone country at ${options.source || "$.phone"}]`)}; const nanp = digits.length === 10 && /^\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}$/.test(text); return nanp ? "+1" + digits : digits; })()`;
    }
    if (nextMode === "dateNormalize") return `(() => { const text = String(${current} ?? "").trim(); if (/^\\d{4}-\\d{2}-\\d{2}T/.test(text)) return text; const iso = text.match(/^(\\d{4})[-/](\\d{2})[-/](\\d{2})/); if (iso) return iso.slice(1, 4).join("-"); const eu = text.match(/^(\\d{2})[-/](\\d{2})[-/](\\d{4})$/); return eu ? [eu[3], eu[2], eu[1]].join("-") : text; })()`;
    if (nextMode === "s3KeyDecode") return `(() => { const text = String(${current} ?? "").replace(/\\+/g, " "); try { return decodeURIComponent(text); } catch { return text; } })()`;
    return current;
  }, expr);
}

function literal(value) {
  return JSON.stringify(value);
}

function commentLine(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// CLI runtime functions are inlined into generated CLI exports so the file has
// zero imports. Keep duplicated CSV helpers in sync with data-formats/csv.js,
// and keep runtime guardrail helpers aligned with engine.js behavior.
function cliTypeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function cliParsePath(path = "$") {
  if (path === "$") return [];
  const parts = [];
  const regex = /\.([A-Za-z_$][\w$]*)|\[(\d+|".*?"|'.*?')\]/g;
  let match;
  while ((match = regex.exec(path))) {
    if (match[1]) parts.push(match[1]);
    else if (/^\d+$/.test(match[2])) parts.push(Number(match[2]));
    else parts.push(JSON.parse(match[2].replace(/^'/, "\"").replace(/'$/, "\"")));
  }
  return parts;
}

function cliGetPath(value, path) {
  return cliParsePath(path).reduce((current, part) => current?.[part], value);
}

// Inlined into the generated CLI file. Keep in sync with opSources above.
function cliOpSources(op) {
  if (!op) return [];
  if (op.op === "template") return (op.parts || []).filter(part => part.kind === "source").map(part => part.path);
  if (op.op === "concat" || op.op === "fallback") return op.sources || [];
  if (op.op === "numericBinary") return [op.left, op.right].filter(Boolean);
  if (["arrayMap", "arrayProject", "arrayCount", "arrayJoin", "arrayFind", "arrayGroupBy", "arrayStringTransform"].includes(op.op)) return [op.source].filter(Boolean);
  return op.source ? [op.source] : [];
}

function cliCheckPreconditions(input) {
  const issues = [];
  const seen = new Set();
  for (const precondition of PRECONDITIONS || []) {
    const key = `${precondition.field}:${precondition.type || "unknown"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const value = cliGetPath(input, precondition.field);
    if (value === undefined && precondition.required) {
      issues.push({
        type: "missing-source",
        field: precondition.field,
        blocking: true,
        message: `${precondition.field} is required by the learned rule but is missing from the input.`,
      });
      continue;
    }
  }
  return issues;
}

function cliRuntimeWarnings(input) {
  const warnings = [];
  for (const op of RULE.ops || []) {
    if (op.op === "fallback") {
      const allEmpty = (op.sources || []).every(source => {
        const value = cliGetPath(input, source);
        return value === undefined || value === null || value === "";
      });
      if (allEmpty) {
        warnings.push({
          type: "all-fallbacks-empty",
          field: op.sources?.[0],
          blocking: false,
          message: `All fallback sources for ${op.target} are empty or missing. The output will be null.`,
        });
      }
      continue;
    }
    if (op.op === "regexExtract") {
      const value = cliGetPath(input, op.source);
      if (value === undefined) {
        warnings.push({
          type: "missing-source",
          field: op.source,
          blocking: true,
          message: `${op.source} is required by the regex extraction rule but is missing.`,
        });
        continue;
      }
      let pattern;
      try {
        pattern = new RegExp(op.pattern);
      } catch {
        warnings.push({
          type: "invalid-regex-pattern",
          field: op.source,
          blocking: true,
          message: `The learned regex pattern /${op.pattern}/ is invalid.`,
        });
        continue;
      }
      if (!String(value ?? "").match(pattern)) {
        warnings.push({
          type: "regex-no-match",
          field: op.source,
          blocking: false,
          message: `${op.source} does not match the expected pattern /${op.pattern}/.`,
        });
      }
    }
    for (const source of cliOpSources(op)) {
      if (cliGetPath(input, source) === undefined) {
        warnings.push({
          type: "missing-source",
          field: source,
          blocking: true,
          message: `${source} is required by the learned rule but is missing from the input.`,
        });
      }
    }
    if (op.op === "arrayProject") {
      const rows = cliGetPath(input, op.source);
      if (rows !== undefined && !Array.isArray(rows)) {
        warnings.push({
          type: "invalid-array",
          field: op.source,
          blocking: true,
          message: `${op.source} must be an array for this record projection.`,
        });
      }
    }
    if (op.op === "arrayGroupBy") {
      const rows = cliGetPath(input, op.source);
      if (rows !== undefined && !Array.isArray(rows)) {
        warnings.push({
          type: "invalid-array",
          field: op.source,
          blocking: true,
          message: `${op.source} must be an array for this grouping operation.`,
        });
      }
      if (Array.isArray(rows)) {
        const invalidKey = rows.findIndex(row => {
          const key = cliGetPath(row, op.groupBy);
          return typeof key !== "string" && typeof key !== "number";
        });
        if (invalidKey >= 0) {
          warnings.push({
            type: "invalid-group-key",
            field: op.source,
            blocking: true,
            message: `Item ${invalidKey + 1} in ${op.source} does not contain a string or number at ${op.groupBy}.`,
          });
        }
      }
    }
    if (op.op === "valueMap") {
      const value = cliGetPath(input, op.source);
      if (value !== undefined && !Object.prototype.hasOwnProperty.call(op.map || {}, JSON.stringify(value))) {
        warnings.push({
          type: "unseen-value-map",
          field: op.source,
          blocking: false,
          message: `${op.source} contains a value that was not in the examples.`,
        });
      }
    }
  }
  return warnings;
}

function cliCollectOutputIssues(value, path = "$", issues = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => cliCollectOutputIssues(item, `${path}[${index}]`, issues));
    return issues;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      const childPath = /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
      cliCollectOutputIssues(item, childPath, issues);
    });
    return issues;
  }
  if (typeof value !== "string" || !value.startsWith("[")) return issues;
  if (value.startsWith("[unresolved:")) {
    issues.push({ type: "unresolved-output", field: path, blocking: false, message: `${path} is unresolved: ${value}` });
  } else if (value.startsWith("[missing ") || value.startsWith("[invalid ") || value.startsWith("[conflict:")) {
    issues.push({ type: "blocked-output", field: path, blocking: true, message: `${path} could not be produced safely: ${value}` });
  }
  return issues;
}

function cliNormalizeLineEndings(text) {
  return String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function cliHasLeadingZeroNumber(text) {
  return /^[-+]?0\d+(\.\d+)?$/.test(text);
}

function cliLooksNumeric(text) {
  return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(text);
}

function cliShouldPreserveString(header, text) {
  const key = String(header ?? "").trim().toLowerCase();
  if (/^(id|.*_id|.* id|sku|zip|postal_code|postcode|phone|tel|mobile)$/.test(key)) return true;
  if (/^\+\d[\d\s().-]{6,}$/.test(String(text ?? "").trim())) return true;
  return false;
}

function cliCoerceCSVValue(value, options = {}) {
  const text = options.trim === false ? String(value ?? "") : String(value ?? "").trim();
  if (text === "") return "";
  if (cliShouldPreserveString(options.header, text)) return text;
  if (text === "true") return true;
  if (text === "false") return false;
  if (cliHasLeadingZeroNumber(text)) return text;
  if (cliLooksNumeric(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) return number;
  }
  return text;
}

function cliParseCSVRecords(text, options = {}) {
  const separator = options.separator || ",";
  const source = cliNormalizeLineEndings(text).trim();
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

function cliDetectCSVSeparator(text, options = {}) {
  if (options.separator) return options.separator;
  if (typeof text !== "string" || !/\r|\n/.test(text)) return ",";
  const candidates = [",", ";", "\t"]
    .filter(separator => text.includes(separator))
    .map(separator => {
      try {
        const rows = cliParseCSVRecords(text, { separator });
        const width = rows[0]?.length || 0;
        const consistent = rows.length >= 2 && width >= 2 && rows.every(row => row.length === width);
        return { separator, rows: rows.length, width, consistent };
      } catch {
        return { separator, rows: 0, width: 0, consistent: false };
      }
    })
    .filter(candidate => candidate.consistent)
    .sort((first, second) => second.width - first.width || second.rows - first.rows);
  return candidates[0]?.separator || ",";
}

function cliParseCSV(text, options = {}) {
  const separator = cliDetectCSVSeparator(text, options);
  const rows = cliParseCSVRecords(text, { separator });
  if (rows.length < 2) throw new Error("CSV requires a header row and at least one data row.");
  const width = rows[0].length;
  if (width < 1) throw new Error("CSV requires at least one header.");
  const unevenRowIndex = rows.findIndex(row => row.length !== width);
  if (unevenRowIndex >= 0) throw new Error(`CSV row ${unevenRowIndex + 1} has ${rows[unevenRowIndex].length} columns; expected ${width}.`);
  const headers = rows[0].map(cell => String(cell.value).trim());
  const seen = new Set();
  for (const [index, header] of headers.entries()) {
    if (!header) throw new Error(`CSV header ${index + 1} is empty.`);
    if (seen.has(header)) throw new Error(`CSV header "${header}" is duplicated.`);
    seen.add(header);
  }
  const records = rows.slice(1).map(row => {
    const record = {};
    headers.forEach((header, index) => {
      const cell = row[index];
      const value = cell.quoted ? cell.value : String(cell.value).trim();
      record[header] = options.coerce === false ? value : cliCoerceCSVValue(value, { header, trim: !cell.quoted });
    });
    return record;
  });
  return options.singleRowAsObject && records.length === 1 ? records[0] : records;
}

function cliEscapeCSVField(value, separator = ",") {
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

function cliCollectCSVKeys(values) {
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

function cliSerializeCSV(value, options = {}) {
  const separator = options.separator || ",";
  const rows = Array.isArray(value) ? value : [value];
  if (!rows.length) return "";
  const keys = options.headers || cliCollectCSVKeys(rows);
  if (!keys.length) return "";
  const header = keys.map(key => cliEscapeCSVField(key, separator)).join(separator);
  const body = rows.map(row =>
    keys.map(key => {
      const item = row?.[key];
      return cliEscapeCSVField(item && typeof item === "object" ? JSON.stringify(item) : item, separator);
    }).join(separator)
  );
  return [header, ...body].join("\n");
}

function cliEnvClosingQuoteIndex(text, quote) {
  for (let index = 1; index < text.length; index++) {
    if (text[index] !== quote) continue;
    if (quote === "'") return index;
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) slashCount += 1;
    if (slashCount % 2 === 0) return index;
  }
  return -1;
}

function cliDecodeEnvDoubleQuotedValue(text) {
  return text.replace(/\\([nrt"\\])/g, (_, char) => {
    if (char === "n") return "\n";
    if (char === "r") return "\r";
    if (char === "t") return "\t";
    return char;
  });
}

function cliParseEnv(text) {
  const source = cliNormalizeLineEndings(text);
  if (!source.trim()) throw new Error(".env is empty.");
  const result = {};
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.replace(/^export\s+/, "");
    const eqIndex = cleaned.indexOf("=");
    if (eqIndex < 0) throw new Error(`.env line ${index + 1}: missing '='.`);
    const key = cleaned.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`.env line ${index + 1}: invalid key "${key || "(empty)"}".`);
    if (Object.prototype.hasOwnProperty.call(result, key)) throw new Error(`.env line ${index + 1}: duplicate key "${key}".`);
    let rawValue = cleaned.slice(eqIndex + 1).trim();
    if (rawValue.startsWith("\"") || rawValue.startsWith("'")) {
      const quote = rawValue[0];
      let endIndex = index;
      let closeIndex = cliEnvClosingQuoteIndex(rawValue, quote);
      while (closeIndex < 0 && endIndex + 1 < lines.length) {
        endIndex += 1;
        rawValue += `\n${lines[endIndex]}`;
        closeIndex = cliEnvClosingQuoteIndex(rawValue, quote);
      }
      if (closeIndex < 0) throw new Error(`.env line ${index + 1}: unterminated quoted value.`);
      const trailing = rawValue.slice(closeIndex + 1).trim();
      if (trailing && !trailing.startsWith("#")) throw new Error(`.env line ${index + 1}: unexpected text after quoted value.`);
      const value = rawValue.slice(1, closeIndex);
      result[key] = quote === "\"" ? cliDecodeEnvDoubleQuotedValue(value) : value;
      index = endIndex;
      continue;
    }
    const comment = rawValue.match(/(^|\s)#/);
    if (comment) rawValue = rawValue.slice(0, comment.index).trimEnd();
    result[key] = rawValue.trim();
  }
  if (!Object.keys(result).length) throw new Error(".env: no variables found.");
  return result;
}

function cliDetectEnv(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  const source = cliNormalizeLineEndings(text).trim();
  if (/^\s*[\[{]/.test(source)) return false;
  if (/^\s*\[{1,2}[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)*]{1,2}\s*$/m.test(source)) return false;
  try {
    const keys = Object.keys(cliParseEnv(source));
    const hasConventionalKey = keys.some(key => /^[A-Z_][A-Z0-9_]*$/.test(key));
    return hasConventionalKey || keys.length >= 2;
  } catch {
    return false;
  }
}

function cliSerializeEnv(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(".env output must be a flat object.");
  const lines = [];
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`.env invalid key "${key}".`);
    if (item && typeof item === "object") throw new Error(`.env cannot represent nested objects or arrays (key: "${key}"). Flatten the structure first.`);
    const text = item === null || item === undefined ? "" : String(item);
    const needsQuotes = text === "" || /[\s#"'\\\r\n\t]/.test(text) || text !== text.trim();
    const valueText = needsQuotes
      ? `"${text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`
      : text;
    lines.push(`${key}=${valueText}`);
  }
  if (!lines.length) return "";
  return `${lines.join("\n")}\n`;
}

function cliIsEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) slashCount += 1;
  return slashCount % 2 === 1;
}

function cliStripTOMLComment(line) {
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
    if (quote) {
      if (triple && next === quote.repeat(3)) {
        quote = null;
        triple = false;
        index += 2;
      } else if (!triple && char === quote && (quote === "'" || !cliIsEscaped(line, index))) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#") return line.slice(0, index);
  }
  return line;
}

function cliFindTOMLEquals(line) {
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
      } else if (!triple && char === quote && (quote === "'" || !cliIsEscaped(line, index))) {
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
    else if (char === "]" || char === "}") depth -= 1;
    else if (char === "=" && depth === 0) return index;
  }
  return -1;
}

function cliSplitTOMLTopLevel(value, separator = ",") {
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
      } else if (!triple && char === quote && (quote === "'" || !cliIsEscaped(value, index))) {
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
    else if (char === separator && square === 0 && curly === 0) {
      items.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) items.push(last);
  return items;
}

function cliTOMLIsBalanced(value) {
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
      } else if (!triple && char === quote && (quote === "'" || !cliIsEscaped(value, index))) {
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

function cliSplitTOMLDots(text) {
  const parts = [];
  let quote = null;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote && (quote === "'" || !cliIsEscaped(text, index))) quote = null;
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

function cliDecodeTOMLString(text) {
  return text.replace(/\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|([btnfr"\\]))/g, (_, shortCode, longCode, char) => {
    if (shortCode || longCode) return String.fromCodePoint(parseInt(shortCode || longCode, 16));
    if (char === "b") return "\b";
    if (char === "t") return "\t";
    if (char === "n") return "\n";
    if (char === "f") return "\f";
    if (char === "r") return "\r";
    return char;
  }).replace(/\\./g, match => {
    throw new Error(`TOML unsupported escape sequence "${match}".`);
  });
}

function cliParseTOMLKey(text) {
  const value = text.trim();
  if (/^[A-Za-z0-9_-]+$/.test(value)) return value;
  if (value.startsWith("\"") && value.endsWith("\"")) return cliDecodeTOMLString(value.slice(1, -1));
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  throw new Error(`TOML invalid key "${value}".`);
}

function cliParseTOMLPath(text) {
  const parts = cliSplitTOMLDots(text.trim()).map(cliParseTOMLKey);
  if (!parts.length || parts.some(part => part === "")) throw new Error(`TOML invalid key "${text}".`);
  return parts;
}

function cliSetTOMLValue(root, path, value) {
  let target = root;
  path.forEach((part, index) => {
    const last = index === path.length - 1;
    if (last) {
      if (Object.prototype.hasOwnProperty.call(target, part)) throw new Error(`TOML duplicate key "${path.join(".")}".`);
      target[part] = value;
      return;
    }
    if (target[part] === undefined) target[part] = {};
    if (!target[part] || typeof target[part] !== "object" || Array.isArray(target[part])) throw new Error(`TOML "${path.slice(0, index + 1).join(".")}" is not a table.`);
    target = target[part];
  });
}

function cliGetTOMLTable(root, path) {
  let target = root;
  for (const part of path) {
    if (target[part] === undefined) target[part] = {};
    if (Array.isArray(target[part])) {
      const last = target[part].at(-1);
      if (!last || typeof last !== "object" || Array.isArray(last)) throw new Error(`TOML "${part}" is not a table.`);
      target = last;
      continue;
    }
    if (!target[part] || typeof target[part] !== "object" || Array.isArray(target[part])) throw new Error(`TOML "${part}" is not a table.`);
    target = target[part];
  }
  return target;
}

function cliParseTOMLTripleString(value) {
  const quote = value[0];
  if (!value.endsWith(quote.repeat(3)) || value.length < 6) throw new Error("TOML unterminated multiline string.");
  let body = value.slice(3, -3);
  if (body.startsWith("\n")) body = body.slice(1);
  return quote === "\"" ? cliDecodeTOMLString(body) : body;
}

function cliParseTOMLValue(raw) {
  const value = raw.trim();
  if (!value) throw new Error("TOML missing value.");
  if (value.startsWith("\"\"\"") || value.startsWith("'''")) return cliParseTOMLTripleString(value);
  if (value.startsWith("\"")) {
    if (!value.endsWith("\"") || value.length === 1) throw new Error("TOML unterminated string.");
    return cliDecodeTOMLString(value.slice(1, -1));
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length === 1) throw new Error("TOML unterminated literal string.");
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith("[") && value.endsWith("]")) {
    const body = value.slice(1, -1).trim();
    return body ? cliSplitTOMLTopLevel(body).map(cliParseTOMLValue) : [];
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    const result = {};
    const body = value.slice(1, -1).trim();
    if (!body) return result;
    for (const item of cliSplitTOMLTopLevel(body)) {
      const eqIndex = cliFindTOMLEquals(item);
      if (eqIndex < 0) throw new Error("TOML inline table entry is missing '='.");
      cliSetTOMLValue(result, cliParseTOMLPath(item.slice(0, eqIndex)), cliParseTOMLValue(item.slice(eqIndex + 1)));
    }
    return result;
  }
  if (/^\d{4}-\d{2}-\d{2}(?:[Tt ][^\s]+)?$/.test(value)) return value;
  if (/^[+-]?0x[0-9A-Fa-f_]+$/.test(value)) return parseInt(value.replace(/_/g, "").replace(/^[+]?0x/i, ""), 16);
  if (/^[+-]?0o[0-7_]+$/.test(value)) return parseInt(value.replace(/_/g, "").replace(/^[+]?0o/i, ""), 8);
  if (/^[+-]?0b[01_]+$/.test(value)) return parseInt(value.replace(/_/g, "").replace(/^[+]?0b/i, ""), 2);
  if (/^[+-]?(?:\d[\d_]*)(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?$/.test(value)) {
    const number = Number(value.replace(/_/g, ""));
    if (Number.isFinite(number)) return number;
  }
  throw new Error(`TOML unsupported value "${value}".`);
}

function cliReadTOMLValueLines(lines, index, initial) {
  let raw = cliStripTOMLComment(initial);
  let endIndex = index;
  const startsMultilineString = /^(\s*)("""|''')/.test(raw);
  if (startsMultilineString && !cliTOMLIsBalanced(raw)) {
    while (!cliTOMLIsBalanced(raw) && endIndex + 1 < lines.length) {
      endIndex += 1;
      raw += `\n${lines[endIndex]}`;
    }
    return { raw: cliStripTOMLComment(raw), endIndex };
  }
  while (!cliTOMLIsBalanced(raw) && endIndex + 1 < lines.length) {
    endIndex += 1;
    raw += `\n${cliStripTOMLComment(lines[endIndex])}`;
  }
  return { raw, endIndex };
}

function cliParseTOML(text) {
  const source = cliNormalizeLineEndings(text);
  if (!source.trim()) throw new Error("TOML is empty.");
  const root = {};
  const explicitTables = new Set();
  const lines = source.split("\n");
  let current = root;
  for (let index = 0; index < lines.length; index++) {
    const cleaned = cliStripTOMLComment(lines[index]).trim();
    if (!cleaned) continue;
    const arrayTable = cleaned.match(/^\[\[\s*(.+?)\s*]]$/);
    if (arrayTable) {
      const path = cliParseTOMLPath(arrayTable[1]);
      const parent = cliGetTOMLTable(root, path.slice(0, -1));
      const key = path.at(-1);
      if (parent[key] === undefined) parent[key] = [];
      if (!Array.isArray(parent[key])) throw new Error(`TOML "${path.join(".")}" is not an array table.`);
      current = {};
      parent[key].push(current);
      continue;
    }
    const table = cleaned.match(/^\[\s*(.+?)\s*]$/);
    if (table) {
      const path = cliParseTOMLPath(table[1]);
      const key = path.join(".");
      if (explicitTables.has(key)) throw new Error(`TOML duplicate table "${key}".`);
      explicitTables.add(key);
      current = cliGetTOMLTable(root, path);
      continue;
    }
    const eqIndex = cliFindTOMLEquals(cleaned);
    if (eqIndex < 0) throw new Error("TOML expected a table header or key-value pair.");
    const { raw, endIndex } = cliReadTOMLValueLines(lines, index, cleaned.slice(eqIndex + 1));
    index = endIndex;
    if (!cliTOMLIsBalanced(raw)) throw new Error("TOML unterminated array, inline table, or string.");
    cliSetTOMLValue(current, cliParseTOMLPath(cleaned.slice(0, eqIndex)), cliParseTOMLValue(raw));
  }
  return root;
}

function cliDetectTOML(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  const source = cliNormalizeLineEndings(text).trim();
  if (/^\s*[\[{]/.test(source) && !source.includes("=")) return false;
  const dataLines = source.split("\n").map(line => cliStripTOMLComment(line).trim()).filter(Boolean);
  const envLike = dataLines.length > 0 && dataLines.every(line => /^(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=/.test(line));
  const startsEnvLike = /^(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=/.test(dataLines[0] || "");
  if ((envLike || startsEnvLike) && !/^\s*\[{1,2}/m.test(source)) return false;
  const hasTableHeader = /^\s*\[{1,2}\s*[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)*\s*]{1,2}\s*$/m.test(source);
  const hasTypedAssignment = /^\s*[A-Za-z0-9_.-]+\s*=\s*(?:"[^"]*"|'[^']*'|[+-]?\d|true|false|\[|\{)/m.test(source);
  const hasTOMLFeature = /^\s*[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\s*=/m.test(source)
    || /=\s*[\[{]/m.test(source)
    || /=\s*(?:true|false)\s*(?:#.*)?$/m.test(source)
    || /=\s*[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?\s*(?:#.*)?$/m.test(source)
    || /=\s*\d{4}-\d{2}-\d{2}/m.test(source);
  return hasTableHeader || (hasTypedAssignment && hasTOMLFeature);
}

function cliTOMLKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function cliTOMLInline(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(cliTOMLInline).join(", ")}]`;
  if (value && typeof value === "object") return `{ ${Object.entries(value).map(([key, item]) => `${cliTOMLKey(key)} = ${cliTOMLInline(item)}`).join(", ")} }`;
  throw new Error("TOML cannot serialize null values.");
}

function cliSerializeTOMLTable(value, path = [], lines = []) {
  const nested = [];
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined) continue;
    if (Array.isArray(item) && item.every(row => row && typeof row === "object" && !Array.isArray(row))) nested.push([key, item, "array"]);
    else if (item && typeof item === "object" && !Array.isArray(item)) nested.push([key, item, "table"]);
    else lines.push(`${cliTOMLKey(key)} = ${cliTOMLInline(item)}`);
  }
  for (const [key, item, type] of nested) {
    const nextPath = [...path, key];
    if (type === "array") {
      for (const row of item) {
        if (lines.length && lines.at(-1) !== "") lines.push("");
        lines.push(`[[${nextPath.map(cliTOMLKey).join(".")}]]`);
        cliSerializeTOMLTable(row, nextPath, lines);
      }
    } else {
      if (lines.length && lines.at(-1) !== "") lines.push("");
      lines.push(`[${nextPath.map(cliTOMLKey).join(".")}]`);
      cliSerializeTOMLTable(item, nextPath, lines);
    }
  }
  return lines;
}

function cliSerializeTOML(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("TOML output must be an object.");
  const lines = cliSerializeTOMLTable(value);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function cliDetectFormat(text) {
  if (typeof text !== "string" || !text.trim()) return "empty";
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(text);
      return "json";
    } catch {}
  }
  if (cliDetectTOML(text)) return "toml";
  if (cliDetectEnv(text)) return "env";
  try {
    const separator = cliDetectCSVSeparator(text);
    if (text.includes(separator) && /\r|\n/.test(text)) {
      const rows = cliParseCSVRecords(text, { separator });
      const width = rows[0]?.length || 0;
      if (rows.length >= 2 && width >= 2 && rows.every(row => row.length === width)) return "csv";
    }
  } catch {}
  return "unknown";
}

function cliParseInput(text, format) {
  if (format === "json") {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`JSON: ${error?.message || "could not parse input"}`);
    }
  }
  if (format === "csv") return cliParseCSV(text, { singleRowAsObject: true });
  if (format === "toml") return cliParseTOML(text);
  if (format === "env") return cliParseEnv(text);
  throw new Error(`Unsupported input format: ${format}. This CLI export supports json, csv, toml, and env.`);
}

function cliSerializeOutput(value, format, pretty = false) {
  if (format === "json") return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  if (format === "csv") return cliSerializeCSV(value);
  if (format === "toml") return cliSerializeTOML(value);
  if (format === "env") return cliSerializeEnv(value);
  throw new Error(`Unsupported output format: ${format}. This CLI export supports json, csv, toml, and env.`);
}

function cliParseArgs(argv) {
  const args = {
    file: null,
    out: null,
    report: null,
    format: null,
    output: null,
    help: false,
    info: false,
    readme: false,
    selfTest: false,
    sampleInput: false,
    sampleOutput: false,
    version: false,
    strict: false,
    warningsOk: false,
    stdout: false,
    printReport: false,
    quiet: false,
    pretty: false,
    dryRun: false,
    diagnostics: "text",
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--info") args.info = true;
    else if (arg === "--readme") args.readme = true;
    else if (arg === "--self-test") args.selfTest = true;
    else if (arg === "--sample-input") args.sampleInput = true;
    else if (arg === "--sample-output") args.sampleOutput = true;
    else if (arg === "--version" || arg === "-v") args.version = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--warnings-ok") args.warningsOk = true;
    else if (arg === "--stdout") args.stdout = true;
    else if (arg === "--print-report") args.printReport = true;
    else if (arg === "--quiet" || arg === "-q") args.quiet = true;
    else if (arg === "--pretty") args.pretty = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--format" && argv[index + 1]) args.format = argv[++index].toLowerCase();
    else if (arg === "--output" && argv[index + 1]) args.output = argv[++index].toLowerCase();
    else if (arg === "--out" && argv[index + 1]) args.out = argv[++index];
    else if (arg === "--report" && argv[index + 1]) args.report = argv[++index];
    else if (arg === "--diagnostics" && argv[index + 1]) args.diagnostics = argv[++index].toLowerCase();
    else if (!arg.startsWith("-") && !args.file) args.file = arg;
    else if (!arg.startsWith("-")) throw new Error(`Only one input file is supported. Unexpected argument: ${arg}`);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!["text", "json", "none"].includes(args.diagnostics)) throw new Error("--diagnostics must be text, json, or none.");
  if (args.quiet) args.diagnostics = "none";
  return args;
}

async function cliReadStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

function cliPrintHelp() {
  const preconditions = (PRECONDITIONS || []).map(item => `  ${item.field.padEnd(22)} ${item.type || "any"}${item.required ? ", required" : ""}`).join("\n") || "  None";
  process.stdout.write(`latentmachine-transform - deterministic data transformation tool

Usage:
  node latentmachine-transform.mjs [options] [file]
  cat data.json | node latentmachine-transform.mjs

Rule: ${META.title}
  Created: ${META.createdAt}
  Operations: ${META.operationCount}
  Input format: ${META.inputFormat.toUpperCase()}
  Output format: ${META.outputFormat.toUpperCase()}
  Confidence: ${META.confidenceLabel ?? "unknown"}${META.confidenceChecks ? ` (${META.confidenceChecks.passed}/${META.confidenceChecks.total} checks)` : ""}

Preconditions:
${preconditions}

Options:
  --help                 Show this message
  --readme               Print a fuller usage guide
  --info                 Print baked rule metadata as JSON
  --self-test            Verify this exported file against its baked sample
  --sample-input         Print the baked sample input, if available
  --sample-output        Print the baked sample output, if available
  --format json|csv|toml|env  Override input format detection
  --output json|csv|toml|env  Override output format
  --stdout               Write transformed output to stdout (default)
  --out file             Write transformed output to a file instead of stdout
  --report file          Write a JSON run report to a file
  --print-report         Print the JSON run report to stdout; requires --out
  --strict               Treat warnings as blocking failures
  --warnings-ok          Exit 0 when output has warnings
  --quiet                Suppress diagnostics on stderr
  --pretty               Pretty-print JSON output
  --dry-run              Validate input without producing output
  --diagnostics text|json|none
  --version              Print version info
`);
}

function cliPrintInfo() {
  process.stdout.write(`${JSON.stringify({ meta: META, preconditions: PRECONDITIONS, rule: RULE, sample: { available: SAMPLE.available, inputFormat: SAMPLE.inputFormat, outputFormat: SAMPLE.outputFormat } }, null, 2)}\n`);
}

function cliPrintVersion() {
  process.stdout.write(`Latentmachine CLI export ${META.cliVersion}; rule created ${META.createdAt}\n`);
}

function cliPrintReadme() {
  const filename = META.filename || "latentmachine-transform.mjs";
  const inputFile = `input.${META.inputFormat === "csv" ? "csv" : META.inputFormat === "toml" ? "toml" : META.inputFormat === "env" ? "env" : "json"}`;
  const outputFile = `output.${META.outputFormat === "csv" ? "csv" : META.outputFormat === "toml" ? "toml" : META.outputFormat === "env" ? "env" : "json"}`;
  process.stdout.write(`# Latentmachine CLI Export

This is a self-contained deterministic transformation exported from Latentmachine.
It applies one frozen rule. It does not infer new rules, install packages, call a server, or modify your input file.

## Rule

- Title: ${META.title}
- Created: ${META.createdAt}
- Operations: ${META.operationCount}
- Input format: ${META.inputFormat}
- Output format: ${META.outputFormat}
- Confidence: ${META.confidenceLabel ?? "unknown"}${META.confidenceChecks ? ` (${META.confidenceChecks.passed}/${META.confidenceChecks.total} checks)` : ""}

## Quick start

\`\`\`bash
node ${filename} --self-test
node ${filename} --help
cat ${inputFile} | node ${filename} > ${outputFile}
node ${filename} ${inputFile} --out ${outputFile} --report report.json
node ${filename} ${inputFile} --out ${outputFile} --print-report
\`\`\`

## Reliability checks

\`\`\`bash
node ${filename} --self-test
node ${filename} --dry-run ${inputFile}
node ${filename} ${inputFile} --diagnostics json 2> diagnostics.json
\`\`\`

## Exit codes

- 0: output produced cleanly.
- 1: output produced with warnings. Review stderr or the JSON report.
- 2: blocked. No safe output was produced.

## CI pattern

\`\`\`bash
node ${filename} ${inputFile} --out ${outputFile} --report report.json --strict
\`\`\`

Use --strict when warnings should fail the job.
Use --warnings-ok when warnings should be reported but should not fail the job.
Use --report when another script needs structured status and diagnostics.
Use --print-report with --out when a parent process should read report JSON from stdout.
`);
}

function cliPrintSampleInput() {
  if (!SAMPLE.available) {
    process.stderr.write("Error: this export does not contain a baked sample input.\n");
    process.exit(2);
  }
  process.stdout.write(SAMPLE.inputText);
  if (!SAMPLE.inputText.endsWith("\n")) process.stdout.write("\n");
}

function cliPrintSampleOutput() {
  if (!SAMPLE.available) {
    process.stderr.write("Error: this export does not contain a baked sample output.\n");
    process.exit(2);
  }
  process.stdout.write(cliSerializeOutput(SAMPLE.expectedOutput, SAMPLE.outputFormat || META.outputFormat || "json", true));
  process.stdout.write("\n");
}

function cliDeepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => cliDeepEqual(item, b[index]));
  }
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, index) => key === keysB[index] && cliDeepEqual(a[key], b[key]));
}

function cliTransformItems(items, isBatch) {
  const outputs = [];
  const diagnostics = [];
  for (const [index, item] of items.entries()) {
    const output = transform(item);
    outputs.push(output);
    diagnostics.push(...cliCollectOutputIssues(output).map(issue => ({ ...issue, row: isBatch ? index : null })));
  }
  return { outputs, diagnostics };
}

function cliTransformInput(input) {
  const isBatch = Array.isArray(input) && input.every(item => item && typeof item === "object" && !Array.isArray(item));
  const items = isBatch ? input : [input];
  const preDiagnostics = items.flatMap((item, index) => cliValidateItem(item, isBatch ? index : null));
  if (preDiagnostics.some(issue => issue.blocking)) return { output: null, diagnostics: preDiagnostics, blocked: true, isBatch };
  const transformed = cliTransformItems(items, isBatch);
  const diagnostics = [...preDiagnostics, ...transformed.diagnostics];
  return {
    output: isBatch ? transformed.outputs : transformed.outputs[0],
    diagnostics,
    blocked: diagnostics.some(issue => issue.blocking),
    isBatch,
  };
}

function cliRunSelfTest() {
  if (!SAMPLE.available) {
    process.stderr.write("Error: this export does not contain a baked self-test sample.\n");
    process.exit(2);
  }
  let input;
  try {
    input = cliParseInput(SAMPLE.inputText, SAMPLE.inputFormat || META.inputFormat || "json");
  } catch (error) {
    process.stderr.write(`Self-test failed while parsing sample input: ${error.message}\n`);
    process.exit(2);
  }
  const result = cliTransformInput(input);
  if (result.blocked) {
    cliWriteDiagnostics(result.diagnostics, { diagnostics: "text" });
    process.stderr.write("Self-test failed: baked sample produced blocking diagnostics.\n");
    process.exit(2);
  }
  if (!cliDeepEqual(result.output, SAMPLE.expectedOutput)) {
    process.stderr.write("Self-test failed: transformed output did not match the baked expected output.\n");
    process.stderr.write(`Expected: ${JSON.stringify(SAMPLE.expectedOutput)}\n`);
    process.stderr.write(`Received: ${JSON.stringify(result.output)}\n`);
    process.exit(2);
  }
  process.stdout.write(`OK: self-test passed for "${META.title}".\n`);
}

function cliWriteDiagnostics(rows, args) {
  if (args.diagnostics === "none" || !rows.length) return;
  if (args.diagnostics === "json") {
    process.stderr.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }
  for (const row of rows) {
    const prefix = row.row === null || row.row === undefined ? "" : `Row ${row.row + 1}: `;
    const label = row.blocking ? "Error" : "Warning";
    process.stderr.write(`${label}: ${prefix}${row.message}\n`);
  }
}

function cliSummarizeDiagnostics(rows, totalRecords) {
  const summary = {
    totalRecords,
    cleanRecords: totalRecords,
    warningRecords: 0,
    blockedRecords: 0,
    warnings: rows.filter(row => !row.blocking).length,
    errors: rows.filter(row => row.blocking).length,
  };
  const byRow = new Map();
  for (const row of rows) {
    const key = row.row ?? 0;
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push(row);
  }
  for (const issues of byRow.values()) {
    if (issues.some(issue => issue.blocking)) {
      summary.blockedRecords += 1;
      summary.cleanRecords -= 1;
    } else if (issues.length) {
      summary.warningRecords += 1;
      summary.cleanRecords -= 1;
    }
  }
  return summary;
}

function cliBuildReport({ startedAt, durationMs, inputSource, outputTarget, inputFormat, outputFormat, diagnostics, totalRecords, exitCode, wroteOutput, dryRun, warningsOk }) {
  const hasErrors = diagnostics.some(row => row.blocking);
  const hasWarnings = diagnostics.some(row => !row.blocking);
  return {
    meta: META,
    status: hasErrors ? "blocked" : hasWarnings ? "warning" : "success",
    exitCode,
    startedAt,
    durationMs,
    inputSource,
    outputTarget,
    warningsOk: !!warningsOk,
    dryRun,
    inputFormat,
    outputFormat,
    wroteOutput,
    summary: cliSummarizeDiagnostics(diagnostics, totalRecords),
    diagnostics,
  };
}

async function cliWriteReport(args, report) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (args.report) {
    try {
      await writeFile(args.report, serialized, "utf-8");
    } catch (error) {
      process.stderr.write(`Error: could not write report ${args.report}: ${error.message}\n`);
      process.exit(2);
    }
  }
  if (args.printReport) {
    process.stdout.write(serialized);
  }
}

function cliInputSource(args) {
  return args.file ? { type: "file", path: args.file } : { type: "stdin" };
}

function cliOutputTarget(args) {
  return args.out ? { type: "file", path: args.out } : { type: "stdout" };
}

async function cliWriteOutput(args, serialized) {
  if (!args.out) {
    process.stdout.write(serialized);
    if (!serialized.endsWith("\n")) process.stdout.write("\n");
    return true;
  }
  try {
    await writeFile(args.out, serialized.endsWith("\n") ? serialized : `${serialized}\n`, "utf-8");
    return true;
  } catch (error) {
    process.stderr.write(`Error: could not write output ${args.out}: ${error.message}\n`);
    process.exit(2);
  }
}

function cliValidateItem(item, index = null) {
  return [
    ...cliCheckPreconditions(item),
    ...cliRuntimeWarnings(item),
  ].map(issue => ({ ...issue, row: index }));
}

async function cliMain() {
  let args;
  try {
    args = cliParseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\nRun with --help for usage.\n`);
    process.exit(2);
  }

  if (args.help) {
    cliPrintHelp();
    return;
  }
  if (args.readme) {
    cliPrintReadme();
    return;
  }
  if (args.version) {
    cliPrintVersion();
    return;
  }
  if (args.info) {
    cliPrintInfo();
    return;
  }
  if (args.sampleInput) {
    cliPrintSampleInput();
    return;
  }
  if (args.sampleOutput) {
    cliPrintSampleOutput();
    return;
  }
  if (args.selfTest) {
    cliRunSelfTest();
    return;
  }

  if (args.out && args.stdout) {
    process.stderr.write("Error: --out and --stdout cannot be combined. Choose one output target.\n");
    process.exit(2);
  }
  if (args.printReport && !args.out) {
    process.stderr.write("Error: --print-report requires --out so stdout stays reserved for report JSON.\n");
    process.exit(2);
  }

  const startedAtMs = Date.now();
  const runContext = {
    startedAt: new Date(startedAtMs).toISOString(),
    inputSource: cliInputSource(args),
    outputTarget: cliOutputTarget(args),
  };
  const reportContext = () => ({ ...runContext, durationMs: Date.now() - startedAtMs });

  let raw;
  if (args.file) {
    try {
      raw = await readFile(args.file, "utf-8");
    } catch (error) {
      process.stderr.write(`Error: could not read ${args.file}: ${error.message}\n`);
      process.exit(2);
    }
  } else {
    raw = await cliReadStdin();
    if (!raw.trim()) {
      cliPrintHelp();
      process.stderr.write("\nError: no input. Pipe data to stdin or pass a file path.\n");
      process.exit(2);
    }
  }

  const inputFormat = args.format || cliDetectFormat(raw);
  if (inputFormat === "empty" || inputFormat === "unknown") {
    process.stderr.write("Error: could not detect input format. Use --format json, --format csv, --format toml, or --format env.\n");
    process.exit(2);
  }

  let input;
  try {
    input = cliParseInput(raw, inputFormat);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(2);
  }

  const isBatch = Array.isArray(input) && input.every(item => item && typeof item === "object" && !Array.isArray(item));
  const items = isBatch ? input : [input];
  const diagnostics = items.flatMap((item, index) => cliValidateItem(item, isBatch ? index : null));
  const outputFormat = args.output || META.outputFormat || "json";

  if (args.dryRun) {
    cliWriteDiagnostics(diagnostics, args);
    if (!diagnostics.length && args.diagnostics !== "none") process.stderr.write("OK: input validates against the rule preconditions.\n");
    const exitCode = diagnostics.some(issue => issue.blocking) ? 2 : diagnostics.length && !args.warningsOk ? 1 : 0;
    await cliWriteReport(args, cliBuildReport({
      ...reportContext(),
      inputFormat,
      outputFormat,
      diagnostics,
      totalRecords: items.length,
      exitCode,
      warningsOk: args.warningsOk,
      wroteOutput: false,
      dryRun: true,
    }));
    process.exit(exitCode);
  }

  const preBlocking = diagnostics.filter(issue => issue.blocking);
  if (preBlocking.length) {
    cliWriteDiagnostics(diagnostics, args);
    await cliWriteReport(args, cliBuildReport({
      ...reportContext(),
      inputFormat,
      outputFormat,
      diagnostics,
      totalRecords: items.length,
      exitCode: 2,
      warningsOk: args.warningsOk,
      wroteOutput: false,
      dryRun: false,
    }));
    process.exit(2);
  }

  const transformed = cliTransformItems(items, isBatch);
  const outputs = transformed.outputs;
  const outputDiagnostics = [...diagnostics, ...transformed.diagnostics];

  const blocking = outputDiagnostics.filter(issue => issue.blocking);
  if (blocking.length || (args.strict && outputDiagnostics.length)) {
    cliWriteDiagnostics(outputDiagnostics, args);
    await cliWriteReport(args, cliBuildReport({
      ...reportContext(),
      inputFormat,
      outputFormat,
      diagnostics: outputDiagnostics,
      totalRecords: items.length,
      exitCode: 2,
      warningsOk: args.warningsOk,
      wroteOutput: false,
      dryRun: false,
    }));
    process.exit(2);
  }

  let serialized;
  try {
    serialized = cliSerializeOutput(isBatch ? outputs : outputs[0], outputFormat, args.pretty);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(2);
  }

  const exitCode = outputDiagnostics.length && !args.warningsOk ? 1 : 0;
  await cliWriteOutput(args, serialized);
  await cliWriteReport(args, cliBuildReport({
    ...reportContext(),
    inputFormat,
    outputFormat,
    diagnostics: outputDiagnostics,
    totalRecords: items.length,
    exitCode,
    warningsOk: args.warningsOk,
    wroteOutput: true,
    dryRun: false,
  }));
  cliWriteDiagnostics(outputDiagnostics, args);
  process.exit(exitCode);
}

function missingValueExpr(path) {
  return literal(`[missing ${path}]`);
}

function invalidNumberExpr(path) {
  return literal(`[invalid number ${path}]`);
}

function invalidQuantityExpr(path) {
  return literal(`[invalid quantity ${path}]`);
}

function withRequiredSource(op, root, valueExpr) {
  const value = pathToAccess(op.source, root);
  return `(() => { const source = ${value}; return source === undefined ? ${missingValueExpr(op.source)} : ${valueExpr("source")}; })()`;
}

function opValueExpr(op, root = "input", opIndex = 0) {
  if (op.op === "set") return withRequiredSource(op, root, value => value);
  if (op.op === "constant") return literal(op.value);
  if (op.op === "coerce") {
    if (op.to === "number") return withRequiredSource(op, root, value => `typeof ${value} === "string" && ${value}.trim() !== "" && Number.isFinite(Number(${value})) ? Number(${value}) : ${value}`);
    if (op.to === "string") return withRequiredSource(op, root, value => `${value} === null ? ${value} : String(${value})`);
    if (op.to === "boolean") return withRequiredSource(op, root, value => `(() => { if (${value} === "true") return true; if (${value} === "false") return false; return ${value}; })()`);
    return withRequiredSource(op, root, value => value);
  }
  if (op.op === "stringCase") return withRequiredSource(op, root, value => stringTransformExpr(value, op.mode, { source: op.source }));
  if (op.op === "stringNormalize") return withRequiredSource(op, root, value => stringTransformExpr(value, op.mode, { source: op.source, phonePolicy: op.phonePolicy }));
  if (op.op === "numericTransform") {
    return withRequiredSource(op, root, value => `(() => { const number = Number(${value}); if (!Number.isFinite(number)) return ${invalidNumberExpr(op.source)}; return ${op.mode === "add" ? `number + ${literal(op.value)}` : op.mode === "multiply" ? `number * ${literal(op.value)}` : "number"}; })()`);
  }
  if (op.op === "numericBinary") {
    const leftValue = pathToAccess(op.left, root);
    const rightValue = pathToAccess(op.right, root);
    const operation = op.mode === "add" ? "left + right" : op.mode === "subtract" ? "left - right" : op.mode === "multiply" ? "left * right" : "left";
    return `(() => { const left = Number(${leftValue}); const right = Number(${rightValue}); if (!Number.isFinite(left)) return ${invalidNumberExpr(op.left)}; if (!Number.isFinite(right)) return ${invalidNumberExpr(op.right)}; return ${operation}; })()`;
  }
  if (op.op === "quantityTransform") {
    return withRequiredSource(op, root, value => `(() => { const match = String(${value} ?? "").trim().match(/^(-?\\d+(?:\\.\\d+)?)([a-zA-Z]+)$/); if (!match || match[2] !== ${literal(op.unit)}) return ${invalidQuantityExpr(op.source)}; const amount = Number(match[1]); if (!Number.isFinite(amount)) return ${invalidQuantityExpr(op.source)}; return String(Number((amount * ${literal(op.factor)}).toFixed(6))) + match[2]; })()`);
  }
  if (op.op === "booleanNot") return withRequiredSource(op, root, value => `!${value}`);
  if (op.op === "conditional") {
    const expected = literal(JSON.stringify(op.value));
    return withRequiredSource(op, root, source => {
      const test = op.test === "notEquals"
        ? `JSON.stringify(${source}) !== ${expected}`
        : `JSON.stringify(${source}) === ${expected}`;
      return `(${test} ? ${literal(op.then)} : ${literal(op.else)})`;
    });
  }
  if (op.op === "fallback") {
    const checks = (op.sources || []).map(source => {
      const access = pathToAccess(source, root);
      return `(() => { const value = ${access}; return value !== undefined && value !== null && value !== "" ? value : undefined; })()`;
    });
    return `${checks.join(" ?? ")} ?? null`;
  }
  if (op.op === "dateFormat") {
    return withRequiredSource(op, root, value => `(() => { const text = String(${value} ?? ""); const iso = text.match(/^(\\d{4})-(\\d{2})-(\\d{2})/); const eu = text.match(/^(\\d{2})[-/](\\d{2})[-/](\\d{4})$/); if (${literal(op.mode)} === "isoDate") return iso ? iso.slice(1, 4).join("-") : eu ? [eu[3], eu[2], eu[1]].join("-") : ${literal(`[invalid date ${op.source}]`)}; if (${literal(op.mode)} === "yearMonth") return iso ? iso.slice(1, 3).join("-") : ${literal(`[invalid date ${op.source}]`)}; if (${literal(op.mode)} === "year") return (text.match(/(\\d{4})/)?.[1] ?? ${literal(`[invalid date ${op.source}]`)}); return text; })()`);
  }
  if (op.op === "extractBetween") {
    const prefix = literal(op.prefix || "");
    const suffix = literal(op.suffix || "");
    return withRequiredSource(op, root, value => `(() => { const text = String(${value} ?? ""); const start = ${op.prefix ? `text.indexOf(${prefix})` : "0"}; const from = start + ${String(op.prefix || "").length}; const end = ${op.suffix ? `text.indexOf(${suffix}, from)` : "text.length"}; return start < 0 || end < from ? "" : text.slice(from, end); })()`);
  }
  if (op.op === "regexExtract") {
    return withRequiredSource(op, root, value => (
      `(() => { let pattern; try { pattern = new RegExp(${literal(op.pattern)}); } catch { return ""; } const match = String(${value} ?? "").match(pattern); return match?.[${op.group || 0}] ?? ""; })()`
    ));
  }
  if (op.op === "template") {
    return "`" + (op.parts || []).map(part => {
      if (part.kind === "literal") return String(part.value).replace(/[`$\\]/g, "\\$&");
      return "${" + `(() => { const source = ${pathToAccess(part.path, root)}; return source === undefined ? ${missingValueExpr(part.path)} : ${stringTransformExpr("source", part.transform || "identity", { source: part.path })}; })()` + "}";
    }).join("") + "`";
  }
  if (op.op === "concat") {
    const pieces = (op.sources || []).map((source, index) => {
      const prefix = index ? literal(op.separators?.[index - 1] || "") : null;
      const value = `String(${pathToAccess(source, root)} ?? "")`;
      return prefix ? `${prefix} + ${value}` : value;
    });
    return pieces.length ? pieces.join(" + ") : "\"\"";
  }
  if (op.op === "templateConflict") return literal(`[conflict: examples disagree for ${op.target}]`);
  if (op.op === "valueMapConflict") return literal(`[conflict: examples disagree for ${op.target}]`);
  if (op.op === "splitPart") return withRequiredSource(op, root, value => `String(${value} ?? "").split(${literal(op.separator)})[${op.index}] ?? ""`);
  if (op.op === "stringSplit") {
    const value = pathToAccess(op.source, root);
    const split = `${value}.split(${literal(op.separator)})`;
    const result = op.trim ? `${split}.map(part => part.trim())` : split;
    return `typeof ${value} === "string" ? ${result} : []`;
  }
  if (op.op === "arrayStringTransform") {
    const rows = `(${pathToAccess(op.source, root)} ?? [])`;
    return `Array.isArray(${rows}) ? ${rows}.map(value => typeof value === "string" ? ${stringTransformExpr("value", op.mode, { source: op.source, phonePolicy: op.phonePolicy })} : value) : []`;
  }
  if (op.op === "valueMap") {
    const mapName = `map_${opIndex}`;
    const source = pathToAccess(op.source, root);
    return `(() => { const source = ${source}; if (source === undefined) return ${missingValueExpr(op.source)}; const key = JSON.stringify(source); return Object.prototype.hasOwnProperty.call(${mapName}, key) ? ${mapName}[key] : ${literal(`[unresolved: unseen value at ${op.source}]`)}; })()`;
  }
  if (op.op === "arrayMap") {
    const rows = `(${pathToAccess(op.source, root)} ?? [])`;
    const where = op.where ? `.filter(row => JSON.stringify(${pathToAccess(op.where.path, "row")}) === ${literal(JSON.stringify(op.where.equals))})` : "";
    return `Array.isArray(${rows}) ? ${rows}${where}.map(row => ${pathToAccess(op.extract, "row")}) : []`;
  }
  if (op.op === "arrayProject") {
    const rows = `(${pathToAccess(op.source, root)} ?? [])`;
    const where = op.where ? `.filter(row => JSON.stringify(${pathToAccess(op.where.path, "row")}) === ${literal(JSON.stringify(op.where.equals))})` : "";
    const fields = (op.fields || []).flatMap(field => {
      const value = pathToAccess(field.source, "row");
      const projected = field.transform
        ? `(() => { const source = ${value}; return source === undefined ? undefined : ${stringTransformExpr("source", field.transform, { source: field.source })}; })()`
        : value;
      return pathToSet(field.target, projected, "record");
    }).join(" ");
    return `Array.isArray(${rows}) ? ${rows}${where}.map(row => { const record = {}; ${fields} return record; }) : []`;
  }
  if (op.op === "arrayCount") {
    const rows = `(${pathToAccess(op.source, root)} ?? [])`;
    const where = op.where ? `.filter(row => JSON.stringify(${pathToAccess(op.where.path, "row")}) === ${literal(JSON.stringify(op.where.equals))})` : "";
    return `Array.isArray(${rows}) ? ${rows}${where}.length : 0`;
  }
  if (op.op === "arrayJoin") {
    const rows = `(${pathToAccess(op.source, root)} ?? [])`;
    const where = op.where ? `.filter(row => JSON.stringify(${pathToAccess(op.where.path, "row")}) === ${literal(JSON.stringify(op.where.equals))})` : "";
    const value = op.extract ? pathToAccess(op.extract, "row") : "row";
    return `Array.isArray(${rows}) ? ${rows}${where}.map(row => ${value}).join(${literal(op.separator)}) : ""`;
  }
  if (op.op === "arrayFind") {
    const source = pathToAccess(op.source, root);
    const where = op.where ? `row => JSON.stringify(${pathToAccess(op.where.path, "row")}) === ${literal(JSON.stringify(op.where.equals))}` : "() => true";
    const extract = pathToAccess(op.extract, "found");
    return `(() => { const arr = ${source} ?? []; if (!Array.isArray(arr)) return undefined; const found = arr.find(${where}) || {}; return ${extract}; })()`;
  }
  if (op.op === "arrayGroupBy") {
    const rows = `(${pathToAccess(op.source, root)} ?? [])`;
    const groupBy = pathToAccess(op.groupBy, "row");
    const extract = pathToAccess(op.extract, "row");
    return `(() => { const arr = ${rows}; if (!Array.isArray(arr)) return {}; const result = Object.create(null); for (const row of arr) { const key = String(${groupBy} ?? ""); result[key] ||= []; result[key].push(${extract}); } return result; })()`;
  }
  return "null";
}

function mapDeclarations(program) {
  const maps = [];
  for (const [index, op] of (program?.ops || []).entries()) {
    if (op.op !== "valueMap") continue;
    const name = `map_${index}`;
    maps.push(`const ${name} = ${JSON.stringify(op.map, null, 2)};`);
  }
  return maps;
}

function operationLines(result) {
  return (result?.rule?.display || []).map(line => `//   ${line}`).join("\n");
}

function confidenceSummary(result) {
  const confidence = result?.confidence || result?.reliability?.confidence || {};
  const label = result?.reliability?.supportLabel || confidence.label || "unknown";
  const checks = confidence.checks && Number.isFinite(confidence.checks.passed) && Number.isFinite(confidence.checks.total)
    ? ` (${confidence.checks.passed}/${confidence.checks.total} checks)`
    : "";
  return `${label}${checks}`;
}

function outputObjectLines(program, root = "input") {
  return (program?.ops || []).flatMap((op, index) => pathToSet(op.target, opValueExpr(op, root, index), "output"));
}

function jqKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key);
}

function pathToJq(path, root = ".") {
  const parts = parsePath(path);
  if (!parts.length) return root;
  const expression = parts.reduce((expr, part) => {
    if (typeof part === "number") return `${expr}[${part}]`;
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(part) ? `${expr}.${part}` : `${expr}[${JSON.stringify(part)}]`;
  }, root);
  return root === "." ? expression.replace(/^\.\./, ".") : expression;
}

function jsonPathKey(part) {
  if (typeof part === "number") return `[${part}]`;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`;
}

function appendJsonPath(base, path) {
  return `${base}${parsePath(path).map(jsonPathKey).join("")}`;
}

function jqEqualsExpression(where) {
  if (!where?.path) return null;
  return `${pathToJq(where.path)} == ${literal(where.equals)}`;
}

function jsonPathEqualsExpression(where) {
  if (!where?.path) return null;
  if (!["string", "number", "boolean"].includes(typeof where.equals) && where.equals !== null) return null;
  const path = appendJsonPath("@", where.path);
  return `${path} == ${literal(where.equals)}`;
}

function unsupportedJq(op, reason = "this operation is outside the jq subset Latentmachine exports") {
  const name = op?.op || "unknown";
  throw new Error(`Cannot export ${name} to jq: ${reason}.`);
}

function jqArrayRows(op) {
  const source = `${pathToJq(op.source)}[]`;
  const filter = op.where ? ` | select(${jqEqualsExpression(op.where)})` : "";
  return `${source}${filter}`;
}

function jqArrayPipeline(op, valueExpression) {
  return `[${jqArrayRows(op)} | ${valueExpression}]`;
}

function jqObjectValue(expr) {
  const closeIndex = expr.startsWith("[") ? expr.lastIndexOf("]") : -1;
  return closeIndex >= 0 && expr.slice(closeIndex + 1).trim().startsWith("|") ? `(${expr})` : expr;
}

function makeJqTargetTree(items) {
  const root = { children: new Map(), expr: null };
  for (const item of items) {
    const parts = parsePath(item.target || "$");
    if (!parts.length) {
      root.expr = item.expr;
      continue;
    }
    let cursor = root;
    for (const part of parts) {
      if (typeof part === "number") unsupportedJq(item.op, "array index targets are not part of the object-construction exporter");
      if (!cursor.children.has(part)) cursor.children.set(part, { children: new Map(), expr: null });
      cursor = cursor.children.get(part);
    }
    cursor.expr = item.expr;
  }
  return root;
}

function renderJqTargetTree(node) {
  if (node.expr && !node.children.size) return node.expr;
  if (node.expr && node.children.size) throw new Error("Cannot export overlapping jq targets.");
  const fields = [...node.children.entries()].map(([key, child]) => `${jqKey(key)}: ${jqObjectValue(renderJqTargetTree(child))}`);
  return `{${fields.join(", ")}}`;
}

function jqProjectionObject(fields = []) {
  if (!fields.length) unsupportedJq({ op: "arrayProject" }, "projection fields are empty");
  const items = fields.map(field => ({
    target: field.target,
    expr: field.transform ? unsupportedJq({ op: "arrayProject" }, "field transforms need JavaScript fallback") : pathToJq(field.source),
    op: { op: "arrayProject" },
  }));
  return renderJqTargetTree(makeJqTargetTree(items));
}

function jqValueExpression(op) {
  if (op.op === "set") return pathToJq(op.source);
  if (op.op === "constant") return literal(op.value);
  if (op.op === "conditional") {
    const source = pathToJq(op.source);
    const test = op.test === "notEquals"
      ? `${source} != ${literal(op.value)}`
      : `${source} == ${literal(op.value)}`;
    return `if ${test} then ${literal(op.then)} else ${literal(op.else)} end`;
  }
  if (op.op === "fallback") {
    return (op.sources || []).reduceRight((otherwise, source) => {
      const value = pathToJq(source);
      return `if (${value} != null and ${value} != "") then ${value} else ${otherwise} end`;
    }, "null");
  }
  if (op.op === "regexExtract") unsupportedJq(op, "regex extraction requires JavaScript");
  if (op.op === "arrayMap") return jqArrayPipeline(op, pathToJq(op.extract));
  if (op.op === "arrayProject") return jqArrayPipeline(op, jqProjectionObject(op.fields || []));
  if (op.op === "arrayCount") return `[${jqArrayRows(op)}] | length`;
  if (op.op === "arrayJoin") return `${jqArrayPipeline(op, op.extract ? pathToJq(op.extract) : ".")} | join(${literal(op.separator || "")})`;
  if (op.op === "arrayFind") return `first(${jqArrayRows(op)} | ${pathToJq(op.extract)})`;
  if (op.op === "arrayGroupBy") {
    return `${pathToJq(op.source)} | group_by(${pathToJq(op.groupBy)}) | map({key: (.[0] | ${pathToJq(op.groupBy)} | tostring), value: [.[] | ${pathToJq(op.extract)}]}) | from_entries`;
  }
  unsupportedJq(op);
}

function normalizeProgram(input) {
  if (input?.ops) return input;
  return input?.rule?.program || { ops: [] };
}

export function generateJqQuery(programOrResult) {
  const program = normalizeProgram(programOrResult);
  const ops = program?.ops || [];
  if (!ops.length) return ".";
  const items = ops.map(op => ({ target: op.target || "$", expr: jqValueExpression(op), op }));
  return renderJqTargetTree(makeJqTargetTree(items));
}

function opJsonPath(op) {
  if (op.op === "set") return pathToJq(op.source, "$");
  if (op.op !== "arrayMap") return null;
  const source = pathToJq(op.source, "$");
  const extract = parsePath(op.extract).map(jsonPathKey).join("");
  if (!op.where) return `${source}[*]${extract}`;
  const predicate = jsonPathEqualsExpression(op.where);
  return predicate ? `${source}[?(${predicate})]${extract}` : null;
}

export function generateJsonPath(programOrResult) {
  const program = normalizeProgram(programOrResult);
  const ops = program?.ops || [];
  if (ops.length !== 1) return null;
  const [op] = ops;
  if (op.target && op.target !== "$") return null;
  return opJsonPath(op);
}

export function generateJavaScriptTransform(result) {
  const program = result?.rule?.program || { ops: [] };
  const maps = mapDeclarations(program);
  const confidence = confidenceSummary(result);
  return `// Latentmachine - inferred transformation
// Status: ${result?.status || "unknown"} | Confidence: ${confidence}
//
// Rule: ${result?.rule?.title || "Untitled rule"}
// Operations:
${operationLines(result)}

function transform(input) {
${maps.map(line => `  ${line.replace(/\n/g, "\n  ")}`).join("\n")}
  let output = {};
${outputObjectLines(program).map(line => `  ${line}`).join("\n")}
  return output;
}`;
}

export function generateMakeCode(result) {
  const program = result?.rule?.program || { ops: [] };
  const maps = mapDeclarations(program);
  return `// Latentmachine - Make.com JavaScript transformation
// Add this in a JavaScript module. Replace input with your bundle payload if needed.
//
// Rule: ${result?.rule?.title || "Untitled rule"}
// Operations:
${operationLines(result)}

${maps.join("\n")}

const input = inputData || {};
let output = {};
${outputObjectLines(program).join("\n")}

return output;`;
}

export function generatePlainFunction(result) {
  return `${generateJavaScriptTransform(result)}

export { transform };`;
}

function cliRuntimeSource() {
  return [
    cliTypeOf,
    cliParsePath,
    cliGetPath,
    cliOpSources,
    cliCheckPreconditions,
    cliRuntimeWarnings,
    cliCollectOutputIssues,
    cliNormalizeLineEndings,
    cliHasLeadingZeroNumber,
    cliLooksNumeric,
    cliShouldPreserveString,
    cliCoerceCSVValue,
    cliParseCSVRecords,
    cliDetectCSVSeparator,
    cliParseCSV,
    cliEscapeCSVField,
    cliCollectCSVKeys,
    cliSerializeCSV,
    cliEnvClosingQuoteIndex,
    cliDecodeEnvDoubleQuotedValue,
    cliParseEnv,
    cliDetectEnv,
    cliSerializeEnv,
    cliIsEscaped,
    cliStripTOMLComment,
    cliFindTOMLEquals,
    cliSplitTOMLTopLevel,
    cliTOMLIsBalanced,
    cliSplitTOMLDots,
    cliDecodeTOMLString,
    cliParseTOMLKey,
    cliParseTOMLPath,
    cliSetTOMLValue,
    cliGetTOMLTable,
    cliParseTOMLTripleString,
    cliParseTOMLValue,
    cliReadTOMLValueLines,
    cliParseTOML,
    cliDetectTOML,
    cliTOMLKey,
    cliTOMLInline,
    cliSerializeTOMLTable,
    cliSerializeTOML,
    cliDetectFormat,
    cliParseInput,
    cliSerializeOutput,
    cliParseArgs,
    cliReadStdin,
    cliPrintHelp,
    cliPrintInfo,
    cliPrintVersion,
    cliPrintReadme,
    cliPrintSampleInput,
    cliPrintSampleOutput,
    cliDeepEqual,
    cliTransformItems,
    cliTransformInput,
    cliRunSelfTest,
    cliWriteDiagnostics,
    cliSummarizeDiagnostics,
    cliBuildReport,
    cliWriteReport,
    cliInputSource,
    cliOutputTarget,
    cliWriteOutput,
    cliValidateItem,
    cliMain,
  ].map(fn => fn.toString()).join("\n\n");
}

function normalizeCLIFormat(format) {
  const normalized = String(format || "json").toLowerCase();
  return normalized === "auto" ? "json" : normalized;
}

function cliPreconditions(result) {
  const program = result?.rule?.program || { ops: [] };
  const explicit = result?.preconditions || result?.rule?.preconditions || [];
  const rows = explicit.length
    ? explicit
    : (program.ops || []).flatMap(op => opSources(op).map(source => ({
      field: source,
      type: "unknown",
      required: true,
      usedBy: op.target,
    })));
  const seen = new Set();
  return rows.filter(row => {
    const key = `${row.field}:${row.type || "unknown"}:${row.required ? "required" : "optional"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generateCLIExport(result, options = {}) {
  const inputFormat = normalizeCLIFormat(result?.inputFormat || result?.translator?.inputFormat || options.inputFormat || "json");
  const outputFormat = normalizeCLIFormat(result?.outputFormat || result?.translator?.outputFormat || options.outputFormat || "json");
  const supported = new Set(["json", "csv", "toml", "env"]);
  if (!supported.has(inputFormat) || !supported.has(outputFormat)) {
    throw new Error("CLI export currently supports JSON, CSV, TOML, and .env rules. XML and YAML CLI exports need bundled parsers and are intentionally not enabled in this v1.");
  }

  const program = result?.rule?.program || { ops: [] };
  const confidence = result?.confidence || result?.reliability?.confidence || {};
  const filename = options.filename || "latentmachine-transform.mjs";
  const sampleInputText = typeof options.sampleInputText === "string"
    ? options.sampleInputText
    : typeof options.sampleInput === "string"
      ? options.sampleInput
      : options.sampleInput === undefined
        ? ""
        : JSON.stringify(options.sampleInput, null, 2);
  const sampleOutput = options.sampleOutput !== undefined ? options.sampleOutput : result?.output;
  const meta = {
    cliVersion: 3,
    title: result?.rule?.title || "Untitled rule",
    createdAt: result?.rule?.createdAt || new Date().toISOString(),
    operationCount: program.ops?.length || 0,
    inputFormat,
    outputFormat,
    confidenceLabel: result?.reliability?.supportLabel ?? confidence.label ?? null,
    confidenceChecks: confidence.checks || null,
    confidenceNote: confidence.note || null,
    status: result?.status || "unknown",
    filename,
    latentmachineVersion: result?.rule?.version || 1,
    hasSelfTest: !!sampleInputText && sampleOutput !== undefined,
  };
  const sample = {
    available: meta.hasSelfTest,
    inputFormat,
    outputFormat,
    inputText: meta.hasSelfTest ? sampleInputText : "",
    expectedOutput: meta.hasSelfTest ? sampleOutput : null,
  };
  const preconditions = cliPreconditions(result);
  const transformSource = generateJavaScriptTransform({
    ...result,
    rule: {
      ...(result?.rule || {}),
      program,
    },
  });

  return `#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

// Latentmachine CLI Export
// Rule: ${commentLine(meta.title)}
// Created: ${commentLine(meta.createdAt)}
// Operations: ${meta.operationCount}
// Input format: ${inputFormat.toUpperCase()}
// Output format: ${outputFormat.toUpperCase()}
// Confidence: ${confidenceSummary(result)}
// This file is self-contained. No npm install required.
// Start here: node ${commentLine(filename)} --self-test
// Usage guide: node ${commentLine(filename)} --readme

const RULE = ${JSON.stringify(program, null, 2)};
const PRECONDITIONS = ${JSON.stringify(preconditions, null, 2)};
const META = ${JSON.stringify(meta, null, 2)};
const SAMPLE = ${JSON.stringify(sample, null, 2)};

${transformSource}

${cliRuntimeSource()}

await cliMain();
`;
}

export function generateN8nCode(result) {
  const program = result?.rule?.program || { ops: [] };
  const maps = mapDeclarations(program);
  const confidence = confidenceSummary(result);
  return `// Latentmachine - inferred transformation
// Status: ${result?.status || "unknown"} | Confidence: ${confidence}
//
// Rule: ${result?.rule?.title || "Untitled rule"}
// Operations:
${operationLines(result)}

${maps.join("\n")}

const items = $input.all();
return items.map(item => {
  const input = item.json;
  let output = {};
${outputObjectLines(program).map(line => `  ${line}`).join("\n")}
  return { json: output };
});`;
}
