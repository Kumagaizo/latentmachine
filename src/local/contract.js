import {
  acceptTransformationInvariants,
  answerChallenge,
  approveContract,
  checkContract,
  compareContracts,
  deferChallenge,
  learnContract,
  runContract,
  runTransformationMutationSuite,
  validateTransformationContract,
  withTransformationContractIdentity,
} from "../intelligence/contracts/index.js";
import {
  formatLabel,
  FORMAT_ORDER,
  parseWithFormat,
  serializeWithFormat,
} from "../intelligence/data-formats/index.js";
import {
  FILE_IMPORT_MAX_BYTES,
  formatBytes,
  validateImportFile,
  validateImportText,
} from "./file-import.js";
import { copyText, shareUrlForState, sharedStateFromLocation } from "./share-state.js";
import { esc, plural } from "./shared.js";

const root = document.querySelector("#contract");
const STAGES = [
  { id: "evidence", label: "Evidence" },
  { id: "rule", label: "Rule" },
  { id: "challenges", label: "Challenges" },
  { id: "guardrails", label: "Guardrails" },
  { id: "approval", label: "Approve & export" },
];
const MAX_EXAMPLES = 20;
const RUNTIME_PREVIEW_LIMIT = 20;

const webhookExamples = [
  {
    input: { id: "evt_001", status: "created", amount: 129 },
    output: { eventId: "evt_001", state: "NEW", amountCents: 12900 },
  },
  {
    input: { id: "evt_002", status: "paid", amount: 48.5 },
    output: { eventId: "evt_002", state: "READY", amountCents: 4850 },
  },
];

const csvExamples = [
  {
    input: "customer_id,email,status\nC-001, ADA@EXAMPLE.COM ,active",
    output: "id,email,state\nC-001,ada@example.com,ACTIVE",
    inputFormat: "csv",
    outputFormat: "csv",
  },
  {
    input: "customer_id,email,status\nC-002, GRACE@EXAMPLE.COM ,paused",
    output: "id,email,state\nC-002,grace@example.com,PAUSED",
    inputFormat: "csv",
    outputFormat: "csv",
  },
];

const state = {
  stage: "evidence",
  examples: [],
  sourceContract: null,
  contract: null,
  selectedInvariantIds: [],
  keyGuardSelected: false,
  mutationReport: null,
  comparison: null,
  runtimeMode: "run",
  runtimeInput: "",
  runtimeOutput: "",
  runtimeReport: null,
  challengeDraft: "",
  notice: "",
  noticeTone: "neutral",
  announcement: "",
  busy: false,
};

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function editorText(value, format = "json") {
  if (typeof value === "string") return value;
  if (format === "auto" || format === "value") return pretty(value);
  try {
    return serializeWithFormat(value, format);
  } catch {
    return pretty(value);
  }
}

function blankExample() {
  return {
    input: "",
    output: "",
    inputFormat: "auto",
    outputFormat: "auto",
  };
}

function normalizedEditorExample(example = {}) {
  const inputFormat = example.inputFormat || example.formats?.input || "auto";
  const outputFormat = example.outputFormat || example.formats?.output || "auto";
  return {
    input: editorText(example.input ?? "", inputFormat),
    output: editorText(example.output ?? "", outputFormat),
    inputFormat,
    outputFormat,
  };
}

function completeExamples() {
  return state.examples.filter(example => example.input.trim() && example.output.trim());
}

function suggestions(contract = state.sourceContract) {
  return contract?.extensions?.latentmachine?.invariantSuggestions || [];
}

function openChallenges(contract = state.sourceContract) {
  return (contract?.challenges || []).filter(challenge => challenge.status === "open");
}

function blockingChallenges(contract = state.contract) {
  return (contract?.challenges || []).filter(challenge => (
    challenge.severity === "blocking"
    && (challenge.status === "open" || challenge.status === "deferred")
  ));
}

function advisoryChallenges(contract = state.contract) {
  return (contract?.challenges || []).filter(challenge => (
    challenge.severity === "advisory"
    && (challenge.status === "open" || challenge.status === "deferred")
  ));
}

function stageIndex(stage = state.stage) {
  return Math.max(0, STAGES.findIndex(item => item.id === stage));
}

function stageAvailable(stage) {
  if (stage === "evidence") return true;
  if (!state.sourceContract) return false;
  if (stage === "approval") return !!state.contract?.invariants?.length;
  return true;
}

function setNotice(text, tone = "neutral") {
  state.notice = text;
  state.noticeTone = tone;
  state.announcement = text;
}

function invalidateLearnedContract() {
  state.sourceContract = null;
  state.contract = null;
  state.selectedInvariantIds = [];
  state.keyGuardSelected = false;
  state.mutationReport = null;
  state.comparison = null;
  state.runtimeReport = null;
  state.stage = "evidence";
}

function inferenceTone(status) {
  if (status === "safe") return "safe";
  if (status === "ambiguous" || status === "insufficient") return "warn";
  return "danger";
}

function approvalTone(status) {
  return status === "approved"
    ? "safe"
    : status === "unreviewed" ? "warn" : "danger";
}

function runtimeTone(verdict) {
  if (verdict === "pass") return "safe";
  if (verdict === "warn") return "warn";
  return "danger";
}

function title(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/^./, character => character.toUpperCase());
}

function groupedFingerprint(value) {
  return String(value || "").match(/.{1,4}/g)?.join(" ") || "Not learned";
}

function formatOptions(selected) {
  return [
    ["auto", "Auto"],
    ...FORMAT_ORDER.map(format => [format, formatLabel(format)]),
  ].map(([value, label]) => (
    `<option value="${esc(value)}" ${selected === value ? "selected" : ""}>${esc(label)}</option>`
  )).join("");
}

function exampleEditor(example, index) {
  return `<article class="contract-example">
    <div class="contract-example-head">
      <span>Example ${index + 1}</span>
      <button class="button is-small is-subtle" type="button" data-remove-example="${index}" aria-label="Remove example ${index + 1}">Remove</button>
    </div>
    <div class="contract-example-grid">
      <label class="editor">
        <span class="editor-bar">
          <span>Before</span>
          <select class="format-chip" data-example-format="${index}" data-side="input" aria-label="Example ${index + 1} input format">${formatOptions(example.inputFormat)}</select>
        </span>
        <textarea spellcheck="false" data-example-text="${index}" data-side="input" aria-label="Example ${index + 1} input">${esc(example.input)}</textarea>
      </label>
      <span class="pair-arrow" aria-hidden="true">→</span>
      <label class="editor">
        <span class="editor-bar">
          <span>After</span>
          <select class="format-chip" data-example-format="${index}" data-side="output" aria-label="Example ${index + 1} output format">${formatOptions(example.outputFormat)}</select>
        </span>
        <textarea spellcheck="false" data-example-text="${index}" data-side="output" aria-label="Example ${index + 1} output">${esc(example.output)}</textarea>
      </label>
    </div>
  </article>`;
}

function emptyEvidenceHtml() {
  return `<section class="contract-empty empty-state">
    <p class="section-label">Evidence first</p>
    <h2>Turn examples into a transformation contract.</h2>
    <p>Show Latentmachine what goes in and what should come out. It will infer the rule, identify what the examples do not prove, and produce a deterministic contract you can run or use as a gate.</p>
    <div class="contract-empty-actions">
      <button class="button is-primary" type="button" data-add-example>Add before-and-after examples</button>
      <button class="button" type="button" data-preset="webhook">Load webhook mapping example</button>
      <button class="button" type="button" data-preset="csv">Load CSV cleanup example</button>
      <label class="button is-subtle" for="contract-import">Import contract or examples</label>
      <a class="button is-subtle" href="/verify">Observe an existing batch</a>
    </div>
  </section>`;
}

function evidenceHtml() {
  if (!state.examples.length) return emptyEvidenceHtml();
  return `<section class="contract-stage" aria-labelledby="contract-evidence-title">
    <div class="contract-stage-head">
      <div>
        <p class="section-label">Stage 1 · Evidence</p>
        <h2 id="contract-evidence-title">Show the behavior you want to preserve.</h2>
        <p>Use representative before-and-after pairs. The examples are evidence, not a correctness claim.</p>
      </div>
      <div class="contract-stage-actions">
        <button class="button is-small" type="button" data-preset="webhook">Webhook example</button>
        <button class="button is-small" type="button" data-preset="csv">CSV example</button>
        <label class="button is-small is-subtle" for="contract-import">Import JSON</label>
      </div>
    </div>
    <div class="contract-examples">${state.examples.map(exampleEditor).join("")}</div>
    <div class="contract-evidence-actions">
      <button class="button" type="button" data-add-example ${state.examples.length >= MAX_EXAMPLES ? "disabled" : ""}>Add another example</button>
      <button class="button is-primary" type="button" data-learn ${completeExamples().length < 2 || state.busy ? "disabled" : ""}>${state.busy ? "Learning…" : "Learn observed rule"}</button>
      <span>${plural(completeExamples().length, "complete example")} · runs locally</span>
    </div>
  </section>`;
}

function evidenceLinksForOperation(index) {
  const link = state.sourceContract?.evidenceLinks?.find(item => item.operationIndex === index);
  if (!link?.exampleIds?.length) return "No direct evidence link";
  return link.exampleIds.join(", ");
}

function ruleHtml() {
  const contract = state.sourceContract;
  if (!contract) return evidenceHtml();
  const alternatives = contract.inference.candidatesConsidered || [];
  return `<section class="contract-stage" aria-labelledby="contract-rule-title">
    <div class="contract-stage-head">
      <div>
        <p class="section-label">Stage 2 · Rule</p>
        <h2 id="contract-rule-title">Observed, not yet approved.</h2>
        <p>Latentmachine selected the deterministic operations below because they fit the supplied evidence.</p>
      </div>
      <span class="contract-status is-${inferenceTone(contract.inference.status)}">${esc(title(contract.inference.status))}</span>
    </div>
    ${alternatives.length > 1 && ((contract.inference.ambiguities || []).length || openChallenges().length) ? `<div class="contract-callout is-warn"><strong>Alternative behavior exists.</strong><span>${alternatives.length} candidates fit some or all of the evidence. Review the challenges before approval.</span></div>` : ""}
    <div class="contract-operation-list">
      ${contract.program.ops.map((operation, index) => `<article class="contract-operation">
        <div><span>${index + 1}</span><strong>${esc(title(operation.op))}</strong></div>
        <code>${esc(pretty(operation))}</code>
        <details>
          <summary>Why this operation</summary>
          <p>Supported by ${esc(evidenceLinksForOperation(index))}.</p>
        </details>
      </article>`).join("")}
    </div>
    <section class="contract-subsection">
      <div class="contract-subsection-head"><h3>Required input conditions</h3><span>${plural(contract.input.preconditions.length, "condition")}</span></div>
      ${contract.input.preconditions.length ? `<ul class="contract-plain-list">${contract.input.preconditions.map(item => `<li><code>${esc(item.field)}</code><span>${item.required ? "Required" : "Optional"} · ${esc(item.type)} · used by <code>${esc(item.usedBy || "the program")}</code></span></li>`).join("")}</ul>` : `<p class="contract-muted">No explicit preconditions were inferred.</p>`}
    </section>
    ${(contract.inference.warnings || []).length ? `<section class="contract-callout is-warn"><strong>Unsupported or unsafe behavior</strong><span>${esc(contract.inference.warnings.map(item => item.message || item.type).join(" "))}</span></section>` : ""}
    ${diffHtml()}
    <div class="contract-next"><button class="button" type="button" data-stage="evidence">Edit evidence</button><button class="button is-primary" type="button" data-stage="challenges">${openChallenges().length ? "Review questions" : "Continue to guardrails"}</button></div>
  </section>`;
}

function currentChallenge() {
  return openChallenges()[0] || null;
}

function challengeConsequences(challenge) {
  if (challenge.severity === "blocking") {
    return "Deferring keeps approval blocked. The contract cannot run while approval is required.";
  }
  return "Deferring leaves an advisory risk that must be acknowledged during approval.";
}

function challengeHtml() {
  const contract = state.sourceContract;
  if (!contract) return evidenceHtml();
  const challenge = currentChallenge();
  const completed = (contract.challenges || []).filter(item => item.status !== "open");
  if (!challenge) {
    return `<section class="contract-stage" aria-labelledby="contract-challenges-title">
      <div class="contract-stage-head"><div><p class="section-label">Stage 3 · Challenges</p><h2 id="contract-challenges-title">No open questions.</h2><p>The current evidence selects one supported behavior. Guardrails still define what may proceed at runtime.</p></div><span class="contract-status is-safe">${completed.length ? `${completed.length} resolved` : "Clear"}</span></div>
      ${completed.length ? `<ul class="contract-plain-list">${completed.map(item => `<li><strong>${esc(item.prompt)}</strong><span>${esc(title(item.status))}</span></li>`).join("")}</ul>` : ""}
      <div class="contract-next"><button class="button" type="button" data-stage="rule">Back to rule</button><button class="button is-primary" type="button" data-stage="guardrails">Choose guardrails</button></div>
    </section>`;
  }

  const candidateOutputs = challenge.candidateOutputs || [];
  const policyChoices = challenge.choices?.length
    ? challenge.choices.map(choice => typeof choice === "string" ? choice : choice.value)
    : ["block", "quarantine", "warn"];
  return `<section class="contract-stage" aria-labelledby="contract-challenges-title">
    <div class="contract-stage-head">
      <div><p class="section-label">Stage 3 · Challenge 1 of ${openChallenges().length}</p><h2 id="contract-challenges-title">${esc(challenge.prompt)}</h2><p>${esc(challenge.reason)}</p></div>
      <span class="contract-status is-${challenge.severity === "blocking" ? "danger" : "warn"}">${esc(title(challenge.severity))}</span>
    </div>
    <div class="contract-challenge-grid">
      <section><h3>Why this matters</h3><p>${esc(challenge.reason)}</p><code>${esc((challenge.affectedPaths || []).join(", ") || "Behavior-level question")}</code></section>
      <section><h3>Proposed input</h3><pre>${esc(pretty(challenge.proposedInput))}</pre></section>
    </div>
    ${candidateOutputs.length ? `<section class="contract-candidates"><h3>Candidate outputs</h3><div>${candidateOutputs.map((candidate, index) => `<article><span>Candidate ${index + 1}</span><pre>${esc(pretty(candidate.output ?? candidate))}</pre></article>`).join("")}</div></section>` : ""}
    ${challenge.answerMode === "expected_output" ? `<label class="editor contract-answer"><span class="editor-bar"><span>Expected output</span><span class="format-chip">${esc(formatLabel(contract.formats.output))}</span></span><textarea spellcheck="false" data-challenge-answer aria-label="Expected output for this challenge">${esc(state.challengeDraft || editorText(candidateOutputs[0]?.output ?? {}, contract.formats.output))}</textarea></label>` : ""}
    <div class="contract-challenge-actions">
      ${challenge.answerMode === "expected_output" ? `<button class="button is-primary" type="button" data-answer-challenge>Use expected output as evidence</button>` : ""}
      ${challenge.answerMode === "policy" || challenge.answerMode === "choice" || challenge.alternativeAnswerModes?.includes("policy") ? `<div class="contract-policy-choices"><span>Or set runtime policy</span>${policyChoices.map(choice => `<button class="button is-small" type="button" data-policy-answer="${esc(choice)}">${esc(title(choice))}</button>`).join("")}</div>` : ""}
      <button class="button is-subtle" type="button" data-defer-challenge>Defer question</button>
    </div>
    <p class="contract-consequence">${esc(challengeConsequences(challenge))}</p>
  </section>`;
}

function invariantGroup(suggestion) {
  const subject = suggestion.parameters?.subject;
  if (subject === "input" || suggestion.kind === "required_path") return "Input";
  if (["row_count_preserved", "key_set_preserved", "key_unique", "no_duplicate_output_keys"].includes(suggestion.kind)) return "Record preservation";
  if (suggestion.kind === "allowed_values") return "Unseen values";
  return "Output";
}

function groupedSuggestions() {
  const groups = new Map();
  for (const suggestion of suggestions()) {
    const group = invariantGroup(suggestion);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(suggestion);
  }
  return groups;
}

function keyGuardCandidate() {
  return suggestions().find(item => (
    item.kind === "output_equals_source"
    && item.parameters?.sourcePath
    && item.parameters?.targetPath
  )) || null;
}

function keyGuardDefinitions() {
  const candidate = keyGuardCandidate();
  if (!candidate || !state.keyGuardSelected) return [];
  const suffix = candidate.id.replace(/^inv_/, "").slice(0, 12);
  return [
    {
      id: `inv_ui_key_set_${suffix}`,
      kind: "key_set_preserved",
      scope: "batch",
      severity: "blocking",
      parameters: {
        inputKeyPath: candidate.parameters.sourcePath,
        outputKeyPath: candidate.parameters.targetPath,
      },
    },
    {
      id: `inv_ui_input_key_unique_${suffix}`,
      kind: "key_unique",
      scope: "batch",
      severity: "blocking",
      parameters: {
        subject: "input",
        keyPath: candidate.parameters.sourcePath,
      },
    },
    {
      id: `inv_ui_output_key_unique_${suffix}`,
      kind: "no_duplicate_output_keys",
      scope: "batch",
      severity: "blocking",
      parameters: {
        keyPath: candidate.parameters.targetPath,
      },
    },
  ];
}

function guardrailsHtml() {
  if (!state.sourceContract) return evidenceHtml();
  const groups = groupedSuggestions();
  const keyCandidate = keyGuardCandidate();
  return `<section class="contract-stage" aria-labelledby="contract-guardrails-title">
    <div class="contract-stage-head">
      <div><p class="section-label">Stage 4 · Guardrails</p><h2 id="contract-guardrails-title">Choose what runtime data must prove.</h2><p>Recommendations come from the observed program and schemas. Nothing becomes enforceable until you apply it.</p></div>
      <span class="contract-status is-neutral">${state.selectedInvariantIds.length} selected</span>
    </div>
    <div class="contract-guardrail-groups">
      ${[...groups].map(([group, items]) => `<fieldset class="contract-guardrail-group">
        <legend>${esc(group)}</legend>
        ${items.map(item => `<label class="contract-guardrail">
          <input type="checkbox" data-invariant="${esc(item.id)}" ${state.selectedInvariantIds.includes(item.id) ? "checked" : ""}>
          <span><strong>${esc(title(item.kind))}</strong><small>${esc(item.reason)}</small><em>On failure: ${item.severity === "blocking" ? esc(title(state.sourceContract.runtimePolicy.onRecordViolation)) : "Warn"} · inferred recommendation</em></span>
        </label>`).join("")}
      </fieldset>`).join("")}
      <fieldset class="contract-guardrail-group">
        <legend>Failure handling</legend>
        <label class="contract-policy-field">Record violation<select data-runtime-policy="onRecordViolation"><option value="quarantine" ${state.sourceContract.runtimePolicy.onRecordViolation === "quarantine" ? "selected" : ""}>Quarantine record</option><option value="warn" ${state.sourceContract.runtimePolicy.onRecordViolation === "warn" ? "selected" : ""}>Warn and retain</option><option value="block" ${state.sourceContract.runtimePolicy.onRecordViolation === "block" ? "selected" : ""}>Block record</option></select></label>
        <label class="contract-policy-field">Batch violation<select data-runtime-policy="onBatchViolation"><option value="block" ${state.sourceContract.runtimePolicy.onBatchViolation === "block" ? "selected" : ""}>Block batch</option><option value="warn" ${state.sourceContract.runtimePolicy.onBatchViolation === "warn" ? "selected" : ""}>Warn and retain</option></select></label>
      </fieldset>
      ${keyCandidate ? `<fieldset class="contract-guardrail-group">
        <legend>Record identity</legend>
        <label class="contract-guardrail">
          <input type="checkbox" data-key-guard ${state.keyGuardSelected ? "checked" : ""}>
          <span><strong>Preserve and match record keys</strong><small>Match <code>${esc(keyCandidate.parameters.sourcePath)}</code> to <code>${esc(keyCandidate.parameters.targetPath)}</code>, require unique keys, and allow safe reordering.</small><em>On failure: block batch · user-selected</em></span>
        </label>
      </fieldset>` : ""}
    </div>
    <div class="contract-next"><button class="button" type="button" data-stage="challenges">Back to challenges</button><button class="button is-primary" type="button" data-apply-guardrails ${state.selectedInvariantIds.length ? "" : "disabled"}>Apply guardrails & test mutations</button></div>
  </section>`;
}

function mutationSummaryHtml() {
  const report = state.mutationReport;
  if (!report) return `<p class="contract-muted">Apply guardrails to run deterministic mutation tests.</p>`;
  return `<div class="contract-mutation-summary">
    <div><strong>${report.detected.length}</strong><span>mutations detected</span></div>
    <div class="${report.undetected.length ? "is-warn" : "is-safe"}"><strong>${report.undetected.length}</strong><span>visible guardrail gaps</span></div>
  </div>
  <details class="contract-mutation-details">
    <summary>Inspect ${plural(report.mutations.length, "mutation")}</summary>
    <ul>${report.mutations.map(mutation => `<li><span>${esc(title(mutation.kind))}</span><strong class="is-${mutation.detected ? "safe" : "warn"}">${mutation.detected ? "Detected" : "Gap"}</strong></li>`).join("")}</ul>
  </details>`;
}

function approvalBlockedReasons() {
  const reasons = [];
  if (!state.contract) reasons.push("Apply at least one guardrail.");
  if (state.contract?.inference.status !== "safe") reasons.push(`Inference is ${state.contract?.inference.status || "not ready"}.`);
  if (blockingChallenges().length) reasons.push(`${plural(blockingChallenges().length, "blocking question")} remain open or deferred.`);
  return reasons;
}

function diffHtml() {
  const comparison = state.comparison;
  if (!comparison) return "";
  return `<section class="contract-subsection">
    <div class="contract-subsection-head"><h3>Imported version comparison</h3><span class="is-${comparison.breaking ? "danger" : "safe"}">${esc(title(comparison.classification))}</span></div>
    <p class="contract-muted">${comparison.breaking ? "Runtime behavior changed and requires a fresh review." : "No breaking runtime change was found."}</p>
    <ul class="contract-diff-list">${comparison.changes.slice(0, 12).map(change => `<li><code>${esc(change.path)}</code><span>${esc(change.explanation)}</span></li>`).join("")}</ul>
  </section>`;
}

function reportRecords(report) {
  const records = report?.records || [];
  if (!records.length) return "";
  return `<div class="contract-runtime-records">
    ${records.slice(0, RUNTIME_PREVIEW_LIMIT).map(record => `<details class="contract-runtime-record is-${runtimeTone(record.status === "passed" ? "pass" : record.status === "warned" ? "warn" : "quarantine")}">
      <summary><span>${esc(record.rowId)}</span><strong>${esc(title(record.status))}</strong><small>${plural(record.diagnostics.length, "diagnostic")}</small></summary>
      ${record.diagnostics.length ? `<ul>${record.diagnostics.map(item => `<li><code>${esc(item.path || "$")}</code><span>${esc(item.message)}</span></li>`).join("")}</ul>` : `<p>No violations.</p>`}
      ${Object.hasOwn(record, "expectedOutput") ? `<div class="contract-runtime-pair"><pre>${esc(pretty(record.expectedOutput))}</pre><pre>${esc(pretty(record.actualOutput))}</pre></div>` : Object.hasOwn(record, "output") ? `<pre>${esc(pretty(record.output))}</pre>` : ""}
    </details>`).join("")}
    ${records.length > RUNTIME_PREVIEW_LIMIT ? `<p class="contract-muted">Showing the first ${RUNTIME_PREVIEW_LIMIT} of ${records.length} records. Export the report for the complete evidence.</p>` : ""}
  </div>`;
}

function runtimeResultHtml() {
  const report = state.runtimeReport;
  if (!report) return "";
  const canProceed = report.verdict === "pass" || report.verdict === "warn";
  return `<section class="contract-runtime-result" aria-labelledby="contract-runtime-result-title">
    <div class="contract-runtime-verdict is-${runtimeTone(report.verdict)}">
      <div><p class="section-label">Runtime verdict</p><h3 id="contract-runtime-result-title">${canProceed ? "This output can proceed." : "This output needs review before it proceeds."}</h3></div>
      <strong>${esc(title(report.verdict))}</strong>
    </div>
    <div class="contract-runtime-totals">
      ${["passed", "warned", "quarantined", "blocked"].map(key => `<div><strong>${report.totals[key]}</strong><span>${esc(title(key))}</span></div>`).join("")}
    </div>
    ${report.errors.length ? `<div class="contract-callout is-danger"><strong>Runtime could not continue</strong><span>${esc(report.errors.map(item => item.message).join(" "))}</span></div>` : ""}
    ${report.batchDiagnostics.length ? `<div class="contract-callout is-danger"><strong>Batch evidence</strong><span>${esc(report.batchDiagnostics.map(item => item.message).join(" "))}</span></div>` : ""}
    ${reportRecords(report)}
    <div class="contract-runtime-actions">
      <button class="button is-small" type="button" data-export-report>Export privacy-safe report</button>
      ${report.quarantined.length || report.blocked.length ? `<button class="button is-small" type="button" data-export-quarantine>Download review records</button>` : ""}
    </div>
  </section>`;
}

function runtimeHtml() {
  if (state.contract?.lifecycle.approvalState !== "approved") return "";
  return `<section class="contract-runtime">
    <div class="contract-subsection-head"><div><p class="section-label">Runtime review</p><h3>Can this output proceed?</h3></div><div class="contract-mode" role="group" aria-label="Runtime mode"><button type="button" data-runtime-mode="run" class="${state.runtimeMode === "run" ? "is-active" : ""}">Run contract</button><button type="button" data-runtime-mode="check" class="${state.runtimeMode === "check" ? "is-active" : ""}">Check external output</button></div></div>
    <div class="contract-runtime-grid ${state.runtimeMode === "run" ? "is-run" : ""}">
      <label class="editor"><span class="editor-bar"><span>Runtime input</span><span class="format-chip">${esc(formatLabel(state.contract.formats.input))}</span></span><textarea spellcheck="false" data-runtime-input aria-label="Runtime input">${esc(state.runtimeInput)}</textarea></label>
      ${state.runtimeMode === "check" ? `<label class="editor"><span class="editor-bar"><span>External output</span><span class="format-chip">${esc(formatLabel(state.contract.formats.output))}</span></span><textarea spellcheck="false" data-runtime-output aria-label="External output">${esc(state.runtimeOutput)}</textarea></label>` : ""}
    </div>
    <div class="contract-runtime-runbar"><button class="button is-primary" type="button" data-run-contract>${state.runtimeMode === "run" ? "Run approved contract" : "Check external output"}</button><span>Approval ${esc(groupedFingerprint(state.contract.identity.coreFingerprint).slice(0, 19))}</span></div>
    ${runtimeResultHtml()}
  </section>`;
}

function approvalHtml() {
  const contract = state.contract;
  if (!contract) return guardrailsHtml();
  const blocked = approvalBlockedReasons();
  const approved = contract.lifecycle.approvalState === "approved";
  return `<section class="contract-stage" aria-labelledby="contract-approval-title">
    <div class="contract-stage-head">
      <div><p class="section-label">Stage 5 · Approve & export</p><h2 id="contract-approval-title">${approved ? "Approved behavior, bound to this fingerprint." : "Review the complete operational agreement."}</h2><p>Approval accepts this exact deterministic core. It does not claim that unseen business requirements are correct.</p></div>
      <span class="contract-status is-${approvalTone(contract.lifecycle.approvalState)}">${esc(title(contract.lifecycle.approvalState))}</span>
    </div>
    <div class="contract-approval-grid">
      <section>
        <h3>Behavior</h3>
        <dl>
          <div><dt>Operations</dt><dd>${contract.program.ops.length}</dd></div>
          <div><dt>Evidence examples</dt><dd>${contract.evidence.count}</dd></div>
          <div><dt>Required inputs</dt><dd>${contract.input.preconditions.filter(item => item.required).length}</dd></div>
          <div><dt>Invariants</dt><dd>${contract.invariants.length}</dd></div>
        </dl>
      </section>
      <section>
        <h3>Review state</h3>
        <dl>
          <div><dt>Blocking questions</dt><dd class="${blockingChallenges().length ? "is-danger" : "is-safe"}">${blockingChallenges().length}</dd></div>
          <div><dt>Advisory questions</dt><dd class="${advisoryChallenges().length ? "is-warn" : ""}">${advisoryChallenges().length}</dd></div>
          <div><dt>Record failure</dt><dd>${esc(title(contract.runtimePolicy.onRecordViolation))}</dd></div>
          <div><dt>Batch failure</dt><dd>${esc(title(contract.runtimePolicy.onBatchViolation))}</dd></div>
        </dl>
      </section>
    </div>
    <section class="contract-subsection"><div class="contract-subsection-head"><h3>Mutation report</h3><span>Deterministic boundary tests</span></div>${mutationSummaryHtml()}</section>
    <section class="contract-fingerprint"><span>Core fingerprint</span><code>${esc(groupedFingerprint(contract.identity.coreFingerprint))}</code><small>Change detection, not a cryptographic signature.</small></section>
    ${blocked.length ? `<div class="contract-callout is-danger"><strong>Approval is blocked</strong><span>${esc(blocked.join(" "))}</span></div>` : ""}
    ${advisoryChallenges().length && !approved ? `<div class="contract-callout is-warn"><strong>Advisory acknowledgement</strong><span>Approval will explicitly acknowledge ${plural(advisoryChallenges().length, "unresolved advisory question")}.</span></div>` : ""}
    <div class="contract-approval-actions">
      ${approved ? "" : `<button class="button is-primary" type="button" data-approve ${blocked.length ? "disabled" : ""}>Approve exact fingerprint</button>`}
      <button class="button" type="button" data-export-contract>Download contract</button>
      <button class="button" type="button" data-share-contract>Share state</button>
      <label class="button is-subtle" for="contract-import">Import another version</label>
    </div>
    ${diffHtml()}
    ${runtimeHtml()}
  </section>`;
}

function stageHtml() {
  if (state.stage === "rule") return ruleHtml();
  if (state.stage === "challenges") return challengeHtml();
  if (state.stage === "guardrails") return guardrailsHtml();
  if (state.stage === "approval") return approvalHtml();
  return evidenceHtml();
}

function progressHtml() {
  const current = stageIndex();
  return `<nav class="contract-progress" role="tablist" aria-label="Contract progress">${STAGES.map((stage, index) => {
    const available = stageAvailable(stage.id);
    const selected = state.stage === stage.id;
    return `<button type="button" role="tab" aria-selected="${selected}" tabindex="${selected ? "0" : "-1"}" data-progress-stage="${stage.id}" class="${selected ? "is-active" : ""} ${index < current ? "is-complete" : ""}" ${available ? "" : "disabled"}><span>${index + 1}</span>${esc(stage.label)}</button>`;
  }).join("")}</nav>`;
}

function summaryHtml() {
  const contract = state.contract || state.sourceContract;
  const mutation = state.mutationReport;
  return `<aside class="contract-summary" aria-label="Current contract summary">
    <div><span>Inference</span><strong class="is-${inferenceTone(contract?.inference?.status)}">${esc(title(contract?.inference?.status || "not learned"))}</strong></div>
    <div><span>Approval</span><strong class="is-${approvalTone(contract?.lifecycle?.approvalState)}">${esc(title(contract?.lifecycle?.approvalState || "not started"))}</strong></div>
    <div><span>Blocking questions</span><strong class="${blockingChallenges(contract).length ? "is-danger" : ""}">${blockingChallenges(contract).length}</strong></div>
    <div><span>Mutation tests</span><strong>${mutation ? `${mutation.detected.length} detected · ${plural(mutation.undetected.length, "gap")}` : "Not run"}</strong></div>
    <div class="contract-summary-fingerprint"><span>Fingerprint</span><code>${esc(groupedFingerprint(contract?.identity?.coreFingerprint).slice(0, 29))}</code></div>
  </aside>`;
}

function noticeHtml() {
  if (!state.notice) return "";
  return `<div class="contract-notice format-diagnostic is-${esc(state.noticeTone)}"><p>${esc(state.notice)}</p></div>`;
}

function render(focusSelector = "") {
  if (!root) return;
  root.innerHTML = `<section class="app-shell contract-page">
    <header class="tool-header contract-product-header">
      <div>
        <p class="section-label">Contract Studio · Preview</p>
        <h1>Transformation contracts learned from examples.</h1>
        <p class="tool-subhead">Turn an AI draft or before-and-after mapping into a rule you can inspect, approve, and run deterministically.</p>
      </div>
      <div class="contract-local-status"><span aria-hidden="true"></span><strong>Local & private</strong><small>No model call. No upload.</small></div>
    </header>
    ${progressHtml()}
    ${noticeHtml()}
    <div class="contract-layout"><main class="contract-workspace">${stageHtml()}</main>${summaryHtml()}</div>
    <input class="visually-hidden" id="contract-import" type="file" accept=".json,application/json" data-import-contract>
    <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">${esc(state.announcement)}</div>
  </section>`;
  attachEvents();
  if (focusSelector) requestAnimationFrame(() => root.querySelector(focusSelector)?.focus());
}

function learningInput() {
  return {
    examples: completeExamples().map((example, index) => ({
      id: `example-${index + 1}`,
      input: example.input,
      output: example.output,
      inputFormat: example.inputFormat,
      outputFormat: example.outputFormat,
    })),
  };
}

function defaultRuntimeInput(contract) {
  const values = contract.evidence.examples.map(example => cloneJson(example.input));
  return editorText(values, contract.formats.input);
}

function defaultRuntimeOutput(contract) {
  const values = contract.evidence.examples.map(example => cloneJson(example.output));
  return editorText(values, contract.formats.output);
}

function learnFromEvidence() {
  if (completeExamples().length < 2) {
    setNotice("Add at least two complete examples before learning a rule.", "warn");
    render();
    return;
  }
  state.busy = true;
  render();
  try {
    const contract = learnContract(learningInput(), {
      title: "Contract Studio transformation",
      evidenceSource: "contract-studio",
    });
    state.sourceContract = contract;
    state.contract = contract;
    state.selectedInvariantIds = suggestions(contract).map(item => item.id);
    state.keyGuardSelected = false;
    state.mutationReport = null;
    state.comparison = null;
    state.runtimeReport = null;
    state.runtimeInput = defaultRuntimeInput(contract);
    state.runtimeOutput = defaultRuntimeOutput(contract);
    state.stage = "rule";
    setNotice(
      contract.inference.status === "safe"
        ? "Observed rule learned. Review its evidence before choosing guardrails."
        : `The examples produced a ${contract.inference.status} result. Review the unresolved behavior.`,
      inferenceTone(contract.inference.status),
    );
  } catch (error) {
    setNotice(error?.message || "The examples could not be learned.", "danger");
    state.stage = "evidence";
  } finally {
    state.busy = false;
    render();
  }
}

function updateRuntimePolicy(field, value) {
  if (!state.sourceContract || state.sourceContract.runtimePolicy[field] === value) return;
  const candidate = cloneJson(state.sourceContract);
  candidate.runtimePolicy[field] = value;
  candidate.lifecycle = {
    approvalState: candidate.inference.status === "safe" && !blockingChallenges(candidate).length
      ? "unreviewed"
      : "review_required",
    revision: candidate.lifecycle.revision + 1,
    supersedes: candidate.identity.contractId,
  };
  candidate.approval = null;
  candidate.identity = null;
  try {
    const identified = withTransformationContractIdentity(candidate);
    const validation = validateTransformationContract(identified);
    if (!validation.ok) throw new Error(validation.errors[0]?.message || "The runtime policy is invalid.");
    state.sourceContract = identified;
    state.contract = identified;
    state.mutationReport = null;
  } catch (error) {
    setNotice(error?.message || "Could not update runtime policy.", "danger");
  }
}

function applyGuardrails() {
  try {
    const suggestionIds = new Set(suggestions().map(item => item.id));
    const selected = [
      ...state.selectedInvariantIds.map(id => (
        suggestionIds.has(id)
          ? id
          : state.sourceContract.invariants.find(item => item.id === id)
      )).filter(Boolean),
      ...keyGuardDefinitions(),
    ];
    const selections = [...new Map(selected.map(item => [
      typeof item === "string" ? item : item.id,
      item,
    ])).values()];
    if (!selections.length) throw new Error("Select at least one guardrail.");
    const guarded = acceptTransformationInvariants(state.sourceContract, selections);
    const context = {
      inputRecords: guarded.evidence.examples.map(example => cloneJson(example.input)),
      outputRecords: guarded.evidence.examples.map(example => cloneJson(example.output)),
      failedRecords: [],
    };
    state.contract = guarded;
    state.mutationReport = runTransformationMutationSuite(guarded, context);
    state.runtimeReport = null;
    state.stage = "approval";
    setNotice("Guardrails applied. Mutation tests show both protected behavior and visible gaps.", "safe");
  } catch (error) {
    setNotice(error?.message || "The selected guardrails could not be applied.", "danger");
  }
  render();
}

function approveCurrentContract() {
  try {
    const contract = state.contract;
    const acknowledgedChallenges = advisoryChallenges(contract).map(item => item.id);
    state.contract = approveContract(contract, {
      coreFingerprint: contract.identity.coreFingerprint,
      method: "local-human-review",
      acknowledgedChallenges,
      note: "Reviewed and approved in Contract Studio.",
    });
    setNotice("Contract approved for this exact core fingerprint.", "safe");
  } catch (error) {
    setNotice(error?.message || "Approval could not be completed.", "danger");
  }
  render();
}

function parseChallengeOutput(value, contract) {
  const format = contract.formats.output === "value" ? "json" : contract.formats.output;
  return parseWithFormat(value, format);
}

function answerCurrentChallenge(mode, value) {
  const challenge = currentChallenge();
  if (!challenge) return;
  try {
    const revised = mode === "policy"
      ? answerChallenge(state.sourceContract, challenge.id, { policy: value })
      : answerChallenge(
        state.sourceContract,
        challenge.id,
        { expectedOutput: parseChallengeOutput(value, state.sourceContract) },
      );
    state.sourceContract = revised;
    state.contract = revised;
    state.selectedInvariantIds = suggestions(revised).map(item => item.id);
    state.keyGuardSelected = false;
    state.mutationReport = null;
    state.challengeDraft = "";
    state.runtimeInput = defaultRuntimeInput(revised);
    state.runtimeOutput = defaultRuntimeOutput(revised);
    setNotice(
      mode === "policy"
        ? "Runtime policy recorded without fabricating example evidence."
        : "Expected output added as evidence and the rule was learned again.",
      "safe",
    );
  } catch (error) {
    setNotice(error?.message || "The challenge answer could not be applied.", "danger");
  }
  render();
}

function deferCurrentChallenge() {
  const challenge = currentChallenge();
  if (!challenge) return;
  try {
    const deferred = deferChallenge(state.sourceContract, challenge.id);
    state.sourceContract = deferred;
    state.contract = deferred;
    state.challengeDraft = "";
    setNotice(challengeConsequences(challenge), challenge.severity === "blocking" ? "danger" : "warn");
  } catch (error) {
    setNotice(error?.message || "The challenge could not be deferred.", "danger");
  }
  render();
}

function runRuntime() {
  if (!state.contract) return;
  try {
    const runtimeInput = state.contract.formats.input === "value"
      ? JSON.parse(state.runtimeInput)
      : state.runtimeInput;
    const runtimeOutput = state.contract.formats.output === "value"
      ? JSON.parse(state.runtimeOutput)
      : state.runtimeOutput;
    state.runtimeReport = state.runtimeMode === "run"
      ? runContract({ contract: state.contract, input: runtimeInput })
      : checkContract({
        contract: state.contract,
        input: runtimeInput,
        output: runtimeOutput,
      });
    setNotice(
      state.runtimeReport.verdict === "pass"
        ? "Runtime evidence passed the approved contract."
        : `Runtime verdict: ${title(state.runtimeReport.verdict)}. Review the evidence below.`,
      runtimeTone(state.runtimeReport.verdict),
    );
  } catch (error) {
    setNotice(error?.message || "Runtime execution failed.", "danger");
  }
  render();
}

function download(name, content, type = "application/json") {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([content], { type }));
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

function contractFilename(contract = state.contract) {
  return `latentmachine-contract-${contract.identity.coreFingerprint.slice(0, 8)}.json`;
}

function exportContract() {
  download(contractFilename(), `${pretty(state.contract)}\n`);
  state.announcement = "Contract download started.";
}

function privacySafeReport(report) {
  const redactDiagnostic = item => ({
    ...item,
    evidence: item.evidence == null ? null : { redacted: true },
  });
  return {
    ...cloneJson(report),
    records: report.records.map(record => ({
      rowId: record.rowId,
      sourceIndex: record.sourceIndex,
      key: null,
      status: record.status,
      diagnostics: record.diagnostics.map(redactDiagnostic),
    })),
    passed: report.passed.map(record => ({ rowId: record.rowId, sourceIndex: record.sourceIndex, status: record.status })),
    warned: report.warned.map(record => ({ rowId: record.rowId, sourceIndex: record.sourceIndex, status: record.status })),
    quarantined: report.quarantined.map(record => ({ rowId: record.rowId, sourceIndex: record.sourceIndex, status: record.status })),
    blocked: report.blocked.map(record => ({ rowId: record.rowId, sourceIndex: record.sourceIndex, status: record.status })),
    invariantResults: report.invariantResults.map(result => ({
      ...result,
      evidence: result.evidence == null ? null : { redacted: true },
    })),
    batchDiagnostics: report.batchDiagnostics.map(redactDiagnostic),
    warnings: report.warnings.map(redactDiagnostic),
  };
}

function exportRuntimeReport() {
  download("latentmachine-runtime-report.json", `${pretty(privacySafeReport(state.runtimeReport))}\n`);
}

function exportReviewRecords() {
  if (!window.confirm("This download contains raw input and output values for records that need review. Continue?")) return;
  const records = [...state.runtimeReport.quarantined, ...state.runtimeReport.blocked];
  download("latentmachine-review-records.json", `${pretty(records)}\n`);
}

function shareableState() {
  return {
    version: 1,
    stage: state.stage,
    contract: state.contract,
    sourceContract: state.sourceContract,
    selectedInvariantIds: state.selectedInvariantIds,
    keyGuardSelected: state.keyGuardSelected,
    runtimeMode: state.runtimeMode,
    runtimeInput: state.runtimeInput,
    runtimeOutput: state.runtimeOutput,
  };
}

async function shareContractState(button) {
  if (!window.confirm("This link contains the examples and runtime drafts themselves. Anyone with the link can read them. Continue?")) return;
  try {
    const url = await shareUrlForState(shareableState());
    const copied = await copyText(url);
    button.textContent = copied ? "Link copied" : "Copy failed";
    state.announcement = copied ? "Share link copied." : "Share link could not be copied.";
  } catch (error) {
    setNotice(error?.message || "The state is too large to share. Download the contract instead.", "warn");
    render();
  }
}

function examplesFromContract(contract) {
  return contract.evidence.examples.map(example => normalizedEditorExample({
    input: example.input,
    output: example.output,
    inputFormat: example.formats?.input,
    outputFormat: example.formats?.output,
  }));
}

function importContractValue(value) {
  const validation = validateTransformationContract(value);
  if (!validation.ok) {
    throw new Error(validation.errors[0]?.message || "This is not a valid Transformation Contract.");
  }
  const previous = state.contract;
  state.sourceContract = cloneJson(value);
  state.contract = cloneJson(value);
  state.examples = examplesFromContract(value);
  state.selectedInvariantIds = (value.invariants || []).map(item => item.id);
  state.keyGuardSelected = (value.invariants || []).some(item => item.kind === "key_set_preserved");
  state.mutationReport = value.invariants.length
    ? runTransformationMutationSuite(value, {
      inputRecords: value.evidence.examples.map(example => cloneJson(example.input)),
      outputRecords: value.evidence.examples.map(example => cloneJson(example.output)),
      failedRecords: [],
    })
    : null;
  state.comparison = previous ? compareContracts(previous, value) : null;
  state.runtimeInput = defaultRuntimeInput(value);
  state.runtimeOutput = defaultRuntimeOutput(value);
  state.runtimeReport = null;
  state.stage = value.invariants.length ? "approval" : "rule";
  setNotice("Contract imported and validated locally.", "safe");
}

function importEvidenceValue(value) {
  const examples = Array.isArray(value) ? value : value?.examples;
  if (!Array.isArray(examples) || !examples.length) {
    throw new Error("Import a Transformation Contract or JSON containing an examples array.");
  }
  state.examples = examples.slice(0, MAX_EXAMPLES).map(normalizedEditorExample);
  invalidateLearnedContract();
  setNotice(`${plural(state.examples.length, "example")} imported. Review them before learning.`, "safe");
}

async function importFile(file) {
  const validation = validateImportFile(file, { maxBytes: FILE_IMPORT_MAX_BYTES });
  if (!validation.ok || validation.format !== "json") {
    setNotice(validation.ok ? "Contract imports must be JSON files." : validation.text, "danger");
    render();
    return;
  }
  try {
    const text = await file.text();
    const textValidation = validateImportText(text);
    if (!textValidation.ok) throw new Error(textValidation.text);
    const value = JSON.parse(text);
    if (value?.kind === "latentmachine.transformation-contract") importContractValue(value);
    else importEvidenceValue(value);
  } catch (error) {
    setNotice(error?.message || "The JSON file could not be imported.", "danger");
  }
  render();
}

function loadPreset(kind) {
  const examples = kind === "csv"
    ? csvExamples
    : webhookExamples.map(example => ({
      input: pretty(example.input),
      output: pretty(example.output),
      inputFormat: "json",
      outputFormat: "json",
    }));
  state.examples = examples.map(normalizedEditorExample);
  invalidateLearnedContract();
  state.runtimeInput = kind === "webhook"
    ? pretty([
      { id: "evt_101", status: "created", amount: 24.5 },
      { id: "evt_102", status: "paid", amount: 78 },
    ])
    : "";
  state.runtimeOutput = "";
  setNotice(`${kind === "csv" ? "CSV cleanup" : "Webhook mapping"} evidence loaded.`, "safe");
  render('[data-example-text="0"][data-side="input"]');
}

function navigateStage(stage) {
  if (!stageAvailable(stage)) return;
  if (stage === "challenges" && !openChallenges().length) {
    state.stage = "guardrails";
  } else if (stage === "guardrails" && state.stage === "rule" && openChallenges().length) {
    state.stage = "challenges";
  } else {
    state.stage = stage;
  }
  state.notice = "";
  state.announcement = `${STAGES.find(item => item.id === state.stage)?.label} stage selected.`;
  render();
}

function attachEvents() {
  root.querySelectorAll("[data-stage]").forEach(button => button.addEventListener("click", () => navigateStage(button.dataset.stage)));
  root.querySelectorAll("[data-progress-stage]").forEach(button => {
    button.addEventListener("click", () => navigateStage(button.dataset.progressStage));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const available = [...root.querySelectorAll("[data-progress-stage]:not(:disabled)")];
      const current = available.indexOf(button);
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? available.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + available.length) % available.length;
      event.preventDefault();
      navigateStage(available[next].dataset.progressStage);
      root.querySelector(`[data-progress-stage="${state.stage}"]`)?.focus();
    });
  });
  root.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => loadPreset(button.dataset.preset)));
  root.querySelectorAll("[data-add-example]").forEach(button => button.addEventListener("click", () => {
    if (state.examples.length >= MAX_EXAMPLES) return;
    state.examples.push(blankExample());
    invalidateLearnedContract();
    render(`[data-example-text="${state.examples.length - 1}"][data-side="input"]`);
  }));
  root.querySelectorAll("[data-remove-example]").forEach(button => button.addEventListener("click", () => {
    state.examples.splice(Number(button.dataset.removeExample), 1);
    invalidateLearnedContract();
    render();
  }));
  root.querySelectorAll("[data-example-text]").forEach(field => field.addEventListener("input", () => {
    const example = state.examples[Number(field.dataset.exampleText)];
    if (!example) return;
    example[field.dataset.side] = field.value;
    if (state.sourceContract) {
      const index = Number(field.dataset.exampleText);
      const side = field.dataset.side;
      const cursor = field.selectionStart;
      invalidateLearnedContract();
      render();
      const replacement = root.querySelector(`[data-example-text="${index}"][data-side="${side}"]`);
      replacement?.focus();
      replacement?.setSelectionRange(cursor, cursor);
    }
  }));
  root.querySelectorAll("[data-example-format]").forEach(field => field.addEventListener("change", () => {
    const example = state.examples[Number(field.dataset.exampleFormat)];
    if (!example) return;
    example[`${field.dataset.side}Format`] = field.value;
    invalidateLearnedContract();
    render();
  }));
  root.querySelector("[data-learn]")?.addEventListener("click", learnFromEvidence);
  root.querySelector("[data-challenge-answer]")?.addEventListener("input", event => { state.challengeDraft = event.target.value; });
  root.querySelector("[data-answer-challenge]")?.addEventListener("click", () => {
    const fallback = editorText(
      currentChallenge()?.candidateOutputs?.[0]?.output ?? {},
      state.sourceContract.formats.output,
    );
    answerCurrentChallenge("expected_output", state.challengeDraft || fallback);
  });
  root.querySelectorAll("[data-policy-answer]").forEach(button => button.addEventListener("click", () => answerCurrentChallenge("policy", button.dataset.policyAnswer)));
  root.querySelector("[data-defer-challenge]")?.addEventListener("click", deferCurrentChallenge);
  root.querySelectorAll("[data-invariant]").forEach(input => input.addEventListener("change", () => {
    const selected = new Set(state.selectedInvariantIds);
    if (input.checked) selected.add(input.dataset.invariant);
    else selected.delete(input.dataset.invariant);
    state.selectedInvariantIds = [...selected];
    const applyButton = root.querySelector("[data-apply-guardrails]");
    if (applyButton) applyButton.disabled = state.selectedInvariantIds.length === 0;
    const status = root.querySelector(".contract-stage-head .contract-status");
    if (status) status.textContent = `${state.selectedInvariantIds.length} selected`;
  }));
  root.querySelector("[data-key-guard]")?.addEventListener("change", event => { state.keyGuardSelected = event.target.checked; });
  root.querySelectorAll("[data-runtime-policy]").forEach(select => select.addEventListener("change", () => {
    updateRuntimePolicy(select.dataset.runtimePolicy, select.value);
    render();
  }));
  root.querySelector("[data-apply-guardrails]")?.addEventListener("click", applyGuardrails);
  root.querySelector("[data-approve]")?.addEventListener("click", approveCurrentContract);
  root.querySelector("[data-export-contract]")?.addEventListener("click", exportContract);
  root.querySelector("[data-share-contract]")?.addEventListener("click", event => shareContractState(event.currentTarget));
  root.querySelector("[data-import-contract]")?.addEventListener("change", event => importFile(event.target.files?.[0]));
  root.querySelectorAll("[data-runtime-mode]").forEach(button => button.addEventListener("click", () => {
    state.runtimeMode = button.dataset.runtimeMode;
    state.runtimeReport = null;
    render();
  }));
  root.querySelector("[data-runtime-input]")?.addEventListener("input", event => {
    state.runtimeInput = event.target.value;
    state.runtimeReport = null;
    root.querySelector(".contract-runtime-result")?.remove();
  });
  root.querySelector("[data-runtime-output]")?.addEventListener("input", event => {
    state.runtimeOutput = event.target.value;
    state.runtimeReport = null;
    root.querySelector(".contract-runtime-result")?.remove();
  });
  root.querySelector("[data-run-contract]")?.addEventListener("click", runRuntime);
  root.querySelector("[data-export-report]")?.addEventListener("click", exportRuntimeReport);
  root.querySelector("[data-export-quarantine]")?.addEventListener("click", exportReviewRecords);
}

async function restoreSharedState() {
  try {
    const shared = await sharedStateFromLocation();
    if (!shared || shared.version !== 1) return false;
    const contract = shared.contract || shared.sourceContract;
    if (contract) {
      importContractValue(contract);
      if (shared.sourceContract && validateTransformationContract(shared.sourceContract).ok) {
        state.sourceContract = cloneJson(shared.sourceContract);
      }
      state.selectedInvariantIds = Array.isArray(shared.selectedInvariantIds)
        ? shared.selectedInvariantIds
        : state.selectedInvariantIds;
      state.keyGuardSelected = !!shared.keyGuardSelected;
      state.runtimeMode = shared.runtimeMode === "check" ? "check" : "run";
      state.runtimeInput = String(shared.runtimeInput || state.runtimeInput);
      state.runtimeOutput = String(shared.runtimeOutput || state.runtimeOutput);
      state.stage = stageAvailable(shared.stage) ? shared.stage : state.stage;
      setNotice("Shared Contract Studio state restored locally.", "safe");
      return true;
    }
  } catch (error) {
    setNotice(error?.message || "The shared Contract Studio state could not be restored.", "danger");
  }
  return false;
}

async function init() {
  await restoreSharedState();
  render();
}

init();

export const CONTRACT_STUDIO_VERSION = 1;
export const CONTRACT_STUDIO_STAGES = STAGES.map(stage => stage.id);
