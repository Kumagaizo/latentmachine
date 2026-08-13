import { canonicalize, fingerprint, profileStructure } from "./engine.js";
import {
  categoricalStatistics,
  numericStatistics,
  parseIsoTemporal,
  round,
  stringStatistics,
  temporalStatistics,
} from "./statistics.js";

const ANALYSIS_VERSION = "trace-analysis/1";
const MAX_EXAMPLES = 8;
const MAX_AFFECTED_REFS = 20;
const DEFAULT_EXACT_RECORD_LIMIT = 50_000;
const DEFAULT_SAMPLE_SIZE = 20_000;
const DEFAULT_EXACT_LEAF_LIMIT = 500_000;

function seedFromText(text) {
  let seed = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    seed ^= text.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function seededRandom(seed) {
  let state = seed || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function deterministicSampleIndices(total, size, seedText) {
  const count = Math.max(0, Math.min(total, Math.floor(size)));
  if (count >= total) return Array.from({ length: total }, (_, index) => index);
  const output = Array.from({ length: count }, (_, index) => index);
  const random = seededRandom(seedFromText(seedText));
  for (let index = count; index < total; index += 1) {
    const selected = Math.floor(random() * (index + 1));
    if (selected < count) output[selected] = index;
  }
  return output.sort((a, b) => a - b);
}

function parsedType(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pathFromSegments(segments, wildcard = false) {
  if (!segments.length) return "$";
  return `$${segments.map(segment => {
    if (segment === "*") return "[*]";
    if (typeof segment === "number") return wildcard ? "[*]" : `[${segment}]`;
    return /^[A-Za-z_$][\w$]*$/.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`;
  }).join("")}`;
}

function labelFromPath(path) {
  const match = String(path).match(/(?:\.([^.[\]]+)|\["([^"]+)"\])$/);
  return match?.[1] || match?.[2] || "value";
}

function parentPathFromPath(path) {
  if (path === "$") return null;
  return path.replace(/(?:\.[^.\[]+|\[[^\]]+\])$/, "") || "$";
}

function identifierNameHint(label) {
  const value = String(label || "");
  return /^(?:id|uuid|key|identifier)$/i.test(value)
    || /(?:^|[_-])(?:id|uuid|key|identifier)$/i.test(value)
    || /(?:Id|UUID|Key|Identifier)$/.test(value);
}

function primitiveKeyCount(row) {
  return Object.values(row || {}).filter(value => value === null || typeof value !== "object").length;
}

function recordArrayScore(value, depth) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const objects = value.filter(isObject);
  if (objects.length / value.length < 0.8) return null;
  const shared = new Map();
  for (const row of objects) {
    for (const key of Object.keys(row)) {
      if (row[key] === null || typeof row[key] !== "object") shared.set(key, (shared.get(key) || 0) + 1);
    }
  }
  const sharedPrimitive = [...shared.values()].filter(count => count / objects.length >= 0.5).length;
  if (!sharedPrimitive || !objects.some(row => primitiveKeyCount(row))) return null;
  return objects.length * 100 - depth * 10 + sharedPrimitive;
}

function discoverRecordSets(value) {
  const candidates = [];
  const visit = (node, segments = [], depth = 0) => {
    const score = recordArrayScore(node, depth);
    if (score !== null) candidates.push({ value: node, segments, path: pathFromSegments(segments), score, depth });
    if (Array.isArray(node)) {
      node.slice(0, 50).forEach((item, index) => {
        if (item && typeof item === "object") visit(item, [...segments, index], depth + 1);
      });
    } else if (isObject(node)) {
      Object.keys(node).sort().forEach(key => visit(node[key], [...segments, key], depth + 1));
    }
  };
  visit(value);
  return candidates.sort((a, b) => b.score - a.score || a.depth - b.depth || a.path.localeCompare(b.path));
}

function collectRecordLeaves(value, segments = [], output = []) {
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    if (!keys.length) output.push({ segments, value, type: "object" });
    keys.forEach(key => collectRecordLeaves(value[key], [...segments, key], output));
    return output;
  }
  if (Array.isArray(value)) {
    if (!value.length || value.every(item => item === null || typeof item !== "object")) {
      output.push({ segments, value, type: "array" });
    } else {
      output.push({ segments, value, type: "array" });
    }
    return output;
  }
  output.push({ segments, value, type: parsedType(value) });
  return output;
}

function createAccumulator(path, relativeSegments) {
  return {
    path,
    relativeSegments,
    label: labelFromPath(path),
    values: [],
    valueRefs: [],
    typeCounts: {},
    seenRecords: new Set(),
    absenceRefs: [],
    emptyString: 0,
    whitespaceOnly: 0,
    examples: [],
  };
}

function stableExample(value) {
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (isObject(value)) return `{${Object.keys(value).length} fields}`;
  return value;
}

function addValue(accumulator, value, recordIndex) {
  const type = parsedType(value);
  accumulator.typeCounts[type] = (accumulator.typeCounts[type] || 0) + 1;
  accumulator.seenRecords.add(recordIndex);
  accumulator.values.push(value);
  accumulator.valueRefs.push(recordIndex);
  if (typeof value === "string") {
    if (value === "") accumulator.emptyString += 1;
    else if (!value.trim()) accumulator.whitespaceOnly += 1;
  }
  if (accumulator.examples.length < MAX_EXAMPLES) {
    const example = stableExample(value);
    if (!accumulator.examples.some(item => canonicalize(item) === canonicalize(example))) accumulator.examples.push(example);
  }
}

function buildRecordAccumulators(candidate) {
  const accumulators = new Map();
  const baseSegments = candidate.segments.length ? [...candidate.segments, "*"] : ["*"];
  candidate.value.forEach((record, sampledIndex) => {
    const recordIndex = candidate.recordIndices?.[sampledIndex] ?? sampledIndex;
    const leaves = collectRecordLeaves(record);
    for (const leaf of leaves) {
      const path = pathFromSegments([...baseSegments, ...leaf.segments]);
      if (!accumulators.has(path)) accumulators.set(path, createAccumulator(path, leaf.segments));
      addValue(accumulators.get(path), leaf.value, recordIndex);
    }
  });
  const recordRefs = candidate.value.map((_, sampledIndex) => candidate.recordIndices?.[sampledIndex] ?? sampledIndex);
  accumulators.forEach(accumulator => {
    accumulator.absenceRefs = recordRefs.filter(recordIndex => !accumulator.seenRecords.has(recordIndex));
  });
  return accumulators;
}

function buildDocumentAccumulators(value) {
  const accumulators = new Map();
  const primitiveRootSeries = Array.isArray(value) && value.length > 0 && value.every(item => item === null || typeof item !== "object");
  const visit = (node, segments = []) => {
    if (isObject(node)) {
      const keys = Object.keys(node).sort();
      if (!keys.length) {
        const path = pathFromSegments(segments);
        const accumulator = createAccumulator(path, segments);
        addValue(accumulator, node, 0);
        accumulators.set(path, accumulator);
      } else keys.forEach(key => visit(node[key], [...segments, key]));
      return;
    }
    if (Array.isArray(node) && (!primitiveRootSeries || segments.length > 0)) {
      const path = pathFromSegments(segments);
      const accumulator = createAccumulator(path, segments);
      addValue(accumulator, node, 0);
      accumulators.set(path, accumulator);
      return;
    }
    const path = pathFromSegments(segments);
    const accumulator = createAccumulator(path, segments);
    if (Array.isArray(node)) node.forEach((item, index) => addValue(accumulator, item, index));
    else addValue(accumulator, node, 0);
    accumulators.set(path, accumulator);
  };
  visit(value);
  return accumulators;
}

function roleFor(accumulator, totalRecords, categorical, strings, temporal, numeric, sampled = false) {
  const nonNullTypes = Object.keys(accumulator.typeCounts).filter(type => type !== "null" && accumulator.typeCounts[type] > 0);
  const name = accumulator.label.toLowerCase();
  const presentRate = accumulator.seenRecords.size / Math.max(1, totalRecords);
  if (nonNullTypes.length > 1) return { id: "unknown", confidence: 1, evidence: [`${nonNullTypes.length} non-null parsed types occur`] };
  const type = nonNullTypes[0] || "null";
  if (type === "boolean") return { id: "boolean", confidence: 1, evidence: ["All present non-null values are boolean"] };
  if (type === "number") {
    const integerOnly = accumulator.values.filter(Number.isFinite).every(Number.isInteger);
    const distinct = categorical?.distinctCount || 0;
    const unique = distinct === accumulator.values.filter(Number.isFinite).length;
    const nameHint = identifierNameHint(accumulator.label) || /(^|_)(code|number)$/.test(name);
    if (!sampled && integerOnly && unique && presentRate >= 0.98 && totalRecords >= 20 && nameHint) {
      return { id: "identifier", confidence: 0.96, evidence: ["Values are complete and unique", `Field name ${accumulator.label} suggests an identifier`] };
    }
    return { id: "numeric-measure", confidence: 0.98, evidence: ["All present non-null values are finite numbers"] };
  }
  if (type === "string") {
    if (temporal) return { id: temporal.role, confidence: 0.96, evidence: [`${round(temporal.count / accumulator.values.length * 100, 1)}% use an unambiguous ISO ${temporal.role} format`] };
    const pattern = strings?.patternCoverage?.[0];
    if (pattern) {
      const patternRole = {
        "uuid-like": "uuid-like",
        "email-like": "email-like",
        "url-like": "url-like",
        "iso-date-like": "date",
        "iso-datetime-like": "datetime",
      }[pattern.id];
      if (patternRole) return { id: patternRole, confidence: pattern.share, evidence: [`${round(pattern.share * 100, 1)}% match the ${pattern.id} pattern`] };
    }
    const distinctRatio = categorical?.distinctRatio || 0;
    const unique = categorical?.distinctCount === accumulator.values.filter(value => value !== null).length;
    const nameHint = identifierNameHint(accumulator.label);
    if (!sampled && unique && presentRate >= 0.98 && totalRecords >= 20 && nameHint) {
      return { id: "identifier", confidence: 0.98, evidence: ["Values are complete and unique", `Field name ${accumulator.label} suggests an identifier`] };
    }
    if (categorical && categorical.distinctCount >= 2 && categorical.distinctCount <= 20 && distinctRatio <= 0.2) {
      return { id: "category", confidence: 0.9, evidence: [`${categorical.distinctCount} recurring values cover the field`] };
    }
    return { id: "text", confidence: 0.9, evidence: ["Present values are strings"] };
  }
  if (type === "array") return { id: "unknown", confidence: 1, evidence: ["Field contains arrays"] };
  return { id: "unknown", confidence: 1, evidence: ["No stable scalar role was inferred"] };
}

function profileAccumulator(accumulator, totalRecords, sampled = false) {
  const present = accumulator.seenRecords.size;
  const absent = Math.max(0, totalRecords - present);
  const nullCount = accumulator.typeCounts.null || 0;
  const nonNull = accumulator.values.filter(value => value !== null && value !== undefined);
  const primitive = nonNull.filter(value => typeof value !== "object");
  const numericPairs = accumulator.values.map((value, index) => ({ value, recordRef: accumulator.valueRefs[index] }))
    .filter(item => typeof item.value === "number" && Number.isFinite(item.value));
  const numbers = numericPairs.map(item => item.value);
  const stringsOnly = primitive.filter(value => typeof value === "string");
  const categorical = primitive.length ? categoricalStatistics(primitive) : null;
  const numeric = numbers.length && numbers.length === primitive.length ? numericStatistics(numbers) : null;
  if (numeric?.unusual) {
    numeric.unusual = numeric.unusual.map(item => ({ ...item, recordRef: numericPairs[item.index]?.recordRef }));
  }
  const strings = stringsOnly.length && stringsOnly.length === primitive.length ? stringStatistics(stringsOnly) : null;
  const temporal = stringsOnly.length && stringsOnly.length === primitive.length ? temporalStatistics(stringsOnly) : null;
  const role = roleFor(accumulator, totalRecords, categorical, strings, temporal, numeric, sampled);
  const isoTemporalCount = stringsOnly.map(parseIsoTemporal).filter(Boolean).length;
  if (stringsOnly.length && !temporal && isoTemporalCount) {
    role.evidence.push(`${isoTemporalCount} of ${stringsOnly.length} values use unambiguous ISO dates; temporal inference requires at least 90% across 8 or more values`);
  }
  return {
    path: accumulator.path,
    label: accumulator.label,
    parentPath: parentPathFromPath(accumulator.path),
    relativeSegments: accumulator.relativeSegments,
    parsedTypes: Object.fromEntries(Object.entries(accumulator.typeCounts).sort(([a], [b]) => a.localeCompare(b))),
    role,
    completeness: {
      total: totalRecords,
      present,
      absent,
      null: nullCount,
      emptyString: accumulator.emptyString,
      whitespaceOnly: accumulator.whitespaceOnly,
      presentRate: round(present / Math.max(1, totalRecords)),
    },
    distinct: categorical ? { count: categorical.distinctCount, exact: !sampled, ratio: categorical.distinctRatio } : { count: 0, exact: !sampled, ratio: 0 },
    numeric,
    categorical,
    temporal,
    temporalInference: stringsOnly.length ? { isoCount: isoTemporalCount, total: stringsOnly.length, applied: Boolean(temporal), threshold: 0.9, minimumCount: 8 } : null,
    string: strings,
    examples: accumulator.examples,
    absenceRefs: accumulator.absenceRefs,
    valueRefs: accumulator.valueRefs,
    values: accumulator.values,
    insightIds: [],
    coverage: { mode: sampled ? "sampled" : "exact", analyzedRecords: totalRecords },
  };
}

function levelWeight(level) {
  return { attention: 3, notable: 2, context: 1 }[level] || 0;
}

function insight(kind, level, field, message, options = {}) {
  const confidence = options.confidence ?? 1;
  const impact = options.impact ?? 0.2;
  const priority = options.priority ?? (level === "attention" ? 36 : level === "notable" ? 28 : 16);
  const score = round(priority + confidence * 20 + Math.min(1, impact) * 25 + 10 + (options.novelty ?? 3), 2);
  return {
    id: `${kind}:${field?.path || "$"}${options.suffix ? `:${options.suffix}` : ""}`,
    kind,
    level,
    confidence: { value: round(confidence), label: confidence >= 0.95 ? "certain" : confidence >= 0.75 ? "supported" : "limited" },
    title: options.title || kind.replace(/-/g, " ").replace(/^./, character => character.toUpperCase()),
    message,
    fieldPaths: field ? [field.path] : [],
    evidence: options.evidence || [],
    affected: { count: options.affectedRefs?.length || options.affectedCount || 0, recordRefs: (options.affectedRefs || []).slice(0, MAX_AFFECTED_REFS), capped: (options.affectedRefs || []).length > MAX_AFFECTED_REFS },
    visual: options.visual || null,
    action: options.action || (field ? { kind: "open-field", fieldPath: field.path } : null),
    rank: { score, components: { priority, confidence: round(confidence * 20, 2), impact: round(Math.min(1, impact) * 25, 2), coverage: 10, novelty: options.novelty ?? 3 } },
  };
}

function fieldInsights(field, totalRecords) {
  const output = [];
  const missingCount = field.completeness.absent + field.completeness.null + field.completeness.emptyString + field.completeness.whitespaceOnly;
  if (totalRecords >= 8 && missingCount > 0) {
    const rate = missingCount / totalRecords;
    const refs = [
      ...(field.absenceRefs || []),
      ...field.valueRefs.filter((_, index) => field.values[index] === null || field.values[index] === "" || (typeof field.values[index] === "string" && !field.values[index].trim())),
    ].sort((a, b) => a - b);
    output.push(insight("missingness", rate >= 0.2 ? "notable" : "context", field,
      `${field.label} is absent, null, empty, or whitespace-only in ${round(rate * 100, 1)}% of records.`, {
        title: "Missing values",
        impact: rate,
        affectedCount: missingCount,
        affectedRefs: refs,
        evidence: [
          { metric: "missing-rate", observed: round(rate), numerator: missingCount, denominator: totalRecords, method: "exact count" },
          { metric: "absent-count", observed: field.completeness.absent, denominator: totalRecords, method: "exact count" },
          { metric: "null-count", observed: field.completeness.null, denominator: totalRecords, method: "exact count" },
          { metric: "empty-string-count", observed: field.completeness.emptyString, denominator: totalRecords, method: "exact count" },
          { metric: "whitespace-only-count", observed: field.completeness.whitespaceOnly, denominator: totalRecords, method: "exact count" },
        ],
        visual: { kind: "completeness-bar", model: field.completeness },
        action: { kind: "filter-records", filter: { fieldPath: field.path, state: "missing" } },
      }));
  }
  const nonNullTypes = Object.keys(field.parsedTypes).filter(type => type !== "null" && field.parsedTypes[type] > 0);
  if (nonNullTypes.length > 1) {
    output.push(insight("mixed-types", "attention", field,
      `${field.label} contains ${nonNullTypes.length} non-null parsed types: ${nonNullTypes.join(", ")}.`, {
        title: "Mixed field types",
        impact: 0.8,
        affectedRefs: field.valueRefs,
        evidence: nonNullTypes.map(type => ({ metric: "type-count", type, observed: field.parsedTypes[type], method: "exact count" })),
      }));
  }
  if (field.role.id === "identifier") {
    output.push(insight("likely-identifier", "context", field,
      `${field.label} is unique and present in nearly every record, so it may be a useful identifier.`, {
        title: "Likely identifier",
        confidence: field.role.confidence,
        impact: 0.35,
        evidence: [{ metric: "uniqueness-ratio", observed: field.distinct.ratio, denominator: field.completeness.present, method: "exact distinct count" }, { metric: "present-rate", observed: field.completeness.presentRate, method: "exact count" }],
      }));
  }
  if (field.categorical && field.categorical.count >= 20 && field.categorical.top.length) {
    const top = field.categorical.top[0];
    if (top.share >= 0.95) {
      output.push(insight("near-constant", "context", field,
        `${field.label} is ${JSON.stringify(top.value)} in ${round(top.share * 100, 1)}% of present values.`, {
          title: "Near-constant field",
          impact: top.share,
          evidence: [{ metric: "top-value-share", observed: top.share, numerator: top.count, denominator: field.categorical.count, method: "exact count" }],
          visual: { kind: "category-bars", model: field.categorical },
        }));
    } else if (top.share >= 0.8) {
      output.push(insight("dominant-category", "context", field,
        `${field.label} uses ${field.categorical.distinctCount} values; ${JSON.stringify(top.value)} represents ${round(top.share * 100, 1)}%.`, {
          title: "Dominant value",
          impact: top.share,
          evidence: [{ metric: "top-value-share", observed: top.share, numerator: top.count, denominator: field.categorical.count, method: "exact count" }],
          visual: { kind: "category-bars", model: field.categorical },
        }));
    } else if (field.role.id === "category") {
      output.push(insight("enum-candidate", "context", field,
        `${field.label} uses a compact set of ${field.categorical.distinctCount} recurring values.`, {
          title: "Category field",
          impact: 0.25,
          evidence: [{ metric: "distinct-count", observed: field.categorical.distinctCount, denominator: field.categorical.count, method: "exact count" }],
          visual: { kind: "category-bars", model: field.categorical },
        }));
    }
  }
  if (field.numeric?.unusual?.length) {
    const refs = field.numeric.unusual.map(item => item.recordRef).filter(value => value !== undefined);
    const confidence = field.numeric.count >= 100 ? 0.98 : field.numeric.count >= 20 ? 0.86 : 0.62;
    output.push(insight("unusual-numeric", "notable", field,
      `${field.label} contains ${field.numeric.unusual.length} value${field.numeric.unusual.length === 1 ? "" : "s"} far from the field median.`, {
        title: "Unusual values",
        confidence,
        impact: field.numeric.unusual.length / field.numeric.count,
        affectedRefs: refs,
        evidence: [
          { metric: "unusual-count", observed: field.numeric.unusual.length, denominator: field.numeric.count, method: field.numeric.unusual[0].method },
          { metric: "median", observed: field.numeric.median, method: "deterministic quantile" },
          { metric: "mad", observed: field.numeric.mad, method: "median absolute deviation" },
          { metric: "modified-z-threshold", observed: 3.5, method: "absolute modified z score" },
          ...field.numeric.unusual.slice(0, 5).map((item, index) => ({ metric: "unusual-value", observed: item.value, recordRef: refs[index], score: item.score, method: item.method, raw: true })),
        ],
        visual: { kind: "histogram", model: field.numeric },
        action: { kind: "filter-records", filter: { fieldPath: field.path, state: "unusual" } },
      }));
  }
  if (field.temporal?.gaps?.length) {
    output.push(insight("temporal-gap", "notable", field,
      `${field.label} contains ${field.temporal.gaps.length} interval${field.temporal.gaps.length === 1 ? "" : "s"} much larger than its usual spacing.`, {
        title: "Time gap",
        confidence: 0.88,
        impact: 0.35,
        evidence: field.temporal.gaps.slice(0, 3).map(gap => ({ metric: "gap-ms", observed: gap.intervalMs, baseline: gap.medianIntervalMs, method: "3x median interval and 5% span" })),
        visual: { kind: "timeline", model: field.temporal },
      }));
  }
  return output;
}

function duplicateSummary(records, recordIndices = null, sampled = false) {
  if (!records?.length) return null;
  const groups = new Map();
  records.forEach((record, index) => {
    const key = canonicalize(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(recordIndices?.[index] ?? index);
  });
  const duplicates = [...groups.values()].filter(indices => indices.length > 1).sort((a, b) => b.length - a.length || a[0] - b[0]);
  return {
    duplicateRecordCount: duplicates.reduce((sum, indices) => sum + indices.length - 1, 0),
    duplicateGroupCount: duplicates.length,
    largestGroupSize: duplicates[0]?.length || 1,
    groups: duplicates.slice(0, 20),
    exact: !sampled,
  };
}

function discloseSampling(insights) {
  return insights.map(item => ({
    ...item,
    confidence: { value: round(item.confidence.value * 0.9), label: item.confidence.value * 0.9 >= 0.75 ? "supported" : "limited" },
    message: `${item.message.replace(/\.$/, "")} in the analyzed sample.`,
    evidence: item.evidence.map(evidence => ({ ...evidence, method: String(evidence.method || "count").replace(/^exact /, "sample ").replace("exact distinct", "sample distinct") })),
    rank: { ...item.rank, components: { ...item.rank.components, coverage: 7 }, score: round(item.rank.score - 3, 2) },
  }));
}

function selectOverviewInsights(insights) {
  const sorted = insights.slice().sort((a, b) => b.rank.score - a.rank.score || levelWeight(b.level) - levelWeight(a.level) || a.kind.localeCompare(b.kind) || (a.fieldPaths[0] || "").localeCompare(b.fieldPaths[0] || "") || a.id.localeCompare(b.id));
  const kinds = new Map();
  const fields = new Map();
  const selected = [];
  for (const item of sorted) {
    const kindCount = kinds.get(item.kind) || 0;
    const path = item.fieldPaths[0] || "$";
    const fieldCount = fields.get(path) || 0;
    if (kindCount >= 2 || fieldCount >= 2) continue;
    selected.push(item);
    kinds.set(item.kind, kindCount + 1);
    fields.set(path, fieldCount + 1);
    if (selected.length === 6) break;
  }
  return { all: sorted, overview: selected };
}

function portraitFor(fields, selectedInsights) {
  const referenced = new Set(selectedInsights.flatMap(item => item.fieldPaths));
  const candidates = fields.slice().sort((a, b) => Number(referenced.has(b.path)) - Number(referenced.has(a.path)) || (b.numeric?.count || b.categorical?.count || 0) - (a.numeric?.count || a.categorical?.count || 0) || a.path.localeCompare(b.path));
  const components = candidates.slice(0, 4).map(field => {
    if (field.numeric) return { kind: "histogram", fieldPath: field.path, label: field.label, model: field.numeric };
    if (field.temporal) return { kind: "timeline", fieldPath: field.path, label: field.label, model: field.temporal };
    if (field.categorical) return { kind: field.role.id === "boolean" ? "boolean-split" : "category-bars", fieldPath: field.path, label: field.label, model: field.categorical };
    return { kind: "completeness-bar", fieldPath: field.path, label: field.label, model: field.completeness };
  });
  return {
    fieldTypeCounts: fields.reduce((counts, field) => ({ ...counts, [field.role.id]: (counts[field.role.id] || 0) + 1 }), {}),
    completeness: fields.map(field => ({ path: field.path, label: field.label, presentRate: field.completeness.presentRate })),
    components,
  };
}

function shapeSummary(rootKind, recordCount, fields, shape) {
  if (rootKind === "record-set") {
    const roleCounts = fields.reduce((counts, field) => ({ ...counts, [field.role.id]: (counts[field.role.id] || 0) + 1 }), {});
    const parts = [];
    if (roleCounts["numeric-measure"]) parts.push(`${roleCounts["numeric-measure"]} numeric`);
    if (roleCounts.category) parts.push(`${roleCounts.category} categorical`);
    if (roleCounts.date || roleCounts.datetime) parts.push(`${(roleCounts.date || 0) + (roleCounts.datetime || 0)} temporal`);
    return `${recordCount} records with ${fields.length} fields${parts.length ? `, including ${parts.join(", ")} fields` : ""}.`;
  }
  if (rootKind === "series") return `${shape.counts.leaves} values in a structured series with depth ${shape.maxDepth}.`;
  if (rootKind === "scalar") return "One scalar value.";
  if (rootKind === "empty") return "An empty structured value.";
  return `${shape.counts.leaves} values across ${shape.counts.objects} objects and ${shape.counts.arrays} arrays, with depth ${shape.maxDepth}.`;
}

function schemaEntriesForCandidate(candidate) {
  const types = new Map();
  const baseSegments = candidate.segments.length ? [...candidate.segments, "*"] : ["*"];
  const record = (segments, type) => {
    const path = pathFromSegments([...baseSegments, ...segments]);
    if (!types.has(path)) types.set(path, new Set());
    types.get(path).add(type);
  };
  const visit = (node, segments = []) => {
    if (isObject(node)) {
      record(segments, "object");
      Object.keys(node).sort().forEach(key => visit(node[key], [...segments, key]));
      return;
    }
    if (Array.isArray(node)) {
      record(segments, "array");
      return;
    }
    record(segments, parsedType(node));
  };
  candidate.value.forEach(row => visit(row));
  return [...types].map(([path, values]) => ({ path, types: [...values].sort() })).sort((a, b) => a.path.localeCompare(b.path));
}

export function schemaFingerprint(value, recordSetPath = null) {
  const candidates = discoverRecordSets(value);
  const candidate = (recordSetPath ? candidates.find(item => item.path === recordSetPath) : null) || candidates[0] || null;
  const schema = candidate ? schemaEntriesForCandidate(candidate) : [...buildDocumentAccumulators(value).values()].map(accumulator => ({
    path: accumulator.path,
    types: Object.keys(accumulator.typeCounts).sort(),
  })).sort((a, b) => a.path.localeCompare(b.path));
  return fingerprint(schema);
}

export function analyzeTrace(value, options = {}) {
  const startedAt = performance.now();
  const candidates = discoverRecordSets(value);
  let candidate = candidates[0] || null;
  if (options.recordSetPath) candidate = candidates.find(item => item.path === options.recordSetPath) || candidate;
  const rootKind = Array.isArray(value) && !value.length ? "empty"
    : isObject(value) && !Object.keys(value).length ? "empty"
      : candidate ? "record-set"
        : Array.isArray(value) ? "series"
          : value && typeof value === "object" ? "document" : "scalar";
  const recordCount = candidate?.value.length || (rootKind === "series" ? value.length : 1);
  const structure = profileStructure(value);
  const content = fingerprint(value);
  const exactLimit = Math.max(1, Number(options.exactRecordLimit) || DEFAULT_EXACT_RECORD_LIMIT);
  const requestedSampleSize = Math.max(1, Number(options.sampleSize) || DEFAULT_SAMPLE_SIZE);
  const exactLeafLimit = Math.max(1, Number(options.exactLeafLimit) || DEFAULT_EXACT_LEAF_LIMIT);
  const sampled = Boolean(candidate && (recordCount > exactLimit || structure.counts.leaves > exactLeafLimit));
  const sampleSeed = sampled ? `${content.hex}:${ANALYSIS_VERSION}:${recordCount}:${requestedSampleSize}` : null;
  const sampleIndices = sampled ? deterministicSampleIndices(recordCount, Math.min(requestedSampleSize, exactLimit), sampleSeed) : null;
  const analysisCandidate = sampled ? { ...candidate, value: sampleIndices.map(index => candidate.value[index]), recordIndices: sampleIndices } : candidate;
  const analyzedRecordCount = analysisCandidate?.value.length || recordCount;
  const accumulators = analysisCandidate ? buildRecordAccumulators(analysisCandidate) : buildDocumentAccumulators(value);
  const fields = [...accumulators.values()].map(accumulator => profileAccumulator(accumulator, analyzedRecordCount, sampled)).sort((a, b) => a.path.localeCompare(b.path));
  const duplicate = analysisCandidate ? duplicateSummary(analysisCandidate.value, analysisCandidate.recordIndices, sampled) : null;
  let insights = fields.flatMap(field => fieldInsights(field, analyzedRecordCount));
  if (duplicate?.duplicateRecordCount) {
    insights.push(insight("duplicate-records", "notable", null,
      `${duplicate.duplicateRecordCount} record${duplicate.duplicateRecordCount === 1 ? " is" : "s are"} repeated across ${duplicate.duplicateGroupCount} duplicate group${duplicate.duplicateGroupCount === 1 ? "" : "s"}.`, {
        title: "Duplicate records",
        impact: duplicate.duplicateRecordCount / analyzedRecordCount,
        affectedRefs: duplicate.groups.flat(),
        evidence: [{ metric: "duplicate-record-count", observed: duplicate.duplicateRecordCount, denominator: analyzedRecordCount, method: "canonical equality" }],
        action: { kind: "filter-records", filter: { state: "duplicate" } },
      }));
  }
  if (sampled) insights = discloseSampling(insights);
  const selected = selectOverviewInsights(insights);
  insights = selected.all;
  const insightMap = new Map();
  insights.forEach(item => item.fieldPaths.forEach(path => {
    if (!insightMap.has(path)) insightMap.set(path, []);
    insightMap.get(path).push(item.id);
  }));
  fields.forEach(field => { field.insightIds = insightMap.get(field.path) || []; });
  const schema = schemaFingerprint(value, candidate?.path || null);
  const analyzedStructure = sampled ? profileStructure(analysisCandidate.value) : structure;
  return {
    version: ANALYSIS_VERSION,
    status: "ready",
    source: {
      format: options.format || "value",
      bytes: options.bytes ?? (JSON.stringify(value)?.length || 0),
      name: options.name || "Pasted data",
      contentFingerprint: content.hex,
      schemaFingerprint: schema.hex,
    },
    coverage: {
      mode: sampled ? "sampled" : "exact",
      totalRecords: recordCount,
      analyzedRecords: analyzedRecordCount,
      totalLeaves: structure.counts.leaves,
      analyzedLeaves: analyzedStructure.counts.leaves,
      sampleSeed,
      sampleStrategy: sampled ? "seeded reservoir over full record range" : null,
    },
    shape: {
      rootKind,
      recordSetPath: candidate?.path || null,
      recordCount: candidate ? recordCount : null,
      fieldCount: fields.length,
      maxDepth: structure.maxDepth,
      objectCount: structure.counts.objects,
      arrayCount: structure.counts.arrays,
      scalarCount: structure.counts.leaves,
      summary: shapeSummary(rootKind, recordCount, fields, structure),
      recordSetCandidates: candidates.map(item => ({ path: item.path, count: item.value.length })),
    },
    fields,
    insights,
    overviewInsightIds: selected.overview.map(item => item.id),
    portrait: portraitFor(fields, selected.overview),
    recordSet: candidate ? {
      path: candidate.path,
      recordCount,
      fieldPaths: fields.map(field => field.path),
      likelyIdentifier: fields.filter(field => field.role.id === "identifier").sort((a, b) => b.role.confidence - a.role.confidence || a.path.localeCompare(b.path))[0]?.path || null,
      duplicate,
      sampleRecordRefs: sampleIndices,
    } : null,
    warnings: [],
    telemetry: {
      durationMs: Math.round(performance.now() - startedAt),
      method: "trace-analysis",
    },
  };
}

export function traceRecordSet(value, path = null) {
  const candidates = discoverRecordSets(value);
  const candidate = path ? candidates.find(item => item.path === path) : candidates[0];
  return candidate?.value || null;
}

export function valueAtRelativePath(record, segments = []) {
  let value = record;
  for (const segment of segments) {
    if (value === null || value === undefined) return undefined;
    value = value[segment];
  }
  return value;
}

export { ANALYSIS_VERSION, DEFAULT_EXACT_RECORD_LIMIT, DEFAULT_EXACT_LEAF_LIMIT, DEFAULT_SAMPLE_SIZE };
