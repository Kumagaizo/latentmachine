import { executeJsonTransform } from "../../../src/intelligence/json-transform/runtime.js";
import { SECURITY_LIMITS, assertArrayLimit, assertSerializedLimit } from "./limits.js";

function resolveRuleArtifact(rule) {
  const artifact = rule?.program ? rule : rule?.rule?.program ? rule.rule : rule?.result?.rule?.program ? rule.result.rule : null;
  if (artifact?.executable === false) {
    throw new Error("This is a compact diagnostic rule without lookup bodies. Infer an executable rule before applying it.");
  }
  if (artifact) return artifact;
  throw new Error("Invalid rule. Provide an executable rule artifact from infer() or verify().");
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
