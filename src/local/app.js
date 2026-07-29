import { runJsonTransform } from "../intelligence/json-transform/engine.js";
import { executeJsonTransform, runtimeWarnings } from "../intelligence/json-transform/runtime.js";
import { applySuggestions, hasValuableSuggestions, suggestTransformations } from "../intelligence/json-transform/suggestions.js";
import { analyzeStructure } from "../intelligence/json-transform/analysis.js";
import { detectFormat as detectDataFormat, detectUnsupportedFormat, formatLabel as dataFormatLabel, FORMATS, FORMAT_ORDER, parseWithFormat, serializeWithFormat } from "../intelligence/data-formats/index.js";
import { generateCLIExport, generateJavaScriptTransform, generateMakeCode, generateN8nCode, generatePlainFunction } from "../intelligence/json-transform/exporters.js";
import { explainOp } from "../intelligence/json-transform/explain.js";
import { DEFAULT_JSON_TRANSFORM_SAMPLE_ID, JSON_TRANSFORM_SAMPLE_GROUPS, JSON_TRANSFORM_SAMPLES } from "../intelligence/json-transform/samples.js";
import { buildTransformTask, runBuiltTransform, runTransform } from "../intelligence/json-transform/translator.js";
import { FILE_IMPORT_MAX_BYTES, formatBytes, unsafeTextReason, validateImportFile } from "./file-import.js";
import { opSources } from "../intelligence/json-transform/shared.js";
import { esc, inlineCodeHtml, plural } from "./shared.js";
import { copyText as writeClipboardText, shareUrlForState, sharedStateFromLocation } from "./share-state.js";
import { createRenderHelpers } from "./render-helpers.js";

const app = document.getElementById("app");
const samples = Object.fromEntries(JSON_TRANSFORM_SAMPLES.map(sample => [sample.id, sample]));
const sampleGroups = Object.fromEntries(JSON_TRANSFORM_SAMPLE_GROUPS.map(group => [group.id, group]));
const DEFAULT_SAMPLE_GROUP_ID = samples[DEFAULT_JSON_TRANSFORM_SAMPLE_ID]?.group || JSON_TRANSFORM_SAMPLE_GROUPS[0]?.id || "cross-format";
const DEFAULT_DEMO_SAMPLE_ID = DEFAULT_JSON_TRANSFORM_SAMPLE_ID;
const MEMORY_KEY = "latentmachine.savedRules.v1";
const MAX_INSTANT_BATCH = 100;
const MAX_BATCH = 10000;
const BATCH_CHUNK_SIZE = 50;
const BATCH_PREVIEW_LIMIT = 5;
const BATCH_ISSUE_LIMIT = 20;
const RENDER_DEBOUNCE_MS = 500;
const state = {
  activeSample: null,
  activeSampleGroup: DEFAULT_SAMPLE_GROUP_ID,
  examples: [],
  tests: [],
  tryInput: "{\n}",
  inputFormat: "auto",
  outputFormat: "auto",
  correctionDraft: "",
  learningNotice: "",
  copied: null,
  focusAfterRender: null,
  openDetails: {},
  flashIndex: null,
  lastStatusKey: null,
  evaluation: { result: null, error: null, durationMs: 0, batch: false },
  hasPendingChanges: false,
  outputPreviewMode: "preview",
  transformNotice: "",
  transformBusy: false,
  importNotice: null,
  savedRules: loadSavedRules(),
  loadedRule: null,
  batchJob: null,
  batchProgress: null,
  smartSuggestions: null,
  cliExportPreview: false,
  lastInspectionKey: null,
  presetGroupScrollLeft: 0,
};

let renderTimer = null;
let copyTimer = null;
let batchTimer = null;
let batchJobId = 0;
let transformRequestId = 0;
let inferWorker = null;
let inferWorkerMessageId = 0;
const inferWorkerRequests = new Map();

function rejectInferWorkerRequests(message) {
  for (const request of inferWorkerRequests.values()) request.reject(new Error(message));
  inferWorkerRequests.clear();
}

function getInferWorker() {
  if (inferWorker || typeof Worker === "undefined") return inferWorker;
  try {
    inferWorker = new Worker(new URL("./infer-worker.js", import.meta.url), { type: "module" });
  } catch {
    inferWorker = null;
    return null;
  }
  inferWorker.addEventListener("message", event => {
    const request = inferWorkerRequests.get(event.data?.id);
    if (!request) return;
    inferWorkerRequests.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.result);
  });
  inferWorker.addEventListener("error", () => {
    rejectInferWorkerRequests("The background transform worker stopped unexpectedly.");
    inferWorker?.terminate();
    inferWorker = null;
  });
  return inferWorker;
}

function inferTransform(rawTask, transformTask) {
  const worker = getInferWorker();
  if (!worker) return Promise.resolve(runBuiltTransform(rawTask, transformTask, { applyBatch: false }));
  const id = ++inferWorkerMessageId;
  return new Promise((resolve, reject) => {
    inferWorkerRequests.set(id, { resolve, reject });
    worker.postMessage({ id, rawTask, transformTask });
  });
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function editorValue(value) {
  return typeof value === "string" ? value : pretty(value);
}

function loadSavedRules() {
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(MEMORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedRules() {
  try {
    window.localStorage?.setItem(MEMORY_KEY, JSON.stringify(state.savedRules));
  } catch {}
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function batchInputKey() {
  const teaching = completedExamples().map(example => ({
    input: example.input,
    output: example.output,
    inputFormat: example.inputFormat || "auto",
    outputFormat: example.outputFormat || "auto",
    correction: example.correction,
  }));
  return hashText(`${JSON.stringify(teaching)}\n${state.inputFormat}\n${state.outputFormat}\n${state.tryInput}`);
}

function clearBatchJob() {
  transformRequestId += 1;
  state.transformBusy = false;
  batchJobId += 1;
  window.clearTimeout(batchTimer);
  batchTimer = null;
  state.batchJob = null;
  state.batchProgress = null;
}

function markTeachingChanged() {
  clearBatchJob();
  state.loadedRule = null;
  state.hasPendingChanges = true;
  state.correctionDraft = "";
  state.learningNotice = "";
}

function markPayloadChanged() {
  clearBatchJob();
  state.hasPendingChanges = true;
  state.correctionDraft = "";
  state.learningNotice = "";
}

function detectFormat(text) {
  return detectDataFormat(text);
}

function formatLabel(format) {
  return dataFormatLabel(format);
}

function isSupportedDataFormat(format) {
  return FORMAT_ORDER.includes(format);
}

function importNoticeHtml() {
  if (!state.importNotice) return "";
  return `<div class="file-import-note is-${esc(state.importNotice.tone)}">${esc(state.importNotice.text)}</div>`;
}

function fileImportPanel() {
  return `<div class="file-import" data-file-drop>
    <input class="visually-hidden" id="try-file-input" type="file" data-file-input accept=".json,.xml,.csv,.toml,.sql,.yaml,.yml,.env,application/json,application/xml,text/xml,text/csv,application/toml,text/toml,text/yaml,application/yaml,text/plain" />
    <label class="button is-subtle" for="try-file-input">Import file</label>
    <span>.json, .xml, .csv, .toml, .sql, .yaml, or .env, ${esc(formatBytes(FILE_IMPORT_MAX_BYTES))} max</span>
  </div>
  ${importNoticeHtml()}`;
}

function formatNote(value, manualFormat = "auto") {
  const unsupported = detectUnsupportedFormat(value);
  if (manualFormat !== "json" && unsupported) return "";
  const format = manualFormat === "auto" ? detectFormat(value) : manualFormat;
  if (isSupportedDataFormat(format) || format === "empty") return "";
  return `<div class="format-note">Use JSON, XML, CSV, TOML, SQL INSERT, YAML, or .env, or choose a format manually.</div>`;
}

function offsetToLineColumn(text, offset) {
  const before = String(text ?? "").slice(0, offset);
  return {
    line: before.split(/\r\n|\r|\n/).length,
    column: before.length - before.lastIndexOf("\n"),
  };
}

function parseErrorLocation(text, message = "") {
  const lineColumn = message.match(/line\s+(\d+),?\s+column\s+(\d+)/i);
  if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
  const position = Number(message.match(/position\s+(\d+)/i)?.[1]);
  return Number.isFinite(position) ? offsetToLineColumn(text, position) : null;
}

function stripCodeFence(text) {
  return String(text ?? "").trim().replace(/^```(?:json|xml|csv|toml|sql|ya?ml|env|dotenv)?\s*/i, "").replace(/\s*```$/i, "");
}

function removeLeadingFormatLabel(text) {
  return String(text ?? "").replace(/^\s*(?:json|xml|csv|toml|sql|sql insert|ya?ml|env|dotenv)\s*(?=[<{[\w"'])/i, "");
}

function replaceSmartQuotes(text) {
  return String(text ?? "").replace(/[“”‘’]/g, "\"");
}

function removeTrailingJsonCommas(text) {
  return String(text ?? "").replace(/,\s*([}\]])/g, "$1");
}

function likelyJsonText(text) {
  const trimmed = removeLeadingFormatLabel(stripCodeFence(text)).trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function canParseAs(text, format) {
  try {
    FORMATS[format].parse(text, { singleRowAsObject: true });
    return true;
  } catch {
    return false;
  }
}

function diagnosticFormat(value, manualFormat = "auto") {
  const text = String(value ?? "");
  const detected = detectFormat(text);
  if (likelyJsonText(text)) return "json";
  if (manualFormat !== "auto") return manualFormat;
  return detected === "unknown" && likelyJsonText(text) ? "json" : detected;
}

function formatFixes(value, manualFormat = "auto") {
  const text = String(value ?? "");
  const format = diagnosticFormat(text, manualFormat);
  const fixes = [
    { id: "strip-fence", label: "Remove code fence", next: stripCodeFence(text) },
    { id: "remove-label", label: "Remove format label", next: removeLeadingFormatLabel(text) },
    { id: "smart-quotes", label: "Replace smart quotes", next: replaceSmartQuotes(text) },
    { id: "trailing-commas", label: "Remove trailing commas", next: removeTrailingJsonCommas(text) },
  ];

  return fixes
    .filter(fix => fix.next !== text)
    .filter(fix => format !== "json" || canParseAs(fix.next, "json"))
    .filter(fix => format !== "xml" || canParseAs(fix.next, "xml"))
    .filter(fix => format !== "csv" || canParseAs(fix.next, "csv"))
    .filter(fix => format !== "toml" || canParseAs(fix.next, "toml"))
    .filter(fix => format !== "sql" || canParseAs(fix.next, "sql"))
    .filter(fix => format !== "yaml" || canParseAs(fix.next, "yaml"))
    .filter(fix => format !== "env" || canParseAs(fix.next, "env"));
}

function formatDiagnostic(value, manualFormat = "auto") {
  const text = String(value ?? "");
  if (!text.trim()) return null;
  const cleaned = removeLeadingFormatLabel(stripCodeFence(text));
  const unsupported = manualFormat !== "json" ? detectUnsupportedFormat(text) : null;
  if (unsupported) {
    return {
      tone: "warn",
      title: `${unsupported.label} detected`,
      text: unsupported.message,
    };
  }
  const format = diagnosticFormat(text, manualFormat);

  if (format === "json" || (format === "unknown" && likelyJsonText(cleaned))) {
    try {
      JSON.parse(format === "json" ? text : cleaned);
      return null;
    } catch (error) {
      const location = parseErrorLocation(text, error?.message || "");
      return {
        tone: "danger",
        title: "JSON syntax error",
        text: `${location ? `Line ${location.line}, column ${location.column}. ` : ""}${error?.message || "Could not parse JSON."}`,
      };
    }
  }

  if (format === "csv") {
    try {
      FORMATS.csv.parse(text, { singleRowAsObject: true });
      return null;
    } catch (error) {
      return {
        tone: "danger",
        title: "CSV format error",
        text: error?.message || "Could not parse CSV.",
      };
    }
  }

  if (format === "xml") {
    try {
      FORMATS.xml.parse(text, { singleRowAsObject: true });
      return null;
    } catch (error) {
      return {
        tone: "danger",
        title: "XML format error",
        text: error?.message || "Could not parse XML.",
      };
    }
  }

  if (format === "env") {
    try {
      FORMATS.env.parse(text, { singleRowAsObject: true });
      return null;
    } catch (error) {
      return {
        tone: "danger",
        title: ".env format error",
        text: error?.message || "Could not parse .env.",
      };
    }
  }

  if (format === "sql") {
    try {
      FORMATS.sql.parse(text, { singleRowAsObject: true });
      return null;
    } catch (error) {
      return {
        tone: "danger",
        title: "SQL INSERT format error",
        text: error?.message || "Could not parse SQL INSERT.",
      };
    }
  }

  if (format === "toml") {
    try {
      FORMATS.toml.parse(text, { singleRowAsObject: true });
      return null;
    } catch (error) {
      return {
        tone: "danger",
        title: "TOML format error",
        text: error?.message || "Could not parse TOML.",
      };
    }
  }

  if (format === "yaml") {
    try {
      FORMATS.yaml.parse(text, { singleRowAsObject: true });
      return null;
    } catch (error) {
      return {
        tone: "danger",
        title: "YAML format error",
        text: error?.message || "Could not parse YAML.",
      };
    }
  }

  if (format === "unknown") {
    return {
      tone: "warn",
      title: "Format not recognized",
      text: "Choose JSON, XML, CSV, TOML, SQL INSERT, YAML, or .env, or remove wrapper text around the data.",
    };
  }

  return null;
}

function formatDiagnosticHtml(editorId, value, manualFormat = "auto") {
  const diagnostic = formatDiagnostic(value, manualFormat);
  if (!diagnostic) return "";
  const fixes = formatFixes(value, manualFormat);
  return `<div class="format-diagnostic is-${esc(diagnostic.tone)}">
    <p><strong>${esc(diagnostic.title)}.</strong> ${esc(diagnostic.text)}</p>
    ${fixes.length ? `<div class="format-fixes">
      ${fixes.map(fix => `<button class="button is-subtle" type="button" data-apply-format-fix="${esc(editorId)}" data-fix-id="${esc(fix.id)}">${esc(fix.label)}</button>`).join("")}
    </div>` : ""}
  </div>`;
}

function dataInputNote(value, manualFormat = "auto", action = "transformed") {
  const text = String(value ?? "");
  if (!text.trim() || detectUnsupportedFormat(text)) return "";
  const format = manualFormat === "auto" ? detectFormat(text) : manualFormat;
  if (!isSupportedDataFormat(format)) return "";

  try {
    const parsed = parseWithFormat(text, format, { singleRowAsObject: true });
    if (!Array.isArray(parsed)) {
      if (parsed && typeof parsed === "object" && format === "csv") {
        return `<div class="array-note">${esc(formatLabel(format))} record detected - 1 record will be ${esc(action)}.</div>`;
      }
      return "";
    }

    const invalid = invalidBatchItems(parsed);
    if (invalid.length) {
      const positions = invalid.slice(0, 8).map(item => `${item.index} (${item.type})`).join(", ");
      const suffix = invalid.length > 8 ? `, and ${invalid.length - 8} more` : "";
      return `<div class="array-note is-warn">Batch records must be objects. Found non-object items at positions ${esc(positions)}${esc(suffix)}.</div>`;
    }

    const label = format === "json" ? "Array" : `${formatLabel(format)} records`;
    return `<div class="array-note">${esc(label)} detected - ${plural(parsed.length, "record")}. The rule will be applied to each item.</div>`;
  } catch {
    return "";
  }
}

function clearSmartSuggestions() {
  state.smartSuggestions = null;
}

function parseSuggestionInput(example) {
  return parseWithFormat(example.input, example.inputFormat || "auto", { singleRowAsObject: true, coerce: false });
}

function suggestionInputFormat(example) {
  const manualFormat = example.inputFormat || "auto";
  return manualFormat === "auto" ? detectFormat(example.input) : manualFormat;
}

function updateSmartSuggestions() {
  const first = state.examples[0];
  if (!first?.input?.trim() || first.output.trim()) return clearSmartSuggestions();
  if (state.examples.some((example, index) => index > 0 && example.input.trim() && example.output.trim())) return clearSmartSuggestions();
  if (suggestionInputFormat(first) !== "csv") return clearSmartSuggestions();

  try {
    const parsed = parseSuggestionInput(first);
    if (!parsed || typeof parsed !== "object") return clearSmartSuggestions();
    const suggestions = suggestTransformations(parsed);
    const transformed = suggestions.hasSuggestions ? applySuggestions(parsed, suggestions.suggestions.filter(suggestion => suggestion.defaultOn)) : parsed;
    state.smartSuggestions = hasValuableSuggestions(suggestions) && JSON.stringify(parsed) !== JSON.stringify(transformed) ? suggestions : null;
  } catch {
    clearSmartSuggestions();
  }
}

function inputOnlyAnalysis() {
  const first = state.examples[0];
  if (!first?.input?.trim() || first.output.trim()) return null;
  if (completedExamples().length) return null;
  if (detectUnsupportedFormat(first.input)) return null;
  const format = suggestionInputFormat(first);
  if (!isSupportedDataFormat(format)) return null;

  try {
    const parsed = parseWithFormat(first.input, first.inputFormat || "auto", { singleRowAsObject: false });
    if (parsed === undefined || parsed === null) return null;
    return analyzeStructure(parsed, { maxArraySample: 100, maxUniqueValues: 12 });
  } catch {
    return null;
  }
}

function readableSuggestionPath(path = "") {
  return path.replace(/^\$\[\]\.?/, "").replace(/^\$\./, "").replace(/^\$/, "value") || "value";
}

function suggestionPhrase(suggestion) {
  const path = readableSuggestionPath(suggestion.path);
  if (suggestion.type === "coerce-number") return `${path} → number`;
  if (suggestion.type === "coerce-boolean") return `${path} → boolean`;
  if (suggestion.type === "split-array") return `${path} → list`;
  return `${path} changed`;
}

function suggestionSummary() {
  const suggestions = state.smartSuggestions?.suggestions || [];
  const phrases = suggestions.slice(0, 2).map(suggestionPhrase);
  const remaining = suggestions.length - phrases.length;
  return `${phrases.join(" · ")}${remaining > 0 ? ` · ${remaining} more` : ""}`;
}

function suggestionHint(index) {
  if (index !== 0 || !state.smartSuggestions?.hasSuggestions) return "";
  if (state.examples[0]?.output?.trim()) return "";
  return `<div class="suggestion-hint" aria-live="polite">
    <div class="suggestion-hint-inner">
      <span class="suggestion-summary">${esc(suggestionSummary())}</span>
      <button class="button is-subtle suggestion-action" type="button" data-draft-output title="Create an editable output draft with these changes">Use draft</button>
    </div>
  </div>`;
}

function editorRows(value) {
  const lines = String(value || "").split("\n").length;
  return Math.max(8, Math.min(18, lines + 1));
}

function completedExamples() {
  return state.examples.filter(example => example.input.trim() && example.output.trim());
}

function applySample(id, { evaluateNow = true } = {}) {
  clearBatchJob();
  const sample = samples[id] || samples[DEFAULT_JSON_TRANSFORM_SAMPLE_ID];
  state.activeSample = sample.id;
  state.activeSampleGroup = sample.group || DEFAULT_SAMPLE_GROUP_ID;
  state.examples = sample.examples.map(example => ({
    input: editorValue(example.input),
    output: editorValue(example.output),
    inputFormat: example.inputFormat || "auto",
    outputFormat: example.outputFormat || "auto",
    correction: false,
  }));
  state.tests = [];
  state.tryInput = editorValue(sample.newInput);
  state.inputFormat = sample.newInputFormat || sample.inputFormat || "auto";
  state.outputFormat = sample.outputFormat || sample.examples.find(example => example.outputFormat)?.outputFormat || "auto";
  state.correctionDraft = "";
  state.learningNotice = "";
  state.importNotice = null;
  state.openDetails = {};
  state.flashIndex = null;
  state.loadedRule = null;
  state.evaluation = evaluateNow ? evaluate() : { result: null, error: null, durationMs: 0, batch: false };
  state.hasPendingChanges = !evaluateNow;
  state.outputPreviewMode = "preview";
  state.transformNotice = "";
}

function loadSample(id) {
  applySample(id, { evaluateNow: true });
  render();
}

function parseTask() {
  return {
    examples: completedExamples().map(example => ({
      input: example.input,
      output: example.output,
      inputFormat: example.inputFormat || state.inputFormat || "auto",
      outputFormat: example.outputFormat || state.outputFormat || "auto",
      correction: example.correction,
    })),
    newInput: state.tryInput,
    inputFormat: state.inputFormat || "auto",
    outputFormat: state.outputFormat || "auto",
  };
}

function parseTaskWithNewInput(newInput) {
  return {
    examples: completedExamples().map(example => ({
      input: JSON.parse(example.input),
      output: JSON.parse(example.output),
      correction: example.correction,
    })),
    newInput,
  };
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function arrayItemType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function invalidBatchItems(items) {
  return items
    .map((item, index) => isPlainObject(item) ? null : { index, type: arrayItemType(item) })
    .filter(Boolean);
}

function outputHasGuardrail(value) {
  if (typeof value === "string") return /\[(unresolved|missing|invalid|conflict):? /.test(value) || value.startsWith("[missing ");
  if (Array.isArray(value)) return value.some(outputHasGuardrail);
  if (value && typeof value === "object") return Object.values(value).some(outputHasGuardrail);
  return false;
}

function batchExportOutputs(batchResults = []) {
  return batchResults
    .filter(row => row.status === "ok")
    .map(row => row.output);
}

function batchIssueRows(batchResults = []) {
  const rows = [];
  for (const row of batchResults) {
    if (row.status === "ok") continue;
    if (row.error) {
      rows.push({ index: row.index, text: row.error });
      continue;
    }
    const warnings = row.warnings?.length ? row.warnings : [{ message: "Output contains a guardrail placeholder." }];
    for (const warning of warnings) rows.push({ index: row.index, text: warning.message || warning.type || "Guardrail warning" });
  }
  return rows;
}

function runBatchItem(program, item, index) {
  try {
    const output = executeJsonTransform(program, item);
    const warnings = runtimeWarnings(program, item);
    const hasGuardrail = warnings.length > 0 || outputHasGuardrail(output);
    return {
      index,
      input: item,
      output,
      status: hasGuardrail ? "guardrail" : "ok",
      warnings,
    };
  } catch (error) {
    return {
      index,
      input: item,
      output: null,
      status: "error",
      error: error.message,
      warnings: [],
    };
  }
}

function batchCounts(batchResults = []) {
  const ok = batchResults.filter(row => row.status === "ok").length;
  const guardrail = batchResults.filter(row => row.status === "guardrail").length;
  const errored = batchResults.filter(row => row.status === "error").length;
  return { ok, guardrail, errored };
}

function finalBatchSummary(total, batchResults) {
  const counts = batchCounts(batchResults);
  return {
    total,
    ...counts,
    status: counts.guardrail || counts.errored ? "partial" : "clean",
  };
}

function batchProgressEvaluation(job) {
  const counts = batchCounts(job.batchResults);
  state.batchProgress = { processed: job.processed, total: job.items.length, startedAt: job.startedAt };
  return {
    result: job.result,
    error: null,
    durationMs: performance.now() - job.started,
    batch: true,
    batchResults: job.status === "complete" ? job.batchResults : null,
    batchSummary: {
      total: job.items.length,
      processed: job.processed,
      ...counts,
      status: job.status,
    },
  };
}

function runBatchChunk(job) {
  if (state.batchJob !== job || job.id !== batchJobId || job.key !== batchInputKey()) return;
  const end = Math.min(job.items.length, job.processed + BATCH_CHUNK_SIZE);
  for (let index = job.processed; index < end; index++) {
    job.batchResults.push(runBatchItem(job.program, job.items[index], index));
  }
  job.processed = end;

  if (job.processed < job.items.length) {
    render(captureFocus());
    batchTimer = window.setTimeout(() => runBatchChunk(job), 0);
    return;
  }

  job.status = "complete";
  job.durationMs = performance.now() - job.started;
  job.batchSummary = finalBatchSummary(job.items.length, job.batchResults);
  render(captureFocus());
}

function isSavedRuleCheck() {
  return !!state.loadedRule;
}

function startBatchJob({ key, items, result, program, started }) {
  batchJobId += 1;
  window.clearTimeout(batchTimer);
  const job = {
    id: batchJobId,
    key,
    items,
    result,
    program,
    started,
    startedAt: Date.now(),
    processed: 0,
    batchResults: [],
    batchSummary: null,
    durationMs: 0,
    status: "processing",
  };
  state.batchJob = job;
  batchTimer = window.setTimeout(() => runBatchChunk(job), 0);
  return batchProgressEvaluation(job);
}

function evaluateBatch(items, started) {
  const key = batchInputKey();
  if (state.batchJob?.key === key) {
    const job = state.batchJob;
    if (job.status === "complete") {
      return {
        result: job.result,
        error: null,
        durationMs: job.durationMs,
        batch: true,
        batchResults: job.batchResults,
        batchSummary: job.batchSummary,
      };
    }
    return batchProgressEvaluation(job);
  }

  if (!items.length) {
    return {
      result: null,
      error: null,
      durationMs: performance.now() - started,
      batch: true,
      batchResults: null,
      batchSummary: {
        total: 0,
        status: "invalid",
        message: "Batch input is empty. Paste an array with at least one object.",
      },
    };
  }

  const invalid = invalidBatchItems(items);
  if (invalid.length) {
    const positions = invalid.slice(0, 8).map(item => `${item.index} (${item.type})`).join(", ");
    const suffix = invalid.length > 8 ? `, and ${invalid.length - 8} more` : "";
    return {
      result: null,
      error: null,
      durationMs: performance.now() - started,
      batch: true,
      batchResults: null,
      batchSummary: {
        total: items.length,
        status: "invalid",
        message: `Array items must be objects. Found non-object items at positions ${positions}${suffix}.`,
      },
    };
  }

  if (items.length > MAX_BATCH) {
    return {
      result: null,
      error: null,
      durationMs: performance.now() - started,
      batch: true,
      batchResults: null,
      batchSummary: {
        total: items.length,
        status: "too-large",
        message: `Batch limited to ${MAX_BATCH.toLocaleString()} records. Split the input and run it in parts.`,
      },
    };
  }

  const ruleResult = runJsonTransform(parseTaskWithNewInput(items[0]));
  if (ruleResult.status !== "safe") {
    return {
      result: ruleResult,
      error: null,
      durationMs: performance.now() - started,
      batch: true,
      batchResults: null,
      batchSummary: {
        total: items.length,
        status: ruleResult.status,
        message: "Rule needs review. Resolve the diagnosis before running the batch.",
      },
    };
  }

  const program = ruleResult.rule?.program || { ops: [] };
  if (items.length > MAX_INSTANT_BATCH) {
    return startBatchJob({ key, items, result: ruleResult, program, started });
  }

  const batchResults = items.map((item, index) => runBatchItem(program, item, index));
  state.batchProgress = null;
  return {
    result: ruleResult,
    error: null,
    durationMs: performance.now() - started,
    batch: true,
    batchResults,
    batchSummary: finalBatchSummary(items.length, batchResults),
  };
}

function evaluateTransformBatch(items, ruleResult, started) {
  const key = batchInputKey();
  if (state.batchJob?.key === key) {
    const job = state.batchJob;
    if (job.status === "complete") {
      return {
        result: job.result,
        error: null,
        durationMs: job.durationMs,
        batch: true,
        batchResults: job.batchResults,
        batchSummary: job.batchSummary,
      };
    }
    return batchProgressEvaluation(job);
  }

  if (!items.length) {
    return {
      result: null,
      error: null,
      durationMs: performance.now() - started,
      batch: true,
      batchResults: null,
      batchSummary: {
        total: 0,
        status: "invalid",
        message: "Batch input is empty. Paste at least one record.",
      },
    };
  }

  const invalid = invalidBatchItems(items);
  if (invalid.length) {
    const positions = invalid.slice(0, 8).map(item => `${item.index} (${item.type})`).join(", ");
    const suffix = invalid.length > 8 ? `, and ${invalid.length - 8} more` : "";
    return {
      result: null,
      error: null,
      durationMs: performance.now() - started,
      batch: true,
      batchResults: null,
      batchSummary: {
        total: items.length,
        status: "invalid",
        message: `Batch records must be objects. Found non-object items at positions ${positions}${suffix}.`,
      },
    };
  }

  if (items.length > MAX_BATCH) {
    return {
      result: null,
      error: null,
      durationMs: performance.now() - started,
      batch: true,
      batchResults: null,
      batchSummary: {
        total: items.length,
        status: "too-large",
        message: `Batch limited to ${MAX_BATCH.toLocaleString()} records. Split the input and run it in parts.`,
      },
    };
  }

  if (ruleResult.status !== "safe") {
    return {
      result: ruleResult,
      error: null,
      durationMs: performance.now() - started,
      batch: true,
      batchResults: null,
      batchSummary: {
        total: items.length,
        status: ruleResult.status,
        message: "Rule needs review. Resolve the diagnosis before running the batch.",
      },
    };
  }

  const program = ruleResult.rule?.program || { ops: [] };
  if (items.length > MAX_INSTANT_BATCH) {
    return startBatchJob({ key, items, result: ruleResult, program, started });
  }

  const batchResults = items.map((item, index) => runBatchItem(program, item, index));
  state.batchProgress = null;
  return {
    result: ruleResult,
    error: null,
    durationMs: performance.now() - started,
    batch: true,
    batchResults,
    batchSummary: finalBatchSummary(items.length, batchResults),
  };
}

function finishEvaluation(transformTask, result, started) {
  if (transformTask.applyAsBatch) return evaluateTransformBatch(transformTask.newInput, result, started);
  return { result, error: null, durationMs: performance.now() - started, batch: false };
}

function evaluate() {
  if (!completedExamples().length) return { result: null, error: null, durationMs: 0 };
  const started = performance.now();
  try {
    const rawTask = parseTask();
    const transformTask = buildTransformTask(rawTask);
    const result = runBuiltTransform(rawTask, transformTask, { applyBatch: false });
    return finishEvaluation(transformTask, result, started);
  } catch (error) {
    return { result: null, error: error.message, durationMs: performance.now() - started, batch: false };
  }
}

async function evaluateInBackground() {
  if (!completedExamples().length) return { result: null, error: null, durationMs: 0 };
  const started = performance.now();
  try {
    const rawTask = parseTask();
    const transformTask = buildTransformTask(rawTask);
    const result = await inferTransform(rawTask, transformTask);
    return finishEvaluation(transformTask, result, started);
  } catch (error) {
    return { result: null, error: error.message, durationMs: performance.now() - started, batch: false };
  }
}

function currentEvaluation() {
  if (!state.examples.length) return { result: null, error: null, durationMs: 0, batch: false };
  if (!state.hasPendingChanges && state.evaluation?.batch && state.batchJob) {
    state.evaluation = batchProgressEvaluation(state.batchJob);
    if (state.batchJob.status === "complete") {
      state.transformNotice = `${isSavedRuleCheck() ? "Check" : "Transform"} complete for ${state.batchJob.items.length} records.`;
    }
  }
  return state.evaluation || { result: null, error: null, durationMs: 0, batch: false };
}

async function runCurrentTransform() {
  const checking = isSavedRuleCheck();
  const requestId = ++transformRequestId;
  state.transformBusy = true;
  state.transformNotice = checking ? "Checking payload in the background..." : "Inferring the transform in the background...";
  render(captureFocus());
  const evaluation = await evaluateInBackground();
  if (requestId !== transformRequestId) return;
  state.transformBusy = false;
  state.evaluation = evaluation;
  state.hasPendingChanges = false;
  state.outputPreviewMode = "preview";
  if (evaluation.error) {
    state.transformNotice = checking ? "Check blocked. See the result panel." : "Transform blocked. Check the message in the result panel.";
  } else if (evaluation.batch) {
    const summary = evaluation.batchSummary || {};
    state.transformNotice = summary.status === "processing"
      ? `${checking ? "Check" : "Transform"} started for ${summary.total || 0} records.`
      : `${checking ? "Check" : "Transform"} complete for ${summary.total || 0} records.`;
  } else if (evaluation.result) {
    state.transformNotice = checking ? `Payload checked in ${formatDuration(evaluation.durationMs)}.` : `Transform complete in ${formatDuration(evaluation.durationMs)}.`;
  } else {
    state.transformNotice = checking ? "Load a saved rule before checking." : "Add completed examples before transforming.";
  }
  render(captureFocus());
}

function transformStep(evaluation) {
  const hasExamples = completedExamples().length > 0;
  const pending = state.hasPendingChanges;
  const result = evaluation?.result;
  const summary = evaluation?.batchSummary;
  const isProcessing = state.transformBusy || summary?.status === "processing";
  const checking = isSavedRuleCheck();
  const notice = pending
    ? checking ? "Ready to check this payload against the saved rule." : "Ready to transform with the latest input."
    : state.transformNotice || (result || evaluation?.error ? checking ? "Latest check is shown below." : "Latest transform is shown below." : checking ? "Paste a payload and run the check." : "Run the transform when examples and input are ready.");
  const tone = pending ? "warn" : evaluation?.error ? "danger" : result ? "safe" : "muted";
  return `<div class="transform-step">
    <button class="button is-primary" type="button" data-run-transform title="${checking ? "Run check" : "Run evaluation"} (Cmd/Ctrl+Enter)" ${hasExamples || result ? state.transformBusy ? "disabled" : "" : "disabled"}>${isProcessing ? (checking ? "Checking" : "Transforming") : (checking ? "Check" : "Transform")}</button>
    <p class="transform-feedback is-${esc(tone)}" aria-live="polite" role="status">${esc(notice)}</p>
  </div>`;
}

function valuesEqual(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function outputsEquivalent(actualText, expectedText, outputFormat = "json") {
  const actual = String(actualText ?? "");
  const expected = String(expectedText ?? "");
  if (actual.trim() === expected.trim()) return true;

  const format = outputFormat === "auto" ? "json" : outputFormat;
  if (!FORMATS[format]) return false;

  try {
    return valuesEqual(
      parseWithFormat(actual, format),
      parseWithFormat(expected, format),
    );
  } catch {
    return false;
  }
}

function evaluateTests() {
  if (!completedExamples().length) return [];
  return state.tests.map((test, index) => {
    if (!test.input.trim() || !test.output.trim()) return { index, status: "draft" };
    try {
      const result = runTransform({ ...parseTask(), newInput: test.input });
      const predicted = result.serializedOutput || pretty(result.output);
      const passed = outputsEquivalent(predicted, test.output, result.outputFormat || state.outputFormat || "json");
      return { index, status: passed ? "passed" : "failed", passed, output: predicted, expected: test.output };
    } catch (error) {
      return { index, status: "invalid", error: error.message };
    }
  });
}

function testSummary(results = evaluateTests()) {
  const runnable = results.filter(item => item.status === "passed" || item.status === "failed");
  const passed = runnable.filter(item => item.status === "passed").length;
  return { total: state.tests.length, runnable: runnable.length, passed };
}

const {
  batchStatusMeta,
  cliExportDetails,
  cliExportPreviewModal,
  formatDuration,
  inspectionStatusData,
  inspectionStatusHtml,
  mainFlow,
  ruleSpecSummary,
  statusMeta,
} = createRenderHelpers({
  state,
  samples,
  sampleGroups,
  DEFAULT_SAMPLE_GROUP_ID,
  BATCH_PREVIEW_LIMIT,
  BATCH_ISSUE_LIMIT,
  detectFormat,
  isSupportedDataFormat,
  formatLabel,
  editorRows,
  formatNote,
  formatDiagnosticHtml,
  suggestionHint,
  completedExamples,
  testSummary,
  evaluateTests,
  dataInputNote,
  inputOnlyAnalysis,
  isSavedRuleCheck,
  fileImportPanel,
  transformStep,
  batchIssueRows,
  batchExportOutputs,
  pretty,
  filenameSlug,
});

function render(focusTarget = state.focusAfterRender) {
  state.presetGroupScrollLeft = document.querySelector(".preset-groups")?.scrollLeft ?? state.presetGroupScrollLeft ?? 0;
  updateSmartSuggestions();
  const evaluation = currentEvaluation();
  const { result, error } = evaluation;
  const baseMeta = evaluation.batch ? batchStatusMeta(evaluation) : statusMeta(result, error);
  const meta = state.hasPendingChanges && completedExamples().length
    ? isSavedRuleCheck()
      ? { key: "pending-check", label: "Ready to check", tone: "warn", brand: "Ready to check" }
      : { key: "pending", label: "Pending changes", tone: "warn", brand: "Pending changes" }
    : baseMeta;
  const stateChanged = !!state.lastStatusKey && state.lastStatusKey !== meta.key && ["ambiguous", "contradictory", "unsafe"].includes(meta.key);
  state.lastStatusKey = meta.key;
  const inspectionData = inspectionStatusData(evaluation, meta);
  const inspectionKey = JSON.stringify(inspectionData);
  const inspectionChanged = !!state.lastInspectionKey && state.lastInspectionKey !== inspectionKey;
  state.lastInspectionKey = inspectionKey;
  app.innerHTML = `<section class="app-shell">
    <header class="tool-header">
      <p class="section-label">Infer</p>
      <h1>Infer Data Transformation Rules from Examples</h1>
      <p class="tool-subhead">Give an example of the data you have and the data you want. Inspect the rule before you use it.</p>
    </header>
    ${mainFlow(evaluation, stateChanged)}
    ${inspectionStatusHtml(inspectionData, { cardChanged: inspectionChanged || stateChanged, textChanged: inspectionChanged })}
    ${cliExportPreviewModal(result, evaluation)}
  </section>`;
  restorePresetGroupScroll();
  restoreFocus(focusTarget);
  state.focusAfterRender = null;
}

function restorePresetGroupScroll() {
  const groups = document.querySelector(".preset-groups");
  if (!groups || !state.presetGroupScrollLeft) return;
  groups.scrollLeft = state.presetGroupScrollLeft;
}

function captureFocus() {
  const active = document.activeElement;
  if (!active?.matches?.("textarea")) return null;
  const selector = active.dataset.example !== undefined
    ? `[data-example="${active.dataset.example}"][data-side="${active.dataset.side}"]`
    : active.dataset.test !== undefined
      ? `[data-test="${active.dataset.test}"][data-side="${active.dataset.side}"]`
    : active.dataset.tryInput !== undefined
      ? "[data-try-input]"
      : active.dataset.outputEditor !== undefined
        ? "[data-output-editor]"
        : "";
  return selector ? { selector, start: active.selectionStart, end: active.selectionEnd } : null;
}

function restoreFocus(target) {
  if (!target?.selector) return;
  const field = document.querySelector(target.selector);
  if (!field) return;
  field.focus();
  if (Number.isFinite(target.start) && Number.isFinite(target.end)) field.setSelectionRange(target.start, target.end);
}

function editorSelectorForId(editorId) {
  if (editorId === "try") return "[data-try-input]";
  const match = String(editorId || "").match(/^example-(\d+)-(input|output)$/);
  if (!match) return "";
  return `[data-example="${match[1]}"][data-side="${match[2]}"]`;
}

function editorFormatForId(editorId) {
  if (editorId === "try") return state.inputFormat || "auto";
  const match = String(editorId || "").match(/^example-(\d+)-(input|output)$/);
  if (!match) return "auto";
  const example = state.examples[Number(match[1])];
  return match[2] === "input" ? example?.inputFormat || "auto" : example?.outputFormat || "auto";
}

function getEditorValue(editorId) {
  if (editorId === "try") return state.tryInput;
  const match = String(editorId || "").match(/^example-(\d+)-(input|output)$/);
  if (!match) return "";
  return state.examples[Number(match[1])]?.[match[2]] || "";
}

function setEditorValue(editorId, value) {
  if (editorId === "try") {
    state.tryInput = value;
    return true;
  }
  const match = String(editorId || "").match(/^example-(\d+)-(input|output)$/);
  if (!match) return false;
  const example = state.examples[Number(match[1])];
  if (!example) return false;
  example[match[2]] = value;
  return true;
}

function setEditorFormat(editorId, format) {
  if (editorId === "try") {
    state.inputFormat = format;
    return true;
  }
  const match = String(editorId || "").match(/^example-(\d+)-(input|output)$/);
  if (!match) return false;
  const example = state.examples[Number(match[1])];
  if (!example) return false;
  example[match[2] === "input" ? "inputFormat" : "outputFormat"] = format;
  state.loadedRule = null;
  return true;
}

function applyFormatFix(editorId, fixId) {
  const current = getEditorValue(editorId);
  const fix = formatFixes(current, editorFormatForId(editorId)).find(item => item.id === fixId);
  if (!fix || !setEditorValue(editorId, fix.next)) return;
  if (likelyJsonText(fix.next) && canParseAs(fix.next, "json")) setEditorFormat(editorId, "json");
  else {
    const detected = detectFormat(fix.next);
    if (isSupportedDataFormat(detected) && canParseAs(fix.next, detected)) setEditorFormat(editorId, detected);
  }
  if (editorId === "try") markPayloadChanged();
  else markTeachingChanged();
  const selector = editorSelectorForId(editorId);
  render(selector ? { selector, start: fix.next.length, end: fix.next.length } : captureFocus());
}

function applySuggestedDraft() {
  const first = state.examples[0];
  const selected = state.smartSuggestions?.suggestions?.filter(suggestion => suggestion.defaultOn) || [];
  if (!first || !selected.length) return;

  try {
    const parsed = parseSuggestionInput(first);
    const transformed = applySuggestions(parsed, selected);
    const targetFormat = first.outputFormat && first.outputFormat !== "auto" ? first.outputFormat : "json";
    const output = serializeWithFormat(transformed, targetFormat);
    first.output = output;
    clearSmartSuggestions();
    markTeachingChanged();
    render({ selector: `[data-example="0"][data-side="output"]`, start: output.length, end: output.length });
  } catch {}
}

function scheduleRender() {
  state.focusAfterRender = captureFocus();
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => render(), RENDER_DEBOUNCE_MS);
}

function addExample(example = { input: "", output: "", inputFormat: "auto", outputFormat: "auto", correction: false }) {
  clearBatchJob();
  state.loadedRule = null;
  state.hasPendingChanges = true;
  state.activeSample = null;
  state.examples.push({ inputFormat: "auto", outputFormat: "auto", correction: false, ...example });
  const index = state.examples.length - 1;
  state.flashIndex = example.correction ? index : null;
  state.focusAfterRender = { selector: `[data-example="${index}"][data-side="output"]`, start: 0, end: example.output.length };
  render();
  window.requestAnimationFrame(() => {
    document.querySelector(`[data-example-card="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  if (state.flashIndex !== null) window.setTimeout(() => {
    state.flashIndex = null;
    render(captureFocus());
  }, 1000);
}

function startBlank() {
  clearBatchJob();
  state.activeSample = null;
  state.examples = [];
  state.tests = [];
  state.tryInput = "{\n}";
  state.inputFormat = "auto";
  state.outputFormat = "auto";
  state.correctionDraft = "";
  state.learningNotice = "";
  state.importNotice = null;
  state.loadedRule = null;
  state.evaluation = { result: null, error: null, durationMs: 0, batch: false };
  state.outputPreviewMode = "preview";
  state.transformNotice = "";
  addExample();
}

function showSampleGroup(id) {
  if (!sampleGroups[id]) return;
  state.presetGroupScrollLeft = document.querySelector(".preset-groups")?.scrollLeft ?? state.presetGroupScrollLeft ?? 0;
  state.activeSampleGroup = id;
  render();
}

function suggestedExampleDraft(result) {
  const suggestion = primarySuggestion(result);
  const input = safeJson(state.tryInput, {});
  const fields = suggestion?.fields?.length ? suggestion.fields : [suggestion?.field, suggestion?.requiredField].filter(Boolean);
  fields.slice(0, 3).forEach((field, index) => {
    setJsonPath(input, field, fields.length > 1 ? `value ${String.fromCharCode(65 + index)}` : "new value");
  });
  return {
    input: pretty(input),
    output: "{\n}",
    correction: false,
  };
}

function addSuggestedExample() {
  const { result } = currentEvaluation();
  if (!result) return addExample();
  state.learningNotice = "Example added.";
  addExample(suggestedExampleDraft(result));
}

function addCorrectionExample(result, correctedOutput = null) {
  const output = correctedOutput || state.correctionDraft || result.serializedOutput || pretty(result.output);
  state.correctionDraft = "";
  state.learningNotice = "Correction taught.";
  addExample({ input: state.tryInput, output, inputFormat: state.inputFormat || "auto", outputFormat: result.outputFormat || state.outputFormat || "auto", correction: true });
}

function applyOutputCorrection(path, rawValue) {
  if (state.hasPendingChanges) return;
  const { result } = currentEvaluation();
  if (!result?.output) return;
  const corrected = JSON.parse(JSON.stringify(result.output));
  const currentValue = getJsonPath(corrected, path);
  setJsonPath(corrected, path, parseInlineCorrectionValue(rawValue, currentValue));
  addCorrectionExample(result, serializeWithFormat(corrected, result.outputFormat || "json"));
}

function addTestCase() {
  if (state.hasPendingChanges) return;
  const { result } = currentEvaluation();
  if (!result?.output) return;
  const output = result.serializedOutput || pretty(result.output);
  state.tests.push({ input: state.tryInput, output });
  const index = state.tests.length - 1;
  state.learningNotice = "";
  state.focusAfterRender = { selector: `[data-test="${index}"][data-side="output"]`, start: 0, end: output.length };
  render();
}

function saveCurrentRule() {
  if (state.hasPendingChanges) return;
  const { result, error } = currentEvaluation();
  if (!result || error || result.status !== "safe") return;
  const saved = {
    id: `rule-${Date.now().toString(36)}`,
    name: result.rule?.title || "Saved transform",
    createdAt: new Date().toISOString(),
    operationCount: result.rule?.program?.ops?.length || 0,
    specSummary: ruleSpecSummary(result),
    examples: JSON.parse(JSON.stringify(state.examples)),
    tests: JSON.parse(JSON.stringify(state.tests)),
    tryInput: state.tryInput,
    inputFormat: state.inputFormat,
    outputFormat: state.outputFormat,
  };
  state.savedRules = [saved, ...state.savedRules.filter(item => item.name !== saved.name)].slice(0, 8);
  state.learningNotice = "Rule saved.";
  persistSavedRules();
  render(captureFocus());
}

function loadSavedRule(id) {
  const saved = state.savedRules.find(item => item.id === id);
  if (!saved) return;
  clearBatchJob();
  state.activeSample = null;
  state.examples = saved.examples.map(example => ({ ...example }));
  state.tests = (saved.tests || []).map(test => ({ ...test }));
  state.tryInput = saved.tryInput || "{\n}";
  state.inputFormat = saved.inputFormat || "auto";
  state.outputFormat = saved.outputFormat || "auto";
  state.correctionDraft = "";
  state.learningNotice = "Saved rule loaded.";
  state.importNotice = null;
  state.openDetails = {};
  state.flashIndex = null;
  state.loadedRule = { id: saved.id, name: saved.name };
  state.outputPreviewMode = "preview";
  state.transformNotice = "Saved rule loaded. Paste a payload to check.";
  state.evaluation = evaluate();
  state.hasPendingChanges = false;
  render();
}

function deleteSavedRule(id) {
  state.savedRules = state.savedRules.filter(item => item.id !== id);
  persistSavedRules();
  render(captureFocus());
}

async function copyValue(kind) {
  if (state.hasPendingChanges) return;
  const evaluation = currentEvaluation();
  const { result, error } = evaluation;
  if (kind === "batch-output" && evaluation.batchResults?.length) {
    try {
      await navigator.clipboard.writeText(serializeWithFormat(batchExportOutputs(evaluation.batchResults), result?.outputFormat || "json"));
      state.copied = kind;
    } catch {
      state.copied = "batch-too-large";
    }
    render(captureFocus());
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      state.copied = null;
      render(captureFocus());
    }, 1500);
    return;
  }
  if (!result || error) return;
  const value = kind === "output"
    ? result.serializedOutput || pretty(result.output)
    : kind === "rule"
      ? pretty(result.rule.program)
      : kind === "make"
        ? generateMakeCode(result)
        : kind === "plain-js"
          ? generatePlainFunction(result)
          : kind === "js"
            ? generateJavaScriptTransform(result)
            : generateN8nCode(result);
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const selector = kind === "output" ? "[data-output-editor]" : null;
    const field = selector ? document.querySelector(selector) : null;
    if (field) {
      field.focus();
      field.select();
    }
  }
  state.copied = kind;
  render(captureFocus());
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    state.copied = null;
    render(captureFocus());
  }, 1500);
}

function currentShareState() {
  return {
    examples: state.examples.map(example => ({
      input: example.input,
      output: example.output,
      inputFormat: example.inputFormat || "auto",
      outputFormat: example.outputFormat || "auto",
      correction: !!example.correction,
    })),
    tryInput: state.tryInput,
    inputFormat: state.inputFormat || "auto",
    outputFormat: state.outputFormat || "auto",
  };
}

async function shareCurrentState() {
  try {
    const url = await shareUrlForState(currentShareState());
    if (!await writeClipboardText(url)) throw new Error("The share link could not be copied.");
    state.copied = "share";
    state.transformNotice = "Share link copied.";
    render(captureFocus());
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      state.copied = null;
      render(captureFocus());
    }, 1500);
  } catch (error) {
    state.transformNotice = error?.message || "The share link could not be created.";
    render(captureFocus());
  }
}

function applySharedState(shared) {
  if (!shared || !Array.isArray(shared.examples) || !shared.examples.length) throw new Error("This share link does not contain teaching examples.");
  clearBatchJob();
  state.activeSample = null;
  state.examples = shared.examples.map(example => ({
    input: String(example?.input ?? ""),
    output: String(example?.output ?? ""),
    inputFormat: String(example?.inputFormat || "auto"),
    outputFormat: String(example?.outputFormat || "auto"),
    correction: !!example?.correction,
  }));
  state.tests = [];
  state.tryInput = String(shared.tryInput ?? "{\n}");
  state.inputFormat = String(shared.inputFormat || "auto");
  state.outputFormat = String(shared.outputFormat || "auto");
  state.loadedRule = null;
  state.correctionDraft = "";
  state.learningNotice = "";
  state.importNotice = null;
  state.openDetails = {};
  state.evaluation = evaluate();
  state.hasPendingChanges = false;
  state.transformNotice = "Shared rule restored from this URL.";
}

function downloadBlobText(text, filename, mimeType = "text/plain") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function filenameSlug(value, fallback = "transform") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

function downloadFormatted(value, filenamePrefix, outputFormat = "json") {
  const format = FORMATS[outputFormat] || FORMATS.json;
  const text = typeof value === "string" ? value : serializeWithFormat(value, format.id);
  downloadBlobText(text, `${filenamePrefix}-${Date.now()}.${format.fileExtension}`, format.mimeType);
}

function downloadOutputResult() {
  if (state.hasPendingChanges) return;
  const { result, error } = currentEvaluation();
  if (!result || error || result.status !== "safe") return;
  downloadFormatted(result.serializedOutput || result.output, "latentmachine-output", result.outputFormat || "json");
}

function downloadBatchResults() {
  if (state.hasPendingChanges) return;
  const { result, batchResults } = currentEvaluation();
  if (!batchResults?.length) return;
  downloadFormatted(batchExportOutputs(batchResults), "latentmachine-batch", result?.outputFormat || "json");
}

function downloadBatchReport() {
  if (state.hasPendingChanges) return;
  const { batchResults, batchSummary } = currentEvaluation();
  if (!batchResults?.length) return;
  downloadFormatted({ summary: batchSummary, records: batchResults }, "latentmachine-batch-report", "json");
}

function downloadJavaScript() {
  if (state.hasPendingChanges) return;
  const { result, error } = currentEvaluation();
  if (!result || error) return;
  const blob = new Blob([generatePlainFunction(result)], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "transform.js";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadCLIExport() {
  if (state.hasPendingChanges) return;
  const { result, error, batch, batchResults } = currentEvaluation();
  if (!result || error || result.status !== "safe") return;
  try {
    const filename = cliExportDetails(result, currentEvaluation()).filename;
    const sampleOutput = batch && batchResults?.length ? batchExportOutputs(batchResults) : result.output;
    downloadBlobText(generateCLIExport(result, { filename, sampleInputText: state.tryInput, sampleOutput }), filename, "text/javascript");
    state.transformNotice = `CLI export downloaded. Run node ${filename} --readme or --self-test.`;
    state.cliExportPreview = false;
  } catch (caught) {
    state.transformNotice = caught?.message || "CLI export is not available for this rule yet.";
  }
  render(captureFocus());
}

function openCLIExportPreview() {
  if (state.hasPendingChanges) return;
  const { result, error } = currentEvaluation();
  if (!result || error) return;
  state.cliExportPreview = true;
  render(captureFocus());
}

function closeCLIExportPreview() {
  state.cliExportPreview = false;
  render(captureFocus());
}

function isTypingTarget(target) {
  const field = target?.closest?.("textarea, input, select, [contenteditable='true']");
  return !!field;
}

function hasOpenDetails() {
  return Object.values(state.openDetails || {}).some(Boolean);
}

function closeOpenPanels() {
  const hadPanels = state.cliExportPreview || hasOpenDetails();
  if (!hadPanels) return false;
  state.cliExportPreview = false;
  state.openDetails = {};
  render(captureFocus());
  return true;
}

function copyCurrentOutput() {
  const evaluation = currentEvaluation();
  const kind = evaluation.batch ? "batch-output" : "output";
  return copyValue(kind);
}

async function copyCLICommand(command) {
  state.copied = await writeClipboardText(command) ? "cli-command" : null;
  render(captureFocus());
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    state.copied = null;
    render(captureFocus());
  }, 1500);
}

async function importDataFileList(files) {
  const list = Array.from(files || []);
  if (list.length !== 1) {
    state.importNotice = { tone: "danger", text: "Choose one JSON, XML, CSV, TOML, SQL INSERT, YAML, or .env file." };
    return render(captureFocus());
  }

  const file = list[0];
  const fileValidation = validateImportFile(file);
  if (!fileValidation.ok) {
    state.importNotice = fileValidation;
    return render(captureFocus());
  }

  try {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    const unsafeReason = unsafeTextReason(text);
    if (unsafeReason) {
      state.importNotice = { tone: "danger", text: unsafeReason };
      return render(captureFocus());
    }

    state.tryInput = text;
    state.inputFormat = fileValidation.format;
    state.importNotice = { tone: "safe", text: `Imported ${file.name}.` };
    markPayloadChanged();
    render({ selector: "[data-try-input]", start: 0, end: 0 });
  } catch {
    state.importNotice = { tone: "danger", text: "Could not read this file as text." };
    render(captureFocus());
  }
}

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

app.addEventListener("dragover", event => {
  const dropZone = event.target.closest("[data-file-drop]");
  if (!dropZone || !hasDraggedFiles(event)) return;
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

app.addEventListener("dragleave", event => {
  const dropZone = event.target.closest("[data-file-drop]");
  if (!dropZone) return;
  dropZone.classList.remove("is-dragging");
});

app.addEventListener("drop", event => {
  const dropZone = event.target.closest("[data-file-drop]");
  if (!dropZone || !hasDraggedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.remove("is-dragging");
  importDataFileList(event.dataTransfer?.files);
});

document.addEventListener("dragover", event => {
  if (hasDraggedFiles(event)) event.preventDefault();
});

document.addEventListener("drop", event => {
  if (hasDraggedFiles(event)) event.preventDefault();
});

app.addEventListener("change", event => {
  const fileInput = event.target.closest("[data-file-input]");
  if (fileInput) {
    importDataFileList(fileInput.files);
    fileInput.value = "";
    return;
  }

  const previewMode = event.target.closest("[data-output-preview-mode]");
  if (previewMode) {
    state.outputPreviewMode = previewMode.value === "all" ? "all" : "preview";
    return render(captureFocus());
  }

  const formatSelect = event.target.closest("[data-format-for]");
  if (!formatSelect) return;
  const editorId = formatSelect.dataset.formatFor;
  const value = formatSelect.value;

  if (editorId === "try") {
    state.inputFormat = value;
    markPayloadChanged();
  } else if (editorId.startsWith("example-") && editorId.endsWith("-input")) {
    const index = Number(editorId.split("-")[1]);
    if (state.examples[index]) state.examples[index].inputFormat = value;
    markTeachingChanged();
  } else if (editorId.startsWith("example-") && editorId.endsWith("-output")) {
    const index = Number(editorId.split("-")[1]);
    if (state.examples[index]) state.examples[index].outputFormat = value;
    markTeachingChanged();
  }

  render(captureFocus());
});

app.addEventListener("input", event => {
  const field = event.target.closest("[data-editor]");
  if (!field) return;
  if (field.dataset.example !== undefined) {
    const index = Number(field.dataset.example);
    state.examples[index][field.dataset.side] = field.value;
    markTeachingChanged();
    if (index === 0 && field.dataset.side === "output" && state.smartSuggestions) {
      clearSmartSuggestions();
      render(captureFocus());
      return;
    }
    scheduleRender();
    return;
  }
  if (field.dataset.test !== undefined) {
    const index = Number(field.dataset.test);
    state.tests[index][field.dataset.side === "input" ? "input" : "output"] = field.value;
    state.learningNotice = "";
    scheduleRender();
    return;
  }
  if (field.dataset.tryInput !== undefined) {
    state.tryInput = field.value;
    state.importNotice = null;
    markPayloadChanged();
    scheduleRender();
    return;
  }
  if (field.dataset.outputEditor !== undefined) {
    state.correctionDraft = field.value;
    state.learningNotice = "";
  }
});

app.addEventListener("click", event => {
  if (event.target.closest("[data-draft-output]")) return applySuggestedDraft();

  const formatFix = event.target.closest("[data-apply-format-fix]");
  if (formatFix) return applyFormatFix(formatFix.dataset.applyFormatFix, formatFix.dataset.fixId);

  const sample = event.target.closest("[data-sample]");
  if (sample) return loadSample(sample.dataset.sample);

  const sampleGroup = event.target.closest("[data-sample-group]");
  if (sampleGroup) return showSampleGroup(sampleGroup.dataset.sampleGroup);

  if (event.target.closest("[data-start-blank]")) return startBlank();

  if (event.target.closest("[data-add-example]")) return addExample();

  if (event.target.closest("[data-add-suggested-example]")) return addSuggestedExample();

  if (event.target.closest("[data-add-test]")) return addTestCase();

  const remove = event.target.closest("[data-remove-example]");
  if (remove) {
    state.examples.splice(Number(remove.dataset.removeExample), 1);
    if (!state.examples.length) {
      state.activeSample = null;
      state.activeSampleGroup = DEFAULT_SAMPLE_GROUP_ID;
      state.evaluation = { result: null, error: null, durationMs: 0, batch: false };
      state.hasPendingChanges = false;
      state.transformNotice = "";
      state.correctionDraft = "";
      state.learningNotice = "";
      state.importNotice = null;
      state.loadedRule = null;
      return render();
    }
    markTeachingChanged();
    return render();
  }

  const removeTest = event.target.closest("[data-remove-test]");
  if (removeTest) {
    state.tests.splice(Number(removeTest.dataset.removeTest), 1);
    state.learningNotice = "";
    return render(captureFocus());
  }

  if (event.target.closest("[data-clear]")) {
    clearBatchJob();
    state.examples = [];
    state.tests = [];
    state.tryInput = "{\n}";
    state.inputFormat = "auto";
    state.outputFormat = "auto";
    state.activeSample = null;
    state.activeSampleGroup = DEFAULT_SAMPLE_GROUP_ID;
    state.correctionDraft = "";
    state.learningNotice = "";
    state.importNotice = null;
    state.loadedRule = null;
    state.evaluation = { result: null, error: null, durationMs: 0, batch: false };
    state.hasPendingChanges = false;
    return render();
  }

  if (event.target.closest("[data-run-transform]")) return runCurrentTransform();

  const copy = event.target.closest("[data-copy]");
  if (copy) return copyValue(copy.dataset.copy);

  const cliCommand = event.target.closest("[data-copy-cli-command]");
  if (cliCommand) return copyCLICommand(cliCommand.dataset.copyCliCommand);

  if (event.target.closest("[data-download-output]")) return downloadOutputResult();

  if (event.target.closest("[data-download-batch]")) return downloadBatchResults();

  if (event.target.closest("[data-download-report]")) return downloadBatchReport();

  if (event.target.closest("[data-download-js]")) return downloadJavaScript();

  if (event.target.closest("[data-download-cli]")) return openCLIExportPreview();

  if (event.target.closest("[data-confirm-cli-export]")) return downloadCLIExport();

  if (event.target.closest("[data-close-cli-export]") && !event.target.closest("[data-cli-export-modal]")) return closeCLIExportPreview();

  if (event.target.closest("[data-close-cli-export]")) return closeCLIExportPreview();

  if (event.target.closest("[data-save-rule]")) return saveCurrentRule();

  if (event.target.closest("[data-share]")) return shareCurrentState();

  const loadRule = event.target.closest("[data-load-rule]");
  if (loadRule) return loadSavedRule(loadRule.dataset.loadRule);

  const deleteRule = event.target.closest("[data-delete-rule]");
  if (deleteRule) return deleteSavedRule(deleteRule.dataset.deleteRule);

  const correction = event.target.closest("[data-output-correction]");
  if (correction) {
    const input = correction.closest(".output-correction-row")?.querySelector("[data-output-correction-value]");
    return applyOutputCorrection(correction.dataset.outputCorrection, input?.value ?? "");
  }

  if (event.target.closest("[data-fix-output]")) {
    const { result } = currentEvaluation();
    if (!result) return;
    return addCorrectionExample(result);
  }
});

app.addEventListener("keydown", event => {
  const commandKey = event.metaKey || event.ctrlKey;
  const typing = isTypingTarget(event.target);
  if (commandKey && event.key === "Enter") {
    event.preventDefault();
    return runCurrentTransform();
  }
  if (!typing && commandKey && event.shiftKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    return copyCurrentOutput();
  }
  if (!typing && commandKey && event.shiftKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    return saveCurrentRule();
  }
  if (!typing && event.key === "Escape" && closeOpenPanels()) {
    event.preventDefault();
    return;
  }

  const correction = event.target.closest("[data-output-correction-value]");
  if (correction && event.key === "Enter") {
    event.preventDefault();
    return applyOutputCorrection(correction.dataset.outputCorrectionValue, correction.value);
  }

  const field = event.target.closest("[data-editor]");
  if (!field) return;
  if (event.key === "Tab") {
    event.preventDefault();
    const start = field.selectionStart;
    const end = field.selectionEnd;
    field.value = `${field.value.slice(0, start)}  ${field.value.slice(end)}`;
    field.setSelectionRange(start + 2, start + 2);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
});

app.addEventListener("toggle", event => {
  const detail = event.target.closest("[data-detail]");
  if (!detail) return;
  state.openDetails[detail.dataset.detail] = detail.open;
}, true);

async function initialize() {
  try {
    const shared = await sharedStateFromLocation();
    if (shared) applySharedState(shared);
    else applySample(DEFAULT_DEMO_SAMPLE_ID, { evaluateNow: true });
  } catch (error) {
    applySample(DEFAULT_DEMO_SAMPLE_ID, { evaluateNow: true });
    state.transformNotice = error?.message || "This share link could not be restored.";
  }
  render();
}

initialize();
