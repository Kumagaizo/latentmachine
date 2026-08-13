import {
  parseAllDocuments,
  parseDocument,
  Scalar,
  stringify as stringifyYaml,
} from "../../vendor/yaml/index.js";
import { assertSafeObjectKey, assertSafeParsedValue } from "./safety.js";
import { normalizeLineEndings } from "./shared.js";

const MAX_YAML_SIZE = 1_000_000;
const YAML_PARSE_OPTIONS = {
  version: "1.2",
  strict: true,
  uniqueKeys: true,
  merge: true,
  customTags: [],
};
const YAML_TO_JS_OPTIONS = {
  maxAliasCount: 64,
};
const YAML_STRINGIFY_OPTIONS = {
  version: "1.2",
  indent: 2,
  lineWidth: 120,
  minContentWidth: 20,
  defaultStringType: "PLAIN",
  defaultKeyType: "PLAIN",
  trueStr: "true",
  falseStr: "false",
  nullStr: "null",
};
const YAML_AMBIGUOUS_STRING_RE = /^(?:[-+]?\.inf|\.nan|[-+]?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[-+]?\d+)?|0o[0-7]+|0x[0-9a-f]+|0b[01]+|0[0-9]+|\d{4}-\d{2}-\d{2}(?:[tT ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[-+]\d{2}:?\d{2})?)?|y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/i;

function isPlainObjectOrArray(value) {
  return !!value && typeof value === "object";
}

function yamlError(message) {
  return new Error(message?.startsWith("YAML:") ? message : `YAML: ${message || "could not parse input"}`);
}

function rejectExplicitTags(text) {
  const lines = normalizeLineEndings(text).split("\n");
  const tagPattern = /(^|[\s[{,])![!<A-Za-z]/;
  const index = lines.findIndex(line => tagPattern.test(line.replace(/#.*/, "")));
  if (index >= 0) {
    throw yamlError(`explicit tags are not supported at line ${index + 1}.`);
  }
}

function sanitizeYamlValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeYamlValue);
  if (typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = sanitizeYamlValue(item);
    }
    return result;
  }
  return value;
}

function prepareYamlForStringify(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return quoteYamlString(value.toISOString());
  if (Array.isArray(value)) return value.map(prepareYamlForStringify);
  if (typeof value === "string") return shouldQuoteYamlString(value) ? quoteYamlString(value) : value;
  if (typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      assertSafeObjectKey(key, "YAML output");
      result[key] = prepareYamlForStringify(item);
    }
    return result;
  }
  return value;
}

function quoteYamlString(value) {
  const scalar = new Scalar(value);
  scalar.type = Scalar.QUOTE_DOUBLE;
  return scalar;
}

function shouldQuoteYamlString(value) {
  const text = String(value);
  if (text === "" || text !== text.trim()) return true;
  return YAML_AMBIGUOUS_STRING_RE.test(text);
}

function yamlPositiveSignal(text) {
  const source = normalizeLineEndings(text).trim();
  if (!source) return false;
  if (/^---(?:\s|$)/m.test(source)) return true;
  if (/^\s*[A-Za-z0-9_.-]+:\s*(?:\S.*)?$/m.test(source)) return true;
  if (/^\s*-\s+(?:[A-Za-z0-9_.-]+:\s*|\S+)/m.test(source)) return true;
  return false;
}

export function detectYAML(text, options = {}) {
  if (typeof text !== "string" || !text.trim()) return false;
  const source = normalizeLineEndings(text).trim();
  if (/^\s*[\[{]/.test(source)) return false;
  if (!yamlPositiveSignal(source)) return false;

  try {
    const doc = parseDocument(source, { ...YAML_PARSE_OPTIONS, ...options });
    return !doc.errors?.length && isPlainObjectOrArray(doc.toJS(YAML_TO_JS_OPTIONS));
  } catch {
    return false;
  }
}

export function parseYAMLWithWarnings(text, options = {}) {
  if (typeof text !== "string") throw yamlError("input must be a string.");
  if (text.length > MAX_YAML_SIZE) throw yamlError("input exceeds 1MB limit.");

  const source = normalizeLineEndings(text).trim();
  if (!source) throw yamlError("input is empty.");
  rejectExplicitTags(source);

  try {
    const parseOptions = { ...YAML_PARSE_OPTIONS, ...options };
    const docs = parseAllDocuments(source, parseOptions);
    const doc = docs[0];
    const warnings = [];

    if (!doc) throw yamlError("document is empty.");
    const errors = docs.flatMap(item => item.errors || []);
    if (errors.length) throw yamlError(errors[0].message);

    for (const warning of docs.flatMap(item => item.warnings || [])) {
      warnings.push(warning.message);
    }
    if (docs.length > 1) {
      warnings.push("YAML contains multiple documents. Only the first document was parsed.");
    }

    const parsed = doc.toJS(YAML_TO_JS_OPTIONS);
    if (parsed === null || parsed === undefined) throw yamlError("document is empty or null.");
    if (!isPlainObjectOrArray(parsed)) {
      throw yamlError(`top-level value must be an object or array. Got: ${typeof parsed}.`);
    }
    assertSafeParsedValue(parsed, "YAML");

    return {
      value: sanitizeYamlValue(parsed),
      warnings,
    };
  } catch (error) {
    if (error?.message?.startsWith("YAML:")) throw error;
    throw yamlError(error?.message || "parse error.");
  }
}

export function parseYAML(text, options = {}) {
  return parseYAMLWithWarnings(text, options).value;
}

export function serializeYAML(value, options = {}) {
  if (value === undefined) return "null\n";
  return stringifyYaml(prepareYamlForStringify(value), { ...YAML_STRINGIFY_OPTIONS, ...options });
}

export function serializeYAMLBatch(values, options = {}) {
  if (!Array.isArray(values) || values.length === 0) return "";
  return serializeYAML(values, options);
}

export const yamlFormat = {
  id: "yaml",
  label: "YAML",
  fileExtension: "yaml",
  mimeType: "text/yaml",
  detect: detectYAML,
  parse: parseYAML,
  parseWithWarnings: parseYAMLWithWarnings,
  serialize: serializeYAML,
  serializeBatch: serializeYAMLBatch,
};
