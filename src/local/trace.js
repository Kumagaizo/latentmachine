import { detectFormat, formatLabel, FORMAT_ORDER, parseWithFormat } from "../intelligence/data-formats/index.js";
import { analyzeTrace, traceRecordSet, valueAtRelativePath } from "../intelligence/trace/analyze.js";
import { compareTrace } from "../intelligence/trace/compare.js";
import { groupedFingerprint } from "../intelligence/trace/engine.js";
import { recordsToCsv, recordsToJson, serializeTraceReport } from "../intelligence/trace/reports.js";
import { esc } from "./shared.js";
import { formatBytes, validateImportFile, validateImportText } from "./file-import.js";
import { copyText, shareUrlForState, sharedStateFromLocation } from "./share-state.js";

const root = document.querySelector("#trace");
const PASTE_MAX_BYTES = 1024 * 1024;
const TRACE_FILE_MAX_BYTES = 25 * 1024 * 1024;

const customerSample = `customer_id,plan,country,monthly_spend,orders,last_seen,marketing_opt_in
C-001,Pro,DE,129,14,2026-06-28T14:10:00Z,true
C-002,Starter,NL,29,3,2026-06-27T09:22:00Z,false
C-003,Pro,DE,119,11,2026-06-29T18:41:00Z,true
C-004,Team,FR,249,22,2026-06-30T07:03:00Z,true
C-005,Starter,DE,29,2,2026-06-20T16:18:00Z,false
C-006,Pro,NL,139,15,2026-06-30T12:54:00Z,true
C-007,Team,DE,259,25,2026-06-29T11:31:00Z,true
C-008,Starter,BE,29,1,2026-06-12T08:12:00Z,false
C-009,Pro,FR,129,12,2026-06-28T21:19:00Z,true
C-010,Team,DE,239,19,2026-06-30T10:05:00Z,true
C-011,Starter,NL,29,4,2026-06-24T13:47:00Z,false
C-012,Pro,DE,149,16,2026-06-30T15:23:00Z,true
C-013,Team,FR,249,24,2026-06-27T17:55:00Z,true
C-014,Starter,DE,29,2,2026-06-18T12:06:00Z,false
C-015,Pro,NL,129,13,2026-06-29T06:44:00Z,true
C-016,Team,DE,269,27,2026-06-30T19:38:00Z,true
C-017,Starter,BE,29,3,2026-06-23T10:16:00Z,false
C-018,Pro,FR,119,10,2026-06-26T15:42:00Z,true
C-019,Team,DE,249,21,2026-06-29T20:11:00Z,true
C-020,Starter,NL,29,1,2026-06-11T07:52:00Z,false
C-021,Pro,DE,139,17,2026-06-30T08:34:00Z,true
C-022,Team,FR,259,23,2026-06-28T14:27:00Z,true
C-023,Starter,DE,29,4,2026-06-25T18:09:00Z,false
C-024,Pro,NL,129,12,2026-06-29T12:33:00Z,true
C-025,Team,DE,2499,26,2026-06-30T16:50:00Z,true
C-026,Starter,BE,29,2,2026-06-19T09:14:00Z,false
C-027,Pro,FR,149,18,2026-06-30T11:42:00Z,true
C-028,Team,DE,239,20,2026-06-27T13:20:00Z,true
C-029,Starter,NL,,3,2026-06-22T08:36:00Z,false
C-030,Pro,DE,129,14,2026-06-29T22:02:00Z,true`;

const nestedSample = JSON.stringify({
  export: { generatedAt: "2026-06-30T23:59:00Z", source: "orders" },
  payload: { rows: Array.from({ length: 28 }, (_, index) => ({
    order_id: `O-${1001 + index}`,
    region: ["eu-central", "us-east", "ap-south"][index % 3],
    amount: index === 23 ? 1480 : 70 + (index % 8) * 12,
    fulfilled: index % 7 !== 0,
    created_at: `2026-06-${String((index % 28) + 1).padStart(2, "0")}T12:00:00Z`,
  })) },
}, null, 2);

const telemetrySample = JSON.stringify(Array.from({ length: 36 }, (_, index) => ({
  event_id: `evt_${String(index + 1).padStart(3, "0")}`,
  service: index % 4 ? "api" : "worker",
  latency_ms: index === 31 ? 2200 : 80 + (index % 9) * 7,
  status_code: index === 31 ? 503 : 200,
  timestamp: `2026-06-${String((index % 28) + 1).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00Z`,
})), null, 2);

const presets = { customers: customerSample, nested: nestedSample, telemetry: telemetrySample };
const compareBaseRows = Array.from({ length: 24 }, (_, index) => ({ id: `R-${index}`, value: 20 + (index % 7), status: index % 3 ? "active" : "paused", note: "present" }));
const comparePresets = {
  schema: [compareBaseRows, compareBaseRows.map(({ note, ...row }, index) => ({ ...row, value: index ? String(row.value) : row.value, region: index % 2 ? "eu" : "us" }))],
  missingness: [compareBaseRows, compareBaseRows.map((row, index) => index < 8 ? (({ note, ...rest }) => rest)(row) : row)],
  distribution: [compareBaseRows, compareBaseRows.map((row, index) => ({ ...row, value: row.value + 50 + (index % 3), status: index % 4 ? "active" : "review" }))],
  reordered: [compareBaseRows, [...compareBaseRows].reverse()],
};
const state = {
  mode: "explore",
  textA: "",
  textB: "",
  nameA: "Source data",
  nameB: "Candidate",
  formatA: "auto",
  formatB: "auto",
  originA: "preset",
  originB: "paste",
  recordSetPathA: "",
  recordSetPathB: "",
  analysis: null,
  comparison: null,
  valueA: null,
  valueB: null,
  activeTab: "overview",
  activeField: null,
  fieldQuery: "",
  fieldFilter: "all",
  recordQuery: "",
  recordColumns: null,
  activeRecordIndex: null,
  structureQuery: "",
  schemaFilter: "all",
  compareRowFilter: "changes",
  activeRecordFilter: null,
  recordPage: 0,
  notice: "",
  warning: "",
  announcement: "",
  phase: "",
  restoreUi: null,
  processing: false,
  compareSettings: { keyPath: "", keyPaths: [], ignoreFields: [], absoluteTolerance: 0, relativeTolerance: 0, missingEquivalent: false, ignoreArrayOrder: false, matchByOrder: false },
};

let worker = null;
let workerRequest = 0;
let analysisGeneration = 0;
let workerPending = null;

function stopWorker(reason = "analysis-cancelled") {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  workerPending?.reject(new Error(reason));
  workerPending = null;
}

function invalidateAnalysisState() {
  analysisGeneration += 1;
  stopWorker();
  state.processing = false;
  state.phase = "";
  state.analysis = null;
  state.comparison = null;
  state.valueA = null;
  state.valueB = null;
  state.activeField = null;
  state.activeRecordFilter = null;
  state.activeRecordIndex = null;
  state.notice = "";
  state.warning = "";
}

function invalidateAnalysisForEdit() {
  const hadResult = Boolean(state.processing || state.analysis || state.comparison);
  invalidateAnalysisState();
  if (!hadResult) return;
  state.announcement = "Input changed. Run Trace again to refresh the results.";
  root.querySelector(".trace-result-shell")?.remove();
  const runButton = root.querySelector("[data-run]");
  if (runButton) {
    runButton.disabled = false;
    runButton.textContent = state.mode === "compare" ? "Compare datasets" : "Analyze data";
  }
  root.querySelector("[data-cancel]")?.remove();
  const status = root.querySelector("[data-run-status]");
  if (status) status.textContent = "Input changed · run Trace again";
  const liveRegion = root.querySelector('[role="status"][aria-live]');
  if (liveRegion) liveRegion.textContent = state.announcement;
}

function grouped(hex) { return groupedFingerprint(hex || ""); }
function percent(value, digits = 0) { return `${(Number(value || 0) * 100).toFixed(digits)}%`; }
function number(value) { return Number.isFinite(value) ? new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(value) : "N/A"; }
function title(value) { return String(value || "unknown").replace(/-/g, " ").replace(/^./, character => character.toUpperCase()); }
function display(value) {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function compactDisplay(value) {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value && typeof value === "object") return `{${Object.keys(value).length} keys}`;
  return display(value);
}

function boundedValue(value, depth = 0) {
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (!value || typeof value !== "object") return value;
  if (depth >= 4) return compactDisplay(value);
  if (Array.isArray(value)) {
    const output = value.slice(0, 20).map(item => boundedValue(item, depth + 1));
    if (value.length > 20) output.push(`… ${value.length - 20} more items`);
    return output;
  }
  const entries = Object.entries(value).slice(0, 50);
  const output = Object.fromEntries(entries.map(([key, item]) => [key, boundedValue(item, depth + 1)]));
  if (Object.keys(value).length > 50) output.__trace_truncated__ = `${Object.keys(value).length - 50} more keys`;
  return output;
}

function parseEditor(text, name, requestedFormat = "auto", origin = "paste") {
  if (!text.trim()) throw new Error(`${name} is empty.`);
  const validation = validateImportText(text);
  if (!validation.ok) throw new Error(validation.text);
  const bytes = new TextEncoder().encode(text).length;
  if (origin !== "file" && bytes > PASTE_MAX_BYTES) throw new Error(`Pasted input is too large. Paste limit is ${formatBytes(PASTE_MAX_BYTES)}; import it as a file instead.`);
  const format = requestedFormat === "auto" ? detectFormat(text) : requestedFormat;
  return { value: parseWithFormat(text, requestedFormat), format, bytes };
}

function workerAnalysis(payload) {
  if (!("Worker" in window)) return Promise.reject(new Error("worker-unavailable"));
  stopWorker();
  worker = new Worker(new URL("./trace-worker.js", import.meta.url), { type: "module" });
  const id = ++workerRequest;
  return new Promise((resolve, reject) => {
    workerPending = { id, reject };
    const onMessage = event => {
      if (event.data?.id !== id) return;
      if (event.data.phase) {
        state.phase = event.data.phase;
        const status = root.querySelector("[data-run-status]");
        if (status) status.textContent = title(event.data.phase);
        return;
      }
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
      worker = null;
      workerPending = null;
      if (event.data.ok) resolve(event.data);
      else {
        const error = new Error(event.data.error);
        error.kind = event.data.kind;
        reject(error);
      }
    };
    const onError = event => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
      worker = null;
      workerPending = null;
      const error = new Error(event.message || "Trace worker failed.");
      error.kind = "worker-failure";
      reject(error);
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ id, ...payload });
  });
}

async function runAnalysis() {
  const request = ++analysisGeneration;
  try {
    if (!state.textA.trim()) throw new Error(`${state.nameA} is empty.`);
    const validationA = validateImportText(state.textA);
    if (!validationA.ok) throw new Error(validationA.text);
    if (state.originA !== "file" && new TextEncoder().encode(state.textA).length > PASTE_MAX_BYTES) throw new Error(`Pasted input is too large. Paste limit is ${formatBytes(PASTE_MAX_BYTES)}; import it as a file instead.`);
    if (state.mode === "compare") {
      if (!state.textB.trim()) throw new Error(`${state.nameB} is empty.`);
      const validationB = validateImportText(state.textB);
      if (!validationB.ok) throw new Error(validationB.text);
      if (state.originB !== "file" && new TextEncoder().encode(state.textB).length > PASTE_MAX_BYTES) throw new Error(`Pasted candidate is too large. Paste limit is ${formatBytes(PASTE_MAX_BYTES)}; import it as a file instead.`);
    }
    state.processing = true;
    state.phase = "starting";
    state.notice = "";
    state.warning = "";
    render();
    let result;
    try {
      result = await workerAnalysis({ mode: state.mode, textA: state.textA, textB: state.textB, nameA: state.nameA, nameB: state.nameB, formatA: state.formatA, formatB: state.formatB, recordSetPathA: state.recordSetPathA, recordSetPathB: state.recordSetPathB, settings: state.compareSettings });
    } catch (workerError) {
      if (workerError.kind === "analysis-error" || workerError.message === "analysis-cancelled") throw workerError;
      const fallbackBytes = new TextEncoder().encode(state.textA + (state.mode === "compare" ? state.textB : "")).length;
      if (fallbackBytes > PASTE_MAX_BYTES) throw new Error("Background analysis is unavailable, and this input is too large for the bounded fallback. Try again in a browser with module-worker support.");
      state.warning = "Background analysis was unavailable, so Trace used the bounded local fallback for this small input.";
      const sourceA = parseEditor(state.textA, state.nameA, state.formatA, state.originA);
      const sourceB = state.mode === "compare" ? parseEditor(state.textB, state.nameB, state.formatB, state.originB) : null;
      const comparison = sourceB ? compareTrace(sourceA.value, sourceB.value, {
        baselineSource: { format: sourceA.format, bytes: sourceA.bytes, name: state.nameA },
        candidateSource: { format: sourceB.format, bytes: sourceB.bytes, name: state.nameB },
        baselineRecordSetPath: state.recordSetPathA,
        candidateRecordSetPath: state.recordSetPathB,
        ...state.compareSettings,
      }) : null;
      result = { valueA: sourceA.value, valueB: sourceB?.value || null, analysis: comparison?.candidate || analyzeTrace(sourceA.value, { format: sourceA.format, bytes: sourceA.bytes, name: state.nameA, recordSetPath: state.recordSetPathA }), comparison };
    }
    if (request !== analysisGeneration) return;
    state.valueA = result.valueA;
    state.valueB = result.valueB;
    state.analysis = result.analysis;
    state.comparison = result.comparison;
    state.notice = "";
    state.announcement = state.mode === "compare" ? `Comparison complete. ${state.comparison.summary}` : `Analysis complete. ${state.analysis.shape.fieldCount} fields and ${state.analysis.insights.length} observations.`;
    if (state.restoreUi) {
      state.activeTab = state.restoreUi.activeTab;
      state.activeField = state.restoreUi.activeField;
      state.activeRecordFilter = state.restoreUi.activeRecordFilter;
      state.restoreUi = null;
    } else {
      state.activeField = null;
      state.activeRecordFilter = null;
    }
    state.recordPage = 0;
    state.recordColumns = null;
    state.activeRecordIndex = null;
  } catch (error) {
    if (request !== analysisGeneration) return;
    state.notice = error?.message || "Trace could not parse this data.";
    state.announcement = `Analysis error. ${state.notice}`;
    state.analysis = null;
    state.comparison = null;
  } finally {
    if (request === analysisGeneration) { state.processing = false; state.phase = ""; }
  }
  render();
}

function cancelAnalysis() {
  invalidateAnalysisState();
  state.announcement = "Analysis cancelled.";
  render();
}

function sourceEditor(id, value, name, optional = false) {
  const selectedFormat = id === "A" ? state.formatA : state.formatB;
  const detected = value.trim() ? detectFormat(value) : "";
  const sourceAnalysis = state.mode === "compare" ? (id === "A" ? state.comparison?.baseline : state.comparison?.candidate) : id === "A" ? state.analysis : null;
  const recordSetValue = id === "A" ? state.recordSetPathA : state.recordSetPathB;
  return `<section class="trace-source editor" data-drop="${id}">
    <div class="editor-bar"><span>${esc(name)}</span><div class="editor-actions">
      <input class="visually-hidden" id="trace-file-${id}" type="file" accept=".json,.xml,.csv,.tsv,.toml,.sql,.yaml,.yml,.env" data-file="${id}">
      <label class="button is-subtle" for="trace-file-${id}">Import file</label>
      <label class="visually-hidden" for="trace-format-${id}">Format for ${esc(name)}</label>
      <select class="format-chip trace-format-select" id="trace-format-${id}" data-format-override="${id}"><option value="auto" ${selectedFormat === "auto" ? "selected" : ""}>${value.trim() ? `Auto · ${esc(formatLabel(detected))}` : optional ? "Auto · optional" : "Auto · required"}</option>${FORMAT_ORDER.map(format => `<option value="${esc(format)}" ${selectedFormat === format ? "selected" : ""}>${esc(formatLabel(format))}</option>`).join("")}</select>
    </div></div>
    <textarea data-input="${id}" spellcheck="false" rows="${state.mode === "compare" ? 10 : 12}" aria-label="${esc(name)}" placeholder="Paste structured data here, or import a file.">${esc(value)}</textarea>
    <div class="trace-source-foot"><p class="trace-drop-hint">Drop a supported file here · paste limit ${formatBytes(PASTE_MAX_BYTES)} · file limit ${formatBytes(TRACE_FILE_MAX_BYTES)}</p>${sourceAnalysis?.shape.recordSetCandidates?.length > 1 ? `<label>Record set<select data-record-set="${id}"><option value="" ${recordSetValue ? "" : "selected"}>Automatically selected: ${esc(sourceAnalysis.shape.recordSetPath || "document")}</option>${sourceAnalysis.shape.recordSetCandidates.map(candidate => `<option value="${esc(candidate.path)}" ${recordSetValue === candidate.path ? "selected" : ""}>${esc(candidate.path)} · ${candidate.count.toLocaleString()} records</option>`).join("")}</select></label>` : ""}</div>
  </section>`;
}

function sourceSummary(analysis) {
  const coverage = analysis.coverage.mode === "sampled"
    ? `Sampled ${analysis.coverage.analyzedRecords.toLocaleString()} of ${analysis.coverage.totalRecords.toLocaleString()} records · seed ${analysis.coverage.sampleSeed}`
    : "Exact analysis";
  const changedSettings = state.mode === "compare" ? Object.entries(state.compareSettings)
    .filter(([, value]) => value !== false && value !== 0 && value !== "" && (!Array.isArray(value) || value.length))
    .map(([key, value]) => `${title(key)}: ${value === true ? "on" : Array.isArray(value) ? value.join(", ") : value}`) : [];
  return `<div class="trace-source-summary">
    <span>${esc(formatLabel(analysis.source.format))}</span><span>${formatBytes(analysis.source.bytes)}</span>
    <span>${esc(coverage)}</span>${changedSettings.map(setting => `<span>${esc(setting)}</span>`).join("")}
    <button type="button" class="trace-copy-id" data-copy="${esc(analysis.source.contentFingerprint)}" title="Copy content ID">ID ${esc(grouped(analysis.source.contentFingerprint))}</button>
  </div>`;
}

function metric(label, value, detail = "") {
  return `<div class="trace-metric"><span>${esc(label)}</span><strong>${esc(String(value))}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}</div>`;
}

function evidenceHtml(insight) {
  return `<details><summary>Evidence and method</summary><div class="trace-evidence">${insight.evidence.map(item => `<p><strong>${esc(title(item.metric))}</strong> ${esc(display(item.observed ?? item.delta ?? item.baseline))}${item.denominator ? ` of ${esc(item.denominator)}` : ""}${item.method ? `<small>${esc(item.method)}</small>` : ""}</p>`).join("")}</div></details>`;
}

function insightCard(insight) {
  const path = insight.fieldPaths?.[0];
  return `<article class="trace-insight is-${esc(insight.level)}">
    <div class="trace-insight-heading"><span>${esc(title(insight.kind))}</span><small>${esc(insight.confidence?.label || "")}</small></div>
    <h3>${esc(insight.title)}</h3><p>${esc(insight.message)}</p>
    ${path ? `<button class="trace-path" type="button" data-field="${esc(path)}">${esc(path)}</button>` : ""}
    ${insight.action?.kind === "filter-records" ? `<button class="trace-record-action" type="button" data-insight-records="${esc(insight.id)}">View ${insight.affected.count || "affected"} records</button>` : ""}
    ${evidenceHtml(insight)}
  </article>`;
}

function histogramSvg(histogram) {
  if (!histogram?.bins?.length) return "";
  const max = Math.max(...histogram.bins.map(bin => bin.count), 1);
  return `<svg class="trace-spark" viewBox="0 0 180 48" role="img" aria-label="Value distribution histogram">${histogram.bins.map((bin, index) => {
    const width = 180 / histogram.bins.length - 1;
    const height = Math.max(1, bin.count / max * 44);
    return `<rect x="${index * (180 / histogram.bins.length)}" y="${47 - height}" width="${width}" height="${height}" />`;
  }).join("")}</svg>`;
}

function categoryBars(field) {
  const items = field.categorical?.top?.slice(0, 5) || [];
  const max = Math.max(...items.map(item => item.count), 1);
  return `<div class="trace-bars">${items.map(item => `<div><span title="${esc(display(item.value))}">${esc(display(item.value))}</span><i style="--bar:${item.count / max}"></i><strong>${item.count}</strong></div>`).join("")}</div>`;
}

function portraitHtml(analysis) {
  const profiled = analysis.fields.filter(field => field.numeric || field.categorical).slice(0, 6);
  return `<section class="trace-section"><div class="trace-section-head"><div><p class="section-label">Data portrait</p><h2>What is in this data</h2></div><p>${esc(analysis.shape.summary)}</p></div>
    <div class="trace-portrait-grid">${profiled.map(field => `<button type="button" class="trace-profile-card" data-field="${esc(field.path)}">
      <span>${esc(field.label)}</span><small>${esc(title(field.role.id))} · ${percent(field.completeness.presentRate)}</small>
      ${field.numeric ? histogramSvg(field.numeric.histogram) : categoryBars(field)}
    </button>`).join("")}</div></section>`;
}

function overviewHtml(analysis) {
  const insights = analysis.overviewInsightIds.map(id => analysis.insights.find(item => item.id === id)).filter(Boolean);
  const overviewIds = new Set(analysis.overviewInsightIds);
  const remaining = analysis.insights.filter(item => !overviewIds.has(item.id));
  return `<div class="trace-overview">${sourceSummary(analysis)}
    <section class="trace-overview-hero"><p class="section-label">Overview</p><h2>${esc(analysis.shape.summary)}</h2>
      <div class="trace-metrics">${metric("Records", analysis.shape.recordCount ?? "N/A")}${metric("Fields", analysis.shape.fieldCount)}${metric("Complete fields", analysis.fields.filter(field => field.completeness.presentRate === 1).length)}${metric("Findings", analysis.insights.length)}</div>
    </section>
    <section class="trace-section"><div class="trace-section-head"><div><p class="section-label">Worth a look</p><h2>Ranked findings</h2></div><p>Deterministic observations with visible evidence. No model or remote service is involved.</p></div>
      ${insights.length ? `<div class="trace-insight-grid">${insights.map(insightCard).join("")}</div>` : `<div class="empty-state"><p>No material issues stood out. Open Fields to inspect every profile.</p></div>`}
      ${remaining.length ? `<details class="trace-all-observations"><summary>All observations · ${analysis.insights.length}</summary><div class="trace-insight-grid">${remaining.map(insightCard).join("")}</div></details>` : ""}
    </section>${portraitHtml(analysis)}</div>`;
}

function fieldSummary(field) {
  if (field.numeric) return `${number(field.numeric.min)} – ${number(field.numeric.max)} · median ${number(field.numeric.median)}`;
  if (field.temporal) return `${field.temporal.earliest || "N/A"} – ${field.temporal.latest || "N/A"}`;
  return `${field.distinct.count} distinct · ${field.categorical?.top?.[0] ? `top ${display(field.categorical.top[0].value)}` : title(field.role.id)}`;
}

function fieldDetail(field, analysis) {
  const related = field.insightIds.map(id => analysis.insights.find(item => item.id === id)).filter(Boolean);
  const records = traceRecordSet(state.valueA, analysis.shape.recordSetPath) || [];
  const samples = records.map((record, index) => ({ record, index, value: valueAtRelativePath(record, field.relativeSegments) })).filter(item => item.value !== undefined).slice(0, 5);
  return `<aside class="trace-field-detail"><button type="button" class="trace-detail-close" data-close-field aria-label="Close field details">×</button>
    <p class="section-label">Field profile</p><h2>${esc(field.label)}</h2><code>${esc(field.path)}</code>
    <div class="trace-detail-actions"><button type="button" data-copy-path="${esc(field.path)}">Copy path</button><button type="button" data-export-field="csv" data-field-path="${esc(field.path)}">Export values CSV</button><button type="button" data-export-field="json" data-field-path="${esc(field.path)}">Export values JSON</button></div>
    <div class="trace-metrics trace-detail-metrics">${metric("Role", title(field.role.id), field.role.evidence[0])}${metric("Present", percent(field.completeness.presentRate, 1))}${metric("Distinct", field.distinct.count)}${metric("Null / empty", field.completeness.null + field.completeness.emptyString + field.completeness.whitespaceOnly)}</div>
    ${field.numeric ? `<div class="trace-detail-chart">${histogramSvg(field.numeric.histogram)}<p>Median ${number(field.numeric.median)} · P05 ${number(field.numeric.p05)} · P95 ${number(field.numeric.p95)}</p></div>` : categoryBars(field)}
    <h3>Examples</h3><div class="trace-examples">${field.examples.map(value => `<code>${esc(display(value))}</code>`).join("") || "<p>No examples.</p>"}</div>
    ${samples.length ? `<h3>Sample records</h3><div class="trace-record-samples">${samples.map(item => `<details><summary>Record ${item.index + 1} · ${esc(compactDisplay(item.value))}</summary><pre>${esc(JSON.stringify(boundedValue(item.record), null, 2))}</pre></details>`).join("")}</div>` : ""}
    ${related.length ? `<h3>Findings</h3>${related.map(insightCard).join("")}` : ""}
  </aside>`;
}

function fieldsHtml(analysis) {
  const query = state.fieldQuery.trim().toLowerCase();
  const fields = analysis.fields.filter(field => {
    if (query && !`${field.label} ${field.path} ${field.role.id}`.toLowerCase().includes(query)) return false;
    const primitiveTypes = Object.keys(field.parsedTypes).filter(type => !["absent", "null"].includes(type) && field.parsedTypes[type]);
    const missing = field.completeness.absent + field.completeness.null + field.completeness.emptyString + field.completeness.whitespaceOnly;
    if (state.fieldFilter === "numeric") return Boolean(field.numeric);
    if (state.fieldFilter === "category") return field.role.id === "category";
    if (state.fieldFilter === "time") return Boolean(field.temporal);
    if (state.fieldFilter === "text") return ["text", "email-like", "url-like", "uuid-like"].includes(field.role.id);
    if (state.fieldFilter === "boolean") return field.role.id === "boolean";
    if (state.fieldFilter === "identifier") return field.role.id === "identifier";
    if (state.fieldFilter === "missing") return missing > 0;
    if (state.fieldFilter === "mixed") return primitiveTypes.length > 1;
    if (state.fieldFilter === "observations") return field.insightIds.length > 0;
    return true;
  });
  const active = analysis.fields.find(field => field.path === state.activeField);
  return `<section class="trace-section trace-table-section"><div class="trace-section-head"><div><p class="section-label">Fields</p><h2>${fields.length} field profiles</h2></div><div class="trace-filter-tools"><label class="trace-search">Search fields<input type="search" data-field-query value="${esc(state.fieldQuery)}" placeholder="Name, path, or role"></label><label>Filter fields<select data-field-filter>${[["all","All"],["numeric","Numeric"],["category","Category"],["time","Time"],["text","Text"],["boolean","Boolean"],["identifier","Identifier candidates"],["missing","Missing"],["mixed","Mixed type"],["observations","Has observations"]].map(([value,label]) => `<option value="${value}" ${state.fieldFilter === value ? "selected" : ""}>${label}</option>`).join("")}</select></label></div></div>
    <div class="trace-field-layout"><div class="trace-table-wrap"><table class="trace-table"><caption class="visually-hidden">Field profiles and observations</caption><thead><tr><th scope="col">Field</th><th scope="col">Role</th><th scope="col">Present</th><th scope="col">Distinct</th><th scope="col">Profile</th><th scope="col">Findings</th></tr></thead><tbody>
    ${fields.map(field => `<tr><td><button type="button" data-field="${esc(field.path)}"><strong>${esc(field.label)}</strong><code>${esc(field.path)}</code></button></td><td><span class="trace-role">${esc(title(field.role.id))}</span></td><td>${percent(field.completeness.presentRate, 1)}</td><td>${field.distinct.count}</td><td>${esc(fieldSummary(field))}</td><td>${field.insightIds.length}</td></tr>`).join("")}</tbody></table></div>${active ? fieldDetail(active, analysis) : ""}</div>
  </section>`;
}

function recordFields(analysis) { return analysis.fields.filter(field => field.relativeSegments?.length === 1).slice(0, 12); }
function matchesRecordFilter(record, index) {
  const filter = state.activeRecordFilter;
  if (!filter) return true;
  const insight = state.analysis?.insights.find(item => item.id === filter.insightId);
  if (!insight) return true;
  if (insight.affected.recordRefs.includes(index)) return true;
  const field = state.analysis.fields.find(item => item.path === insight.action?.filter?.fieldPath);
  if (!field) return false;
  const value = valueAtRelativePath(record, field.relativeSegments);
  if (insight.action.filter.state === "missing") return value === undefined || value === null || value === "" || (typeof value === "string" && !value.trim());
  return false;
}
function filteredRecords() {
  const analysis = state.analysis;
  const records = traceRecordSet(state.mode === "compare" ? state.valueB : state.valueA, analysis?.shape.recordSetPath) || [];
  const query = state.recordQuery.trim().toLowerCase();
  return records.filter((record, index) => matchesRecordFilter(record, index) && (!query || JSON.stringify(record).toLowerCase().includes(query)));
}
function recordsHtml(analysis) {
  const records = traceRecordSet(state.mode === "compare" ? state.valueB : state.valueA, analysis.shape.recordSetPath);
  if (!records) return `<section class="empty-state"><p>This input is a document rather than a repeated record set. Use Structure to inspect it.</p></section>`;
  const availableFields = recordFields(analysis);
  const fields = state.recordColumns === null ? availableFields : availableFields.filter(field => state.recordColumns.includes(field.path));
  const query = state.recordQuery.trim().toLowerCase();
  const filtered = records.map((record, index) => ({ record, index })).filter(item => matchesRecordFilter(item.record, item.index) && (!query || JSON.stringify(item.record).toLowerCase().includes(query)));
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  state.recordPage = Math.min(state.recordPage, pages - 1);
  const rows = filtered.slice(state.recordPage * pageSize, (state.recordPage + 1) * pageSize);
  return `<section class="trace-section trace-table-section"><div class="trace-section-head"><div><p class="section-label">Records</p><h2>${filtered.length} matching records</h2></div><div class="trace-filter-tools"><label class="trace-search">Filter records<input type="search" data-record-query value="${esc(state.recordQuery)}" placeholder="Search any visible value"></label><details class="trace-column-picker"><summary>Columns · ${fields.length}/${availableFields.length}</summary>${availableFields.map(field => `<label><input type="checkbox" data-record-column="${esc(field.path)}" ${state.recordColumns === null || state.recordColumns.includes(field.path) ? "checked" : ""}> ${esc(field.label)}</label>`).join("")}</details></div></div>
    ${state.activeRecordFilter ? `<div class="trace-active-filter"><span>Showing records behind: ${esc(state.activeRecordFilter.label)}</span><button type="button" data-clear-record-filter>Clear finding filter</button></div>` : ""}
    <div class="trace-table-wrap"><table class="trace-table trace-records"><caption class="visually-hidden">Records matching the active search and finding filters</caption><thead><tr><th scope="col">#</th>${fields.map(field => `<th scope="col">${esc(field.label)}</th>`).join("")}<th scope="col">Action</th></tr></thead><tbody>${rows.map(({ record, index }) => `<tr><th scope="row">${index + 1}</th>${fields.map(field => { const value = valueAtRelativePath(record, field.relativeSegments); return `<td title="${esc(compactDisplay(value))}">${esc(compactDisplay(value))}</td>`; }).join("")}<td><button type="button" data-inspect-record="${index}">Inspect</button><button type="button" data-copy-record="${index}">Copy</button></td></tr>`).join("")}</tbody></table></div>
    ${state.activeRecordIndex !== null && records[state.activeRecordIndex] !== undefined ? `<aside class="trace-record-detail"><button type="button" data-close-record aria-label="Close record details">×</button><p class="section-label">Record ${state.activeRecordIndex + 1}</p><h3>Bounded nested view</h3><pre>${esc(JSON.stringify(boundedValue(records[state.activeRecordIndex]), null, 2))}</pre></aside>` : ""}
    <div class="trace-pagination"><button class="button is-small" type="button" data-page="prev" ${state.recordPage === 0 ? "disabled" : ""}>Previous</button><span>Page ${state.recordPage + 1} of ${pages}</span><button class="button is-small" type="button" data-page="next" ${state.recordPage >= pages - 1 ? "disabled" : ""}>Next</button></div>
  </section>`;
}

function structureHtml(analysis) {
  const groups = new Map();
  const query = state.structureQuery.trim().toLowerCase();
  analysis.fields.filter(field => !query || field.path.toLowerCase().includes(query)).forEach(field => {
    const parent = field.path.replace(/(?:\.[^.\[]+|\[[^\]]+\])$/, "") || "$";
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(field);
  });
  return `<section class="trace-section"><div class="trace-section-head"><div><p class="section-label">Structure</p><h2>Semantic shape</h2></div><p>${analysis.shape.maxDepth} levels deep · ${analysis.shape.objectCount} objects · ${analysis.shape.arrayCount} arrays · ${analysis.shape.scalarCount} scalar values</p></div>
    <div class="trace-structure-tools"><label class="trace-search">Search paths<input type="search" data-structure-query value="${esc(state.structureQuery)}" placeholder="$.orders[*].total"></label><button type="button" data-structure-toggle="expand">Expand all</button><button type="button" data-structure-toggle="collapse">Collapse all</button></div>
    <div class="trace-structure">${[...groups].map(([parent, fields]) => `<details open><summary><code>${esc(parent)}</code><span>${fields.length} field${fields.length === 1 ? "" : "s"}</span></summary>${fields.map(field => `<div class="trace-structure-row"><button type="button" data-field="${esc(field.path)}"><span>${esc(field.label)}</span><small>${esc(title(field.role.id))} · ${percent(field.completeness.presentRate)}</small></button><button type="button" data-copy-path="${esc(field.path)}" aria-label="Copy ${esc(field.path)}">Copy path</button></div>`).join("")}</details>`).join("") || `<p>No paths match this search.</p>`}</div>
  </section>`;
}

function compareOverview(comparison) {
  const rows = comparison.rows;
  return `${sourceSummary(comparison.candidate)}<section class="trace-overview-hero"><p class="section-label">Comparison</p><h2>${esc(comparison.summary)}</h2>
    <div class="trace-metrics">${metric("Baseline", comparison.baseline.shape.recordCount ?? "N/A", `${comparison.baseline.shape.fieldCount} fields`)}${metric("Candidate", comparison.candidate.shape.recordCount ?? "N/A", `${comparison.candidate.shape.fieldCount} fields`)}${metric("Schema changes", comparison.fields.filter(field => field.status !== "same").length)}${metric("Changed rows", rows?.counts?.changed ?? "N/A", rows?.key ? `Matched by ${rows.key.baselinePath}` : "No safe key inferred")}</div></section>
    ${rows?.status === "duplicate-keys" ? `<div class="format-diagnostic is-danger"><p>The suggested key has duplicates. Trace stopped row matching instead of inventing a result. Choose positional matching only if row order is meaningful.</p></div>` : ""}
    <section class="trace-section"><div class="trace-section-head"><div><p class="section-label">What changed</p><h2>Ranked comparison findings</h2></div></div><div class="trace-insight-grid">${comparison.insights.slice(0, 8).map(insightCard).join("") || "<p>No material changes found.</p>"}</div></section>`;
}

function comparisonFields(comparison) {
  const shared = comparison.fields.filter(field => field.baseline && field.candidate);
  return `<section class="trace-section trace-table-section"><div class="trace-section-head"><div><p class="section-label">Field profiles</p><h2>${shared.length} comparable fields</h2></div><p>Distribution and completeness changes are descriptive effect measures, not business-quality verdicts.</p></div><div class="trace-table-wrap"><table class="trace-table"><caption class="visually-hidden">Field profiles between baseline and candidate</caption><thead><tr><th scope="col">Field</th><th scope="col">Status</th><th scope="col">Baseline</th><th scope="col">Candidate</th><th scope="col">Presence delta</th><th scope="col">Row matching</th></tr></thead><tbody>${shared.map(field => `<tr><td><strong>${esc(field.label)}</strong><code>${esc(field.path)}</code></td><td><span class="trace-change is-${esc(field.status)}">${esc(title(field.status))}</span></td><td>${esc(fieldSummary(field.baseline))}</td><td>${esc(fieldSummary(field.candidate))}</td><td>${field.deltas.presentRate === null ? "N/A" : `${field.deltas.presentRate > 0 ? "+" : ""}${percent(field.deltas.presentRate, 1)}`}</td><td><label class="trace-ignore-field"><input type="checkbox" data-ignore-field="${esc(field.path)}" ${state.compareSettings.ignoreFields.includes(field.path) ? "checked" : ""}> Ignore value changes</label></td></tr>`).join("")}</tbody></table></div></section>`;
}

function comparisonSchema(comparison) {
  const changed = comparison.fields.filter(field => ["added", "removed", "type-changed", "role-changed", "presence-changed"].includes(field.status));
  const schema = state.schemaFilter === "all" ? changed : changed.filter(field => field.status === state.schemaFilter);
  return `<section class="trace-section trace-table-section"><div class="trace-section-head"><div><p class="section-label">Schema</p><h2>${schema.length} structural field changes</h2></div><div class="trace-filter-tools"><label>Filter status<select data-schema-filter>${[["all","All changes"],["added","Added"],["removed","Removed"],["type-changed","Type changed"],["presence-changed","Presence changed"],["role-changed","Role changed"]].map(([value,label]) => `<option value="${value}" ${state.schemaFilter === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><button type="button" data-export-schema>Export schema changes</button></div></div>${schema.length ? `<div class="trace-table-wrap"><table class="trace-table"><caption class="visually-hidden">Added, removed, and structurally changed schema fields</caption><thead><tr><th scope="col">Field</th><th scope="col">Status</th><th scope="col">Baseline type</th><th scope="col">Candidate type</th><th scope="col">Presence</th></tr></thead><tbody>${schema.map(field => `<tr><td><strong>${esc(field.label)}</strong><code>${esc(field.path)}</code></td><td><span class="trace-change is-${esc(field.status)}">${esc(title(field.status))}</span></td><td>${field.baseline ? esc(Object.keys(field.baseline.parsedTypes).join(" / ")) : "N/A"}</td><td>${field.candidate ? esc(Object.keys(field.candidate.parsedTypes).join(" / ")) : "N/A"}</td><td>${field.baseline && field.candidate ? `${percent(field.baseline.completeness.presentRate, 1)} → ${percent(field.candidate.completeness.presentRate, 1)}` : "N/A"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><p>No schema changes match this filter.</p></div>`}</section>`;
}

function comparisonRows(comparison) {
  const rows = comparison.rows;
  if (!rows) return `<section class="empty-state"><p>Trace could not infer a complete, unique identifier. Enable positional matching only when row order has meaning.</p></section>`;
  if (rows.status === "duplicate-keys") return `<section class="empty-state"><p>Row matching is blocked because ${rows.duplicates.baseline.length + rows.duplicates.candidate.length} duplicate key groups were found.</p></section>`;
  const visibleRows = state.compareRowFilter === "all" ? rows.rows : state.compareRowFilter === "changes" ? rows.rows.filter(row => row.status !== "unchanged") : rows.rows.filter(row => row.status === state.compareRowFilter);
  return `<section class="trace-section trace-table-section"><div class="trace-section-head"><div><p class="section-label">Row changes</p><h2>${visibleRows.length} matching rows</h2></div><div class="trace-row-actions"><span>Matched by <code>${esc(rows.key.baselinePath)}</code></span><label>Show <select data-row-filter>${[["changes","Changes only"],["all","All"],["added","Added"],["removed","Removed"],["changed","Changed"],["unchanged","Unchanged"]].map(([value,label]) => `<option value="${value}" ${state.compareRowFilter === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><button type="button" data-export-rows="added">Export added</button><button type="button" data-export-rows="removed">Export removed</button><button type="button" data-export-rows="changed">Export changed</button></div></div><div class="trace-table-wrap"><table class="trace-table"><caption class="visually-hidden">Filtered comparison rows</caption><thead><tr><th scope="col">Key</th><th scope="col">Status</th><th scope="col">Changed fields</th><th scope="col">Baseline row</th><th scope="col">Candidate row</th></tr></thead><tbody>${visibleRows.map(row => `<tr><td><code>${esc(display(row.key))}</code></td><td><span class="trace-change is-${row.status}">${title(row.status)}</span></td><td>${row.changes.map(change => esc(change.path)).join(", ") || "N/A"}</td><td><code>${esc(JSON.stringify(row.before))}</code></td><td><code>${esc(JSON.stringify(row.after))}</code></td></tr>`).join("")}</tbody></table></div></section>`;
}

function resultHtml() {
  if (state.notice) return `<div class="format-diagnostic is-danger"><p>${esc(state.notice)}</p></div>`;
  if (state.mode === "compare" && !state.comparison) return `<section class="empty-state"><p>Add a candidate dataset, then run the comparison.</p></section>`;
  if (state.mode === "explore" && !state.analysis) return `<section class="empty-state"><p>Paste data or import a file, then run Trace.</p></section>`;
  if (state.mode === "compare") {
    if (state.activeTab === "schema") return comparisonSchema(state.comparison);
    if (state.activeTab === "fields") return comparisonFields(state.comparison);
    if (state.activeTab === "rows") return comparisonRows(state.comparison);
    return compareOverview(state.comparison);
  }
  if (state.activeTab === "fields") return fieldsHtml(state.analysis);
  if (state.activeTab === "records") return recordsHtml(state.analysis);
  if (state.activeTab === "structure") return structureHtml(state.analysis);
  return overviewHtml(state.analysis);
}

function settingsHtml() {
  if (state.mode !== "compare") return "";
  const settings = state.compareSettings;
  const keyFields = (state.comparison?.baseline.fields || state.analysis?.fields || []).filter(field => field.relativeSegments?.length);
  return `<details class="trace-settings"><summary>Comparison settings</summary><div>
    <fieldset class="trace-key-fields"><legend>Matching key fields</legend><p>${settings.keyPaths.length ? `${settings.keyPaths.length} selected` : "None selected · Trace will auto-detect one safe identifier"}</p>${keyFields.map(field => `<label><input type="checkbox" data-setting-key-part="${esc(field.path)}" ${settings.keyPaths.includes(field.path) || (!settings.keyPaths.length && settings.keyPath === field.path) ? "checked" : ""}> ${esc(field.label)}${field.role.id === "identifier" ? " · likely identifier" : ""}</label>`).join("")}</fieldset>
    <label>Absolute numeric tolerance<input type="number" min="0" step="any" data-setting="absoluteTolerance" value="${settings.absoluteTolerance}"></label>
    <label>Relative tolerance<input type="number" min="0" step="any" data-setting="relativeTolerance" value="${settings.relativeTolerance}"></label>
    <label><input type="checkbox" data-setting="missingEquivalent" ${settings.missingEquivalent ? "checked" : ""}> Treat null, empty, and missing as equal</label>
    <label><input type="checkbox" data-setting="ignoreArrayOrder" ${settings.ignoreArrayOrder ? "checked" : ""}> Ignore array order</label>
    <label><input type="checkbox" data-setting="matchByOrder" ${settings.matchByOrder ? "checked" : ""}> Match rows by position when no safe key exists</label>
  </div></details>`;
}

function tabsHtml() {
  const tabs = state.mode === "compare" ? [["overview", "Overview"], ["schema", "Schema"], ["fields", "Fields"], ["rows", "Rows"]] : [["overview", "Overview"], ["fields", "Fields"], ["records", "Records"], ["structure", "Structure"]];
  return `<nav class="trace-tabs" role="tablist" aria-label="Trace result views">${tabs.map(([id, label]) => `<button type="button" role="tab" id="trace-tab-${id}" aria-controls="trace-result-panel" aria-selected="${state.activeTab === id}" tabindex="${state.activeTab === id ? "0" : "-1"}" data-tab="${id}" class="${state.activeTab === id ? "is-active" : ""}">${label}</button>`).join("")}</nav>`;
}

function render() {
  if (!root) return;
  const currentResult = state.mode === "compare" ? state.comparison : state.analysis;
  root.innerHTML = `<section class="app-shell trace-page">
    <header class="tool-header trace-product-header"><p class="section-label">Trace · Stable</p><h1>Understand your data in seconds.</h1><p class="tool-subhead">Paste or import structured data. Trace explains its shape, patterns, gaps, and unusual values. It runs locally, deterministically, and without an LLM.</p></header>
    <div class="trace-mode" role="group" aria-label="Trace mode"><button type="button" data-mode="explore" class="${state.mode === "explore" ? "is-active" : ""}">Explore</button><button type="button" data-mode="compare" class="${state.mode === "compare" ? "is-active" : ""}">Compare</button></div>
    <section class="trace-workbench">
      ${state.mode === "compare" ? `<div class="trace-presets"><span>Try a comparison</span><button type="button" data-compare-preset="schema">Schema drift</button><button type="button" data-compare-preset="missingness">Missingness change</button><button type="button" data-compare-preset="distribution">Distribution shift</button><button type="button" data-compare-preset="reordered">Reordered records</button></div>` : `<div class="trace-presets"><span>Try a representative dataset</span><button type="button" data-preset="customers">Customers CSV</button><button type="button" data-preset="nested">Nested API JSON</button><button type="button" data-preset="telemetry">Telemetry JSON</button></div>`}
      <div class="trace-input-grid ${state.mode === "explore" ? "is-single" : ""}">${sourceEditor("A", state.textA, state.mode === "compare" ? "Baseline" : state.nameA)}${state.mode === "compare" ? sourceEditor("B", state.textB, "Candidate", true) : ""}</div>
      ${settingsHtml()}<div class="trace-runbar"><button class="button is-primary" type="button" data-run ${state.processing ? "disabled" : ""}>${state.processing ? "Analyzing…" : state.mode === "compare" ? "Compare datasets" : "Analyze data"}</button>${state.processing ? `<button class="button" type="button" data-cancel>Cancel analysis</button>` : ""}<span data-run-status>${state.processing ? title(state.phase || "starting") : "Runs locally in this browser"}</span></div>
    </section>
    ${state.warning ? `<div class="format-diagnostic is-warn"><p>${esc(state.warning)}</p></div>` : ""}
    ${currentResult ? `<section class="trace-result-shell"><div class="trace-result-bar">${tabsHtml()}<div class="trace-result-actions"><details class="trace-export-menu"><summary class="button is-small">Export</summary><div><button type="button" data-export="safe">Privacy-safe report</button><button type="button" data-export="full">Full report with examples</button>${state.mode === "explore" && state.analysis.recordSet ? `<button type="button" data-export="csv">Filtered records CSV</button><button type="button" data-export="json">Filtered records JSON</button>` : ""}</div></details><button type="button" class="button is-small" data-print>Print / PDF</button><button type="button" class="button is-small" data-share>Share</button></div></div><div class="trace-result" id="trace-result-panel" role="tabpanel" aria-labelledby="trace-tab-${esc(state.activeTab)}">${resultHtml()}</div></section>` : `<div class="trace-result">${resultHtml()}</div>`}
    <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">${esc(state.announcement)}</div>
  </section>`;
  attachEvents();
}

function download(name, content, type = "application/json") {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([content], { type }));
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

async function loadFile(file, id) {
  const validation = validateImportFile(file, { maxBytes: TRACE_FILE_MAX_BYTES });
  if (!validation.ok) { state.notice = validation.text; render(); return; }
  const text = await file.text();
  const textValidation = validateImportText(text);
  if (!textValidation.ok) { state.notice = textValidation.text; render(); return; }
  if (id === "A") {
    state.textA = text; state.nameA = file.name; state.formatA = validation.format; state.originA = "file"; state.recordSetPathA = "";
  } else {
    state.textB = text; state.nameB = file.name; state.formatB = validation.format; state.originB = "file"; state.recordSetPathB = "";
  }
  runAnalysis();
}

async function importFile(input) { return loadFile(input.files?.[0], input.dataset.file); }

function attachEvents() {
  root.querySelectorAll("[data-input]").forEach(input => input.addEventListener("input", event => {
    if (event.target.dataset.input === "A") { state.textA = event.target.value; state.originA = "paste"; state.recordSetPathA = ""; }
    else { state.textB = event.target.value; state.originB = "paste"; state.recordSetPathB = ""; }
    invalidateAnalysisForEdit();
  }));
  root.querySelectorAll("[data-format-override]").forEach(select => select.addEventListener("change", () => {
    if (select.dataset.formatOverride === "A") state.formatA = select.value; else state.formatB = select.value;
    invalidateAnalysisForEdit();
  }));
  root.querySelectorAll("[data-record-set]").forEach(select => select.addEventListener("change", () => {
    if (select.dataset.recordSet === "A") state.recordSetPathA = select.value; else state.recordSetPathB = select.value;
    runAnalysis();
  }));
  root.querySelectorAll("[data-file]").forEach(input => input.addEventListener("change", () => importFile(input)));
  root.querySelectorAll("[data-drop]").forEach(surface => {
    surface.addEventListener("dragover", event => { event.preventDefault(); surface.classList.add("is-dragging"); });
    surface.addEventListener("dragleave", () => surface.classList.remove("is-dragging"));
    surface.addEventListener("drop", event => {
      event.preventDefault();
      surface.classList.remove("is-dragging");
      const files = [...(event.dataTransfer?.files || [])];
      if (files.length !== 1) { state.notice = "Drop exactly one supported data file into each source."; render(); return; }
      loadFile(files[0], surface.dataset.drop);
    });
  });
  root.querySelector("[data-run]")?.addEventListener("click", runAnalysis);
  root.querySelector("[data-cancel]")?.addEventListener("click", cancelAnalysis);
  root.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => {
    if (state.mode === button.dataset.mode) return;
    invalidateAnalysisState();
    state.mode = button.dataset.mode;
    state.activeTab = "overview";
    state.activeField = null;
    state.activeRecordFilter = null;
    state.recordPage = 0;
    state.recordColumns = null;
    state.activeRecordIndex = null;
    state.notice = "";
    state.announcement = `${title(state.mode)} mode selected.`;
    if (state.mode === "compare" && !state.textB) state.textB = state.textA;
    render();
  }));
  root.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => {
    state.textA = presets[button.dataset.preset];
    state.nameA = `${button.textContent.trim()}`;
    state.formatA = "auto"; state.originA = "preset"; state.recordSetPathA = "";
    if (state.mode === "compare") { state.textB = state.textA; state.formatB = "auto"; state.originB = "preset"; state.recordSetPathB = ""; }
    runAnalysis();
  }));
  root.querySelectorAll("[data-compare-preset]").forEach(button => button.addEventListener("click", () => {
    const [baseline, candidate] = comparePresets[button.dataset.comparePreset];
    state.textA = JSON.stringify(baseline, null, 2);
    state.textB = JSON.stringify(candidate, null, 2);
    state.nameA = `${button.textContent.trim()} baseline`;
    state.nameB = `${button.textContent.trim()} candidate`;
    state.formatA = "json"; state.formatB = "json";
    state.originA = "preset"; state.originB = "preset";
    state.recordSetPathA = ""; state.recordSetPathB = "";
    runAnalysis();
  }));
  root.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => { state.activeTab = button.dataset.tab; state.activeField = null; state.announcement = `${button.textContent} tab selected.`; render(); }));
  root.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("keydown", event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...root.querySelectorAll("[data-tab]")];
    const current = tabs.indexOf(button);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    state.activeTab = tabs[next].dataset.tab;
    state.activeField = null;
    state.announcement = `${tabs[next].textContent} tab selected.`;
    render();
    root.querySelector(`[data-tab="${state.activeTab}"]`)?.focus();
  }));
  root.querySelectorAll("[data-field]").forEach(button => button.addEventListener("click", () => { state.activeTab = "fields"; state.activeField = button.dataset.field; render(); }));
  root.querySelectorAll("[data-insight-records]").forEach(button => button.addEventListener("click", () => {
    const insight = state.analysis.insights.find(item => item.id === button.dataset.insightRecords);
    state.activeRecordFilter = insight ? { insightId: insight.id, label: insight.title } : null;
    state.activeTab = "records";
    state.recordPage = 0;
    state.announcement = `${insight?.affected.count || 0} affected records selected for ${insight?.title || "the finding"}.`;
    render();
  }));
  root.querySelector("[data-clear-record-filter]")?.addEventListener("click", () => { state.activeRecordFilter = null; state.recordPage = 0; state.announcement = "Finding filter cleared."; render(); });
  root.querySelector("[data-close-field]")?.addEventListener("click", () => { state.activeField = null; render(); });
  root.querySelector("[data-field-query]")?.addEventListener("input", event => { state.fieldQuery = event.target.value; render(); root.querySelector("[data-field-query]")?.focus(); });
  root.querySelector("[data-field-filter]")?.addEventListener("change", event => { state.fieldFilter = event.target.value; state.activeField = null; render(); });
  root.querySelector("[data-schema-filter]")?.addEventListener("change", event => { state.schemaFilter = event.target.value; render(); });
  root.querySelector("[data-row-filter]")?.addEventListener("change", event => { state.compareRowFilter = event.target.value; render(); });
  root.querySelector("[data-record-query]")?.addEventListener("input", event => { state.recordQuery = event.target.value; state.recordPage = 0; render(); root.querySelector("[data-record-query]")?.focus(); });
  root.querySelectorAll("[data-record-column]").forEach(input => input.addEventListener("change", () => {
    state.recordColumns = [...root.querySelectorAll("[data-record-column]:checked")].map(item => item.dataset.recordColumn);
    render();
  }));
  root.querySelector("[data-structure-query]")?.addEventListener("input", event => { state.structureQuery = event.target.value; render(); root.querySelector("[data-structure-query]")?.focus(); });
  root.querySelectorAll("[data-structure-toggle]").forEach(button => button.addEventListener("click", () => {
    root.querySelectorAll(".trace-structure details").forEach(details => { details.open = button.dataset.structureToggle === "expand"; });
    state.announcement = `${button.dataset.structureToggle === "expand" ? "Expanded" : "Collapsed"} all structure groups.`;
  }));
  root.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => { state.recordPage += button.dataset.page === "next" ? 1 : -1; render(); }));
  root.querySelectorAll("[data-setting]").forEach(input => input.addEventListener("change", () => {
    state.compareSettings[input.dataset.setting] = input.type === "checkbox" ? input.checked : Number(input.value) || 0;
    if (state.analysis) runAnalysis();
  }));
  root.querySelectorAll("[data-setting-key-part]").forEach(input => input.addEventListener("change", () => {
    state.compareSettings.keyPaths = [...root.querySelectorAll("[data-setting-key-part]:checked")].map(item => item.dataset.settingKeyPart);
    state.compareSettings.keyPath = state.compareSettings.keyPaths.length === 1 ? state.compareSettings.keyPaths[0] : "";
    if (state.analysis) runAnalysis();
  }));
  root.querySelectorAll("[data-ignore-field]").forEach(input => input.addEventListener("change", () => {
    const fields = new Set(state.compareSettings.ignoreFields);
    if (input.checked) fields.add(input.dataset.ignoreField); else fields.delete(input.dataset.ignoreField);
    state.compareSettings.ignoreFields = [...fields].sort();
    runAnalysis();
  }));
  root.querySelectorAll("[data-copy]").forEach(button => button.addEventListener("click", async () => {
    const copied = await copyText(button.dataset.copy);
    button.textContent = copied ? "Copied" : "Copy failed";
  }));
  root.querySelectorAll("[data-copy-path]").forEach(button => button.addEventListener("click", async () => {
    const copied = await copyText(button.dataset.copyPath);
    button.textContent = copied ? "Copied" : "Copy failed";
    state.announcement = copied ? `Copied path ${button.dataset.copyPath}.` : "Path copy failed.";
  }));
  root.querySelectorAll("[data-copy-record]").forEach(button => button.addEventListener("click", async () => {
    const records = traceRecordSet(state.valueA, state.analysis?.shape.recordSetPath) || [];
    const copied = await copyText(JSON.stringify(records[Number(button.dataset.copyRecord)], null, 2));
    button.textContent = copied ? "Copied" : "Copy failed";
    state.announcement = copied ? `Copied record ${Number(button.dataset.copyRecord) + 1}.` : "Record copy failed.";
  }));
  root.querySelectorAll("[data-inspect-record]").forEach(button => button.addEventListener("click", () => { state.activeRecordIndex = Number(button.dataset.inspectRecord); render(); }));
  root.querySelector("[data-close-record]")?.addEventListener("click", () => { state.activeRecordIndex = null; render(); });
  root.querySelectorAll("[data-export]").forEach(button => button.addEventListener("click", () => {
    const kind = button.dataset.export;
    const reportName = `trace_${state.analysis.source.contentFingerprint.slice(0, 8)}`;
    if (kind === "full") {
      if (!window.confirm("This report includes raw example values and row-level comparison details. Continue?")) return;
      download(`${reportName}_full.json`, serializeTraceReport(state.mode === "compare" ? state.comparison : state.analysis, { privacySafe: false }));
    } else if (kind === "safe") {
      download(`${reportName}.json`, serializeTraceReport(state.mode === "compare" ? state.comparison : state.analysis, { privacySafe: true }));
    } else if (kind === "csv") {
      download("trace-filtered-records.csv", recordsToCsv(filteredRecords(), state.analysis.fields), "text/csv;charset=utf-8");
    } else if (kind === "json") {
      download("trace-filtered-records.json", recordsToJson(filteredRecords()));
    }
  }));
  root.querySelectorAll("[data-export-field]").forEach(button => button.addEventListener("click", () => {
    const field = state.analysis.fields.find(item => item.path === button.dataset.fieldPath);
    if (!field) return;
    const records = filteredRecords();
    if (button.dataset.exportField === "csv") download(`trace-${field.label}-values.csv`, recordsToCsv(records, [field]), "text/csv;charset=utf-8");
    else download(`trace-${field.label}-values.json`, recordsToJson(records.map(record => valueAtRelativePath(record, field.relativeSegments))));
  }));
  root.querySelectorAll("[data-export-rows]").forEach(button => button.addEventListener("click", () => {
    const status = button.dataset.exportRows;
    const records = (state.comparison?.rows?.rows || []).filter(row => row.status === status).map(row => status === "removed" ? row.before : status === "added" ? row.after : ({ key: row.key, before: row.before, after: row.after, changes: row.changes }));
    download(`trace-${status}-rows.json`, recordsToJson(records));
  }));
  root.querySelector("[data-export-schema]")?.addEventListener("click", () => {
    const changed = (state.comparison?.fields || []).filter(field => field.status !== "same" && (state.schemaFilter === "all" || field.status === state.schemaFilter));
    download("trace-schema-changes.json", recordsToJson(changed));
  });
  root.querySelector("[data-print]")?.addEventListener("click", () => window.print());
  root.querySelector("[data-share]")?.addEventListener("click", async event => {
    if (!window.confirm("This link contains the data itself. Anyone with the link can read it. Continue?")) return;
    try {
      const url = await shareUrlForState({ version: 3, mode: state.mode, textA: state.textA, textB: state.textB, formatA: state.formatA, formatB: state.formatB, recordSetPathA: state.recordSetPathA, recordSetPathB: state.recordSetPathB, settings: state.compareSettings, activeTab: state.activeTab, activeField: state.activeField, activeRecordFilter: state.activeRecordFilter });
      const copied = await copyText(url);
      event.currentTarget.textContent = copied ? "Link copied" : "Copy link";
    } catch (error) { state.notice = error?.message || "Could not create the share link."; render(); }
  });
}

async function init() {
  let restored = false;
  try {
    const shared = await sharedStateFromLocation();
    if (shared?.textA) {
      restored = true;
      state.mode = shared.mode === "compare" ? "compare" : "explore";
      state.textA = shared.textA;
      state.textB = shared.textB || "";
      state.formatA = shared.formatA || "auto";
      state.formatB = shared.formatB || "auto";
      state.recordSetPathA = shared.recordSetPathA || "";
      state.recordSetPathB = shared.recordSetPathB || "";
      state.compareSettings = { ...state.compareSettings, ...(shared.settings || {}) };
      state.restoreUi = { activeTab: shared.activeTab || "overview", activeField: shared.activeField || null, activeRecordFilter: shared.activeRecordFilter || null };
    }
  } catch (error) { state.notice = error?.message || "The shared Trace state could not be opened."; }
  if (restored) runAnalysis();
  else render();
}

init();
