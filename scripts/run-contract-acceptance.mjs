import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TRANSFORMATION_CONTRACT_FINGERPRINT,
  TRANSFORMATION_CONTRACT_KIND,
  TRANSFORMATION_CONTRACT_VERSION,
  acceptTransformationInvariants,
  approveContract,
  answerChallenge,
  checkContract,
  compareContracts,
  deferChallenge,
  deriveTransformationContractIdentity,
  evaluateTransformationInvariants,
  generateTransformationMutations,
  inferInputSchema,
  inferOutputSchema,
  learnContract,
  revokeContract,
  runContract,
  runTransformationMutationSuite,
  suggestTransformationInvariants,
  supersedeContract,
  validateTransformationContract,
  withTransformationContractIdentity,
} from "../src/intelligence/contracts/index.js";
import { executeJsonTransform } from "../src/intelligence/json-transform/engine.js";
import { buildTransformTask, runTransform } from "../src/intelligence/json-transform/translator.js";
import { infer as inferPublic } from "../packages/verify/src/infer.js";
import { transform as transformPublic } from "../packages/verify/src/transform.js";

function readFixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`../fixtures/contracts/${name}`, import.meta.url), "utf8"));
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reverseObjectKeys(item)]),
  );
}

function stablePublicInference(result) {
  const stable = JSON.parse(JSON.stringify(result));
  if (stable.rule) delete stable.rule.createdAt;
  return stable;
}

const cases = [
  {
    id: "safe-fixture-validates",
    run() {
      const contract = readFixture("safe-v1.json");
      const validation = validateTransformationContract(contract);
      assert.equal(validation.ok, true, JSON.stringify(validation.errors));
      assert.equal(contract.kind, TRANSFORMATION_CONTRACT_KIND);
      assert.equal(contract.contractVersion, TRANSFORMATION_CONTRACT_VERSION);
    },
  },
  {
    id: "unsupported-major-fails-closed",
    run() {
      const validation = validateTransformationContract(readFixture("unsupported-v2.json"));
      assert.equal(validation.ok, false);
      assert.ok(validation.errors.some(error => (
        error.path === "$.contractVersion"
        && error.code === "unsupported-major-version"
        && typeof error.message === "string"
      )));
    },
  },
  {
    id: "key-order-is-canonical",
    run() {
      const contract = readFixture("safe-v1.json");
      assert.deepEqual(
        deriveTransformationContractIdentity(reverseObjectKeys(contract)),
        deriveTransformationContractIdentity(contract),
      );
    },
  },
  {
    id: "metadata-does-not-change-behavioral-identity",
    run() {
      const baseline = readFixture("safe-v1.json");
      const edited = readFixture("metadata-only-edit-v1.json");
      assert.equal(validateTransformationContract(edited).ok, true);
      assert.equal(edited.identity.coreFingerprint, baseline.identity.coreFingerprint);
      assert.equal(edited.identity.programFingerprint, baseline.identity.programFingerprint);
      assert.equal(edited.identity.evidenceFingerprint, baseline.identity.evidenceFingerprint);
    },
  },
  {
    id: "behavior-change-invalidates-identity",
    run() {
      const baseline = readFixture("safe-v1.json");
      const changed = readFixture("behavior-change-v1.json");
      assert.equal(validateTransformationContract(changed).ok, true);
      assert.notEqual(changed.identity.contractId, baseline.identity.contractId);
      assert.notEqual(changed.identity.coreFingerprint, baseline.identity.coreFingerprint);
      assert.notEqual(changed.identity.programFingerprint, baseline.identity.programFingerprint);
      assert.notEqual(changed.identity.evidenceFingerprint, baseline.identity.evidenceFingerprint);
    },
  },
  {
    id: "identity-tampering-is-rejected",
    run() {
      const contract = readFixture("safe-v1.json");
      contract.program.ops[0].source = "$.last";
      const validation = validateTransformationContract(contract);
      assert.equal(validation.ok, false);
      assert.ok(validation.errors.some(error => error.code === "identity-mismatch"));
    },
  },
  {
    id: "round-trip-and-extensions-are-safe",
    run() {
      const contract = readFixture("safe-v1.json");
      const serializedBefore = JSON.stringify(contract);
      const roundTripped = JSON.parse(serializedBefore);
      assert.equal(validateTransformationContract(roundTripped).ok, true);
      assert.deepEqual(roundTripped.extensions.fixtureExtension, { preserved: true });
      assert.equal(JSON.stringify(contract), serializedBefore, "validation must not mutate the contract");

      roundTripped.futureBehavior = { enabled: true };
      const unknownTopLevel = validateTransformationContract(roundTripped);
      assert.ok(unknownTopLevel.errors.some(error => error.code === "unknown-top-level-field"));
    },
  },
  {
    id: "review-schemas-are-bounded",
    run() {
      const contract = readFixture("safe-v1.json");
      contract.invariants = [{
        id: "inv_name_required",
        kind: "required_path",
        scope: "record",
        severity: "blocking",
        parameters: { subject: "input", path: "$.name" },
      }];
      contract.challenges = [{
        id: "challenge_null_name",
        kind: "null_behavior",
        severity: "advisory",
        status: "open",
        prompt: "What should happen when the source name is null?",
        reason: "No supplied example contains a null name.",
        affectedOperations: ["op_0"],
        affectedPaths: ["$.first", "$.name"],
        answerMode: "expected_output",
        choices: [],
        answer: null,
      }];
      assert.equal(validateTransformationContract(contract, { verifyIdentity: false }).ok, true);

      contract.invariants[0].scope = "batch";
      contract.challenges[0].status = "answered";
      contract.evidenceLinks[0].exampleIds.push("missing-example");
      const invalid = validateTransformationContract(contract, { verifyIdentity: false });
      assert.equal(invalid.ok, false);
      for (const code of ["invariant-scope-mismatch", "answer-required", "unknown-example-reference"]) {
        assert.ok(invalid.errors.some(error => error.code === code), `expected ${code}`);
      }
    },
  },
  {
    id: "approval-is-bound-and-auditable",
    run() {
      const approved = readFixture("safe-v1.json");
      approved.lifecycle.approvalState = "approved";
      approved.approval = {
        method: "local-human-review",
        state: "approved",
        approvedCoreFingerprint: approved.identity.coreFingerprint,
        acknowledgedChallenges: [],
        note: "Fixture approval.",
      };
      assert.equal(validateTransformationContract(approved).ok, true);

      approved.lifecycle.approvalState = "superseded";
      assert.equal(validateTransformationContract(approved).ok, true, "historical approval should remain auditable");

      approved.program.ops[0].source = "$.last";
      const stale = validateTransformationContract(approved);
      assert.ok(stale.errors.some(error => error.code === "approval-fingerprint-mismatch"));
    },
  },
  {
    id: "fingerprints-are-not-security-signatures",
    run() {
      assert.equal(TRANSFORMATION_CONTRACT_FINGERPRINT.algorithm, "fnv1a-64-pair");
      assert.equal(TRANSFORMATION_CONTRACT_FINGERPRINT.bits, 64);
      assert.equal(TRANSFORMATION_CONTRACT_FINGERPRINT.cryptographic, false);
    },
  },
];

const learningFixture = readFixture("learning-cases.json");
const challengeFixture = readFixture("challenge-cases.json");
const invariantFixture = readFixture("invariant-cases.json");
const approvalComparisonFixture = readFixture("approval-comparison-cases.json");
const runtimeFixtureNames = [
  "runtime-pass.json",
  "runtime-missing-field.json",
  "runtime-unseen-value.json",
  "runtime-extra-output.json",
  "runtime-dropped-row.json",
  "runtime-duplicate-key.json",
  "runtime-reordered-keyed-rows.json",
  "runtime-quarantine-mixed.json",
];

function learnedInvariantContract() {
  const learned = learnContract(invariantFixture.task);
  const selectedIds = learned.extensions.latentmachine.invariantSuggestions
    .filter(item => invariantFixture.acceptedKinds.includes(item.kind))
    .map(item => item.id);
  return {
    learned,
    accepted: acceptTransformationInvariants(learned, selectedIds),
  };
}

function approvedRuntimeContract() {
  const learned = learnContract(invariantFixture.task);
  const suggestionIds = learned.extensions.latentmachine.invariantSuggestions
    .map(item => item.id);
  const guarded = acceptTransformationInvariants(learned, [
    ...suggestionIds,
    {
      id: "inv_runtime_key_set",
      kind: "key_set_preserved",
      scope: "batch",
      severity: "blocking",
      parameters: {
        inputKeyPath: "$.id",
        outputKeyPath: "$.customerId",
      },
    },
    {
      id: "inv_runtime_input_key_unique",
      kind: "key_unique",
      scope: "batch",
      severity: "blocking",
      parameters: {
        subject: "input",
        keyPath: "$.id",
      },
    },
    {
      id: "inv_runtime_output_key_unique",
      kind: "no_duplicate_output_keys",
      scope: "batch",
      severity: "blocking",
      parameters: {
        keyPath: "$.customerId",
      },
    },
  ]);
  return approveContract(guarded, {
    coreFingerprint: guarded.identity.coreFingerprint,
    note: "Approved M5 runtime fixture.",
  });
}

function revisedFixtureContract(baseline, edit) {
  const candidate = JSON.parse(JSON.stringify(baseline));
  edit(candidate);
  candidate.lifecycle = {
    approvalState: "unreviewed",
    revision: baseline.lifecycle.revision + 1,
    supersedes: baseline.identity.contractId,
  };
  candidate.approval = null;
  return withTransformationContractIdentity(candidate);
}

function comparisonCandidate(variant) {
  const baseline = readFixture("safe-v1.json");
  if (variant === "identical") return JSON.parse(JSON.stringify(baseline));
  if (variant === "metadata-fixture") return readFixture("metadata-only-edit-v1.json");
  if (variant === "behavior-fixture") return readFixture("behavior-change-v1.json");
  if (variant === "evidence-only") {
    return revisedFixtureContract(baseline, candidate => {
      candidate.evidence.examples[0].input.first = "Katherine";
      candidate.evidence.examples[0].output.name = "Katherine";
      candidate.evidence.examples[1].input.first = "Dorothy";
      candidate.evidence.examples[1].output.name = "Dorothy";
    });
  }
  if (variant === "schema") {
    return revisedFixtureContract(baseline, candidate => {
      candidate.input.unknownFieldPolicy = "warn";
    });
  }
  if (variant === "invariants") {
    return acceptTransformationInvariants(baseline, [{
      id: "inv_first_required",
      kind: "required_path",
      scope: "record",
      severity: "blocking",
      parameters: { subject: "input", path: "$.first" },
    }]);
  }
  if (variant === "runtime-policy") {
    return revisedFixtureContract(baseline, candidate => {
      candidate.runtimePolicy.onRecordViolation = "warn";
    });
  }
  throw new Error(`Unknown comparison fixture variant ${variant}.`);
}

for (const learningCase of learningFixture.statusCases) {
  cases.push({
    id: learningCase.id,
    run() {
      const source = runTransform(learningCase.task);
      const contract = learnContract(learningCase.task);
      const validation = validateTransformationContract(contract);
      assert.equal(validation.ok, true, JSON.stringify(validation.errors));
      assert.equal(contract.inference.status, learningCase.expectedStatus);
      assert.equal(contract.lifecycle.approvalState, learningCase.expectedApprovalState);
      assert.equal(contract.approval, null);
      assert.equal(contract.runtimePolicy.requireApproval, true);
      assert.deepEqual(contract.program.ops.map(operation => operation.op), learningCase.expectedOperationKinds);
      assert.deepEqual(contract.inference.confidence, source.confidence);
      assert.deepEqual(contract.inference.diagnosis, source.diagnosis);
      assert.deepEqual(contract.inference.reliability, source.reliability);
      assert.equal(contract.evidence.count, contract.evidence.examples.length);
      if (source.status === "safe") {
        const task = buildTransformTask(learningCase.task);
        assert.deepEqual(transformPublic({ rule: contract, input: task.newInput }), source.output);
      }
    },
  });
}

for (const formatCase of learningFixture.formatCases) {
  cases.push({
    id: formatCase.id,
    run() {
      const task = buildTransformTask(formatCase.task);
      const source = runTransform(formatCase.task);
      const contract = learnContract(formatCase.task);
      const validation = validateTransformationContract(contract);
      assert.equal(validation.ok, true, JSON.stringify(validation.errors));
      assert.equal(contract.inference.status, "safe");
      assert.equal(contract.lifecycle.approvalState, "unreviewed");
      assert.equal(contract.formats.input, formatCase.expectedInputFormat);
      assert.equal(contract.formats.output, formatCase.expectedOutputFormat);
      assert.deepEqual(contract.program.ops.map(operation => operation.op), formatCase.expectedOperationKinds);
      assert.deepEqual(executeJsonTransform(contract.program, task.newInput), source.output);
      if (!Array.isArray(task.newInput)) {
        assert.deepEqual(transformPublic({ rule: contract, input: task.newInput }), source.output);
      }
      assert.ok(contract.evidence.examples.every(example => example.formats.input === formatCase.expectedInputFormat));
      assert.ok(contract.evidence.examples.every(example => example.formats.output === formatCase.expectedOutputFormat));
    },
  });
}

cases.push(
  {
    id: "learn-contract-is-deterministic-and-non-mutating",
    run() {
      const task = JSON.parse(JSON.stringify(learningFixture.statusCases[0].task));
      const snapshot = JSON.stringify(task);
      const first = learnContract(task);
      const second = learnContract(task);
      assert.deepEqual(first, second);
      assert.equal(JSON.stringify(task), snapshot);
      assert.deepEqual(first.identity, deriveTransformationContractIdentity(first));
    },
  },
  {
    id: "learn-contract-normalizes-evidence-identities",
    run() {
      const contract = learnContract({
        examples: [
          { id: "provided", input: { first: "Ada" }, output: { name: "Ada" } },
          { id: "provided", input: { first: "Grace" }, output: { name: "Grace" } },
        ],
      });
      assert.deepEqual(contract.evidence.examples.map(example => example.id), ["provided", "provided-2"]);
      assert.deepEqual(contract.evidenceLinks[0].exampleIds, ["provided", "provided-2"]);
      assert.equal(validateTransformationContract(contract).ok, true);
    },
  },
  {
    id: "learned-schemas-merge-observed-shapes",
    run() {
      const examples = [
        { input: { id: 1, note: "ready", nested: { value: 1 } }, output: { key: 1, label: "ready" } },
        { input: { id: 2, active: true, nested: { value: 2.5 } }, output: { key: 2 } },
      ];
      const inputSchema = inferInputSchema(examples);
      const outputSchema = inferOutputSchema(examples);
      assert.deepEqual(inputSchema.required, ["id", "nested"]);
      assert.deepEqual(Object.keys(inputSchema.properties), ["active", "id", "nested", "note"]);
      assert.equal(inputSchema.properties.nested.properties.value.type, "number");
      assert.equal(inputSchema.additionalProperties, true);
      assert.deepEqual(outputSchema.required, ["key"]);
      assert.equal(outputSchema.additionalProperties, false);
    },
  },
  {
    id: "existing-public-infer-remains-unchanged",
    run() {
      const examples = learningFixture.statusCases[0].task.examples;
      const before = stablePublicInference(inferPublic({ examples }));
      learnContract({ examples });
      const after = stablePublicInference(inferPublic({ examples }));
      assert.deepEqual(after, before);
    },
  },
);

for (const challengeCase of challengeFixture.evidenceCases) {
  cases.push({
    id: challengeCase.id,
    run() {
      const taskSnapshot = JSON.stringify(challengeCase.task);
      const initial = learnContract(challengeCase.task);
      const repeated = learnContract(challengeCase.task);
      assert.equal(initial.inference.status, challengeCase.expectedInitialStatus);
      assert.deepEqual(initial.challenges.map(challenge => challenge.id), repeated.challenges.map(challenge => challenge.id));
      const challenge = initial.challenges.find(item => item.kind === challengeCase.expectedChallengeKind);
      assert.ok(challenge, `expected ${challengeCase.expectedChallengeKind}`);
      assert.equal(challenge.severity, "blocking");
      assert.equal(challenge.status, "open");
      if (challenge.kind === "candidate_disambiguation") {
        assert.equal(challenge.distinguishesCandidates, true);
        assert.equal(challenge.candidateOutputs.length, 2);
        assert.notDeepEqual(challenge.candidateOutputs[0].targetValue, challenge.candidateOutputs[1].targetValue);
      }

      const revised = answerChallenge(initial, challenge.id, challengeCase.answer);
      assert.equal(revised.inference.status, challengeCase.expectedFinalStatus);
      assert.equal(revised.lifecycle.revision, initial.lifecycle.revision + 1);
      assert.equal(revised.lifecycle.supersedes, initial.identity.contractId);
      assert.equal(revised.approval, null);
      assert.equal(revised.evidence.count, initial.evidence.count + 1);
      assert.notEqual(revised.identity.coreFingerprint, initial.identity.coreFingerprint);
      assert.ok(revised.challenges.some(item => item.id === challenge.id && item.status === "answered"));
      assert.ok(revised.extensions.latentmachine.challengeTrace.some(event => event.type === "challenge.answered"));
      assert.ok(revised.extensions.latentmachine.challengeTrace.some(event => event.type === "contract.relearned"));
      assert.equal(validateTransformationContract(revised).ok, true);
      if (challengeCase.expectedFinalOperation) {
        for (const [key, value] of Object.entries(challengeCase.expectedFinalOperation)) {
          assert.deepEqual(revised.program.ops[0][key], value, `expected operation ${key}`);
        }
      }
      assert.equal(JSON.stringify(challengeCase.task), taskSnapshot);
    },
  });
}

for (const challengeCase of challengeFixture.policyCases) {
  cases.push({
    id: challengeCase.id,
    run() {
      const initial = learnContract(challengeCase.task);
      const challenge = initial.challenges.find(item => item.kind === challengeCase.expectedChallengeKind);
      assert.ok(challenge);
      const revised = answerChallenge(initial, challenge.id, { policy: challengeCase.policy });
      assert.equal(revised.evidence.count, initial.evidence.count, "policy answers must not become evidence");
      assert.equal(revised.identity.programFingerprint, initial.identity.programFingerprint);
      assert.notEqual(revised.identity.coreFingerprint, initial.identity.coreFingerprint);
      assert.deepEqual(revised.runtimePolicy.policyAnswers[challenge.id], {
        kind: challenge.kind,
        value: challengeCase.policy,
      });
      assert.deepEqual(revised.challenges.find(item => item.id === challenge.id).answer, {
        mode: "policy",
        policy: challengeCase.policy,
      });
      assert.equal(revised.lifecycle.revision, initial.lifecycle.revision + 1);
      assert.equal(validateTransformationContract(revised).ok, true);
    },
  });
}

cases.push(
  {
    id: "challenge-ordering-is-deterministic",
    run() {
      const dateCase = challengeFixture.evidenceCases.find(item => item.id === "challenge-ambiguous-date-evidence");
      const first = learnContract(dateCase.task);
      const second = learnContract(dateCase.task);
      assert.deepEqual(first.challenges, second.challenges);
      assert.equal(first.challenges[0].kind, "candidate_disambiguation");
      assert.equal(first.challenges[0].distinguishesCandidates, true);
      const dateChallenge = first.challenges.find(challenge => challenge.kind === "ambiguous_date_behavior");
      assert.ok(dateChallenge);
      assert.equal(dateChallenge.severity, "blocking");
      assert.deepEqual(dateChallenge.proposedInput, dateCase.task.newInput);
      assert.match(dateChallenge.prompt, /\$\.created_at/);
    },
  },
  {
    id: "challenge-answer-invalidates-prior-approval",
    run() {
      const approved = learnContract(learningFixture.statusCases[0].task);
      const challenge = {
        id: "challenge_output_policy",
        kind: "unknown_output_field_policy",
        severity: "advisory",
        status: "open",
        prompt: "How should unknown output fields be handled?",
        reason: "Approval should record the chosen output policy.",
        affectedOperations: [],
        affectedPaths: ["$"],
        proposedInput: null,
        answerMode: "policy",
        choices: ["allow", "warn", "block"],
        answer: null,
      };
      approved.challenges = [challenge];
      approved.lifecycle.approvalState = "approved";
      approved.approval = {
        method: "local-human-review",
        state: "approved",
        approvedCoreFingerprint: approved.identity.coreFingerprint,
        acknowledgedChallenges: [challenge.id],
        note: "Approval before policy answer.",
      };
      assert.equal(validateTransformationContract(approved).ok, true);

      const revised = answerChallenge(approved, challenge.id, { policy: "block" });
      assert.equal(revised.approval, null);
      assert.equal(revised.lifecycle.approvalState, "unreviewed");
      assert.equal(revised.lifecycle.revision, 2);
      assert.notEqual(revised.identity.coreFingerprint, approved.identity.coreFingerprint);
    },
  },
  {
    id: "challenge-answer-errors-fail-closed",
    run() {
      const initial = learnContract(challengeFixture.evidenceCases[0].task);
      const challenge = initial.challenges[0];
      const snapshot = JSON.stringify(initial);
      assert.throws(() => answerChallenge(initial, "challenge_missing", { expectedOutput: {} }), /does not exist/);
      assert.throws(() => answerChallenge(initial, challenge.id, {}), /requires expectedOutput/);
      assert.throws(() => answerChallenge(initial, challenge.id, { policy: "invent-program" }), /requires expectedOutput/);
      assert.equal(JSON.stringify(initial), snapshot);
    },
  },
);

cases.push(
  {
    id: "invariant-suggestions-are-deterministic-and-non-core",
    run() {
      const first = learnContract(invariantFixture.task);
      const second = learnContract(invariantFixture.task);
      assert.deepEqual(
        first.extensions.latentmachine.invariantSuggestions,
        second.extensions.latentmachine.invariantSuggestions,
      );
      assert.deepEqual(
        suggestTransformationInvariants(first),
        first.extensions.latentmachine.invariantSuggestions,
      );
      const edited = JSON.parse(JSON.stringify(first));
      edited.extensions.latentmachine.invariantSuggestions = [];
      assert.equal(
        deriveTransformationContractIdentity(edited).coreFingerprint,
        first.identity.coreFingerprint,
      );
    },
  },
  {
    id: "accepted-invariants-create-a-reviewable-revision",
    run() {
      const { learned, accepted } = learnedInvariantContract();
      assert.equal(validateTransformationContract(accepted).ok, true);
      assert.equal(accepted.lifecycle.revision, learned.lifecycle.revision + 1);
      assert.equal(accepted.lifecycle.supersedes, learned.identity.contractId);
      assert.equal(accepted.approval, null);
      assert.notEqual(accepted.identity.coreFingerprint, learned.identity.coreFingerprint);
      assert.equal(accepted.identity.programFingerprint, learned.identity.programFingerprint);
      assert.deepEqual(
        [...new Set(accepted.invariants.map(item => item.kind))].sort(),
        [...invariantFixture.acceptedKinds].sort(),
      );
    },
  },
  {
    id: "invalid-and-contradictory-invariants-fail-closed",
    run() {
      const learned = learnContract(invariantFixture.task);
      const invalid = withTransformationContractIdentity({
        ...learned,
        invariants: [{
          id: "inv_invalid_required",
          kind: "required_path",
          scope: "record",
          severity: "blocking",
          parameters: { path: "$.id", executable: "return true" },
        }],
      });
      const invalidValidation = validateTransformationContract(invalid);
      assert.equal(invalidValidation.ok, false);
      assert.ok(invalidValidation.errors.some(error => error.code === "invalid-invariant-subject"));
      assert.ok(invalidValidation.errors.some(error => error.code === "unknown-invariant-parameter"));
      assert.throws(
        () => acceptTransformationInvariants(invalid, ["inv_missing"]),
        /invalid contract/,
      );

      const contradictory = withTransformationContractIdentity({
        ...learned,
        invariants: [
          {
            id: "inv_output_present",
            kind: "output_path_present",
            scope: "record",
            severity: "blocking",
            parameters: { path: "$.state" },
          },
          {
            id: "inv_output_absent",
            kind: "output_path_absent",
            scope: "record",
            severity: "blocking",
            parameters: { path: "$.state" },
          },
        ],
      });
      const contradictionValidation = validateTransformationContract(contradictory);
      assert.equal(contradictionValidation.ok, false);
      assert.ok(contradictionValidation.errors.some(error => error.code === "contradictory-invariants"));
    },
  },
  {
    id: "invariant-results-drive-runtime-policy",
    run() {
      const { accepted } = learnedInvariantContract();
      const passing = evaluateTransformationInvariants(accepted, invariantFixture.runtime);
      assert.equal(passing.verdict, "pass");
      assert.ok(passing.results.every(result => result.status === "pass"));

      const recordViolation = evaluateTransformationInvariants(accepted, {
        ...invariantFixture.runtime,
        outputRecords: invariantFixture.runtime.outputRecords.map((row, index) => (
          index === 0 ? { ...row, unexpected: true } : row
        )),
      });
      assert.equal(recordViolation.verdict, accepted.runtimePolicy.onRecordViolation);
      assert.ok(recordViolation.results.some(result => result.status === "fail"));

      const batchViolation = evaluateTransformationInvariants(accepted, {
        ...invariantFixture.runtime,
        outputRecords: invariantFixture.runtime.outputRecords.slice(0, 1),
      });
      assert.equal(batchViolation.verdict, accepted.runtimePolicy.onBatchViolation);
    },
  },
  {
    id: "user-authored-record-and-batch-invariants-evaluate-explicitly",
    run() {
      const learned = learnContract(invariantFixture.task);
      const accepted = acceptTransformationInvariants(learned, [
        {
          id: "inv_forbidden_output",
          kind: "output_path_absent",
          scope: "record",
          severity: "blocking",
          parameters: { path: "$.forbidden" },
        },
        {
          id: "inv_source_preserved",
          kind: "source_path_preserved",
          scope: "record",
          severity: "blocking",
          parameters: { sourcePath: "$.id", targetPath: "$.customerId" },
        },
        {
          id: "inv_customer_pattern",
          kind: "string_pattern",
          scope: "record",
          severity: "blocking",
          parameters: { subject: "output", path: "$.customerId", pattern: "^c\\d+$" },
        },
        {
          id: "inv_key_set",
          kind: "key_set_preserved",
          scope: "batch",
          severity: "blocking",
          parameters: { inputKeyPath: "$.id", outputKeyPath: "$.customerId" },
        },
        {
          id: "inv_input_key_unique",
          kind: "key_unique",
          scope: "batch",
          severity: "blocking",
          parameters: { subject: "input", keyPath: "$.id" },
        },
        {
          id: "inv_output_key_unique",
          kind: "no_duplicate_output_keys",
          scope: "batch",
          severity: "blocking",
          parameters: { keyPath: "$.customerId" },
        },
        {
          id: "inv_no_failed_records",
          kind: "maximum_failed_records",
          scope: "batch",
          severity: "blocking",
          parameters: { maximum: 0 },
        },
        {
          id: "inv_no_failed_percent",
          kind: "maximum_failed_percent",
          scope: "batch",
          severity: "blocking",
          parameters: { maximum: 0 },
        },
      ]);
      const passing = evaluateTransformationInvariants(accepted, invariantFixture.runtime);
      assert.equal(passing.verdict, "pass");
      assert.equal(passing.results.length, 8);
      assert.ok(passing.results.every(result => result.status === "pass"));

      const failing = evaluateTransformationInvariants(accepted, {
        ...invariantFixture.runtime,
        outputRecords: [
          { customerId: "c3", state: "N", forbidden: true },
          { customerId: "c3", state: "D" },
        ],
        failedRecords: [{ rowIndex: 1, reason: "test failure" }],
      });
      assert.equal(failing.verdict, "block");
      assert.ok(failing.results.filter(result => result.status === "fail").length >= 5);

      const incomplete = evaluateTransformationInvariants(accepted, {
        inputRecords: invariantFixture.runtime.inputRecords,
      });
      assert.ok(incomplete.results.some(result => result.status === "not_evaluated"));
    },
  },
  {
    id: "mutation-report-detects-required-failures-and-shows-gaps",
    run() {
      const { accepted } = learnedInvariantContract();
      assert.deepEqual(
        generateTransformationMutations(accepted),
        generateTransformationMutations(accepted),
      );
      const report = runTransformationMutationSuite(accepted, invariantFixture.runtime);
      assert.equal(report.version, "transformation-mutation-report/1");
      assert.equal(Object.prototype.hasOwnProperty.call(report, "score"), false);
      for (const kind of invariantFixture.requiredMutationKinds) {
        const mutation = report.mutations.find(item => item.kind === kind);
        assert.ok(mutation, `required ${kind} mutation`);
        assert.equal(mutation.detected, true, `${kind} should be detected`);
        assert.ok(mutation.detectedBy.length > 0);
        assert.ok(mutation.detectedBy.includes(mutation.invariantId), `${kind} should be detected by its matching invariant`);
        assert.equal(Object.prototype.hasOwnProperty.call(mutation, "score"), false);
      }
      const honestGap = report.mutations.find(item => item.kind === invariantFixture.expectedUndetectedKind);
      assert.ok(honestGap);
      assert.equal(honestGap.detected, false);
      assert.ok(report.undetected.includes(honestGap.id));
    },
  },
);

cases.push(
  {
    id: "approval-requires-exact-fingerprint-and-is-deterministic",
    run() {
      const contract = readFixture("safe-v1.json");
      const acknowledgement = {
        coreFingerprint: contract.identity.coreFingerprint,
        ...approvalComparisonFixture.approval,
      };
      const approved = approveContract(contract, acknowledgement);
      const approvedAgain = approveContract({ contract, acknowledgement });
      assert.deepEqual(approvedAgain, approved);
      assert.equal(approved.lifecycle.approvalState, "approved");
      assert.equal(approved.lifecycle.revision, contract.lifecycle.revision);
      assert.equal(approved.identity.coreFingerprint, contract.identity.coreFingerprint);
      assert.equal(approved.approval.approvedCoreFingerprint, contract.identity.coreFingerprint);
      assert.equal(approved.approval.method, approvalComparisonFixture.approval.method);
      assert.equal(validateTransformationContract(approved).ok, true);
      assert.ok(approved.extensions.latentmachine.lifecycleTrace.some(event => event.type === "contract.approved"));
      assert.equal(contract.lifecycle.approvalState, "unreviewed", "approval must not mutate the source contract");
      assert.throws(
        () => approveContract(contract, { ...acknowledgement, coreFingerprint: "0000000000000000" }),
        /must exactly equal/,
      );
      assert.throws(() => approveContract(approved, acknowledgement), /already approved/);
    },
  },
  {
    id: "approval-blocks-unresolved-risk-and-requires-advisory-acknowledgement",
    run() {
      const blocking = learnContract(challengeFixture.evidenceCases[0].task);
      assert.ok(blocking.challenges.some(challenge => challenge.severity === "blocking" && challenge.status === "open"));
      assert.throws(
        () => approveContract(blocking, { coreFingerprint: blocking.identity.coreFingerprint }),
        /blocking challenge/,
      );

      const deferred = JSON.parse(JSON.stringify(blocking));
      deferred.challenges[0].status = "deferred";
      assert.equal(validateTransformationContract(deferred).ok, true);
      assert.throws(
        () => approveContract(deferred, { coreFingerprint: deferred.identity.coreFingerprint }),
        /blocking challenge/,
      );

      const advisory = readFixture("safe-v1.json");
      advisory.challenges = [{
        id: "challenge_advisory_review",
        kind: "approval_acknowledgement",
        severity: "advisory",
        status: "open",
        prompt: "Acknowledge this known review limitation.",
        reason: "The limitation is non-blocking but remains relevant to approval.",
        affectedOperations: [],
        affectedPaths: ["$"],
        proposedInput: null,
        answerMode: "choice",
        choices: ["acknowledge", "revisit"],
        answer: null,
      }];
      assert.equal(validateTransformationContract(advisory).ok, true);
      assert.throws(
        () => approveContract(advisory, { coreFingerprint: advisory.identity.coreFingerprint }),
        /must acknowledge advisory challenge/,
      );
      const approved = approveContract(advisory, {
        coreFingerprint: advisory.identity.coreFingerprint,
        acknowledgedChallenges: ["challenge_advisory_review"],
      });
      assert.deepEqual(approved.approval.acknowledgedChallenges, ["challenge_advisory_review"]);
    },
  },
  {
    id: "core-edits-invalidate-a-prior-approval",
    run() {
      const contract = readFixture("safe-v1.json");
      const approved = approveContract(contract, {
        coreFingerprint: contract.identity.coreFingerprint,
      });
      const edited = withTransformationContractIdentity({
        ...approved,
        program: {
          ...approved.program,
          ops: approved.program.ops.map((operation, index) => (
            index === 0 ? { ...operation, source: "$.last" } : operation
          )),
        },
      });
      const validation = validateTransformationContract(edited);
      assert.equal(validation.ok, false);
      assert.ok(validation.errors.some(error => error.code === "approval-fingerprint-mismatch"));
    },
  },
  {
    id: "revocation-is-explicit-terminal-and-auditable",
    run() {
      const contract = readFixture("safe-v1.json");
      const approved = approveContract(contract, {
        coreFingerprint: contract.identity.coreFingerprint,
      });
      const revoked = revokeContract(approved, approvalComparisonFixture.revocation);
      assert.equal(revoked.lifecycle.approvalState, "revoked");
      assert.deepEqual(revoked.approval, approved.approval);
      assert.equal(revoked.identity.coreFingerprint, approved.identity.coreFingerprint);
      assert.equal(validateTransformationContract(revoked).ok, true);
      assert.ok(revoked.extensions.latentmachine.lifecycleTrace.some(event => (
        event.type === "contract.revoked"
        && event.reason === approvalComparisonFixture.revocation.reason
      )));
      assert.throws(() => revokeContract(revoked, approvalComparisonFixture.revocation), /already terminal/);
      assert.throws(() => revokeContract(contract, { reason: "" }), /requires a non-empty reason/);
    },
  },
  {
    id: "supersession-requires-approved-successor-and-valid-lineage",
    run() {
      const baseline = readFixture("safe-v1.json");
      const replacement = readFixture("behavior-change-v1.json");
      const approvedBaseline = approveContract(baseline, {
        coreFingerprint: baseline.identity.coreFingerprint,
      });
      const approvedReplacement = approveContract(replacement, {
        coreFingerprint: replacement.identity.coreFingerprint,
      });
      const superseded = supersedeContract({
        contract: approvedBaseline,
        replacement: approvedReplacement,
      });
      assert.equal(superseded.lifecycle.approvalState, "superseded");
      assert.deepEqual(superseded.approval, approvedBaseline.approval);
      assert.equal(
        superseded.extensions.latentmachine.supersededBy.contractId,
        approvedReplacement.identity.contractId,
      );
      assert.equal(validateTransformationContract(superseded).ok, true);
      assert.throws(
        () => supersedeContract(approvedBaseline, replacement),
        /must be approved/,
      );

      const wrongLineage = revisedFixtureContract(baseline, candidate => {
        candidate.program.ops[0].source = "$.other";
      });
      wrongLineage.lifecycle.supersedes = null;
      const identifiedWrongLineage = withTransformationContractIdentity(wrongLineage);
      const approvedWrongLineage = approveContract(identifiedWrongLineage, {
        coreFingerprint: identifiedWrongLineage.identity.coreFingerprint,
      });
      assert.throws(
        () => supersedeContract(approvedBaseline, approvedWrongLineage),
        /Replacement lineage/,
      );
    },
  },
  {
    id: "contract-comparison-classifies-every-m4-change-family",
    run() {
      const baseline = readFixture("safe-v1.json");
      for (const comparisonCase of approvalComparisonFixture.comparisonCases) {
        const candidate = comparisonCandidate(comparisonCase.variant);
        const first = compareContracts(baseline, candidate);
        const second = compareContracts({ baseline, candidate });
        assert.deepEqual(second, first, `${comparisonCase.id} determinism`);
        assert.equal(first.classification, comparisonCase.classification, `${comparisonCase.id} classification`);
        assert.equal(first.breaking, comparisonCase.breaking, `${comparisonCase.id} breaking`);
        assert.equal(first.requiresReapproval, comparisonCase.requiresReapproval, `${comparisonCase.id} reapproval`);
        if (comparisonCase.categories) {
          assert.deepEqual(first.categories, comparisonCase.categories, `${comparisonCase.id} categories`);
        }
        for (const category of comparisonCase.requiredCategories || []) {
          assert.ok(first.categories.includes(category), `${comparisonCase.id} requires ${category}`);
        }
        assert.ok(first.changes.every(change => (
          typeof change.path === "string"
          && typeof change.explanation === "string"
          && typeof change.breaking === "boolean"
        )));
      }
    },
  },
  {
    id: "contract-comparison-fails-closed-for-invalid-input",
    run() {
      const baseline = readFixture("safe-v1.json");
      const invalid = JSON.parse(JSON.stringify(baseline));
      invalid.identity.coreFingerprint = "0000000000000000";
      const comparison = compareContracts(baseline, invalid);
      assert.equal(comparison.relation, "invalid_contract");
      assert.equal(comparison.classification, "invalid_contract");
      assert.equal(comparison.breaking, true);
      assert.ok(comparison.validation.candidate.errors.some(error => error.code === "identity-mismatch"));
    },
  },
);

function uniqueDiagnosticCodes(diagnostics) {
  return [...new Set(diagnostics.map(item => item.code))].sort();
}

function assertRuntimeReportIntegrity(report) {
  const partitionTotal = report.totals.passed
    + report.totals.warned
    + report.totals.quarantined
    + report.totals.blocked;
  assert.equal(partitionTotal, report.totals.input, "runtime partitions must cover every input row");
  assert.equal(report.records.length, report.totals.input, "record total must match the input total");
  assert.deepEqual(
    JSON.parse(JSON.stringify(report)),
    report,
    "runtime reports must be lossless JSON values",
  );
  const diagnostics = [
    ...report.records.flatMap(record => record.diagnostics),
    ...report.batchDiagnostics,
  ];
  assert.equal(
    new Set(diagnostics.map(item => item.id)).size,
    diagnostics.length,
    "diagnostic IDs must be unique within a report",
  );
  for (const record of report.records.filter(item => item.status !== "passed")) {
    assert.ok(
      Number.isInteger(record.sourceIndex)
      && record.sourceIndex >= 0
      && record.sourceIndex < report.totals.input,
      "every failed row must reference an input row",
    );
  }
}

for (const fixtureName of runtimeFixtureNames) {
  cases.push({
    id: `runtime-${fixtureName.replace(/^runtime-|\.json$/g, "")}`,
    run() {
      const fixture = readFixture(fixtureName);
      const contract = approvedRuntimeContract();
      const request = {
        contract,
        input: fixture.input,
      };
      const report = fixture.mode === "check"
        ? checkContract({ ...request, output: fixture.output })
        : runContract(request);
      const repeated = fixture.mode === "check"
        ? checkContract({ ...request, output: fixture.output })
        : runContract(request);
      assert.deepEqual(repeated, report, `${fixtureName} must be deterministic`);
      assert.equal(report.verdict, fixture.expected.verdict);
      assertRuntimeReportIntegrity(report);

      if (fixture.expected.totals) {
        assert.deepEqual(report.totals, fixture.expected.totals);
      }
      if (fixture.expected.blocked != null) {
        assert.equal(report.totals.blocked, fixture.expected.blocked);
      }
      if (fixture.expected.quarantinedRowIds) {
        assert.deepEqual(
          report.quarantined.map(record => record.rowId),
          fixture.expected.quarantinedRowIds,
        );
      }
      if (fixture.expected.diagnosticCodes) {
        assert.deepEqual(
          uniqueDiagnosticCodes(report.records.flatMap(record => record.diagnostics)),
          [...fixture.expected.diagnosticCodes].sort(),
        );
      }
      if (fixture.expected.batchDiagnosticCodes) {
        assert.deepEqual(
          uniqueDiagnosticCodes(report.batchDiagnostics),
          [...fixture.expected.batchDiagnosticCodes].sort(),
        );
      }
    },
  });
}

cases.push(
  {
    id: "runtime-rejects-required-but-missing-approval",
    run() {
      const unapproved = learnContract(invariantFixture.task);
      const report = runContract({
        contract: unapproved,
        input: invariantFixture.task.examples[0].input,
      });
      assert.equal(report.verdict, "invalid_contract");
      assert.ok(report.errors.some(error => error.code === "approval-required"));
      assert.equal(report.totals.input, 0, "approval is checked before input parsing");
    },
  },
  {
    id: "runtime-rejects-terminal-contracts",
    run() {
      const approved = approvedRuntimeContract();
      const revoked = revokeContract(approved, {
        reason: "Acceptance test terminal lifecycle.",
      });
      for (const mode of ["run", "check"]) {
        const report = mode === "run"
          ? runContract({ contract: revoked, input: [] })
          : checkContract({ contract: revoked, input: [], output: [] });
        assert.equal(report.verdict, "invalid_contract");
        assert.ok(report.errors.some(error => error.code === "inactive-contract"));
      }
    },
  },
  {
    id: "runtime-privacy-safe-reports-omit-raw-record-values",
    run() {
      const contract = approvedRuntimeContract();
      const report = checkContract({
        contract,
        input: [{ id: "private-customer", status: "new" }],
        output: [{ customerId: "private-customer", state: "WRONG" }],
        options: { privacySafe: true },
      });
      assert.equal(report.verdict, "quarantine");
      assert.equal(Object.hasOwn(report.records[0], "input"), false);
      assert.equal(Object.hasOwn(report.records[0], "expectedOutput"), false);
      assert.equal(Object.hasOwn(report.records[0], "actualOutput"), false);
      assert.equal(report.records[0].key, null);
      assert.equal(JSON.stringify(report).includes("private-customer"), false);
      assert.equal(JSON.stringify(report).includes('"WRONG"'), false);
      assertRuntimeReportIntegrity(report);
    },
  },
  {
    id: "runtime-progress-and-cancellation-are-out-of-band",
    run() {
      const contract = approvedRuntimeContract();
      const input = [
        { id: "c3", status: "new" },
        { id: "c4", status: "done" },
        { id: "c5", status: "new" },
      ];
      const progress = [];
      const withProgress = runContract({
        contract,
        input,
        options: {
          progressEvery: 1,
          onProgress(event) {
            progress.push(event);
          },
        },
      });
      const withoutProgress = runContract({ contract, input });
      assert.deepEqual(withProgress, withoutProgress);
      assert.deepEqual(progress, [
        { phase: "validate", completed: 0, total: 1 },
        { phase: "validate", completed: 1, total: 1 },
        { phase: "execute", completed: 0, total: 3 },
        { phase: "execute", completed: 1, total: 3 },
        { phase: "execute", completed: 2, total: 3 },
        { phase: "execute", completed: 3, total: 3 },
        {
          phase: "invariants",
          completed: contract.invariants.length,
          total: contract.invariants.length,
        },
      ]);

      const controller = new AbortController();
      controller.abort();
      assert.throws(
        () => runContract({ contract, input, options: { signal: controller.signal } }),
        error => error?.name === "AbortError",
      );
    },
  },
  {
    id: "runtime-record-policy-is-distinct-from-batch-policy",
    run() {
      const baseline = approvedRuntimeContract();
      const warningCandidate = revisedFixtureContract(baseline, candidate => {
        candidate.runtimePolicy.onRecordViolation = "warn";
      });
      const warningContract = approveContract(warningCandidate, {
        coreFingerprint: warningCandidate.identity.coreFingerprint,
        note: "Approve warning policy test.",
      });
      const warned = checkContract({
        contract: warningContract,
        input: [{ id: "c3", status: "new" }],
        output: [{ customerId: "c3", state: "WRONG" }],
      });
      assert.equal(warned.verdict, "warn");
      assert.equal(warned.totals.warned, 1);
      assert.equal(warned.totals.blocked, 0);
    },
  },
  {
    id: "runtime-retains-distinct-repeated-batch-diagnostics",
    run() {
      const contract = approvedRuntimeContract();
      const report = checkContract({
        contract,
        input: [
          { id: "c3", status: "new" },
          { id: "c4", status: "done" },
        ],
        output: [
          { customerId: "c3", state: "N" },
          { customerId: "c3", state: "N" },
          { customerId: "c4", state: "D" },
          { customerId: "c4", state: "D" },
          { customerId: "extra-a", state: "N" },
          { customerId: "extra-b", state: "D" },
        ],
      });
      const duplicateDiagnostics = report.batchDiagnostics
        .filter(item => item.code === "duplicate-output-key");
      const extraDiagnostics = report.batchDiagnostics
        .filter(item => item.code === "extra-output-row");
      assert.equal(duplicateDiagnostics.length, 2);
      assert.equal(extraDiagnostics.length, 2);
      assert.equal(new Set(duplicateDiagnostics.map(item => item.id)).size, 2);
      assert.equal(new Set(extraDiagnostics.map(item => item.id)).size, 2);
      assertRuntimeReportIntegrity(report);
    },
  },
  {
    id: "runtime-parses-declared-json-formats",
    run() {
      const contract = approvedRuntimeContract();
      const report = checkContract({
        contract,
        input: JSON.stringify([{ id: "c3", status: "new" }]),
        output: JSON.stringify([{ customerId: "c3", state: "N" }]),
      });
      assert.equal(report.verdict, "pass");
      assert.deepEqual(report.totals, {
        input: 1,
        passed: 1,
        warned: 0,
        quarantined: 0,
        blocked: 0,
      });
    },
  },
  {
    id: "challenge-deferral-preserves-risk-and-review-state",
    run() {
      const challengeCase = challengeFixture.evidenceCases[0];
      const contract = learnContract(challengeCase.task);
      const challenge = contract.challenges.find(item => item.status === "open");
      assert.ok(challenge);
      const deferred = deferChallenge(contract, challenge.id);
      assert.equal(
        deferred.challenges.find(item => item.id === challenge.id)?.status,
        "deferred",
      );
      assert.equal(deferred.lifecycle.approvalState, "review_required");
      assert.equal(deferred.lifecycle.revision, contract.lifecycle.revision);
      assert.equal(deferred.identity.coreFingerprint, contract.identity.coreFingerprint);
      assert.ok(deferred.extensions.latentmachine.challengeTrace.some(event => (
        event.type === "challenge.deferred"
        && event.challengeId === challenge.id
      )));
      assert.equal(validateTransformationContract(deferred).ok, true);
      assert.throws(() => deferChallenge(deferred, challenge.id), /is not open/);
    },
  },
);

let failed = 0;
for (const testCase of cases) {
  try {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${testCase.id}: ${error.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} Transformation Contract acceptance case${failed === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log(`\nAll ${cases.length} Transformation Contract acceptance cases passed.`);
