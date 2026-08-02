import { MEMORISATION_MINIMUM_ROWS, MEMORISATION_RATIO_THRESHOLD } from "./memorisation.js";

const CONFIDENCE_NOTE = "Evidence from exact fit, examples, ambiguity, schema drift, and guardrails. Not a probability.";
const CONTRADICTION_WARNING_TYPES = new Set([
  "same-input-conflict",
  "template-conflict",
  "value-map-conflict",
]);

function evidenceReason(kind, detail, caps = null) {
  return caps ? { kind, detail, caps } : { kind, detail };
}

export function reliabilityEvidenceFor({ built, warnings, tests, schemaDrift, memorisation }) {
  return {
    exactFit: built.exact,
    examplesProvided: tests.length,
    examplesMatched: tests.filter(test => test.passed).length,
    operations: built.program.ops.length,
    unexplainedPaths: built.unexplained,
    meaningfulAmbiguities: built.ambiguous,
    triagedAmbiguities: built.ambiguityTriage || [],
    schemaDrift,
    guardrails: warnings.map(warning => ({
      type: warning.type,
      field: warning.source || warning.op?.source || warning.op?.target || null,
      message: warning.message,
    })),
    memorisation,
  };
}

export function assessConfidence(evidence = {}) {
  const blockingSchema = evidence.schemaDrift?.blocking || [];
  const guardrails = evidence.guardrails || [];
  const unexplainedPaths = evidence.unexplainedPaths || [];
  const ambiguities = evidence.meaningfulAmbiguities || [];
  const memorisedTargets = evidence.memorisation?.memorisedTargets || [];
  const noBlocking = blockingSchema.length === 0 && guardrails.length === 0;
  const checkRows = [
    { passed: !!evidence.exactFit, reason: "examples reproduce exactly" },
    { passed: noBlocking, reason: "no blocking guardrails" },
    { passed: unexplainedPaths.length === 0, reason: "all output paths explained" },
    { passed: ambiguities.length === 0, reason: "no meaningful ambiguity" },
    { passed: (evidence.examplesProvided || 0) >= 2, reason: "at least two examples" },
    { passed: memorisedTargets.length === 0, reason: "no high-cardinality lookup was fitted" },
  ];
  const checks = {
    passed: checkRows.filter(row => row.passed).length,
    total: checkRows.length,
  };
  const reasons = [];

  if (!evidence.exactFit) {
    reasons.push(evidenceReason("not-exact", `${evidence.examplesMatched || 0}/${evidence.examplesProvided || 0} examples matched.`, "blocked"));
  } else if (!memorisedTargets.length) {
    reasons.push(evidenceReason("exact-fit", `${evidence.examplesMatched || 0}/${evidence.examplesProvided || 0} examples matched exactly.`));
  }

  if (memorisedTargets.length) {
    reasons.push(evidenceReason(
      "memorised-lookup",
      `${memorisedTargets.length} of ${(evidence.memorisation?.verifiedTargets || []).length + memorisedTargets.length} fields were fitted with high-cardinality lookup tables: ${memorisedTargets.join(", ")}.`,
      "unverified",
    ));
  }

  for (const item of blockingSchema) {
    reasons.push(evidenceReason("schema-drift", item.message || `${item.path || item.source || "Input"} changed shape.`, "unsafe"));
  }
  for (const item of guardrails) {
    reasons.push(evidenceReason("guardrail", item.message || `${item.field || item.type || "A guardrail"} triggered.`, "unsafe"));
  }
  for (const path of unexplainedPaths) {
    reasons.push(evidenceReason("unexplained-path", `${path} has no inferred rule.`, "needs-proof"));
  }
  for (const item of ambiguities) {
    reasons.push(evidenceReason("ambiguity", item.reason || `${item.target || "An output path"} has another plausible rule.`, "needs-proof"));
  }
  if ((evidence.examplesProvided || 0) < 2 && evidence.exactFit) {
    reasons.push(evidenceReason("single-example", "Only one example supports this rule.", "needs-proof"));
  }
  if (reasons.length === 1 && evidence.exactFit && noBlocking && !unexplainedPaths.length && !ambiguities.length && !memorisedTargets.length && (evidence.examplesProvided || 0) >= 2) {
    reasons.push(evidenceReason("proven", "No unresolved paths, meaningful ambiguities, or blocking guardrails."));
  }

  let label = "proven";
  if (!evidence.exactFit) label = "blocked";
  else if (!noBlocking) label = "unsafe";
  else if (unexplainedPaths.length || ambiguities.length) label = "needs-proof";
  else if (memorisedTargets.length) label = "unverified";
  else if ((evidence.examplesProvided || 0) < 2) label = "supported";

  const risk = label === "blocked" || label === "unsafe" ? "high" : label === "proven" ? "low" : "medium";
  return { label, risk, checks, reasons, note: CONFIDENCE_NOTE };
}

export function reliabilityFor({ status, confidence, evidence, risks }) {
  return {
    status,
    supportLabel: confidence.label,
    supportNote: CONFIDENCE_NOTE,
    confidence,
    evidence,
    risks,
  };
}

export function riskTypes({ status, warnings, ambiguous }) {
  const risks = new Set();
  if (status !== "safe") risks.add(status);
  for (const warning of warnings) risks.add(warning.type);
  if (ambiguous.length) risks.add("ambiguous-rule");
  return [...risks];
}

export function diagnosisStatus({ built, warnings, examples, memorisation }) {
  if (warnings.some(warning => CONTRADICTION_WARNING_TYPES.has(warning.type))) return "contradictory";
  if (!built.exact || built.unexplained.length) return "unsafe";
  if (warnings.length) return "unsafe";
  const unprovenGroupBy = examples.length < 2 && built.targetCandidates.some(row => (
    row.candidates.some(candidate => candidate.op?.op === "arrayGroupBy")
  ));
  if (unprovenGroupBy) return "insufficient";
  if (examples.length < 2 && built.ambiguous.length) return "insufficient";
  if (built.ambiguous.length) return "ambiguous";
  if (memorisation?.memorisedTargets?.length) return "unverified";
  return "safe";
}

function suggestedExamplesFor({ status, built, warnings }) {
  const suggestions = [];
  for (const warning of warnings) {
    if (warning.type === "same-input-conflict") {
      suggestions.push({
        type: "conflict",
        reason: "Keep one expected output for this input, or change the input so the examples describe distinct cases.",
        exampleIds: warning.exampleIds || [],
      });
    }
    if (warning.type === "template-conflict") {
      suggestions.push({
        type: "conflict",
        reason: "Resolve the contradictory wording or source value in the example outputs.",
        target: warning.op?.target || null,
      });
    }
    if (warning.type === "value-map-conflict") {
      suggestions.push({
        type: "conflict",
        reason: `Resolve the examples where ${warning.op?.source} maps to different values for ${warning.op?.target}.`,
        target: warning.op?.target || null,
        fields: [warning.op?.source].filter(Boolean),
      });
    }
    if (warning.type === "missing-source") {
      suggestions.push({
        type: "missing-source",
        reason: `Provide an input where ${warning.source} is present, or change the output so this field is not required.`,
        requiredField: warning.source,
        fields: [warning.source].filter(Boolean),
      });
    }
    if (warning.type === "unseen-value-map") {
      suggestions.push({
        type: "unseen-value",
        reason: `Add an example covering another value for ${warning.op?.source}.`,
        field: warning.op?.source || null,
        fields: [warning.op?.source].filter(Boolean),
      });
    }
    if (warning.type === "invalid-quantity") {
      suggestions.push({
        type: "invalid-quantity",
        reason: `Use the same resource quantity unit as the examples, or add an example that teaches ${warning.source}.`,
        field: warning.source || null,
        fields: [warning.source].filter(Boolean),
      });
    }
    if (warning.type === "invalid-array") {
      suggestions.push({
        type: "invalid-array",
        reason: `Provide ${warning.source} as an array, or add an example for the new shape.`,
        field: warning.source || null,
        fields: [warning.source].filter(Boolean),
      });
    }
    if (warning.type === "wrapped-s3-notification") {
      suggestions.push({
        type: "wrapped-s3-notification",
        reason: `Unwrap ${warning.source} into JSON first, then transform the inner S3 Records array.`,
        field: warning.source || null,
        fields: [warning.source].filter(Boolean),
      });
    }
    if (warning.type === "type-changed-source") {
      suggestions.push({
        type: "schema-drift",
        reason: `Add an example where ${warning.source} has type ${warning.actualTypes?.join(" or ") || "this new shape"}, or restore the original shape.`,
        field: warning.source || null,
        fields: [warning.source].filter(Boolean),
      });
    }
    if (warning.type === "phone-country-unproven") {
      suggestions.push({
        type: "phone-country-unproven",
        reason: `Add an example that shows the country code for ${warning.source}, or include the country code in the input.`,
        field: warning.source || null,
        fields: [warning.source].filter(Boolean),
      });
    }
    if (warning.type === "ambiguous-date" || warning.type === "invalid-date") {
      suggestions.push({
        type: warning.type,
        reason: `Add a date example for ${warning.source}, or use an ISO date like 2024-03-15.`,
        field: warning.source || null,
        fields: [warning.source].filter(Boolean),
      });
    }
    if (warning.type === "invalid-email") {
      suggestions.push({
        type: "invalid-email",
        reason: `Provide a valid email at ${warning.source}, or add an example for this new shape.`,
        field: warning.source || null,
        fields: [warning.source].filter(Boolean),
      });
    }
  }
  for (const ambiguity of built.ambiguous) {
    suggestions.push({
      type: "ambiguity",
      reason: ambiguity.suggestion || `Disambiguate ${ambiguity.selected} from ${ambiguity.alternative}.`,
      target: ambiguity.target,
      fields: ambiguity.distinguishFields || [],
      selected: ambiguity.selected,
      alternative: ambiguity.alternative,
      selectedReading: ambiguity.selectedReading,
      alternativeReading: ambiguity.alternativeReading,
    });
  }
  if (status === "insufficient" && !suggestions.length) {
    suggestions.push({ type: "insufficient", reason: "Add a second example with different values to prove the rule generalizes." });
  }
  for (const item of built.program?.ops || []) {
    if (!item.memorisation || item.memorisation.rowCount < MEMORISATION_MINIMUM_ROWS || item.memorisation.ratio < MEMORISATION_RATIO_THRESHOLD) continue;
    suggestions.push({
      type: "memorised-lookup",
      reason: `${item.target} was fitted from ${item.memorisation.tableEntries} lookup entries across ${item.memorisation.rowCount} rows. Provide examples that establish a reusable rule or explicitly constrain the allowed mapping.`,
      target: item.target,
      field: item.source,
      fields: [item.source, item.target].filter(Boolean),
    });
  }
  return suggestions;
}

export function buildDiagnosis({ status, built, warnings, tests, alternatives, examples, schemaDrift, memorisation }) {
  const contradictions = warnings
    .filter(warning => CONTRADICTION_WARNING_TYPES.has(warning.type))
    .map(warning => ({
      type: warning.type,
      field: warning.op?.target || null,
      message: warning.message,
      exampleIds: warning.exampleIds || [],
    }));
  const guardrails = warnings
    .filter(warning => !CONTRADICTION_WARNING_TYPES.has(warning.type))
    .map(warning => ({
      type: warning.type,
      field: warning.source || warning.op?.source || warning.op?.target || null,
      message: warning.message,
    }));
  return {
    status,
    examplesProvided: examples.length,
    examplesMatched: tests.filter(test => test.passed).length,
    contradictions,
    ambiguities: built.ambiguous,
    ambiguityTriage: built.ambiguityTriage || [],
    unexplained: built.unexplained,
    guardrails,
    schemaDrift,
    memorisation,
    suggestedExamples: suggestedExamplesFor({ status, built, warnings }),
    candidates: alternatives,
  };
}
