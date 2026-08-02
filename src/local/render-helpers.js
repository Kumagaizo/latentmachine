import { FORMAT_ORDER, FORMATS, OUTPUT_FORMAT_ORDER, parseWithFormat, serializeWithFormat } from "../intelligence/data-formats/index.js";
import { explainOp } from "../intelligence/json-transform/explain.js";
import { JSON_TRANSFORM_SAMPLE_GROUPS, JSON_TRANSFORM_SAMPLES } from "../intelligence/json-transform/samples.js";
import { opSources } from "../intelligence/json-transform/shared.js";
import { esc, inlineCodeHtml, plural } from "./shared.js";

export function createRenderHelpers({
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
}) {
  function statusMeta(result, error) {
    if (error) return { key: "unsafe", label: "Blocked by input", tone: "danger", brand: "Blocked" };
    const status = result?.status || "insufficient";
    if (!result) return { key: "empty", label: "Listening for examples", tone: "muted", brand: "Ready to learn" };
    if (status === "safe") {
      const count = result?.rule?.program?.ops?.length || 0;
      return { key: status, label: "Rule verified", tone: "safe", brand: `${plural(count, "step")} - safe` };
    }
    if (status === "ambiguous") return { key: status, label: "Needs one example", tone: "warn", brand: "Needs proof" };
    if (status === "contradictory") return { key: status, label: "Examples disagree", tone: "danger", brand: "Conflict found" };
    if (status === "unsafe") return { key: status, label: "Needs review", tone: "danger", brand: "Blocked" };
    return { key: status, label: "Needs another example", tone: "warn", brand: "Needs proof" };
  }
  
  function batchStatusMeta(evaluation) {
    const summary = evaluation?.batchSummary || {};
    if (summary.status === "processing") return { key: "batch-processing", label: "Processing batch", tone: "warn", brand: `${summary.processed || 0}/${summary.total || 0} records` };
    if (summary.status === "clean") return { key: "batch-clean", label: "Batch clean", tone: "safe", brand: `${plural(summary.total || 0, "record")} - clean` };
    if (summary.status === "partial") return { key: "batch-partial", label: "Batch needs review", tone: "warn", brand: `${plural(summary.total || 0, "record")} - partial` };
    if (summary.status === "too-large" || summary.status === "invalid") return { key: `batch-${summary.status}`, label: "Batch blocked", tone: "danger", brand: "Batch blocked" };
    if (summary.message) return { key: "batch-waiting", label: "Rule blocked", tone: "danger", brand: "Batch blocked" };
    return { key: "batch", label: "Batch", tone: "muted", brand: "Batch ready" };
  }
  
  function reliabilityLabel(result, error) {
    if (error) return "Blocked";
    if (!result) return "";
    if (result.status === "safe") return "Exact fit";
    if (result.status === "ambiguous" || result.status === "insufficient") return "Needs proof";
    if (result.status === "contradictory" || result.status === "unsafe") return "Blocked";
    return "Partial fit";
  }
  
  function translationLabel(result) {
    if (!result?.inputFormat || !result?.outputFormat) return "";
    if (result.inputFormat === result.outputFormat) return "";
    return `<span class="translation-direction">${esc(formatLabel(result.inputFormat))} → ${esc(formatLabel(result.outputFormat))}</span>`;
  }
  
  function parsePath(path = "$") {
    if (path === "$") return [];
    const parts = [];
    const regex = /\.([A-Za-z_$][\w$]*)|\[(\d+|".*?"|'.*?')\]/g;
    let match;
    while ((match = regex.exec(path))) {
      if (match[1]) parts.push(match[1]);
      else if (/^\d+$/.test(match[2])) parts.push(Number(match[2]));
      else parts.push(JSON.parse(match[2].replace(/^'/, "\"").replace(/'$/, "\"")));
    }
    return parts;
  }
  
  function setJsonPath(root, path, value) {
    const parts = parsePath(path);
    if (!parts.length) return value;
    let target = root;
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      if (last) {
        target[part] = value;
        return;
      }
      const next = parts[index + 1];
      if (!target[part] || typeof target[part] !== "object") target[part] = typeof next === "number" ? [] : {};
      target = target[part];
    });
    return root;
  }
  
  function getJsonPath(root, path) {
    return parsePath(path).reduce((current, part) => current?.[part], root);
  }
  
  function safeJson(text, fallback = {}) {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }
  
  function formatChip(editorId, value, manualFormat = "auto") {
    const detected = detectFormat(value);
    const supported = manualFormat !== "auto" || isSupportedDataFormat(detected) || detected === "empty";
    const autoLabel = detected === "empty" || detected === "unknown" ? "Auto" : `Auto (${formatLabel(detected)})`;
    const options = String(editorId || "").endsWith("-output") ? OUTPUT_FORMAT_ORDER : FORMAT_ORDER;
    return `<select class="format-chip ${supported ? "" : "is-warn"}" data-format-for="${esc(editorId)}" title="Data format">
      <option value="auto" ${manualFormat === "auto" ? "selected" : ""}>${esc(autoLabel)}</option>
      ${options.map(id => `<option value="${esc(id)}" ${manualFormat === id ? "selected" : ""}>${esc(formatLabel(id))}</option>`).join("")}
    </select>`;
  }
  
  function editor(label, value, attrs, classes = "", rows = editorRows(value), options = {}) {
    const manualFormat = options.format || "auto";
    const editorId = options.formatFor || "readonly";
    const canDiagnose = !options.readonlyFormat && editorId !== "readonly";
    return `<div class="editor ${classes}">
      <div class="editor-bar">
        <span>${esc(label)}</span>
        ${options.readonlyFormat ? `<span class="format-chip">${esc(formatLabel(options.readonlyFormat))}</span>` : formatChip(editorId, value, manualFormat)}
      </div>
      <textarea data-editor spellcheck="false" rows="${rows}" ${attrs}>${esc(value)}</textarea>
      ${options.trailingHtml || ""}
      ${formatNote(value, manualFormat)}
      ${canDiagnose ? formatDiagnosticHtml(editorId, value, manualFormat) : ""}
    </div>`;
  }
  
  function conflictExampleIndexes(result) {
    const contradictions = result?.diagnosis?.contradictions || [];
    if (!contradictions.length) return new Set();
    const failed = (result?.diagnostics?.tests || [])
      .filter(test => !test.passed && Number.isFinite(test.index))
      .map(test => test.index);
    const completeIndexes = state.examples
      .map((example, index) => example.input.trim() && example.output.trim() ? index : null)
      .filter(index => index !== null);
    return new Set(failed.length ? failed : completeIndexes);
  }
  
  function exampleNote(example, index, result) {
    if (conflictExampleIndexes(result).has(index)) {
      return { tone: "danger", text: "This example conflicts with another before-and-after pair." };
    }
    const hasInput = !!example.input.trim();
    const hasOutput = !!example.output.trim();
    if (hasInput && !hasOutput) {
      return { tone: "muted", text: "Add the output you want." };
    }
    if (!hasInput && hasOutput) {
      return { tone: "muted", text: "Add the matching input." };
    }
    if (example.correction) {
      return { tone: "safe", text: "Correction - teaches the engine what the output should have been." };
    }
    return null;
  }
  
  function exampleMatchStatus(index, result) {
    if (!result) return null;
    const test = (result.diagnostics?.tests || []).find(item => item.index === index);
    if (!test) return null;
    return test.passed ? "safe" : "danger";
  }
  
  function exampleCard(example, index, result) {
    const isFlash = state.flashIndex === index;
    const conflict = conflictExampleIndexes(result).has(index);
    const note = exampleNote(example, index, result);
    const match = exampleMatchStatus(index, result);
    const pairRows = Math.max(editorRows(example.input), editorRows(example.output));
    return `<article class="example-card ${example.correction ? "is-correction" : ""} ${conflict ? "has-conflict" : ""} ${isFlash ? "is-flash" : ""}" data-example-card="${index}">
      <div class="example-card-head">
        <span>${example.correction ? "Correction" : `Example ${index + 1}`}${match ? `<i class="example-match is-${esc(match)}" aria-label="${match === "safe" ? "Example matched" : "Example missed"}"></i>` : ""}</span>
        <button class="icon-button" type="button" data-remove-example="${index}" aria-label="Remove example">x</button>
      </div>
      ${note ? `<p class="example-note is-${esc(note.tone)}">${esc(note.text)}</p>` : ""}
      <div class="example-pair">
        ${editor("Input", example.input, `data-example="${index}" data-side="input" aria-label="Input data"`, "is-compact", pairRows, { formatFor: `example-${index}-input`, format: example.inputFormat || "auto" })}
        <div class="pair-arrow" aria-hidden="true">&rarr;</div>
        ${editor("Output", example.output, `data-example="${index}" data-side="output" aria-label="Expected output"`, "is-compact", pairRows, { formatFor: `example-${index}-output`, format: example.outputFormat || "auto", trailingHtml: suggestionHint(index) })}
      </div>
    </article>`;
  }
  
  function humanRuleLine(op) {
    return op ? explainOp(op) : "";
  }
  
  function ruleLines(result) {
    const explained = result?.rule?.explanations || result?.explanation?.ruleSentences || [];
    const lines = explained.length
      ? explained.map(item => item.sentence).filter(Boolean)
      : (result?.rule?.program?.ops || []).map(humanRuleLine).filter(Boolean);
    if (!lines.length) return `<div class="rule-empty">No rule yet.</div>`;
    return lines.map(line => `<p class="reasoning-line">${inlineCodeHtml(line)}</p>`).join("");
  }
  
  function specValuePreview(value) {
    if (value === undefined) return "missing";
    if (typeof value === "string") return value.length > 44 ? `${value.slice(0, 41)}...` : value;
    const text = JSON.stringify(value);
    return text && text.length > 44 ? `${text.slice(0, 41)}...` : text;
  }
  
  function parseMapValue(value) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  
  function mapValueList(map = {}) {
    const values = Object.keys(map).map(parseMapValue);
    if (values.length <= 4) return values.map(specValuePreview).join(", ");
    return `${values.slice(0, 4).map(specValuePreview).join(", ")} +${values.length - 4}`;
  }
  
  function issueField(issue = {}) {
    return issue.source || issue.field || issue.path || issue.op?.source || issue.op?.target || null;
  }
  
  function issueTarget(issue = {}) {
    return issue.target || issue.op?.target || issue.field || null;
  }
  
  function issueType(issue = {}) {
    return issue.type || "note";
  }
  
  function issueLabel(issue = {}) {
    const labels = {
      "ambiguous-date": "Ambiguous date",
      "format-warning": "Format",
      "invalid-array": "Invalid array",
      "invalid-date": "Invalid date",
      "invalid-email": "Invalid email",
      "invalid-quantity": "Invalid quantity",
      "missing-source": "Missing",
      "phone-country-unproven": "Country unproven",
      "schema-missing-field": "Missing now",
      "schema-new-field": "New field",
      "schema-type-changed": "Type changed",
      "template-conflict": "Conflict",
      "type-changed-source": "Type changed",
      "unexplained": "No rule",
      "unseen-value-map": "New value",
      "value-map-conflict": "Conflict",
      ambiguity: "Ambiguous",
    };
    const type = issueType(issue);
    return labels[type] || type.replace(/-/g, " ");
  }
  
  function issueTone(issue = {}) {
    const type = issueType(issue);
    if (["ambiguity", "schema-new-field", "schema-missing-field", "schema-type-changed", "format-warning"].includes(type)) return "warn";
    return "danger";
  }
  
  function issueMessage(issue = {}) {
    return infraWarningText(issue) || issue.message || issue.reason || (issue.alternative ? `${issue.selected} vs ${issue.alternative}` : "");
  }
  
  function uniqueSpecIssues(items = []) {
    const seen = new Set();
    return items.filter(item => {
      const key = `${issueType(item)}:${issueField(item)}:${issueTarget(item)}:${issueMessage(item)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  
  function detailPath(path) {
    return `\`${path || "$"}\``;
  }
  
  function detailList(items = []) {
    const values = items.filter(Boolean).map(detailPath);
    if (!values.length) return "the input";
    if (values.length === 1) return values[0];
    if (values.length === 2) return `${values[0]} and ${values[1]}`;
    return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
  }
  
  function productionDetail(op = {}) {
    if (op.op === "set") return op.source === op.target ? "kept from input" : `from ${detailPath(op.source)}`;
    if (op.op === "constant") return `always ${specValuePreview(op.value)}`;
    if (op.op === "coerce") return `read ${detailPath(op.source)} as ${op.to}`;
    if (op.op === "stringCase" || op.op === "stringNormalize" || op.op === "stringReplace") return `from ${detailPath(op.source)}, with text cleaned`;
    if (op.op === "valueMap") return `learned lookup from ${detailPath(op.source)}`;
    if (op.op === "template") return `built from ${detailList(opSources(op))}`;
    if (op.op === "concat") return `joined from ${detailList(op.sources || [])}`;
    if (op.op === "numericTransform" || op.op === "numericCompare" || op.op === "quantityTransform") return `calculated from ${detailPath(op.source)}`;
    if (op.op === "numericBinary") return `calculated from ${detailList([op.left, op.right])}`;
    if (op.op === "numericFormula") return `percentage formula from ${detailList([op.base, op.rate])}`;
    if (op.op === "booleanNot") return `inverted from ${detailPath(op.source)}`;
    if (op.op === "dateFormat") return `date from ${detailPath(op.source)}`;
    if (op.op === "extractBetween") return `text taken from ${detailPath(op.source)}`;
    if (op.op === "splitPart") return `part ${op.index + 1} from ${detailPath(op.source)}`;
    if (op.op === "stringSplit") return `list from ${detailPath(op.source)}`;
    if (op.op === "arrayStringTransform") return `cleaned values from ${detailPath(op.source)}`;
    if (op.op === "arrayMap") return `${op.where ? "filtered values" : "values"} from ${detailPath(op.source)}`;
    if (op.op === "arrayProject") return `${op.where ? "filtered records" : "records"} from ${detailPath(op.source)}`;
    if (op.op === "arrayCount") return `count from ${detailPath(op.source)}`;
    if (op.op === "arraySum") return `sum from ${detailPath(op.source)}`;
    if (op.op === "arrayIndex") return `${String(op.index)} item from ${detailPath(op.source)}`;
    if (op.op === "arrayJoin") return `joined values from ${detailPath(op.source)}`;
    if (op.op === "arrayFind") return `first matching item from ${detailPath(op.source)}`;
    if (op.op === "templateConflict" || op.op === "valueMapConflict") return "examples conflict";
    return "derived from the examples";
  }
  
  function buildRuleSpecification(result, extraIssues = []) {
    const diagnosis = result?.diagnosis || {};
    const program = result?.rule?.program?.ops || [];
    const assumptions = result?.explanation?.assumptions || result?.rule?.explanation?.assumptions || [];
    const schemaDrift = diagnosis.schemaDrift || result?.diagnostics?.schemaDrift || {};
    const driftItems = [...(schemaDrift.blocking || []), ...(schemaDrift.advisory || [])];
    const warnings = [...(result?.warnings || []), ...(diagnosis.guardrails || [])];
    const contradictions = diagnosis.contradictions || [];
    const ambiguities = (diagnosis.ambiguities || []).map(item => ({ ...item, type: "ambiguity", target: item.target }));
    const unexplained = diagnosis.unexplained || result?.diagnostics?.unexplained || [];
    const allIssues = uniqueSpecIssues([...warnings, ...extraIssues, ...contradictions, ...ambiguities, ...driftItems]);
  
    const expectsByField = new Map();
    for (const precondition of result?.preconditions || result?.rule?.preconditions || []) {
      const existing = expectsByField.get(precondition.field) || {
        id: precondition.field,
        path: precondition.field,
        detail: `${precondition.type}${precondition.required ? ", required" : ""}`,
        usedBy: [],
        issues: [],
      };
      if (precondition.usedBy && !existing.usedBy.includes(precondition.usedBy)) existing.usedBy.push(precondition.usedBy);
      expectsByField.set(precondition.field, existing);
    }
  
    for (const item of assumptions) {
      const field = item.field || item.sourceFields?.[0];
      if (!field || !item.sentence) continue;
      const existing = expectsByField.get(field) || {
        id: field,
        path: field,
        detail: item.sentence,
        usedBy: [],
        issues: [],
      };
      existing.detail = item.sentence;
      if (item.target && !existing.usedBy.includes(item.target)) existing.usedBy.push(item.target);
      expectsByField.set(field, existing);
    }
  
    for (const op of program.filter(item => item.op === "valueMap")) {
      const existing = expectsByField.get(op.source) || {
        id: op.source,
        path: op.source,
        detail: "required",
        usedBy: [],
        issues: [],
      };
      if (!existing.detail?.startsWith("Assumes ")) existing.detail = `one of: ${mapValueList(op.map)}`;
      if (op.target && !existing.usedBy.includes(op.target)) existing.usedBy.push(op.target);
      expectsByField.set(op.source, existing);
    }
  
    const produces = program.map((op, index) => ({
      id: `${op.target}-${index}`,
      path: op.target,
      detail: productionDetail(op),
      issues: [],
    }));
    for (const path of unexplained) {
      produces.push({
        id: `unexplained-${path}`,
        path,
        detail: "no safe rule yet",
        issues: [{ type: "unexplained", target: path, message: `No safe rule explains ${path}.` }],
      });
    }
  
    const payloadIssues = [];
    const generalIssues = [];
    for (const issue of allIssues) {
      const field = issueField(issue);
      const target = issueTarget(issue);
      const expected = field ? expectsByField.get(field) : null;
      const produced = target ? produces.find(row => row.path === target) : null;
      if (expected) expected.issues.push(issue);
      else if (produced) produced.issues.push(issue);
      else if (["schema-new-field", "schema-missing-field", "schema-type-changed", "format-warning"].includes(issueType(issue))) payloadIssues.push(issue);
      else generalIssues.push(issue);
    }
  
    return {
      expects: [...expectsByField.values()],
      produces,
      payloadIssues: uniqueSpecIssues(payloadIssues),
      generalIssues: uniqueSpecIssues(generalIssues),
    };
  }
  
  function specIssuePills(issues = []) {
    if (!issues.length) return "";
    const visible = issues.slice(0, 3).map(issue => `<span class="spec-issue is-${esc(issueTone(issue))}">${esc(issueLabel(issue))}</span>`).join("");
    return `<div class="spec-issues">${visible}${issues.length > 3 ? `<span class="spec-issue is-warn">+${esc(issues.length - 3)}</span>` : ""}</div>`;
  }
  
  function specRowsHtml(rows = [], empty) {
    if (!rows.length) return `<p class="spec-empty">${esc(empty)}</p>`;
    return rows.map(row => {
      const firstIssue = row.issues?.[0];
      return `<div class="spec-row">
        <code>${esc(row.path)}</code>
        <div class="spec-row-body">
          <p>${inlineCodeHtml(row.detail)}</p>
          ${row.usedBy?.length ? `<small>used by ${esc(row.usedBy.join(", "))}</small>` : ""}
          ${firstIssue ? `<em class="is-${esc(issueTone(firstIssue))}">${esc(issueMessage(firstIssue))}</em>` : ""}
          ${specIssuePills(row.issues || [])}
        </div>
      </div>`;
    }).join("");
  }
  
  function payloadSpecHtml(spec, result) {
    const suggestions = result?.diagnosis?.suggestedExamples || [];
    const issues = [...(spec.payloadIssues || []), ...(spec.generalIssues || [])];
    const attachedFields = new Set([
      ...spec.expects.flatMap(row => row.issues?.length ? [row.path] : []),
      ...spec.produces.flatMap(row => row.issues?.length ? [row.path] : []),
    ]);
    const visibleSuggestions = suggestions.filter(item => {
      const fields = item.fields?.length ? item.fields : [item.field, item.requiredField, item.target].filter(Boolean);
      return !fields.some(field => attachedFields.has(field));
    });
    if (!issues.length && !visibleSuggestions.length) return "";
    return `<div class="spec-block is-current-payload">
      <div class="section-label">Current payload</div>
      ${issues.slice(0, 5).map(issue => `<div class="spec-row is-compact">
        <code>${esc(issueField(issue) || issueTarget(issue) || issueType(issue))}</code>
        <div class="spec-row-body">
          <p>${esc(issueMessage(issue))}</p>
          ${specIssuePills([issue])}
        </div>
      </div>`).join("")}
      ${visibleSuggestions.slice(0, 3).map(item => `<div class="spec-row is-compact"><div class="spec-row-body"><p>${esc(item.reason || "Add one more example to prove the rule.")}</p></div></div>`).join("")}
    </div>`;
  }
  
  function ruleSpecificationHtml(result, extraIssues = []) {
    if (!result) return "";
    const spec = buildRuleSpecification(result, extraIssues);
    return `<div class="rule-spec">
      <div class="spec-block is-rule-steps">
        <div class="section-label">Rule steps</div>
        <div class="rule-lines">${ruleLines(result)}</div>
      </div>
      <div class="spec-block">
        <div class="section-label">Rule expects</div>
        ${specRowsHtml(spec.expects, "No required input fields yet.")}
      </div>
      <div class="spec-block">
        <div class="section-label">Rule produces</div>
        ${specRowsHtml(spec.produces, "No output targets yet.")}
      </div>
      ${payloadSpecHtml(spec, result)}
    </div>`;
  }
  
  function analysisSummaryText(analysis) {
    const summary = analysis?.summary || {};
    const parts = [];
    if (summary.recordCount) {
      const sampled = summary.sampledRecordCount && summary.sampledRecordCount < summary.recordCount
        ? `, first ${summary.sampledRecordCount} analyzed`
        : "";
      parts.push(`${plural(summary.recordCount, "record")}${sampled}`);
    }
    parts.push(plural(summary.fieldCount || 0, "field"));
    if (summary.depth > 1) parts.push(`${summary.depth} levels deep`);
    if (summary.arrayCount) parts.push(plural(summary.arrayCount, "array"));
    return parts.join(" - ");
  }
  
  function analysisValue(value) {
    const text = JSON.stringify(value);
    return text.length > 34 ? `${text.slice(0, 31)}...` : text;
  }
  
  function analysisFieldDetail(field, pattern) {
    const parts = [];
    if (field.arrayStats) {
      const stats = field.arrayStats;
      const length = stats.minLength === stats.maxLength ? `length ${stats.minLength}` : `length ${stats.minLength}-${stats.maxLength}`;
      const itemTypes = stats.itemTypes.length ? `contains ${stats.itemTypes.join(" or ")}` : "empty";
      parts.push(`array, ${length}, ${itemTypes}`);
    } else {
      parts.push(field.type === "mixed" ? field.types.join(" or ") : field.type);
    }
  
    if (field.numeric && field.numeric.min !== field.numeric.max) {
      parts.push(`range ${field.numeric.min}-${field.numeric.max}`);
    }
  
    if (!field.arrayStats && field.constant) {
      parts.push(`always ${analysisValue(field.constantValue)}`);
    } else if (!field.arrayStats && !field.numeric && field.uniqueValues && field.uniqueValues.length > 1 && field.uniqueValues.length <= 4) {
      parts.push(`one of ${field.uniqueValues.map(analysisValue).join(", ")}`);
    } else if (!field.arrayStats && !field.numeric && field.total > 1 && field.uniqueCount > 1) {
      parts.push(`${field.uniqueCount} unique`);
    }
  
    if (pattern?.description) parts.push(pattern.description);
    if (field.total > 1 && !field.required) parts.push(`${field.presence} of ${field.total} present`);
    if (field.empty) parts.push(`${field.empty} empty`);
    return parts.join(", ");
  }
  
  function isVisibleAnalysisField(field, fieldsByPath) {
    if (field.isContainer && field.type !== "array") return false;
    if (!field.path.endsWith("[]")) return true;
    const parent = fieldsByPath.get(field.path.slice(0, -2));
    const itemTypes = parent?.arrayStats?.itemTypes || [];
    return !(parent?.type === "array" && itemTypes.length > 0 && !itemTypes.includes("object"));
  }
  
  function inputAnalysisHtml(analysis) {
    if (!analysis) return "";
    const patterns = new Map((analysis.patterns || []).map(pattern => [pattern.path, pattern]));
    const fieldsByPath = new Map((analysis.fields || []).map(field => [field.path, field]));
    const fields = (analysis.fields || [])
      .filter(field => isVisibleAnalysisField(field, fieldsByPath))
      .slice(0, 14);
    const total = (analysis.fields || []).filter(field => isVisibleAnalysisField(field, fieldsByPath)).length;
    const hidden = total - fields.length;
  
    return `<div class="rule-spec is-analysis">
      <div class="spec-block is-current-payload">
        <div class="section-label">Structure</div>
        <p class="analysis-summary">${esc(analysisSummaryText(analysis))}</p>
      </div>
      <div class="spec-block is-current-payload">
        <div class="section-label">Fields</div>
        ${fields.length ? fields.map(field => `<div class="spec-row is-compact">
          <code>${esc(field.path)}</code>
          <div class="spec-row-body">
            <p>${esc(analysisFieldDetail(field, patterns.get(field.path)))}</p>
          </div>
        </div>`).join("") : `<p class="spec-empty">No object fields detected.</p>`}
        ${hidden > 0 ? `<p class="spec-empty">${plural(hidden, "more field")}</p>` : ""}
      </div>
    </div>`;
  }
  
  function ruleSpecSummary(result) {
    if (!result) return null;
    const spec = buildRuleSpecification(result);
    const valueMaps = (result.rule?.program?.ops || []).filter(op => op.op === "valueMap").length;
    const issues = [
      ...spec.expects.flatMap(row => row.issues || []),
      ...spec.produces.flatMap(row => row.issues || []),
      ...spec.payloadIssues,
      ...spec.generalIssues,
    ];
    return {
      status: result.status,
      inputFormat: result.inputFormat || "json",
      outputFormat: result.outputFormat || "json",
      requiredCount: spec.expects.length,
      producedCount: spec.produces.length,
      valueMapCount: valueMaps,
      issueCount: uniqueSpecIssues(issues).length,
      requiredFields: spec.expects.slice(0, 4).map(row => row.path),
      producedFields: spec.produces.slice(0, 4).map(row => row.path),
    };
  }
  
  function batchSpecIssues(batchResults = []) {
    return (batchResults || []).flatMap(row => (row.warnings || []).map(warning => ({
      ...warning,
      message: `Record ${row.index + 1}: ${warning.message || warning.type || "Guardrail warning"}`,
    })));
  }
  
  function ruleSummary(result) {
    if (!result) return "Add examples and the engine will infer a reusable rule.";
    const ops = result?.rule?.program?.ops || [];
    const valueMaps = ops.filter(op => op.op === "valueMap").length;
    const computed = ops.filter(op => !["set", "valueMap"].includes(op.op)).length;
    if (result.status === "ambiguous") return "I need one more example to be sure.";
    if (result.status === "contradictory") return "The examples disagree, so the engine is blocking the rule.";
    if (result.status === "unsafe") return "The engine found a rule draft, but it is not safe to reuse yet.";
    if (!ops.length) return "The examples do not prove enough yet.";
    if (valueMaps || computed) {
      const parts = [];
      if (valueMaps) parts.push(plural(valueMaps, "learned lookup"));
      if (computed) parts.push(plural(computed, "computed step"));
      return `The engine found ${plural(ops.length, "step")}, including ${parts.join(" and ")}.`;
    }
    return `The engine found a reusable field mapping with ${plural(ops.length, "step")}.`;
  }
  
  function ambiguityPreview(result) {
    const ambiguity = result?.diagnosis?.ambiguities?.[0];
    if (!ambiguity) return "";
    const selected = ambiguity.selectedReading || ambiguity.selected;
    const alternative = ambiguity.alternativeReading || ambiguity.alternative;
    return `<div class="candidate-preview">
      <span>I cannot tell whether to</span>
      <p>${inlineCodeHtml(selected)}</p>
      <span>or</span>
      <p>${inlineCodeHtml(alternative)}</p>
    </div>`;
  }
  
  function infraWarningText(item) {
    const source = item?.source || item?.field || item?.op?.source || "";
    const record = source.match(/^\$\.Records\[(\d+)\]\.s3\.(.+)$/);
    if (item?.type === "wrapped-s3-notification") {
      return item.message || "This looks like an S3 notification wrapped by SQS or SNS. Unwrap the message body before applying the S3 record rule.";
    }
    if (record) {
      const index = Number(record[1]) + 1;
      const field = record[2];
      if (field === "object.key") return `S3 object key is missing from record ${index}.`;
      if (field === "object.size") return `S3 object size is missing from record ${index}.`;
      if (field === "bucket.name") return `S3 bucket name is missing from record ${index}.`;
      return `S3 field ${field} is missing from record ${index}.`;
    }
    const plainS3 = source.match(/^\$\.s3\.(.+)$/);
    if (plainS3?.[1] === "object.key") return "S3 object key is missing from the record.";
    if (plainS3?.[1] === "bucket.name") return "S3 bucket name is missing from the record.";
    if (source === "$.eventName") return "S3 event name is missing from the record.";
    if (source === "$.eventTime") return "S3 event time is missing from the record.";
    return item?.message || "";
  }
  
  function diagnosisRows(result) {
    if (!result) return "";
    const diagnosis = result.diagnosis || {};
    const warnings = [...(result.warnings || []), ...(diagnosis.guardrails || [])];
    const contradictions = diagnosis.contradictions || [];
    const ambiguities = diagnosis.ambiguities || [];
    const schemaAdvisory = diagnosis.schemaDrift?.advisory || result.diagnostics?.schemaDrift?.advisory || [];
    const unexplained = diagnosis.unexplained || result.diagnostics?.unexplained || [];
    return [
      ...warnings.map(item => ({ tone: "warn", mark: "!", text: infraWarningText(item) || item.message })),
      ...schemaAdvisory.slice(0, 6).map(item => ({ tone: "warn", mark: "!", text: item.message })),
      ...contradictions.map(item => ({ tone: "danger", mark: "x", text: item.message || `Examples disagree on ${item.field}` })),
      ...ambiguities.map(item => ({ tone: "warn", mark: "?", text: `I need one more example for ${item.target}: ${item.selectedReading || item.selected} Also fits: ${item.alternativeReading || item.alternative}` })),
      ...unexplained.map(path => ({ tone: "danger", mark: "x", text: `No safe rule explains ${path}. Add another example or simplify that output field.` })),
    ].map(item => `<div class="diagnosis-row is-${item.tone}"><span>${esc(item.mark)}</span><p>${inlineCodeHtml(item.text)}</p></div>`).join("");
  }
  
  function formatWarningsHtml(result) {
    const warnings = result?.formatWarnings || [];
    if (!warnings.length) return "";
    return `<div class="reasoning-hint is-warn">
      ${warnings.slice(0, 4).map(warning => `<p><strong>Format note.</strong> ${esc(warning.message || warning)}</p>`).join("")}
      ${warnings.length > 4 ? `<p>${esc(warnings.length - 4)} more format notes.</p>` : ""}
    </div>`;
  }
  
  function reasoningHint(result, error) {
    if (error) {
      return {
        tone: "danger",
        title: "The transform is blocked.",
        text: error,
      };
    }
  
    if (!result) {
      return {
        tone: "muted",
        title: "Show one before-and-after example.",
        text: "The engine needs evidence before it can infer a rule.",
      };
    }
  
    const diagnosis = result.diagnosis || {};
    const contradictions = diagnosis.contradictions || [];
    const ambiguities = diagnosis.ambiguities || [];
    const unexplained = diagnosis.unexplained || result.diagnostics?.unexplained || [];
    const warnings = [...(result.warnings || []), ...(diagnosis.guardrails || [])];
  
    if (contradictions.length) {
      const first = contradictions[0];
      return {
        tone: "danger",
        title: "Examples conflict.",
        text: first?.field
          ? `Fix the conflicting example for ${first.field}, or add a clearer field that explains the difference.`
          : "Fix the conflicting example or add a clearer field that explains the difference.",
      };
    }
  
    if (ambiguities.length) {
      const suggestion = diagnosis.suggestedExamples?.find(item => item.type === "ambiguity");
      return {
        tone: "warn",
        title: "I need one more example to be sure.",
        text: suggestion?.reason || "Add one more example that separates the competing interpretations.",
      };
    }
  
    if (unexplained.length) {
      return {
        tone: "danger",
        title: "Some output fields are unexplained.",
        text: `The engine could not infer a safe source for ${unexplained.slice(0, 3).join(", ")}.`,
      };
    }
  
    const invalidQuantity = warnings.find(warning => warning.type === "invalid-quantity");
    if (invalidQuantity) {
      return {
        tone: "warn",
        title: "Resource quantity mismatch.",
        text: invalidQuantity.message || "A resource quantity does not match the unit pattern learned from the examples.",
      };
    }
  
    const invalidArray = warnings.find(warning => warning.type === "invalid-array");
    if (invalidArray) {
      return {
        tone: "warn",
        title: "Expected an array.",
        text: invalidArray.message || "The inferred rule expects a record array at this path.",
      };
    }
  
    const typeChanged = warnings.find(warning => warning.type === "type-changed-source");
    if (typeChanged) {
      return {
        tone: "warn",
        title: "Input shape changed.",
        text: typeChanged.message || "A field used by the learned rule changed type in the new input.",
      };
    }
  
    const ambiguousDate = warnings.find(warning => warning.type === "ambiguous-date");
    if (ambiguousDate) {
      return {
        tone: "warn",
        title: "Date is ambiguous.",
        text: ambiguousDate.message || "Use an ISO date or add an example for this date format.",
      };
    }
  
    const invalidEmail = warnings.find(warning => warning.type === "invalid-email");
    if (invalidEmail) {
      return {
        tone: "warn",
        title: "Email looks invalid.",
        text: invalidEmail.message || "The normalized value does not look like an email address.",
      };
    }
  
    const phoneCountry = warnings.find(warning => warning.type === "phone-country-unproven");
    if (phoneCountry) {
      return {
        tone: "warn",
        title: "Phone country code is not proven.",
        text: phoneCountry.message || "Add an example with this local phone shape or include an explicit country code.",
      };
    }
  
    const wrappedS3 = warnings.find(warning => warning.type === "wrapped-s3-notification");
    if (wrappedS3) {
      return {
        tone: "warn",
        title: "Wrapped S3 notification.",
        text: infraWarningText(wrappedS3),
      };
    }
  
    const unseen = warnings.find(warning => /unseen/i.test(warning.message || "") || warning.type === "unseen-value-map");
    if (unseen) {
      const field = unseen.source || unseen.field || unseen.op?.source;
      return {
        tone: "warn",
        title: "Unseen value found.",
        text: field
          ? `${field} contains a value the rule has not learned yet. Add an example for that value or correct the output.`
          : "The input contains a value the rule has not learned yet. Add an example for that value or correct the output.",
      };
    }
  
    const missing = warnings.find(warning => /missing/i.test(warning.message || "") || warning.type === "missing-source");
    if (missing) {
      const field = missing.source || missing.field || missing.op?.source;
      return {
        tone: "warn",
        title: "Expected field is missing.",
        text: field
          ? `The inferred rule expects ${field}, but it is not present in this input.`
          : "The inferred rule expects a source field that is not present in this input.",
      };
    }
  
    if (result.status === "insufficient") {
      return {
        tone: "warn",
        title: "Needs more evidence.",
        text: "Add another completed before-and-after pair so the engine can infer a reusable rule.",
      };
    }
  
    if (result.status === "unsafe") {
      return {
        tone: "danger",
        title: "Cannot reuse this rule yet.",
        text: "The examples do not produce a reliable rule for the current input.",
      };
    }
  
    return null;
  }
  
  function reasoningHintHtml(result, error) {
    const hint = reasoningHint(result, error);
    if (!hint) return "";
    return `<div class="reasoning-hint is-${esc(hint.tone)}">
      <p><strong>${esc(hint.title)}</strong> ${esc(hint.text)}</p>
    </div>`;
  }
  
  function outputIssueNote(result, error) {
    if (error || !result?.output) return "";
    const output = pretty(result.output);
    const unresolvedCount = (output.match(/\[unresolved:/g) || []).length;
    const missingCount = (output.match(/\[missing /g) || []).length;
    if (unresolvedCount) return `<p class="reliability-note">${plural(unresolvedCount, "unresolved value")} in output. Add an example that shows this value.</p>`;
    if (missingCount) return `<p class="reliability-note">${plural(missingCount, "missing source field")} in output. The rule expects a field that is not present in this input.</p>`;
    if (result.status !== "safe") return `<p class="reliability-note">This output is a draft. See the rule diagnosis before exporting it.</p>`;
    return "";
  }
  
  function outputLeafEntries(value, path = "$") {
    if (Array.isArray(value)) {
      if (!value.length) return [{ path, value }];
      return value.flatMap((item, index) => outputLeafEntries(item, `${path}[${index}]`));
    }
    if (value && typeof value === "object") {
      const rows = Object.entries(value).flatMap(([key, item]) => {
        const segment = /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
        return outputLeafEntries(item, `${path}${segment}`);
      });
      return rows.length ? rows : [{ path, value }];
    }
    return [{ path, value }];
  }
  
  function inlineCorrectionValue(value) {
    if (typeof value === "string") return value;
    if (value === undefined) return "";
    return JSON.stringify(value);
  }
  
  function parseInlineCorrectionValue(text, currentValue) {
    const trimmed = String(text ?? "").trim();
    if (typeof currentValue === "string") return String(text ?? "");
    if (typeof currentValue === "number") {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : text;
    }
    if (typeof currentValue === "boolean") {
      if (/^true$/i.test(trimmed)) return true;
      if (/^false$/i.test(trimmed)) return false;
    }
    if (trimmed === "") return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  
  function outputCorrectionPanel(result, error) {
    if (error || !result?.output) return "";
    const leaves = outputLeafEntries(result.output).slice(0, 24);
    if (!leaves.length) return "";
    return `<div class="output-corrections">
      <div class="output-corrections-head">
        <div>
          <div class="section-label">Corrections</div>
          <p>Edit a wrong value and teach it as a new example.</p>
        </div>
        <span>${plural(leaves.length, "field")}</span>
      </div>
      <div class="output-correction-list">
        ${leaves.map(item => `<div class="output-correction-row">
          <code>${esc(item.path)}</code>
          <input type="text" value="${esc(inlineCorrectionValue(item.value))}" data-output-correction-value="${esc(item.path)}" aria-label="Correct ${esc(item.path)}" />
          <button class="button is-subtle" type="button" data-output-correction="${esc(item.path)}">Teach</button>
        </div>`).join("")}
      </div>
    </div>`;
  }
  
  function diagnosisSummaryHtml(result, meta) {
    const diagnosis = result?.diagnosis || {};
    const matched = diagnosis.examplesMatched || 0;
    const contradictions = diagnosis.contradictions?.length || 0;
    const ambiguities = diagnosis.ambiguities?.length || 0;
    const steps = result?.rule?.program?.ops?.length || 0;
    const tests = testSummary();
  
    if (contradictions) {
      return `<div class="diagnosis-summary is-${meta.tone}">
        <span>${plural(contradictions, "conflict")} found</span>
        <span>output blocked</span>
      </div>`;
    }
  
    const items = [
      `${plural(matched, "example")} matched`,
      tests.total ? `${tests.passed}/${tests.runnable} tests passed` : null,
      `${plural(contradictions, "conflict")}`,
      `${plural(ambiguities, "ambiguity", "ambiguities")}`,
      ambiguities ? "add one example" : `${plural(steps, "step")}`,
    ].filter(Boolean);
  
    return `<div class="diagnosis-summary is-${meta.tone}">
      ${items.map(item => `<span>${esc(item)}</span>`).join(" ")}
    </div>`;
  }
  
  function evidenceSummaryHtml(result) {
    const reliability = result?.reliability;
    const evidence = reliability?.evidence;
    if (!evidence) return "";
    const confidence = result?.confidence || reliability?.confidence || {};
    const reasons = (confidence.reasons || []).slice(0, 3);
    const ambiguityCount = evidence.meaningfulAmbiguities?.length || 0;
    const guardrailCount = evidence.guardrails?.length || 0;
    const unexplainedCount = evidence.unexplainedPaths?.length || 0;
    const schemaDriftCount = (evidence.schemaDrift?.blocking?.length || 0) + (evidence.schemaDrift?.advisory?.length || 0);
    const items = [
      evidence.exactFit ? "exact fit" : "not exact",
      `${evidence.examplesMatched}/${evidence.examplesProvided} examples matched`,
      plural(evidence.operations || 0, "step"),
      unexplainedCount ? plural(unexplainedCount, "unresolved path") : "0 unresolved paths",
      ambiguityCount ? plural(ambiguityCount, "meaningful ambiguity", "meaningful ambiguities") : "0 meaningful ambiguities",
      schemaDriftCount ? plural(schemaDriftCount, "schema drift item") : "0 schema drift",
      guardrailCount ? plural(guardrailCount, "guardrail") : "0 guardrails",
    ];
    return `<div class="evidence-summary">
      <div>
        <div class="section-label">Evidence</div>
        <p>${esc(confidence.note || reliability.supportNote || "Evidence summary.")}</p>
      </div>
      ${reasons.length ? `<div class="evidence-reasons">
        ${reasons.map(reason => `<p>${esc(reason.detail || reason.kind || "Evidence recorded.")}</p>`).join("")}
      </div>` : ""}
      <div class="evidence-summary-items">
        ${items.map(item => `<span>${esc(item)}</span>`).join("")}
      </div>
    </div>`;
  }
  
  function primarySuggestion(result) {
    const suggestions = result?.diagnosis?.suggestedExamples || [];
    return suggestions.find(item => ["ambiguity", "unseen-value", "missing-source", "invalid-quantity", "invalid-array", "wrapped-s3-notification", "insufficient"].includes(item.type)) || suggestions[0] || null;
  }
  
  function nextExampleCard(result) {
    const suggestion = primarySuggestion(result);
    if (!suggestion || result?.status === "safe") return "";
    const fields = suggestion.fields?.length ? suggestion.fields : [suggestion.field, suggestion.requiredField].filter(Boolean);
    const fieldText = fields.length ? `<div class="next-example-fields">${fields.map(field => `<code>${esc(field)}</code>`).join("")}</div>` : "";
    return `<div class="next-example-card">
      <div>
        <div class="section-label">Next example</div>
        <p>${esc(suggestion.reason || "Add one more before-and-after pair to prove the rule.")}</p>
        ${fieldText}
      </div>
      <button class="button is-subtle" type="button" data-add-suggested-example>Add example</button>
    </div>`;
  }
  
  function testStatusLabel(item) {
    if (item?.status === "passed") return "Pass";
    if (item?.status === "failed") return "Mismatch";
    if (item?.status === "invalid") return "Invalid";
    return "Draft";
  }
  
  function testSection(result) {
    const results = evaluateTests();
    const summary = testSummary(results);
    const canAdd = !!result && result.output && !state.correctionDraft;
    const summaryText = summary.total
      ? `${summary.passed}/${summary.runnable} test inputs pass`
      : "Add test inputs to verify the rule without teaching it.";
    return `<div class="test-section">
      <div class="test-head">
        <div>
          <div class="section-label">Tests</div>
          <p>${esc(summaryText)}</p>
        </div>
        <button class="button is-subtle" type="button" data-add-test ${canAdd ? "" : "disabled"}>Add current</button>
      </div>
      ${state.tests.length ? `<div class="test-list">
        ${state.tests.map((test, index) => {
          const resultRow = results[index] || { status: "draft" };
          const rows = Math.max(5, Math.min(10, Math.max(editorRows(test.input), editorRows(test.output))));
          return `<article class="test-card is-${esc(resultRow.status)}">
            <div class="test-card-head">
              <span>Test ${index + 1} - ${esc(testStatusLabel(resultRow))}</span>
              <button class="icon-button" type="button" data-remove-test="${index}" aria-label="Remove test">x</button>
            </div>
            <div class="example-pair">
              ${editor("Input", test.input, `data-test="${index}" data-side="input" aria-label="New input to transform"`, "is-compact", rows)}
              <div class="pair-arrow" aria-hidden="true">&rarr;</div>
              ${editor("Expected", test.output, `data-test="${index}" data-side="output" aria-label="Expected output"`, "is-compact", rows)}
            </div>
            ${resultRow.status === "failed" ? `<p class="example-note is-danger">Predicted ${esc(JSON.stringify(resultRow.output))}</p>` : ""}
            ${resultRow.status === "invalid" ? `<p class="example-note is-danger">${esc(resultRow.error)}</p>` : ""}
          </article>`;
        }).join("")}
      </div>` : ""}
    </div>`;
  }
  
  function testDetails(result) {
    const summary = testSummary();
    const label = summary.total
      ? `Test results (${summary.passed}/${summary.runnable} passed)`
      : "Test results";
    return detailsBlock("tests", label, summary.total, testSection(result));
  }
  
  function learningNoticeHtml(result) {
    if (!state.learningNotice) return "";
    const opCount = result?.rule?.program?.ops?.length || 0;
    return `<div class="learning-notice">
      <strong>${esc(state.learningNotice)}</strong>
      <span>${opCount ? `Current rule has ${plural(opCount, "step")}.` : "The teaching set is ready."}</span>
    </div>`;
  }
  
  function detailsBlock(id, title, count, body) {
    const open = state.openDetails[id] ? "open" : "";
    const suffix = count ? ` (${count})` : "";
    return `<details class="detail-block" data-detail="${id}" ${open}>
      <summary>${esc(title)}${suffix}</summary>
      <div class="detail-body">${body}</div>
    </details>`;
  }
  
  function evidenceDetails(result) {
    const evidence = result?.evidence || [];
    const body = evidence.length ? evidence.map(item => `<div class="detail-item">
      <span>${esc(item.target)}</span>
      ${(item.examples || []).map(example => `<p>${esc(example.exampleId)}: ${example.passed ? "matched" : "missed"}${example.passed ? "" : `, predicted ${esc(JSON.stringify(example.predicted))}`}</p>`).join("")}
    </div>`).join("") : `<p>No evidence yet.</p>`;
    return detailsBlock("evidence", "Evidence", evidence.length, body);
  }
  
  function alternativesDetails(result) {
    const alternatives = result?.diagnostics?.alternatives || [];
    const body = alternatives.length ? alternatives.map(row => `<div class="detail-item">
      <span>${esc(row.target)}</span>
      ${(row.candidates || []).slice(0, 3).map((item, index) => `<p>${index === 0 ? "Chosen" : "Also fits"}: ${inlineCodeHtml(item.program ? explainOp(item.program) : item.title)}</p>`).join("")}
    </div>`).join("") : `<p>No alternatives.</p>`;
    return detailsBlock("alternatives", "Alternatives", alternatives.length, body);
  }
  
  function explanationDetails(result) {
    const explanation = result?.explanation || result?.rule?.explanation;
    if (!explanation) return detailsBlock("explanation", "Explanation", 0, `<p>No explanation yet.</p>`);
    const roles = explanation.outputRoles || [];
    const assumptions = explanation.assumptions || [];
    const reasons = explanation.selectionReasons || [];
    const sources = explanation.sourceFieldsConsidered || [];
    const body = `<div class="detail-item">
        <span>Input shape</span>
        <p>${sources.slice(0, 8).map(esc).join(", ") || "No source fields detected."}</p>
      </div>
      <div class="detail-item">
        <span>Output roles</span>
        ${roles.map(role => `<p>${esc(role.target)}: ${esc(role.role)}${role.sources?.length ? ` from ${esc(role.sources.join(", "))}` : ""}</p>`).join("") || "<p>No output roles yet.</p>"}
      </div>
      <div class="detail-item">
        <span>Why this rule?</span>
        ${reasons.slice(0, 4).map(reason => `<p>${esc(reason.target)}: ${esc(reason.reason)}</p>`).join("") || "<p>No competing rules were close.</p>"}
      </div>
      <div class="detail-item">
        <span>Assumptions</span>
        ${assumptions.slice(0, 6).map(item => `<p>${inlineCodeHtml(item.sentence || item)}</p>`).join("") || "<p>No special assumptions beyond the examples.</p>"}
      </div>`;
    return detailsBlock("explanation", "Explanation", roles.length, body);
  }
  
  function traceDetails(result) {
    const traces = result?.traces || [];
    const body = traces.length ? traces.map(trace => `<div class="detail-item"><span>${esc(trace.phase)}</span><p>${esc(trace.message)}</p></div>`).join("") : `<p>No trace yet.</p>`;
    return detailsBlock("trace", "Trace", traces.length, body);
  }
  
  function inspectDetails(result) {
    if (!result) return "";
    const isOpen = !!state.openDetails.inspect;
    const open = isOpen ? "open" : "";
    return `<details class="inspect-details" data-detail="inspect" ${open}>
      <summary>Inspect</summary>
      <div class="details-row">
        ${evidenceDetails(result)}
        ${explanationDetails(result)}
        ${alternativesDetails(result)}
        ${testDetails(result)}
        ${traceDetails(result)}
      </div>
    </details>`;
  }
  
  function formatDuration(ms = 0) {
    if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
  
  function batchCountsHtml(summary = {}, action = "transformed") {
    if (summary.message) return `<p class="batch-message">${esc(summary.message)}</p>`;
    if (summary.status === "processing") {
      const total = Math.max(1, summary.total || 1);
      const percent = Math.max(0, Math.min(100, Math.round(((summary.processed || 0) / total) * 100)));
      return `<div class="batch-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${esc(summary.total || 0)}" aria-valuenow="${esc(summary.processed || 0)}">
        <div><span style="width: ${esc(percent)}%"></span></div>
        <p>${esc(summary.processed || 0)} / ${esc(summary.total || 0)} records</p>
      </div>
      <div class="batch-counts">
        ${summary.ok ? `<div class="batch-count is-safe"><span>OK</span><p>${esc(summary.ok)} clean so far</p></div>` : ""}
        ${summary.guardrail ? `<div class="batch-count is-warn"><span>!</span><p>${esc(summary.guardrail)} guardrails so far</p></div>` : ""}
        ${summary.errored ? `<div class="batch-count is-danger"><span>x</span><p>${esc(summary.errored)} errors so far</p></div>` : ""}
      </div>`;
    }
    if (summary.status === "clean") {
      return `<div class="batch-count is-safe"><span>OK</span><p>All ${esc(summary.total)} records ${esc(action)} cleanly</p></div>`;
    }
    return `<div class="batch-counts">
      ${summary.ok ? `<div class="batch-count is-safe"><span>OK</span><p>${esc(summary.ok)} clean</p></div>` : ""}
      ${summary.guardrail ? `<div class="batch-count is-warn"><span>!</span><p>${esc(summary.guardrail)} with guardrail warnings</p></div>` : ""}
      ${summary.errored ? `<div class="batch-count is-danger"><span>x</span><p>${esc(summary.errored)} with errors</p></div>` : ""}
    </div>`;
  }
  
  function batchIssuesDetails(evaluation) {
    const issues = batchIssueRows(evaluation.batchResults);
    if (!issues.length) return "";
    const visible = issues.slice(0, BATCH_ISSUE_LIMIT);
    const body = `${visible.map(item => `<div class="detail-item"><span>Record ${esc(item.index + 1)}</span><p>${esc(item.text)}</p></div>`).join("")}
      ${issues.length > BATCH_ISSUE_LIMIT ? `<p>And ${esc(issues.length - BATCH_ISSUE_LIMIT)} more issues. Download the report for every record.</p>` : ""}`;
    return detailsBlock("batch-issues", "Issues", issues.length, body);
  }
  
  function batchPreviewDetails(evaluation) {
    const rows = (evaluation.batchResults || []).slice(0, BATCH_PREVIEW_LIMIT);
    if (!rows.length) return "";
    const body = rows.map(row => `<div class="batch-preview-row">
      <span>Record ${esc(row.index + 1)} - ${esc(row.status)}</span>
      <pre>${esc(pretty(row.output))}</pre>
    </div>`).join("");
    return detailsBlock("batch-preview", "Preview", rows.length, body);
  }
  
  function outputPreviewText(evaluation = {}) {
    if (evaluation.batch) {
      const rows = batchExportOutputs(evaluation.batchResults || []);
      if (!rows.length) return "";
      return serializeWithFormat(rows, evaluation.result?.outputFormat || "json");
    }
    return evaluation.result?.serializedOutput || (evaluation.result?.output ? pretty(evaluation.result.output) : "");
  }
  
  function outputPreview(evaluation = {}) {
    if (evaluation.error) return `<pre class="error-box">${esc(evaluation.error)}</pre>`;
    const text = outputPreviewText(evaluation);
    if (!text) return `<div class="output-empty">${isSavedRuleCheck() ? "Check output" : "Transform output"} will appear here.</div>`;
    const lines = text.split("\n");
    const expanded = state.outputPreviewMode === "all";
    const visibleLines = expanded ? lines : lines.slice(0, 20);
    const hasMore = lines.length > visibleLines.length;
    return `<section class="output-preview ${hasMore && !expanded ? "has-more" : ""}">
      <div class="output-preview-head">
        <div>
          <div class="section-label">Preview</div>
          <p>${esc(lines.length)} ${lines.length === 1 ? "line" : "lines"} generated${evaluation.batchResults?.length ? ` from ${evaluation.batchResults.length} records` : ""}</p>
        </div>
        ${hasMore || expanded ? `<select class="preview-mode" data-output-preview-mode aria-label="Output preview length">
          <option value="preview" ${expanded ? "" : "selected"}>First 20 lines</option>
          <option value="all" ${expanded ? "selected" : ""}>Show all</option>
        </select>` : ""}
      </div>
      <div class="output-preview-body">
        <pre>${esc(visibleLines.join("\n"))}</pre>
      </div>
    </section>`;
  }
  
  function batchResultCard(evaluation, stateChanged = false) {
    const { result, durationMs, batchSummary: summary = {} } = evaluation;
    const meta = batchStatusMeta(evaluation);
    const opCount = result?.rule?.program?.ops?.length || 0;
    const isProcessing = summary.status === "processing";
    const stale = state.hasPendingChanges && !!result;
    const checking = isSavedRuleCheck();
    return `<section class="result-card ${stateChanged ? "reasoning-change" : ""}" data-result-card>
      <div class="result-head">
        <div>
          <div class="section-label">Result</div>
          <h2>${checking ? "Batch check" : "Batch result"}</h2>
          ${translationLabel(result)}
        </div>
        <div class="status-badge is-${meta.tone}" aria-live="polite" role="status">
          <span>${esc(meta.label)}</span>
          ${result ? `<small>${esc(plural(opCount, "step"))}</small>` : ""}
        </div>
      </div>
  
      ${stale ? `<div class="reasoning-hint is-warn"><p><strong>${checking ? "Unchecked payload." : "Pending changes."}</strong> Batch result is from the last ${checking ? "check" : "transform"}.</p></div>` : ""}
      <div class="batch-summary">
        <p>${isProcessing ? `Processing ${esc(summary.total || 0)} records...` : `${esc(summary.total || 0)} records processed in ${esc(formatDuration(durationMs))}`}</p>
        ${batchCountsHtml(summary, checking ? "checked" : "transformed")}
      </div>
      ${isProcessing ? "" : outputPreview(evaluation)}
  
      ${result ? `<div class="rule-section">
        <div class="section-label">Diagnosis</div>
        <p>${esc(ruleSummary(result))}</p>
        ${ruleSpecificationHtml(result, batchSpecIssues(evaluation.batchResults))}
        ${ambiguityPreview(result)}
      </div>` : ""}
  
      ${isProcessing ? "" : batchIssuesDetails(evaluation)}
      ${result ? inspectDetails(result) : ""}
    </section>`;
  }
  
  function resultCard(result, error, stateChanged = false) {
    const output = result?.serializedOutput || (result?.output ? pretty(result.output) : "");
    const meta = statusMeta(result, error);
    const unsafe = result && result.status !== "safe";
    const needsAttention = !!error || (!!result && result.status !== "safe");
    const stale = state.hasPendingChanges && (!!result || !!error);
    const issueNote = outputIssueNote(result, error);
    const diagnosisRowsHtml = diagnosisRows(result);
    const checking = isSavedRuleCheck();
    const analysis = !result && !error ? inputOnlyAnalysis() : null;
    return `<section class="result-card ${stateChanged ? "reasoning-change" : ""}" data-result-card>
      <div class="result-head">
        <div>
          <div class="section-label">Result</div>
          <h2>${checking ? "Check result" : "Output"}</h2>
          ${translationLabel(result)}
        </div>
        <div class="status-badge is-${meta.tone}" aria-live="polite" role="status">
          <span>${esc(meta.label)}</span>
          ${result || error ? `<small>${esc(reliabilityLabel(result, error))}</small>` : ""}
        </div>
      </div>
  
      ${stale ? `<div class="reasoning-hint is-warn"><p><strong>${checking ? "Unchecked payload." : "Pending changes."}</strong> Result and diagnosis are from the last ${checking ? "check" : "transform"}.</p></div>` : ""}
      ${formatWarningsHtml(result)}
      <div class="${unsafe ? "is-muted-output" : ""}">${outputPreview({ result, error })}</div>
      ${outputCorrectionPanel(result, error)}
      ${needsAttention ? issueNote : ""}
  
      <div class="rule-section">
        <div class="section-label">${result ? "Diagnosis" : analysis ? "Input" : "Rule"}</div>
        <p>${esc(analysis ? "Parsed structure." : ruleSummary(result))}</p>
        ${result ? ruleSpecificationHtml(result) : analysis ? inputAnalysisHtml(analysis) : `<div class="rule-lines">${ruleLines(result)}</div>`}
        ${ambiguityPreview(result)}
      </div>
      ${needsAttention && result ? diagnosisSummaryHtml(result, meta) : ""}
      ${learningNoticeHtml(result)}
      ${needsAttention ? reasoningHintHtml(result, error) : ""}
      ${needsAttention ? nextExampleCard(result) : ""}
      ${needsAttention ? diagnosisRowsHtml : ""}
      ${inspectDetails(result)}
    </section>`;
  }
  
  function actionBar(result, error, evaluation = {}) {
    const pending = state.hasPendingChanges;
    if (evaluation.batch) {
      const hasResult = !!result && !error;
      const hasBatchResults = !!evaluation.batchResults?.length;
      const isProcessing = evaluation.batchSummary?.status === "processing";
      const cliDetails = cliExportDetails(result, evaluation);
      const canExport = !pending && hasBatchResults && batchExportOutputs(evaluation.batchResults).length > 0;
      const outputFormat = result?.outputFormat || "json";
      return `<section class="action-bar" aria-label="Exports">
        <button class="button ${canExport ? "is-primary" : ""}" type="button" data-download-batch ${canExport ? "" : "disabled"}>Download ${esc(formatLabel(outputFormat))}</button>
        <button class="button" type="button" data-copy="batch-output" ${canExport ? "" : "disabled"}>${state.copied === "batch-output" ? "Copied" : state.copied === "batch-too-large" ? "Use download" : "Copy all"}</button>
        <button class="button" type="button" data-copy="n8n" ${!pending && hasResult ? "" : "disabled"}>${state.copied === "n8n" ? "Copied" : "n8n Code"}</button>
        <button class="button" type="button" data-download-report ${!pending && hasBatchResults ? "" : "disabled"}>Download report</button>
        <button class="button" type="button" data-copy="rule" ${!pending && hasResult ? "" : "disabled"}>${state.copied === "rule" ? "Copied" : "Copy rule"}</button>
        <button class="button" type="button" data-download-cli ${!pending && hasResult && cliDetails.supported && !isProcessing ? "" : "disabled"}>Export CLI</button>
        <button class="button" type="button" data-save-rule ${!pending && hasResult && result.status === "safe" && !isProcessing ? "" : "disabled"}>Save rule</button>
        <button class="button" type="button" data-share>${state.copied === "share" ? "Link copied" : "Share"}</button>
      </section>`;
    }
    const hasResult = !!result && !error;
    const canExportOutput = !pending && hasResult && result.status === "safe";
    const cliDetails = cliExportDetails(result, evaluation);
    const outputFormat = result?.outputFormat || "json";
    return `<section class="action-bar" aria-label="Exports">
      <button class="button ${canExportOutput ? "is-primary" : ""}" type="button" data-copy="output" ${canExportOutput ? "" : "disabled"}>${state.copied === "output" ? "Copied" : "Copy output"}</button>
      <button class="button" type="button" data-download-output ${canExportOutput ? "" : "disabled"}>Download ${esc(formatLabel(outputFormat))}</button>
      <button class="button" type="button" data-copy="rule" ${!pending && hasResult ? "" : "disabled"}>${state.copied === "rule" ? "Copied" : "Copy rule"}</button>
      <button class="button" type="button" data-copy="n8n" ${!pending && hasResult ? "" : "disabled"}>${state.copied === "n8n" ? "Copied" : "n8n Code"}</button>
      <button class="button" type="button" data-copy="make" ${!pending && hasResult ? "" : "disabled"}>${state.copied === "make" ? "Copied" : "Make.com JS"}</button>
      <button class="button" type="button" data-copy="plain-js" ${!pending && hasResult ? "" : "disabled"}>${state.copied === "plain-js" ? "Copied" : "JS function"}</button>
      <button class="button" type="button" data-download-js ${!pending && hasResult ? "" : "disabled"}>Download .js</button>
      <button class="button" type="button" data-download-cli ${!pending && hasResult && cliDetails.supported ? "" : "disabled"}>Export CLI</button>
      <button class="button" type="button" data-save-rule ${!pending && hasResult && result.status === "safe" ? "" : "disabled"}>Save rule</button>
      <button class="button" type="button" data-share>${state.copied === "share" ? "Link copied" : "Share"}</button>
      <button class="fix-link" type="button" data-fix-output ${!pending && hasResult ? "" : "disabled"}>Output wrong? Fix this &rarr;</button>
    </section>`;
  }
  
  function cliExportDetails(result, evaluation = {}) {
    const inputFormat = result?.inputFormat || result?.translator?.inputFormat || "json";
    const outputFormat = result?.outputFormat || result?.translator?.outputFormat || "json";
    const supportedFormats = new Set(["json", "csv", "toml", "env"]);
    const supported = !!result && result.status === "safe" && supportedFormats.has(inputFormat) && supportedFormats.has(outputFormat);
    const filename = `latentmachine-${filenameSlug(result?.rule?.title)}-cli.mjs`;
    const sampleRows = evaluation.batch
      ? evaluation.batchResults?.length || result?.translator?.rowCount || 0
      : 1;
    const inputExtension = FORMATS[inputFormat]?.fileExtension || "json";
    const outputExtension = FORMATS[outputFormat]?.fileExtension || "json";
    const command = `node ${filename} input.${inputExtension} --out output.${outputExtension} --report report.json --strict`;
    return {
      filename,
      inputFormat,
      outputFormat,
      supported,
      sampleRows,
      command,
      reason: supported
        ? ""
        : !result || result.status !== "safe"
          ? "CLI export is available after a verified rule."
          : "CLI export currently supports JSON, CSV, TOML, and .env rules. XML, SQL INSERT, and YAML exports need bundled parsers and are not enabled yet.",
    };
  }
  
  function inspectionStatusData(evaluation, meta) {
    const result = evaluation?.result;
    const error = evaluation?.error;
    const pending = state.hasPendingChanges && completedExamples().length;
    const diagnosis = result?.diagnosis || {};
    const details = cliExportDetails(result, evaluation);
    const opCount = result?.rule?.program?.ops?.length || 0;
    const matched = diagnosis.examplesMatched ?? completedExamples().length;
    const provided = diagnosis.examplesProvided ?? completedExamples().length;
    const sample = state.activeSample ? samples[state.activeSample] : null;
    const reading = pending
      ? "Pending edits"
      : sample
        ? sample.label
        : result
          ? "Current rule"
          : "Blank canvas";
    const proof = result
      ? `${plural(opCount, "step")} - ${matched}/${provided} matched`
      : error
        ? "Blocked"
        : "Waiting for examples";
    const next = pending ? "Review edits" : details.supported ? "CLI export ready" : result?.status === "safe" ? "Review before export" : result ? "Add proof" : "Awaiting rule";
    return { label: meta.label, tone: meta.tone, reading, proof, next };
  }
  
  function inspectionStatusHtml(data, { cardChanged = false, textChanged = false } = {}) {
    return `<aside class="status-pill is-${data.tone} ${cardChanged ? "reasoning-change" : ""} ${textChanged ? "inspection-change" : ""}" aria-live="polite" role="status" aria-label="Engine trace">
      <div class="inspection-head">
        <span>Engine trace</span>
        <strong>${esc(data.label)}</strong>
      </div>
      <div class="inspection-grid">
        <span>Reading</span><strong>${esc(data.reading)}</strong>
        <span>Proof</span><strong>${esc(data.proof)}</strong>
        <span>Next</span><strong>${esc(data.next)}</strong>
      </div>
    </aside>`;
  }
  
  function cliExportPreviewModal(result, evaluation = {}) {
    if (!state.cliExportPreview) return "";
    const details = cliExportDetails(result, evaluation);
    return `<div class="modal-backdrop" role="presentation" data-close-cli-export>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="cli-export-title" data-cli-export-modal>
        <div class="modal-head">
          <div>
            <div class="section-label">Export</div>
            <h2 id="cli-export-title">CLI artifact</h2>
          </div>
          <button class="icon-button" type="button" aria-label="Close" data-close-cli-export>&times;</button>
        </div>
        <div class="cli-export-summary ${details.supported ? "is-safe" : "is-warn"}">
          <p><strong>${details.supported ? "Ready to download." : "Not available for this rule."}</strong> ${esc(details.supported ? "The file includes usage guidance and a baked self-test." : details.reason)}</p>
        </div>
        <dl class="export-facts">
          <div><dt>File</dt><dd>${esc(details.filename)}</dd></div>
          <div><dt>Formats</dt><dd>${esc(formatLabel(details.inputFormat))} &rarr; ${esc(formatLabel(details.outputFormat))}</dd></div>
          <div><dt>Runtime</dt><dd>Node 18+, no install</dd></div>
          <div><dt>Checks</dt><dd>--readme, --self-test, --report</dd></div>
          <div><dt>Sample</dt><dd>${esc(details.sampleRows ? plural(details.sampleRows, "record") : "current payload")}</dd></div>
        </dl>
        ${details.supported ? `<div class="command-example">
          <div class="command-example-head">
            <span>CI-style run</span>
            <button class="command-copy" type="button" data-copy-cli-command="${esc(details.command)}">${state.copied === "cli-command" ? "Copied" : "Copy"}</button>
          </div>
          <code>${esc(details.command)}</code>
        </div>` : ""}
        <div class="modal-actions">
          <button class="button is-subtle" type="button" data-close-cli-export>Cancel</button>
          <button class="button is-primary" type="button" data-confirm-cli-export ${details.supported ? "" : "disabled"}>Download CLI</button>
        </div>
      </section>
    </div>`;
  }
  
  function emptyState() {
    return "";
  }
  
  function presetsPanelHtml() {
    const activeGroup = sampleGroups[state.activeSampleGroup] ? state.activeSampleGroup : DEFAULT_SAMPLE_GROUP_ID;
    const visibleSamples = JSON_TRANSFORM_SAMPLES.filter(sample => (sample.group || DEFAULT_SAMPLE_GROUP_ID) === activeGroup);
    const activeDescription = samples[state.activeSample]?.group === activeGroup ? samples[state.activeSample]?.description : "";
    const description = activeDescription || sampleGroups[activeGroup]?.description || "Load a preset when you want a quick reference.";
    return `<div class="preset-panel">
      ${visibleSamples.map(sample => `<button type="button" class="${state.activeSample === sample.id ? "is-active" : ""}" data-sample="${sample.id}">${esc(sample.label)}</button>`).join("")}
    </div>
    <p class="preset-description">${esc(description)}</p>`;
  }
  
  function presetsSection() {
    return `<section class="preset-section" data-presets>
      <button class="button is-primary preset-start" type="button" data-start-blank>Start blank</button>
      <p class="preset-hint">or switch examples.</p>
      <div class="preset-box">
        <div class="preset-groups" role="tablist" aria-label="Preset groups">
          ${JSON_TRANSFORM_SAMPLE_GROUPS.map(group => `<button type="button" role="tab" aria-selected="${state.activeSampleGroup === group.id ? "true" : "false"}" class="${state.activeSampleGroup === group.id ? "is-active" : ""}" data-sample-group="${esc(group.id)}">${esc(group.label)}</button>`).join("")}
        </div>
        <div class="preset-box-body">
          ${presetsPanelHtml()}
        </div>
      </div>
    </section>`;
  }
  
  function memorySection() {
    const saved = state.savedRules || [];
    if (!saved.length) return `<p class="memory-empty">Save a reliable rule to reuse it later.</p>`;
    return `<section class="memory-section">
      <div class="memory-head">
        <div>
          <div class="section-label">Saved rules</div>
          ${saved.length ? "" : "<p>Save a reliable rule to reuse this transform later.</p>"}
        </div>
        <span>${plural(saved.length, "saved rule")}</span>
      </div>
      ${saved.length ? `<div class="memory-list">
        ${saved.map(item => `<article class="memory-item">
          <div class="memory-row">
            <button class="memory-load" type="button" data-load-rule="${esc(item.id)}">
              <strong>${esc(item.name)}</strong>
              ${savedRuleMetaHtml(item)}
              ${savedRuleSpecHtml(item)}
            </button>
            <div class="memory-actions">
              <button class="icon-button" type="button" data-delete-rule="${esc(item.id)}" aria-label="Delete saved rule">x</button>
            </div>
          </div>
          ${savedRuleDetailsHtml(item)}
        </article>`).join("")}
      </div>` : ""}
    </section>`;
  }
  
  function savedRuleMetaHtml(item) {
    const summary = item.specSummary || {};
    const created = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "saved";
    const formats = summary.inputFormat && summary.outputFormat && summary.inputFormat !== summary.outputFormat
      ? `${formatLabel(summary.inputFormat)} → ${formatLabel(summary.outputFormat)}`
      : formatLabel(summary.outputFormat || item.outputFormat || "json");
    const parts = [
      `${plural(item.operationCount || 0, "step")}`,
      created,
      formats,
    ];
    return `<span class="memory-meta">${parts.map(esc).join(" - ")}</span>`;
  }
  
  function savedRuleSpecHtml(item) {
    const summary = item.specSummary || {};
    if (!summary.requiredCount && !summary.producedCount) return "";
    const expects = summary.requiredFields || [];
    const produces = summary.producedFields || [];
    return `<div class="memory-spec">
      ${expects.length ? `<p><span>Expects</span><code>${esc(expects.slice(0, 3).join(", "))}${expects.length > 3 ? "..." : ""}</code></p>` : ""}
      ${produces.length ? `<p><span>Produces</span><code>${esc(produces.slice(0, 3).join(", "))}${produces.length > 3 ? "..." : ""}</code></p>` : ""}
    </div>`;
  }
  
  function savedRuleDetailsHtml(item) {
    const summary = item.specSummary || {};
    if (!summary.requiredFields?.length && !summary.producedFields?.length) return "";
    return `<details class="memory-details">
      <summary aria-label="Saved rule details">Details</summary>
      <div>
        ${summary.requiredFields?.length ? `<p><span>Expects</span>${esc(summary.requiredFields.join(", "))}</p>` : ""}
        ${summary.producedFields?.length ? `<p><span>Produces</span>${esc(summary.producedFields.join(", "))}</p>` : ""}
      </div>
    </details>`;
  }
  
  function mainFlow(evaluation, stateChanged = false) {
    const { result, error } = evaluation;
    if (!state.examples.length) return `<section class="flow">${presetsSection()}${emptyState()}${memorySection()}</section>`;
    const checking = isSavedRuleCheck();
    const examplesBody = state.examples.map((example, index) => exampleCard(example, index, result)).join("");
    return `<section class="flow">
      ${presetsSection()}
  
      <section class="flow-section ${checking ? "is-saved-rule" : ""}">
        <div class="section-head">
          <div>
            <h2>${checking ? "Learned rule" : "Examples"}</h2>
            ${checking ? `<p>Loaded from ${esc(state.loadedRule.name)}. Edit examples to teach a new rule.</p>` : ""}
          </div>
          <div class="section-actions ${checking ? "is-muted-actions" : ""}">
            <button class="button is-subtle" type="button" data-clear>Clear</button>
            <button class="button" type="button" data-add-example>+ Add</button>
          </div>
        </div>
        ${checking ? `<details class="saved-rule-examples">
          <summary>${esc(plural(state.examples.length, "teaching example"))}</summary>
          <div class="examples">${examplesBody}</div>
        </details>` : `<div class="examples">${examplesBody}</div>
        <button class="add-card" type="button" data-add-example>+ Add example</button>`}
      </section>
  
      <section class="flow-section">
        <div class="section-head">
          <div>
            <h2>${checking ? "Payload to check" : "Data to transform"}</h2>
          </div>
        </div>
        ${editor(checking ? "Paste payload" : "Paste data", state.tryInput, `data-try-input aria-label="${checking ? "Batch input data" : "New input to transform"}"`, "is-try", undefined, { formatFor: "try", format: state.inputFormat || "auto" })}
        ${dataInputNote(state.tryInput, state.inputFormat || "auto", checking ? "checked" : "transformed")}
        ${fileImportPanel()}
        ${transformStep(evaluation)}
      </section>
  
      <section class="flow-section">
        ${evaluation.batch ? batchResultCard(evaluation, stateChanged) : resultCard(result, error, stateChanged)}
        ${actionBar(result, error, evaluation)}
        ${memorySection()}
      </section>
    </section>`;
  }

  return {
    actionBar,
    batchResultCard,
    batchStatusMeta,
    cliExportDetails,
    cliExportPreviewModal,
    formatDuration,
    inspectionStatusData,
    inspectionStatusHtml,
    mainFlow,
    resultCard,
    ruleSpecSummary,
    statusMeta,
  };
}
