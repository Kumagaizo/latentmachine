import { canonicalize } from "./engine.js";
import { valueAtRelativePath } from "./analyze.js";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function scrubAnalysis(analysis) {
  if (!analysis?.fields) return;
  delete analysis.telemetry;
  analysis.fields.forEach(field => {
    delete field.values;
    delete field.valueRefs;
    delete field.absenceRefs;
    delete field.examples;
    if (field.numeric?.unusual) field.numeric.unusual = field.numeric.unusual.map(({ score, method }) => ({ score, method }));
    if (field.categorical?.top) field.categorical.top = field.categorical.top.map(({ count, share }) => ({ count, share }));
  });
  analysis.insights?.forEach(insight => scrubInsightMessage(insight));
}

function scrubInsightMessage(insight) {
  if (!insight || !["near-constant", "dominant-category"].includes(insight.kind)) return;
  const share = insight.evidence?.find(item => item.metric === "top-value-share")?.observed;
  const percentage = Number.isFinite(share) ? `${Math.round(share * 1000) / 10}%` : "most";
  insight.message = insight.kind === "near-constant"
    ? `The most common value represents ${percentage} of present values.`
    : `One value represents ${percentage} of present values.`;
}

function scrubDuplicateKeys(rows) {
  if (!rows?.duplicates) return;
  for (const side of ["baseline", "candidate"]) {
    rows.duplicates[side] = (rows.duplicates[side] || []).map(group => ({
      count: group.rowIndices?.length || 0,
      rowIndices: group.rowIndices || [],
    }));
  }
}

function capFullAnalysis(analysis) {
  if (!analysis?.fields) return;
  analysis.fields.forEach(field => { delete field.values; });
}

function scrubEmbeddedModels(value) {
  if (Array.isArray(value)) {
    value.forEach(scrubEmbeddedModels);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.raw === true) {
    delete value.observed;
    delete value.raw;
  }
  if (Array.isArray(value.top)) value.top = value.top.map(({ count, share }) => ({ count, share }));
  if (Array.isArray(value.unusual)) value.unusual = value.unusual.map(({ score, method }) => ({ score, method }));
  Object.values(value).forEach(scrubEmbeddedModels);
}

export function createTraceReport(result, options = {}) {
  const privacySafe = options.privacySafe !== false;
  const report = cloneJson(result);
  delete report.telemetry;
  if (report.baseline) {
    delete report.baseline.telemetry;
    delete report.candidate.telemetry;
  }
  if (!privacySafe) {
    if (report.baseline) {
      capFullAnalysis(report.baseline);
      capFullAnalysis(report.candidate);
      report.fields?.forEach(field => capFullAnalysis({ fields: [field.baseline, field.candidate].filter(Boolean) }));
      if (report.rows?.rows?.length > 100) {
        report.rows.rows = report.rows.rows.filter(row => row.status !== "unchanged").slice(0, 100);
        report.rows.exportCapped = true;
      }
    } else capFullAnalysis(report);
    return report;
  }
  if (report.baseline) {
    scrubAnalysis(report.baseline);
    scrubAnalysis(report.candidate);
    report.fields?.forEach(field => {
      scrubAnalysis({ fields: [field.baseline, field.candidate].filter(Boolean) });
    });
    if (report.rows) {
      delete report.rows.rows;
      scrubDuplicateKeys(report.rows);
    }
  } else scrubAnalysis(report);
  scrubEmbeddedModels(report);
  return report;
}

export function serializeTraceReport(result, options = {}) {
  return `${JSON.stringify(createTraceReport(result, options), null, 2)}\n`;
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = typeof value === "object" ? canonicalize(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function recordsToCsv(records, fields) {
  const selected = fields.filter(field => field.relativeSegments?.length);
  const header = selected.map(field => csvCell(field.label)).join(",");
  const rows = records.map(record => selected.map(field => csvCell(valueAtRelativePath(record, field.relativeSegments))).join(","));
  return `${[header, ...rows].join("\r\n")}\r\n`;
}

export function recordsToJson(records) {
  return `${JSON.stringify(records, null, 2)}\n`;
}
