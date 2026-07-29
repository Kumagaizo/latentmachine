import { analyzeSignal } from "../intelligence/signal/engine.js";
import { createEvidencePack, explainSignalSegment } from "../intelligence/signal/explain.js";
import { SIGNAL_LIMITS } from "../intelligence/signal/normalize.js";
import { formatBytes, unsafeTextReason } from "./file-import.js";
import { esc, plural } from "./shared.js";

const mount = document.querySelector("#signal");
const PAGE_SIZE = 220;
const ROLE_LABELS = {
  "pattern-break": "pattern break",
  repeated: "repeated",
  constraint: "constraint",
  exception: "exception",
  decision: "decision",
  definition: "definition",
  failure: "failure",
  warning: "warning",
  example: "example",
  context: "context",
  uncertain: "uncertain",
};

const PRESETS = {
  pipeline: {
    name: "pipeline-run.log",
    label: "Pipeline log",
    mode: "stream",
    text: [
      ...Array.from({ length: 12 }, (_, index) => `2026-07-29T08:14:${String(index).padStart(2, "0")}Z INFO model stg_events batch ${4100 + index} completed in ${82 + index}ms`),
      "2026-07-29T08:14:12Z WARN model dim_customers batch 4112 skipped 18 rows with missing region_code",
      ...Array.from({ length: 5 }, (_, index) => `2026-07-29T08:14:${13 + index}Z INFO model stg_events batch ${4113 + index} completed in ${96 + index}ms`),
      "2026-07-29T08:14:18Z FATAL model fct_orders batch 4118 rollback after 901ms table=customer_events",
      "2026-07-29T08:14:19Z INFO cleanup batch 4118 completed in 44ms",
    ].join("\n"),
  },
  migration: {
    name: "account-migration.txt",
    label: "Migration report",
    mode: "stream",
    text: [
      "Migration report · customer_accounts · dry run",
      ...Array.from({ length: 9 }, (_, index) => `row ${1001 + index}: migrated acct_${1001 + index} · 8 fields mapped`),
      "row 1010: rejected acct_1010 · region_code is missing",
      "row 1011: partial migration acct_1011 · fallback owner applied",
      ...Array.from({ length: 5 }, (_, index) => `row ${1012 + index}: migrated acct_${1012 + index} · 8 fields mapped`),
      "Summary: 14 migrated, 1 partial, 1 rejected",
    ].join("\n"),
  },
  contract: {
    name: "event-contract.md",
    label: "Data contract",
    mode: "document",
    text: [
      "# Customer event contract",
      "",
      "`event_id` means the immutable identifier for one accepted event.",
      "`event_id` must be a non-empty UUID.",
      "`occurred_at` must use UTC.",
      "Payload size must be <= 256 KB.",
      "Events must not contain raw payment card data.",
      "",
      "## Replay exception",
      "",
      "However, replay events may override `occurred_at` when `replay_reason` is present.",
      "The decision is to retain rejected events for 30 days.",
      "Customer records must not leave the approved region.",
      "Customer records must not leave the approved region.",
    ].join("\n"),
  },
};

const state = {
  text: "",
  name: "Untitled artifact",
  mode: "auto",
  result: null,
  busy: false,
  progress: "",
  forceLineAnalysis: false,
  activeSegmentId: null,
  pinned: new Set(),
  filter: "all",
  role: "all",
  query: "",
  page: 0,
  showPack: false,
  pack: {
    includeAttention: true,
    includeNotable: false,
    includeRepresentatives: false,
    contextLines: 1,
    reviewed: false,
  },
  settings: {
    localWindow: 4,
    includeCompressionNovelty: true,
    minimumTemplateGroup: 2,
  },
  announcement: "",
  worker: null,
  workerReject: null,
  runId: 0,
};

function roleBadge(role) {
  return `<span class="signal-role is-${esc(role)}">${esc(ROLE_LABELS[role] || role)}</span>`;
}

function levelRank(level) {
  return level === "attention" ? 3 : level === "notable" ? 2 : 1;
}

function filteredSegments() {
  if (!state.result || state.result.status !== "ready") return [];
  const query = state.query.trim().toLowerCase();
  return state.result.segments.filter(segment => {
    if (segment.blank) return state.filter === "all" && state.role === "all" && !query;
    if (state.filter === "attention" && segment.level !== "attention") return false;
    if (state.filter === "notable" && levelRank(segment.level) < 2) return false;
    if (state.filter === "pinned" && !state.pinned.has(segment.id)) return false;
    if (state.role !== "all" && !segment.roles.includes(state.role)) return false;
    if (query && !`${segment.text} ${segment.templateSignature} ${segment.roles.join(" ")}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

function pageSegments() {
  const filtered = filteredSegments();
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.page = Math.min(state.page, pageCount - 1);
  return {
    filtered,
    pageCount,
    rows: filtered.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE),
  };
}

function inputSummary() {
  const bytes = new TextEncoder().encode(state.text).length;
  const lines = state.text ? state.text.replace(/\r\n?/g, "\n").split("\n").length : 0;
  return `${plural(lines, "line")} · ${formatBytes(bytes)} · local only`;
}

function renderInput() {
  return `
    <section class="signal-input-card" aria-label="Artifact input">
      <div class="signal-input-head">
        <div>
          <span>Artifact</span>
          <strong>${esc(state.name)}</strong>
        </div>
        <label>
          <span>Analysis mode</span>
          <select data-signal-mode>
            <option value="auto" ${state.mode === "auto" ? "selected" : ""}>Auto</option>
            <option value="stream" ${state.mode === "stream" ? "selected" : ""}>Stream</option>
            <option value="document" ${state.mode === "document" ? "selected" : ""}>Document</option>
          </select>
        </label>
      </div>
      <textarea data-signal-input spellcheck="false" aria-label="Log, report, or specification text" placeholder="Paste a log, report, specification, console transcript, or other line-oriented text…">${esc(state.text)}</textarea>
      <div class="signal-input-foot">
        <span>${esc(inputSummary())}</span>
        <div>
          <label class="button is-subtle is-small">
            Import file
            <input class="visually-hidden" type="file" data-signal-file accept=".txt,.log,.md,.markdown,.out,.sql,.jsonl,.csv,.tsv,.yaml,.yml,.xml" />
          </label>
          <button class="button is-subtle is-small" type="button" data-clear-signal ${!state.text ? "disabled" : ""}>Clear</button>
        </div>
      </div>
      <details class="signal-settings">
        <summary>Method settings</summary>
        <div>
          <label>Local window <input type="number" min="2" max="12" value="${state.settings.localWindow}" data-signal-setting="localWindow" /></label>
          <label>Minimum cluster <input type="number" min="2" max="20" value="${state.settings.minimumTemplateGroup}" data-signal-setting="minimumTemplateGroup" /></label>
          <label><input type="checkbox" ${state.settings.includeCompressionNovelty ? "checked" : ""} data-signal-setting="includeCompressionNovelty" /> Compression novelty</label>
        </div>
        <p>Compression novelty estimates byte-level predictability from a bounded rolling context. It is order-sensitive, down-weighted for short lines, and never creates a finding by itself.</p>
      </details>
      <div class="signal-runbar">
        <button class="button is-primary" type="button" data-run-signal ${state.busy || !state.text.trim() ? "disabled" : ""}>${state.busy ? "Analyzing…" : "Analyze artifact →"}</button>
        ${state.busy ? `<button class="button is-subtle" type="button" data-cancel-signal>Cancel</button>` : ""}
        <span data-signal-progress>${esc(state.busy ? state.progress || "preparing local analysis" : "No data leaves this browser.")}</span>
      </div>
    </section>
  `;
}

function renderRouting() {
  const warning = state.result?.warnings?.find(item => item.type === "structured-data");
  if (!warning) return "";
  return `
    <section class="signal-route-notice" aria-labelledby="signal-route-title">
      <div>
        <p class="section-label">A better fit may exist</p>
        <h2 id="signal-route-title">This looks like structured ${esc(state.result.routing?.format || "data")}.</h2>
        <p>Trace can profile fields, records, missingness, distributions, and schema drift. Signal can continue only when you explicitly want a line-oriented reading.</p>
      </div>
      <div class="signal-route-actions">
        <a class="button is-primary" href="/trace">Open in Trace →</a>
        <button class="button is-subtle" type="button" data-force-signal>Analyze as text anyway</button>
      </div>
    </section>
  `;
}

function renderMetrics(result) {
  const metrics = [
    ["Lines", result.source.lines],
    ["Unique templates", result.summary.uniqueTemplates],
    ["Repeated share", `${Math.round(result.summary.repeatedShare * 100)}%`],
    ["Pattern breaks", result.summary.patternBreaks],
    ["Constraints + exceptions", result.summary.constraintsAndExceptions],
    ["Failures + warnings", result.summary.failuresAndWarnings],
  ];
  return `<div class="signal-metrics">${metrics.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}</div>`;
}

function minimapBuckets(segments) {
  const nonblank = segments.filter(segment => !segment.blank);
  const bucketSize = Math.max(1, Math.ceil(nonblank.length / 180));
  const buckets = [];
  for (let index = 0; index < nonblank.length; index += bucketSize) {
    const rows = nonblank.slice(index, index + bucketSize);
    const strongest = [...rows].sort((a, b) => levelRank(b.level) - levelRank(a.level) || b.score.total - a.score.total)[0];
    buckets.push({
      lineNumber: rows[0].lineNumber,
      level: strongest.level,
      pinned: rows.some(row => state.pinned.has(row.id)),
      count: rows.length,
    });
  }
  return buckets;
}

function renderMinimap() {
  const buckets = minimapBuckets(state.result.segments);
  return `
    <nav class="signal-minimap" aria-label="Artifact minimap">
      ${buckets.map(bucket => `<button type="button" class="is-${esc(bucket.level)} ${bucket.pinned ? "is-pinned" : ""}" data-jump-line="${bucket.lineNumber}" title="Go to line ${bucket.lineNumber}${bucket.count > 1 ? `–${bucket.lineNumber + bucket.count - 1}` : ""}"><span class="visually-hidden">Go to line ${bucket.lineNumber}</span></button>`).join("")}
    </nav>
  `;
}

function renderLine(segment) {
  if (segment.blank) return `<div class="signal-line is-blank" aria-label="Line ${segment.lineNumber}, blank"><span>${segment.lineNumber}</span></div>`;
  const selected = state.activeSegmentId === segment.id;
  const pinned = state.pinned.has(segment.id);
  return `
    <article class="signal-line is-${esc(segment.level)} ${selected ? "is-selected" : ""}" id="signal-line-${segment.lineNumber}" data-segment-row="${esc(segment.id)}">
      <button class="signal-pin ${pinned ? "is-pinned" : ""}" type="button" data-pin-segment="${esc(segment.id)}" aria-label="${pinned ? "Unpin" : "Pin"} line ${segment.lineNumber}" aria-pressed="${pinned}">
        <span aria-hidden="true">${pinned ? "◆" : "◇"}</span>
      </button>
      <button class="signal-line-main" type="button" data-select-segment="${esc(segment.id)}" aria-current="${selected ? "true" : "false"}">
        <span class="signal-line-number">${segment.lineNumber}</span>
        <span class="signal-line-rail" style="--signal-score:${Math.round(segment.score.total * 100)}%" title="${Math.round(segment.score.total * 100)} attention score"></span>
        <span class="signal-line-content">
          <code>${esc(segment.text)}</code>
          <span class="signal-line-meta">
            ${segment.roles.map(roleBadge).join("")}
            <span class="signal-cluster">${esc(segment.templateId)} · ${segment.templateCount}×</span>
          </span>
        </span>
      </button>
    </article>
  `;
}

function renderLineLedger() {
  const { filtered, pageCount, rows } = pageSegments();
  const from = filtered.length ? state.page * PAGE_SIZE + 1 : 0;
  const to = Math.min(filtered.length, (state.page + 1) * PAGE_SIZE);
  return `
    <section class="signal-ledger" aria-labelledby="signal-ledger-title">
      <header class="signal-ledger-tools">
        <div>
          <p class="section-label">Source ledger</p>
          <h2 id="signal-ledger-title">Every observation stays linked to its line.</h2>
        </div>
        <div class="signal-filters">
          <label>View
            <select data-signal-filter>
              <option value="all" ${state.filter === "all" ? "selected" : ""}>All lines</option>
              <option value="attention" ${state.filter === "attention" ? "selected" : ""}>Attention</option>
              <option value="notable" ${state.filter === "notable" ? "selected" : ""}>Attention + notable</option>
              <option value="pinned" ${state.filter === "pinned" ? "selected" : ""}>Pinned</option>
            </select>
          </label>
          <label>Role
            <select data-signal-role>
              <option value="all">All roles</option>
              ${Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${esc(value)}" ${state.role === value ? "selected" : ""}>${esc(label)}</option>`).join("")}
            </select>
          </label>
          <label>Find
            <input type="search" value="${esc(state.query)}" placeholder="text or template" data-signal-query />
          </label>
        </div>
      </header>
      <div class="signal-ledger-status">
        <span>Showing ${from}–${to} of ${filtered.length} matching lines</span>
        <span>Nothing is hidden until you choose a filter.</span>
      </div>
      <div class="signal-ledger-body">
        ${renderMinimap()}
        <div class="signal-lines">${rows.map(renderLine).join("") || `<div class="signal-no-lines"><p>No lines match this review filter.</p><button type="button" class="button is-subtle is-small" data-reset-signal-filter>Show all lines</button></div>`}</div>
      </div>
      ${pageCount > 1 ? `<nav class="signal-pagination" aria-label="Line pages"><button type="button" data-signal-page="-1" ${state.page === 0 ? "disabled" : ""}>← Previous</button><span>Page ${state.page + 1} of ${pageCount}</span><button type="button" data-signal-page="1" ${state.page + 1 === pageCount ? "disabled" : ""}>Next →</button></nav>` : ""}
    </section>
  `;
}

function componentLabel(key) {
  return ({
    patternBreak: "Pattern break",
    templateRarity: "Template rarity",
    concreteEvidence: "Concrete evidence",
    severityEvidence: "Severity evidence",
    compressionNovelty: "Compression novelty",
    localContext: "Local context",
    repetitionFrequency: "Severe repetition",
    ambiguityPenalty: "Ambiguity penalty",
  })[key] || key;
}

function renderEvidenceDrawer() {
  const segment = state.result.segments.find(item => item.id === state.activeSegmentId) || state.result.segments.find(item => !item.blank);
  if (!segment || segment.blank) return `<aside class="signal-evidence-drawer"><p>Select a nonblank line to inspect its evidence.</p></aside>`;
  const explanation = explainSignalSegment(segment, state.result);
  const related = explanation.relatedSegmentIds
    .map(id => state.result.segments.find(item => item.id === id))
    .filter(Boolean);
  return `
    <aside class="signal-evidence-drawer" aria-labelledby="signal-evidence-title">
      <header>
        <div>
          <p class="section-label">Evidence drawer</p>
          <h2 id="signal-evidence-title">Line ${segment.lineNumber} · ${esc(segment.level)}</h2>
        </div>
        <button class="signal-pin signal-drawer-pin ${state.pinned.has(segment.id) ? "is-pinned" : ""}" type="button" data-pin-segment="${esc(segment.id)}" aria-label="${state.pinned.has(segment.id) ? "Unpin" : "Pin"} line ${segment.lineNumber}">${state.pinned.has(segment.id) ? "◆ Pinned" : "◇ Pin"}</button>
      </header>
      <pre>${esc(segment.text)}</pre>
      <div class="signal-drawer-roles">${segment.roles.map(roleBadge).join("")}</div>
      <div class="signal-confidence">
        <span>${esc(segment.confidence.label)} evidence</span>
        <strong>${Math.round(segment.confidence.value * 100)}%</strong>
        <small>${esc(segment.confidence.meaning)}</small>
      </div>
      <section>
        <h3>Why this line received attention</h3>
        <ul>${segment.evidence.map(item => `<li><span>${esc(item.kind)}</span>${esc(item.message)}</li>`).join("") || "<li>Signal found limited independent evidence.</li>"}</ul>
      </section>
      <section>
        <h3>Score components</h3>
        <div class="signal-score-components">
          ${Object.entries(segment.score.components).map(([key, value]) => `<div class="${key === "ambiguityPenalty" ? "is-penalty" : ""}"><span>${esc(componentLabel(key))}</span><i style="--component:${Math.round(value * 100)}%"></i><strong>${Math.round(value * 100)}</strong></div>`).join("")}
        </div>
      </section>
      <details open>
        <summary>Normalized structure</summary>
        <code>${esc(explanation.template?.signature || "No template for blank lines")}</code>
        <p>${explanation.template ? `${explanation.template.count} line${explanation.template.count === 1 ? "" : "s"} in ${explanation.template.id}` : ""}</p>
      </details>
      <details>
        <summary>Compression novelty</summary>
        <p>${Math.round((segment.compressionNovelty?.value || 0) * 100)}% estimate · ${Math.round((segment.compressionNovelty?.reliability || 0) * 100)}% measurement reliability.</p>
        <p>Byte predictability only. Order-sensitive and not a semantic measure.</p>
      </details>
      ${related.length ? `<section><h3>Related source lines</h3><div class="signal-related">${related.map(item => `<button type="button" data-select-segment="${esc(item.id)}">Line ${item.lineNumber}<span>${esc(item.text)}</span></button>`).join("")}</div></section>` : ""}
      <section class="signal-uncertainty">
        <h3>Uncertainty</h3>
        <ul>${segment.alternatives.map(item => `<li>${esc(item)}</li>`).join("")}</ul>
        <p>${esc(explanation.limitation)}</p>
      </section>
    </aside>
  `;
}

function currentPack() {
  return createEvidencePack(state.result, {
    ...state.pack,
    pinnedSegmentIds: [...state.pinned],
  });
}

function renderEvidencePack() {
  if (!state.showPack) return "";
  const pack = currentPack();
  return `
    <section class="signal-pack" aria-labelledby="signal-pack-title">
      <header>
        <div>
          <p class="section-label">Reviewed export</p>
          <h2 id="signal-pack-title">Create evidence pack</h2>
          <p>Choose what to include. Signal never decides that omitted lines are safe to discard.</p>
        </div>
        <button type="button" class="signal-pack-close" data-close-signal-pack aria-label="Close evidence pack">×</button>
      </header>
      <div class="signal-pack-grid">
        <div class="signal-pack-options">
          <label><input type="checkbox" data-pack-setting="includeAttention" ${state.pack.includeAttention ? "checked" : ""} /> Current attention findings</label>
          <label><input type="checkbox" data-pack-setting="includeNotable" ${state.pack.includeNotable ? "checked" : ""} /> Notable observations</label>
          <label><input type="checkbox" data-pack-setting="includeRepresentatives" ${state.pack.includeRepresentatives ? "checked" : ""} /> One representative per template</label>
          <label>Context around included lines
            <select data-pack-setting="contextLines">
              ${[0, 1, 2, 3].map(value => `<option value="${value}" ${state.pack.contextLines === value ? "selected" : ""}>${value} line${value === 1 ? "" : "s"}</option>`).join("")}
            </select>
          </label>
          <div class="signal-pack-counts">
            <strong>${pack.artifact.selection.includedLines}</strong><span>included lines</span>
            <strong>${pack.artifact.selection.omittedNonblankLines}</strong><span>omitted nonblank lines</span>
            <strong>${state.pinned.size}</strong><span>manual pins</span>
          </div>
          <label class="signal-review-check"><input type="checkbox" data-pack-reviewed ${state.pack.reviewed ? "checked" : ""} /> I reviewed this selection and understand that omitted lines remain part of the source.</label>
          <div class="signal-pack-actions">
            <button type="button" class="button is-primary" data-download-pack="text" ${!state.pack.reviewed ? "disabled" : ""}>Download text</button>
            <button type="button" class="button is-subtle" data-download-pack="json" ${!state.pack.reviewed ? "disabled" : ""}>Download JSON</button>
          </div>
        </div>
        <pre class="signal-pack-preview">${esc(pack.text)}</pre>
      </div>
    </section>
  `;
}

function renderResults() {
  if (!state.result) return "";
  if (state.result.status !== "ready") return renderRouting() || `<div class="format-diagnostic is-danger"><p>${esc(state.result.validation?.errors?.join(" ") || "Signal could not analyze this artifact.")}</p></div>`;
  const result = state.result;
  return `
    <section class="signal-result-shell">
      <header class="signal-result-head">
        <div>
          <span>${esc(result.mode.selected)} mode${result.mode.overridden ? " · manual override" : ""}</span>
          <strong>${result.summary.attentionCount} attention · ${result.summary.notableCount} notable</strong>
        </div>
        <button class="button is-primary is-small" type="button" data-open-signal-pack>Create evidence pack →</button>
      </header>
      <div class="signal-overview">
        <div class="signal-overview-copy">
          <p class="section-label">Analysis overview</p>
          <h2>${result.summary.attentionCount ? `${plural(result.summary.attentionCount, "line")} received attention.` : "No strong pattern break was established."}</h2>
          <p>Signal inferred <strong>${esc(result.mode.inferred)}</strong> with ${Math.round(result.mode.confidence * 100)}% evidence strength. This is an attention aid, not a judgment about business importance.</p>
        </div>
        ${renderMetrics(result)}
        <div class="signal-limitations">
          ${result.warnings.map(warning => `<p class="is-${esc(warning.type)}">${esc(warning.message)}${warning.action ? ` <a href="${esc(warning.action.route)}">${esc(warning.action.label)} →</a>` : ""}</p>`).join("")}
        </div>
      </div>
      <div class="signal-workspace">
        ${renderLineLedger()}
        ${renderEvidenceDrawer()}
      </div>
    </section>
    ${renderEvidencePack()}
  `;
}

function render() {
  mount.innerHTML = `
    <article class="signal-page">
      <header class="tool-header signal-product-header">
        <p class="section-label">Signal · Experimental</p>
        <h1>Find the lines that break the pattern.</h1>
        <p class="tool-subhead">Inspect logs, reports, and specs for repetition, rare structures, concrete constraints, and exceptions. Local, deterministic, and explained.</p>
      </header>
      <div class="signal-presets" aria-label="Signal examples">
        <span>Try an artifact</span>
        ${Object.entries(PRESETS).map(([id, preset]) => `<button type="button" data-signal-preset="${id}">${esc(preset.label)}</button>`).join("")}
      </div>
      ${renderInput()}
      ${renderResults()}
      <p class="visually-hidden" aria-live="polite">${esc(state.announcement)}</p>
    </article>
  `;
}

function invalidateResult() {
  state.result = null;
  state.activeSegmentId = null;
  state.pinned.clear();
  state.forceLineAnalysis = false;
  state.showPack = false;
  state.pack.reviewed = false;
  state.page = 0;
}

function makeInput() {
  return {
    text: state.text,
    name: state.name,
    mode: state.mode,
    settings: { ...state.settings, forceLineAnalysis: state.forceLineAnalysis },
  };
}

function setProgress(message) {
  state.progress = message;
  const progress = mount.querySelector("[data-signal-progress]");
  if (progress) progress.textContent = message;
}

function workerAnalysis(input) {
  if (!globalThis.Worker) return Promise.resolve(analyzeSignal(input));
  if (!state.worker) state.worker = new Worker("/src/local/signal-worker.js", { type: "module" });
  const id = `signal-run-${++state.runId}`;
  return new Promise((resolve, reject) => {
    state.workerReject = reject;
    const onMessage = event => {
      if (event.data?.id !== id) return;
      if (event.data.progress) {
        setProgress(event.data.progress);
        return;
      }
      state.worker.removeEventListener("message", onMessage);
      state.workerReject = null;
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    state.worker.addEventListener("message", onMessage);
    state.worker.postMessage({ id, input });
  });
}

async function runAnalysis() {
  if (state.busy || !state.text.trim()) return;
  state.busy = true;
  state.progress = "preparing local analysis";
  state.announcement = "Signal analysis started.";
  render();
  try {
    const result = await workerAnalysis(makeInput());
    state.result = result;
    state.activeSegmentId = result.status === "ready"
      ? result.findings[0]?.segmentIds?.[0] || result.segments.find(segment => !segment.blank)?.id || null
      : null;
    state.announcement = result.status === "ready"
      ? `Analysis complete. ${result.summary.attentionCount} attention observations.`
      : "Signal needs a routing choice before line analysis.";
  } catch (error) {
    if (error?.message === "signal-cancelled") return;
    try {
      state.result = analyzeSignal(makeInput());
      state.activeSegmentId = state.result.findings?.[0]?.segmentIds?.[0] || null;
      state.announcement = "Background analysis was unavailable; Signal completed the bounded local fallback.";
    } catch {
      state.result = { status: "invalid", validation: { errors: [error?.message || "Signal could not analyze this artifact."] } };
      state.announcement = "Signal analysis failed.";
    }
  } finally {
    state.busy = false;
    state.progress = "";
    render();
  }
}

function cancelAnalysis() {
  state.workerReject?.(new Error("signal-cancelled"));
  state.workerReject = null;
  if (state.worker) state.worker.terminate();
  state.worker = null;
  state.runId += 1;
  state.busy = false;
  state.progress = "";
  state.announcement = "Signal analysis cancelled.";
  render();
}

async function importFile(file) {
  if (!file) return;
  if (file.size > SIGNAL_LIMITS.maxBytes) {
    state.announcement = "File is too large. Signal accepts up to 2 MiB.";
    render();
    return;
  }
  const text = await file.text();
  const unsafe = unsafeTextReason(text);
  if (unsafe) {
    state.announcement = unsafe;
    render();
    return;
  }
  state.text = text;
  state.name = file.name || "Imported artifact";
  invalidateResult();
  state.announcement = `${state.name} imported locally.`;
  render();
}

function jumpToLine(lineNumber) {
  state.filter = "all";
  state.role = "all";
  state.query = "";
  state.page = Math.floor((Math.max(1, Number(lineNumber)) - 1) / PAGE_SIZE);
  render();
  requestAnimationFrame(() => mount.querySelector(`#signal-line-${lineNumber}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function selectSegment(id) {
  const segment = state.result?.segments?.find(item => item.id === id);
  if (!segment) return;
  state.activeSegmentId = id;
  const filtered = filteredSegments();
  const index = filtered.findIndex(item => item.id === id);
  if (index >= 0) state.page = Math.floor(index / PAGE_SIZE);
  render();
  requestAnimationFrame(() => mount.querySelector(".signal-evidence-drawer")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
}

function togglePin(id) {
  if (state.pinned.has(id)) state.pinned.delete(id);
  else state.pinned.add(id);
  state.pack.reviewed = false;
  state.announcement = `${state.pinned.size} source ${state.pinned.size === 1 ? "line" : "lines"} pinned.`;
  render();
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

mount.addEventListener("input", event => {
  if (event.target.matches("[data-signal-input]")) {
    state.text = event.target.value;
    state.name = state.name === "Untitled artifact" ? "Pasted artifact" : state.name;
    invalidateResult();
    mount.querySelectorAll(".signal-result-shell, .signal-pack, .signal-route-notice, .format-diagnostic").forEach(element => element.remove());
    const summary = mount.querySelector(".signal-input-foot > span");
    if (summary) summary.textContent = inputSummary();
    const name = mount.querySelector(".signal-input-head strong");
    if (name) name.textContent = state.name;
    const run = mount.querySelector("[data-run-signal]");
    if (run) run.disabled = !state.text.trim();
    return;
  }
  if (event.target.matches("[data-signal-query]")) {
    state.query = event.target.value;
    state.page = 0;
    const cursor = event.target.selectionStart;
    render();
    requestAnimationFrame(() => {
      const query = mount.querySelector("[data-signal-query]");
      query?.focus();
      query?.setSelectionRange(cursor, cursor);
    });
  }
});

mount.addEventListener("change", event => {
  if (event.target.matches("[data-signal-mode]")) {
    state.mode = event.target.value;
    invalidateResult();
    render();
    return;
  }
  if (event.target.matches("[data-signal-file]")) return importFile(event.target.files?.[0]);
  if (event.target.matches("[data-signal-filter]")) {
    state.filter = event.target.value;
    state.page = 0;
    render();
    return;
  }
  if (event.target.matches("[data-signal-role]")) {
    state.role = event.target.value;
    state.page = 0;
    render();
    return;
  }
  if (event.target.matches("[data-signal-setting]")) {
    const key = event.target.dataset.signalSetting;
    state.settings[key] = event.target.type === "checkbox" ? event.target.checked : Number(event.target.value);
    invalidateResult();
    render();
    return;
  }
  if (event.target.matches("[data-pack-setting]")) {
    const key = event.target.dataset.packSetting;
    state.pack[key] = event.target.type === "checkbox" ? event.target.checked : Number(event.target.value);
    state.pack.reviewed = false;
    render();
    return;
  }
  if (event.target.matches("[data-pack-reviewed]")) {
    state.pack.reviewed = event.target.checked;
    render();
  }
});

mount.addEventListener("click", event => {
  const button = event.target.closest("button, a");
  if (!button) return;
  if (button.matches("[data-signal-preset]")) {
    const preset = PRESETS[button.dataset.signalPreset];
    state.text = preset.text;
    state.name = preset.name;
    state.mode = preset.mode;
    invalidateResult();
    state.announcement = `${preset.label} loaded.`;
    render();
    return;
  }
  if (button.matches("[data-clear-signal]")) {
    state.text = "";
    state.name = "Untitled artifact";
    state.mode = "auto";
    invalidateResult();
    render();
    return;
  }
  if (button.matches("[data-run-signal]")) return runAnalysis();
  if (button.matches("[data-cancel-signal]")) return cancelAnalysis();
  if (button.matches("[data-force-signal]")) {
    state.forceLineAnalysis = true;
    return runAnalysis();
  }
  if (button.matches("[data-select-segment]")) return selectSegment(button.dataset.selectSegment);
  if (button.matches("[data-pin-segment]")) return togglePin(button.dataset.pinSegment);
  if (button.matches("[data-jump-line]")) return jumpToLine(button.dataset.jumpLine);
  if (button.matches("[data-reset-signal-filter]")) {
    state.filter = "all";
    state.role = "all";
    state.query = "";
    state.page = 0;
    return render();
  }
  if (button.matches("[data-signal-page]")) {
    state.page += Number(button.dataset.signalPage);
    render();
    requestAnimationFrame(() => mount.querySelector(".signal-ledger")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return;
  }
  if (button.matches("[data-open-signal-pack]")) {
    state.showPack = true;
    state.pack.reviewed = false;
    render();
    requestAnimationFrame(() => mount.querySelector(".signal-pack")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return;
  }
  if (button.matches("[data-close-signal-pack]")) {
    state.showPack = false;
    return render();
  }
  if (button.matches("[data-download-pack]")) {
    if (!state.pack.reviewed) return;
    const pack = currentPack();
    const base = (state.result.source.name || "signal-evidence").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-");
    if (button.dataset.downloadPack === "json") download(`${base}-evidence.json`, JSON.stringify(pack.artifact, null, 2), "application/json");
    else download(`${base}-evidence.txt`, pack.text, "text/plain");
    state.announcement = "Reviewed evidence pack downloaded.";
  }
});

mount.addEventListener("dragover", event => {
  if (!event.dataTransfer?.types?.includes("Files")) return;
  event.preventDefault();
  mount.querySelector(".signal-input-card")?.classList.add("is-dragging");
});

mount.addEventListener("dragleave", event => {
  if (!mount.contains(event.relatedTarget)) mount.querySelector(".signal-input-card")?.classList.remove("is-dragging");
});

mount.addEventListener("drop", event => {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  mount.querySelector(".signal-input-card")?.classList.remove("is-dragging");
  importFile(event.dataTransfer.files[0]);
});

render();
