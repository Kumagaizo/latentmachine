import { deepEqual } from "../json-transform/shared.js";
import { validateTransformationContract } from "./schema.js";

const CATEGORY_ORDER = Object.freeze([
  "contract_compatibility",
  "evidence",
  "program_behavior",
  "preconditions_schema",
  "invariants",
  "runtime_policy",
  "metadata",
  "review_state",
  "review_context",
]);

const BREAKING_CATEGORIES = new Set([
  "contract_compatibility",
  "program_behavior",
  "preconditions_schema",
  "invariants",
  "runtime_policy",
]);

const CORE_CATEGORIES = new Set([
  "contract_compatibility",
  "evidence",
  "program_behavior",
  "preconditions_schema",
  "invariants",
  "runtime_policy",
]);

const ROOT_CATEGORIES = Object.freeze({
  kind: "contract_compatibility",
  contractVersion: "contract_compatibility",
  engine: "program_behavior",
  formats: "preconditions_schema",
  evidence: "evidence",
  input: "preconditions_schema",
  output: "preconditions_schema",
  program: "program_behavior",
  invariants: "invariants",
  runtimePolicy: "runtime_policy",
  title: "metadata",
  description: "metadata",
  metadata: "metadata",
  lifecycle: "review_state",
  approval: "review_state",
  inference: "review_context",
  challenges: "review_context",
  evidenceLinks: "review_context",
  extensions: "review_context",
});

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function pathForKey(path, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function differenceKind(beforePresent, afterPresent) {
  if (!beforePresent) return "added";
  if (!afterPresent) return "removed";
  return "changed";
}

function explanationFor(category, kind, path) {
  const action = kind === "added" ? "was added" : kind === "removed" ? "was removed" : "changed";
  if (category === "contract_compatibility") return `${path} ${action}; contract compatibility changed.`;
  if (category === "evidence") return `${path} ${action}; the reviewed evidence basis changed without itself changing executable operations.`;
  if (category === "program_behavior") return `${path} ${action}; deterministic program behavior or its engine version changed.`;
  if (category === "preconditions_schema") return `${path} ${action}; accepted input, output, or format expectations changed.`;
  if (category === "invariants") return `${path} ${action}; an enforced property changed.`;
  if (category === "runtime_policy") return `${path} ${action}; violation handling or approval policy changed.`;
  if (category === "metadata") return `${path} ${action}; human-facing metadata changed without changing the behavioral core.`;
  if (category === "review_state") return `${path} ${action}; lifecycle or approval state changed without changing the behavioral core.`;
  return `${path} ${action}; non-core review context changed.`;
}

function leafChange(category, path, before, after, beforePresent, afterPresent) {
  const kind = differenceKind(beforePresent, afterPresent);
  return {
    category,
    path,
    kind,
    breaking: BREAKING_CATEGORIES.has(category),
    requiresReapproval: CORE_CATEGORIES.has(category),
    beforePresent,
    afterPresent,
    before: beforePresent ? cloneJson(before) : null,
    after: afterPresent ? cloneJson(after) : null,
    explanation: explanationFor(category, kind, path),
  };
}

function diffValue(category, path, before, after, beforePresent = true, afterPresent = true) {
  if (beforePresent && afterPresent && deepEqual(before, after)) return [];
  if (!beforePresent || !afterPresent) {
    return [leafChange(category, path, before, after, beforePresent, afterPresent)];
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    return Array.from({ length }, (_, index) => diffValue(
      category,
      `${path}[${index}]`,
      before[index],
      after[index],
      index < before.length,
      index < after.length,
    )).flat();
  }
  const beforeObject = before && typeof before === "object" && !Array.isArray(before);
  const afterObject = after && typeof after === "object" && !Array.isArray(after);
  if (beforeObject && afterObject) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(compareText);
    return keys.flatMap(key => diffValue(
      category,
      pathForKey(path, key),
      before[key],
      after[key],
      Object.prototype.hasOwnProperty.call(before, key),
      Object.prototype.hasOwnProperty.call(after, key),
    ));
  }
  return [leafChange(category, path, before, after, true, true)];
}

function contractReference(contract) {
  return {
    contractId: contract?.identity?.contractId || null,
    coreFingerprint: contract?.identity?.coreFingerprint || null,
    programFingerprint: contract?.identity?.programFingerprint || null,
    evidenceFingerprint: contract?.identity?.evidenceFingerprint || null,
    revision: contract?.lifecycle?.revision ?? null,
    approvalState: contract?.lifecycle?.approvalState || null,
  };
}

function categoryCounts(changes) {
  return Object.fromEntries(
    CATEGORY_ORDER
      .map(category => [category, changes.filter(change => change.category === category).length])
      .filter(([, count]) => count > 0),
  );
}

function primaryClassification(changes) {
  if (!changes.length) return "identical";
  const coreCategories = new Set(changes
    .filter(change => CORE_CATEGORIES.has(change.category))
    .map(change => change.category));
  if (!coreCategories.size) {
    return changes.every(change => change.category === "metadata")
      ? "metadata_only"
      : "non_behavioral_change";
  }
  if (coreCategories.size === 1 && coreCategories.has("evidence")) return "evidence_only";
  return "behavioral_change";
}

function invalidComparison(baseline, candidate, baselineValidation, candidateValidation) {
  return {
    version: "transformation-contract-comparison/1",
    relation: "invalid_contract",
    classification: "invalid_contract",
    breaking: true,
    requiresReapproval: true,
    baseline: baseline?.identity ? cloneJson(contractReference(baseline)) : null,
    candidate: candidate?.identity ? cloneJson(contractReference(candidate)) : null,
    identities: {
      sameCore: false,
      sameProgram: false,
      sameEvidence: false,
    },
    categories: [],
    changes: [],
    summary: {
      totalChanges: 0,
      breakingChanges: 0,
      reapprovalChanges: 0,
      categoryCounts: {},
    },
    validation: {
      baseline: cloneJson(baselineValidation),
      candidate: cloneJson(candidateValidation),
    },
  };
}

function comparisonArguments(baselineOrInput, candidateInput) {
  if (
    candidateInput === undefined
    && baselineOrInput
    && typeof baselineOrInput === "object"
    && baselineOrInput.baseline
  ) {
    return {
      baseline: baselineOrInput.baseline,
      candidate: baselineOrInput.candidate,
    };
  }
  return { baseline: baselineOrInput, candidate: candidateInput };
}

export function compareContracts(baselineOrInput, candidateInput) {
  const { baseline, candidate } = comparisonArguments(baselineOrInput, candidateInput);
  const baselineValidation = validateTransformationContract(baseline);
  const candidateValidation = validateTransformationContract(candidate);
  if (!baselineValidation.ok || !candidateValidation.ok) {
    return invalidComparison(baseline, candidate, baselineValidation, candidateValidation);
  }

  const changes = Object.entries(ROOT_CATEGORIES)
    .flatMap(([root, category]) => diffValue(category, `$.${root}`, baseline[root], candidate[root]))
    .sort((left, right) => (
      CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category)
      || compareText(left.path, right.path)
      || compareText(left.kind, right.kind)
    ));
  const categories = CATEGORY_ORDER.filter(category => changes.some(change => change.category === category));
  const classification = primaryClassification(changes);
  const breakingChanges = changes.filter(change => change.breaking).length;
  const reapprovalChanges = changes.filter(change => change.requiresReapproval).length;

  return {
    version: "transformation-contract-comparison/1",
    relation: classification === "identical"
      ? "identical"
      : classification === "metadata_only" || classification === "non_behavioral_change"
        ? "non_behavioral_change"
        : "core_changed",
    classification,
    breaking: breakingChanges > 0,
    requiresReapproval: baseline.identity.coreFingerprint !== candidate.identity.coreFingerprint,
    baseline: contractReference(baseline),
    candidate: contractReference(candidate),
    identities: {
      sameCore: baseline.identity.coreFingerprint === candidate.identity.coreFingerprint,
      sameProgram: baseline.identity.programFingerprint === candidate.identity.programFingerprint,
      sameEvidence: baseline.identity.evidenceFingerprint === candidate.identity.evidenceFingerprint,
    },
    categories,
    changes,
    summary: {
      totalChanges: changes.length,
      breakingChanges,
      reapprovalChanges,
      categoryCounts: categoryCounts(changes),
    },
    validation: {
      baseline: { ok: true, errors: [], warnings: cloneJson(baselineValidation.warnings) },
      candidate: { ok: true, errors: [], warnings: cloneJson(candidateValidation.warnings) },
    },
  };
}

export const compareTransformationContracts = compareContracts;
