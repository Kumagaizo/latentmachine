import { executeJsonTransform } from "../../../src/intelligence/json-transform/runtime.js";
import { SECURITY_LIMITS, assertArrayLimit, assertSerializedLimit } from "./limits.js";

function resolveRuleArtifact(rule) {
  if (rule?.program) return rule;
  if (rule?.rule?.program) return rule.rule;
  if (rule?.result?.rule?.program) return rule.result.rule;
  throw new Error("Invalid rule. Provide a rule artifact from infer() or verify().");
}

/**
 * Apply an inferred rule artifact to one value or an array of values.
 *
 * @param {{ rule: object, input: unknown }} options
 * @returns {unknown} The deterministically transformed value or values.
 */
export function transform({ rule, input } = {}) {
  assertSerializedLimit(rule, "Rule");
  assertSerializedLimit(input, "Input");
  const artifact = resolveRuleArtifact(rule);
  if (Array.isArray(input)) {
    assertArrayLimit(input, "Input rows", SECURITY_LIMITS.maxTransformRows);
    return input.map((row) => executeJsonTransform(artifact.program, row));
  }
  return executeJsonTransform(artifact.program, input);
}
