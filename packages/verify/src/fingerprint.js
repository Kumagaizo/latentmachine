import {
  canonicalize as canonicalizeValue,
  fingerprint as fingerprintValue,
  formatPath,
  profileStructure as profileStructureValue,
  structuralDiff as structuralDiffValue,
} from "../../../src/intelligence/trace/engine.js";
import { assertSerializedLimit } from "./limits.js";

/** Return a stable, key-order-independent representation of a JSON value. */
export function canonicalize(value) {
  assertSerializedLimit(value, "Input data");
  return canonicalizeValue(value);
}

/** Compute a deterministic, non-cryptographic fingerprint for a JSON value. */
export function fingerprint(value) {
  assertSerializedLimit(value, "Input data");
  return fingerprintValue(value);
}

/** Summarize the paths, types, and collection shapes present in a value. */
export function profileStructure(value) {
  assertSerializedLimit(value, "Input data");
  return profileStructureValue(value);
}

/** Compare two JSON values and return path-level structural changes. */
export function structuralDiff(a, b) {
  assertSerializedLimit(a, "Input data A");
  assertSerializedLimit(b, "Input data B");
  const diff = structuralDiffValue(a, b);
  return {
    ...diff,
    status: Object.fromEntries(diff.status),
  };
}

export { formatPath };
