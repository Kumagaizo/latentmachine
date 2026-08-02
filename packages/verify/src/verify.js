import { detectFormat, parseWithFormat } from "../../../src/intelligence/data-formats/index.js";
import { inferVerifyRule } from "../../../src/intelligence/json-transform/verify-inference.js";
import { memorisationSummary } from "../../../src/intelligence/json-transform/memorisation.js";
import { INFERENCE_EXAMPLE_LIMIT } from "../../../src/intelligence/json-transform/program-builder.js";
import { SECURITY_LIMITS, assertArrayLimit, assertSerializedLimit, assertTextLimit } from "./limits.js";

function normalizeRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return [parsed];
  return parsed;
}

function parseRows(value, format) {
  assertTextLimit(value, "Input data");
  if (typeof value !== "string") return value;
  return parseWithFormat(value, format);
}

/**
 * Infer the dominant transformation in two aligned datasets and report rows
 * that do not follow it.
 *
 * @param {{ original: unknown, transformed: unknown, format?: string, legacyVerdict?: boolean }} options
 * @returns {object} A verdict, row counts, flagged rows, and the inferred rule.
 */
export function verify({ original, transformed, format = "auto", legacyVerdict = false } = {}) {
  const originalRows = normalizeRows(parseRows(original, format));
  const transformedRows = normalizeRows(parseRows(transformed, format));
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
  const memorisation = result.result?.rule?.memorisation || result.result?.memorisation || null;
  const unverifiableTargets = memorisation?.unverifiableTargets || memorisation?.memorisedTargets || [];
  const hasUnverifiableTargets = unverifiableTargets.length > 0;
  const actualVerdict = result.flagged.length > 0
    ? "inconsistent"
    : hasUnverifiableTargets ? "unverifiable" : "consistent";
  const verdict = legacyVerdict && actualVerdict === "unverifiable" ? "consistent" : actualVerdict;
  if (legacyVerdict && actualVerdict === "unverifiable") {
    console.warn(`legacyVerdict is deprecated: mapped unverifiable to consistent for ${unverifiableTargets.join(", ")}.`);
  }

  return {
    verdict,
    ...(legacyVerdict && actualVerdict !== verdict ? { actualVerdict } : {}),
    totalRows: originalRows.length,
    inference: {
      strategy: "bounded-output-aware",
      maximumEvidenceRows: INFERENCE_EXAMPLE_LIMIT,
      sampled: originalRows.length > INFERENCE_EXAMPLE_LIMIT,
      validationRows: originalRows.length,
    },
    matchedRows: result.matched,
    flaggedRows: result.flagged.map((flag) => ({
      index: flag.i,
      input: flag.input,
      expected: flag.predicted,
      actual: flag.actual,
    })),
    rule: result.result?.rule || null,
    ruleStatus: result.result?.status || "unknown",
    confidence: result.result?.confidence || null,
    memorisation,
    nearFit: memorisation?.nearFits?.[0] || null,
    summary: actualVerdict === "unverifiable"
      ? memorisationSummary(memorisation)
      : actualVerdict === "consistent"
        ? `${originalRows.length} rows followed one reusable deterministic rule.`
        : `${result.flagged.length} of ${originalRows.length} rows contradicted the inferred rule.`,
    detectedFormats: {
      original: typeof original === "string" ? detectFormat(original) : "json",
      transformed: typeof transformed === "string" ? detectFormat(transformed) : "json",
    },
  };
}
