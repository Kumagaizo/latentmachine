import {
  detectFormat,
  parseWithFormat,
  serializeWithFormat,
  FORMATS,
  FORMAT_ORDER,
} from "../intelligence/data-formats/index.js";
import { inferVerifyRule } from "../intelligence/json-transform/verify-inference.js";
import { opSources } from "../intelligence/json-transform/shared.js";
import { VERIFY_SAMPLES, verifySampleById } from "../intelligence/json-transform/verify-samples.js";
import { esc, inlineCodeHtml, plural } from "./shared.js";
import { FILE_IMPORT_MAX_BYTES, formatBytes, unsafeTextReason, validateImportFile } from "./file-import.js";
import { normalizeVerifyInputText } from "./verify-input.js";
import { copyText, shareUrlForState, sharedStateFromLocation } from "./share-state.js";

const verify = document.querySelector("#verify");

const state = {
  original: "",
  transformed: "",
  formats: {
    original: "auto",
    transformed: "auto",
  },
  run: null,
  activeSample: "",
  importNotice: null,
  copied: false,
  summaryCopied: false,
  shareNotice: "",
  reviewMode: "all",
  activeFlagIndex: 0,
};

let shareTimer = null;
let summaryTimer = null;

const VERIFY_IMPORT_ACCEPT = ".json,.xml,.csv,.tsv,.toml,.sql,.yaml,.yml,.env,application/json,application/xml,text/xml,text/csv,text/tab-separated-values,application/toml,text/toml,text/yaml,application/yaml,text/plain";

function formatLabel(formatId) {
  if (formatId === "auto") return "Auto";
  if (formatId === "empty") return "Empty";
  if (formatId === "unknown") return "Unknown";
  return FORMATS[formatId]?.label || String(formatId || "Unknown");
}

function detectedLabel(text, manualFormat) {
  const detected = detectFormat(text);
  if (manualFormat !== "auto") return formatLabel(manualFormat);
  if (detected === "empty" || detected === "unknown") return "Auto";
  return `Auto (${formatLabel(detected)})`;
}

function preview(value, format = "json") {
  try {
    return serializeWithFormat(value, FORMAT_ORDER.includes(format) ? format : "json");
  } catch {
    return JSON.stringify(value, null, 2);
  }
}

function lineCount(text = "") {
  return String(text || "").trim() ? String(text).split(/\r\n|\r|\n/).length : 0;
}

function formatBytesLocal(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectedFormatId(key) {
  const manual = state.formats[key] || "auto";
  return manual === "auto" ? detectFormat(normalizeVerifyInputText(state[key])) : manual;
}

function formatDirection(run = state.run) {
  const original = run?.originalFormat || detectedFormatId("original");
  const transformed = run?.transformedFormat || run?.outputFormat || detectedFormatId("transformed");
  return `${formatLabel(original)} → ${formatLabel(transformed)}`;
}

function runTone(run = state.run) {
  if (!run) return state.original.trim() && state.transformed.trim() ? "warn" : "muted";
  if (run.error) return "danger";
  return run.verdict === "safe" ? "safe" : "danger";
}

function runStatusText(run = state.run) {
  if (!run) return state.original.trim() && state.transformed.trim() ? "Ready to check" : "Paste original records and AI output";
  if (run.error) return "Blocked by input";
  if (run.result?.status !== "safe" && !run.flagged?.length) return "Blocked";
  return run.verdict === "safe" ? "Consistent" : "Inconsistent";
}

function ruleStepCount(run = state.run) {
  return run?.result?.rule?.program?.ops?.length || 0;
}

function rowNumber(row) {
  return Number.isFinite(row?.i) ? row.i + 1 : null;
}

const ROW_IDENTITY_KEYS = [
  "id",
  "customerId",
  "customer_id",
  "legacy_id",
  "userId",
  "user_id",
  "accountId",
  "account_id",
  "orderId",
  "order_id",
  "invoiceId",
  "invoice_id",
  "email",
  "sku",
  "slug",
];

function identityDisplayValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.length > 40 ? `${value.slice(0, 37)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return shortValue(value);
}

function rowIdentityFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  for (const preferred of ROW_IDENTITY_KEYS) {
    const key = keys.find(candidate => candidate.toLowerCase() === preferred.toLowerCase());
    const display = identityDisplayValue(value[key]);
    if (key && display) return { key, value: display };
  }
  return null;
}

function rowIdentity(row) {
  return rowIdentityFrom(row?.input) || rowIdentityFrom(row?.actual) || rowIdentityFrom(row?.predicted);
}

function rowLabel(row) {
  const base = `Row ${rowNumber(row) || "?"}`;
  const identity = rowIdentity(row);
  return identity ? `${base} · ${identity.key} ${identity.value}` : base;
}

function rowList(rows = []) {
  return rows.length ? rows.join(", ") : "none";
}

function evidenceBasis(run = state.run) {
  if (!run || run.error) return "No audit has run yet.";
  if (run.trainedOn) return `The majority rule was inferred from ${run.trainedOn}, then replayed across all ${plural(run.originalRows.length, "row")}.`;
  if (Number.isInteger(run.omitted)) return `The majority rule was inferred by excluding row ${run.omitted + 1}, then replayed across all ${plural(run.originalRows.length, "row")}.`;
  return `The rule was inferred from the full aligned batch and replayed across all ${plural(run.originalRows.length, "row")}.`;
}

function proofSummary(run = state.run) {
  const flaggedRows = (run?.flagged || []).map(row => rowNumber(row)).filter(Boolean);
  const flaggedRowLabels = (run?.flagged || []).map(rowLabel);
  const totalRows = run?.originalRows?.length || 0;
  const flaggedCount = flaggedRows.length;
  const passedRows = Math.max(0, totalRows - flaggedCount);
  return {
    totalRows,
    passedRows,
    flaggedRows,
    flaggedRowLabels,
    flaggedCount,
    ruleStatus: run?.result?.status || null,
    ruleStepCount: ruleStepCount(run),
    evidenceBasis: evidenceBasis(run),
  };
}

function auditSummaryText(run = state.run) {
  const proof = proofSummary(run);
  if (!run || run.error) return "No verification run is available.";
  if (run.result?.status !== "safe") {
    return `Verified ${plural(proof.totalRows, "row")}. The batch did not prove one safe rule (${run.result?.status || "blocked"}). ${proof.evidenceBasis}`;
  }
  if (!proof.flaggedCount) {
    return `Verified ${plural(proof.totalRows, "row")}. All rows followed the inferred ${plural(proof.ruleStepCount, "rule step")}.`;
  }
  return `Verified ${plural(proof.totalRows, "row")}. ${plural(proof.passedRows, "row")} followed the inferred rule; ${plural(proof.flaggedCount, "row")} need review: ${rowList(proof.flaggedRowLabels)}.`;
}

function verdictTextForRun(run) {
  if (!run || run.error) return "No verification run is available.";
  if (run.verdict === "safe") return "Consistent: every transformed row followed the inferred rule.";
  if (run.result?.status !== "safe" && !run.flagged?.length) return `Blocked: the batch did not prove one safe rule (${run.result?.status || "blocked"}).`;
  return `Inconsistent: ${plural(run.flagged.length, "row")} did not follow the inferred rule.`;
}

function isTypingTarget(target) {
  return !!target?.closest?.("textarea, input, select, [contenteditable='true']");
}

function pathFor(parent, key) {
  if (typeof key === "number") return `${parent}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function shortValue(value) {
  if (value === undefined) return "missing";
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 64 ? `${text.slice(0, 61)}...` : text;
}

function differenceItems(expected, actual, path = "$") {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return [{ path, type: "type", text: `${path} expected ${shortValue(expected)}, got ${shortValue(actual)}` }];
    const max = Math.max(expected.length, actual.length);
    return Array.from({ length: max }, (_, index) => differenceItems(expected[index], actual[index], pathFor(path, index))).flat();
  }
  if ((expected && typeof expected === "object") || (actual && typeof actual === "object")) {
    if (!expected || !actual || typeof expected !== "object" || typeof actual !== "object") return [{ path, type: "type", text: `${path} expected ${shortValue(expected)}, got ${shortValue(actual)}` }];
    return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].flatMap(key => {
      const childPath = pathFor(path, key);
      if (!(key in expected)) return [{ path: childPath, type: "extra", text: `${childPath} was extra: ${shortValue(actual[key])}` }];
      if (!(key in actual)) return [{ path: childPath, type: "missing", text: `${childPath} was missing; expected ${shortValue(expected[key])}` }];
      return differenceItems(expected[key], actual[key], childPath);
    });
  }
  return [{ path, type: "changed", text: `${path} expected ${shortValue(expected)}, got ${shortValue(actual)}` }];
}

function rowDifferences(row, { limit = 12 } = {}) {
  const differences = differenceItems(row.predicted, row.actual);
  return Number.isFinite(limit) ? differences.slice(0, limit) : differences;
}

function differenceNote(row) {
  const differences = rowDifferences(row);
  if (!differences.length) return "The row differs from the rule, but the output values serialize equivalently.";
  const hidden = differences.length > 4 ? ` +${differences.length - 4} more` : "";
  return `${differences.slice(0, 4).map(item => item.text).join("; ")}${hidden}`;
}

function differenceTypeLabel(type) {
  const labels = {
    changed: "Changed value",
    extra: "Extra field",
    missing: "Missing field",
    type: "Type mismatch",
  };
  return labels[type] || "Difference";
}

function differenceTone(type) {
  if (type === "missing" || type === "extra") return "warn";
  return "danger";
}

function groupDifferences(differences = []) {
  const groups = new Map();
  for (const item of differences) {
    const key = item.type || "changed";
    const existing = groups.get(key) || [];
    existing.push(item);
    groups.set(key, existing);
  }
  return [...groups.entries()].map(([type, items]) => ({ type, items }));
}

function valueAtPath(root, path = "$") {
  if (path === "$") return root;
  const parts = [];
  const regex = /\.([A-Za-z_$][\w$]*)|\[(\d+|".*?"|'.*?')\]/g;
  let match;
  while ((match = regex.exec(path))) {
    if (match[1]) parts.push(match[1]);
    else if (/^\d+$/.test(match[2])) parts.push(Number(match[2]));
    else {
      try {
        parts.push(JSON.parse(match[2].replace(/^'/, "\"").replace(/'$/, "\"")));
      } catch {
        return undefined;
      }
    }
  }
  return parts.reduce((current, part) => current?.[part], root);
}

function differenceCell(value) {
  return value === undefined ? "<em>missing</em>" : `<code>${esc(shortValue(value))}</code>`;
}

function rowFailureTitle(row) {
  const differences = rowDifferences(row);
  if (!differences.length) return "Serialized output differs from the inferred rule.";
  const groups = groupDifferences(differences);
  const primary = groups.sort((a, b) => b.items.length - a.items.length)[0];
  const path = primary.items[0]?.path || "$";
  return `${differenceTypeLabel(primary.type)} at ${path}`;
}

function rowFailureGroupsHtml(row) {
  const groups = groupDifferences(rowDifferences(row));
  if (!groups.length) return "";
  return `<div class="verify-failure-groups" aria-label="Why this row failed">
    ${groups.map(group => `<div class="verify-failure-group is-${esc(differenceTone(group.type))}">
      <span>${esc(differenceTypeLabel(group.type))}</span>
      <strong>${esc(group.items.length)}</strong>
      <small>${esc(group.items.slice(0, 3).map(item => item.path).join(", "))}${group.items.length > 3 ? "..." : ""}</small>
    </div>`).join("")}
  </div>`;
}

function diffTableHtml(row) {
  const differences = rowDifferences(row);
  if (!differences.length) return "";
  return `<div class="verify-diff-table" role="table" aria-label="Expected versus actual differences">
    <div class="verify-diff-row is-head" role="row">
      <span role="columnheader">Path</span>
      <span role="columnheader">Rule expected</span>
      <span role="columnheader">Provided output</span>
      <span role="columnheader">Reason</span>
    </div>
    ${differences.map(item => {
      const expected = valueAtPath(row.predicted, item.path);
      const actual = valueAtPath(row.actual, item.path);
      return `<div class="verify-diff-row is-${esc(differenceTone(item.type))}" role="row">
        <span role="cell"><code>${esc(item.path)}</code></span>
        <span role="cell">${differenceCell(expected)}</span>
        <span role="cell">${differenceCell(actual)}</span>
        <span role="cell">${esc(differenceTypeLabel(item.type))}</span>
      </div>`;
    }).join("")}
  </div>`;
}

function failureGroupsForRun(run) {
  const groups = new Map();
  for (const row of run?.flagged || []) {
    for (const item of rowDifferences(row)) {
      const key = `${item.type || "changed"}:${item.path}`;
      const existing = groups.get(key) || {
        type: item.type || "changed",
        path: item.path,
        rows: [],
        count: 0,
        example: item.text,
      };
      existing.count += 1;
      existing.rows.push(row.i + 1);
      groups.set(key, existing);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
}

function normalizeRows(value, label) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  throw new Error(`${label} must parse to an object or an array of records.`);
}

function parsePane(key, label) {
  const text = normalizeVerifyInputText(state[key]);
  const format = state.formats[key];
  try {
    const parsed = parseWithFormat(text, format, { singleRowAsObject: false });
    return {
      rows: normalizeRows(parsed, label),
      format: format === "auto" ? detectFormat(text) : format,
    };
  } catch (error) {
    throw new Error(`${label} could not be parsed. ${error?.message || "Check the input format."}`);
  }
}

function formatChip(key) {
  const text = normalizeVerifyInputText(state[key]);
  const manualFormat = state.formats[key];
  const detected = detectFormat(text);
  const supported = manualFormat !== "auto" || FORMAT_ORDER.includes(detected) || detected === "empty";
  return `<select class="format-chip ${supported ? "" : "is-warn"}" data-format-for="${esc(key)}" title="Data format">
    <option value="auto" ${manualFormat === "auto" ? "selected" : ""}>${esc(detectedLabel(text, manualFormat))}</option>
    ${FORMAT_ORDER.map(id => `<option value="${esc(id)}" ${manualFormat === id ? "selected" : ""}>${esc(formatLabel(id))}</option>`).join("")}
  </select>`;
}

function editor(label, key) {
  return `<div class="editor">
    <div class="editor-bar">
      <span>${esc(label)}</span>
      <div class="editor-actions" data-editor-actions="${esc(key)}">
        ${formatChip(key)}
      </div>
    </div>
    <textarea data-verify-editor="${esc(key)}" spellcheck="false" rows="14" aria-label="${esc(label)} data">${esc(state[key])}</textarea>
    ${paneMetaHtml(label, key)}
  </div>`;
}

function verifyFileImportPanel(label, key) {
  return `<div class="file-import verify-file-import" data-verify-file-drop="${esc(key)}">
    <input class="visually-hidden" id="verify-${esc(key)}-file" type="file" accept="${esc(VERIFY_IMPORT_ACCEPT)}" data-verify-file="${esc(key)}">
    <label class="button is-subtle" for="verify-${esc(key)}-file">${esc(label)}</label>
    <span>.json, .xml, .csv, .tsv, .toml, .sql, .yaml, or .env, ${esc(formatBytes(FILE_IMPORT_MAX_BYTES))} max</span>
  </div>`;
}

function paneMetaHtml(label, key) {
  const text = state[key] || "";
  const normalizedText = normalizeVerifyInputText(text);
  const run = state.run && !state.run.error ? state.run : null;
  const rows = run ? (key === "original" ? run.originalRows.length : run.transformedRows.length) : null;
  const format = detectedFormatId(key);
  const parts = [
    `${formatLabel(format)}${state.formats[key] === "auto" && format !== "empty" && format !== "unknown" ? " detected" : ""}`,
    `${lineCount(normalizedText)} ${lineCount(normalizedText) === 1 ? "line" : "lines"}`,
    formatBytesLocal(text.length),
    rows !== null ? `${plural(rows, "record")} parsed` : null,
  ].filter(Boolean);
  return `<div class="verify-pane-meta" data-pane-meta="${esc(key)}" aria-label="${esc(label)} summary">${parts.map(part => `<span>${esc(part)}</span>`).join("")}</div>`;
}

function opLine(op = {}) {
  const target = op.target || "$";
  const sources = opSources(op);
  if (op.op === "set") return sources[0] === target ? `Keep \`${target}\`.` : `Move \`${sources[0]}\` to \`${target}\`.`;
  if (op.op === "constant") return `Set \`${target}\` to a constant value.`;
  if (op.op === "coerce") return `Read \`${op.source}\` as ${op.to} and write \`${target}\`.`;
  if (op.op === "stringCase") return `Apply ${op.mode} casing to \`${op.source}\` for \`${target}\`.`;
  if (op.op === "stringNormalize") return `Normalize text from \`${op.source}\` for \`${target}\`.`;
  if (op.op === "valueMap") return `Map known values from \`${op.source}\` into \`${target}\`.`;
  if (op.op === "template") return `Build \`${target}\` from ${sources.map(source => `\`${source}\``).join(", ")}.`;
  if (op.op === "concat") return `Join ${sources.map(source => `\`${source}\``).join(", ")} into \`${target}\`.`;
  if (op.op === "fallback") return `Use the first available value from ${sources.map(source => `\`${source}\``).join(", ")} for \`${target}\`.`;
  if (op.op === "conditional") return `Choose one of two values for \`${target}\` based on \`${op.source}\`.`;
  if (op.op === "numericTransform" || op.op === "quantityTransform") return `Calculate \`${target}\` from \`${op.source}\`.`;
  if (op.op === "numericBinary") return `Calculate \`${target}\` from ${sources.map(source => `\`${source}\``).join(" and ")}.`;
  if (op.op === "dateFormat") return `Format date \`${op.source}\` into \`${target}\`.`;
  if (op.op === "regexExtract") return `Extract text matching \`/${op.pattern}/\` from \`${op.source}\` into \`${target}\`.`;
  if (op.op === "arrayProject") return `Project records from \`${op.source}\` into \`${target}\`.`;
  if (op.op === "arrayGroupBy") return `Group records from \`${op.source}\` by \`${op.groupBy}\` into \`${target}\`.`;
  if (op.op === "arrayMap") return `Map values from \`${op.source}\` into \`${target}\`.`;
  if (op.op === "arrayCount") return `Count items in \`${op.source}\` for \`${target}\`.`;
  if (op.op === "arrayJoin") return `Join items from \`${op.source}\` into \`${target}\`.`;
  return `Apply ${op.op || "a rule"} to produce \`${target}\`.`;
}

function ruleLines(result) {
  const explained = result?.rule?.explanations || result?.explanation?.ruleSentences || [];
  const lines = explained.length
    ? explained.map(item => item.sentence).filter(Boolean)
    : (result?.rule?.program?.ops || []).map(opLine).filter(Boolean);
  if (!lines.length) return `<div class="rule-empty">No rule was inferred.</div>`;
  return lines.map(line => `<p class="reasoning-line">${inlineCodeHtml(line)}</p>`).join("");
}

function ruleSummary(result) {
  const ops = result?.rule?.program?.ops || [];
  if (!result) return "The engine could not infer a rule.";
  if (result.status === "ambiguous") return "The inferred rule needs one more example to be trusted.";
  if (result.status === "contradictory") return "The provided rows disagree, so the rule is blocked.";
  if (result.status === "unsafe") return "The engine found a draft rule, but it is not safe yet.";
  if (!ops.length) return "The rows do not prove a reusable rule yet.";
  return `The engine found ${plural(ops.length, "step")} that explains the transformation.`;
}

function pathList(paths = []) {
  if (!paths.length) return "the input";
  if (paths.length === 1) return `\`${paths[0]}\``;
  return paths.map(path => `\`${path}\``).join(", ");
}

function productionDetail(op = {}) {
  if (op.op === "constant") return "constant value";
  if (op.op === "valueMap") return `learned lookup from ${pathList(opSources(op))}`;
  if (op.op === "conditional") return `conditional choice from ${pathList(opSources(op))}`;
  if (op.op === "template" || op.op === "concat") return `built from ${pathList(opSources(op))}`;
  if (op.op === "coerce") return `converted from \`${op.source}\``;
  if (op.op === "stringCase" || op.op === "stringNormalize") return `cleaned from \`${op.source}\``;
  if (op.source) return `from \`${op.source}\``;
  return "derived from examples";
}

function ruleSpecificationHtml(result) {
  const ops = result?.rule?.program?.ops || [];
  const expects = [...new Set(ops.flatMap(opSources))].filter(Boolean);
  return `<div class="rule-spec">
    <div class="spec-block is-rule-steps">
      <div class="section-label">Rule steps</div>
      <div class="rule-lines">${ruleLines(result)}</div>
    </div>
    <div class="spec-block">
      <div class="section-label">Rule expects</div>
      ${expects.length ? expects.map(path => `<div class="spec-row"><code>${esc(path)}</code><div class="spec-row-body"><p>required by the inferred rule</p></div></div>`).join("") : `<p class="spec-empty">No required input fields detected.</p>`}
    </div>
    <div class="spec-block">
      <div class="section-label">Rule produces</div>
      ${ops.length ? ops.map(op => `<div class="spec-row"><code>${esc(op.target || "$")}</code><div class="spec-row-body"><p>${inlineCodeHtml(productionDetail(op))}</p></div></div>`).join("") : `<p class="spec-empty">No output targets detected.</p>`}
    </div>
  </div>`;
}

function diagnosisText(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  return item.message || item.reason || item.selectedReading || item.selected || item.field || item.target || JSON.stringify(item);
}

function diagnosisRows(items = [], tone = "warn") {
  return items.filter(Boolean).map(item => `<div class="diagnosis-row is-${esc(tone)}"><span>${tone === "danger" ? "x" : "!"}</span><p>${inlineCodeHtml(diagnosisText(item))}</p></div>`).join("");
}

function suggestedExamplesHtml(result) {
  const suggestions = result?.diagnosis?.suggestedExamples || [];
  const visible = suggestions.length
    ? suggestions.slice(0, 4)
    : [{ reason: "No example covers a missing or unusual value yet. Test one before trusting this on new data." }];
  return `<section class="test-section">
    <div class="test-head">
      <div>
        <div class="section-label">Edge cases</div>
        <p>Use these to prove the rule beyond the rows you pasted.</p>
      </div>
    </div>
    <div class="test-list">
      ${visible.map((item, index) => `<article class="test-card">
        <div class="test-card-head"><span>Test ${index + 1}</span></div>
        <p class="example-note">${esc(item.reason || "Add one more example before trusting this on new data.")}</p>
      </article>`).join("")}
    </div>
  </section>`;
}

function auditTimelineHtml(run) {
  const steps = [
    {
      label: "Parsed",
      text: `${plural(run.originalRows.length, "aligned row")} read as ${formatDirection(run)}.`,
      tone: "safe",
    },
    {
      label: "Inferred",
      text: `${plural(ruleStepCount(run), "rule step")} explain the majority transformation.`,
      tone: run.result?.status === "safe" ? "safe" : "warn",
    },
    {
      label: "Replayed",
      text: "The rule was applied back across every original row.",
      tone: "safe",
    },
    {
      label: "Flagged",
      text: run.flagged.length
        ? `${plural(run.flagged.length, "row")} diverged from the inferred output.`
        : "No rows diverged from the inferred output.",
      tone: run.flagged.length ? "danger" : "safe",
    },
  ];
  return `<section class="verify-timeline" aria-label="Audit timeline">
    ${steps.map((step, index) => `<div class="verify-timeline-step is-${esc(step.tone)}">
      <span>${esc(index + 1)}</span>
      <div>
        <strong>${esc(step.label)}</strong>
        <p>${esc(step.text)}</p>
      </div>
    </div>`).join("")}
  </section>`;
}

function evidenceSummaryHtml(run) {
  const proof = proofSummary(run);
  const flaggedText = proof.flaggedCount
    ? `Rows needing review: ${rowList(proof.flaggedRowLabels)}.`
    : "No rows needed review.";
  const ruleEvidenceText = run.result?.status === "safe"
    ? `${plural(proof.ruleStepCount, "rule step")} produced the expected output for ${plural(proof.passedRows, "row")}.`
    : `The candidate rule status is ${run.result?.status || "not safe"}, so the batch needs stronger evidence before row-level replay can be trusted.`;
  return `<section class="rule-section verify-evidence-summary">
    <div class="section-label">Evidence</div>
    <div class="verify-failure-summary-list">
      <div class="diagnosis-row is-safe">
        <span>1</span>
        <p>${esc(proof.evidenceBasis)}</p>
      </div>
      <div class="diagnosis-row is-safe">
        <span>2</span>
        <p>${esc(ruleEvidenceText)}</p>
      </div>
      <div class="diagnosis-row is-${esc(proof.flaggedCount ? "danger" : "safe")}">
        <span>3</span>
        <p>${esc(flaggedText)}</p>
      </div>
    </div>
  </section>`;
}

function runFailureSummaryHtml(run) {
  const groups = failureGroupsForRun(run).slice(0, 5);
  if (!groups.length) return "";
  return `<section class="rule-section verify-failure-summary">
    <div class="section-label">Why rows failed</div>
    <p>Grouped by the output path where the provided transformed row diverged from the inferred rule. Row numbers are 1-based and match the pasted order.</p>
    <div class="verify-failure-summary-list">
      ${groups.map(group => `<div class="diagnosis-row is-${esc(differenceTone(group.type))}">
        <span>${group.type === "changed" ? "Δ" : group.type === "missing" ? "–" : group.type === "extra" ? "+" : "!"}</span>
        <div>
          <p><strong>${esc(differenceTypeLabel(group.type))}</strong> at <code>${esc(group.path)}</code></p>
          <small>${esc(plural(group.count, "occurrence"))} across rows ${esc(group.rows.slice(0, 8).join(", "))}${group.rows.length > 8 ? "..." : ""}</small>
        </div>
      </div>`).join("")}
    </div>
  </section>`;
}

function flaggedRowHtml(row, outputFormat) {
  const differences = rowDifferences(row);
  return `<article class="result-card">
    <div class="result-head">
      <div>
        <div class="section-label">${esc(rowLabel(row))}</div>
        <h2>${esc(rowFailureTitle(row))}</h2>
      </div>
    </div>
    <div class="verify-difference">
      <div class="section-label">Difference</div>
      <p>${esc(differenceNote(row))}</p>
      ${differences.length ? `<div class="verify-difference-pills">${differences.slice(0, 6).map(item => `<code>${esc(item.path)}</code>`).join("")}</div>` : ""}
    </div>
    ${rowFailureGroupsHtml(row)}
    ${diffTableHtml(row)}
    <div class="verify-row-preview">
      <div class="diagnosis-row is-warn"><span>in</span><div><pre>${esc(preview(row.input, outputFormat))}</pre></div></div>
      <div class="pair-arrow" aria-hidden="true">→</div>
      <div class="diagnosis-row is-danger"><span>rule</span><div><pre>${esc(preview(row.predicted, outputFormat))}</pre></div></div>
      <div class="diagnosis-row is-danger"><span>out</span><div><pre>${esc(preview(row.actual, outputFormat))}</pre></div></div>
    </div>
  </article>`;
}

function verifyScopeExplainer() {
  return `<div class="reasoning-hint verify-scope">
    <p><strong>Consistency, not intent.</strong> Verify checks whether every row follows one inferred rule. If every row follows the same wrong rule, the batch is still consistent. Use Infer to define intent; use Verify to audit a batch.</p>
  </div>`;
}

function clampFlagIndex(run) {
  const max = Math.max(0, (run?.flagged?.length || 1) - 1);
  state.activeFlagIndex = Math.max(0, Math.min(max, state.activeFlagIndex || 0));
}

function visibleFlaggedRows(run) {
  clampFlagIndex(run);
  if (state.reviewMode === "current") return run.flagged[state.activeFlagIndex] ? [run.flagged[state.activeFlagIndex]] : [];
  return run.flagged.slice(0, 12);
}

function verifyReviewControls(run) {
  if (!run.flagged.length) return "";
  clampFlagIndex(run);
  const current = state.activeFlagIndex + 1;
  const total = run.flagged.length;
  return `<div class="verify-review-controls">
    <div class="query-tabs" role="group" aria-label="Flagged row view">
      <button class="format-chip ${state.reviewMode === "all" ? "is-warn" : ""}" type="button" data-review-mode="all">All flagged</button>
      <button class="format-chip ${state.reviewMode === "current" ? "is-warn" : ""}" type="button" data-review-mode="current">Current row</button>
    </div>
    <div class="verify-review-nav">
      <button class="button is-subtle" type="button" data-flag-nav="prev" ${current <= 1 ? "disabled" : ""}>Previous</button>
      <span>Flagged row ${esc(current)} / ${esc(total)}</span>
      <button class="button is-subtle" type="button" data-flag-nav="next" ${current >= total ? "disabled" : ""}>Next</button>
    </div>
  </div>`;
}

function cockpitGridHtml(run = state.run) {
  const hasRun = !!run && !run.error;
  const flagged = hasRun ? run.flagged.length : null;
  const total = hasRun ? run.originalRows.length : null;
  return `<div class="inspection-grid">
    <span>Rows</span><strong>${hasRun ? esc(plural(total, "row")) : "Not run"}</strong>
    <span>Flagged</span><strong>${hasRun ? esc(flagged ? `${flagged} need review` : "0") : "—"}</strong>
    <span>Rule</span><strong>${hasRun ? esc(plural(ruleStepCount(run), "step")) : "Not inferred"}</strong>
    <span>Formats</span><strong>${esc(formatDirection(run))}</strong>
  </div>`;
}

function cockpitHtml() {
  const tone = runTone();
  const detail = state.run?.error
    ? state.run.error
    : state.run && !state.run.error
      ? state.run.verdict === "safe"
        ? "Every aligned transformed row follows the inferred rule."
        : state.run.result?.status !== "safe" && !state.run.flagged?.length
          ? "The batch needs stronger evidence before Verify can trust one rule."
          : "Review the flagged rows, then copy the audit summary or download the report."
      : state.original.trim() && state.transformed.trim()
        ? "Both panes contain data. Run Verify to infer the majority rule and audit every row."
        : "Paste or import original rows on the left and transformed rows on the right.";
  return `<aside class="status-pill verify-cockpit is-${esc(tone === "muted" ? "warn" : tone)}" data-verify-cockpit aria-live="polite" aria-label="Verify audit status">
    <div class="inspection-head">
      <span>Audit state</span>
      <strong>${esc(runStatusText())}</strong>
    </div>
    ${cockpitGridHtml()}
    <p>${esc(detail)}</p>
  </aside>`;
}

function resultMetricCards(run) {
  const flagged = run.flagged.length;
  const checked = run.originalRows.length;
  const passed = Math.max(0, checked - flagged);
  const cards = [
    ["Rows checked", checked.toLocaleString()],
    ["Rows passed", passed.toLocaleString()],
    ["Rows flagged", flagged.toLocaleString()],
    ["Rule steps", ruleStepCount(run).toLocaleString()],
  ];
  return `<div class="verify-metric-grid">
    ${cards.map(([label, value]) => `<div class="verify-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}
  </div>`;
}

function consistentResultHtml(run) {
  const count = run.originalRows.length;
  return `<section class="result-card verify-result">
    <aside class="status-pill is-safe verify-verdict" aria-live="polite">
      <div class="inspection-head"><span>Verdict</span><strong>Consistent - all ${count} ${count === 1 ? "row follows" : "rows follow"} one rule</strong></div>
      ${cockpitGridHtml(run)}
    </aside>
    ${resultMetricCards(run)}
    ${auditTimelineHtml(run)}
    ${evidenceSummaryHtml(run)}
    <div class="rule-section">
      <div class="section-label">Rule</div>
      <p>${esc(ruleSummary(run.result))}</p>
      ${ruleSpecificationHtml(run.result)}
    </div>
    ${verifyScopeExplainer()}
    ${suggestedExamplesHtml(run.result)}
  </section>`;
}

function inconsistentResultHtml(run) {
  const count = run.originalRows.length;
  const blockedWithoutFlaggedRows = run.result?.status !== "safe" && !run.flagged.length;
  const verdictText = blockedWithoutFlaggedRows
    ? "Blocked - the batch does not prove one safe rule"
    : `Inconsistent - ${run.flagged.length} of ${count} ${count === 1 ? "row does not" : "rows do not"} follow the rule`;
  const shown = visibleFlaggedRows(run);
  const hidden = state.reviewMode === "all" ? run.flagged.length - shown.length : 0;
  const diagnosis = run.fullResult?.diagnosis || run.result?.diagnosis || {};
  const contradictions = diagnosis.contradictions || [];
  const issues = [
    ...contradictions,
    ...(diagnosis.unexplained || []).map(path => ({ message: `No safe rule explains ${path}.` })),
    ...(diagnosis.guardrails || []),
  ];
  return `<section class="result-card verify-result">
    <aside class="status-pill is-danger verify-verdict" aria-live="polite">
      <div class="inspection-head"><span>Verdict</span><strong>${esc(verdictText)}</strong></div>
      ${cockpitGridHtml(run)}
    </aside>
    ${resultMetricCards(run)}
    ${auditTimelineHtml(run)}
    ${evidenceSummaryHtml(run)}
    ${runFailureSummaryHtml(run)}
    ${contradictions.length ? `<div class="diagnosis-summary is-danger"><span>Conflict</span><span>${esc(diagnosisText(contradictions[0]))}</span></div>` : ""}
    ${verifyReviewControls(run)}
    <div class="verify-flagged-list">
      ${shown.map(row => flaggedRowHtml(row, run.outputFormat)).join("")}
      ${hidden > 0 ? `<p class="example-note">${esc(`+${hidden} more flagged rows`)}</p>` : ""}
    </div>
    <div class="rule-section">
      <div class="section-label">Majority rule</div>
      <p>${esc(ruleSummary(run.result))}</p>
      ${ruleSpecificationHtml(run.result)}
    </div>
    ${issues.length ? `<div class="verify-diagnosis">${diagnosisRows(issues.slice(0, 6), "danger")}</div>` : ""}
    ${verifyScopeExplainer()}
  </section>`;
}

function diagnosticHtml(message) {
  return `<div class="format-diagnostic is-danger"><p>${esc(message)}</p></div>`;
}

function alignmentErrorText(originalRows, transformedRows) {
  return [
    `Original has ${plural(originalRows.length, "record")}, AI output has ${plural(transformedRows.length, "record")}.`,
    "Rows must align 1:1 because Verify compares row 1 with row 1, row 2 with row 2, and so on.",
    "Check for omitted rows, added rows, pasted headers, summary rows, or a filtered AI output.",
  ].join(" ");
}

function runVerify() {
  try {
    const original = parsePane("original", "Original");
    const transformed = parsePane("transformed", "Transformed");
    if (original.rows.length !== transformed.rows.length) {
      state.run = { error: alignmentErrorText(original.rows, transformed.rows) };
      render();
      return;
    }
    if (!original.rows.length) {
      state.run = { error: "Paste at least one aligned record on each side." };
      render();
      return;
    }

    const inference = inferVerifyRule(original.rows, transformed.rows);

    state.run = {
      result: inference.result,
      fullResult: inference.fullResult,
      originalRows: original.rows,
      transformedRows: transformed.rows,
      flagged: inference.flagged,
      originalFormat: original.format,
      outputFormat: transformed.format,
      transformedFormat: transformed.format,
      activeSample: state.activeSample || "",
      verdict: inference.result.status === "safe" && inference.flagged.length === 0 ? "safe" : "danger",
      matched: inference.matched,
      trainedOn: inference.trainedOn || null,
      omitted: Number.isInteger(inference.omitted) ? inference.omitted : null,
    };
    state.activeFlagIndex = 0;
    state.reviewMode = inference.flagged.length ? "all" : state.reviewMode;
  } catch (error) {
    state.run = { error: error?.message || "Verify could not parse or verify this transformation." };
  }
  render();
}

function loadVerifySample(id) {
  const sample = verifySampleById(id);
  if (!sample) return;
  state.original = JSON.stringify(sample.original, null, 2);
  state.transformed = JSON.stringify(sample.transformed, null, 2);
  state.formats = { original: "json", transformed: "json" };
  state.activeSample = sample.id;
  state.importNotice = null;
  state.run = null;
  state.activeFlagIndex = 0;
  state.reviewMode = "all";
  runVerify();
}

async function importVerifyFile(key, file) {
  const validation = validateImportFile(file);
  if (!validation.ok) {
    state.importNotice = { tone: "danger", text: validation.text };
    return render();
  }
  if (!FORMAT_ORDER.includes(validation.format)) {
    state.importNotice = { tone: "danger", text: "Verify imports support JSON, XML, CSV/TSV, TOML, SQL INSERT, YAML, and .env files." };
    return render();
  }

  try {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    const unsafeReason = unsafeTextReason(text);
    if (unsafeReason) throw new Error(unsafeReason);
    state[key] = text;
    state.formats[key] = validation.format;
    state.activeSample = "";
    state.run = null;
    state.activeFlagIndex = 0;
    state.importNotice = { tone: "safe", text: `${file.name} loaded into ${key}.` };
  } catch (error) {
    state.importNotice = { tone: "danger", text: error?.message || "The file could not be read." };
  }
  render();
}

async function importVerifyFileList(key, files) {
  const list = Array.from(files || []);
  if (list.length !== 1) {
    state.importNotice = { tone: "danger", text: "Choose one JSON, XML, CSV/TSV, TOML, SQL INSERT, YAML, or .env file." };
    return render();
  }
  return importVerifyFile(key, list[0]);
}

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function reportForRun(run, { flaggedOnly = false } = {}) {
  const proof = proofSummary(run);
  const flaggedRows = run.flagged.map(row => ({
    rowNumber: rowNumber(row),
    rowLabel: rowLabel(row),
    identity: rowIdentity(row),
    index: row.i,
    differences: rowDifferences(row, { limit: Infinity }),
    failureTitle: rowFailureTitle(row),
    failureGroups: groupDifferences(rowDifferences(row, { limit: Infinity })).map(group => ({
      type: group.type,
      label: differenceTypeLabel(group.type),
      count: group.items.length,
      paths: group.items.map(item => item.path),
    })),
    input: row.input,
    expectedByRule: row.predicted,
    providedOutput: row.actual,
    predicted: row.predicted,
    actual: row.actual,
  }));
  const failureGroups = failureGroupsForRun(run).map(group => ({
    type: group.type,
    label: differenceTypeLabel(group.type),
    path: group.path,
    count: group.count,
    rows: group.rows,
    example: group.example,
  }));
  return {
    reportType: flaggedOnly ? "latentmachine-verify-flagged-rows" : "latentmachine-verify-report",
    generatedAt: new Date().toISOString(),
    scope: "Verify checks consistency against one inferred deterministic rule. It does not prove that the rule matches human intent.",
    auditSummaryText: auditSummaryText(run),
    whatThisReportProves: [
      "The original and transformed rows were parsed as an aligned batch.",
      "A deterministic rule was inferred from the available evidence.",
      "The inferred rule was replayed against every original row.",
      "Flagged rows differ from the output predicted by that inferred rule.",
    ],
    whatThisReportDoesNotProve: [
      "It does not prove the inferred rule is what a human intended.",
      "It does not prove that a consistently wrong batch is semantically correct.",
      "It does not verify rows that were not included in the pasted or imported data.",
    ],
    summary: {
      verdict: run.verdict,
      verdictText: verdictTextForRun(run),
      auditSummaryText: auditSummaryText(run),
      totalRows: proof.totalRows,
      passedRows: proof.passedRows,
      flaggedRowCount: proof.flaggedCount,
      flaggedRows: proof.flaggedRows,
      flaggedRowLabels: proof.flaggedRowLabels,
      evidenceBasis: proof.evidenceBasis,
    },
    verdict: run.verdict,
    activeSample: run.activeSample || null,
    formats: {
      original: run.originalFormat || state.formats.original,
      transformed: run.transformedFormat || run.outputFormat || state.formats.transformed,
    },
    rule: {
      status: run.result?.status || null,
      stepCount: run.result?.rule?.program?.ops?.length || 0,
      steps: (run.result?.rule?.program?.ops || []).map(opLine),
      program: run.result?.rule?.program || null,
    },
    ruleStatus: run.result?.status || null,
    ruleStepCount: proof.ruleStepCount,
    ruleSteps: (run.result?.rule?.program?.ops || []).map(opLine),
    totalRows: proof.totalRows,
    passedRows: proof.passedRows,
    flaggedRowCount: proof.flaggedCount,
    flaggedRowNumbers: proof.flaggedRows,
    flaggedRowLabels: proof.flaggedRowLabels,
    failureGroups,
    flaggedOnly,
    flaggedRows,
  };
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadVerifyReport(flaggedOnly = false) {
  if (!state.run || state.run.error) return;
  const report = reportForRun(state.run, { flaggedOnly });
  downloadJson(flaggedOnly ? report.flaggedRows : report, flaggedOnly ? "latentmachine-verify-flagged-rows.json" : "latentmachine-verify-report.json");
}

async function copyAuditSummary() {
  if (!state.run || state.run.error) return;
  try {
    if (!await copyText(auditSummaryText(state.run))) throw new Error("The audit summary could not be copied.");
    state.summaryCopied = true;
    state.shareNotice = "Audit summary copied.";
    render();
    window.clearTimeout(summaryTimer);
    summaryTimer = window.setTimeout(() => {
      state.summaryCopied = false;
      render();
    }, 1500);
  } catch (error) {
    state.shareNotice = error?.message || "The audit summary could not be copied.";
    render();
  }
}

function resultHtml() {
  if (!state.run) {
    return "";
  }
  if (state.run.error) {
    return `<section class="result-card verify-result">${diagnosticHtml(state.run.error)}</section>`;
  }
  return state.run.verdict === "safe" ? consistentResultHtml(state.run) : inconsistentResultHtml(state.run);
}

function render() {
  verify.innerHTML = `<section class="app-shell">
    <header class="tool-header">
      <p class="section-label">Verify</p>
      <h1>Did the AI Get Every Row Right?</h1>
      <p class="tool-subhead">Paste the original records and what the AI returned. Latentmachine checks whether every row follows one deterministic rule.</p>
    </header>

    <div class="verify-presets">
      <label class="section-label" for="verify-sample">Try a sample</label>
      <select class="format-chip" id="verify-sample" data-verify-sample>
        <option value="">Choose a preset</option>
        ${VERIFY_SAMPLES.map(sample => `<option value="${esc(sample.id)}" ${state.activeSample === sample.id ? "selected" : ""}>${esc(sample.label)}</option>`).join("")}
      </select>
    </div>

    <section class="verify-imports" aria-label="Import files">
      ${verifyFileImportPanel("Import original", "original")}
      ${verifyFileImportPanel("Import AI output", "transformed")}
    </section>

    <section class="verify-inputs">
      ${editor("Original records", "original")}
      <div class="pair-arrow" aria-hidden="true">→</div>
      ${editor("AI output", "transformed")}
    </section>

    <section class="action-bar verify-actions">
      <button class="button is-primary" type="button" data-run-verify>Check every row</button>
      <button class="button" type="button" data-share-verify>${state.copied ? "Link copied" : "Share"}</button>
      ${state.run && !state.run.error ? `<button class="button" type="button" data-copy-audit-summary>${state.summaryCopied ? "Summary copied" : "Copy audit summary"}</button>` : ""}
      ${state.run && !state.run.error ? `<button class="button" type="button" data-download-verify-report>Download verification report</button>` : ""}
      ${state.run && !state.run.error && state.run.flagged?.length ? `<button class="button" type="button" data-download-verify-flagged>Download flagged rows</button>` : ""}
    </section>

    ${cockpitHtml()}

    ${state.importNotice ? `<div class="format-diagnostic is-${esc(state.importNotice.tone)}"><p>${esc(state.importNotice.text)}</p></div>` : ""}
    ${state.shareNotice ? `<div class="reasoning-hint"><p>${esc(state.shareNotice)}</p></div>` : ""}

    ${resultHtml()}
  </section>`;
}

function invalidateVerifyInput(key) {
  state.activeSample = "";
  state.importNotice = null;
  state.shareNotice = "";
  state.run = null;
  state.activeFlagIndex = 0;
  state.summaryCopied = false;

  const sampleSelect = verify.querySelector("[data-verify-sample]");
  if (sampleSelect) sampleSelect.value = "";

  const actions = verify.querySelector(`[data-editor-actions="${key}"]`);
  if (actions) actions.innerHTML = formatChip(key);

  const meta = verify.querySelector(`[data-pane-meta="${key}"]`);
  if (meta) meta.outerHTML = paneMetaHtml(key === "original" ? "Original records" : "AI output", key);

  const cockpit = verify.querySelector("[data-verify-cockpit]");
  if (cockpit) cockpit.outerHTML = cockpitHtml();

  verify.querySelectorAll("[data-copy-audit-summary], [data-download-verify-report], [data-download-verify-flagged]")
    .forEach(button => button.remove());

  verify.querySelectorAll(".verify-result").forEach(node => node.remove());

  const shell = verify.querySelector(".app-shell");
  if (!shell) return;
  [...shell.children]
    .filter(node => node.classList?.contains("format-diagnostic") || node.classList?.contains("reasoning-hint"))
    .forEach(node => node.remove());
}

verify.addEventListener("input", event => {
  const key = event.target?.dataset?.verifyEditor;
  if (!key) return;
  state[key] = event.target.value;
  invalidateVerifyInput(key);
});

verify.addEventListener("change", event => {
  if (event.target?.matches?.("[data-verify-sample]")) return loadVerifySample(event.target.value);
  const fileKey = event.target?.dataset?.verifyFile;
  if (fileKey) {
    importVerifyFileList(fileKey, event.target.files);
    event.target.value = "";
    return;
  }
  const key = event.target?.dataset?.formatFor;
  if (!key) return;
  state.formats[key] = event.target.value;
  state.run = null;
  state.activeFlagIndex = 0;
  render();
});

verify.addEventListener("click", event => {
  if (event.target?.matches?.("[data-run-verify]")) return runVerify();
  if (event.target?.matches?.("[data-share-verify]")) return shareVerifyState();
  if (event.target?.matches?.("[data-copy-audit-summary]")) return copyAuditSummary();
  if (event.target?.matches?.("[data-download-verify-report]")) return downloadVerifyReport(false);
  if (event.target?.matches?.("[data-download-verify-flagged]")) return downloadVerifyReport(true);
  const reviewMode = event.target?.dataset?.reviewMode;
  if (reviewMode) {
    state.reviewMode = reviewMode;
    return render();
  }
  const nav = event.target?.dataset?.flagNav;
  if (nav && state.run?.flagged?.length) {
    state.reviewMode = "current";
    state.activeFlagIndex += nav === "next" ? 1 : -1;
    clampFlagIndex(state.run);
    return render();
  }
});

verify.addEventListener("dragover", event => {
  const dropZone = event.target.closest("[data-verify-file-drop]");
  if (!dropZone || !hasDraggedFiles(event)) return;
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

verify.addEventListener("dragleave", event => {
  const dropZone = event.target.closest("[data-verify-file-drop]");
  if (!dropZone) return;
  dropZone.classList.remove("is-dragging");
});

verify.addEventListener("drop", event => {
  const dropZone = event.target.closest("[data-verify-file-drop]");
  if (!dropZone || !hasDraggedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.remove("is-dragging");
  importVerifyFileList(dropZone.dataset.verifyFileDrop, event.dataTransfer?.files);
});

document.addEventListener("dragover", event => {
  if (hasDraggedFiles(event)) event.preventDefault();
});

document.addEventListener("drop", event => {
  if (hasDraggedFiles(event)) event.preventDefault();
});

verify.addEventListener("keydown", event => {
  const commandKey = event.metaKey || event.ctrlKey;
  if (commandKey && event.key === "Enter") {
    event.preventDefault();
    return runVerify();
  }
  if (isTypingTarget(event.target)) return;
  if (event.key === "Escape" && (state.reviewMode === "current" || state.shareNotice)) {
    event.preventDefault();
    state.reviewMode = "all";
    state.shareNotice = "";
    return render();
  }
  if (commandKey && event.shiftKey && event.key.toLowerCase() === "r") {
    event.preventDefault();
    return downloadVerifyReport(false);
  }
  if (!state.run?.flagged?.length) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    state.reviewMode = "current";
    state.activeFlagIndex += event.key === "ArrowRight" ? 1 : -1;
    clampFlagIndex(state.run);
    render();
  }
});

async function shareVerifyState() {
  try {
    const url = await shareUrlForState({
      original: state.original,
      transformed: state.transformed,
      formats: { ...state.formats },
    });
    if (!await copyText(url)) throw new Error("The share link could not be copied.");
    state.copied = true;
    state.shareNotice = "Share link copied.";
    render();
    window.clearTimeout(shareTimer);
    shareTimer = window.setTimeout(() => {
      state.copied = false;
      render();
    }, 1500);
  } catch (error) {
    state.shareNotice = error?.message || "The share link could not be created.";
    render();
  }
}

async function initialize() {
  try {
    const shared = await sharedStateFromLocation();
    if (shared) {
      state.original = String(shared.original ?? "");
      state.transformed = String(shared.transformed ?? "");
      state.formats = {
        original: String(shared.formats?.original || "auto"),
        transformed: String(shared.formats?.transformed || "auto"),
      };
      state.shareNotice = "Shared check restored from this URL.";
      state.activeFlagIndex = 0;
      state.reviewMode = "all";
      if (state.original && state.transformed) return runVerify();
    }
  } catch (error) {
    state.shareNotice = error?.message || "This share link could not be restored.";
  }
  render();
}

initialize();
