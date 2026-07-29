import { entries, getPath, typeOf } from "../json-transform/core.js";
import { deepEqual, stableStringify } from "../json-transform/shared.js";
import {
  fingerprintTransformationInvariant,
  withTransformationContractIdentity,
} from "./identity.js";
import { validateTransformationContract } from "./schema.js";

const DEFAULT_UNRESOLVED_MARKERS = Object.freeze([
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

function distinctJson(values) {
  const seen = new Set();
  return values.filter(value => {
    const key = stableStringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function schemaTypes(schema = {}) {
  if (typeof schema.type === "string") return [schema.type];
  if (Array.isArray(schema.type)) return schema.type;
  if (Array.isArray(schema.anyOf)) {
    return [...new Set(schema.anyOf.flatMap(schemaTypes))].sort(compareText);
  }
  return [];
}

function schemaPaths(schema = {}, basePath = "$", required = true) {
  const rows = [];
  const types = schemaTypes(schema);
  if (types.length) rows.push({ path: basePath, types, required });

  if (schema.type === "object" && schema.properties) {
    const requiredKeys = new Set(schema.required || []);
    for (const key of Object.keys(schema.properties).sort(compareText)) {
      rows.push(...schemaPaths(
        schema.properties[key],
        `${basePath}.${key}`,
        required && requiredKeys.has(key),
      ));
    }
  }
  return rows;
}

function invariantId(contract, seed) {
  return `inv_${fingerprintTransformationInvariant(contract, seed).hex.slice(0, 12)}`;
}

function suggestion(contract, definition, reason, source) {
  const seed = {
    kind: definition.kind,
    scope: definition.scope,
    severity: definition.severity,
    parameters: definition.parameters,
  };
  return {
    id: invariantId(contract, seed),
    ...cloneJson(definition),
    reason,
    source,
  };
}

function outputSchemaSuggestions(contract) {
  const rows = schemaPaths(contract.output?.schema)
    .filter(row => row.path !== "$");
  return rows.flatMap(row => {
    const suggestions = [];
    if (row.required) {
      suggestions.push(suggestion(contract, {
        kind: "output_path_present",
        scope: "record",
        severity: "blocking",
        parameters: { path: row.path },
      }, `${row.path} was present in every observed output.`, "output-schema"));
    }
    if (row.types.length) {
      suggestions.push(suggestion(contract, {
        kind: "path_type",
        scope: "record",
        severity: "blocking",
        parameters: {
          subject: "output",
          path: row.path,
          expectedTypes: row.types,
        },
      }, `${row.path} had a stable observed output type.`, "output-schema"));
    }
    return suggestions;
  });
}

function inputPreconditionSuggestions(contract) {
  return (contract.input?.preconditions || []).flatMap(precondition => {
    if (typeof precondition?.field !== "string") return [];
    const suggestions = [];
    if (precondition.required) {
      suggestions.push(suggestion(contract, {
        kind: "required_path",
        scope: "record",
        severity: "blocking",
        parameters: {
          subject: "input",
          path: precondition.field,
        },
      }, `${precondition.field} is required by the learned program.`, "program-precondition"));
    }
    if (typeof precondition.type === "string") {
      suggestions.push(suggestion(contract, {
        kind: "path_type",
        scope: "record",
        severity: "blocking",
        parameters: {
          subject: "input",
          path: precondition.field,
          expectedTypes: [precondition.type],
        },
      }, `${precondition.field} had a stable type in the learning evidence.`, "program-precondition"));
    }
    return suggestions;
  });
}

function operationSuggestions(contract) {
  return (contract.program?.ops || []).flatMap(operation => {
    if (operation.op === "set" && operation.source && operation.target) {
      return [suggestion(contract, {
        kind: "output_equals_source",
        scope: "record",
        severity: "blocking",
        parameters: {
          sourcePath: operation.source,
          targetPath: operation.target,
        },
      }, `${operation.target} is a direct copy of ${operation.source}.`, "learned-program")];
    }
    if (operation.op === "valueMap" && operation.target && operation.map) {
      return [suggestion(contract, {
        kind: "allowed_values",
        scope: "record",
        severity: "blocking",
        parameters: {
          subject: "output",
          path: operation.target,
          values: distinctJson(Object.values(operation.map).map(cloneJson)),
        },
      }, `${operation.target} is produced by a finite learned value map.`, "learned-program")];
    }
    return [];
  });
}

export function suggestTransformationInvariants(contract) {
  const validation = validateTransformationContract(contract);
  if (!validation.ok) {
    throw new Error(`Cannot suggest invariants for an invalid contract: ${validation.errors[0]?.message || "validation failed"}`);
  }

  const suggestions = [
    ...inputPreconditionSuggestions(contract),
    ...outputSchemaSuggestions(contract),
    ...operationSuggestions(contract),
  ];

  if (contract.output?.unresolvedValuePolicy !== "allow") {
    suggestions.push(suggestion(contract, {
      kind: "no_unresolved_values",
      scope: "record",
      severity: contract.output.unresolvedValuePolicy === "block" ? "blocking" : "advisory",
      parameters: {},
    }, "The output policy does not allow unresolved placeholder values.", "output-policy"));
  }
  if (contract.output?.unknownFieldPolicy !== "allow") {
    suggestions.push(suggestion(contract, {
      kind: "no_unknown_output_fields",
      scope: "record",
      severity: contract.output.unknownFieldPolicy === "block" ? "blocking" : "advisory",
      parameters: {},
    }, "The output policy does not allow fields outside the learned output schema.", "output-policy"));
  }
  suggestions.push(suggestion(contract, {
    kind: "row_count_preserved",
    scope: "batch",
    severity: "blocking",
    parameters: {},
  }, "The learned program transforms records independently and does not define row filtering.", "program-shape"));

  const byDefinition = new Map();
  for (const item of suggestions) {
    const key = stableStringify({
      kind: item.kind,
      scope: item.scope,
      severity: item.severity,
      parameters: item.parameters,
    });
    if (!byDefinition.has(key)) byDefinition.set(key, item);
  }
  return [...byDefinition.values()].sort((left, right) => (
    compareText(left.kind, right.kind)
    || compareText(stableStringify(left.parameters), stableStringify(right.parameters))
    || compareText(left.id, right.id)
  ));
}

export function withTransformationInvariantSuggestions(contract) {
  const suggestions = suggestTransformationInvariants(contract);
  return {
    ...cloneJson(contract),
    extensions: {
      ...(cloneJson(contract.extensions) || {}),
      latentmachine: {
        ...(cloneJson(contract.extensions?.latentmachine) || {}),
        invariantSuggestions: suggestions,
      },
    },
  };
}

function coreInvariant(value) {
  return {
    id: value.id,
    kind: value.kind,
    scope: value.scope,
    severity: value.severity,
    parameters: cloneJson(value.parameters),
  };
}

export function acceptTransformationInvariants(contract, selections = []) {
  const validation = validateTransformationContract(contract);
  if (!validation.ok) {
    throw new Error(`Cannot accept invariants on an invalid contract: ${validation.errors[0]?.message || "validation failed"}`);
  }
  if (!Array.isArray(selections) || !selections.length) {
    throw new Error("acceptTransformationInvariants requires at least one suggestion ID or invariant definition.");
  }

  const suggested = contract.extensions?.latentmachine?.invariantSuggestions
    || suggestTransformationInvariants(contract);
  const byId = new Map(suggested.map(item => [item.id, item]));
  const selected = selections.map((selection, index) => {
    if (typeof selection === "string") {
      const found = byId.get(selection);
      if (!found) throw new Error(`Invariant suggestion ${selection} does not exist.`);
      return coreInvariant(found);
    }
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      throw new Error(`Invariant selection ${index + 1} must be a suggestion ID or invariant definition.`);
    }
    const definition = cloneJson(selection);
    const unknownFields = Object.keys(definition)
      .filter(field => !["id", "kind", "scope", "severity", "parameters"].includes(field));
    if (unknownFields.length) {
      throw new Error(`Invariant selection ${index + 1} contains unknown field ${unknownFields[0]}.`);
    }
    if (!definition.id) {
      definition.id = invariantId(contract, {
        kind: definition.kind,
        scope: definition.scope,
        severity: definition.severity,
        parameters: definition.parameters,
      });
    }
    return coreInvariant(definition);
  });

  const merged = new Map((contract.invariants || []).map(item => [item.id, cloneJson(item)]));
  for (const item of selected) merged.set(item.id, item);
  const openBlocking = (contract.challenges || []).some(item => item.status === "open" && item.severity === "blocking");
  const approvalState = contract.inference?.status === "safe" && !openBlocking
    ? "unreviewed"
    : "review_required";
  const revised = {
    ...cloneJson(contract),
    identity: null,
    lifecycle: {
      approvalState,
      revision: contract.lifecycle.revision + 1,
      supersedes: contract.identity.contractId,
    },
    invariants: [...merged.values()].sort((left, right) => compareText(left.id, right.id)),
    approval: null,
    extensions: {
      ...(cloneJson(contract.extensions) || {}),
      latentmachine: {
        ...(cloneJson(contract.extensions?.latentmachine) || {}),
        invariantAcceptance: {
          acceptedInvariantIds: selected.map(item => item.id).sort(compareText),
          sourceContractId: contract.identity.contractId,
        },
      },
    },
  };
  const identified = withTransformationContractIdentity(revised);
  const revisedValidation = validateTransformationContract(identified);
  if (!revisedValidation.ok) {
    const details = revisedValidation.errors.slice(0, 3).map(error => `${error.path} [${error.code}] ${error.message}`).join("; ");
    throw new Error(`Accepted invariants produced an invalid contract: ${details}`);
  }
  return identified;
}

function subjectRecords(context, subject) {
  const explicit = context?.[`${subject}Records`];
  if (Array.isArray(explicit)) return explicit;
  if (context && Object.prototype.hasOwnProperty.call(context, subject)) return [context[subject]];
  return null;
}

function jsonType(value) {
  return typeOf(value) === "number" && Number.isInteger(value) ? "integer" : typeOf(value);
}

function typeMatches(value, expectedTypes) {
  const actual = jsonType(value);
  return expectedTypes.includes(actual) || (actual === "integer" && expectedTypes.includes("number"));
}

function schemaLeafPaths(schema = {}, basePath = "$") {
  if (schema.type === "object" && schema.properties) {
    return Object.keys(schema.properties).sort(compareText)
      .flatMap(key => schemaLeafPaths(schema.properties[key], `${basePath}.${key}`));
  }
  return basePath === "$" ? [] : [basePath];
}

function unresolvedPaths(value, markers) {
  return entries(value, [], { includeContainers: false })
    .filter(entry => typeof entry.value === "string" && markers.some(marker => entry.value.startsWith(marker)))
    .map(entry => entry.path);
}

function unknownOutputPaths(value, allowedPaths) {
  const allowed = new Set(allowedPaths);
  return entries(value, [], { includeContainers: false })
    .map(entry => entry.path)
    .filter(path => path !== "$" && !allowed.has(path));
}

function recordInvariantViolates(invariant, input, output, contract) {
  const parameters = invariant.parameters;
  const subject = parameters.subject === "input" ? input : output;
  if (invariant.kind === "required_path") return getPath(subject, parameters.path) === undefined;
  if (invariant.kind === "path_type") {
    const value = getPath(subject, parameters.path);
    return value === undefined || !typeMatches(value, parameters.expectedTypes);
  }
  if (invariant.kind === "output_path_present") return getPath(output, parameters.path) === undefined;
  if (invariant.kind === "output_path_absent") return getPath(output, parameters.path) !== undefined;
  if (invariant.kind === "no_unresolved_values") {
    return unresolvedPaths(output, parameters.markers || DEFAULT_UNRESOLVED_MARKERS).length > 0;
  }
  if (invariant.kind === "no_unknown_output_fields") {
    const allowedPaths = parameters.allowedPaths || schemaLeafPaths(contract.output?.schema);
    return unknownOutputPaths(output, allowedPaths).length > 0;
  }
  if (["source_path_preserved", "output_equals_source"].includes(invariant.kind)) {
    return !deepEqual(getPath(input, parameters.sourcePath), getPath(output, parameters.targetPath));
  }
  if (invariant.kind === "allowed_values") {
    const value = getPath(subject, parameters.path);
    return !parameters.values.some(allowed => deepEqual(value, allowed));
  }
  if (invariant.kind === "string_pattern") {
    const value = getPath(subject, parameters.path);
    return typeof value !== "string"
      || value.length > 100000
      || !new RegExp(parameters.pattern, parameters.flags || "").test(value);
  }
  return false;
}

function requiredRecordSubjects(invariant) {
  if (["source_path_preserved", "output_equals_source"].includes(invariant.kind)) return ["input", "output"];
  if (["required_path", "path_type", "allowed_values", "string_pattern"].includes(invariant.kind)) {
    return [invariant.parameters.subject];
  }
  return ["output"];
}

function batchInvariantViolation(invariant, context) {
  const inputRecords = subjectRecords(context, "input");
  const outputRecords = subjectRecords(context, "output");
  const failedRecords = Array.isArray(context?.failedRecords) ? context.failedRecords : [];
  if (invariant.kind === "row_count_preserved") {
    if (!inputRecords || !outputRecords) return null;
    return inputRecords.length !== outputRecords.length;
  }
  if (invariant.kind === "key_set_preserved") {
    if (!inputRecords || !outputRecords) return null;
    const inputKeys = inputRecords.map(row => stableStringify(getPath(row, invariant.parameters.inputKeyPath))).sort(compareText);
    const outputKeys = outputRecords.map(row => stableStringify(getPath(row, invariant.parameters.outputKeyPath))).sort(compareText);
    return !deepEqual(inputKeys, outputKeys);
  }
  if (invariant.kind === "key_unique" || invariant.kind === "no_duplicate_output_keys") {
    const subject = invariant.kind === "no_duplicate_output_keys" ? "output" : invariant.parameters.subject;
    const records = subject === "input" ? inputRecords : outputRecords;
    if (!records) return null;
    const path = invariant.parameters.keyPath;
    const keys = records.map(row => stableStringify(getPath(row, path)));
    return new Set(keys).size !== keys.length;
  }
  if (invariant.kind === "maximum_failed_records") {
    return failedRecords.length > invariant.parameters.maximum;
  }
  if (invariant.kind === "maximum_failed_percent") {
    if (!inputRecords) return null;
    const percent = inputRecords.length ? failedRecords.length / inputRecords.length : 0;
    return percent > invariant.parameters.maximum;
  }
  return false;
}

function invariantEvidence(invariant, context, affectedRows, contract) {
  if (invariant.scope === "batch") {
    return {
      inputRowCount: subjectRecords(context, "input")?.length ?? null,
      outputRowCount: subjectRecords(context, "output")?.length ?? null,
      failedRowCount: Array.isArray(context?.failedRecords) ? context.failedRecords.length : 0,
    };
  }
  if (invariant.kind === "no_unresolved_values") {
    return {
      paths: affectedRows.flatMap(index => unresolvedPaths(
        subjectRecords(context, "output")?.[index],
        invariant.parameters.markers || DEFAULT_UNRESOLVED_MARKERS,
      )),
    };
  }
  if (invariant.kind === "no_unknown_output_fields") {
    const allowed = invariant.parameters.allowedPaths || schemaLeafPaths(contract.output?.schema);
    return {
      paths: affectedRows.flatMap(index => unknownOutputPaths(subjectRecords(context, "output")?.[index], allowed)),
    };
  }
  return { parameters: cloneJson(invariant.parameters) };
}

function resultMessage(invariant, status, affectedRows) {
  if (status === "not_evaluated") return `${invariant.kind} could not be evaluated because the required runtime data was not supplied.`;
  if (status === "pass") return `${invariant.kind} passed.`;
  return `${invariant.kind} ${status === "warn" ? "raised a warning" : "failed"} for ${affectedRows.length} record${affectedRows.length === 1 ? "" : "s"}.`;
}

function strongestVerdict(verdicts) {
  return verdicts.reduce((strongest, current) => (
    VERDICT_RANK[current] > VERDICT_RANK[strongest] ? current : strongest
  ), "pass");
}

function invalidInvariantResult(contract, errors) {
  return {
    version: "transformation-invariant-result/1",
    contractFingerprint: contract?.identity?.coreFingerprint || null,
    verdict: "invalid_contract",
    results: [],
    validationErrors: cloneJson(errors),
  };
}

function evaluateValidatedTransformationInvariants(contract, context = {}) {
  const results = contract.invariants.map(invariant => {
    let affectedRows = [];
    let notEvaluated = false;
    if (invariant.scope === "record") {
      const inputs = subjectRecords(context, "input");
      const outputs = subjectRecords(context, "output");
      const requiredSubjects = requiredRecordSubjects(invariant);
      const requiredCollections = requiredSubjects.map(subject => subject === "input" ? inputs : outputs);
      const count = Math.max(...requiredCollections.map(records => records?.length || 0));
      if (!count || requiredCollections.some(records => !records)) {
        notEvaluated = true;
      } else {
        for (let index = 0; index < count; index += 1) {
          if (recordInvariantViolates(invariant, inputs[index], outputs[index], contract)) affectedRows.push(index);
        }
      }
    } else {
      const violation = batchInvariantViolation(invariant, context);
      if (violation === null) notEvaluated = true;
      else if (violation) affectedRows = [0];
    }

    const status = notEvaluated
      ? "not_evaluated"
      : affectedRows.length
        ? invariant.severity === "blocking" ? "fail" : "warn"
        : "pass";
    return {
      invariantId: invariant.id,
      status,
      blocking: invariant.severity === "blocking",
      affectedRows,
      evidence: invariantEvidence(invariant, context, affectedRows, contract),
      message: resultMessage(invariant, status, affectedRows),
    };
  });

  const verdicts = results.map((result, index) => {
    if (result.status === "pass" || result.status === "not_evaluated") return "pass";
    const invariant = contract.invariants[index];
    if (result.status === "warn") return "warn";
    return invariant.scope === "batch"
      ? contract.runtimePolicy.onBatchViolation
      : contract.runtimePolicy.onRecordViolation;
  });
  const advisoryWarnings = results.filter(result => result.status === "warn").length;
  const verdict = strongestVerdict([
    ...verdicts.filter(item => item !== "warn"),
    advisoryWarnings > contract.runtimePolicy.warningThreshold ? "warn" : "pass",
  ]);

  return {
    version: "transformation-invariant-result/1",
    contractFingerprint: contract.identity.coreFingerprint,
    verdict,
    results,
  };
}

export function evaluateTransformationInvariants(contract, context = {}) {
  const validation = validateTransformationContract(contract);
  if (!validation.ok) {
    return invalidInvariantResult(contract, validation.errors);
  }
  return evaluateValidatedTransformationInvariants(contract, context);
}

export function evaluatePrevalidatedTransformationInvariants(contract, context = {}) {
  return evaluateValidatedTransformationInvariants(contract, context);
}

export const withTransformationInvariants = acceptTransformationInvariants;
