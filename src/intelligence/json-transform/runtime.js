import { clone, formatPath, getPath, hasPathToken, parsePath, setPath } from "./core.js";
import { applyNumericFormula, coerce, formatDateParts, formatQuantity, isAmbiguousDateText, normalizeString, parseDateParts, parseJson, parseQuantity, projectArrayRow, transformString } from "./operations.js";
import { deepEqual, opSources } from "./shared.js";

function parseJsonObjectString(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function wrappedS3Notification(rows) {
  if (!Array.isArray(rows)) return null;
  for (const [index, row] of rows.entries()) {
    const body = parseJsonObjectString(row?.body);
    if (Array.isArray(body?.Records) && body.Records.some(record => record?.s3)) {
      return { source: formatPath(["Records", index, "body"]), wrapper: "SQS body" };
    }
    const message = parseJsonObjectString(row?.Sns?.Message);
    if (Array.isArray(message?.Records) && message.Records.some(record => record?.s3)) {
      return { source: formatPath(["Records", index, "Sns", "Message"]), wrapper: "SNS message" };
    }
  }
  return null;
}

function isEmailPath(path) {
  return hasPathToken(path || "$", /email/);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

function isSafeRegexExtractPattern(pattern) {
  if (typeof pattern !== "string" || pattern.length > 64) return false;
  return [
    /^\\d(?:\{\d{1,3}\}|\+)$/,
    /^\[A-Z\](?:\{\d{1,3}\}|\+)$/,
    /^\[A-Z\]\+\\d\+$/,
    /^\[a-z\]\+$/,
    /^\[A-Za-z\]\+$/,
    /^\\w\+$/,
  ].some(rule => rule.test(pattern));
}

function compileRegexExtractPattern(op) {
  if (!isSafeRegexExtractPattern(op.pattern)) {
    throw new Error("Unsafe regex extraction pattern. Only simple learned extraction patterns are allowed.");
  }
  return new RegExp(op.pattern);
}

function stringNormalizeWarnings(op, input) {
  const value = getPath(input, op.source);
  if (value === undefined) return [{ type: "missing-source", message: `${op.source} is required by the learned rule but is missing from the new input.`, op, source: op.source }];
  if (op.mode === "phone") {
    const normalized = normalizeString(value, op.mode, op);
    if (normalized === null) {
      return [{ type: "phone-country-unproven", message: `${op.source} is a local phone number, but the examples do not prove which country code to add. Add one local-number example or include an explicit country code.`, op, source: op.source }];
    }
    if (String(normalized).replace(/\D/g, "").length < 7) {
      return [{ type: "invalid-phone", message: `${op.source} does not look like a complete phone number.`, op, source: op.source }];
    }
  }
  if (op.mode === "dateNormalize") {
    if (isAmbiguousDateText(value)) {
      return [{ type: "ambiguous-date", message: `${op.source} uses an ambiguous day/month date. Add an example or use an ISO date.`, op, source: op.source }];
    }
    if (!parseDateParts(value)) {
      return [{ type: "invalid-date", message: `${op.source} is not a supported date shape. Use ISO dates or add another example.`, op, source: op.source }];
    }
  }
  const normalized = normalizeString(value, op.mode, op);
  if (isEmailPath(op.source) || isEmailPath(op.target)) {
    if (!isValidEmail(normalized)) {
      return [{ type: "invalid-email", message: `${op.source} does not produce a valid email address.`, op, source: op.source }];
    }
  }
  return [];
}

function stringCaseWarnings(op, input) {
  const value = getPath(input, op.source);
  if (value === undefined) return [{ type: "missing-source", message: `${op.source} is required by the learned rule but is missing from the new input.`, op, source: op.source }];
  if (isEmailPath(op.source) || isEmailPath(op.target)) {
    const normalized = transformString(value, op.mode);
    if (!isValidEmail(normalized)) {
      return [{ type: "invalid-email", message: `${op.source} does not produce a valid email address.`, op, source: op.source }];
    }
  }
  return [];
}

function applyOp(op, input) {
  if (op.source && !["arrayMap", "arrayProject", "arrayCount", "arraySum", "arrayIndex", "arrayJoin", "arrayFind", "arrayGroupBy", "arrayStringTransform", "stringSplit"].includes(op.op) && getPath(input, op.source) === undefined) return `[missing ${op.source}]`;
  if (op.op === "set") {
    const value = getPath(input, op.source);
    return value === undefined ? `[missing ${op.source}]` : value;
  }
  if (op.op === "constant") return op.value;
  if (op.op === "coerce") return coerce(getPath(input, op.source), op.to);
  if (op.op === "stringCase") return transformString(getPath(input, op.source), op.mode);
  if (op.op === "stringReplace") return String(getPath(input, op.source) ?? "").split(op.search).join(op.replacement);
  if (op.op === "numericTransform") {
    const value = Number(getPath(input, op.source));
    if (!Number.isFinite(value)) return `[invalid number ${op.source}]`;
    if (op.mode === "absolute") return Math.abs(value) / (op.value || 1);
    if (op.mode === "add") return value + op.value;
    if (op.mode === "multiply") return value * op.value;
    if (op.mode === "divide") return value / op.value;
    return value;
  }
  if (op.op === "numericBinary") {
    const left = Number(getPath(input, op.left));
    const right = Number(getPath(input, op.right));
    if (!Number.isFinite(left)) return `[invalid number ${op.left}]`;
    if (!Number.isFinite(right)) return `[invalid number ${op.right}]`;
    if (op.mode === "add") return left + right;
    if (op.mode === "subtract") return left - right;
    if (op.mode === "multiply") return left * right;
    return left;
  }
  if (op.op === "numericFormula") {
    const value = applyNumericFormula(getPath(input, op.base), getPath(input, op.rate), op);
    return value === null ? `[invalid number ${op.base} or ${op.rate}]` : value;
  }
  if (op.op === "numericCompare") {
    const value = Number(getPath(input, op.source));
    if (!Number.isFinite(value)) return `[invalid number ${op.source}]`;
    if (op.comparison === "lessThan") return value < op.value;
    if (op.comparison === "greaterThan") return value > op.value;
    return false;
  }
  if (op.op === "quantityTransform") {
    const parsed = parseQuantity(getPath(input, op.source));
    if (!parsed || parsed.unit !== op.unit) return `[invalid quantity ${op.source}]`;
    return formatQuantity(parsed.amount * op.factor, parsed.unit);
  }
  if (op.op === "booleanNot") return !getPath(input, op.source);
  if (op.op === "conditional") {
    const sourceValue = getPath(input, op.source);
    const passes = op.test === "notEquals"
      ? !deepEqual(sourceValue, op.value)
      : deepEqual(sourceValue, op.value);
    return clone(passes ? op.then : op.else);
  }
  if (op.op === "fallback") {
    for (const source of op.sources || []) {
      const value = getPath(input, source);
      if (value !== undefined && value !== null && value !== "") return clone(value);
    }
    return null;
  }
  if (op.op === "dateFormat") {
    const formatted = formatDateParts(parseDateParts(getPath(input, op.source)), op.mode);
    return formatted ?? `[invalid date ${op.source}]`;
  }
  if (op.op === "extractBetween") {
    const text = String(getPath(input, op.source) ?? "");
    const start = op.prefix ? text.indexOf(op.prefix) : 0;
    if (start < 0) return "";
    const from = start + String(op.prefix || "").length;
    const end = op.suffix ? text.indexOf(op.suffix, from) : text.length;
    return end < from ? "" : text.slice(from, end);
  }
  if (op.op === "regexExtract") {
    const text = String(getPath(input, op.source) ?? "");
    const match = text.match(compileRegexExtractPattern(op));
    return match?.[op.group || 0] ?? "";
  }
  if (op.op === "template") {
    return op.parts.map(part => {
      if (part.kind !== "source") return part.value;
      const value = getPath(input, part.path);
      return value === undefined ? `[missing ${part.path}]` : transformString(value, part.transform || "identity");
    }).join("");
  }
  if (op.op === "templateConflict") return `[conflict: examples disagree for ${op.target}]`;
  if (op.op === "concat") {
    return op.sources.map((source, index) => {
      const value = getPath(input, source);
      return `${index ? op.separators[index - 1] || "" : ""}${value === undefined ? `[missing ${source}]` : value}`;
    }).join("");
  }
  if (op.op === "splitPart") {
    const value = String(getPath(input, op.source) ?? "");
    return value.split(op.separator)[op.index] ?? "";
  }
  if (op.op === "stringSplit") {
    const value = getPath(input, op.source);
    if (typeof value !== "string") return [];
    const parts = value.split(op.separator);
    return op.trim ? parts.map(part => part.trim()) : parts;
  }
  if (op.op === "stringNormalize") {
    const value = normalizeString(getPath(input, op.source), op.mode, op);
    return value === null ? `[unresolved: phone country at ${op.source}]` : value;
  }
  if (op.op === "arrayStringTransform") {
    const values = getPath(input, op.source);
    if (!Array.isArray(values)) return [];
    return values.map(value => typeof value === "string" ? normalizeString(value, op.mode, op) : value);
  }
  if (op.op === "valueMap") {
    const value = getPath(input, op.source);
    const key = JSON.stringify(value);
    return Object.prototype.hasOwnProperty.call(op.map, key) ? clone(op.map[key]) : `[unresolved: unseen value at ${op.source}]`;
  }
  if (op.op === "valueMapConflict") return `[conflict: examples disagree for ${op.target}]`;
  if (op.op === "arrayMap") {
    const rows = getPath(input, op.source) || [];
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(row => !op.where || deepEqual(getPath(row, op.where.path), op.where.equals))
      .map(row => getPath(row, op.extract));
  }
  if (op.op === "arrayProject") {
    const rows = getPath(input, op.source) || [];
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(row => !op.where || deepEqual(getPath(row, op.where.path), op.where.equals))
      .map(row => projectArrayRow(row, op.fields || []));
  }
  if (op.op === "arrayCount") {
    const rows = getPath(input, op.source) || [];
    if (!Array.isArray(rows)) return 0;
    return rows.filter(row => !op.where || deepEqual(getPath(row, op.where.path), op.where.equals)).length;
  }
  if (op.op === "arraySum") {
    const rows = getPath(input, op.source) || [];
    if (!Array.isArray(rows)) return 0;
    const values = rows.map(row => op.factors
      ? op.factors.map(path => Number(getPath(row, path))).reduce((product, value) => product * value, 1)
      : Number(op.extract ? getPath(row, op.extract) : row));
    return values.every(Number.isFinite)
      ? values.reduce((sum, value) => sum + value, 0) / (op.divisor || 1)
      : `[invalid number ${op.source}]`;
  }
  if (op.op === "arrayIndex") {
    const rows = getPath(input, op.source) || [];
    if (!Array.isArray(rows) || !rows.length) return undefined;
    const row = op.index === "last" ? rows.at(-1) : op.index === "first" ? rows[0] : rows[op.index];
    return op.extract && row !== undefined ? getPath(row, op.extract) : row;
  }
  if (op.op === "arrayJoin") {
    const rows = getPath(input, op.source) || [];
    if (!Array.isArray(rows)) return "";
    const values = rows
      .filter(row => !op.where || deepEqual(getPath(row, op.where.path), op.where.equals))
      .map(row => op.extract ? getPath(row, op.extract) : row);
    return values.join(op.separator);
  }
  if (op.op === "arrayFind") {
    const rows = getPath(input, op.source) || [];
    if (!Array.isArray(rows)) return undefined;
    const row = rows.find(item => !op.where || deepEqual(getPath(item, op.where.path), op.where.equals));
    return row ? getPath(row, op.extract) : undefined;
  }
  if (op.op === "arrayGroupBy") {
    const rows = getPath(input, op.source) || [];
    if (!Array.isArray(rows)) return {};
    const result = Object.create(null);
    for (const row of rows) {
      const key = String(getPath(row, op.groupBy) ?? "");
      result[key] ||= [];
      result[key].push(clone(getPath(row, op.extract)));
    }
    return result;
  }
  throw new Error(`Unsupported transform operation ${JSON.stringify(op?.op)}.`);
}

export function runtimeWarnings(program, input) {
  const parsedInput = parseJson(input, "Input");
  return (program.ops || []).flatMap(op => {
    if (op.domain?.optional && (!op.domain.source || getPath(parsedInput, op.domain.source) === undefined)) return [];
    if (op.op === "conditional") {
      const value = getPath(parsedInput, op.source);
      return value === undefined ? [{
        type: "missing-source",
        message: `${op.source} is required by the conditional rule but is missing from the new input.`,
        op,
        source: op.source,
      }] : [];
    }
    if (op.op === "fallback") {
      const allMissing = (op.sources || []).every(source => {
        const value = getPath(parsedInput, source);
        return value === undefined || value === null || value === "";
      });
      return allMissing ? [{
        type: "all-fallbacks-empty",
        message: `All fallback sources for ${op.target} are empty or missing. The output will be null.`,
        op,
        source: op.sources?.[0],
      }] : [];
    }
    if (op.op === "regexExtract") {
      const value = getPath(parsedInput, op.source);
      if (value === undefined) {
        return [{ type: "missing-source", message: `${op.source} is required by the regex extraction rule but is missing.`, op, source: op.source }];
      }
      let pattern;
      try {
        pattern = compileRegexExtractPattern(op);
      } catch {
        return [{ type: "invalid-regex-pattern", message: `The learned regex pattern /${op.pattern}/ is invalid.`, op, source: op.source }];
      }
      if (!String(value ?? "").match(pattern)) {
        return [{ type: "regex-no-match", message: `${op.source} does not match the expected pattern /${op.pattern}/.`, op, source: op.source }];
      }
      return [];
    }
    if (op.op === "stringCase") return stringCaseWarnings(op, parsedInput);
    if (op.op === "stringNormalize") return stringNormalizeWarnings(op, parsedInput);
    if (op.op === "dateFormat") {
      const value = getPath(parsedInput, op.source);
      if (value === undefined) return [{ type: "missing-source", message: `${op.source} is required by the learned rule but is missing from the new input.`, op, source: op.source }];
      if (isAmbiguousDateText(value)) return [{ type: "ambiguous-date", message: `${op.source} uses an ambiguous day/month date. Add an example or use an ISO date.`, op, source: op.source }];
      if (!parseDateParts(value)) return [{ type: "invalid-date", message: `${op.source} is not a supported date shape. Use ISO dates or add another example.`, op, source: op.source }];
      return [];
    }
    if (op.op === "valueMap") {
      const key = JSON.stringify(getPath(parsedInput, op.source));
      return Object.prototype.hasOwnProperty.call(op.map, key)
        ? []
        : [{ type: "unseen-value-map", message: `${op.source} contains a value that was not in the examples. Add one more example or correction.`, op }];
    }
    if (op.op === "templateConflict") {
      const suggestion = op.suggestions?.[0];
      const message = suggestion
        ? `The changing part looks like ${suggestion.source}, but at least one example output does not match that input value.`
        : `The examples contain the same source fields, but the surrounding text for ${op.target} is inconsistent. Make the example outputs match the same wording.`;
      return [{ type: "template-conflict", message, op }];
    }
    if (op.op === "valueMapConflict") {
      return [{
        type: "value-map-conflict",
        message: `${op.source} maps the same example value to different outputs for ${op.target}. Correct the conflicting examples or add another field that explains the difference.`,
        op,
        source: op.source,
      }];
    }
    if (op.op === "template") {
      const warnings = [];
      for (const part of op.parts.filter(item => item.kind === "source")) {
        const value = getPath(parsedInput, part.path);
        if (value === undefined) {
          warnings.push({ type: "missing-source", message: `${part.path} is required by the learned rule but is missing from the new input.`, op, source: part.path });
          continue;
        }
        if (part.transform && (isEmailPath(part.path) || isEmailPath(op.target))) {
          const normalized = transformString(value, part.transform);
          if (!isValidEmail(normalized)) {
            warnings.push({ type: "invalid-email", message: `${part.path} does not produce a valid email address.`, op, source: part.path });
          }
        }
      }
      return warnings;
    }
    if (op.op === "quantityTransform") {
      const value = getPath(parsedInput, op.source);
      if (value === undefined) return [{ type: "missing-source", message: `${op.source} is required by the learned rule but is missing from the new input.`, op, source: op.source }];
      const parsed = parseQuantity(value);
      if (!parsed) {
        return [{ type: "invalid-quantity", message: `${op.source} must be a resource quantity with a unit suffix before it can be scaled.`, op, source: op.source }];
      }
      if (parsed.unit !== op.unit) {
        return [{ type: "invalid-quantity", message: `${op.source} uses unit ${parsed.unit}; expected ${op.unit} based on the examples.`, op, source: op.source }];
      }
      return [];
    }
    if (op.op === "arrayProject") {
      const rows = getPath(parsedInput, op.source);
      if (rows === undefined) return [{ type: "missing-source", message: `${op.source} is required by the learned rule but is missing from the new input.`, op, source: op.source }];
      if (!Array.isArray(rows)) {
        return [{ type: "invalid-array", message: `${op.source} must be an array for this record projection.`, op, source: op.source }];
      }
      const expectsS3Record = (op.fields || []).some(field => field.source?.startsWith("$.s3."));
      const wrappedS3 = expectsS3Record ? wrappedS3Notification(rows) : null;
      if (wrappedS3) {
        return [{
          type: "wrapped-s3-notification",
          message: `This looks like an S3 notification wrapped in ${wrappedS3.wrapper}. Parse ${wrappedS3.source} as JSON and transform the inner Records array first.`,
          op,
          source: wrappedS3.source,
        }];
      }
      return rows.flatMap((row, rowIndex) => (op.fields || [])
        .filter(field => getPath(row, field.source) === undefined)
        .map(field => {
          const source = formatPath([...parsePath(op.source), rowIndex, ...parsePath(field.source)]);
          return { type: "missing-source", message: `${source} is required by the learned record projection but is missing from the new input.`, op, source };
        }));
    }
    if (op.op === "arrayGroupBy") {
      const rows = getPath(parsedInput, op.source);
      if (rows === undefined) return [{ type: "missing-source", message: `${op.source} is required by the grouping rule but is missing.`, op, source: op.source }];
      if (!Array.isArray(rows)) return [{ type: "invalid-array", message: `${op.source} must be an array for this grouping operation.`, op, source: op.source }];
      const invalidKeyIndex = rows.findIndex(row => {
        const key = getPath(row, op.groupBy);
        return typeof key !== "string" && typeof key !== "number";
      });
      if (invalidKeyIndex >= 0) {
        return [{
          type: "invalid-group-key",
          message: `Item ${invalidKeyIndex + 1} in ${op.source} does not contain a string or number at ${op.groupBy}.`,
          op,
          source: op.source,
        }];
      }
      return [];
    }
    const requiredSources = opSources(op);
    return requiredSources
      .filter(source => getPath(parsedInput, source) === undefined)
      .map(source => ({ type: "missing-source", message: `${source} is required by the learned rule but is missing from the new input.`, op, source }));
  });
}

export function executeJsonTransform(program, input) {
  const parsedInput = parseJson(input, "Input");
  let output = {};
  for (const op of program.ops || []) {
    if (op.domain?.optional && (!op.domain.source || getPath(parsedInput, op.domain.source) === undefined)) continue;
    output = setPath(output, op.target, applyOp(op, parsedInput));
  }
  return output;
}
