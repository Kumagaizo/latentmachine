import { clone, getPath, setPath } from "../json-transform/core.js";
import { executeJsonTransform } from "../json-transform/runtime.js";
import { deepEqual, opSources } from "../json-transform/shared.js";
import { fingerprintTransformationChallenge } from "./identity.js";
import { validateTransformationContract } from "./schema.js";

const BLOCKING_SEVERITY = "blocking";

function compareText(a, b) {
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function unique(values) {
  return [...new Set(values.filter(value => typeof value === "string" && value))];
}

function suggestedChallengeKind(suggestion = {}) {
  if (["ambiguity", "conflict", "insufficient"].includes(suggestion.type)) return "candidate_disambiguation";
  if (suggestion.type === "missing-source") return "missing_source_behavior";
  if (suggestion.type === "unseen-value") return "unseen_value_behavior";
  if (suggestion.type === "ambiguous-date" || suggestion.type === "invalid-date") return "ambiguous_date_behavior";
  if (suggestion.type === "all-fallbacks-empty") return "empty_string_behavior";
  if (suggestion.type === "invalid-array") return "array_empty_behavior";
  return "candidate_disambiguation";
}

function candidateRow(contract, target) {
  return (contract.inference?.candidatesConsidered || []).find(row => row?.target === target) || null;
}

function operationIds(contract, target, paths) {
  return (contract.program?.ops || [])
    .map((operation, index) => ({ operation, index }))
    .filter(({ operation }) => (
      operation.target === target
      || opSources(operation).some(source => paths.includes(source))
    ))
    .map(({ index }) => `op_${index}`);
}

function candidateResult(contract, candidate, input, target) {
  const output = executeJsonTransform({
    version: contract.program.version,
    ops: [candidate.program],
  }, input);
  return {
    candidateId: candidate.id,
    title: candidate.title,
    operation: candidate.program.op,
    output: clone(output),
    targetValue: getPath(output, target) === undefined ? null : clone(getPath(output, target)),
  };
}

function evaluateCandidates(contract, candidates, input, target) {
  if (input === undefined || candidates.length < 2) return null;
  const results = candidates.slice(0, 2).map(candidate => candidateResult(contract, candidate, input, target));
  return {
    input: clone(input),
    results,
    distinguishes: !deepEqual(results[0].targetValue, results[1].targetValue),
  };
}

function probeValues(value) {
  if (typeof value === "string") {
    return ["probe  value", "  probe  value  ", "", "CHALLENGE-value"];
  }
  if (typeof value === "number") return [0, 1, -1, value + 1];
  if (typeof value === "boolean") return [!value];
  if (Array.isArray(value)) return [[], [...value, null]];
  if (value === null || value === undefined) return ["challenge", 1, false];
  if (typeof value === "object") return [{}, { ...value, challenge: true }];
  return ["challenge"];
}

function syntheticCandidateInput(contract, paths, candidates, target) {
  const base = clone(contract.evidence?.examples?.[0]?.input);
  if (base === undefined) return null;

  if (paths.length > 1) {
    const proposed = clone(base);
    paths.forEach((path, index) => setPath(proposed, path, `challenge-${index + 1}`));
    const evaluated = evaluateCandidates(contract, candidates, proposed, target);
    if (evaluated?.distinguishes) return evaluated;
  }

  for (const path of paths) {
    const current = getPath(base, path);
    for (const value of probeValues(current)) {
      const proposed = clone(base);
      setPath(proposed, path, value);
      const evaluated = evaluateCandidates(contract, candidates, proposed, target);
      if (evaluated?.distinguishes) return evaluated;
    }
  }
  return null;
}

function candidateProbe(contract, target, paths) {
  const row = candidateRow(contract, target);
  const candidates = row?.candidates || [];
  const supplied = contract.extensions?.latentmachine?.newInput;
  const suppliedEvaluation = evaluateCandidates(contract, candidates, supplied, target);
  if (suppliedEvaluation?.distinguishes) return suppliedEvaluation;
  return syntheticCandidateInput(contract, paths, candidates, target)
    || suppliedEvaluation
    || {
      input: clone(supplied ?? contract.evidence?.examples?.[0]?.input ?? null),
      results: [],
      distinguishes: false,
    };
}

function promptFor(kind, target, paths) {
  const path = paths[0] || target || "the affected field";
  if (kind === "candidate_disambiguation") return `What should the output be for ${target || "this transformation"} when the proposed input is used?`;
  if (kind === "missing_source_behavior") return `What should happen when ${path} is missing?`;
  if (kind === "unseen_value_behavior") return `What should the output be when ${path} contains the proposed unseen value?`;
  if (kind === "ambiguous_date_behavior") return `What should ${target || "the output"} be for the proposed ambiguous date at ${path}?`;
  if (kind === "empty_string_behavior") return `What should happen when ${path} is empty?`;
  if (kind === "array_empty_behavior") return `What should happen when ${path} is empty or is not an array?`;
  return `What should happen for ${path}?`;
}

function challengeFromSuggestion(contract, suggestion, index) {
  const kind = suggestedChallengeKind(suggestion);
  const suggestedSource = suggestion.field || suggestion.requiredField || null;
  const sourceOperation = suggestedSource
    ? (contract.program?.ops || []).find(operation => opSources(operation).includes(suggestedSource))
    : null;
  const target = suggestion.target || sourceOperation?.target || suggestedSource;
  const paths = unique([
    ...(suggestion.fields || []),
    suggestion.field,
    suggestion.requiredField,
    target,
  ]);
  const probePaths = unique([
    ...(suggestion.fields || []),
    suggestion.field,
    suggestion.requiredField,
    ...(!suggestion.fields?.length && !suggestion.field && !suggestion.requiredField && target ? [target] : []),
  ]);
  const probe = kind === "candidate_disambiguation"
    ? candidateProbe(contract, target, probePaths)
    : {
      input: clone(contract.extensions?.latentmachine?.newInput ?? contract.evidence?.examples?.[0]?.input ?? null),
      results: [],
      distinguishes: false,
    };
  const affectedOperations = operationIds(contract, target, paths);
  const row = candidateRow(contract, target);
  const seed = {
    kind,
    target,
    paths,
    affectedOperations,
    proposedInput: probe.input,
    suggestionType: suggestion.type || "diagnosis",
  };
  const fingerprint = fingerprintTransformationChallenge(contract, seed).hex;

  return {
    id: `challenge_${fingerprint.slice(0, 12)}`,
    kind,
    severity: BLOCKING_SEVERITY,
    status: "open",
    prompt: promptFor(kind, target, paths),
    reason: suggestion.reason || "The current evidence does not prove one safe behavior.",
    affectedOperations,
    affectedPaths: paths,
    proposedInput: probe.input,
    answerMode: "expected_output",
    choices: [],
    answer: null,
    candidateOutputs: probe.results,
    distinguishesCandidates: !!probe.distinguishes,
    candidatesDistinguished: probe.distinguishes ? Math.min(2, row?.candidates?.length || 0) : 0,
    priority: {
      blocksApproval: true,
      candidatesDistinguished: probe.distinguishes ? Math.min(2, row?.candidates?.length || 0) : 0,
      preventsRuntimeFailure: kind !== "candidate_disambiguation",
      responseEffort: 1,
      sourceIndex: index,
    },
    ...(kind === "unseen_value_behavior" ? { alternativeAnswerModes: ["policy"] } : {}),
  };
}

export function orderTransformationChallenges(challenges = []) {
  return [...challenges].sort((a, b) => (
    Number(b.severity === BLOCKING_SEVERITY) - Number(a.severity === BLOCKING_SEVERITY)
    || Number(b.status === "open") - Number(a.status === "open")
    || (b.priority?.candidatesDistinguished || 0) - (a.priority?.candidatesDistinguished || 0)
    || Number(!!b.priority?.preventsRuntimeFailure) - Number(!!a.priority?.preventsRuntimeFailure)
    || (a.priority?.responseEffort || 0) - (b.priority?.responseEffort || 0)
    || compareText(a.kind, b.kind)
    || compareText(a.id, b.id)
  ));
}

function appendTrace(extension = {}, events = []) {
  const previous = Array.isArray(extension.challengeTrace) ? extension.challengeTrace : [];
  const byKey = new Map(previous.map(event => [`${event.type}:${event.challengeId || ""}:${event.revision || ""}`, event]));
  for (const event of events) {
    byKey.set(`${event.type}:${event.challengeId || ""}:${event.revision || ""}`, event);
  }
  return {
    ...extension,
    challengeTrace: [...byKey.values()],
  };
}

export function withTransformationChallengeTrace(contract, events = []) {
  return {
    ...contract,
    extensions: {
      ...(contract.extensions || {}),
      latentmachine: appendTrace(contract.extensions?.latentmachine || {}, events),
    },
  };
}

export function generateTransformationChallenges(contract) {
  const initialValidation = validateTransformationContract(contract);
  if (!initialValidation.ok) {
    throw new Error(`Cannot generate challenges for an invalid contract: ${initialValidation.errors[0]?.message || "validation failed"}`);
  }

  const suggestions = contract.inference?.diagnosis?.suggestedExamples || [];
  const generated = suggestions.map((suggestion, index) => challengeFromSuggestion(contract, suggestion, index));
  const deduplicated = new Map();
  for (const challenge of generated) {
    const key = `${challenge.kind}:${challenge.affectedPaths.join("|")}`;
    if (!deduplicated.has(key)) deduplicated.set(key, challenge);
  }

  const historical = (contract.challenges || []).filter(challenge => challenge.status !== "open");
  const historicalIds = new Set(historical.map(challenge => challenge.id));
  const open = [...deduplicated.values()].filter(challenge => !historicalIds.has(challenge.id));
  const challenges = orderTransformationChallenges([...open, ...historical]);
  const traced = withTransformationChallengeTrace({
    ...contract,
    challenges,
  }, open.map(challenge => ({
    type: "challenge.generated",
    challengeId: challenge.id,
    revision: contract.lifecycle.revision,
    kind: challenge.kind,
  })));
  const validation = validateTransformationContract(traced);
  if (!validation.ok) {
    throw new Error(`Generated challenges failed contract validation: ${validation.errors[0]?.message || "validation failed"}`);
  }
  return traced;
}
