import { buildTransformTask, runBuiltTransform } from "../json-transform/translator.js";
import { buildTransformationContract } from "./builder.js";
import {
  orderTransformationChallenges,
  withTransformationChallengeTrace,
} from "./challenges.js";
import { withTransformationContractIdentity } from "./identity.js";
import { validateTransformationContract } from "./schema.js";

const POLICY_VALUES = new Set([
  "allow",
  "warn",
  "quarantine",
  "block",
  "preserve",
  "allow-change",
]);

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function assertValidContract(contract) {
  const validation = validateTransformationContract(contract);
  if (!validation.ok) {
    throw new Error(`Cannot answer a challenge on an invalid contract: ${validation.errors[0]?.message || "validation failed"}`);
  }
}

function revisedLifecycle(contract, approvalState) {
  return {
    approvalState,
    revision: contract.lifecycle.revision + 1,
    supersedes: contract.identity.contractId,
  };
}

function answeredChallenge(challenge, answer) {
  return {
    ...cloneJson(challenge),
    status: "answered",
    answer: cloneJson(answer),
  };
}

function mergedChallenges(fresh, prior, answered) {
  const history = prior
    .filter(challenge => challenge.status !== "open" && challenge.id !== answered.id)
    .map(cloneJson);
  const freshOpen = fresh.filter(challenge => challenge.status === "open" && challenge.id !== answered.id);
  return orderTransformationChallenges([...freshOpen, ...history, answered]);
}

function evidenceId(contract, challenge) {
  const base = `evidence_${challenge.id.slice("challenge_".length)}`;
  const used = new Set(contract.evidence.examples.map(example => example.id));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function relearnFromEvidence(contract, challenge, expectedOutput) {
  if (challenge.proposedInput === undefined || challenge.proposedInput === null) {
    throw new Error("This challenge has no proposed input to turn into evidence.");
  }
  const addedExample = {
    id: evidenceId(contract, challenge),
    input: cloneJson(challenge.proposedInput),
    output: cloneJson(expectedOutput),
    correction: true,
    formats: {
      input: contract.formats.input,
      output: contract.formats.output,
    },
  };
  const evidence = [...contract.evidence.examples.map(cloneJson), addedExample];
  const learningInput = {
    examples: evidence.map(example => ({
      id: example.id,
      input: example.input,
      output: example.output,
      correction: example.correction,
    })),
    newInput: cloneJson(challenge.proposedInput),
    outputFormat: "json",
  };
  const task = buildTransformTask(learningInput);
  const result = runBuiltTransform(learningInput, task);
  task.examples = task.examples.map((example, index) => ({
    ...example,
    formats: cloneJson(evidence[index].formats || {
      input: contract.formats.input,
      output: contract.formats.output,
    }),
  }));
  task.newInputFormat = contract.formats.input;
  task.outputFormat = contract.formats.output;
  task.formats = {
    examples: task.examples.map(example => example.formats),
    newInput: contract.formats.input,
    output: contract.formats.output,
  };

  return buildTransformationContract({
    task,
    result,
    options: {
      title: contract.title,
      description: contract.description,
      evidenceSource: contract.evidence.source,
      extensions: contract.extensions,
      metadata: {
        ...(contract.metadata || {}),
        revisedBy: "answerChallenge",
      },
      lifecycle: {
        revision: contract.lifecycle.revision + 1,
        supersedes: contract.identity.contractId,
      },
    },
  });
}

function finalizeEvidenceRevision(contract, fresh, challenge, expectedOutput) {
  const answered = answeredChallenge(challenge, {
    mode: "expected_output",
    expectedOutput,
  });
  const challenges = mergedChallenges(fresh.challenges || [], contract.challenges || [], answered);
  const hasOpenBlocking = challenges.some(item => item.status === "open" && item.severity === "blocking");
  const approvalState = fresh.inference.status === "safe" && !hasOpenBlocking ? "unreviewed" : "review_required";
  const revised = withTransformationChallengeTrace({
    ...fresh,
    lifecycle: revisedLifecycle(contract, approvalState),
    challenges,
    approval: null,
  }, [
    {
      type: "challenge.answered",
      challengeId: challenge.id,
      revision: contract.lifecycle.revision + 1,
      mode: "expected_output",
    },
    {
      type: "contract.relearned",
      challengeId: challenge.id,
      revision: contract.lifecycle.revision + 1,
      fromContractId: contract.identity.contractId,
      toContractId: fresh.identity.contractId,
    },
  ]);
  assertValidContract(revised);
  return revised;
}

function policyRevision(contract, challenge, policy) {
  if (!POLICY_VALUES.has(policy)) {
    throw new Error(`Unsupported policy answer ${JSON.stringify(policy)}.`);
  }
  const answered = answeredChallenge(challenge, {
    mode: "policy",
    policy,
  });
  const challenges = orderTransformationChallenges([
    ...(contract.challenges || []).filter(item => item.id !== challenge.id).map(cloneJson),
    answered,
  ]);
  const hasOpenBlocking = challenges.some(item => item.status === "open" && item.severity === "blocking");
  const approvalState = contract.inference.status === "safe" && !hasOpenBlocking ? "unreviewed" : "review_required";
  const revisedCore = {
    ...cloneJson(contract),
    lifecycle: revisedLifecycle(contract, approvalState),
    runtimePolicy: {
      ...cloneJson(contract.runtimePolicy),
      policyAnswers: {
        ...(cloneJson(contract.runtimePolicy.policyAnswers) || {}),
        [challenge.id]: {
          kind: challenge.kind,
          value: policy,
        },
      },
    },
    challenges,
    approval: null,
  };
  const identified = withTransformationContractIdentity(revisedCore);
  const traced = withTransformationChallengeTrace(identified, [{
    type: "challenge.answered",
    challengeId: challenge.id,
    revision: contract.lifecycle.revision + 1,
    mode: "policy",
  }]);
  assertValidContract(traced);
  return traced;
}

export function answerChallenge(contract, challengeId, answer = {}) {
  assertValidContract(contract);
  const challenge = (contract.challenges || []).find(item => item.id === challengeId);
  if (!challenge) throw new Error(`Challenge ${challengeId} does not exist.`);
  if (challenge.status !== "open") throw new Error(`Challenge ${challengeId} is not open.`);

  if (Object.prototype.hasOwnProperty.call(answer, "expectedOutput")) {
    const fresh = relearnFromEvidence(contract, challenge, answer.expectedOutput);
    return finalizeEvidenceRevision(contract, fresh, challenge, answer.expectedOutput);
  }

  const policy = answer.policy ?? answer.choice;
  if (policy !== undefined && (
    challenge.answerMode === "policy"
    || challenge.answerMode === "choice"
    || challenge.alternativeAnswerModes?.includes("policy")
  )) {
    return policyRevision(contract, challenge, policy);
  }

  throw new Error("Answer requires expectedOutput, or an allowed policy answer for this challenge.");
}

export function deferChallenge(contract, challengeId) {
  assertValidContract(contract);
  const challenge = (contract.challenges || []).find(item => item.id === challengeId);
  if (!challenge) throw new Error(`Challenge ${challengeId} does not exist.`);
  if (challenge.status !== "open") throw new Error(`Challenge ${challengeId} is not open.`);

  const challenges = orderTransformationChallenges((contract.challenges || []).map(item => (
    item.id === challengeId
      ? { ...cloneJson(item), status: "deferred", answer: null }
      : cloneJson(item)
  )));
  const hasBlocking = challenges.some(item => (
    item.severity === "blocking"
    && (item.status === "open" || item.status === "deferred")
  ));
  const deferred = withTransformationChallengeTrace({
    ...cloneJson(contract),
    lifecycle: {
      ...cloneJson(contract.lifecycle),
      approvalState: hasBlocking || contract.inference.status !== "safe"
        ? "review_required"
        : "unreviewed",
    },
    challenges,
    approval: null,
  }, [{
    type: "challenge.deferred",
    challengeId,
    revision: contract.lifecycle.revision,
  }]);
  assertValidContract(deferred);
  return deferred;
}

export const answerTransformationChallenge = answerChallenge;
export const deferTransformationChallenge = deferChallenge;
