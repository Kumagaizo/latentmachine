import {
  generateJavaScriptTransform,
  generateJqQuery,
  generateJsonPath,
} from "../intelligence/json-transform/exporters.js";
import { executeJsonTransform } from "../intelligence/json-transform/runtime.js";
import { deepEqual } from "../intelligence/json-transform/shared.js";
import { runTransform } from "../intelligence/json-transform/translator.js";
import { esc } from "./shared.js";
import { validateImportFile, validateImportText } from "./file-import.js";
import { copyText, shareUrlForState, sharedStateFromLocation } from "./share-state.js";

const root = document.querySelector("#jq");

const sampleJson = `{
  "users": [
    { "id": 1, "email": "ada@example.com", "active": true },
    { "id": 2, "email": "grace@example.com", "active": false },
    { "id": 3, "email": "linus@example.com", "active": true }
  ],
  "team": "platform"
}`;

const sampleOutput = `{
  "emails": [
    "ada@example.com",
    "linus@example.com"
  ]
}`;

const analyticsJson = `{
  "account": {
    "id": "acct_42",
    "owner": {
      "name": "Ada Lovelace",
      "email": "ada@example.com"
    }
  },
  "plan": "pro"
}`;

const ordersJson = `{
  "orders": [
    { "id": "ord_1", "status": "paid", "total": 49.99, "customer": { "email": "ada@example.com" } },
    { "id": "ord_2", "status": "draft", "total": 29.5, "customer": { "email": "grace@example.com" } },
    { "id": "ord_3", "status": "paid", "total": 15, "customer": { "email": "linus@example.com" } }
  ],
  "store": "latent-shop"
}`;

const emailFindJson = `{
  "emails": [
    { "type": "work", "value": "ada@work.example" },
    { "type": "home", "value": "ada@home.example" }
  ]
}`;

const emailFindJsonTwo = `{
  "emails": [
    { "type": "home", "value": "grace@home.example" },
    { "type": "work", "value": "grace@work.example" }
  ]
}`;

const JQ_PRESETS = [
  {
    id: "nested-field",
    label: "Nested field",
    description: "Pick one nested value and get both jq and JSONPath.",
    mode: "pick",
    jsonText: analyticsJson,
    outputText: sampleOutput,
    selections: [pathKey(["account", "owner", "email"])],
  },
  {
    id: "array-values",
    label: "Array values",
    description: "Select one array field and choose every matching item.",
    mode: "pick",
    jsonText: sampleJson,
    outputText: sampleOutput,
    selections: [pathKey(["users", 0, "email"])],
    pickScope: "all",
  },
  {
    id: "filter-status",
    label: "Filter by status",
    description: "Select matching rows; jq infers the status filter.",
    mode: "pick",
    jsonText: sampleJson,
    outputText: sampleOutput,
    selections: [pathKey(["users", 0, "email"]), pathKey(["users", 2, "email"])],
  },
  {
    id: "reshape-object",
    label: "Reshape object",
    description: "Show the desired object shape and build a verified jq expression.",
    mode: "reshape",
    jsonText: analyticsJson,
    outputText: `{
  "ownerEmail": "ada@example.com",
  "accountId": "acct_42"
}`,
  },
  {
    id: "count-paid",
    label: "Count paid rows",
    description: "Build a count query from a desired output example.",
    mode: "reshape",
    jsonText: ordersJson,
    outputText: `{
  "paidCount": 2
}`,
  },
  {
    id: "join-paid-emails",
    label: "Join paid emails",
    description: "Join filtered array values into one string.",
    mode: "reshape",
    jsonText: ordersJson,
    outputText: `{
  "paidEmails": "ada@example.com, linus@example.com"
}`,
  },
  {
    id: "find-retired",
    label: "Find work email",
    description: "Use two proof examples to find the first matching object and extract one field.",
    mode: "reshape",
    jsonText: emailFindJson,
    outputText: `{
  "email": "ada@work.example"
}`,
    examples: [
      { input: JSON.parse(emailFindJson), output: { email: "ada@work.example" } },
      { input: JSON.parse(emailFindJsonTwo), output: { email: "grace@work.example" } },
    ],
  },
];

const JQ_SAMPLE_GROUPS = [
  {
    id: "pick",
    label: "Pick values",
    description: "Load examples where clicking fields in the JSON tree proves the query.",
  },
  {
    id: "reshape",
    label: "Reshape output",
    description: "Load examples where the desired JSON output proves the query.",
  },
];

const state = {
  mode: "pick",
  queryView: "jq",
  jsonText: sampleJson,
  outputText: sampleOutput,
  selections: [],
  pickScope: null,
  reshape: null,
  copied: false,
  copiedKind: "",
  shareCopied: false,
  shareNotice: "",
  activePreset: "",
  importNotice: null,
};

let shareTimer = null;
let copyTimer = null;

function parseJson(text, label = "JSON") {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (error) {
    return { value: null, error: `${label}: ${error?.message || "Invalid JSON"}` };
  }
}

function pathKey(path) {
  return JSON.stringify(path);
}

function formatPath(path = [], rootToken = "$") {
  if (!path.length) return rootToken;
  return `${rootToken}${path.map(part => {
    if (typeof part === "number") return `[${part}]`;
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`;
  }).join("")}`;
}

function pathToJq(path = []) {
  return formatPath(path, ".").replace(/^\.\./, ".");
}

function pathToJsonPath(path = []) {
  return formatPath(path, "$");
}

function getAtPath(value, path = []) {
  return path.reduce((current, part) => current?.[part], value);
}

function primitive(value) {
  return value === null || typeof value !== "object";
}

function preview(value) {
  return JSON.stringify(value, null, 2);
}

function valueLabel(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  return String(value);
}

function parsePathKey(key) {
  try {
    const value = JSON.parse(key);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function arrayContext(path = []) {
  const index = path.findIndex(part => typeof part === "number");
  if (index < 0) return null;
  return {
    arrayPath: path.slice(0, index),
    index: path[index],
    extractPath: path.slice(index + 1),
    key: `${pathKey(path.slice(0, index))}:${pathKey(path.slice(index + 1))}`,
  };
}

function leafPaths(value, base = []) {
  if (Array.isArray(value)) return value.flatMap((item, index) => leafPaths(item, [...base, index]));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => leafPaths(item, [...base, key]));
  return [base];
}

function matchingFilter(input, context, selectedIndexes) {
  const rows = getAtPath(input, context.arrayPath);
  if (!Array.isArray(rows) || selectedIndexes.length < 2 || selectedIndexes.length >= rows.length) return null;
  const selected = new Set(selectedIndexes);
  const firstObject = rows.find(row => row && typeof row === "object" && !Array.isArray(row));
  if (!firstObject) return null;
  const candidates = leafPaths(firstObject).filter(path => pathKey(path) !== pathKey(context.extractPath));

  for (const path of candidates) {
    const selectedValue = getAtPath(rows[selectedIndexes[0]], path);
    if (selectedValue === undefined || selectedIndexes.some(index => !deepEqual(getAtPath(rows[index], path), selectedValue))) continue;
    const matched = rows
      .map((row, index) => deepEqual(getAtPath(row, path), selectedValue) ? index : null)
      .filter(index => index !== null);
    if (matched.length === selectedIndexes.length && matched.every(index => selected.has(index))) {
      return { path, equals: selectedValue };
    }
  }
  return null;
}

function selectedPaths() {
  return state.selections.map(parsePathKey);
}

function selectedSummary() {
  const count = state.selections.length;
  if (!count) return "No values selected";
  const paths = selectedPaths().map(path => formatPath(path));
  return `${count} selected: ${paths.slice(0, 3).join(", ")}${count > 3 ? ` +${count - 3} more` : ""}`;
}

function loadPreset(id) {
  const preset = JQ_PRESETS.find(item => item.id === id) || JQ_PRESETS[0];
  state.mode = preset.mode === "reshape" ? "reshape" : "pick";
  state.queryView = "jq";
  state.jsonText = preset.jsonText;
  state.outputText = preset.outputText || sampleOutput;
  state.selections = [...(preset.selections || [])];
  state.pickScope = preset.pickScope || null;
  state.reshape = null;
  state.activePreset = preset.id;
  state.importNotice = null;
  state.shareNotice = "";
  if (state.mode === "reshape") return buildReshape();
  render();
}

function startBlank() {
  state.mode = "pick";
  state.queryView = "jq";
  state.jsonText = "{\n}";
  state.outputText = "{\n}";
  state.selections = [];
  state.pickScope = null;
  state.reshape = null;
  state.activePreset = "";
  state.importNotice = null;
  state.shareNotice = "";
  render();
}

function activeResult() {
  const parsed = parseJson(state.jsonText);
  if (parsed.error) return { status: "danger", tone: "danger", message: parsed.error };
  return state.mode === "reshape" ? state.reshape : pickPlan(parsed.value);
}

function exportValues(result = activeResult()) {
  if (!result) return {};
  const jq = result.jq || "";
  const jsonPath = result.jsonPath || "";
  const current = state.queryView === "jsonpath" && jsonPath ? jsonPath : (jq || result.javascript || "");
  return {
    current,
    jq,
    jsonpath: jsonPath,
    shell: jq ? `jq ${JSON.stringify(jq)} input.json` : "",
    javascript: result.javascript || "",
  };
}

async function copyExport(kind = "current") {
  const values = exportValues();
  const value = values[kind] || values.current;
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

function downloadText(filename, text) {
  if (!text) return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadJq() {
  const jq = exportValues().jq;
  if (!jq) return;
  downloadText("latentmachine-query.jq", `${jq}\n`);
}

async function importJsonFile(file) {
  const validation = validateImportFile(file);
  if (!validation.ok) {
    state.importNotice = validation;
    return render();
  }
  if (validation.format !== "json") {
    state.importNotice = { tone: "danger", text: "jq Builder imports JSON files only." };
    return render();
  }

  try {
    const text = await file.text();
    const textValidation = validateImportText(text);
    if (!textValidation.ok) {
      state.importNotice = textValidation;
      return render();
    }
    const parsed = parseJson(text, "Imported JSON");
    if (parsed.error) {
      state.importNotice = { tone: "danger", text: parsed.error };
      return render();
    }
    state.jsonText = preview(parsed.value);
    state.selections = [];
    state.pickScope = null;
    state.reshape = null;
    state.activePreset = "";
    state.importNotice = { tone: "safe", text: `${file.name} imported.` };
    render();
  } catch (error) {
    state.importNotice = { tone: "danger", text: error?.message || "The JSON file could not be imported." };
    render();
  }
}

function jsonPathForArrayPlan(context, where = null) {
  const source = pathToJsonPath(context.arrayPath);
  const extract = context.extractPath.map(part => {
    if (typeof part === "number") return `[${part}]`;
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`;
  }).join("");
  if (!where) return `${source}[*]${extract}`;
  if (typeof where.equals === "string" || typeof where.equals === "number" || typeof where.equals === "boolean" || where.equals === null) {
    const predicate = `@${formatPath(where.path, "").replace(/^\./, ".")} == ${JSON.stringify(where.equals)}`;
    return `${source}[?(${predicate})]${extract}`;
  }
  return null;
}

function explainPick(plan) {
  if (plan.kind === "single") return [`Take the value at ${formatPath(plan.path)} exactly as shown.`];
  if (plan.kind === "many") return [`Return the selected paths as an array, in click order.`];
  if (plan.kind === "array") {
    const filter = plan.where ? ` where ${formatPath(plan.where.path)} is ${JSON.stringify(plan.where.equals)}` : "";
    return [`For each item in ${formatPath(plan.context.arrayPath)}${filter}, take ${formatPath(plan.context.extractPath)}.`];
  }
  return [];
}

function pickPlan(input) {
  const paths = state.selections.map(parsePathKey);
  if (!paths.length) {
    return {
      status: "empty",
      tone: "warn",
      title: "No values selected",
      message: "Click values in the JSON tree to build a jq expression.",
    };
  }

  if (paths.length === 1) {
    const path = paths[0];
    const context = arrayContext(path);
    if (context && !state.pickScope) {
      return {
        status: "ambiguous",
        tone: "warn",
        title: "One array item is ambiguous",
        message: `Did you mean only ${formatPath(path)}, or the same field from every item in ${formatPath(context.arrayPath)}?`,
        actions: true,
      };
    }
    if (context && state.pickScope === "all") return arrayPickPlan(input, context, null);
    return {
      status: "safe",
      tone: "safe",
      title: "Returns exactly what you selected",
      kind: "single",
      path,
      jq: pathToJq(path),
      jsonPath: pathToJsonPath(path),
      output: getAtPath(input, path),
    };
  }

  const contexts = paths.map(arrayContext);
  const firstContext = contexts[0];
  const sameArrayField = firstContext && contexts.every(context => context && context.key === firstContext.key);
  if (sameArrayField) {
    const selectedIndexes = [...new Set(contexts.map(context => context.index))].sort((a, b) => a - b);
    const where = matchingFilter(input, firstContext, selectedIndexes);
    return arrayPickPlan(input, firstContext, where);
  }

  return {
    status: "safe",
    tone: "safe",
    title: "Returns the selected values",
    kind: "many",
    jq: `[${paths.map(pathToJq).join(", ")}]`,
    jsonPath: null,
    output: paths.map(path => getAtPath(input, path)),
  };
}

function arrayPickPlan(input, context, where) {
  const rows = getAtPath(input, context.arrayPath) || [];
  const filtered = Array.isArray(rows)
    ? rows.filter(row => !where || deepEqual(getAtPath(row, where.path), where.equals))
    : [];
  const output = filtered.map(row => getAtPath(row, context.extractPath));
  const op = {
    op: "arrayMap",
    source: formatPath(context.arrayPath),
    extract: formatPath(context.extractPath),
    target: "$",
    ...(where ? { where: { path: formatPath(where.path), equals: where.equals } } : {}),
  };
  return {
    status: "safe",
    tone: "safe",
    title: where ? "Returns the matching items you selected" : "Returns every item at that field",
    kind: "array",
    context,
    where,
    jq: generateJqQuery({ ops: [op] }),
    jsonPath: jsonPathForArrayPlan(context, where),
    output,
  };
}

function renderTree(value, path = [], keyLabel = null) {
  const selected = state.selections.includes(pathKey(path));
  const label = keyLabel === null ? "" : `<span>${esc(keyLabel)}: </span>`;
  if (primitive(value)) {
    return `<button class="json-node ${selected ? "node-selected" : ""}" type="button" data-select-path="${esc(pathKey(path))}" aria-pressed="${selected ? "true" : "false"}" title="${esc(formatPath(path))}">
      <code>${label}${esc(valueLabel(value))}</code>
    </button>`;
  }
  if (Array.isArray(value)) {
    return `<div class="json-node">
      <code>${label}[</code>
      ${value.map((item, index) => renderTree(item, [...path, index], index)).join("")}
      <code>]</code>
    </div>`;
  }
  return `<div class="json-node">
    <code>${label}{</code>
    ${Object.entries(value).map(([key, item]) => renderTree(item, [...path, key], key)).join("")}
    <code>}</code>
  </div>`;
}

function statusText(result) {
  if (!result) return "Ready";
  if (result.status === "safe") return result.title || "Verified";
  if (result.status === "ambiguous") return "Needs one choice before emitting jq";
  if (result.status === "unsupported") return "Verified, but jq export needs fallback";
  if (result.status === "danger") return "Could not verify this result";
  return result.title || "Needs more evidence";
}

function queryTabs(result) {
  const hasJsonPath = !!result?.jsonPath;
  return `<div class="query-tabs" role="group" aria-label="Query output">
    <button class="format-chip ${state.queryView === "jq" ? "is-warn" : ""}" type="button" data-query-view="jq">jq</button>
    <button class="format-chip ${state.queryView === "jsonpath" ? "is-warn" : ""}" type="button" data-query-view="jsonpath" ${hasJsonPath ? "" : "disabled"}>JSONPath</button>
  </div>`;
}

function modeOnboardingHtml() {
  const modes = [
    {
      id: "pick",
      title: "Pick values",
      text: "Click fields in the JSON tree.",
    },
    {
      id: "reshape",
      title: "Reshape output",
      text: "Show the JSON result you want.",
    },
  ];
  const activeMode = modes.find(mode => mode.id === state.mode) || modes[0];
  return `<section class="jq-mode-row" aria-label="jq builder mode">
    <div class="jq-mode-guide" role="group" aria-label="Mode">
      ${modes.map(mode => `<button class="jq-mode-card ${state.mode === mode.id ? "is-active" : ""}" type="button" data-mode="${esc(mode.id)}" aria-pressed="${state.mode === mode.id ? "true" : "false"}">
        <span>${esc(mode.title)}</span>
      </button>`).join("")}
    </div>
    <p class="jq-mode-description">${esc(activeMode.text)}</p>
  </section>`;
}

function presetHtml() {
  const activeGroup = JQ_SAMPLE_GROUPS.some(group => group.id === state.mode) ? state.mode : "pick";
  const visiblePresets = JQ_PRESETS.filter(preset => preset.mode === activeGroup);
  const activePreset = visiblePresets.find(preset => preset.id === state.activePreset);
  const description = activePreset?.description || JQ_SAMPLE_GROUPS.find(group => group.id === activeGroup)?.description || "Load a targeted jq example.";
  return `<section class="preset-section jq-samples" data-jq-presets>
    <button class="button is-primary preset-start" type="button" data-jq-start-blank>Start blank</button>
    <p class="preset-hint">or switch examples.</p>
    <div class="preset-box">
      <div class="preset-groups" role="tablist" aria-label="jq sample groups">
        ${JQ_SAMPLE_GROUPS.map(group => `<button type="button" role="tab" aria-selected="${activeGroup === group.id ? "true" : "false"}" class="${activeGroup === group.id ? "is-active" : ""}" data-mode="${esc(group.id)}">${esc(group.label)}</button>`).join("")}
      </div>
      <div class="preset-box-body">
        <div class="preset-panel">
          ${visiblePresets.map(preset => `<button type="button" class="${state.activePreset === preset.id ? "is-active" : ""}" data-jq-preset="${esc(preset.id)}">${esc(preset.label)}</button>`).join("")}
        </div>
        <p class="preset-description">${esc(description)}</p>
      </div>
    </div>
  </section>`;
}

function selectionControlsHtml() {
  const disabled = state.mode === "pick" && state.selections.length ? "" : "disabled";
  return `<section class="jq-selection-bar">
    <span>${esc(state.mode === "pick" ? selectedSummary() : "Reshape mode uses the desired output example.")}</span>
    <button class="button is-subtle" type="button" data-clear-selection ${disabled}>Clear selection</button>
  </section>`;
}

function exportPanelHtml(result) {
  const values = exportValues(result);
  if (!values.current) return "";
  const items = [
    ["current", state.queryView === "jsonpath" && values.jsonpath ? "Copy JSONPath" : values.jq ? "Copy jq" : "Copy output"],
    ["jq", "Copy jq"],
    ["jsonpath", "Copy JSONPath"],
    ["shell", "Copy shell command"],
  ].filter(([kind]) => {
    if (kind === "jq") return !!values.jq;
    if (kind === "jsonpath") return !!values.jsonpath;
    if (kind === "shell") return !!values.shell;
    return true;
  });

  return `<section class="jq-export-panel">
    <div>
      <p class="section-label">Export</p>
      <h3>Use the verified query where it belongs.</h3>
    </div>
    <div class="jq-export-grid">
      ${items.map(([kind, label]) => `<button class="button is-subtle" type="button" data-copy-export="${esc(kind)}">${state.copied && state.copiedKind === kind ? "Copied" : esc(label)}</button>`).join("")}
      ${values.jq ? `<button class="button is-subtle" type="button" data-download-jq>Download .jq</button>` : ""}
    </div>
    ${values.shell ? `<pre><code>${esc(values.shell)}</code></pre>` : ""}
  </section>`;
}

function diagnostic(message, tone = "danger") {
  return `<div class="format-diagnostic is-${esc(tone)}"><p>${esc(message)}</p></div>`;
}

function opExplanation(op = {}) {
  if (op.op === "set") return `Take ${formatPathFromString(op.source)} and write it to ${formatPathFromString(op.target || "$")}.`;
  if (op.op === "constant") return `Return the constant value shown in the example.`;
  if (op.op === "arrayMap") {
    const filter = op.where ? ` where ${formatPathFromString(op.where.path)} is ${JSON.stringify(op.where.equals)}` : "";
    return `For each item in ${formatPathFromString(op.source)}${filter}, take ${formatPathFromString(op.extract)}.`;
  }
  if (op.op === "arrayProject") {
    const filter = op.where ? ` where ${formatPathFromString(op.where.path)} is ${JSON.stringify(op.where.equals)}` : "";
    return `For each item in ${formatPathFromString(op.source)}${filter}, build a new object with ${(op.fields || []).map(field => `${formatPathFromString(field.source)} as ${formatPathFromString(field.target)}`).join(", ")}.`;
  }
  if (op.op === "arrayCount") {
    const filter = op.where ? ` where ${formatPathFromString(op.where.path)} is ${JSON.stringify(op.where.equals)}` : "";
    return `Count items in ${formatPathFromString(op.source)}${filter}.`;
  }
  if (op.op === "arrayJoin") {
    const filter = op.where ? ` where ${formatPathFromString(op.where.path)} is ${JSON.stringify(op.where.equals)}` : "";
    const extract = op.extract ? ` after taking ${formatPathFromString(op.extract)}` : "";
    return `Join items from ${formatPathFromString(op.source)}${filter}${extract} with ${JSON.stringify(op.separator || "")}.`;
  }
  if (op.op === "arrayFind") {
    return `Find the first item in ${formatPathFromString(op.source)} where ${formatPathFromString(op.where?.path)} is ${JSON.stringify(op.where?.equals)}, then take ${formatPathFromString(op.extract)}.`;
  }
  return `Apply ${op.op || "the inferred operation"}.`;
}

function formatPathFromString(path = "$") {
  return String(path || "$");
}

function pathStringParts(path = "$") {
  const text = String(path || "$").replace(/^\$/, "");
  if (!text) return [];
  const parts = [];
  const pattern = /\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\["([^"]+)"\]|\['([^']+)'\]/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (match[1]) parts.push(match[1]);
    else if (match[2]) parts.push(Number(match[2]));
    else parts.push(match[3] ?? match[4]);
  }
  return parts;
}

function preferFindProgram(program, examples = []) {
  if (!examples.length) return program;
  const ops = program?.ops || [];
  const promotedOps = ops.map(op => {
    if (op.op !== "arrayJoin" || !op.where || !op.extract) return op;
    const sourcePath = pathStringParts(op.source);
    const wherePath = pathStringParts(op.where.path);
    const extractPath = pathStringParts(op.extract);
    const targetPath = pathStringParts(op.target || "$");
    const exactlyOneAcrossExamples = examples.every(example => {
      const rows = getAtPath(example.input, sourcePath);
      if (!Array.isArray(rows)) return false;
      const matches = rows.filter(row => deepEqual(getAtPath(row, wherePath), op.where.equals));
      if (matches.length !== 1) return false;
      return deepEqual(getAtPath(matches[0], extractPath), getAtPath(example.output, targetPath));
    });
    return exactlyOneAcrossExamples ? { op: "arrayFind", source: op.source, where: op.where, extract: op.extract, target: op.target } : op;
  });
  return promotedOps.some((op, index) => op !== ops[index]) ? { ...program, ops: promotedOps } : program;
}

function programIsStructural(program) {
  return (program?.ops || []).some(op => op.op !== "constant");
}

function verifiedStructuralCandidate(result, input, desiredOutput) {
  const primary = result?.rule?.program || { ops: [] };
  if (programIsStructural(primary)) return { program: primary, promoted: false };

  const targetRows = result?.diagnosis?.candidates || [];
  if (targetRows.length !== 1) return { program: primary, promoted: false };

  for (const candidate of targetRows[0]?.candidates || []) {
    const op = candidate?.program;
    if (!op || op.op === "constant") continue;
    const program = { ops: [op] };
    try {
      generateJqQuery(program);
      const produced = executeJsonTransform(program, input);
      if (deepEqual(produced, desiredOutput)) {
        return {
          program,
          promoted: true,
          reason: "The engine also found a structural jq candidate that reproduces your output exactly, so this view prefers it over a one-example constant.",
        };
      }
    } catch {}
  }

  return { program: primary, promoted: false };
}

function resultCard(result) {
  if (!result || result.status === "empty") return `<section class="empty-state"><p>${esc(result?.message || "Paste JSON and click a value to build a query.")}</p></section>`;

  const query = state.queryView === "jsonpath" && result.jsonPath ? result.jsonPath : result.jq;
  const showQuery = result.status !== "ambiguous" && (query || result.javascript);
  return `<section class="jq-output result-card">
    <aside class="status-pill is-${esc(result.tone || "warn")}" aria-live="polite">
      <div class="inspection-head"><span>Verdict</span><strong>${esc(statusText(result))}</strong></div>
    </aside>
    <div class="result-head">
      <div>
        <p class="section-label">Query</p>
        <h2>${esc(result.heading || (result.javascript ? "JavaScript fallback" : "Verified expression"))}</h2>
      </div>
      <div class="action-bar">
        ${result.jq ? queryTabs(result) : ""}
        ${showQuery ? `<button class="icon-button" type="button" data-copy-query aria-label="Copy query">${state.copied && state.copiedKind === "current" ? "ok" : "c"}</button>` : ""}
      </div>
    </div>

    ${result.message ? `<div class="diagnosis-summary is-${esc(result.tone || "warn")}"><span>${result.tone === "danger" ? "Blocked" : "Note"}</span><span>${esc(result.message)}</span></div>` : ""}
    ${result.actions ? `<section class="test-section">
      <article class="test-card">
        <p>Click a second sibling to mean the whole array, or choose the exact index now.</p>
        <div class="action-bar">
          <button class="button is-primary suggestion-action" type="button" data-pick-scope="index">Use this index</button>
          <button class="button is-subtle suggestion-action" type="button" data-pick-scope="all">Use every item</button>
        </div>
      </article>
    </section>` : ""}
    ${showQuery ? `<pre><code>${esc(query || result.javascript)}</code></pre>` : ""}
    ${showQuery ? exportPanelHtml(result) : ""}
    ${result.javascript && !result.jq ? `<div class="rule-section"><div class="section-label">Why not jq?</div><div class="rule-lines"><p>${esc(result.unsupported || "This reshape needs a jq feature outside the supported exporter.")}</p></div></div>` : ""}
    ${result.output !== undefined ? `<div class="result-preview">
      <div class="section-label">Preview</div>
      <pre><code>${esc(preview(result.output))}</code></pre>
    </div>` : ""}
    ${result.explanation?.length ? `<div class="rule-spec">
      <div class="rule-section">
        <div class="section-label">Explanation</div>
        <div class="rule-lines">${result.explanation.map(line => `<p>${esc(line)}</p>`).join("")}</div>
      </div>
      <div class="rule-section">
        <div class="section-label">Verification</div>
        <div class="rule-lines"><p>${esc(result.verification || "The preview was computed from the pasted JSON.")}</p></div>
      </div>
    </div>` : ""}
  </section>`;
}

function pickModeHtml(parsed) {
  const result = parsed.error ? { status: "danger", tone: "danger", message: parsed.error } : pickPlan(parsed.value);
  return `<section class="rule-spec">
    <div class="rule-section">
      <div class="section-label">Point at values</div>
      ${parsed.error ? diagnostic(parsed.error) : `<div class="json-tree">${renderTree(parsed.value)}</div>`}
    </div>
    <div class="rule-section">
      <div class="section-label">Result</div>
      ${resultCard({ ...result, explanation: result.explanation || explainPick(result), verification: result.status === "safe" ? "The preview is the result of applying this query plan to your JSON." : "" })}
    </div>
  </section>`;
}

function buildReshape() {
  const input = parseJson(state.jsonText, "Input JSON");
  const output = parseJson(state.outputText, "Desired output JSON");
  if (input.error || output.error) {
    state.reshape = { status: "danger", tone: "danger", message: input.error || output.error };
    render();
    return;
  }

  try {
    const preset = JQ_PRESETS.find(item => item.id === state.activePreset);
    const examples = preset?.examples?.length
      ? [{ input: input.value, output: output.value }, ...preset.examples.slice(1)]
      : [{ input: input.value, output: output.value }];
    const result = runTransform({ examples });
    const selected = verifiedStructuralCandidate(result, input.value, output.value);
    const program = preferFindProgram(selected.program, examples);
    const produced = program ? executeJsonTransform(program, input.value) : undefined;
    const verified = deepEqual(produced, output.value);
    let jq = null;
    let jsonPath = null;
    let unsupported = "";
    try {
      jq = generateJqQuery(program);
      jsonPath = generateJsonPath(program);
    } catch (error) {
      unsupported = error?.message || "This reshape needs a jq feature outside the supported exporter.";
    }

    const engineLines = (result.rule?.explanations || []).map(item => item.sentence).filter(Boolean);
    const selectedLines = selected.promoted ? (program.ops || []).map(opExplanation) : engineLines;
    state.reshape = {
      status: !verified ? "danger" : jq ? (result.status === "safe" && !selected.promoted ? "safe" : "warn") : "unsupported",
      tone: !verified ? "danger" : jq && result.status === "safe" && !selected.promoted ? "safe" : "warn",
      title: !verified ? "Output did not verify" : jq ? "Reproduces the desired output" : "Use the verified JavaScript fallback",
      heading: jq ? "Verified jq expression" : "Verified JavaScript transform",
      message: !verified
        ? "The inferred rule did not reproduce the desired output, so no jq was emitted."
        : selected.promoted
          ? selected.reason
        : jq && result.status !== "safe"
          ? "This reproduces your example, but the engine wants another example before calling the reusable rule proven."
          : unsupported,
      jq,
      jsonPath,
      javascript: jq ? null : generateJavaScriptTransform(result),
      unsupported,
      output: produced,
      explanation: selectedLines.length ? selectedLines : (result.rule?.display || []),
      verification: verified ? "The engine executed the inferred rule on your input and matched the desired output exactly." : "Verification failed.",
    };
  } catch (error) {
    state.reshape = { status: "danger", tone: "danger", message: error?.message || "The reshape could not be inferred." };
  }
  render();
}

function reshapeModeHtml() {
  return `<section class="rule-spec">
    <div class="rule-section">
      <div class="editor">
        <div class="editor-bar"><span>Desired output example</span><span class="format-chip">JSON</span></div>
        <textarea data-output-json spellcheck="false" rows="12" aria-label="Desired output JSON">${esc(state.outputText)}</textarea>
      </div>
      <div class="action-bar">
        <button class="button is-primary" type="button" data-build-reshape>Build query</button>
      </div>
    </div>
    <div class="rule-section">
      <div class="section-label">Result</div>
      ${state.reshape ? resultCard(state.reshape) : `<section class="empty-state"><p>Show the JSON shape you want, then build a verified jq expression.</p></section>`}
    </div>
  </section>`;
}

function render() {
  if (!root) return;
  const parsed = parseJson(state.jsonText, "Input JSON");
  root.innerHTML = `<section class="app-shell jq-page">
    <header class="tool-header">
      <p class="section-label">jq Builder</p>
      <h1>Build jq Queries from JSON by Example</h1>
      <p class="tool-subhead">Paste JSON, click the values you want, or show the output shape. Latentmachine emits a verified jq expression and refuses when the choice is ambiguous.</p>
    </header>

    ${presetHtml()}
    ${modeOnboardingHtml()}

    <section class="editor">
      <div class="editor-bar">
        <span>Input JSON</span>
        <div class="editor-actions">
          <input class="visually-hidden" id="jq-json-file" type="file" accept=".json,application/json" data-jq-file>
          <label class="button is-subtle" for="jq-json-file">Import JSON</label>
          <span class="format-chip">JSON</span>
        </div>
      </div>
      <textarea data-input-json spellcheck="false" rows="12" aria-label="Input JSON">${esc(state.jsonText)}</textarea>
    </section>

    ${selectionControlsHtml()}
    ${state.importNotice ? `<div class="format-diagnostic is-${esc(state.importNotice.tone)}"><p>${esc(state.importNotice.text)}</p></div>` : ""}
    ${state.mode === "pick" ? pickModeHtml(parsed) : reshapeModeHtml()}

    ${state.shareNotice ? `<div class="reasoning-hint"><p>${esc(state.shareNotice)}</p></div>` : ""}
    <section class="jq-share-row">
      <button class="button" type="button" data-share-jq>${state.shareCopied ? "Link copied" : "Share"}</button>
    </section>
  </section>`;
}

function preserveTextInput(target, update) {
  const selectionStart = target.selectionStart;
  const selectionEnd = target.selectionEnd;
  update();
  render();
  const next = root.querySelector(`[${target.dataset.inputJson !== undefined ? "data-input-json" : "data-output-json"}]`);
  if (next) {
    next.focus();
    next.selectionStart = selectionStart;
    next.selectionEnd = selectionEnd;
  }
}

async function copyCurrentQuery() {
  return copyExport("current");
}

async function shareJqState() {
  try {
    const url = await shareUrlForState({
      jsonText: state.jsonText,
      outputText: state.outputText,
      mode: state.mode,
      selections: [...state.selections],
      pickScope: state.pickScope,
      queryView: state.queryView,
    });
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

root?.addEventListener("input", event => {
  if (event.target?.dataset?.inputJson !== undefined) {
    preserveTextInput(event.target, () => {
      state.jsonText = event.target.value;
      state.selections = [];
      state.pickScope = null;
      state.reshape = null;
      state.activePreset = "";
      state.importNotice = null;
    });
    return;
  }
  if (event.target?.dataset?.outputJson !== undefined) {
    preserveTextInput(event.target, () => {
      state.outputText = event.target.value;
      state.reshape = null;
      state.activePreset = "";
    });
  }
});

root?.addEventListener("change", event => {
  if (event.target?.dataset?.jqPreset !== undefined) return loadPreset(event.target.value || JQ_PRESETS[0].id);
  if (event.target?.dataset?.jqFile !== undefined) return importJsonFile(event.target.files?.[0]);
});

root?.addEventListener("click", event => {
  const preset = event.target.closest("button[data-jq-preset]");
  if (preset) return loadPreset(preset.dataset.jqPreset || JQ_PRESETS[0].id);

  if (event.target.closest("[data-jq-start-blank]")) return startBlank();

  const mode = event.target.closest("[data-mode]");
  if (mode) {
    state.mode = mode.dataset.mode;
    state.queryView = "jq";
    return render();
  }

  const select = event.target.closest("[data-select-path]");
  if (select) {
    const key = select.dataset.selectPath;
    state.selections = state.selections.includes(key)
      ? state.selections.filter(item => item !== key)
      : [...state.selections, key];
    state.pickScope = null;
    return render();
  }

  const scope = event.target.closest("[data-pick-scope]");
  if (scope) {
    state.pickScope = scope.dataset.pickScope;
    return render();
  }

  const view = event.target.closest("[data-query-view]");
  if (view) {
    state.queryView = view.dataset.queryView;
    return render();
  }

  if (event.target.closest("[data-clear-selection]")) {
    state.selections = [];
    state.pickScope = null;
    return render();
  }

  const copyExportButton = event.target.closest("[data-copy-export]");
  if (copyExportButton) return copyExport(copyExportButton.dataset.copyExport);

  if (event.target.closest("[data-download-jq]")) return downloadJq();
  if (event.target.closest("[data-build-reshape]")) return buildReshape();
  if (event.target.closest("[data-copy-query]")) return copyCurrentQuery();
  if (event.target.closest("[data-share-jq]")) return shareJqState();
});

document.addEventListener("keydown", event => {
  const key = event.key?.toLowerCase();
  const isShortcut = event.metaKey || event.ctrlKey;
  if (isShortcut && key === "enter") {
    event.preventDefault();
    if (state.mode === "reshape") return buildReshape();
    return render();
  }
  if (isShortcut && event.shiftKey && key === "c") {
    event.preventDefault();
    return copyCurrentQuery();
  }
  if (event.key === "Escape" && state.mode === "pick" && state.selections.length && !event.target?.closest?.("textarea, input, select, [contenteditable='true']")) {
    state.selections = [];
    state.pickScope = null;
    render();
  }
});

async function initialize() {
  try {
    const shared = await sharedStateFromLocation();
    if (shared) {
      state.jsonText = String(shared.jsonText ?? sampleJson);
      state.outputText = String(shared.outputText ?? sampleOutput);
      state.mode = shared.mode === "reshape" ? "reshape" : "pick";
      state.selections = Array.isArray(shared.selections) ? shared.selections.map(String) : [];
      state.pickScope = shared.pickScope === "index" || shared.pickScope === "all" ? shared.pickScope : null;
      state.queryView = shared.queryView === "jsonpath" ? "jsonpath" : "jq";
      state.shareNotice = "Shared builder state restored from this URL.";
      if (state.mode === "reshape") return buildReshape();
    }
  } catch (error) {
    state.shareNotice = error?.message || "This share link could not be restored.";
  }
  render();
}

initialize();
