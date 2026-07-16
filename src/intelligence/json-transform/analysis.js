import { formatPath, typeOf } from "./core.js";
import { schemaPathKey } from "./schema.js";
import { suggestTransformations } from "./suggestions.js";

const DEFAULT_OPTIONS = {
  maxArraySample: 100,
  maxUniqueValues: 20,
  maxDepth: 10,
  includeSuggestions: false,
};

const PATTERNS = [
  {
    id: "email",
    label: "email-like",
    strongName: path => /\bemail\b/i.test(path),
    test: value => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()),
  },
  {
    id: "iso-date",
    label: "date-like",
    strongName: path => /\b(date|time|created|updated|timestamp)\b/i.test(path),
    test: value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2})?/.test(value.trim()),
  },
  {
    id: "url",
    label: "URL-like",
    strongName: path => /\b(url|link|href)\b/i.test(path),
    test: value => typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim()),
  },
  {
    id: "uuid",
    label: "UUID-like",
    strongName: path => /\b(uuid|guid)\b/i.test(path),
    test: value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim()),
  },
  {
    id: "identifier",
    label: "identifier-like",
    strongName: path => /(^|[._\s-])(id|sku|zip|postal_?code|postcode|code)(\[\])?$/i.test(path),
    test: value => typeof value === "string" && (/^0\d+$/.test(value.trim()) || /^[A-Za-z]+[-_]\d+/.test(value.trim())),
  },
  {
    id: "number-string",
    label: "number as text",
    strongName: () => false,
    test: value => typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim()) && !/^0\d/.test(value.trim()),
  },
  {
    id: "boolean-string",
    label: "boolean as text",
    strongName: () => false,
    test: value => typeof value === "string" && /^(true|false|yes|no)$/i.test(value.trim()),
  },
];

function stableValueKey(value) {
  return JSON.stringify(value);
}

function isObjectRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isEmptyValue(value) {
  return value === null || value === undefined || value === "";
}

function primitiveValues(values) {
  return values.filter(value => !isEmptyValue(value) && !Array.isArray(value) && (!value || typeof value !== "object"));
}

function collectEntries(value, path = [], options = {}, out = []) {
  if (path.length > options.maxDepth) return out;

  const pathText = formatPath(path);
  out.push({ path: pathText, key: schemaPathKey(pathText), rawPath: path, value, type: typeOf(value) });

  if (Array.isArray(value)) {
    value.slice(0, options.maxArraySample).forEach((item, index) => {
      collectEntries(item, [...path, index], options, out);
    });
    return out;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      collectEntries(item, [...path, key], options, out);
    });
  }

  return out;
}

function displayPathFor(key) {
  return key || "$";
}

function depthForPath(path) {
  if (path === "$") return 0;
  return (path.match(/\.|\[/g) || []).length;
}

function summarizeArray(values) {
  const arrays = values.filter(Array.isArray);
  if (!arrays.length) return null;
  const lengths = arrays.map(value => value.length);
  const itemTypes = new Set();
  arrays.forEach(value => {
    value.forEach(item => itemTypes.add(typeOf(item)));
  });
  return {
    minLength: Math.min(...lengths),
    maxLength: Math.max(...lengths),
    itemTypes: [...itemTypes].sort(),
  };
}

function summarizeNumeric(values) {
  const numbers = values.filter(value => typeof value === "number" && Number.isFinite(value));
  if (!numbers.length || numbers.length !== values.filter(value => !isEmptyValue(value)).length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    min: sorted[0],
    max: sorted.at(-1),
    median,
  };
}

function detectPattern(path, values) {
  const candidates = primitiveValues(values);
  if (!candidates.length) return null;

  for (const pattern of PATTERNS) {
    const matches = candidates.filter(pattern.test).length;
    const ratio = matches / candidates.length;
    const strongName = pattern.strongName(path);
    if (ratio >= 0.8 && (candidates.length > 1 || strongName)) {
      return {
        path,
        pattern: pattern.id,
        confidence: ratio === 1 ? "high" : "medium",
        description: pattern.label,
      };
    }
  }

  return null;
}

function formatShape(value) {
  if (Array.isArray(value)) {
    if (value.every(isObjectRecord)) return "array-of-objects";
    return value.every(item => !item || typeof item !== "object") ? "array-of-primitives" : "array";
  }
  if (isObjectRecord(value)) return "object";
  return "primitive";
}

function isRedundantArrayItemField(field, fieldsByPath) {
  if (!field.path.endsWith("[]")) return false;
  const parent = fieldsByPath.get(field.path.slice(0, -2));
  const itemTypes = parent?.arrayStats?.itemTypes || [];
  return parent?.type === "array" && itemTypes.length > 0 && !itemTypes.includes("object");
}

function buildField(row, options, total) {
  const types = [...row.types].sort();
  const values = row.values;
  const definedValues = values.filter(value => !isEmptyValue(value));
  const unique = new Map();
  definedValues.forEach(value => {
    const key = stableValueKey(value);
    unique.set(key, { value, count: (unique.get(key)?.count || 0) + 1 });
  });
  const uniqueRows = [...unique.values()];
  const uniqueCount = uniqueRows.length;
  const type = types.length === 1 ? types[0] : "mixed";
  const constant = uniqueCount === 1 && row.presence === total && row.empty === 0;
  const includeUniqueValues = uniqueCount > 0 && uniqueCount <= options.maxUniqueValues;

  return {
    path: displayPathFor(row.key),
    key: row.key,
    type,
    types,
    required: row.presence === total,
    presence: row.presence,
    total,
    uniqueCount,
    uniqueValues: includeUniqueValues ? uniqueRows.map(item => item.value) : null,
    valueCounts: includeUniqueValues ? Object.fromEntries(uniqueRows.map(item => [String(item.value), item.count])) : null,
    constant,
    constantValue: constant ? uniqueRows[0]?.value : null,
    empty: row.empty,
    pattern: null,
    numeric: summarizeNumeric(values),
    arrayStats: summarizeArray(values),
    depth: depthForPath(row.key),
    isContainer: row.isContainer,
  };
}

export function analyzeStructure(value, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const isBatch = Array.isArray(value) && value.length > 0 && value.every(isObjectRecord);
  const total = isBatch ? value.length : 1;
  const sampledItems = isBatch ? value.slice(0, settings.maxArraySample) : [value];
  const rows = new Map();

  sampledItems.forEach(item => {
    const seen = new Set();
    collectEntries(item, [], settings).forEach(entry => {
      if (entry.key === "$") return;
      if (!rows.has(entry.key)) {
        rows.set(entry.key, {
          key: entry.key,
          types: new Set(),
          values: [],
          presence: 0,
          empty: 0,
          isContainer: false,
        });
      }

      const row = rows.get(entry.key);
      row.types.add(entry.type);
      row.values.push(entry.value);
      if (Array.isArray(entry.value) || (entry.value && typeof entry.value === "object")) row.isContainer = true;
      if (isEmptyValue(entry.value)) row.empty += 1;
      if (!seen.has(entry.key)) {
        row.presence += 1;
        seen.add(entry.key);
      }
    });
  });

  const fields = [...rows.values()]
    .map(row => buildField(row, settings, sampledItems.length));

  const patterns = fields
    .filter(field => !field.isContainer && !field.constant)
    .map(field => detectPattern(field.path, rows.get(field.key)?.values || []))
    .filter(Boolean);

  fields.forEach(field => {
    field.pattern = patterns.find(pattern => pattern.path === field.path)?.pattern || null;
  });

  const fieldsByPath = new Map(fields.map(field => [field.path, field]));
  const visibleFields = fields.filter(field => (!field.isContainer || field.type === "array") && !isRedundantArrayItemField(field, fieldsByPath));
  const completeness = isBatch
    ? visibleFields
      .filter(field => field.presence < sampledItems.length || field.empty > 0)
      .map(field => ({
        path: field.path,
        present: field.presence,
        total: sampledItems.length,
        emptyCount: field.empty,
        message: [
          field.presence < sampledItems.length
            ? `${sampledItems.length - field.presence} of ${sampledItems.length} records are missing this field`
            : null,
          field.empty ? `${field.empty} empty` : null,
        ].filter(Boolean).join(", "),
      }))
    : [];

  return {
    summary: {
      depth: fields.reduce((max, field) => Math.max(max, field.depth), 0),
      fieldCount: visibleFields.length,
      arrayCount: fields.filter(field => field.type === "array").length,
      recordCount: isBatch ? value.length : null,
      sampledRecordCount: sampledItems.length,
      format: formatShape(value),
    },
    fields,
    patterns,
    completeness,
    suggestions: settings.includeSuggestions ? suggestTransformations(value) : null,
  };
}
