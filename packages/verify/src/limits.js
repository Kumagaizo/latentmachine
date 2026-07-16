/** Shared resource limits for the JavaScript, CLI, HTTP, and MCP surfaces. */
export const SECURITY_LIMITS = Object.freeze({
  maxRequestCharacters: 1_000_000,
  maxToolTextCharacters: 500_000,
  maxDetectCharacters: 100_000,
  maxSerializedCharacters: 750_000,
  maxRows: 5_000,
  maxExamples: 100,
  maxTransformRows: 5_000,
  maxMcpBatchLength: 4,
});

export function assertTextLimit(value, label, maxCharacters = SECURITY_LIMITS.maxToolTextCharacters) {
  if (typeof value !== "string") return;
  if (value.length > maxCharacters) {
    throw new Error(`${label} is too large. Limit is ${maxCharacters.toLocaleString("en-US")} characters.`);
  }
}

export function assertArrayLimit(value, label, maxItems) {
  if (!Array.isArray(value)) return;
  if (value.length > maxItems) {
    throw new Error(`${label} is too large. Limit is ${maxItems.toLocaleString("en-US")} items.`);
  }
}

export function assertSerializedLimit(value, label, maxCharacters = SECURITY_LIMITS.maxSerializedCharacters) {
  if (typeof value === "string") {
    assertTextLimit(value, label, maxCharacters);
    return;
  }

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON-serializable.`);
  }

  if (serialized && serialized.length > maxCharacters) {
    throw new Error(`${label} is too large. Serialized limit is ${maxCharacters.toLocaleString("en-US")} characters.`);
  }
}
