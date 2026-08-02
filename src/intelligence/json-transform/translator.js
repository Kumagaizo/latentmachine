import { FORMATS, detectUnsupportedFormat, formatLabel, normalizeFormatId, resolveFormat, serializeWithFormat } from "../data-formats/index.js";
import { clone, getPath } from "./core.js";
import { runJsonTransform } from "./engine.js";
import { executeJsonTransform, runtimeWarnings } from "./runtime.js";
import { deepEqual, opSources } from "./shared.js";

function formatWarnings(warnings = [], label = "Input", format = "unknown") {
  return warnings
    .filter(Boolean)
    .map((warning, index) => ({
      type: "format-warning",
      format,
      field: label,
      message: `${label}: ${warning?.message || warning}`,
      id: `${label}-${format}-${index}`,
    }));
}

function parseFormattedValue(value, requestedFormat = "auto", label = "Input", options = {}) {
  if (typeof value !== "string") {
    return { value: clone(value), format: "json", detected: "json", warnings: [] };
  }

  const unsupported = detectUnsupportedFormat(value);
  if (unsupported && requestedFormat !== "json") {
    throw new Error(`${label}: ${unsupported.label}: ${unsupported.message}`);
  }

  if (requestedFormat === "auto" || requestedFormat === "csv") {
    try {
      return {
        value: FORMATS.json.parse(value, options),
        format: "json",
        detected: "json",
        warnings: [],
      };
    } catch {}
  }

  let format;
  try {
    format = resolveFormat(value, requestedFormat, options);
  } catch (error) {
    throw new Error(`${label}: ${error?.message || "could not detect format"}`);
  }

  try {
    const parser = FORMATS[format].parseWithWarnings || null;
    if (parser) {
      const parsed = parser(value, options);
      return {
        value: parsed.value,
        format,
        detected: format,
        warnings: formatWarnings(parsed.warnings, label, format),
      };
    }

    return {
      value: FORMATS[format].parse(value, options),
      format,
      detected: format,
      warnings: [],
    };
  } catch (error) {
    throw new Error(`${label}: ${formatLabel(format)}: ${error?.message || "could not parse value"}`);
  }
}

function resolveOutputFormat(input, parsedExamples) {
  const requested = normalizeFormatId(input.outputFormat || "auto");
  if (requested !== "auto") {
    if (FORMATS[requested]?.inputOnly) {
      throw new Error(`${formatLabel(requested)} is input-only and cannot be used as an output format.`);
    }
    return requested;
  }

  const exampleFormats = [...new Set(parsedExamples.map(example => example.formats.output))];
  if (exampleFormats.length > 1) {
    throw new Error("Output examples use multiple formats. Choose one target format for this translation.");
  }

  if (FORMATS[exampleFormats[0]]?.inputOnly) {
    throw new Error(`${formatLabel(exampleFormats[0])} is input-only and cannot be used as an output format.`);
  }

  return exampleFormats[0] || "json";
}

function shouldApplyAsBatch(task) {
  return Array.isArray(task.newInput)
    && task.newInput.length > 0
    && task.examples.length > 0
    && task.examples.every(example => !Array.isArray(example.input));
}

function buildEngineInput(input, task) {
  return {
    ...input,
    examples: task.examples.map(example => ({
      id: example.id,
      input: example.input,
      output: example.output,
      correction: example.correction,
    })),
    newInput: task.applyAsBatch ? task.newInput[0] : task.newInput,
  };
}

function batchRuntimeWarnings(task, program) {
  if (!task.applyAsBatch || !Array.isArray(task.newInput)) return [];
  return task.newInput.flatMap((row, index) => runtimeWarnings(program, row).map(warning => ({
    ...warning,
    batchRow: index,
    message: `Row ${index + 1}: ${warning.message}`,
  })));
}

function warningField(warning) {
  return warning.source || warning.op?.source || warning.op?.target || null;
}

function cleanWarningMessage(message = "") {
  return String(message).replace(/^Row \d+:\s*/, "");
}

function summarizeBatch(task, warnings = []) {
  const rowCount = Array.isArray(task.newInput) ? task.newInput.length : 1;
  const failedRows = [...new Set(warnings.map(warning => warning.batchRow).filter(row => row !== undefined))].sort((a, b) => a - b);
  const groupsByKey = new Map();

  for (const warning of warnings) {
    const field = warningField(warning);
    const key = `${warning.type}:${field || ""}:${cleanWarningMessage(warning.message)}`;
    const row = warning.batchRow;
    const existing = groupsByKey.get(key) || {
      type: warning.type,
      field,
      message: cleanWarningMessage(warning.message),
      rows: [],
      sampleValue: undefined,
    };
    if (row !== undefined && !existing.rows.includes(row + 1)) existing.rows.push(row + 1);
    if (existing.sampleValue === undefined && field && Array.isArray(task.newInput) && row !== undefined) {
      existing.sampleValue = clone(getPath(task.newInput[row], field));
    }
    groupsByKey.set(key, existing);
  }

  const groups = [...groupsByKey.values()]
    .map(group => ({
      ...group,
      rows: group.rows.sort((a, b) => a - b),
      rowCount: group.rows.length,
    }))
    .sort((a, b) => b.rowCount - a.rowCount || String(a.field || "").localeCompare(String(b.field || "")));

  return {
    totalRows: rowCount,
    successfulRows: Math.max(0, rowCount - failedRows.length),
    failedRows: failedRows.map(row => row + 1),
    failureCount: failedRows.length,
    groups,
  };
}

function mergeBatchDiagnosis(diagnosis = {}, warnings = []) {
  if (!warnings.length) return diagnosis;
  const guardrails = warnings.map(warning => ({
    type: warning.type,
    field: warning.source || warning.op?.source || warning.op?.target,
    batchRow: warning.batchRow,
    message: warning.message,
  }));
  const suggestedExamples = warnings
    .filter(warning => warning.type === "missing-source" || warning.type === "unseen-value-map")
    .map(warning => ({
      type: warning.type === "missing-source" ? "missing-source" : "unseen-value",
      reason: warning.type === "missing-source"
        ? `Add an example where ${warning.source || warning.op?.source || "the missing field"} is present, or remove that output dependency.`
        : `Add an example covering another value for ${warning.op?.source || "the mapped field"}.`,
      field: warning.source || warning.op?.source,
      fields: [warning.source || warning.op?.source].filter(Boolean),
      batchRow: warning.batchRow,
    }));

  return {
    ...diagnosis,
    status: "unsafe",
    guardrails: [...(diagnosis.guardrails || []), ...guardrails],
    suggestedExamples: [...(diagnosis.suggestedExamples || []), ...suggestedExamples],
  };
}

function mergeBatchConfidence(confidence = {}, warnings = []) {
  if (!warnings.length) return confidence;
  const risks = new Set([...(confidence.risks || []), "unsafe", ...warnings.map(warning => warning.type)]);
  const reasons = [
    ...(confidence.reasons || []),
    ...warnings.map(warning => ({
      kind: "batch-guardrail",
      detail: warning.message || `Batch row ${Number.isFinite(warning.batchRow) ? warning.batchRow + 1 : ""} triggered ${warning.type || "a guardrail"}.`,
      caps: "unsafe",
    })),
  ];
  return {
    ...confidence,
    label: "unsafe",
    risk: "high",
    reasons,
    checks: confidence.checks
      ? { ...confidence.checks, passed: Math.max(0, confidence.checks.passed - 1) }
      : confidence.checks,
    risks: [...risks],
  };
}

function operationKind(op) {
  if (op.op === "set") return op.source === op.target ? "kept" : "moved";
  if (op.op === "constant") return "added";
  if (op.op === "fallback") return "resolved";
  if (op.op === "coerce") return "coerced";
  if (op.op === "stringCase" || op.op === "stringNormalize" || op.op === "stringReplace" || op.op === "arrayStringTransform") return "normalized";
  if (op.op === "valueMap") return "mapped";
  if (op.op === "concat" || op.op === "template") return "built";
  if (op.op === "splitPart" || op.op === "stringSplit") return "split";
  if (op.op === "numericTransform" || op.op === "numericBinary" || op.op === "numericFormula" || op.op === "quantityTransform" || op.op === "booleanNot" || op.op === "conditional") return "computed";
  if (op.op === "dateFormat") return "formatted";
  if (op.op === "extractBetween" || op.op === "regexExtract" || op.op === "arrayFind") return "extracted";
  if (op.op === "arrayMap" || op.op === "arrayProject" || op.op === "arrayGroupBy") return "reshaped";
  if (op.op === "arrayCount") return "counted";
  if (op.op === "arraySum") return "summed";
  if (op.op === "arrayIndex") return "selected";
  if (op.op === "arrayJoin") return "joined";
  if (op.op === "templateConflict" || op.op === "valueMapConflict") return "blocked";
  return "changed";
}

function operationLabel(op) {
  const labels = {
    added: "Added",
    blocked: "Blocked",
    built: "Built",
    changed: "Changed",
    coerced: "Coerced",
    computed: "Computed",
    counted: "Counted",
    extracted: "Extracted",
    formatted: "Formatted",
    joined: "Joined",
    kept: "Kept",
    mapped: "Mapped",
    moved: "Moved",
    normalized: "Normalized",
    reshaped: "Reshaped",
    resolved: "Resolved",
    split: "Split",
  };
  return labels[operationKind(op)] || "Changed";
}

function valuesForSources(input, sources) {
  if (!sources.length) return undefined;
  if (sources.length === 1) return clone(getPath(input, sources[0]));
  return Object.fromEntries(sources.map(source => [source, clone(getPath(input, source))]));
}

function targetEffect(input, op, after) {
  const previous = getPath(input, op.target);
  if (previous === undefined) return "added";
  if (deepEqual(previous, after)) return "kept";
  return "changed";
}

function buildChangeLedger(program, input, output, options = {}) {
  const rows = (program?.ops || []).map((op, index) => {
    const sources = opSources(op);
    const after = clone(getPath(output, op.target));
    return {
      id: `${op.target}:${index}`,
      index,
      row: options.row,
      kind: operationKind(op),
      label: operationLabel(op),
      op: op.op,
      source: sources[0] || null,
      sources,
      target: op.target,
      before: valuesForSources(input, sources),
      after,
      targetEffect: targetEffect(input, op, after),
      changed: !deepEqual(valuesForSources(input, sources), after),
    };
  });
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.kind]: (acc[row.kind] || 0) + 1 }), {});
  return {
    mode: options.mode || "single",
    row: options.row,
    rowCount: options.rowCount || 1,
    total: rows.length,
    counts,
    rows,
  };
}

export function buildTransformTask(input = {}) {
  const rawExamples = input.examples || [];
  const examples = rawExamples.map((example, index) => {
    const parsedInput = parseFormattedValue(
      example.input,
      example.inputFormat || input.inputFormat || "auto",
      `Example ${index + 1} input`,
      { singleRowAsObject: true },
    );
    const parsedOutput = parseFormattedValue(
      example.output,
      example.outputFormat || input.outputFormat || "auto",
      `Example ${index + 1} output`,
      { singleRowAsObject: true },
    );

    return {
      id: example.id,
      input: parsedInput.value,
      output: parsedOutput.value,
      correction: !!example.correction,
      formats: {
        input: parsedInput.format,
        output: parsedOutput.format,
      },
      formatWarnings: [...parsedInput.warnings, ...parsedOutput.warnings],
    };
  });

  const parsedNewInput = input.newInput === undefined
    ? { value: examples.at(-1)?.input, format: examples.at(-1)?.formats.input || "json", detected: examples.at(-1)?.formats.input || "json" }
    : parseFormattedValue(
      input.newInput,
      input.newInputFormat || input.inputFormat || "auto",
      "New input",
      { singleRowAsObject: true },
    );

  const outputFormat = resolveOutputFormat(input, examples);
  const task = {
    examples,
    newInput: parsedNewInput.value,
    newInputFormat: parsedNewInput.format,
    outputFormat,
    formatWarnings: [
      ...examples.flatMap(example => example.formatWarnings || []),
      ...(parsedNewInput.warnings || []),
    ],
    formats: {
      examples: examples.map(example => example.formats),
      newInput: parsedNewInput.format,
      output: outputFormat,
    },
  };

  return {
    ...task,
    applyAsBatch: shouldApplyAsBatch(task),
  };
}

export function runBuiltTransform(input = {}, task = buildTransformTask(input), options = {}) {
  const applyBatch = options.applyBatch ?? true;
  const result = runJsonTransform(buildEngineInput(input, task));
  const output = task.applyAsBatch && applyBatch
    ? task.newInput.map(row => executeJsonTransform(result.rule.program, row))
    : result.output;
  const serializedOutput = serializeWithFormat(output, task.outputFormat);
  const batchWarnings = applyBatch ? batchRuntimeWarnings(task, result.rule.program) : [];
  const hasBatchRuntimeWarnings = batchWarnings.length > 0;
  const warnings = [...(result.warnings || []), ...batchWarnings, ...(task.formatWarnings || [])];
  const status = hasBatchRuntimeWarnings ? "unsafe" : result.status;
  const diagnosis = mergeBatchDiagnosis(result.diagnosis, batchWarnings);
  const confidence = mergeBatchConfidence(result.confidence, batchWarnings);
  const batchSummary = summarizeBatch(task, batchWarnings);
  const changeLedger = task.applyAsBatch && applyBatch
    ? buildChangeLedger(result.rule.program, task.newInput[0], output[0] || {}, { mode: "batch-sample", row: 1, rowCount: task.newInput.length })
    : buildChangeLedger(result.rule.program, task.newInput, output);

  return {
    ...result,
    status,
    confidence,
    diagnosis,
    method: "dataTranslator",
    warnings,
    batchSummary,
    changeLedger,
    formatWarnings: task.formatWarnings || [],
    output,
    serializedOutput,
    outputText: serializedOutput,
    inputFormat: task.newInputFormat,
    outputFormat: task.outputFormat,
    formats: task.formats,
    translator: {
      inputFormat: task.newInputFormat,
      outputFormat: task.outputFormat,
      batchApplied: task.applyAsBatch && applyBatch,
      rowCount: Array.isArray(task.newInput) ? task.newInput.length : 1,
    },
  };
}

export function runTransform(input = {}) {
  return runBuiltTransform(input, buildTransformTask(input));
}
