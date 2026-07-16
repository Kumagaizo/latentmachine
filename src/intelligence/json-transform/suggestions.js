import { clone, formatPath, setPath, typeOf } from "./core.js";

function suggestionPath(path = []) {
  if (!path.length) return "$";
  return `$${path.map(part => {
    if (part === "[]") return "[]";
    if (typeof part === "number") return `[${part}]`;
    return /^[A-Za-z_$][\w$]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`;
  }).join("")}`;
}

function suggestionGroupPath(path = []) {
  return path.map(part => typeof part === "number" ? "[]" : part);
}

function suggestionGroupKey(path = []) {
  return JSON.stringify(suggestionGroupPath(path));
}

function suggestionLeaves(value, path = []) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => (
      item && typeof item === "object"
        ? suggestionLeaves(item, [...path, index])
        : []
    ));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => suggestionLeaves(item, [...path, key]));
  }
  return path.length ? [{ path: formatPath(path), rawPath: path, value, type: typeOf(value) }] : [];
}

function pathTokens(path = []) {
  return path
    .filter(part => typeof part !== "number")
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasLeadingZeroNumber(text) {
  const signless = text.replace(/^-/, "");
  return /^0\d/.test(signless);
}

function shouldSuggestNumber(path, text) {
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return false;
  if (hasLeadingZeroNumber(text)) return false;
  if (/^-?\d+$/.test(text) && text.replace(/^-/, "").length > 15) return false;

  const tokens = pathTokens(path);
  const joined = tokens.join(" ");
  const numericHints = new Set([
    "age", "amount", "balance", "count", "height", "latitude", "length", "lng", "longitude",
    "percent", "percentage", "price", "quantity", "qty", "rate", "score", "total", "weight", "width",
  ]);
  if (tokens.some(token => numericHints.has(token))) return true;

  const identifierHints = /\b(id|ids|uuid|guid|sku|zip|zipcode|postal|postcode|phone|tel|mobile|fax|account|acct|iban|isbn|ssn|tax|vat|ein|routing|barcode|serial|code|hash|number)\b/;
  if (identifierHints.test(joined) || /id$/.test(tokens.at(-1) || "")) return false;

  return true;
}

function likelyDateString(text) {
  return /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2})?/.test(text)
    || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text);
}

function splitParts(text) {
  const separator = text.includes(";") ? ";" : text.includes(",") ? "," : null;
  if (!separator || text.includes("\n") || likelyDateString(text)) return null;
  const parts = text.split(separator).map(part => part.trim()).filter(Boolean);
  return parts.length >= 2 ? { separator, parts } : null;
}

function shouldSuggestSplit(path, parts) {
  const tokens = pathTokens(path);
  const last = tokens.at(-1) || "";
  const listHints = new Set([
    "categories", "emails", "features", "interests", "items", "keywords", "labels", "roles",
    "skills", "tags", "topics", "urls", "values",
  ]);
  const nonListHints = new Set(["address", "city", "country", "description", "location", "name", "status", "title"]);
  if (tokens.some(token => listHints.has(token))) return true;
  if (tokens.some(token => nonListHints.has(token))) return false;
  return parts.length >= 3 || (last.endsWith("s") && last.length > 3);
}

function classifySuggestion(entry) {
  if (entry.type !== "string" || typeof entry.value !== "string") return null;
  const trimmed = entry.value.trim();
  if (!trimmed) return null;

  if (shouldSuggestNumber(entry.rawPath, trimmed)) {
    return { type: "coerce-number", category: "type-fix", label: "coerce to number", to: Number(trimmed) };
  }

  if (["true", "false"].includes(trimmed.toLowerCase())) {
    return { type: "coerce-boolean", category: "type-fix", label: "coerce to boolean", to: trimmed.toLowerCase() === "true" };
  }

  const split = splitParts(trimmed);
  if (split && shouldSuggestSplit(entry.rawPath, split.parts)) {
    return { type: "split-array", category: "split", label: "split into array", separator: split.separator, to: split.parts };
  }

  return null;
}

function buildSuggestion(groupEntries) {
  const changes = [];
  let prototype = null;
  let skippedMeaningfulValue = false;

  for (const entry of groupEntries) {
    const classified = classifySuggestion(entry);
    if (!classified) {
      if (!(entry.type === "string" && typeof entry.value === "string" && entry.value.trim() === "")) {
        skippedMeaningfulValue = true;
      }
      continue;
    }
    if (prototype && classified.type !== prototype.type) return null;
    prototype = prototype || classified;
    changes.push({ path: entry.path, from: entry.value, to: classified.to });
  }

  if (!prototype || !changes.length || skippedMeaningfulValue) return null;
  const groupPath = suggestionGroupPath(groupEntries[0].rawPath);
  return {
    id: `${prototype.type}:${suggestionPath(groupPath)}`,
    type: prototype.type,
    category: prototype.category,
    path: suggestionPath(groupPath),
    label: prototype.label,
    defaultOn: true,
    from: changes[0].from,
    to: changes[0].to,
    count: changes.length,
    changes,
  };
}

export function suggestTransformations(input) {
  if (!input || typeof input !== "object") return { suggestions: [], summary: "", hasSuggestions: false };

  const groups = new Map();
  for (const entry of suggestionLeaves(input)) {
    const key = suggestionGroupKey(entry.rawPath);
    groups.set(key, [...(groups.get(key) || []), entry]);
  }

  const suggestions = [...groups.values()]
    .map(buildSuggestion)
    .filter(Boolean);

  const typeFixes = suggestions.filter(suggestion => suggestion.category === "type-fix").length;
  const splits = suggestions.filter(suggestion => suggestion.category === "split").length;
  const parts = [];
  if (typeFixes) parts.push(`${typeFixes} type ${typeFixes === 1 ? "fix" : "fixes"}`);
  if (splits) parts.push(`${splits} list ${splits === 1 ? "field" : "fields"}`);

  return {
    suggestions,
    summary: parts.join(" Â· "),
    hasSuggestions: suggestions.length > 0,
  };
}

export function hasValuableSuggestions(result) {
  const suggestions = result?.suggestions || [];
  if (!suggestions.length) return false;
  const splits = suggestions.filter(suggestion => suggestion.type === "split-array").length;
  const booleans = suggestions.filter(suggestion => suggestion.type === "coerce-boolean").length;
  const numbers = suggestions.filter(suggestion => suggestion.type === "coerce-number").length;
  return splits > 0 || booleans > 0 || numbers >= 2;
}

export function applySuggestions(input, suggestions = []) {
  const output = clone(input);
  for (const suggestion of suggestions) {
    for (const change of suggestion.changes || []) {
      setPath(output, change.path, change.to);
    }
  }
  return output;
}
