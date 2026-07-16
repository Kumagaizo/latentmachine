import { runTransform } from "../../../src/intelligence/json-transform/translator.js";
import { SECURITY_LIMITS, assertArrayLimit, assertSerializedLimit } from "./limits.js";

/**
 * Learn an inspectable deterministic rule from input/output example pairs.
 * Unsafe, contradictory, or ambiguous examples are returned as diagnoses
 * rather than silently resolved.
 *
 * @param {{ examples: Array<{ input: unknown, output: unknown }> }} options
 * @returns {object} Inference status, rule artifact, confidence, and diagnosis.
 */
export function infer({ examples } = {}) {
  assertArrayLimit(examples, "Examples", SECURITY_LIMITS.maxExamples);
  assertSerializedLimit(examples, "Examples");
  if (!Array.isArray(examples) || examples.length === 0) {
    throw new Error("Provide at least one { input, output } example.");
  }
  for (const example of examples) {
    if (!example || !("input" in example) || !("output" in example)) {
      throw new Error("Each example must have an input and an output property.");
    }
  }

  const result = runTransform({ examples });
  return {
    status: result.status,
    rule: result.rule || null,
    confidence: result.confidence || null,
    diagnosis: result.diagnosis || null,
    warnings: result.warnings || [],
  };
}
