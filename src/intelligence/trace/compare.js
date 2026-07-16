import { canonicalize } from "./engine.js";
import { analyzeTrace, traceRecordSet, valueAtRelativePath } from "./analyze.js";
import { jensenShannon, ksStatistic, round } from "./statistics.js";

const COMPARISON_VERSION = "trace-comparison/1";

function relativeKey(field) {
  return JSON.stringify(field.relativeSegments || []);
}

function primitiveTypeSet(field) {
  return Object.keys(field?.parsedTypes || {}).filter(type => field.parsedTypes[type] > 0).sort();
}

function sameArray(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function canonicalScalar(value) {
  return value === undefined ? "__missing__" : canonicalize(value);
}

function numericEqual(a, b, absoluteTolerance, relativeTolerance) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
  const difference = Math.abs(a - b);
  if (difference <= absoluteTolerance) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return difference / scale <= relativeTolerance;
}

function equivalent(a, b, options) {
  const normalizeMissing = value => {
    if (!options.missingEquivalent) return value;
    return value === undefined || value === null || value === "" ? null : value;
  };
  const left = normalizeMissing(a);
  const right = normalizeMissing(b);
  if (!options.missingEquivalent && ((left === undefined) !== (right === undefined))) return false;
  if (typeof left === "number" && typeof right === "number") {
    return numericEqual(left, right, options.absoluteTolerance, options.relativeTolerance);
  }
  if (options.ignoreArrayOrder && Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    const leftItems = left.map(item => canonicalize(item)).sort();
    const rightItems = right.map(item => canonicalize(item)).sort();
    return leftItems.every((item, index) => item === rightItems[index]);
  }
  return canonicalize(left) === canonicalize(right);
}

function collectChanges(a, b, options, segments = [], output = []) {
  if (equivalent(a, b, options)) return output;
  const leftObject = a && typeof a === "object" && !Array.isArray(a);
  const rightObject = b && typeof b === "object" && !Array.isArray(b);
  if (leftObject && rightObject) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    keys.forEach(key => {
      if (options.ignoredRelativeKeys.has(JSON.stringify([...segments, key]))) return;
      collectChanges(a[key], b[key], options, [...segments, key], output);
    });
    return output;
  }
  output.push({
    relativeSegments: segments,
    path: segments.length ? segments.map(segment => typeof segment === "number" ? `[${segment}]` : segment).join(".").replace(/\.\[/g, "[") : "$",
    before: a,
    after: b,
    status: a === undefined ? "added" : b === undefined ? "removed" : "changed",
  });
  return output;
}

function keyCandidate(baseline, candidate, requestedPath) {
  const leftFields = new Map(baseline.fields.map(field => [relativeKey(field), field]));
  const rightFields = new Map(candidate.fields.map(field => [relativeKey(field), field]));
  const requestedPaths = Array.isArray(requestedPath) ? requestedPath.filter(Boolean) : requestedPath ? [requestedPath] : [];
  if (requestedPaths.length) {
    const parts = requestedPaths.map(path => {
      const left = baseline.fields.find(field => field.path === path || relativeKey(field) === path);
      const right = left ? rightFields.get(relativeKey(left)) : candidate.fields.find(field => field.path === path || relativeKey(field) === path);
      return left && right ? { left, right } : null;
    }).filter(Boolean);
    if (parts.length === requestedPaths.length) return { ...parts[0], parts, mode: parts.length > 1 ? "selected-compound" : "selected" };
  }
  const candidates = [];
  for (const left of baseline.fields) {
    const right = rightFields.get(relativeKey(left));
    if (!right || left.role.id !== "identifier" || right.role.id !== "identifier") continue;
    candidates.push({ left, right, parts: [{ left, right }], mode: "suggested", score: left.role.confidence + right.role.confidence });
  }
  return candidates.sort((a, b) => b.score - a.score || a.left.path.localeCompare(b.left.path))[0] || null;
}

function buildKeyIndex(records, keyFields) {
  const index = new Map();
  records.forEach((record, rowIndex) => {
    const values = keyFields.map(field => valueAtRelativePath(record, field.relativeSegments));
    const value = values.length === 1 ? values[0] : values;
    const key = canonicalScalar(value);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ rowIndex, record, value });
  });
  const duplicates = [...index.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({ key, value: rows[0].value, rowIndices: rows.map(row => row.rowIndex) }));
  return { index, duplicates };
}

function rowComparison(baselineRecords, candidateRecords, key, options) {
  if (!key) return null;
  const parts = key.parts || [{ left: key.left, right: key.right }];
  const leftFields = parts.map(part => part.left);
  const rightFields = parts.map(part => part.right);
  const left = buildKeyIndex(baselineRecords, leftFields);
  const right = buildKeyIndex(candidateRecords, rightFields);
  const keyMeta = {
    baselinePath: leftFields.map(field => field.path).join(" + "),
    candidatePath: rightFields.map(field => field.path).join(" + "),
    baselinePaths: leftFields.map(field => field.path),
    candidatePaths: rightFields.map(field => field.path),
    mode: key.mode,
  };
  if (left.duplicates.length || right.duplicates.length) {
    return {
      status: "duplicate-keys",
      key: keyMeta,
      duplicates: { baseline: left.duplicates, candidate: right.duplicates },
      counts: null,
      rows: [],
    };
  }
  const keys = [...new Set([...left.index.keys(), ...right.index.keys()])].sort();
  const rows = [];
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const encodedKey of keys) {
    const before = left.index.get(encodedKey)?.[0];
    const after = right.index.get(encodedKey)?.[0];
    if (!before) {
      counts.added += 1;
      rows.push({ status: "added", key: after.value, baselineIndex: null, candidateIndex: after.rowIndex, before: null, after: after.record, changes: [] });
      continue;
    }
    if (!after) {
      counts.removed += 1;
      rows.push({ status: "removed", key: before.value, baselineIndex: before.rowIndex, candidateIndex: null, before: before.record, after: null, changes: [] });
      continue;
    }
    const changes = collectChanges(before.record, after.record, options);
    const status = changes.length ? "changed" : "unchanged";
    counts[status] += 1;
    rows.push({ status, key: before.value, baselineIndex: before.rowIndex, candidateIndex: after.rowIndex, before: before.record, after: after.record, changes });
  }
  const orderChanged = counts.added === 0 && counts.removed === 0 && baselineRecords.length === candidateRecords.length
    && baselineRecords.some((record, index) => canonicalScalar(leftFields.map(field => valueAtRelativePath(record, field.relativeSegments))) !== canonicalScalar(rightFields.map(field => valueAtRelativePath(candidateRecords[index], field.relativeSegments))));
  return {
    status: "ready",
    key: keyMeta,
    duplicates: { baseline: [], candidate: [] },
    counts,
    orderChanged,
    rows,
  };
}

function fieldComparison(baseline, candidate) {
  const left = new Map(baseline.fields.map(field => [relativeKey(field), field]));
  const right = new Map(candidate.fields.map(field => [relativeKey(field), field]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  return keys.map(key => {
    const before = left.get(key) || null;
    const after = right.get(key) || null;
    let status = "same";
    if (!before) status = "added";
    else if (!after) status = "removed";
    else if (!sameArray(primitiveTypeSet(before), primitiveTypeSet(after))) status = "type-changed";
    else if (before.role.id !== after.role.id) status = "role-changed";
    else if (Math.abs(before.completeness.presentRate - after.completeness.presentRate) >= 0.01) status = "presence-changed";
    const numericShift = before?.numeric && after?.numeric ? {
      medianDelta: round(after.numeric.median - before.numeric.median),
      medianRelativeDelta: before.numeric.median ? round((after.numeric.median - before.numeric.median) / Math.abs(before.numeric.median)) : null,
      ks: before.numeric.count >= 30 && after.numeric.count >= 30 ? ksStatistic(before.values, after.values) : null,
    } : null;
    let categoricalShift = null;
    if (before?.categorical && after?.categorical && ["category", "boolean"].includes(before.role.id) && ["category", "boolean"].includes(after.role.id)) {
      const leftCounts = new Map(before.categorical.top.map(item => [item.value, item.count]));
      const rightCounts = new Map(after.categorical.top.map(item => [item.value, item.count]));
      const beforeValues = new Set(before.categorical.top.map(item => item.value));
      const afterValues = new Set(after.categorical.top.map(item => item.value));
      categoricalShift = {
        addedCategories: [...afterValues].filter(value => !beforeValues.has(value)),
        removedCategories: [...beforeValues].filter(value => !afterValues.has(value)),
        jsd: jensenShannon(leftCounts, rightCounts),
      };
    }
    return {
      key,
      path: after?.path || before?.path,
      label: after?.label || before?.label,
      status,
      baseline: before,
      candidate: after,
      deltas: {
        presentRate: before && after ? round(after.completeness.presentRate - before.completeness.presentRate) : null,
        distinctCount: before && after ? after.distinct.count - before.distinct.count : null,
        numeric: numericShift,
        categorical: categoricalShift,
      },
    };
  });
}

function compareInsight(kind, level, message, field, evidence, score, action = null) {
  return {
    id: `compare:${kind}:${field?.path || "$"}`,
    kind,
    level,
    confidence: { value: 1, label: "certain" },
    title: kind.replace(/-/g, " ").replace(/^./, character => character.toUpperCase()),
    message,
    fieldPaths: field?.path ? [field.path] : [],
    evidence,
    affected: { count: 0, recordRefs: [], capped: false },
    visual: null,
    action,
    rank: { score, components: { priority: score - 30, confidence: 20, impact: 7, coverage: 3, novelty: 0 } },
  };
}

function comparisonInsights(fields, rows, baseline, candidate) {
  const insights = [];
  const rowDelta = (candidate.shape.recordCount || 0) - (baseline.shape.recordCount || 0);
  if (rowDelta) {
    insights.push(compareInsight("record-count-change", "notable",
      `The candidate has ${Math.abs(rowDelta)} ${rowDelta > 0 ? "more" : "fewer"} record${Math.abs(rowDelta) === 1 ? "" : "s"}.`, null,
      [{ metric: "record-count", baseline: baseline.shape.recordCount, candidate: candidate.shape.recordCount, delta: rowDelta, method: "exact count" }], 78));
  }
  fields.forEach(field => {
    if (field.status === "added" || field.status === "removed") {
      insights.push(compareInsight(`field-${field.status}`, field.status === "removed" ? "attention" : "notable",
        `${field.label} is ${field.status} in the candidate schema.`, field.candidate || field.baseline,
        [{ metric: "schema-field-status", observed: field.status, method: "wildcard schema comparison" }], field.status === "removed" ? 92 : 76));
    } else if (field.status === "type-changed") {
      insights.push(compareInsight("field-type-changed", "attention",
        `${field.label} changed parsed types from ${primitiveTypeSet(field.baseline).join("/")} to ${primitiveTypeSet(field.candidate).join("/")}.`, field.candidate,
        [{ metric: "parsed-types", baseline: primitiveTypeSet(field.baseline), candidate: primitiveTypeSet(field.candidate), method: "exact type counts" }], 94));
    }
    if (field.deltas.presentRate !== null && Math.abs(field.deltas.presentRate) >= 0.05) {
      insights.push(compareInsight("missingness-change", "notable",
        `${field.label} presence changed from ${round(field.baseline.completeness.presentRate * 100, 1)}% to ${round(field.candidate.completeness.presentRate * 100, 1)}%.`, field.candidate,
        [{ metric: "present-rate", baseline: field.baseline.completeness.presentRate, candidate: field.candidate.completeness.presentRate, delta: field.deltas.presentRate, method: "exact count" }], 84));
    }
    if (field.deltas.numeric?.ks >= 0.2) {
      insights.push(compareInsight("numeric-distribution-change", "notable",
        `${field.label} has a noticeably different numeric distribution in the candidate.`, field.candidate,
        [{ metric: "ks-effect", observed: field.deltas.numeric.ks, method: "two-sample Kolmogorov-Smirnov effect statistic" }, { metric: "median", baseline: field.baseline.numeric.median, candidate: field.candidate.numeric.median, delta: field.deltas.numeric.medianDelta }], 82));
    }
    if ((field.deltas.categorical?.addedCategories.length || field.deltas.categorical?.removedCategories.length)) {
      const added = field.deltas.categorical.addedCategories;
      const removed = field.deltas.categorical.removedCategories;
      const parts = [];
      if (added.length) parts.push(`${added.length} new categor${added.length === 1 ? "y" : "ies"}`);
      if (removed.length) parts.push(`${removed.length} no longer present`);
      insights.push(compareInsight("category-change", "notable", `${field.label} has ${parts.join(" and ")}.`, field.candidate,
        [{ metric: "categories", added, removed, method: "observed category sets" }], 75));
    }
  });
  if (rows?.status === "duplicate-keys") {
    insights.push(compareInsight("duplicate-key", "attention", "The selected matching key is not unique, so Trace did not match rows silently.", null,
      [{ metric: "duplicate-key-groups", baseline: rows.duplicates.baseline.length, candidate: rows.duplicates.candidate.length, method: "exact key index" }], 99));
  } else if (rows?.orderChanged && rows.counts.changed === 0) {
    insights.push(compareInsight("record-order-change", "context", "The keyed records contain the same values but appear in a different order.", null,
      [{ metric: "order-changed", observed: true, method: "key sequence comparison" }], 62));
  }
  if (rows?.status === "ready") {
    if (rows.counts.removed) {
      insights.push(compareInsight("rows-removed", "notable", `${rows.counts.removed} baseline row${rows.counts.removed === 1 ? " is" : "s are"} absent from the candidate.`, null,
        [{ metric: "removed-rows", observed: rows.counts.removed, method: `${rows.key.mode} row matching` }], 88));
    }
    if (rows.counts.added) {
      insights.push(compareInsight("rows-added", "context", `${rows.counts.added} row${rows.counts.added === 1 ? " is" : "s are"} new in the candidate.`, null,
        [{ metric: "added-rows", observed: rows.counts.added, method: `${rows.key.mode} row matching` }], 72));
    }
    if (rows.counts.changed) {
      insights.push(compareInsight("rows-changed", "notable", `${rows.counts.changed} matched row${rows.counts.changed === 1 ? " has" : "s have"} changed values.`, null,
        [{ metric: "changed-rows", observed: rows.counts.changed, method: `${rows.key.mode} row matching` }], 86));
    }
  }
  return insights.sort((a, b) => b.rank.score - a.rank.score || a.id.localeCompare(b.id));
}

function summaryFor(comparison) {
  const parts = [];
  const countDelta = (comparison.candidate.shape.recordCount || 0) - (comparison.baseline.shape.recordCount || 0);
  if (countDelta) parts.push(`${Math.abs(countDelta)} ${countDelta > 0 ? "more" : "fewer"} records`);
  const added = comparison.fields.filter(field => field.status === "added").length;
  const removed = comparison.fields.filter(field => field.status === "removed").length;
  const types = comparison.fields.filter(field => field.status === "type-changed").length;
  if (added) parts.push(`${added} added field${added === 1 ? "" : "s"}`);
  if (removed) parts.push(`${removed} removed field${removed === 1 ? "" : "s"}`);
  if (types) parts.push(`${types} type change${types === 1 ? "" : "s"}`);
  if (comparison.rows?.status === "ready") {
    if (comparison.rows.counts.changed) parts.push(`${comparison.rows.counts.changed} changed row${comparison.rows.counts.changed === 1 ? "" : "s"}`);
    if (comparison.rows.orderChanged && !comparison.rows.counts.changed) parts.push("a different row order");
  }
  return parts.length ? `The candidate has ${parts.join(", ")}.` : "No material profile or keyed-row changes were found with the current settings.";
}

export function compareTrace(baselineValue, candidateValue, options = {}) {
  const baseline = analyzeTrace(baselineValue, { ...(options.baselineSource || {}), recordSetPath: options.baselineRecordSetPath });
  const candidate = analyzeTrace(candidateValue, { ...(options.candidateSource || {}), recordSetPath: options.candidateRecordSetPath });
  const fields = fieldComparison(baseline, candidate);
  const baselineRecords = traceRecordSet(baselineValue, baseline.shape.recordSetPath);
  const candidateRecords = traceRecordSet(candidateValue, candidate.shape.recordSetPath);
  const requestedKey = options.keyPaths?.length ? options.keyPaths : options.keyPath;
  const key = baselineRecords && candidateRecords ? keyCandidate(baseline, candidate, requestedKey) : null;
  const settings = {
    absoluteTolerance: Math.max(0, Number(options.absoluteTolerance) || 0),
    relativeTolerance: Math.max(0, Number(options.relativeTolerance) || 0),
    missingEquivalent: Boolean(options.missingEquivalent),
    ignoreArrayOrder: Boolean(options.ignoreArrayOrder),
    ignoredRelativeKeys: new Set((options.ignoreFields || []).map(path => {
      const field = candidate.fields.find(item => item.path === path) || baseline.fields.find(item => item.path === path);
      return field ? relativeKey(field) : path;
    })),
  };
  let rows = null;
  if (baselineRecords && candidateRecords && key) rows = rowComparison(baselineRecords, candidateRecords, key, settings);
  else if (baselineRecords && candidateRecords && options.matchByOrder) {
    const count = Math.max(baselineRecords.length, candidateRecords.length);
    const pseudoKey = {
      left: { path: "$row", relativeSegments: [] },
      right: { path: "$row", relativeSegments: [] },
      mode: "position",
    };
    const resultRows = [];
    const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
    for (let index = 0; index < count; index += 1) {
      const before = baselineRecords[index];
      const after = candidateRecords[index];
      const changes = before === undefined || after === undefined ? [] : collectChanges(before, after, settings);
      const status = before === undefined ? "added" : after === undefined ? "removed" : changes.length ? "changed" : "unchanged";
      counts[status] += 1;
      resultRows.push({ status, key: index, baselineIndex: before === undefined ? null : index, candidateIndex: after === undefined ? null : index, before: before ?? null, after: after ?? null, changes });
    }
    rows = { status: "ready", key: { baselinePath: pseudoKey.left.path, candidatePath: pseudoKey.right.path, mode: "position" }, duplicates: { baseline: [], candidate: [] }, counts, orderChanged: false, rows: resultRows };
  }
  const result = {
    version: COMPARISON_VERSION,
    status: "ready",
    baseline,
    candidate,
    fields,
    rows,
    keySuggestion: key ? { baselinePath: key.left.path, candidatePath: key.right.path, baselinePaths: (key.parts || [key]).map(part => part.left.path), candidatePaths: (key.parts || [key]).map(part => part.right.path), label: (key.parts || [key]).map(part => part.left.label).join(" + "), mode: key.mode } : null,
    settings: {
      absoluteTolerance: settings.absoluteTolerance,
      relativeTolerance: settings.relativeTolerance,
      missingEquivalent: settings.missingEquivalent,
      ignoreArrayOrder: settings.ignoreArrayOrder,
      ignoreFields: options.ignoreFields || [],
      keyPaths: options.keyPaths || (options.keyPath ? [options.keyPath] : []),
      matchByOrder: Boolean(options.matchByOrder),
    },
    insights: [],
    overviewInsightIds: [],
    summary: "",
  };
  result.insights = comparisonInsights(fields, rows, baseline, candidate);
  result.overviewInsightIds = result.insights.slice(0, 6).map(item => item.id);
  result.summary = summaryFor(result);
  return result;
}

export { COMPARISON_VERSION };
