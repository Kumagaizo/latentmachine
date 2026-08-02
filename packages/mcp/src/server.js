/**
 * Dependency-light MCP server core. It translates JSON-RPC tool calls into the
 * same deterministic engine exposed by @latentmachine/verify.
 */
const FORMAT_ENUM = ["auto", "json", "csv", "yaml", "toml", "xml", "env", "sql"];
export const MAX_JSON_RPC_LINE_CHARACTERS = 1_000_000;
export const MAX_JSON_RPC_BATCH_LENGTH = 4;
const DIFF_PATH_LIST_LIMIT = 100;
const CONTRACT_RECORD_LIST_LIMIT = 20;

let runtimePromise;

export function extractJsonRpcIdFromHead(line, scanLimit = 1024) {
  const head = String(line).slice(0, scanLimit);
  const match = head.match(/"id"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(-?\d+)|null)/);
  if (!match) return null;
  if (match[1] !== undefined) {
    try {
      return JSON.parse(`"${match[1]}"`);
    } catch {
      return null;
    }
  }
  return match[2] === undefined ? null : Number(match[2]);
}

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = import("@latentmachine/verify").catch((error) => {
      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
      return import("../../verify/src/index.js");
    });
  }
  return runtimePromise;
}

function toolSchema(properties, required) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export const TOOLS = [
  {
    name: "verify_data_transformation",
    description: [
      "Check whether a batch of AI-transformed data rows all follow one deterministic rule.",
      "Paste the original records and the AI-generated output.",
      "Returns a capped diagnostic summary; high-cardinality lookup bodies are never inlined.",
      "Text arguments are capped at 500,000 characters and the stdio JSON-RPC line at 1,000,000 characters; an audited wide-record fixture is safe at roughly 1,200 rows per call.",
      "Uses a deterministic symbolic engine, not an LLM.",
    ].join(" "),
    inputSchema: toolSchema({
      original: {
        type: "string",
        description: "The original records before transformation, as structured data text.",
      },
      transformed: {
        type: "string",
        description: "The AI-generated or transformed records as structured data text. Must have the same row count as original.",
      },
      format: {
        type: "string",
        enum: FORMAT_ENUM,
        default: "auto",
        description: "Data format. Auto-detected if omitted.",
      },
      flagged_row_limit: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        default: 50,
        description: "Maximum flagged row details to return; total counts always cover the full batch.",
      },
    }, ["original", "transformed"]),
  },
  {
    name: "infer_transformation_rule",
    description: [
      "Infer a deterministic data transformation rule from input/output example pairs.",
      "Provide examples showing before and after records.",
      "Returns the symbolic rule, confidence assessment, and ambiguities or warnings.",
      "The rule can then be applied to new data with apply_transformation_rule.",
    ].join(" "),
    inputSchema: toolSchema({
      examples: {
        type: "string",
        description: 'JSON array of example pairs: [{"input": {...}, "output": {...}}].',
      },
    }, ["examples"]),
  },
  {
    name: "apply_transformation_rule",
    description: [
      "Apply a previously inferred transformation rule to new input data.",
      "Requires an executable rule artifact from infer_transformation_rule.",
      "Executes deterministically: same input, same rule, same output.",
    ].join(" "),
    inputSchema: toolSchema({
      rule: {
        type: "string",
        description: "The rule artifact as JSON, or a JSON result containing a rule artifact.",
      },
      input: {
        type: "string",
        description: "New input record or records as JSON.",
      },
    }, ["rule", "input"]),
  },
  {
    name: "detect_data_format",
    description: "Detect the structured data format of a text string. Returns json, csv, yaml, toml, xml, env, sql, or unknown.",
    inputSchema: toolSchema({
      text: {
        type: "string",
        description: "The data string to analyze.",
      },
    }, ["text"]),
  },
  {
    name: "fingerprint_data",
    description: [
      "Compute a deterministic structural fingerprint of a dataset, or a structural diff between two datasets.",
      "Same data always produces the same fingerprint: object key order is ignored and array order is significant.",
      "Useful for asserting that a transformation preserved data, detecting drift between config versions, or verifying agent output stability.",
      "Non-cryptographic. Deterministic engine, not an LLM.",
    ].join(" "),
    inputSchema: toolSchema({
      data: {
        type: "string",
        description: "Dataset as structured data text.",
      },
      compare_to: {
        type: "string",
        description: "Optional second dataset to compare against data.",
      },
      format: {
        type: "string",
        enum: FORMAT_ENUM,
        default: "auto",
        description: "Data format. Auto-detected if omitted.",
      },
    }, ["data"]),
  },
  {
    name: "learn_transformation_contract",
    description: [
      "Learn a versioned Transformation Contract from input/output examples.",
      "Returns an unapproved or review-required contract; this tool never claims human approval.",
      "Local stdio processing keeps payloads on the user's machine.",
    ].join(" "),
    inputSchema: toolSchema({
      examples: {
        type: "string",
        description: 'JSON array of example pairs: [{"input": {...}, "output": {...}}].',
      },
      include_contract: {
        type: "boolean",
        default: true,
        description: "Include the complete contract required by later contract tools.",
      },
    }, ["examples"]),
  },
  {
    name: "get_contract_challenges",
    description: "Return unresolved review questions for a Transformation Contract. Does not answer or approve them.",
    inputSchema: toolSchema({
      contract: {
        type: "string",
        description: "Complete Transformation Contract JSON.",
      },
    }, ["contract"]),
  },
  {
    name: "test_transformation_contract",
    description: "Mutation-test every learned operation target against its evidence, disclose target coverage and detection gaps, and downgrade the reported inference status when mutation evidence is incomplete.",
    inputSchema: toolSchema({
      contract: {
        type: "string",
        description: "Complete Transformation Contract JSON.",
      },
      include_report: {
        type: "boolean",
        default: false,
        description: "Include the full mutation report instead of its concise summary.",
      },
    }, ["contract"]),
  },
  {
    name: "run_transformation_contract",
    description: [
      "Run an already-approved Transformation Contract deterministically.",
      "Unapproved contracts are rejected; MCP cannot create local-human-review approval.",
      "Local stdio processing keeps payloads on the user's machine.",
    ].join(" "),
    inputSchema: toolSchema({
      contract: { type: "string", description: "Complete approved Transformation Contract JSON." },
      input: { type: "string", description: "Input data in the contract's declared format." },
      privacy_safe: { type: "boolean", default: false, description: "Redact raw record values from the returned report." },
      include_report: { type: "boolean", default: false, description: "Include the complete deterministic run report." },
      record_limit: { type: "integer", minimum: 0, maximum: 100, default: 20, description: "Maximum record summaries to return." },
    }, ["contract", "input"]),
  },
  {
    name: "check_transformation_contract",
    description: [
      "Check external output against an already-approved Transformation Contract.",
      "Unapproved contracts are rejected; MCP cannot create local-human-review approval.",
      "Local stdio processing keeps payloads on the user's machine.",
    ].join(" "),
    inputSchema: toolSchema({
      contract: { type: "string", description: "Complete approved Transformation Contract JSON." },
      input: { type: "string", description: "Input data in the contract's declared format." },
      output: { type: "string", description: "External output data in the contract's declared format." },
      privacy_safe: { type: "boolean", default: false, description: "Redact raw record values from the returned report." },
      include_report: { type: "boolean", default: false, description: "Include the complete deterministic check report." },
      record_limit: { type: "integer", minimum: 0, maximum: 100, default: 20, description: "Maximum record summaries to return." },
    }, ["contract", "input", "output"]),
  },
  {
    name: "compare_transformation_contracts",
    description: "Compare two valid Transformation Contracts and classify behavioral, review, evidence, and metadata changes.",
    inputSchema: toolSchema({
      baseline: { type: "string", description: "Baseline Transformation Contract JSON." },
      candidate: { type: "string", description: "Candidate Transformation Contract JSON." },
      include_changes: { type: "boolean", default: true, description: "Include up to 100 path-level changes." },
    }, ["baseline", "candidate"]),
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
    : DEFAULT_PROTOCOL_VERSION;
}

function parseJson(value, label, runtime) {
  runtime.assertTextLimit(value, label);
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    runtime.assertSerializedLimit(parsed, label);
    return parsed;
  } catch (error) {
    throw new Error(`${label}: ${error?.message || "invalid JSON"}`);
  }
}

function parseStructured(value, label, format, runtime) {
  if (value === undefined || value === null) throw new Error(`${label} is required.`);
  runtime.assertTextLimit(value, label);
  const parsed = typeof value === "string" ? runtime.parseWithFormat(value, format || "auto") : value;
  runtime.assertSerializedLimit(parsed, label);
  return parsed;
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

function effectiveInferenceStatus(contract, mutationReport = null) {
  const status = contract?.inference?.status || null;
  if (status !== "safe" || !mutationReport) return status;
  return mutationReport.inferenceStatus || status;
}

function contractSummary(contract, mutationReport = null) {
  const challenges = Array.isArray(contract?.challenges) ? contract.challenges : [];
  return {
    contractId: contract?.identity?.contractId || null,
    coreFingerprint: contract?.identity?.coreFingerprint || null,
    inferenceStatus: effectiveInferenceStatus(contract, mutationReport),
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

function runtimeResult(report, args) {
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

function mutationResult(report, includeReport, contract) {
  return {
    summary: {
      contractFingerprint: report.contractFingerprint,
      inferenceStatus: effectiveInferenceStatus(contract, report),
      sourceInferenceStatus: contract?.inference?.status || null,
      mutationCount: report.mutations.length,
      detectedCount: report.detected.length,
      gapCount: report.undetected.length,
      detected: report.detected,
      gaps: report.undetected,
      coverage: report.coverage,
    },
    ...(includeReport ? { report } : {}),
  };
}

async function callTool(name, args = {}) {
  const runtime = await loadRuntime();

  if (name === "verify_data_transformation") {
    return runtime.compactVerificationResult(runtime.verify({
      original: args.original,
      transformed: args.transformed,
      format: args.format || "auto",
    }), { flaggedRowLimit: args.flagged_row_limit });
  }

  if (name === "infer_transformation_rule") {
    return runtime.infer({
      examples: parseJson(args.examples, "examples", runtime),
    });
  }

  if (name === "apply_transformation_rule") {
    return runtime.transform({
      rule: parseJson(args.rule, "rule", runtime),
      input: parseJson(args.input, "input", runtime),
    });
  }

  if (name === "detect_data_format") {
    runtime.assertTextLimit(args.text, "Text", runtime.SECURITY_LIMITS.maxDetectCharacters);
    return { format: runtime.detectFormat(args.text) };
  }

  if (name === "fingerprint_data") {
    const left = parseStructured(args.data, "Data", args.format, runtime);
    const leftFingerprint = runtime.fingerprint(left);
    const profile = runtime.profileStructure(left);
    if (args.compare_to === undefined || args.compare_to === null || args.compare_to === "") {
      return {
        fingerprint: leftFingerprint,
        profile,
        nonCryptographic: true,
      };
    }

    const right = parseStructured(args.compare_to, "Compare data", args.format, runtime);
    const diff = runtime.structuralDiff(left, right);
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

  if (name === "learn_transformation_contract") {
    const examples = parseJson(args.examples, "examples", runtime);
    const contract = runtime.learnContract({ examples }, { evidenceSource: "mcp-local-stdio" });
    const mutationReport = runtime.runTransformationMutationSuite(contract, {
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
      ...(args.include_contract === false ? {} : { contract }),
    };
  }

  if (name === "get_contract_challenges") {
    const contract = runtime.generateTransformationChallenges(parseJson(args.contract, "contract", runtime));
    const challenges = contract.challenges.filter(item => ["open", "deferred"].includes(item.status));
    return {
      summary: contractSummary(contract),
      challenges,
      humanApprovalCreated: false,
    };
  }

  if (name === "test_transformation_contract") {
    const contract = runtime.unwrapTransformationContract(parseJson(args.contract, "contract", runtime));
    const report = runtime.runTransformationMutationSuite(contract, {
      inputRecords: contract.evidence?.examples?.map(example => example.input) || [],
      outputRecords: contract.evidence?.examples?.map(example => example.output) || [],
      failedRecords: [],
    });
    return mutationResult(report, !!args.include_report, contract);
  }

  if (name === "run_transformation_contract") {
    runtime.assertTextLimit(args.input, "input");
    const report = runtime.runContract({
      contract: parseJson(args.contract, "contract", runtime),
      input: args.input,
      options: { privacySafe: !!args.privacy_safe },
    });
    return runtimeResult(report, args);
  }

  if (name === "check_transformation_contract") {
    runtime.assertTextLimit(args.input, "input");
    runtime.assertTextLimit(args.output, "output");
    const report = runtime.checkContract({
      contract: parseJson(args.contract, "contract", runtime),
      input: args.input,
      output: args.output,
      options: { privacySafe: !!args.privacy_safe },
    });
    return runtimeResult(report, args);
  }

  if (name === "compare_transformation_contracts") {
    const comparison = runtime.compareContracts(
      parseJson(args.baseline, "baseline", runtime),
      parseJson(args.candidate, "candidate", runtime),
    );
    const changes = args.include_changes === false
      ? []
      : comparison.changes.slice(0, DIFF_PATH_LIST_LIMIT);
    return {
      summary: {
        relation: comparison.relation,
        classification: comparison.classification,
        breaking: comparison.breaking,
        requiresReapproval: comparison.requiresReapproval,
        ...comparison.summary,
      },
      changes,
      omittedChanges: Math.max(0, comparison.changes.length - changes.length),
      validation: comparison.validation,
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toolErrorResult(error) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: error?.message || "Tool failed." }),
      },
    ],
    isError: true,
  };
}

async function handleSingleJsonRpc(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return jsonRpcError(null, -32600, "Invalid JSON-RPC message.");
  }

  const { method, params, id } = message;
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  if (!method && ("result" in message || "error" in message)) return null;
  if (!hasId) return null;

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
    try {
      const result = await callTool(params?.name, params?.arguments || {});
      return {
        jsonrpc: "2.0",
        id,
        result: textResult(result),
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: toolErrorResult(error),
      };
    }
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  return jsonRpcError(id, -32601, `Method not supported: ${method}`);
}

export async function handleJsonRpc(message) {
  if (!Array.isArray(message)) return handleSingleJsonRpc(message);
  if (message.length > MAX_JSON_RPC_BATCH_LENGTH) {
    return jsonRpcError(null, -32600, `JSON-RPC batch is too large. Limit is ${MAX_JSON_RPC_BATCH_LENGTH} requests.`);
  }
  const responses = (await Promise.all(message.map(handleSingleJsonRpc))).filter(Boolean);
  return responses.length ? responses : null;
}
