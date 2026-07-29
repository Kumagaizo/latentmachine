import { parseWithFormat } from "../data-formats/index.js";
import {
  clone,
  entries,
  getPath,
  typeOf,
} from "../json-transform/core.js";
import {
  executeJsonTransform,
  runtimeWarnings,
} from "../json-transform/runtime.js";
import {
  deepEqual,
  stableStringify,
} from "../json-transform/shared.js";
import { fingerprintTransformationRuntimeDiagnostic } from "./identity.js";
import { evaluatePrevalidatedTransformationInvariants } from "./invariants.js";
import { validateTransformationContract } from "./schema.js";

const UNRESOLVED_MARKERS = Object.freeze([
  "[missing",
  "[unresolved",
  "[invalid",
  "[conflict",
]);

const VERDICT_RANK = Object.freeze({
  pass: 0,
  warn: 1,
  quarantine: 2,
  block: 3,
  invalid_contract: 4,
});

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function strongestVerdict(values) {
  return values.reduce((strongest, value) => (
    VERDICT_RANK[value] > VERDICT_RANK[strongest] ? value : strongest
  ), "pass");
}

function assertNotAborted(options) {
  if (options?.signal?.aborted) {
    const error = new Error("Transformation Contract execution was cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

function emitProgress(options, phase, completed, total) {
  if (typeof options?.onProgress === "function") {
    options.onProgress({ phase, completed, total });
  }
}

function emitRecordProgress(options, phase, completed, total) {
  const interval = Number.isInteger(options?.progressEvery) && options.progressEvery > 0
    ? options.progressEvery
    : 100;
  if (completed === total || completed === 0 || completed % interval === 0) {
    emitProgress(options, phase, completed, total);
  }
}

function runtimeValue(value, format, label) {
  if (typeof value !== "string" || format === "value") return clone(value);
  return parseWithFormat(value, format || "json");
}

function diagnosticId(contract, seed) {
  return `diag_${fingerprintTransformationRuntimeDiagnostic(contract, seed).hex.slice(0, 12)}`;
}

function runtimeDiagnostic(contract, value, privacySafe = false) {
  const seed = {
    code: value.code,
    scope: value.scope,
    rowIndex: value.rowIndex ?? null,
    rowId: value.rowId ?? null,
    path: value.path ?? null,
    invariantId: value.invariantId ?? null,
    instanceIndex: value.instanceIndex ?? 0,
  };
  return {
    id: diagnosticId(contract, seed),
    code: value.code,
    severity: value.severity,
    scope: value.scope,
    rowIndex: value.rowIndex ?? null,
    rowId: value.rowId ?? null,
    path: value.path ?? null,
    invariantId: value.invariantId ?? null,
    message: value.message,
    evidence: privacySafe ? value.privacyEvidence || null : cloneJson(value.evidence ?? null),
  };
}

function emptyTotals() {
  return {
    input: 0,
    passed: 0,
    warned: 0,
    quarantined: 0,
    blocked: 0,
  };
}

function baseReport(mode, contract, verdict, errors, trace = []) {
  return {
    kind: mode === "check" ? "latentmachine.contract-check" : "latentmachine.contract-run",
    reportVersion: "1.0",
    mode,
    contractId: contract?.identity?.contractId || null,
    contractFingerprint: contract?.identity?.coreFingerprint || null,
    verdict,
    totals: emptyTotals(),
    records: [],
    passed: [],
    warned: [],
    quarantined: [],
    blocked: [],
    invariantResults: [],
    batchDiagnostics: [],
    warnings: [],
    errors: cloneJson(errors || []),
    trace,
  };
}

function validateRuntimeContract(mode, contract) {
  const validation = validateTransformationContract(contract);
  if (!validation.ok) {
    return baseReport(mode, contract, "invalid_contract", validation.errors, [{
      type: "contract.validation_failed",
      errorCount: validation.errors.length,
    }]);
  }
  if (["superseded", "revoked"].includes(contract.lifecycle.approvalState)) {
    return baseReport(mode, contract, "invalid_contract", [{
      code: "inactive-contract",
      path: "$.lifecycle.approvalState",
      message: `A ${contract.lifecycle.approvalState} Transformation Contract cannot be used at runtime.`,
    }], [{
      type: "contract.validated",
      contractId: contract.identity.contractId,
    }, {
      type: "contract.lifecycle_rejected",
      approvalState: contract.lifecycle.approvalState,
    }]);
  }
  if (contract.runtimePolicy.requireApproval && contract.lifecycle.approvalState !== "approved") {
    return baseReport(mode, contract, "invalid_contract", [{
      code: "approval-required",
      path: "$.lifecycle.approvalState",
      message: "This Transformation Contract requires an active approval before runtime use.",
    }], [{
      type: "contract.validated",
      contractId: contract.identity.contractId,
    }, {
      type: "contract.approval_rejected",
      approvalState: contract.lifecycle.approvalState,
    }]);
  }
  return null;
}

function jsonType(value) {
  const actual = typeOf(value);
  return actual === "number" && Number.isInteger(value) ? "integer" : actual;
}

function typeMatches(value, expected) {
  const actual = jsonType(value);
  return actual === expected || (actual === "integer" && expected === "number");
}

function schemaTypes(schema = {}) {
  if (typeof schema.type === "string") return [schema.type];
  if (Array.isArray(schema.type)) return schema.type;
  if (Array.isArray(schema.anyOf)) return [...new Set(schema.anyOf.flatMap(schemaTypes))].sort(compareText);
  return [];
}

function childPath(path, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function schemaIssues(value, schema = {}, path = "$", unknownPolicy = "allow", direction = "input") {
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema.anyOf)) {
    const branchResults = schema.anyOf.map(branch => ({
      branch,
      issues: schemaIssues(value, branch, path, unknownPolicy, direction),
    }));
    if (branchResults.some(result => result.issues.length === 0)) return [];
    const matching = branchResults.find(result => schemaTypes(result.branch).some(type => typeMatches(value, type)));
    if (matching) return matching.issues;
    const expected = schemaTypes(schema);
    return [{
      code: `${direction}-type-mismatch`,
      severity: "blocking",
      path,
      message: `${path} must have one of the accepted types: ${expected.join(", ")}.`,
      evidence: { expectedTypes: expected, actualType: jsonType(value) },
    }];
  }
  if (typeof schema.type === "string" && !typeMatches(value, schema.type)) {
    return [{
      code: `${direction}-type-mismatch`,
      severity: "blocking",
      path,
      message: `${path} must be ${schema.type}; received ${jsonType(value)}.`,
      evidence: { expectedType: schema.type, actualType: jsonType(value) },
    }];
  }
  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const issues = [];
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        const requiredPath = childPath(path, key);
        issues.push({
          code: `${direction}-required-path-missing`,
          severity: "blocking",
          path: requiredPath,
          message: `${requiredPath} is required by the contract schema.`,
          evidence: { required: true },
        });
      }
    }
    for (const key of Object.keys(value).sort(compareText)) {
      const itemPath = childPath(path, key);
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        issues.push(...schemaIssues(value[key], properties[key], itemPath, unknownPolicy, direction));
      } else if (unknownPolicy !== "allow") {
        issues.push({
          code: direction === "output" ? "unexpected-output-path" : "unknown-input-path",
          severity: unknownPolicy === "block" ? "blocking" : "advisory",
          path: itemPath,
          message: `${itemPath} is not part of the accepted ${direction} schema.`,
          evidence: { policy: unknownPolicy },
        });
      }
    }
    return issues;
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    return value.flatMap((item, index) => schemaIssues(
      item,
      schema.items,
      `${path}[${index}]`,
      unknownPolicy,
      direction,
    ));
  }
  return [];
}

function inputPreconditionIssues(contract, input) {
  return (contract.input?.preconditions || []).flatMap(precondition => {
    const value = getPath(input, precondition.field);
    if (value === undefined && precondition.required) {
      return [{
        code: "required-input-missing",
        severity: "blocking",
        path: precondition.field,
        message: `${precondition.field} is required by ${precondition.usedBy || "the learned program"}.`,
        evidence: {
          usedBy: precondition.usedBy || null,
          expectedType: precondition.type || null,
        },
      }];
    }
    if (value !== undefined && precondition.type && !typeMatches(value, precondition.type)) {
      return [{
        code: "input-precondition-type-mismatch",
        severity: "blocking",
        path: precondition.field,
        message: `${precondition.field} must be ${precondition.type}; received ${jsonType(value)}.`,
        evidence: {
          usedBy: precondition.usedBy || null,
          expectedType: precondition.type,
          actualType: jsonType(value),
        },
      }];
    }
    return [];
  });
}

function programWarningIssues(contract, input) {
  return runtimeWarnings(contract.program, input).map(warning => {
    const source = warning.source || warning.op?.source;
    const missingValueMapSource = warning.type === "unseen-value-map"
      && source
      && getPath(input, source) === undefined;
    return {
      code: missingValueMapSource ? "missing-source" : warning.type || "program-runtime-warning",
      severity: "blocking",
      path: source || warning.op?.target || "$",
      message: missingValueMapSource
        ? `${source} is required by the learned value mapping but is missing from the input.`
        : warning.message || "The learned program reported a runtime guardrail violation.",
      evidence: {
        operation: cloneJson(warning.op || null),
      },
    };
  });
}

function unresolvedOutputIssues(contract, output) {
  const policy = contract.output?.unresolvedValuePolicy || "allow";
  if (policy === "allow") return [];
  return entries(output, [], { includeContainers: false })
    .filter(entry => (
      typeof entry.value === "string"
      && UNRESOLVED_MARKERS.some(marker => entry.value.startsWith(marker))
    ))
    .map(entry => ({
      code: "unresolved-output-value",
      severity: policy === "block" ? "blocking" : "advisory",
      path: entry.path,
      message: `${entry.path} contains an unresolved runtime placeholder.`,
      evidence: { policy },
    }));
}

function rawInputIssues(contract, input) {
  return [
    ...schemaIssues(input, contract.input?.schema, "$", contract.input?.unknownFieldPolicy, "input"),
    ...inputPreconditionIssues(contract, input),
    ...programWarningIssues(contract, input),
  ];
}

function rawOutputIssues(contract, output) {
  return [
    ...schemaIssues(output, contract.output?.schema, "$", contract.output?.unknownFieldPolicy, "output"),
    ...unresolvedOutputIssues(contract, output),
  ];
}

function invariantDiagnostics(contract, results, rowIndex, rowId, privacySafe) {
  return results
    .filter(result => result.status === "fail" || result.status === "warn")
    .map(result => runtimeDiagnostic(contract, {
      code: "invariant-violation",
      severity: result.status === "fail" ? "blocking" : "advisory",
      scope: "record",
      rowIndex,
      rowId,
      invariantId: result.invariantId,
      path: null,
      message: result.message,
      evidence: result.evidence,
      privacyEvidence: { affected: true },
    }, privacySafe));
}

function materializeIssues(contract, issues, rowIndex, rowId, scope, privacySafe) {
  const uniqueIssues = [];
  const seen = new Set();
  for (const issue of issues) {
    const privacyEvidence = issue.privacyEvidence || (
      issue.evidence ? { present: true } : null
    );
    const key = stableStringify({
      code: issue.code,
      severity: issue.severity,
      path: issue.path ?? null,
      invariantId: issue.invariantId ?? null,
      batchEvidence: scope === "batch" ? privacyEvidence : null,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueIssues.push({ issue, privacyEvidence });
  }
  return uniqueIssues.map(({ issue, privacyEvidence }, instanceIndex) => runtimeDiagnostic(contract, {
    ...issue,
    scope,
    rowIndex: scope === "record" ? rowIndex : null,
    rowId: scope === "record" ? rowId : null,
    instanceIndex,
    privacyEvidence,
  }, privacySafe));
}

function keyConfiguration(contract, options = {}) {
  const setInvariant = (contract.invariants || []).find(invariant => invariant.kind === "key_set_preserved");
  const inputUnique = (contract.invariants || []).find(invariant => (
    invariant.kind === "key_unique"
    && invariant.parameters.subject === "input"
  ));
  const outputUnique = (contract.invariants || []).find(invariant => (
    invariant.kind === "no_duplicate_output_keys"
    || (invariant.kind === "key_unique" && invariant.parameters.subject === "output")
  ));
  return {
    inputKeyPath: options.inputKeyPath
      || options.keyPath
      || setInvariant?.parameters.inputKeyPath
      || inputUnique?.parameters.keyPath
      || null,
    outputKeyPath: options.outputKeyPath
      || options.keyPath
      || setInvariant?.parameters.outputKeyPath
      || outputUnique?.parameters.keyPath
      || null,
  };
}

function rowIdentities(inputs, inputKeyPath, privacySafe) {
  const encoded = inputs.map(input => (
    inputKeyPath ? stableStringify(getPath(input, inputKeyPath)) : null
  ));
  const totals = new Map();
  for (const value of encoded.filter(value => value !== null && value !== "__undefined__")) {
    totals.set(value, (totals.get(value) || 0) + 1);
  }
  const occurrences = new Map();
  return inputs.map((input, index) => {
    const key = inputKeyPath ? getPath(input, inputKeyPath) : undefined;
    const encodedKey = encoded[index];
    if (privacySafe || encodedKey === null || encodedKey === "__undefined__") {
      return {
        rowId: `row:${index}`,
        sourceIndex: index,
        key: privacySafe ? null : cloneJson(key),
        duplicateKey: false,
      };
    }
    const occurrence = (occurrences.get(encodedKey) || 0) + 1;
    occurrences.set(encodedKey, occurrence);
    const duplicateKey = totals.get(encodedKey) > 1;
    return {
      rowId: duplicateKey ? `key:${encodedKey}#${occurrence}` : `key:${encodedKey}`,
      sourceIndex: index,
      key: cloneJson(key),
      duplicateKey,
    };
  });
}

function rowStatus(contract, diagnostics) {
  const blocking = diagnostics.filter(item => item.severity === "blocking").length;
  const advisory = diagnostics.filter(item => item.severity === "advisory").length;
  if (blocking) {
    if (contract.runtimePolicy.onRecordViolation === "block") return "blocked";
    if (contract.runtimePolicy.onRecordViolation === "warn") return "warned";
    return "quarantined";
  }
  if (advisory > contract.runtimePolicy.warningThreshold) return "warned";
  return "passed";
}

function recordEnvelope(identity, values, diagnostics, status, privacySafe) {
  return {
    rowId: identity.rowId,
    sourceIndex: identity.sourceIndex,
    key: privacySafe ? null : cloneJson(identity.key),
    status,
    diagnostics,
    ...(privacySafe ? {} : Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        value === undefined ? null : cloneJson(value),
      ]),
    )),
  };
}

function outputDifferenceIssues(expected, actual, path = "$", output = []) {
  if (deepEqual(expected, actual)) return output;
  const expectedObject = expected && typeof expected === "object" && !Array.isArray(expected);
  const actualObject = actual && typeof actual === "object" && !Array.isArray(actual);
  if (expectedObject && actualObject) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort(compareText);
    for (const key of keys) {
      const expectedPresent = Object.prototype.hasOwnProperty.call(expected, key);
      const actualPresent = Object.prototype.hasOwnProperty.call(actual, key);
      const itemPath = childPath(path, key);
      if (!expectedPresent) {
        output.push({
          code: "unexpected-output-path",
          severity: "blocking",
          path: itemPath,
          message: `${itemPath} exists in actual output but not in expected output.`,
          evidence: { expectedPresent: false, actualPresent: true, actual: cloneJson(actual[key]) },
          privacyEvidence: { expectedPresent: false, actualPresent: true },
        });
      } else if (!actualPresent) {
        output.push({
          code: "output-path-missing",
          severity: "blocking",
          path: itemPath,
          message: `${itemPath} is missing from actual output.`,
          evidence: { expectedPresent: true, actualPresent: false, expected: cloneJson(expected[key]) },
          privacyEvidence: { expectedPresent: true, actualPresent: false },
        });
      } else {
        outputDifferenceIssues(expected[key], actual[key], itemPath, output);
      }
    }
    return output;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      const expectedPresent = index < expected.length;
      const actualPresent = index < actual.length;
      const childPath = `${path}[${index}]`;
      if (!expectedPresent || !actualPresent) {
        output.push({
          code: expectedPresent ? "output-path-missing" : "unexpected-output-path",
          severity: "blocking",
          path: childPath,
          message: expectedPresent
            ? `${childPath} is missing from actual output.`
            : `${childPath} exists in actual output but not in expected output.`,
          evidence: {
            expectedPresent,
            actualPresent,
            expected: expectedPresent ? cloneJson(expected[index]) : null,
            actual: actualPresent ? cloneJson(actual[index]) : null,
          },
          privacyEvidence: { expectedPresent, actualPresent },
        });
      } else {
        outputDifferenceIssues(expected[index], actual[index], childPath, output);
      }
    }
    return output;
  }
  output.push({
    code: "output-value-mismatch",
    severity: "blocking",
    path,
    message: `${path} differs from the output produced by the approved program.`,
    evidence: { expected: cloneJson(expected), actual: cloneJson(actual) },
    privacyEvidence: { expectedType: jsonType(expected), actualType: jsonType(actual) },
  });
  return output;
}

function keyIndex(records, path) {
  const index = new Map();
  records.forEach((record, rowIndex) => {
    const value = getPath(record, path);
    const encoded = stableStringify(value);
    if (!index.has(encoded)) index.set(encoded, []);
    index.get(encoded).push({ rowIndex, record, value });
  });
  return {
    index,
    duplicates: [...index.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([encoded, rows]) => ({
        encoded,
        key: cloneJson(rows[0].value),
        rowIndices: rows.map(row => row.rowIndex),
      })),
  };
}

function duplicateKeyIssues(contract, records, path, side, privacySafe) {
  if (!path || !records.length) return [];
  return keyIndex(records, path).duplicates.map((item, instanceIndex) => runtimeDiagnostic(contract, {
    code: `duplicate-${side}-key`,
    severity: "blocking",
    scope: "batch",
    instanceIndex,
    path,
    message: `${side === "input" ? "Input" : "Output"} key ${path} is duplicated across rows ${item.rowIndices.join(", ")}.`,
    evidence: { key: item.key, rowIndices: item.rowIndices },
    privacyEvidence: { rowIndices: item.rowIndices },
  }, privacySafe));
}

function aggregateInvariantResults(contract, inputRecords, alignedOutputRecords, batchOutputRecords, failedRecords) {
  const recordEvaluation = evaluatePrevalidatedTransformationInvariants(contract, {
    inputRecords,
    outputRecords: alignedOutputRecords,
    failedRecords,
  });
  const batchEvaluation = evaluatePrevalidatedTransformationInvariants(contract, {
    inputRecords,
    outputRecords: batchOutputRecords,
    failedRecords,
  });
  const recordById = new Map(recordEvaluation.results.map(result => [result.invariantId, result]));
  const batchById = new Map(batchEvaluation.results.map(result => [result.invariantId, result]));
  return contract.invariants.map(invariant => cloneJson(
    invariant.scope === "batch" ? batchById.get(invariant.id) : recordById.get(invariant.id),
  ));
}

function reportInvariantResults(results, privacySafe) {
  if (!privacySafe) return results;
  return results.map(result => ({
    ...result,
    evidence: result?.evidence == null ? null : { redacted: true },
  }));
}

function batchInvariantDiagnostics(contract, invariantResults, privacySafe) {
  const byId = new Map(contract.invariants.map(invariant => [invariant.id, invariant]));
  return invariantResults
    .filter(result => result && byId.get(result.invariantId)?.scope === "batch")
    .filter(result => result.status === "fail" || result.status === "warn")
    .map(result => runtimeDiagnostic(contract, {
      code: "batch-invariant-violation",
      severity: result.status === "fail" ? "blocking" : "advisory",
      scope: "batch",
      path: null,
      invariantId: result.invariantId,
      message: result.message,
      evidence: result.evidence,
      privacyEvidence: { affected: true },
    }, privacySafe));
}

function finalizeReport({
  mode,
  contract,
  records,
  invariantResults,
  batchDiagnostics,
  trace,
}) {
  const hasBlockingBatch = batchDiagnostics.some(item => item.severity === "blocking");
  const hasAdvisoryBatch = batchDiagnostics.some(item => item.severity === "advisory");
  const batchVerdict = hasBlockingBatch
    ? contract.runtimePolicy.onBatchViolation
    : hasAdvisoryBatch ? "warn" : "pass";
  const finalRecords = batchVerdict === "block"
    ? records.map(record => ({ ...record, status: "blocked" }))
    : records;
  const passed = finalRecords.filter(record => record.status === "passed");
  const warned = finalRecords.filter(record => record.status === "warned");
  const quarantined = finalRecords.filter(record => record.status === "quarantined");
  const blocked = finalRecords.filter(record => record.status === "blocked");
  const recordVerdict = blocked.length
    ? "block"
    : quarantined.length ? "quarantine"
      : warned.length ? "warn" : "pass";
  const verdict = strongestVerdict([recordVerdict, batchVerdict]);
  const warnings = [
    ...finalRecords.flatMap(record => record.diagnostics.filter(item => item.severity === "advisory")),
    ...batchDiagnostics.filter(item => item.severity === "advisory"),
  ];
  return {
    kind: mode === "check" ? "latentmachine.contract-check" : "latentmachine.contract-run",
    reportVersion: "1.0",
    mode,
    contractId: contract.identity.contractId,
    contractFingerprint: contract.identity.coreFingerprint,
    verdict,
    totals: {
      input: finalRecords.length,
      passed: passed.length,
      warned: warned.length,
      quarantined: quarantined.length,
      blocked: blocked.length,
    },
    records: finalRecords,
    passed,
    warned,
    quarantined,
    blocked,
    invariantResults,
    batchDiagnostics,
    warnings,
    errors: [],
    trace: [
      ...trace,
      {
        type: "runtime.completed",
        mode,
        verdict,
        inputCount: finalRecords.length,
      },
    ],
  };
}

function prepareRuntime(mode, contract, input, options) {
  assertNotAborted(options);
  emitProgress(options, "validate", 0, 1);
  const rejected = validateRuntimeContract(mode, contract);
  emitProgress(options, "validate", 1, 1);
  if (rejected) return { rejected };
  assertNotAborted(options);

  let parsedInput;
  try {
    parsedInput = runtimeValue(input, contract.formats.input, "Input");
  } catch (error) {
    return {
      rejected: baseReport(mode, contract, "block", [{
        code: "input-parse-error",
        path: "$",
        message: error.message,
      }], [{
        type: "contract.validated",
        contractId: contract.identity.contractId,
      }, {
        type: "input.parse_failed",
        format: contract.formats.input,
      }]),
    };
  }
  const isBatch = options.batch ?? Array.isArray(parsedInput);
  const inputs = isBatch ? parsedInput : [parsedInput];
  if (!Array.isArray(inputs)) {
    return {
      rejected: baseReport(mode, contract, "block", [{
        code: "batch-input-required",
        path: "$",
        message: "Batch execution requires an array of input records.",
      }]),
    };
  }
  const keys = keyConfiguration(contract, options);
  const identities = rowIdentities(inputs, keys.inputKeyPath, !!options.privacySafe);
  return {
    parsedInput,
    isBatch,
    inputs,
    keys,
    identities,
    trace: [
      {
        type: "contract.validated",
        contractId: contract.identity.contractId,
      },
      {
        type: "contract.approval_checked",
        required: contract.runtimePolicy.requireApproval,
        approvalState: contract.lifecycle.approvalState,
      },
      {
        type: "input.parsed",
        format: contract.formats.input,
        batch: isBatch,
        recordCount: inputs.length,
      },
    ],
  };
}

function perRecordInvariantResults(contract, input, output) {
  const evaluation = evaluatePrevalidatedTransformationInvariants(
    contract,
    { input, output },
  );
  const scopeById = new Map(contract.invariants.map(invariant => [invariant.id, invariant.scope]));
  return evaluation.results.filter(result => scopeById.get(result.invariantId) === "record");
}

export function runContract({ contract, input, options = {} } = {}) {
  const prepared = prepareRuntime("run", contract, input, options);
  if (prepared.rejected) return prepared.rejected;
  const {
    inputs,
    identities,
    keys,
    trace,
  } = prepared;
  const privacySafe = !!options.privacySafe;
  const records = [];
  const alignedOutputs = [];
  const completedOutputs = [];
  emitRecordProgress(options, "execute", 0, inputs.length);

  for (let index = 0; index < inputs.length; index += 1) {
    assertNotAborted(options);
    const inputRecord = inputs[index];
    const identity = identities[index];
    let output;
    let issues = rawInputIssues(contract, inputRecord);
    try {
      output = executeJsonTransform(contract.program, inputRecord);
      issues = [...issues, ...rawOutputIssues(contract, output)];
    } catch (error) {
      issues.push({
        code: "program-execution-error",
        severity: "blocking",
        path: "$",
        message: error.message,
        evidence: { operationCount: contract.program.ops.length },
      });
    }
    alignedOutputs.push(output);
    if (output !== undefined) completedOutputs.push(output);
    const diagnostics = materializeIssues(contract, issues, index, identity.rowId, "record", privacySafe);
    const invariantResults = output === undefined
      ? []
      : perRecordInvariantResults(contract, inputRecord, output);
    diagnostics.push(...invariantDiagnostics(
      contract,
      invariantResults,
      index,
      identity.rowId,
      privacySafe,
    ));
    const status = rowStatus(contract, diagnostics);
    records.push(recordEnvelope(identity, {
      input: inputRecord,
      output,
    }, diagnostics, status, privacySafe));
    emitRecordProgress(options, "execute", index + 1, inputs.length);
  }

  const failedRecords = records
    .filter(record => ["quarantined", "blocked"].includes(record.status))
    .map(record => ({ rowId: record.rowId, sourceIndex: record.sourceIndex }));
  const invariantResults = aggregateInvariantResults(
    contract,
    inputs,
    alignedOutputs,
    completedOutputs,
    failedRecords,
  );
  const batchDiagnostics = [
    ...duplicateKeyIssues(contract, inputs, keys.inputKeyPath, "input", privacySafe),
    ...duplicateKeyIssues(contract, completedOutputs, keys.outputKeyPath, "output", privacySafe),
    ...batchInvariantDiagnostics(contract, invariantResults, privacySafe),
  ];
  const reportedInvariantResults = reportInvariantResults(invariantResults, privacySafe);
  emitProgress(options, "invariants", contract.invariants.length, contract.invariants.length);
  return finalizeReport({
    mode: "run",
    contract,
    records,
    invariantResults: reportedInvariantResults,
    batchDiagnostics,
    trace: [
      ...trace,
      {
        type: "program.executed",
        inputCount: inputs.length,
        outputCount: completedOutputs.length,
      },
      {
        type: "invariants.evaluated",
        invariantCount: invariantResults.length,
      },
    ],
  });
}

function parseActualOutput(contract, output, prepared) {
  const parsed = runtimeValue(output, contract.formats.output, "Output");
  if (prepared.isBatch) {
    if (!Array.isArray(parsed)) throw new Error("Batch checking requires an array of output records.");
    return parsed;
  }
  return [parsed];
}

function keyedActualPairing(expectedOutputs, actualOutputs, outputKeyPath) {
  const expected = keyIndex(expectedOutputs, outputKeyPath);
  const actual = keyIndex(actualOutputs, outputKeyPath);
  const pairs = expectedOutputs.map(expectedOutput => {
    const encoded = stableStringify(getPath(expectedOutput, outputKeyPath));
    const expectedRows = expected.index.get(encoded) || [];
    const actualRows = actual.index.get(encoded) || [];
    if (expectedRows.length !== 1 || actualRows.length !== 1) return undefined;
    return actualRows[0].record;
  });
  const expectedKeys = new Set(expected.index.keys());
  const extras = actualOutputs
    .map((record, rowIndex) => ({ record, rowIndex, encoded: stableStringify(getPath(record, outputKeyPath)) }))
    .filter(item => !expectedKeys.has(item.encoded));
  return {
    pairs,
    extras,
    expectedDuplicates: expected.duplicates,
    actualDuplicates: actual.duplicates,
  };
}

export function checkContract({
  contract,
  input,
  output,
  options = {},
} = {}) {
  const prepared = prepareRuntime("check", contract, input, options);
  if (prepared.rejected) return prepared.rejected;
  const {
    inputs,
    identities,
    keys,
    trace,
  } = prepared;
  const privacySafe = !!options.privacySafe;
  let actualOutputs;
  try {
    actualOutputs = parseActualOutput(contract, output, prepared);
  } catch (error) {
    const blockedRecords = identities.map((identity, index) => {
      const diagnostics = [runtimeDiagnostic(contract, {
        code: "output-parse-error",
        severity: "blocking",
        scope: "record",
        rowIndex: index,
        rowId: identity.rowId,
        path: "$",
        message: error.message,
        evidence: { format: contract.formats.output },
        privacyEvidence: { format: contract.formats.output },
      }, privacySafe)];
      return recordEnvelope(identity, {
        input: inputs[index],
        expectedOutput: null,
        actualOutput: null,
      }, diagnostics, "blocked", privacySafe);
    });
    return {
      ...baseReport("check", contract, "block", [{
        code: "output-parse-error",
        path: "$",
        message: error.message,
      }], [
        ...trace,
        {
          type: "output.parse_failed",
          format: contract.formats.output,
        },
      ]),
      totals: {
        ...emptyTotals(),
        input: inputs.length,
        blocked: inputs.length,
      },
      records: blockedRecords,
      blocked: blockedRecords,
    };
  }

  const expectedOutputs = [];
  const executionErrors = new Map();
  for (let index = 0; index < inputs.length; index += 1) {
    try {
      expectedOutputs.push(executeJsonTransform(contract.program, inputs[index]));
    } catch (error) {
      expectedOutputs.push(undefined);
      executionErrors.set(index, error);
    }
  }

  const batchIssues = [];
  let alignedActual;
  if (prepared.isBatch && keys.outputKeyPath) {
    const usableExpected = expectedOutputs.filter(value => value !== undefined);
    const pairing = keyedActualPairing(usableExpected, actualOutputs, keys.outputKeyPath);
    let usableIndex = 0;
    alignedActual = expectedOutputs.map(expected => (
      expected === undefined ? undefined : pairing.pairs[usableIndex++]
    ));
    for (const duplicate of pairing.expectedDuplicates) {
      batchIssues.push({
        code: "duplicate-expected-output-key",
        severity: "blocking",
        path: keys.outputKeyPath,
        message: `The approved program produced a duplicate key at ${keys.outputKeyPath}.`,
        evidence: { key: duplicate.key, rowIndices: duplicate.rowIndices },
        privacyEvidence: { rowIndices: duplicate.rowIndices },
      });
    }
    for (const duplicate of pairing.actualDuplicates) {
      batchIssues.push({
        code: "duplicate-output-key",
        severity: "blocking",
        path: keys.outputKeyPath,
        message: `Actual output contains a duplicate key at ${keys.outputKeyPath}.`,
        evidence: { key: duplicate.key, rowIndices: duplicate.rowIndices },
        privacyEvidence: { rowIndices: duplicate.rowIndices },
      });
    }
    for (const extra of pairing.extras) {
      batchIssues.push({
        code: "extra-output-row",
        severity: "blocking",
        path: "$",
        message: `Actual output row ${extra.rowIndex} has no matching expected key.`,
        evidence: {
          actualIndex: extra.rowIndex,
          key: cloneJson(getPath(extra.record, keys.outputKeyPath)),
        },
        privacyEvidence: { actualIndex: extra.rowIndex },
      });
    }
  } else {
    alignedActual = inputs.map((_, index) => actualOutputs[index]);
    for (let index = inputs.length; index < actualOutputs.length; index += 1) {
      batchIssues.push({
        code: "extra-output-row",
        severity: "blocking",
        path: `$[${index}]`,
        message: `Actual output row ${index} has no corresponding input record.`,
        evidence: { actualIndex: index },
      });
    }
  }

  const records = [];
  emitRecordProgress(options, "check", 0, inputs.length);
  for (let index = 0; index < inputs.length; index += 1) {
    assertNotAborted(options);
    const inputRecord = inputs[index];
    const expected = expectedOutputs[index];
    const actual = alignedActual[index];
    const identity = identities[index];
    let issues = rawInputIssues(contract, inputRecord);
    if (executionErrors.has(index)) {
      issues.push({
        code: "program-execution-error",
        severity: "blocking",
        path: "$",
        message: executionErrors.get(index).message,
        evidence: { operationCount: contract.program.ops.length },
      });
    } else if (actual === undefined) {
      issues.push({
        code: "dropped-output-row",
        severity: "blocking",
        path: "$",
        message: `No actual output record matched input row ${index}.`,
        evidence: {
          sourceIndex: index,
          key: cloneJson(identity.key),
        },
        privacyEvidence: { sourceIndex: index },
      });
      batchIssues.push({
        code: "dropped-output-row",
        severity: "blocking",
        path: "$",
        message: `Actual output is missing the record for input row ${index}.`,
        evidence: {
          sourceIndex: index,
          key: cloneJson(identity.key),
        },
        privacyEvidence: { sourceIndex: index },
      });
    } else {
      issues = [
        ...issues,
        ...rawOutputIssues(contract, actual),
        ...outputDifferenceIssues(expected, actual),
      ];
    }
    const diagnostics = materializeIssues(contract, issues, index, identity.rowId, "record", privacySafe);
    const invariantResults = actual === undefined
      ? []
      : perRecordInvariantResults(contract, inputRecord, actual);
    diagnostics.push(...invariantDiagnostics(
      contract,
      invariantResults,
      index,
      identity.rowId,
      privacySafe,
    ));
    const status = rowStatus(contract, diagnostics);
    records.push(recordEnvelope(identity, {
      input: inputRecord,
      expectedOutput: expected,
      actualOutput: actual,
    }, diagnostics, status, privacySafe));
    emitRecordProgress(options, "check", index + 1, inputs.length);
  }

  const failedRecords = records
    .filter(record => ["quarantined", "blocked"].includes(record.status))
    .map(record => ({ rowId: record.rowId, sourceIndex: record.sourceIndex }));
  const invariantResults = aggregateInvariantResults(
    contract,
    inputs,
    alignedActual,
    actualOutputs,
    failedRecords,
  );
  const batchDiagnostics = [
    ...materializeIssues(contract, batchIssues, null, null, "batch", privacySafe),
    ...duplicateKeyIssues(contract, inputs, keys.inputKeyPath, "input", privacySafe),
    ...batchInvariantDiagnostics(contract, invariantResults, privacySafe),
  ];
  const reportedInvariantResults = reportInvariantResults(invariantResults, privacySafe);
  emitProgress(options, "invariants", contract.invariants.length, contract.invariants.length);
  return finalizeReport({
    mode: "check",
    contract,
    records,
    invariantResults: reportedInvariantResults,
    batchDiagnostics,
    trace: [
      ...trace,
      {
        type: "output.parsed",
        format: contract.formats.output,
        recordCount: actualOutputs.length,
      },
      {
        type: "program.expected_outputs_computed",
        inputCount: inputs.length,
      },
      {
        type: "invariants.evaluated",
        invariantCount: invariantResults.length,
      },
    ],
  });
}
