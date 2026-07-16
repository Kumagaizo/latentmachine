/**
 * Dependency-light MCP server core. It translates JSON-RPC tool calls into the
 * same deterministic engine exposed by @latentmachine/verify.
 */
const FORMAT_ENUM = ["auto", "json", "csv", "yaml", "toml", "xml", "env", "sql"];
export const MAX_JSON_RPC_LINE_CHARACTERS = 1_000_000;
export const MAX_JSON_RPC_BATCH_LENGTH = 4;
const DIFF_PATH_LIST_LIMIT = 100;

let runtimePromise;

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
      "Returns which rows are consistent and which broke the pattern.",
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
      "Requires a rule artifact from infer_transformation_rule or verify_data_transformation.",
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

async function callTool(name, args = {}) {
  const runtime = await loadRuntime();

  if (name === "verify_data_transformation") {
    return runtime.verify({
      original: args.original,
      transformed: args.transformed,
      format: args.format || "auto",
    });
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
