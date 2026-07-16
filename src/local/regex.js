import { runRegexBuilder, testRegexPattern } from "../intelligence/regex-builder/engine.js";
import { esc } from "./shared.js";
import { copyText, shareUrlForState, sharedStateFromLocation } from "./share-state.js";

const root = document.querySelector("#regex");

const REGEX_PRESETS = [
  {
    id: "phone",
    label: "Phone numbers",
    examples: [
      { id: "phone-match-1", text: "555-1234", kind: "match" },
      { id: "phone-match-2", text: "212-9876", kind: "match" },
      { id: "phone-reject-1", text: "555-123", kind: "reject" },
      { id: "phone-reject-2", text: "abc-1234", kind: "reject" },
    ],
    preview: "555-1234\n555-123\n212-9876\nabc-1234",
  },
  {
    id: "email",
    label: "Email addresses",
    examples: [
      { id: "email-match-1", text: "ada@example.com", kind: "match" },
      { id: "email-match-2", text: "grace.hopper@navy.mil", kind: "match" },
      { id: "email-reject-1", text: "not-an-email", kind: "reject" },
      { id: "email-reject-2", text: "ada@example", kind: "reject" },
    ],
    preview: "ada@example.com\nnot-an-email\ngrace.hopper@navy.mil\nada@example",
  },
  {
    id: "invoice",
    label: "Invoice IDs",
    examples: [
      { id: "invoice-match-1", text: "INV-2026-0042", kind: "match" },
      { id: "invoice-match-2", text: "INV-2025-1088", kind: "match" },
      { id: "invoice-reject-1", text: "2026-0042", kind: "reject" },
      { id: "invoice-reject-2", text: "INV-26-42", kind: "reject" },
    ],
    preview: "INV-2026-0042\n2026-0042\nINV-2025-1088\nINV-26-42",
  },
  {
    id: "date",
    label: "ISO dates",
    examples: [
      { id: "date-match-1", text: "2026-06-23", kind: "match" },
      { id: "date-match-2", text: "2024-03-15", kind: "match" },
      { id: "date-reject-1", text: "23/06/2026", kind: "reject" },
      { id: "date-reject-2", text: "2026-6-23", kind: "reject" },
    ],
    preview: "2026-06-23\n23/06/2026\n2024-03-15\n2026-6-23",
  },
  {
    id: "slug",
    label: "URL slugs",
    examples: [
      { id: "slug-match-1", text: "case-study-page", kind: "match" },
      { id: "slug-match-2", text: "regex-builder-polish", kind: "match" },
      { id: "slug-reject-1", text: "Case Study Page", kind: "reject" },
      { id: "slug-reject-2", text: "regex_builder", kind: "reject" },
    ],
    preview: "case-study-page\nCase Study Page\nregex-builder-polish\nregex_builder",
  },
  {
    id: "log",
    label: "Log lines",
    examples: [
      { id: "log-match-1", text: "2026-06-23 INFO api ready", kind: "match" },
      { id: "log-match-2", text: "2026-06-24 WARN cache cold", kind: "match" },
      { id: "log-reject-1", text: "INFO api ready", kind: "reject" },
      { id: "log-reject-2", text: "2026/06/23 INFO api ready", kind: "reject" },
    ],
    captures: [
      { positiveIndex: 0, start: 0, end: 10, name: "date" },
      { positiveIndex: 0, start: 11, end: 15, name: "level" },
    ],
    preview: "2026-06-23 INFO api ready\nINFO api ready\n2026-06-24 WARN cache cold\n2026/06/23 INFO api ready",
  },
];

const state = {
  examples: [
    { id: "match-1", text: "555-1234", kind: "match" },
    { id: "match-2", text: "212-9876", kind: "match" },
    { id: "reject-1", text: "555-123", kind: "reject" },
  ],
  captures: [],
  anchored: true,
  flavor: "js",
  preview: "555-1234\n555-123\n212-9876\nabc-1234",
  result: null,
  copied: false,
  copiedKind: "",
  activePreset: "phone",
  shareCopied: false,
  shareNotice: "",
};

let shareTimer = null;
let copyTimer = null;

function positives() {
  return state.examples.filter(example => example.kind === "match").map(example => example.text).filter(Boolean);
}

function positiveExamples() {
  return state.examples.filter(example => example.kind === "match" && example.text);
}

function negatives() {
  return state.examples.filter(example => example.kind === "reject").map(example => example.text).filter(Boolean);
}

function capturePayload() {
  const matches = positiveExamples();
  return state.captures.map(capture => ({
    positiveIndex: matches.findIndex(example => example.id === capture.exampleId),
    start: capture.start,
    end: capture.end,
    name: capture.name,
  })).filter(capture => capture.positiveIndex >= 0);
}

function build() {
  state.result = runRegexBuilder({
    positives: positives(),
    negatives: negatives(),
    captures: capturePayload(),
    anchored: state.anchored,
    flavor: state.flavor,
  });
}

function exampleId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function loadPreset(id) {
  const preset = REGEX_PRESETS.find(item => item.id === id) || REGEX_PRESETS[0];
  state.examples = preset.examples.map(example => ({ ...example }));
  const matches = state.examples.filter(example => example.kind === "match" && example.text);
  state.captures = (preset.captures || []).map((capture, index) => {
    const example = matches[capture.positiveIndex] || matches[0];
    return {
      id: `preset-capture-${preset.id}-${index}`,
      exampleId: example?.id || "",
      exampleText: example?.text || "",
      start: capture.start,
      end: capture.end,
      value: example?.text?.slice(capture.start, capture.end) || "",
      name: capture.name,
    };
  }).filter(capture => capture.exampleId);
  state.preview = preset.preview;
  state.activePreset = preset.id;
  state.result = null;
  build();
}

function currentShareState() {
  return {
    examples: state.examples,
    captures: state.captures.map(({ id, ...capture }) => capture),
    anchored: state.anchored,
    flavor: state.flavor,
    preview: state.preview,
  };
}

function applySharedState(shared) {
  if (!shared || !Array.isArray(shared.examples)) throw new Error("This share link does not contain regex examples.");
  state.examples = shared.examples.map((example, index) => ({
    id: String(example.id || exampleId(`row-${index}`)),
    text: String(example.text || ""),
    kind: example.kind === "reject" ? "reject" : "match",
  }));
  state.captures = Array.isArray(shared.captures) ? shared.captures.map((capture, index) => ({
    id: String(capture.id || `shared-capture-${index}`),
    exampleId: String(capture.exampleId || ""),
    exampleText: String(capture.exampleText || ""),
    start: Number(capture.start || 0),
    end: Number(capture.end || 0),
    value: String(capture.value || ""),
    name: String(capture.name || `g${index + 1}`),
  })) : [];
  state.anchored = shared.anchored !== false;
  state.flavor = ["js", "pcre", "python", "java"].includes(shared.flavor) ? shared.flavor : "js";
  state.preview = String(shared.preview || "");
  state.activePreset = "";
  state.shareNotice = "Shared regex state restored from this URL.";
  build();
}

function exportSnippets(result = state.result) {
  if (!result?.pattern) return {};
  const js = result.patterns?.js || result.pattern;
  const python = result.patterns?.python || result.pattern;
  const pcre = result.patterns?.pcre || result.pattern;
  return {
    regex: result.pattern,
    js: `const pattern = new RegExp(${JSON.stringify(js)});`,
    python: `import re\npattern = re.compile(r${JSON.stringify(python)})`,
    pcre,
  };
}

async function copyValue(kind = "regex") {
  const snippets = exportSnippets();
  const value = snippets[kind] || snippets.regex;
  if (!value) return;
  if (await copyText(value)) {
    state.copied = true;
    state.copiedKind = kind;
    render();
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      state.copied = false;
      state.copiedKind = "";
      render();
    }, 1200);
  }
}

async function shareRegexState() {
  try {
    const url = await shareUrlForState(currentShareState());
    if (!await copyText(url)) throw new Error("The share link could not be copied.");
    state.shareCopied = true;
    state.shareNotice = "Share link copied.";
    render();
    window.clearTimeout(shareTimer);
    shareTimer = window.setTimeout(() => {
      state.shareCopied = false;
      render();
    }, 1500);
  } catch (error) {
    state.shareNotice = error?.message || "The share link could not be created.";
    render();
  }
}

function statusTone(status) {
  if (status === "safe") return "safe";
  if (status === "ambiguous") return "warn";
  return "danger";
}

function statusText(result) {
  if (!result) return "Ready";
  if (result.status === "safe") return `Matches all ${positives().length}, rejects all ${negatives().length}`;
  if (result.status === "ambiguous") return "Your examples don't pin this down";
  return "These examples can't all be satisfied";
}

function diagnosisHint(result) {
  if (!result) return null;
  const diagnosis = result.diagnosis || {};
  const contradiction = diagnosis.contradictions?.[0];
  const ambiguity = diagnosis.ambiguities?.[0];
  const hasCaptures = state.captures.length > 0;
  const hasRejects = negatives().length > 0;

  if (contradiction?.type === "no-positive") {
    return { tone: "danger", label: "Too narrow", text: "Add at least one match example so the builder has a target to learn from." };
  }
  if (contradiction?.type === "negative-still-matches") {
    return { tone: "danger", label: "Too broad", text: "A reject example still fits the narrowest candidate. Add a more specific match, another reject, or capture the stable part you actually need." };
  }
  if (contradiction) {
    return { tone: "danger", label: "Conflict", text: contradiction.message || "The current examples contradict each other." };
  }
  if (ambiguity) {
    const captureText = hasCaptures ? " Named captures are preserved, but another reject example will make their boundaries less surprising." : "";
    return { tone: "warn", label: hasRejects ? "Needs a sharper reject" : "Needs a reject example", text: `${ambiguity.message || "The examples still allow multiple reasonable patterns."}${captureText}` };
  }
  return { tone: "safe", label: hasCaptures ? "Captures verified" : "Verified", text: "The pattern matches every match example and rejects every reject example." };
}

function rowHtml(example, index) {
  const isMatch = example.kind === "match";
  return `<div class="example-row">
    <div class="example-toggle" role="group" aria-label="Example type">
      <button class="button ${isMatch ? "is-primary" : "is-subtle"}" type="button" data-kind="${esc(example.id)}" data-value="match">Match</button>
      <button class="button ${!isMatch ? "is-primary" : "is-subtle"}" type="button" data-kind="${esc(example.id)}" data-value="reject">Reject</button>
    </div>
    <div class="editor">
      <div class="editor-bar">
        <span>${isMatch ? "Should match" : "Should reject"} ${index + 1}</span>
        ${isMatch ? `<button class="button is-subtle" type="button" data-capture="${esc(example.id)}">Capture selection</button>` : ""}
      </div>
      <textarea data-example="${esc(example.id)}" spellcheck="false" rows="2" aria-label="${isMatch ? "Match" : "Reject"} example">${esc(example.text)}</textarea>
    </div>
  </div>`;
}

function capturesHtml() {
  return `<section class="capture-surface">
    <div>
      <p class="section-label">Captures</p>
      <p>Select text inside a match row, then capture it as a named group.</p>
    </div>
    ${state.captures.length ? `<div class="rule-lines">
      ${state.captures.map(capture => `<p><input class="format-chip" data-capture-name="${esc(capture.id)}" value="${esc(capture.name)}" aria-label="Capture name" /> captures <code>${esc(capture.value)}</code> from <code>${esc(capture.exampleText)}</code> <button class="icon-button" type="button" data-remove-capture="${esc(capture.id)}" aria-label="Remove capture">x</button></p>`).join("")}
    </div>` : `<p class="example-note">No capture groups yet.</p>`}
  </section>`;
}

function optionsHtml() {
  return `<section class="action-bar">
    <label class="format-chip">
      <input type="checkbox" data-anchored ${state.anchored ? "checked" : ""} />
      Whole string
    </label>
    <select class="format-chip" data-flavor aria-label="Regex flavor">
      ${["js", "pcre", "python", "java"].map(flavor => `<option value="${flavor}" ${state.flavor === flavor ? "selected" : ""}>${flavor.toUpperCase()}</option>`).join("")}
    </select>
    <button class="button is-primary" type="button" data-build>Build regex</button>
    <button class="button is-subtle" type="button" data-add-row>Add row</button>
    <button class="button" type="button" data-share-regex>${state.shareCopied ? "Link copied" : "Share"}</button>
  </section>`;
}

function presetsHtml() {
  return `<section class="verify-presets regex-presets">
    <label class="section-label" for="regex-preset">Try a sample</label>
    <select class="format-chip" id="regex-preset" data-regex-preset>
      ${state.activePreset ? "" : `<option value="" selected>Custom shared state</option>`}
      ${REGEX_PRESETS.map(preset => `<option value="${esc(preset.id)}" ${state.activePreset === preset.id ? "selected" : ""}>${esc(preset.label)}</option>`).join("")}
    </select>
  </section>`;
}

function previewHtml(result) {
  const pattern = result?.patterns?.js || result?.pattern || "";
  const test = pattern ? testRegexPattern(pattern, state.preview) : { matches: [] };
  const lines = state.preview.split(/\r?\n/);
  const captureRows = [];
  return `<section class="match-preview">
    <div class="editor">
      <div class="editor-bar"><span>Live preview</span><span>${test.matches?.length || 0} match${test.matches?.length === 1 ? "" : "es"}</span></div>
      <textarea data-preview spellcheck="false" rows="5" aria-label="Preview strings">${esc(state.preview)}</textarea>
    </div>
    <div class="rule-lines">
      ${lines.map(line => {
        let matched = false;
        let groups = {};
        if (pattern) {
          try {
            const match = new RegExp(pattern).exec(line);
            matched = !!match;
            groups = match?.groups || {};
            if (matched && Object.keys(groups).length) captureRows.push({ line, groups });
          } catch {}
        }
        return `<p>${matched ? "<mark>match</mark>" : "<span>reject</span>"} <code>${esc(line || " ")}</code>${Object.keys(groups).length ? ` <small>${Object.entries(groups).map(([name, value]) => `${esc(name)}=${esc(value)}`).join(" · ")}</small>` : ""}</p>`;
      }).join("")}
    </div>
    ${captureRows.length ? `<div class="capture-table">
      <div class="section-label">Captured values</div>
      ${captureRows.slice(0, 6).map(row => `<div class="capture-table-row">
        <code>${esc(row.line)}</code>
        <p>${Object.entries(row.groups).map(([name, value]) => `<span>${esc(name)}: <strong>${esc(value)}</strong></span>`).join(" ")}</p>
      </div>`).join("")}
    </div>` : ""}
  </section>`;
}

function resultHtml() {
  const result = state.result;
  if (!result) return `<section class="empty-state"><p>Add match and reject examples, then build a regex.</p></section>`;
  const tone = statusTone(result.status);
  const pattern = result.pattern || "";
  const diagnosis = result.diagnosis || {};
  const hint = diagnosisHint(result);
  const snippets = exportSnippets(result);

  return `<section class="regex-output result-card">
    <aside class="status-pill is-${tone}">
      <div class="inspection-head"><span>Verdict</span><strong>${esc(statusText(result))}</strong></div>
    </aside>
    <div class="result-head">
      <div>
        <h2>${result.status === "safe" ? "Verified pattern" : result.status === "ambiguous" ? "Safe draft with missing evidence" : "No verified pattern"}</h2>
      </div>
      <button class="icon-button" type="button" data-copy aria-label="Copy regex">${state.copied ? "ok" : "c"}</button>
    </div>
    ${pattern ? `<div class="rule-section">
      <div class="flavor-tabs">
        ${Object.keys(result.patterns || {}).map(flavor => `<button class="button ${state.flavor === flavor ? "is-primary" : "is-subtle"}" type="button" data-set-flavor="${esc(flavor)}">${esc(flavor.toUpperCase())}</button>`).join("")}
      </div>
      <pre><code>${esc(pattern)}</code></pre>
    </div>` : ""}
    ${hint ? `<div class="reasoning-hint is-${esc(hint.tone)}"><p><strong>${esc(hint.label)}.</strong> ${esc(hint.text)}</p></div>` : ""}
    ${diagnosis.contradictions?.length ? `<div class="diagnosis-summary is-danger"><span>Conflict</span><span>${esc(diagnosis.contradictions[0].message)}</span></div>` : ""}
    ${diagnosis.ambiguities?.length ? `<section class="test-section">
      <div class="section-label">Next example</div>
      ${diagnosis.suggestedExamples.map(item => `<article class="test-card"><p>${esc(item.reason)}</p><code>${esc(item.value)}</code><button class="button is-subtle suggestion-action" type="button" data-add-suggested="${esc(item.value)}">Add as reject</button></article>`).join("")}
    </section>` : ""}
    ${pattern ? `<section class="regex-export-panel">
      <div>
        <p class="section-label">Export</p>
        <h3>Copy the pattern in the shape your codebase needs.</h3>
      </div>
      <div class="regex-export-grid">
        ${[
          ["regex", "Plain regex", snippets.regex],
          ["js", "JavaScript RegExp", snippets.js],
          ["python", "Python re", snippets.python],
          ["pcre", "PCRE pattern", snippets.pcre],
        ].map(([kind, label, value]) => `<article class="regex-export-card">
          <div><span>${esc(label)}</span><button class="button is-subtle" type="button" data-copy-kind="${esc(kind)}">${state.copied && state.copiedKind === kind ? "Copied" : "Copy"}</button></div>
          <code>${esc(value)}</code>
        </article>`).join("")}
      </div>
    </section>` : ""}
    <div class="rule-spec">
      <div class="rule-section">
        <div class="section-label">Explanation</div>
        <div class="rule-lines">${result.explanation.map(line => `<p>${esc(line)}</p>`).join("")}</div>
      </div>
      <div class="rule-section">
        <div class="section-label">Verification</div>
        <div class="rule-lines">
          <p>${result.verification.ok ? "Every match/reject example passed." : "The candidate failed verification and was not trusted."}</p>
          ${result.verification.positiveFailures?.length ? `<p>Missed matches: ${esc(result.verification.positiveFailures.join(", "))}</p>` : ""}
          ${result.verification.negativeFailures?.length ? `<p>Still matches rejects: ${esc(result.verification.negativeFailures.join(", "))}</p>` : ""}
        </div>
      </div>
    </div>
    ${previewHtml(result)}
  </section>`;
}

function render() {
  root.innerHTML = `<section class="app-shell">
    <header class="tool-header">
      <p class="section-label">Regex</p>
      <h1>Build Regex Patterns from Match and Reject Examples</h1>
      <p class="tool-subhead">Give strings that should match and shouldn't. Get a verified pattern you can read.</p>
    </header>

    ${presetsHtml()}
    ${state.shareNotice ? `<div class="reasoning-hint is-safe"><strong>Share state.</strong> ${esc(state.shareNotice)}</div>` : ""}

    <section class="example-rows">
      ${state.examples.map(rowHtml).join("")}
    </section>

    ${capturesHtml()}
    ${optionsHtml()}
    ${resultHtml()}
  </section>`;
}

function exampleById(id) {
  return state.examples.find(example => example.id === id);
}

function addCapture(id) {
  const example = exampleById(id);
  if (!example || example.kind !== "match") return;
  const field = root.querySelector(`[data-example="${CSS.escape(id)}"]`);
  if (!field || field.selectionEnd <= field.selectionStart) return;
  const value = field.value.slice(field.selectionStart, field.selectionEnd);
  const count = state.captures.length + 1;
  state.captures.push({
    id: `capture-${Date.now().toString(36)}-${count}`,
    exampleId: example.id,
    exampleText: example.text,
    start: field.selectionStart,
    end: field.selectionEnd,
    value,
    name: `g${count}`,
  });
  build();
  render();
}

async function copyPattern() {
  return copyValue("regex");
}

function isTypingTarget(target) {
  const tag = target?.tagName?.toLowerCase();
  return tag === "textarea" || tag === "input" || tag === "select" || target?.isContentEditable;
}

root.addEventListener("input", event => {
  const id = event.target?.dataset?.example;
  if (id) {
    const example = exampleById(id);
    if (example) example.text = event.target.value;
    state.result = null;
    return;
  }
  if (event.target?.dataset?.preview !== undefined) {
    const selectionStart = event.target.selectionStart;
    const selectionEnd = event.target.selectionEnd;
    state.preview = event.target.value;
    const preview = root.querySelector(".match-preview");
    if (!preview || !state.result) return render();
    preview.outerHTML = previewHtml(state.result);
    const field = root.querySelector("[data-preview]");
    if (field) {
      field.focus();
      field.selectionStart = selectionStart;
      field.selectionEnd = selectionEnd;
    }
  }
});

root.addEventListener("change", event => {
  if (event.target?.dataset?.regexPreset !== undefined) {
    loadPreset(event.target.value);
    render();
    return;
  }
  if (event.target?.dataset?.anchored !== undefined) {
    state.anchored = event.target.checked;
    if (state.result) build();
    render();
    return;
  }
  if (event.target?.dataset?.flavor !== undefined) {
    state.flavor = event.target.value;
    if (state.result) build();
    render();
    return;
  }
  const captureName = event.target?.dataset?.captureName;
  if (captureName !== undefined) {
    const capture = state.captures.find(item => item.id === captureName);
    if (capture) capture.name = event.target.value;
    if (state.result) build();
    render();
  }
});

root.addEventListener("click", event => {
  const copyKind = event.target.closest("[data-copy-kind]");
  if (copyKind) return copyValue(copyKind.dataset.copyKind);

  const kind = event.target.closest("[data-kind]");
  if (kind) {
    const example = exampleById(kind.dataset.kind);
    if (example) example.kind = kind.dataset.value === "reject" ? "reject" : "match";
    state.result = null;
    return render();
  }

  const capture = event.target.closest("[data-capture]");
  if (capture) return addCapture(capture.dataset.capture);

  const removeCapture = event.target.closest("[data-remove-capture]");
  if (removeCapture) {
    state.captures = state.captures.filter(item => item.id !== removeCapture.dataset.removeCapture);
    if (state.result) build();
    return render();
  }

  const addSuggested = event.target.closest("[data-add-suggested]");
  if (addSuggested) {
    state.examples.push({ id: `reject-${Date.now().toString(36)}`, text: addSuggested.dataset.addSuggested, kind: "reject" });
    build();
    return render();
  }

  const setFlavor = event.target.closest("[data-set-flavor]");
  if (setFlavor) {
    state.flavor = setFlavor.dataset.setFlavor;
    if (state.result) build();
    return render();
  }

  if (event.target.closest("[data-add-row]")) {
    state.examples.push({ id: `row-${Date.now().toString(36)}`, text: "", kind: "match" });
    state.result = null;
    return render();
  }

  if (event.target.closest("[data-build]")) {
    build();
    return render();
  }

  if (event.target.closest("[data-share-regex]")) return shareRegexState();

  if (event.target.closest("[data-copy]")) return copyPattern();
});

document.addEventListener("keydown", event => {
  const key = event.key?.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "enter") {
    event.preventDefault();
    build();
    render();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "c") {
    event.preventDefault();
    copyValue("regex");
    return;
  }
  if (event.key === "Escape" && !isTypingTarget(event.target) && state.shareNotice) {
    state.shareNotice = "";
    render();
  }
});

async function initialize() {
  try {
    const shared = await sharedStateFromLocation();
    if (shared) {
      applySharedState(shared);
    } else {
      loadPreset(state.activePreset);
    }
  } catch (error) {
    state.shareNotice = error?.message || "The shared regex state could not be restored.";
    loadPreset("phone");
  }
  render();
}

initialize();
