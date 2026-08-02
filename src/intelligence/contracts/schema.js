import { parsePath } from "../json-transform/core.js";
import { deriveTransformationContractIdentity } from "./identity.js";

export const TRANSFORMATION_CONTRACT_KIND = "latentmachine.transformation-contract";
export const TRANSFORMATION_CONTRACT_VERSION = "1.0";
export const TRANSFORMATION_CONTRACT_SUPPORTED_MAJOR = 1;
export const TRANSFORMATION_CONTRACT_SUPPORTED_MINOR = 0;

export const TRANSFORMATION_INFERENCE_STATUSES = Object.freeze([
  "safe",
  "unverified",
  "ambiguous",
  "contradictory",
  "unsafe",
  "insufficient",
]);

export const TRANSFORMATION_APPROVAL_STATES = Object.freeze([
  "unreviewed",
  "review_required",
  "approved",
  "superseded",
  "revoked",
]);

export const TRANSFORMATION_APPROVAL_METHODS = Object.freeze([
  "local-human-review",
  "automated-policy",
  "imported-review",
]);

export const TRANSFORMATION_RUNTIME_VERDICTS = Object.freeze([
  "pass",
  "warn",
  "quarantine",
  "block",
  "invalid_contract",
]);

export const TRANSFORMATION_CHALLENGE_STATUSES = Object.freeze([
  "open",
  "answered",
  "deferred",
  "not_applicable",
]);

export const TRANSFORMATION_CHALLENGE_KINDS = Object.freeze([
  "candidate_disambiguation",
  "missing_source_behavior",
  "null_behavior",
  "empty_string_behavior",
  "unseen_value_behavior",
  "ambiguous_date_behavior",
  "conditional_else_behavior",
  "array_empty_behavior",
  "unknown_output_field_policy",
  "row_preservation_policy",
  "approval_acknowledgement",
]);

export const TRANSFORMATION_CHALLENGE_ANSWER_MODES = Object.freeze([
  "expected_output",
  "choice",
  "policy",
]);

export const TRANSFORMATION_INVARIANT_KINDS = Object.freeze([
  "required_path",
  "path_type",
  "output_path_present",
  "output_path_absent",
  "no_unresolved_values",
  "no_unknown_output_fields",
  "source_path_preserved",
  "output_equals_source",
  "allowed_values",
  "string_pattern",
  "row_count_preserved",
  "key_set_preserved",
  "key_unique",
  "no_duplicate_output_keys",
  "maximum_failed_records",
  "maximum_failed_percent",
]);

export const TRANSFORMATION_INVARIANT_SCOPES = Object.freeze([
  "record",
  "batch",
]);

const RECORD_INVARIANT_KINDS = new Set(TRANSFORMATION_INVARIANT_KINDS.slice(0, 10));
const BATCH_INVARIANT_KINDS = new Set(TRANSFORMATION_INVARIANT_KINDS.slice(10));

export const TRANSFORMATION_FORMATS = Object.freeze([
  "json",
  "csv",
  "yaml",
  "toml",
  "xml",
  "env",
  "sql",
  "value",
]);

const REQUIRED_TOP_LEVEL_FIELDS = Object.freeze([
  "kind",
  "contractVersion",
  "engine",
  "identity",
  "lifecycle",
  "title",
  "description",
  "formats",
  "evidence",
  "inference",
  "input",
  "output",
  "program",
  "invariants",
  "challenges",
  "runtimePolicy",
  "evidenceLinks",
  "approval",
  "extensions",
]);

const ALLOWED_TOP_LEVEL_FIELDS = new Set([...REQUIRED_TOP_LEVEL_FIELDS, "metadata"]);

export const TRANSFORMATION_CONTRACT_V1_SCHEMA = Object.freeze({
  type: "object",
  required: REQUIRED_TOP_LEVEL_FIELDS,
  properties: {
    kind: { const: TRANSFORMATION_CONTRACT_KIND },
    contractVersion: { type: "string", pattern: "^1\\.[0-9]+$" },
    engine: {
      type: "object",
      required: ["name", "transformVersion", "artifactVersion"],
    },
    identity: {
      type: "object",
      required: ["contractId", "coreFingerprint", "programFingerprint", "evidenceFingerprint"],
    },
    lifecycle: {
      type: "object",
      required: ["approvalState", "revision", "supersedes"],
    },
    title: { type: "string" },
    description: { type: "string" },
    formats: {
      type: "object",
      required: ["input", "output"],
    },
    evidence: {
      type: "object",
      required: ["examples", "count", "coverage", "contradictions", "source"],
    },
    inference: {
      type: "object",
      required: ["status", "confidence", "candidatesConsidered", "ambiguities", "reasons"],
    },
    input: {
      type: "object",
      required: ["schema", "preconditions", "unknownFieldPolicy"],
    },
    output: {
      type: "object",
      required: ["schema", "unknownFieldPolicy", "unresolvedValuePolicy"],
    },
    program: {
      type: "object",
      required: ["version", "ops"],
    },
    invariants: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "kind", "scope", "severity", "parameters"],
      },
    },
    challenges: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "kind", "severity", "status", "prompt", "reason", "affectedOperations", "affectedPaths", "answerMode", "choices", "answer"],
      },
    },
    runtimePolicy: {
      type: "object",
      required: ["requireApproval", "onRecordViolation", "onBatchViolation", "warningThreshold"],
    },
    evidenceLinks: { type: "array" },
    approval: { type: ["object", "null"] },
    extensions: { type: "object" },
    metadata: { type: "object", optional: true },
  },
});

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)$/.exec(value || "");
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function isFingerprint(value) {
  return typeof value === "string" && /^[0-9a-f]{16}$/.test(value);
}

const JSON_VALUE_TYPES = new Set([
  "null",
  "boolean",
  "integer",
  "number",
  "string",
  "array",
  "object",
]);

function isContractPath(value) {
  if (
    typeof value !== "string"
    || !/^\$(?:\.[A-Za-z_$][\w$]*|\[(?:\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\])*$/.test(value)
  ) return false;
  try {
    parsePath(value);
    return true;
  } catch {
    return false;
  }
}

function validateInvariantParameters(invariant, path, addError) {
  if (!isPlainObject(invariant.parameters)) return;

  const parameters = invariant.parameters;
  const allowed = {
    required_path: ["subject", "path"],
    path_type: ["subject", "path", "expectedTypes"],
    output_path_present: ["path"],
    output_path_absent: ["path"],
    no_unresolved_values: ["markers"],
    no_unknown_output_fields: ["allowedPaths"],
    source_path_preserved: ["sourcePath", "targetPath"],
    output_equals_source: ["sourcePath", "targetPath"],
    allowed_values: ["subject", "path", "values"],
    string_pattern: ["subject", "path", "pattern", "flags"],
    row_count_preserved: [],
    key_set_preserved: ["inputKeyPath", "outputKeyPath"],
    key_unique: ["subject", "keyPath"],
    no_duplicate_output_keys: ["keyPath"],
    maximum_failed_records: ["maximum"],
    maximum_failed_percent: ["maximum"],
  }[invariant.kind];

  if (!allowed) return;
  for (const key of Object.keys(parameters)) {
    if (!allowed.includes(key)) {
      addError(`${path}.parameters.${key}`, "unknown-invariant-parameter", `${invariant.kind} does not support parameter ${key}.`);
    }
  }

  const requireSubject = () => {
    if (!["input", "output"].includes(parameters.subject)) {
      addError(`${path}.parameters.subject`, "invalid-invariant-subject", "subject must be input or output.");
    }
  };
  const requirePath = (field = "path") => {
    if (!isContractPath(parameters[field])) {
      addError(`${path}.parameters.${field}`, "invalid-invariant-path", `${field} must be a deterministic $-rooted data path.`);
    }
  };

  if (["required_path", "path_type", "allowed_values", "string_pattern"].includes(invariant.kind)) {
    requireSubject();
    requirePath();
  }
  if (["output_path_present", "output_path_absent"].includes(invariant.kind)) requirePath();
  if (["source_path_preserved", "output_equals_source"].includes(invariant.kind)) {
    requirePath("sourcePath");
    requirePath("targetPath");
  }
  if (invariant.kind === "path_type") {
    if (
      !Array.isArray(parameters.expectedTypes)
      || !parameters.expectedTypes.length
      || parameters.expectedTypes.some(type => !JSON_VALUE_TYPES.has(type))
      || new Set(parameters.expectedTypes).size !== parameters.expectedTypes.length
    ) {
      addError(`${path}.parameters.expectedTypes`, "invalid-invariant-types", "expectedTypes must be a non-empty, unique list of supported JSON value types.");
    }
  }
  if (invariant.kind === "allowed_values" && (!Array.isArray(parameters.values) || !parameters.values.length)) {
    addError(`${path}.parameters.values`, "invalid-allowed-values", "allowed_values requires at least one JSON value.");
  }
  if (invariant.kind === "no_unresolved_values" && (
    parameters.markers !== undefined
    && (
      !Array.isArray(parameters.markers)
      || !parameters.markers.length
      || parameters.markers.some(marker => typeof marker !== "string" || !marker)
    )
  )) {
    addError(`${path}.parameters.markers`, "invalid-unresolved-markers", "markers must be a non-empty array of strings when provided.");
  }
  if (invariant.kind === "no_unknown_output_fields" && (
    parameters.allowedPaths !== undefined
    && (
      !Array.isArray(parameters.allowedPaths)
      || parameters.allowedPaths.some(item => !isContractPath(item))
    )
  )) {
    addError(`${path}.parameters.allowedPaths`, "invalid-allowed-paths", "allowedPaths must contain only deterministic $-rooted data paths.");
  }
  if (invariant.kind === "string_pattern") {
    if (
      typeof parameters.pattern !== "string"
      || !parameters.pattern
      || parameters.pattern.length > 128
      || /\(\?/.test(parameters.pattern)
      || /[()|]/.test(parameters.pattern)
      || /\\[1-9]/.test(parameters.pattern)
      || /\([^)]*[+*][^)]*\)[+*{]/.test(parameters.pattern)
      || /\{\d{4,}(?:,\d*)?\}/.test(parameters.pattern)
    ) {
      addError(`${path}.parameters.pattern`, "unsafe-invariant-pattern", "pattern must be a non-empty, bounded regular expression without groups, alternation, lookarounds, backreferences, or nested quantifiers.");
    } else {
      try {
        new RegExp(parameters.pattern, parameters.flags || "");
      } catch {
        addError(`${path}.parameters.pattern`, "invalid-invariant-pattern", "pattern must compile as a regular expression.");
      }
    }
    if (parameters.flags !== undefined && (typeof parameters.flags !== "string" || !/^(?:[imu]{0,3})$/.test(parameters.flags) || new Set(parameters.flags).size !== parameters.flags.length)) {
      addError(`${path}.parameters.flags`, "invalid-invariant-pattern-flags", "flags may contain each of i, m, or u at most once.");
    }
  }
  if (invariant.kind === "key_set_preserved") {
    requirePath("inputKeyPath");
    requirePath("outputKeyPath");
  }
  if (invariant.kind === "key_unique") {
    requireSubject();
    requirePath("keyPath");
  }
  if (invariant.kind === "no_duplicate_output_keys") requirePath("keyPath");
  if (invariant.kind === "maximum_failed_records" && (!Number.isInteger(parameters.maximum) || parameters.maximum < 0)) {
    addError(`${path}.parameters.maximum`, "invalid-failure-maximum", "maximum must be a non-negative integer.");
  }
  if (invariant.kind === "maximum_failed_percent" && (
    typeof parameters.maximum !== "number"
    || !Number.isFinite(parameters.maximum)
    || parameters.maximum < 0
    || parameters.maximum > 1
  )) {
    addError(`${path}.parameters.maximum`, "invalid-failure-percent", "maximum must be a finite number from 0 through 1.");
  }
}

function validateInvariantContradictions(invariants, addError) {
  const outputPresence = new Map();
  const outputTypes = new Map();

  invariants.forEach((invariant, index) => {
    if (!isPlainObject(invariant) || !isPlainObject(invariant.parameters)) return;
    const path = `$.invariants[${index}]`;
    let outputPath = (
      invariant.kind === "output_path_present"
      || invariant.kind === "output_path_absent"
      || (invariant.kind === "required_path" && invariant.parameters.subject === "output")
    ) ? invariant.parameters.path : null;
    if (
      ["path_type", "allowed_values", "string_pattern"].includes(invariant.kind)
      && invariant.parameters.subject === "output"
    ) outputPath = invariant.parameters.path;
    if (outputPath) {
      const state = invariant.kind === "output_path_absent" ? "absent" : "present";
      const prior = outputPresence.get(outputPath);
      if (prior && prior.state !== state) {
        addError(path, "contradictory-invariants", `${invariant.id || "Invariant"} contradicts ${prior.id || "another invariant"} for ${outputPath}.`);
      } else {
        outputPresence.set(outputPath, { state, id: invariant.id });
      }
    }

    if (
      (invariant.kind === "path_type" && Array.isArray(invariant.parameters.expectedTypes))
      || invariant.kind === "string_pattern"
    ) {
      const key = `${invariant.parameters.subject}:${invariant.parameters.path}`;
      const prior = outputTypes.get(key);
      const current = new Set(invariant.kind === "string_pattern" ? ["string"] : invariant.parameters.expectedTypes);
      const intersection = prior ? new Set([...current].filter(type => prior.types.has(type))) : current;
      if (prior && !intersection.size) {
        addError(path, "contradictory-invariants", `${invariant.id || "Invariant"} has no compatible type with ${prior.id || "another invariant"} for ${invariant.parameters.path}.`);
      } else {
        outputTypes.set(key, {
          types: intersection,
          id: prior ? `${prior.id} and ${invariant.id}` : invariant.id,
        });
      }
    }
  });
}

function validateJsonValue(value, path, errors, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      errors.push({ path, code: "non-finite-number", message: `${path} must contain a finite JSON number.` });
    }
    return;
  }
  if (typeof value !== "object") {
    errors.push({ path, code: "non-json-value", message: `${path} contains a value that cannot be represented in JSON.` });
    return;
  }
  if (ancestors.has(value)) {
    errors.push({ path, code: "circular-value", message: `${path} contains a circular reference.` });
    return;
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        errors.push({ path: `${path}[${index}]`, code: "sparse-array", message: `${path} must not contain sparse array entries.` });
      } else {
        validateJsonValue(value[index], `${path}[${index}]`, errors, ancestors);
      }
    }
  } else if (!isPlainObject(value)) {
    errors.push({ path, code: "non-plain-object", message: `${path} must contain only plain JSON objects.` });
  } else {
    for (const [key, item] of Object.entries(value)) {
      validateJsonValue(item, `${path}.${key}`, errors, ancestors);
    }
  }
  ancestors.delete(value);
}

export function validateTransformationContract(contract, options = {}) {
  const errors = [];
  const warnings = [];
  const verifyIdentity = options.verifyIdentity !== false;
  const addError = (path, code, message) => errors.push({ path, code, message });
  const addWarning = (path, code, message) => warnings.push({ path, code, message });

  if (!isPlainObject(contract)) {
    return {
      ok: false,
      errors: [{ path: "$", code: "invalid-type", message: "Transformation Contract must be a plain object." }],
      warnings,
      version: null,
    };
  }

  validateJsonValue(contract, "$", errors);

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(contract, field)) {
      addError(`$.${field}`, "required", `Transformation Contract requires ${field}.`);
    }
  }
  for (const field of Object.keys(contract)) {
    if (!ALLOWED_TOP_LEVEL_FIELDS.has(field)) {
      addError(`$.${field}`, "unknown-top-level-field", `Unknown top-level field ${field} must be removed or placed under extensions.`);
    }
  }

  if (contract.kind !== TRANSFORMATION_CONTRACT_KIND) {
    addError("$.kind", "invalid-kind", `kind must be ${TRANSFORMATION_CONTRACT_KIND}.`);
  }

  const version = parseVersion(contract.contractVersion);
  if (!version) {
    addError("$.contractVersion", "invalid-version", "contractVersion must use major.minor notation.");
  } else if (version.major !== TRANSFORMATION_CONTRACT_SUPPORTED_MAJOR) {
    addError("$.contractVersion", "unsupported-major-version", `Contract major version ${version.major} is not supported.`);
  } else if (version.minor > TRANSFORMATION_CONTRACT_SUPPORTED_MINOR) {
    addWarning("$.contractVersion", "newer-minor-version", `Contract minor version ${version.minor} is newer than the implemented ${TRANSFORMATION_CONTRACT_VERSION} schema.`);
  }

  if (!isPlainObject(contract.engine)) {
    addError("$.engine", "invalid-type", "engine must be an object.");
  } else {
    if (contract.engine.name !== "latentmachine") addError("$.engine.name", "invalid-engine", "engine.name must be latentmachine.");
    if (!Number.isInteger(contract.engine.transformVersion) || contract.engine.transformVersion < 1) {
      addError("$.engine.transformVersion", "invalid-engine-version", "engine.transformVersion must be a positive integer.");
    }
    if (!Number.isInteger(contract.engine.artifactVersion) || contract.engine.artifactVersion < 1) {
      addError("$.engine.artifactVersion", "invalid-artifact-version", "engine.artifactVersion must be a positive integer.");
    }
  }

  if (!isPlainObject(contract.identity)) {
    addError("$.identity", "invalid-type", "identity must be an object.");
  } else {
    if (!/^lmct_[0-9a-f]{12}$/.test(contract.identity.contractId || "")) {
      addError("$.identity.contractId", "invalid-contract-id", "identity.contractId must be an lmct_ ID derived from the core fingerprint.");
    }
    for (const field of ["coreFingerprint", "programFingerprint", "evidenceFingerprint"]) {
      if (!isFingerprint(contract.identity[field])) {
        addError(`$.identity.${field}`, "invalid-fingerprint", `${field} must be a 16-character lowercase hexadecimal fingerprint.`);
      }
    }
  }

  if (!isPlainObject(contract.lifecycle)) {
    addError("$.lifecycle", "invalid-type", "lifecycle must be an object.");
  } else {
    if (!TRANSFORMATION_APPROVAL_STATES.includes(contract.lifecycle.approvalState)) {
      addError("$.lifecycle.approvalState", "invalid-approval-state", `approvalState must be one of ${TRANSFORMATION_APPROVAL_STATES.join(", ")}.`);
    }
    if (!Number.isInteger(contract.lifecycle.revision) || contract.lifecycle.revision < 1) {
      addError("$.lifecycle.revision", "invalid-revision", "lifecycle.revision must be a positive integer.");
    }
    if (contract.lifecycle.supersedes !== null && !/^lmct_[0-9a-f]{12}$/.test(contract.lifecycle.supersedes || "")) {
      addError("$.lifecycle.supersedes", "invalid-supersedes", "lifecycle.supersedes must be an lmct_ contract ID or null.");
    }
  }

  if (typeof contract.title !== "string") addError("$.title", "invalid-type", "title must be a string.");
  if (typeof contract.description !== "string") addError("$.description", "invalid-type", "description must be a string.");

  if (!isPlainObject(contract.formats)) {
    addError("$.formats", "invalid-type", "formats must be an object.");
  } else {
    for (const direction of ["input", "output"]) {
      if (!TRANSFORMATION_FORMATS.includes(contract.formats[direction])) {
        addError(`$.formats.${direction}`, "invalid-format", `${direction} format must be one of ${TRANSFORMATION_FORMATS.join(", ")}.`);
      }
    }
    if (contract.formats.output === "sql") {
      addError("$.formats.output", "unsupported-output-format", "SQL is input-only in Transformation Contract v1.");
    }
  }

  if (!isPlainObject(contract.evidence)) {
    addError("$.evidence", "invalid-type", "evidence must be an object.");
  } else {
    if (!Array.isArray(contract.evidence.examples)) {
      addError("$.evidence.examples", "invalid-type", "evidence.examples must be an array.");
    } else {
      const exampleIds = new Set();
      contract.evidence.examples.forEach((example, index) => {
        const path = `$.evidence.examples[${index}]`;
        if (!isPlainObject(example)) {
          addError(path, "invalid-example", "Each evidence example must be an object.");
          return;
        }
        if (typeof example.id !== "string" || !example.id) addError(`${path}.id`, "invalid-example-id", "Evidence example requires a non-empty string ID.");
        else if (exampleIds.has(example.id)) addError(`${path}.id`, "duplicate-example-id", `Evidence example ID ${example.id} is duplicated.`);
        else exampleIds.add(example.id);
        if (!Object.prototype.hasOwnProperty.call(example, "input")) addError(`${path}.input`, "required", "Evidence example requires input.");
        if (!Object.prototype.hasOwnProperty.call(example, "output")) addError(`${path}.output`, "required", "Evidence example requires output.");
      });
      if (contract.evidence.count !== contract.evidence.examples.length) {
        addError("$.evidence.count", "evidence-count-mismatch", "evidence.count must equal evidence.examples.length.");
      }
    }
    if (!Number.isInteger(contract.evidence.count) || contract.evidence.count < 0) {
      addError("$.evidence.count", "invalid-evidence-count", "evidence.count must be a non-negative integer.");
    }
    if (!isPlainObject(contract.evidence.coverage)) addError("$.evidence.coverage", "invalid-type", "evidence.coverage must be an object.");
    if (!Array.isArray(contract.evidence.contradictions)) addError("$.evidence.contradictions", "invalid-type", "evidence.contradictions must be an array.");
    if (typeof contract.evidence.source !== "string" || !contract.evidence.source) addError("$.evidence.source", "invalid-source", "evidence.source must be a non-empty string.");
  }

  if (!isPlainObject(contract.inference)) {
    addError("$.inference", "invalid-type", "inference must be an object.");
  } else {
    if (!TRANSFORMATION_INFERENCE_STATUSES.includes(contract.inference.status)) {
      addError("$.inference.status", "invalid-inference-status", `inference.status must be one of ${TRANSFORMATION_INFERENCE_STATUSES.join(", ")}.`);
    }
    if (!isPlainObject(contract.inference.confidence)) addError("$.inference.confidence", "invalid-type", "inference.confidence must be an object.");
    if (!Array.isArray(contract.inference.candidatesConsidered)) addError("$.inference.candidatesConsidered", "invalid-type", "inference.candidatesConsidered must be an array.");
    if (!Array.isArray(contract.inference.ambiguities)) addError("$.inference.ambiguities", "invalid-type", "inference.ambiguities must be an array.");
    if (!Array.isArray(contract.inference.reasons)) addError("$.inference.reasons", "invalid-type", "inference.reasons must be an array.");
  }

  if (!isPlainObject(contract.input)) {
    addError("$.input", "invalid-type", "input must be an object.");
  } else {
    if (!isPlainObject(contract.input.schema)) addError("$.input.schema", "invalid-type", "input.schema must be an object.");
    if (!Array.isArray(contract.input.preconditions)) addError("$.input.preconditions", "invalid-type", "input.preconditions must be an array.");
    if (!["allow", "warn", "block"].includes(contract.input.unknownFieldPolicy)) {
      addError("$.input.unknownFieldPolicy", "invalid-policy", "input.unknownFieldPolicy must be allow, warn, or block.");
    }
  }

  if (!isPlainObject(contract.output)) {
    addError("$.output", "invalid-type", "output must be an object.");
  } else {
    if (!isPlainObject(contract.output.schema)) addError("$.output.schema", "invalid-type", "output.schema must be an object.");
    if (!["allow", "warn", "block"].includes(contract.output.unknownFieldPolicy)) {
      addError("$.output.unknownFieldPolicy", "invalid-policy", "output.unknownFieldPolicy must be allow, warn, or block.");
    }
    if (!["allow", "warn", "block"].includes(contract.output.unresolvedValuePolicy)) {
      addError("$.output.unresolvedValuePolicy", "invalid-policy", "output.unresolvedValuePolicy must be allow, warn, or block.");
    }
  }

  if (!isPlainObject(contract.program)) {
    addError("$.program", "invalid-type", "program must be an object.");
  } else {
    if (!Number.isInteger(contract.program.version) || contract.program.version < 1) {
      addError("$.program.version", "invalid-program-version", "program.version must be a positive integer.");
    } else if (Number.isInteger(contract.engine?.transformVersion) && contract.program.version !== contract.engine.transformVersion) {
      addError("$.program.version", "engine-program-version-mismatch", "program.version must match engine.transformVersion.");
    }
    if (!Array.isArray(contract.program.ops)) {
      addError("$.program.ops", "invalid-type", "program.ops must be an array.");
    } else {
      contract.program.ops.forEach((operation, index) => {
        if (!isPlainObject(operation) || typeof operation.op !== "string" || !operation.op) {
          addError(`$.program.ops[${index}]`, "invalid-operation", "Every program operation must be an object with a non-empty op.");
        }
      });
    }
  }

  if (!Array.isArray(contract.invariants)) {
    addError("$.invariants", "invalid-type", "invariants must be an array.");
  } else {
    const invariantIds = new Set();
    contract.invariants.forEach((invariant, index) => {
      const path = `$.invariants[${index}]`;
      if (!isPlainObject(invariant)) {
        addError(path, "invalid-invariant", "Every invariant must be an object.");
        return;
      }
      for (const field of Object.keys(invariant)) {
        if (!["id", "kind", "scope", "severity", "parameters"].includes(field)) {
          addError(`${path}.${field}`, "unknown-invariant-field", `Unknown invariant field ${field} is not part of the bounded invariant definition.`);
        }
      }
      if (typeof invariant.id !== "string" || !/^inv_[a-z0-9][a-z0-9_-]*$/.test(invariant.id)) {
        addError(`${path}.id`, "invalid-invariant-id", "Invariant ID must begin with inv_ and contain lowercase letters, digits, underscores, or hyphens.");
      } else if (invariantIds.has(invariant.id)) {
        addError(`${path}.id`, "duplicate-invariant-id", `Invariant ID ${invariant.id} is duplicated.`);
      } else {
        invariantIds.add(invariant.id);
      }
      if (!TRANSFORMATION_INVARIANT_KINDS.includes(invariant.kind)) {
        addError(`${path}.kind`, "invalid-invariant-kind", `Invariant kind must be one of ${TRANSFORMATION_INVARIANT_KINDS.join(", ")}.`);
      }
      if (!TRANSFORMATION_INVARIANT_SCOPES.includes(invariant.scope)) {
        addError(`${path}.scope`, "invalid-invariant-scope", "Invariant scope must be record or batch.");
      } else if (
        TRANSFORMATION_INVARIANT_KINDS.includes(invariant.kind)
        && !(
          (invariant.scope === "record" && RECORD_INVARIANT_KINDS.has(invariant.kind))
          || (invariant.scope === "batch" && BATCH_INVARIANT_KINDS.has(invariant.kind))
        )
      ) {
        addError(`${path}.scope`, "invariant-scope-mismatch", `${invariant.kind} is not a ${invariant.scope}-scope invariant.`);
      }
      if (!["blocking", "advisory"].includes(invariant.severity)) {
        addError(`${path}.severity`, "invalid-invariant-severity", "Invariant severity must be blocking or advisory.");
      }
      if (!isPlainObject(invariant.parameters)) {
        addError(`${path}.parameters`, "invalid-type", "Invariant parameters must be an object.");
      } else {
        validateInvariantParameters(invariant, path, addError);
      }
    });
    validateInvariantContradictions(contract.invariants, addError);
  }
  if (!Array.isArray(contract.challenges)) {
    addError("$.challenges", "invalid-type", "challenges must be an array.");
  } else {
    const challengeIds = new Set();
    contract.challenges.forEach((challenge, index) => {
      const path = `$.challenges[${index}]`;
      if (!isPlainObject(challenge)) {
        addError(path, "invalid-challenge", "Every challenge must be an object.");
        return;
      }
      if (typeof challenge.id !== "string" || !/^challenge_[a-z0-9][a-z0-9_-]*$/.test(challenge.id)) {
        addError(`${path}.id`, "invalid-challenge-id", "Challenge ID must begin with challenge_ and contain lowercase letters, digits, underscores, or hyphens.");
      } else if (challengeIds.has(challenge.id)) {
        addError(`${path}.id`, "duplicate-challenge-id", `Challenge ID ${challenge.id} is duplicated.`);
      } else {
        challengeIds.add(challenge.id);
      }
      if (!TRANSFORMATION_CHALLENGE_KINDS.includes(challenge.kind)) {
        addError(`${path}.kind`, "invalid-challenge-kind", `Challenge kind must be one of ${TRANSFORMATION_CHALLENGE_KINDS.join(", ")}.`);
      }
      if (!["blocking", "advisory"].includes(challenge.severity)) {
        addError(`${path}.severity`, "invalid-challenge-severity", "Challenge severity must be blocking or advisory.");
      }
      if (!TRANSFORMATION_CHALLENGE_STATUSES.includes(challenge.status)) {
        addError(`${path}.status`, "invalid-challenge-status", `Challenge status must be one of ${TRANSFORMATION_CHALLENGE_STATUSES.join(", ")}.`);
      }
      if (typeof challenge.prompt !== "string" || !challenge.prompt) addError(`${path}.prompt`, "invalid-challenge-prompt", "Challenge prompt must be a non-empty string.");
      if (typeof challenge.reason !== "string" || !challenge.reason) addError(`${path}.reason`, "invalid-challenge-reason", "Challenge reason must be a non-empty string.");
      if (!Array.isArray(challenge.affectedOperations) || challenge.affectedOperations.some(value => typeof value !== "string")) {
        addError(`${path}.affectedOperations`, "invalid-type", "affectedOperations must be an array of operation IDs.");
      }
      if (!Array.isArray(challenge.affectedPaths) || challenge.affectedPaths.some(value => typeof value !== "string")) {
        addError(`${path}.affectedPaths`, "invalid-type", "affectedPaths must be an array of paths.");
      }
      if (!TRANSFORMATION_CHALLENGE_ANSWER_MODES.includes(challenge.answerMode)) {
        addError(`${path}.answerMode`, "invalid-answer-mode", `answerMode must be one of ${TRANSFORMATION_CHALLENGE_ANSWER_MODES.join(", ")}.`);
      }
      if (!Array.isArray(challenge.choices)) addError(`${path}.choices`, "invalid-type", "choices must be an array.");
      if (!Object.prototype.hasOwnProperty.call(challenge, "answer")) addError(`${path}.answer`, "required", "Challenge requires an answer field, which may be null.");
      if (challenge.answerMode === "choice" && Array.isArray(challenge.choices) && challenge.choices.length < 2) {
        addError(`${path}.choices`, "insufficient-choices", "Choice challenges require at least two choices.");
      }
      if (challenge.status === "answered" && challenge.answer == null) {
        addError(`${path}.answer`, "answer-required", "Answered challenges require a recorded answer.");
      }
    });
  }

  if (!isPlainObject(contract.runtimePolicy)) {
    addError("$.runtimePolicy", "invalid-type", "runtimePolicy must be an object.");
  } else {
    if (typeof contract.runtimePolicy.requireApproval !== "boolean") addError("$.runtimePolicy.requireApproval", "invalid-type", "requireApproval must be boolean.");
    if (!["warn", "quarantine", "block"].includes(contract.runtimePolicy.onRecordViolation)) {
      addError("$.runtimePolicy.onRecordViolation", "invalid-policy", "onRecordViolation must be warn, quarantine, or block.");
    }
    if (!["warn", "block"].includes(contract.runtimePolicy.onBatchViolation)) {
      addError("$.runtimePolicy.onBatchViolation", "invalid-policy", "onBatchViolation must be warn or block.");
    }
    if (!Number.isInteger(contract.runtimePolicy.warningThreshold) || contract.runtimePolicy.warningThreshold < 0) {
      addError("$.runtimePolicy.warningThreshold", "invalid-threshold", "warningThreshold must be a non-negative integer.");
    }
  }

  if (!Array.isArray(contract.evidenceLinks)) {
    addError("$.evidenceLinks", "invalid-type", "evidenceLinks must be an array.");
  } else {
    const exampleIds = new Set(Array.isArray(contract.evidence?.examples) ? contract.evidence.examples.map(example => example?.id) : []);
    const operationCount = Array.isArray(contract.program?.ops) ? contract.program.ops.length : 0;
    contract.evidenceLinks.forEach((link, index) => {
      const path = `$.evidenceLinks[${index}]`;
      if (!isPlainObject(link)) {
        addError(path, "invalid-evidence-link", "Every evidence link must be an object.");
        return;
      }
      if (!Number.isInteger(link.operationIndex) || link.operationIndex < 0 || link.operationIndex >= operationCount) {
        addError(`${path}.operationIndex`, "invalid-operation-reference", "operationIndex must reference an existing program operation.");
      }
      if (!Array.isArray(link.exampleIds) || !link.exampleIds.length) {
        addError(`${path}.exampleIds`, "invalid-example-references", "exampleIds must be a non-empty array.");
      } else {
        link.exampleIds.forEach((exampleId, exampleIndex) => {
          if (!exampleIds.has(exampleId)) {
            addError(`${path}.exampleIds[${exampleIndex}]`, "unknown-example-reference", `Evidence example ${exampleId} does not exist.`);
          }
        });
      }
    });
  }
  if (!isPlainObject(contract.extensions)) addError("$.extensions", "invalid-type", "extensions must be an object.");
  if (contract.metadata !== undefined && !isPlainObject(contract.metadata)) addError("$.metadata", "invalid-type", "metadata must be an object when present.");

  const approvalState = contract.lifecycle?.approvalState;
  const mayRetainApproval = ["approved", "superseded", "revoked"].includes(approvalState);
  if (approvalState === "approved" && !isPlainObject(contract.approval)) {
    addError("$.approval", "approval-required", "Approved contracts require an approval record.");
  }
  if (isPlainObject(contract.approval)) {
    for (const field of Object.keys(contract.approval)) {
      if (!["method", "state", "approvedCoreFingerprint", "acknowledgedChallenges", "note"].includes(field)) {
        addError(`$.approval.${field}`, "unknown-approval-field", `Unknown approval field ${field} is not part of the auditable approval record.`);
      }
    }
    if (!mayRetainApproval) {
      addError("$.approval", "unexpected-approval", "Unreviewed and review-required contracts cannot contain an approval record.");
    }
    if (contract.approval.state !== "approved") addError("$.approval.state", "invalid-approval", "approval.state must record the approved state.");
    if (!TRANSFORMATION_APPROVAL_METHODS.includes(contract.approval.method)) {
      addError("$.approval.method", "invalid-approval-method", `approval.method must be one of ${TRANSFORMATION_APPROVAL_METHODS.join(", ")}.`);
    }
    if (!isFingerprint(contract.approval.approvedCoreFingerprint)) addError("$.approval.approvedCoreFingerprint", "invalid-fingerprint", "approval.approvedCoreFingerprint must be a contract fingerprint.");
    if (!Array.isArray(contract.approval.acknowledgedChallenges)) {
      addError("$.approval.acknowledgedChallenges", "invalid-type", "acknowledgedChallenges must be an array.");
    } else {
      const challengeIds = new Set(Array.isArray(contract.challenges) ? contract.challenges.map(challenge => challenge?.id) : []);
      const acknowledged = new Set();
      contract.approval.acknowledgedChallenges.forEach((challengeId, index) => {
        if (typeof challengeId !== "string" || !challengeIds.has(challengeId)) {
          addError(`$.approval.acknowledgedChallenges[${index}]`, "unknown-acknowledged-challenge", `Acknowledged challenge ${String(challengeId)} does not exist.`);
        } else if (acknowledged.has(challengeId)) {
          addError(`$.approval.acknowledgedChallenges[${index}]`, "duplicate-acknowledged-challenge", `Challenge ${challengeId} is acknowledged more than once.`);
        } else {
          acknowledged.add(challengeId);
        }
      });
      if (approvalState === "approved") {
        const unacknowledgedAdvisory = (contract.challenges || [])
          .filter(challenge => challenge?.severity === "advisory" && ["open", "deferred"].includes(challenge?.status))
          .filter(challenge => !acknowledged.has(challenge.id));
        if (unacknowledgedAdvisory.length) {
          addError("$.approval.acknowledgedChallenges", "unacknowledged-advisory-challenges", "Approved contracts must acknowledge every unresolved advisory challenge.");
        }
      }
    }
    if (contract.approval.note !== undefined && typeof contract.approval.note !== "string") {
      addError("$.approval.note", "invalid-type", "approval.note must be a string when present.");
    }
  } else if (contract.approval !== null && contract.approval !== undefined) {
    addError("$.approval", "invalid-type", "approval must be an object or null.");
  }

  if (approvalState === "approved") {
    const unresolvedBlocking = Array.isArray(contract.challenges)
      ? contract.challenges.filter(challenge => challenge?.severity === "blocking" && ["open", "deferred"].includes(challenge?.status))
      : [];
    if (unresolvedBlocking.length) {
      addError("$.challenges", "approval-has-open-blockers", "Approved contracts cannot contain open or deferred blocking challenges.");
    }
  }

  const canVerifyIdentity = verifyIdentity
    && version?.major === TRANSFORMATION_CONTRACT_SUPPORTED_MAJOR
    && isPlainObject(contract.identity)
    && ["kind", "contractVersion", "engine", "formats", "evidence", "input", "output", "program", "invariants", "runtimePolicy"]
      .every(field => Object.prototype.hasOwnProperty.call(contract, field))
    && errors.every(error => !["non-json-value", "non-finite-number", "circular-value", "non-plain-object", "sparse-array"].includes(error.code));

  if (canVerifyIdentity) {
    const expected = deriveTransformationContractIdentity(contract);
    for (const field of ["contractId", "coreFingerprint", "programFingerprint", "evidenceFingerprint"]) {
      if (contract.identity[field] !== expected[field]) {
        addError(`$.identity.${field}`, "identity-mismatch", `${field} does not match the deterministic contract content.`);
      }
    }
    if (isPlainObject(contract.approval) && contract.approval.approvedCoreFingerprint !== expected.coreFingerprint) {
      addError("$.approval.approvedCoreFingerprint", "approval-fingerprint-mismatch", "Approval does not match the current contract core.");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    version,
  };
}
