/**
 * Vercel HTTP adapter for Latentmachine's MCP tools. The transport validates
 * protocol, origin, and payload limits before invoking the shared engine.
 */
import { detectFormat, parseWithFormat } from "../src/intelligence/data-formats/index.js";
import { executeJsonTransform } from "../src/intelligence/json-transform/runtime.js";
import { runTransform } from "../src/intelligence/json-transform/translator.js";
import { inferVerifyRule } from "../src/intelligence/json-transform/verify-inference.js";
import { fingerprint, profileStructure, structuralDiff } from "../src/intelligence/trace/engine.js";
import {
  checkContract,
  compareContracts,
  generateTransformationChallenges,
  learnContract,
  runContract,
  runTransformationMutationSuite,
  unwrapTransformationContract,
} from "../src/intelligence/contracts/index.js";
import { SECURITY_LIMITS, assertArrayLimit, assertSerializedLimit, assertTextLimit } from "../packages/verify/src/limits.js";
import { compactVerificationResult } from "../packages/verify/src/reporting.js";
import { memorisationSummary } from "../src/intelligence/json-transform/memorisation.js";
import { INFERENCE_EXAMPLE_LIMIT } from "../src/intelligence/json-transform/program-builder.js";

const FORMAT_ENUM = ["auto", "json", "csv", "yaml", "toml", "xml", "env", "sql"];
const DIFF_PATH_LIST_LIMIT = 100;
const CONTRACT_RECORD_LIST_LIMIT = 20;
const MCP_RATE_LIMIT_BUCKET_CAP = 10_000;
const mcpRateLimitBuckets = new Map();

function requestClientId(req) {
  const forwarded = req.headers?.["x-vercel-forwarded-for"]
    || req.headers?.["x-forwarded-for"]
    || req.socket?.remoteAddress
    || "unknown";
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded).split(",")[0].trim() || "unknown";
}

function requestCharacterCount(rawBody, parsedBody) {
  if (typeof rawBody === "string") return rawBody.length;
  try {
    return JSON.stringify(parsedBody)?.length || 0;
  } catch {
    return SECURITY_LIMITS.maxRequestCharacters;
  }
}

function pruneRateLimitBuckets(windowStart) {
  for (const [key, bucket] of mcpRateLimitBuckets) {
    if (bucket.windowStart < windowStart) mcpRateLimitBuckets.delete(key);
  }
  while (mcpRateLimitBuckets.size >= MCP_RATE_LIMIT_BUCKET_CAP) {
    mcpRateLimitBuckets.delete(mcpRateLimitBuckets.keys().next().value);
  }
}

export function consumeMcpRateLimit({
  clientId,
  characters,
  now = Date.now(),
} = {}) {
  const windowMs = SECURITY_LIMITS.mcpRateLimitWindowMs;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  pruneRateLimitBuckets(windowStart);
  const key = String(clientId || "unknown");
  const current = mcpRateLimitBuckets.get(key);
  const bucket = current?.windowStart === windowStart
    ? current
    : { windowStart, requests: 0, characters: 0 };
  const nextRequests = bucket.requests + 1;
  const nextCharacters = bucket.characters + Math.max(0, Number(characters) || 0);
  const limited = nextRequests > SECURITY_LIMITS.maxMcpRequestsPerWindow
    || nextCharacters > SECURITY_LIMITS.maxMcpCharactersPerWindow;

  if (!limited) {
    bucket.requests = nextRequests;
    bucket.characters = nextCharacters;
    mcpRateLimitBuckets.set(key, bucket);
  }

  return {
    limited,
    remainingRequests: Math.max(0, SECURITY_LIMITS.maxMcpRequestsPerWindow - (limited ? bucket.requests : nextRequests)),
    remainingCharacters: Math.max(0, SECURITY_LIMITS.maxMcpCharactersPerWindow - (limited ? bucket.characters : nextCharacters)),
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
  };
}

export const TOOLS = [
  {
    name: "verify_data_transformation",
    description:
      "Check whether a batch of AI-transformed data rows all follow one deterministic rule. " +
      "Takes the original records and transformed output, infers the majority rule, and returns a capped diagnostic summary. " +
      "Sparse optional fields are scoped to their source domain and may be unverifiable without flagging out-of-domain rows. " +
      "Coherent alternative rules are reported as additive clusters with support and share; equal splits are not reported as row-level defects. " +
      "Candidate inference uses at most 200 output-diverse examples, then validates every supplied row. " +
      "Uses a deterministic symbolic engine, not an LLM.",
    inputSchema: {
      type: "object",
      properties: {
        original: {
          type: "string",
          maxLength: SECURITY_LIMITS.maxToolTextCharacters,
          description: "Original records before transformation, as structured data text.",
        },
        transformed: {
          type: "string",
          maxLength: SECURITY_LIMITS.maxToolTextCharacters,
          description: "Transformed records as structured data text. Must have the same row count as original.",
        },
        format: {
          type: "string",
          enum: FORMAT_ENUM,
          description: "Optional source format. Defaults to auto.",
        },
        flagged_row_limit: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          default: 50,
          description: "Maximum flagged row details to return; total counts always cover the full batch.",
        },
      },
      required: ["original", "transformed"],
    },
  },
  {
    name: "infer_transformation_rule",
    description:
      "Infer a deterministic data transformation rule from input/output example pairs. " +
      "Returns the symbolic rule, confidence assessment, and any ambiguities. " +
      "The rule can then be applied to new data with apply_transformation_rule.",
    inputSchema: {
      type: "object",
      properties: {
        examples: {
          type: "string",
          maxLength: SECURITY_LIMITS.maxToolTextCharacters,
          description: 'JSON array of example pairs, e.g. [{"input": {...}, "output": {...}}].',
        },
      },
      required: ["examples"],
    },
  },
  {
    name: "apply_transformation_rule",
    description:
      "Apply a previously inferred transformation rule to new input data. " +
      "Requires an executable rule object from infer_transformation_rule. " +
      "Executes deterministically: same input plus same rule gives the same output.",
    inputSchema: {
      type: "object",
      properties: {
        rule: {
          type: "string",
          maxLength: SECURITY_LIMITS.maxToolTextCharacters,
          description: "Rule object as JSON, or a JSON result containing a rule object.",
        },
        input: {
          type: "string",
          maxLength: SECURITY_LIMITS.maxToolTextCharacters,
          description: "New input record or records as JSON.",
        },
      },
      required: ["rule", "input"],
    },
  },
  {
    name: "detect_data_format",
    description: "Detect the structured data format of a text string. Returns json, csv, yaml, toml, xml, env, sql, or unknown.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          maxLength: SECURITY_LIMITS.maxDetectCharacters,
          description: "The data string to analyze.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "fingerprint_data",
    description:
      "Compute a deterministic structural fingerprint of a dataset, or a structural diff between two datasets. " +
      "Same data always produces the same fingerprint: object key order is ignored and array order is significant. " +
      "Useful for asserting transformation stability, detecting config drift, or verifying agent output stability. " +
      "Non-cryptographic. Deterministic engine, not an LLM.",
    inputSchema: {
      type: "object",
      properties: {
        data: {
          type: "string",
          maxLength: SECURITY_LIMITS.maxToolTextCharacters,
          description: "Dataset as structured data text.",
        },
        compare_to: {
          type: "string",
          maxLength: SECURITY_LIMITS.maxToolTextCharacters,
          description: "Optional second dataset to compare against data.",
        },
        format: {
          type: "string",
          enum: FORMAT_ENUM,
          description: "Optional source format. Defaults to auto.",
        },
      },
      required: ["data"],
    },
  },
  {
    name: "learn_transformation_contract",
    description:
      "Learn a versioned Transformation Contract from input/output examples. " +
      "Returns an unapproved or review-required contract and never claims human approval. " +
      "Remote HTTP use sends the supplied examples to Latentmachine for stateless processing; use the local stdio server for local-only data.",
    inputSchema: {
      type: "object",
      properties: {
        examples: {
          type: "string",
          maxLength: SECURITY_LIMITS.maxToolTextCharacters,
          description: 'JSON array of example pairs: [{"input": {...}, "output": {...}}].',
        },
        include_contract: {
          type: "boolean",
          default: true,
          description: "Include the complete contract required by later contract tools.",
        },
      },
      required: ["examples"],
      additionalProperties: false,
    },
  },
  {
    name: "get_contract_challenges",
    description:
      "Return unresolved review questions for a Transformation Contract. Does not answer or approve them. " +
      "Remote HTTP use sends the contract to Latentmachine for stateless processing.",
    inputSchema: {
      type: "object",
      properties: {
        contract: { type: "string", maxLength: SECURITY_LIMITS.maxToolTextCharacters, description: "Complete Transformation Contract JSON." },
      },
      required: ["contract"],
      additionalProperties: false,
    },
  },
  {
    name: "test_transformation_contract",
    description:
      "Mutation-test every learned operation target against its evidence, disclose target coverage and detection gaps, and downgrade the reported inference status when mutation evidence is incomplete. " +
      "Remote HTTP use sends the contract and its embedded evidence to Latentmachine for stateless processing.",
    inputSchema: {
      type: "object",
      properties: {
        contract: { type: "string", maxLength: SECURITY_LIMITS.maxToolTextCharacters, description: "Complete Transformation Contract JSON." },
        include_report: { type: "boolean", default: false, description: "Include the full mutation report." },
      },
      required: ["contract"],
      additionalProperties: false,
    },
  },
  {
    name: "run_transformation_contract",
    description:
      "Run an already-approved Transformation Contract deterministically. Unapproved contracts are rejected and MCP cannot create local-human-review approval. " +
      "Remote HTTP use sends the contract and input to Latentmachine for stateless processing; use local stdio for local-only data.",
    inputSchema: {
      type: "object",
      properties: {
        contract: { type: "string", maxLength: SECURITY_LIMITS.maxToolTextCharacters, description: "Complete approved Transformation Contract JSON." },
        input: { type: "string", maxLength: SECURITY_LIMITS.maxToolTextCharacters, description: "Input data in the contract's declared format." },
        privacy_safe: { type: "boolean", default: true, description: "Redact raw record values from the returned report." },
        include_report: { type: "boolean", default: false, description: "Include the complete deterministic run report." },
        record_limit: { type: "integer", minimum: 0, maximum: 100, default: 20, description: "Maximum record summaries to return." },
      },
      required: ["contract", "input"],
      additionalProperties: false,
    },
  },
  {
    name: "check_transformation_contract",
    description:
      "Check external output against an already-approved Transformation Contract. Unapproved contracts are rejected and MCP cannot create local-human-review approval. " +
      "Remote HTTP use sends the contract, input, and output to Latentmachine for stateless processing; use local stdio for local-only data.",
    inputSchema: {
      type: "object",
      properties: {
        contract: { type: "string", maxLength: SECURITY_LIMITS.maxToolTextCharacters, description: "Complete approved Transformation Contract JSON." },
        input: { type: "string", maxLength: SECURITY_LIMITS.maxToolTextCharacters, description: "Input data in the contract's declared format." },
        output: { type: "string", maxLength: SECURITY_LIMITS.maxToolTextCharacters, description: "External output data in the contract's declared format." },
        privacy_safe: { type: "boolean", default: true, description: "Redact raw record values from the returned report." },
        include_report: { type: "boolean", default: false, description: "Include the complete deterministic check report." },
        record_limit: { type: "integer", minimum: 0, maximum: 100, default: 20, description: "Maximum record summaries to return." },
      },
      required: ["contract", "input", "output"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_transformation_contracts",
    description:
      "Compare two Transformation Contracts and classify behavioral, review, evidence, and metadata changes. " +
      "Remote HTTP use sends both contracts to Latentmachine for stateless processing.",
    inputSchema: {
      type: "object",
      properties: {
        baseline: { type: "string", maxLength: SECURITY_LIMITS.maxToolTextCharacters, description: "Baseline Transformation Contract JSON." },
        candidate: { type: "string", maxLength: SECURITY_LIMITS.maxToolTextCharacters, description: "Candidate Transformation Contract JSON." },
        include_changes: { type: "boolean", default: true, description: "Include up to 100 path-level changes." },
      },
      required: ["baseline", "candidate"],
      additionalProperties: false,
    },
  },
];

export const SERVER_INFO = {
  name: "latentmachine",
  version: "0.1.0",
};

export const SERVER_CAPABILITIES = {
  tools: {},
};

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];
export const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

function negotiateProtocolVersion(requestedVersion) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
    ? requestedVersion
    : SUPPORTED_PROTOCOL_VERSIONS[0];
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    const isProduction = url.protocol === "https:" && (url.hostname === "latentmachine.com" || url.hostname === "www.latentmachine.com");
    const allowsLocalhost = process.env.VERCEL_ENV !== "production" && process.env.NODE_ENV !== "production";
    return isProduction || (allowsLocalhost && isLocalhost);
  } catch {
    return false;
  }
}

function validateProtocolVersion(req) {
  const version = req.headers["mcp-protocol-version"] || req.headers["MCP-Protocol-Version"];
  if (!version) return DEFAULT_PROTOCOL_VERSION;
  const normalized = Array.isArray(version) ? version[0] : String(version);
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(normalized)) {
    throw new Error(`Unsupported MCP protocol version: ${normalized}`);
  }
  return normalized;
}

function normalizeRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return [parsed];
  return parsed;
}

function parseMaybeStructured(value, format = "auto") {
  assertTextLimit(value, "Input data");
  return typeof value === "string" ? parseWithFormat(value, format) : value;
}

function parseToolData(value, label, format = "auto") {
  if (value === undefined || value === null) throw new Error(`${label} is required.`);
  assertTextLimit(value, label);
  const parsed = typeof value === "string" ? parseWithFormat(value, format) : value;
  assertSerializedLimit(parsed, label);
  return parsed;
}

function parseMaybeJson(value, label) {
  assertTextLimit(value, label);
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label}: ${error?.message || "invalid JSON"}`);
  }
}

function resolveRuleArtifact(rule) {
  const artifact = rule?.program ? rule : rule?.rule?.program ? rule.rule : rule?.result?.rule?.program ? rule.result.rule : null;
  if (artifact?.executable === false) {
    throw new Error("This is a compact diagnostic rule without lookup bodies. Use infer_transformation_rule before applying it.");
  }
  if (artifact) return artifact;
  throw new Error("Invalid rule. Provide an executable rule artifact from infer_transformation_rule.");
}

export function handleVerify({ original, transformed, format = "auto", flagged_row_limit = 50 }) {
  const originalRows = normalizeRows(parseMaybeStructured(original, format));
  const transformedRows = normalizeRows(parseMaybeStructured(transformed, format));
  assertArrayLimit(originalRows, "Original rows", SECURITY_LIMITS.maxRows);
  assertArrayLimit(transformedRows, "Transformed rows", SECURITY_LIMITS.maxRows);
  assertSerializedLimit(originalRows, "Original rows");
  assertSerializedLimit(transformedRows, "Transformed rows");

  if (!Array.isArray(originalRows) || !Array.isArray(transformedRows)) {
    throw new Error("Both original and transformed must resolve to arrays of records.");
  }
  if (originalRows.length !== transformedRows.length) {
    throw new Error(`Row count mismatch: original has ${originalRows.length}, transformed has ${transformedRows.length}.`);
  }
  if (originalRows.length === 0) {
    throw new Error("Empty input. Provide at least one row.");
  }

  const result = inferVerifyRule(originalRows, transformedRows);
  const memorisation = result.result?.rule?.memorisation || null;
  const unverifiableTargets = memorisation?.unverifiableTargets || memorisation?.memorisedTargets || [];
  const hasUnverifiableTargets = unverifiableTargets.length > 0;
  const verdict = result.verdict || (result.flagged.length
    ? "inconsistent"
    : hasUnverifiableTargets ? "unverifiable" : "consistent");

  return compactVerificationResult({
    verdict,
    totalRows: originalRows.length,
    inference: {
      strategy: "bounded-output-aware",
      maximumEvidenceRows: INFERENCE_EXAMPLE_LIMIT,
      sampled: originalRows.length > INFERENCE_EXAMPLE_LIMIT,
      validationRows: originalRows.length,
    },
    matchedRows: result.matched,
    clusters: result.clusters || [],
    unexplained: result.unexplained || [],
    flaggedRows: result.flagged.map((flag) => ({
      index: flag.i,
      input: flag.input,
      expected: flag.predicted,
      actual: flag.actual,
    })),
    rule: result.result?.rule || null,
    ruleStatus: result.result?.status || "unknown",
    ruleSteps: result.result?.rule?.program?.ops?.length || 0,
    confidence: result.result?.confidence || null,
    memorisation,
    summary: verdict === "unverifiable"
      ? result.clusters?.length > 1
        ? `${originalRows.length} rows split across ${result.clusters.length} coherent rule clusters without a clear majority.`
        : memorisationSummary(memorisation)
      : verdict === "consistent"
        ? `${originalRows.length} rows followed one reusable deterministic rule.`
        : result.clusters?.length > 1
          ? `${result.clusters.length} coherent rule clusters were found; ${result.flagged.length} rows fell outside the dominant cluster.`
          : `${result.flagged.length} of ${originalRows.length} rows contradicted the inferred rule.`,
  }, { flaggedRowLimit: flagged_row_limit });
}

export function handleInfer({ examples }) {
  const parsed = parseMaybeJson(examples, "examples");
  assertArrayLimit(parsed, "Examples", SECURITY_LIMITS.maxExamples);
  assertSerializedLimit(parsed, "Examples");
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Provide at least one { input, output } example.");
  }
  for (const example of parsed) {
    if (!example || !("input" in example) || !("output" in example)) {
      throw new Error("Each example must have an input and an output property.");
    }
  }

  const result = runTransform({ examples: parsed });
  return {
    status: result.status,
    rule: result.rule || null,
    confidence: result.confidence || null,
    diagnosis: result.diagnosis || null,
    warnings: result.warnings || [],
  };
}

export function handleTransform({ rule, input }) {
  const parsedRule = resolveRuleArtifact(parseMaybeJson(rule, "rule"));
  const parsedInput = parseMaybeJson(input, "input");
  assertSerializedLimit(parsedRule, "Rule");
  assertSerializedLimit(parsedInput, "Input");
  if (Array.isArray(parsedInput)) {
    assertArrayLimit(parsedInput, "Input rows", SECURITY_LIMITS.maxTransformRows);
    return parsedInput.map((row) => executeJsonTransform(parsedRule.program, row));
  }
  return executeJsonTransform(parsedRule.program, parsedInput);
}

export function handleDetectFormat({ text }) {
  assertTextLimit(text, "Text", SECURITY_LIMITS.maxDetectCharacters);
  return { format: detectFormat(text) };
}

function capList(items) {
  return {
    items: items.slice(0, DIFF_PATH_LIST_LIMIT).map(item => ({
      path: item.path,
      type: item.type,
      value: item.value,
      ...(item.typeChanged !== undefined ? { typeChanged: item.typeChanged } : {}),
    })),
    capped: items.length > DIFF_PATH_LIST_LIMIT,
    limit: DIFF_PATH_LIST_LIMIT,
  };
}

export function handleFingerprint({ data, compare_to, format = "auto" }) {
  const left = parseToolData(data, "Data", format);
  const leftFingerprint = fingerprint(left);
  const profile = profileStructure(left);

  if (compare_to === undefined || compare_to === null || compare_to === "") {
    return {
      fingerprint: leftFingerprint,
      profile,
      nonCryptographic: true,
    };
  }

  const right = parseToolData(compare_to, "Compare data", format);
  const diff = structuralDiff(left, right);
  return {
    fingerprint: leftFingerprint,
    profile,
    fingerprints: diff.fingerprints,
    counts: diff.counts,
    changed: capList(diff.changed),
    added: capList(diff.added),
    removed: capList(diff.removed),
    note: "Path lists are capped at 100 entries per class. Fingerprints and counts cover all data.",
    nonCryptographic: true,
  };
}

function contractSummary(contract, mutationReport = null) {
  const challenges = Array.isArray(contract?.challenges) ? contract.challenges : [];
  return {
    contractId: contract?.identity?.contractId || null,
    coreFingerprint: contract?.identity?.coreFingerprint || null,
    inferenceStatus: mutationReport?.inferenceStatus || contract?.inference?.status || null,
    sourceInferenceStatus: contract?.inference?.status || null,
    ...(mutationReport ? {
      mutationCount: mutationReport.mutations.length,
      mutationGapCount: mutationReport.undetected.length,
      targetCoverage: mutationReport.coverage?.targetCoverage ?? 0,
    } : {}),
    approvalState: contract?.lifecycle?.approvalState || null,
    revision: contract?.lifecycle?.revision || null,
    blockingChallenges: challenges.filter(item => (
      item.severity === "blocking" && ["open", "deferred"].includes(item.status)
    )).length,
    advisoryChallenges: challenges.filter(item => (
      item.severity === "advisory" && ["open", "deferred"].includes(item.status)
    )).length,
    humanApproved: contract?.approval?.method === "local-human-review"
      && contract?.lifecycle?.approvalState === "approved",
  };
}

function conciseRuntimeResult(report, args) {
  const requestedLimit = Number.isInteger(args.record_limit)
    ? args.record_limit
    : CONTRACT_RECORD_LIST_LIMIT;
  const limit = Math.max(0, Math.min(100, requestedLimit));
  const records = report.records.slice(0, limit).map(record => ({
    rowId: record.rowId,
    sourceIndex: record.sourceIndex,
    status: record.status,
    diagnostics: record.diagnostics,
  }));
  return {
    summary: {
      kind: report.kind,
      contractId: report.contractId,
      contractFingerprint: report.contractFingerprint,
      verdict: report.verdict,
      totals: report.totals,
      errorCount: report.errors.length,
      warningCount: report.warnings.length,
      reviewRequired: report.errors.some(error => error.code === "approval-required"),
    },
    records,
    omittedRecords: Math.max(0, report.records.length - records.length),
    errors: report.errors.slice(0, 10),
    warnings: report.warnings.slice(0, 10),
    ...(args.include_report ? { report } : {}),
  };
}

export function handleLearnContract({ examples, include_contract = true }) {
  const parsed = parseMaybeJson(examples, "examples");
  assertArrayLimit(parsed, "Examples", SECURITY_LIMITS.maxExamples);
  assertSerializedLimit(parsed, "Examples");
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Provide at least one { input, output } example.");
  }
  const contract = learnContract({ examples: parsed }, { evidenceSource: "mcp-remote-http" });
  const mutationReport = runTransformationMutationSuite(contract, {
    inputRecords: contract.evidence?.examples?.map(example => example.input) || [],
    outputRecords: contract.evidence?.examples?.map(example => example.output) || [],
    failedRecords: [],
  });
  return {
    summary: contractSummary(contract, mutationReport),
    review: {
      required: contract.lifecycle.approvalState !== "approved",
      humanApprovalCreated: false,
      nextAction: "Review challenges and approve the exact fingerprint in Contract Studio or the CLI.",
    },
    ...(include_contract === false ? {} : { contract }),
  };
}

export function handleContractChallenges({ contract }) {
  const challenged = generateTransformationChallenges(parseMaybeJson(contract, "contract"));
  return {
    summary: contractSummary(challenged),
    challenges: challenged.challenges.filter(item => ["open", "deferred"].includes(item.status)),
    humanApprovalCreated: false,
  };
}

export function handleContractTest({ contract, include_report = false }) {
  const parsed = unwrapTransformationContract(parseMaybeJson(contract, "contract"));
  const report = runTransformationMutationSuite(parsed, {
    inputRecords: parsed.evidence?.examples?.map(example => example.input) || [],
    outputRecords: parsed.evidence?.examples?.map(example => example.output) || [],
    failedRecords: [],
  });
  return {
    summary: {
      contractFingerprint: report.contractFingerprint,
      inferenceStatus: report.inferenceStatus,
      sourceInferenceStatus: report.sourceInferenceStatus,
      mutationCount: report.mutations.length,
      detectedCount: report.detected.length,
      gapCount: report.undetected.length,
      detected: report.detected,
      gaps: report.undetected,
      coverage: report.coverage,
    },
    ...(include_report ? { report } : {}),
  };
}

export function handleContractRun(args) {
  assertTextLimit(args.input, "Input");
  const report = runContract({
    contract: parseMaybeJson(args.contract, "contract"),
    input: args.input,
    options: { privacySafe: args.privacy_safe !== false },
  });
  return conciseRuntimeResult(report, args);
}

export function handleContractCheck(args) {
  assertTextLimit(args.input, "Input");
  assertTextLimit(args.output, "Output");
  const report = checkContract({
    contract: parseMaybeJson(args.contract, "contract"),
    input: args.input,
    output: args.output,
    options: { privacySafe: args.privacy_safe !== false },
  });
  return conciseRuntimeResult(report, args);
}

export function handleContractComparison({ baseline, candidate, include_changes = true }) {
  const comparison = compareContracts(
    parseMaybeJson(baseline, "baseline"),
    parseMaybeJson(candidate, "candidate"),
  );
  const allChanges = Array.isArray(comparison.changes) ? comparison.changes : [];
  const changes = include_changes ? allChanges.slice(0, DIFF_PATH_LIST_LIMIT) : [];
  return {
    summary: {
      relation: comparison.relation,
      classification: comparison.classification,
      breaking: comparison.breaking,
      requiresReapproval: comparison.requiresReapproval,
      ...comparison.summary,
    },
    changes,
    omittedChanges: Math.max(0, allChanges.length - changes.length),
    validation: comparison.validation,
  };
}

export const TOOL_HANDLERS = {
  verify_data_transformation: handleVerify,
  infer_transformation_rule: handleInfer,
  apply_transformation_rule: handleTransform,
  detect_data_format: handleDetectFormat,
  fingerprint_data: handleFingerprint,
  learn_transformation_contract: handleLearnContract,
  get_contract_challenges: handleContractChallenges,
  test_transformation_contract: handleContractTest,
  run_transformation_contract: handleContractRun,
  check_transformation_contract: handleContractCheck,
  compare_transformation_contracts: handleContractComparison,
};

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

export function handleJsonRpc(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return jsonRpcError(null, -32600, "Invalid JSON-RPC message.");
  }

  const { method, params, id } = message || {};

  if (!method && ("result" in message || "error" in message)) return null;
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return null;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
        serverInfo: SERVER_INFO,
        capabilities: SERVER_CAPABILITIES,
      },
    };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: TOOLS },
    };
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const handler = TOOL_HANDLERS[toolName];
    if (!handler) return jsonRpcError(id, -32601, `Unknown tool: ${toolName}`);

    try {
      assertSerializedLimit(params?.arguments || {}, "Tool arguments");
      const result = handler(params?.arguments || {});
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ error: error?.message || "Tool failed." }) }],
          isError: true,
        },
      };
    }
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  return jsonRpcError(id, -32601, `Method not supported: ${method}`);
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = origin && isAllowedOrigin(origin) ? origin : "*";
  res.setHeader("Access-Control-Allow-Origin", origin && !isAllowedOrigin(origin) ? "null" : allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
}

function parseRequestBody(body) {
  if (typeof body !== "string") {
    assertSerializedLimit(body, "Request body", SECURITY_LIMITS.maxRequestCharacters);
    return body;
  }
  assertTextLimit(body, "Request body", SECURITY_LIMITS.maxRequestCharacters);
  if (!body.trim()) return null;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).json(jsonRpcError(null, -32000, "Origin is not allowed."));
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    validateProtocolVersion(req);
  } catch (error) {
    return res.status(400).json(jsonRpcError(null, -32600, error.message));
  }

  if (req.method === "DELETE") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    const accept = req.headers.accept || "";
    if (accept.includes("text/event-stream")) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.write(": latentmachine mcp\n\n");
      return res.end();
    }

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({
      ...SERVER_INFO,
      description: "Latentmachine MCP server. Deterministic verification for AI data transformations.",
      tools: TOOLS.map((tool) => tool.name),
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = parseRequestBody(req.body);
    } catch (error) {
      return res.status(413).json(jsonRpcError(null, -32000, error.message));
    }
    if (body === undefined) {
      return res.status(400).json(jsonRpcError(null, -32700, "Invalid JSON request body."));
    }
    if (!body) {
      return res.status(400).json(jsonRpcError(null, -32700, "Empty request body."));
    }

    const rate = consumeMcpRateLimit({
      clientId: requestClientId(req),
      characters: requestCharacterCount(req.body, body),
    });
    res.setHeader("X-RateLimit-Limit", String(SECURITY_LIMITS.maxMcpRequestsPerWindow));
    res.setHeader("X-RateLimit-Remaining", String(rate.remainingRequests));
    if (rate.limited) {
      res.setHeader("Retry-After", String(rate.retryAfterSeconds));
      return res.status(429).json(jsonRpcError(null, -32029, "Rate limit exceeded. Retry after the indicated delay."));
    }

    res.setHeader("Content-Type", "application/json");
    if (Array.isArray(body)) {
      try {
        assertArrayLimit(body, "JSON-RPC batch", SECURITY_LIMITS.maxMcpBatchLength);
      } catch (error) {
        return res.status(413).json(jsonRpcError(null, -32000, error.message));
      }
      const responses = body.map((message) => handleJsonRpc(message)).filter(Boolean);
      if (responses.length === 0) return res.status(202).end();
      return res.status(200).json(responses);
    }

    const response = handleJsonRpc(body);
    if (response === null) return res.status(202).end();
    return res.status(200).json(response);
  }

  return res.status(405).json(jsonRpcError(null, -32600, `Method ${req.method} not allowed.`));
}
