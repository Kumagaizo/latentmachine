/**
 * Public API for deterministic transformation verification, inference,
 * execution, structured-format parsing, and structural fingerprints.
 */
export { verify } from "./verify.js";
export { compactRuleArtifact, compactVerificationResult } from "./reporting.js";
export { infer } from "./infer.js";
export { transform } from "./transform.js";
export * from "./contracts.js";
export { canonicalize, fingerprint, formatPath, profileStructure, structuralDiff } from "./fingerprint.js";
export { SECURITY_LIMITS, assertArrayLimit, assertSerializedLimit, assertTextLimit } from "./limits.js";
export {
  detectFormat,
  formatLabel,
  FORMAT_ORDER,
  FORMATS,
  parseWithFormat,
  serializeWithFormat,
} from "./formats.js";
