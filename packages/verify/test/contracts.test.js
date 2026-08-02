import assert from "node:assert/strict";
import {
  approveContract,
  checkContract,
  compareContracts,
  generateTransformationChallenges,
  learnContract,
  runContract,
  runTransformationMutationSuite,
  validateTransformationContract,
} from "../src/index.js";

const examples = [
  {
    input: { id: "evt_001", status: "created", amount: 12 },
    output: { eventId: "evt_001", state: "NEW", amountCents: 1200 },
  },
  {
    input: { id: "evt_002", status: "paid", amount: 8.5 },
    output: { eventId: "evt_002", state: "READY", amountCents: 850 },
  },
];

const learned = learnContract({ examples }, { evidenceSource: "package-test" });
assert.equal(validateTransformationContract(learned).ok, true);
assert.equal(learned.inference.status, "safe");

const learnedWrapper = { summary: {}, review: {}, contract: learned };
assert.equal(generateTransformationChallenges(learnedWrapper).kind, learned.kind);
const mutationReport = runTransformationMutationSuite(learnedWrapper, {
  inputRecords: examples.map(example => example.input),
  outputRecords: examples.map(example => example.output),
  failedRecords: [],
});
assert.equal(mutationReport.coverage.targetCoverage, 1);
assert.equal(mutationReport.sourceInferenceStatus, "safe");
assert.equal(mutationReport.inferenceStatus, "unverified");
assert.ok(mutationReport.mutations.length >= mutationReport.coverage.operationTargetCount * 2);
assert.ok(mutationReport.coverage.mutationKinds.includes("remove-operation-target"));
assert.ok(mutationReport.coverage.mutationKinds.includes("change-operation-target-type"));
assert.ok(mutationReport.coverage.mutationKinds.includes("scale-target-unit"));

const wideExamples = Array.from({ length: 8 }, (_, index) => {
  const day = String(index + 1).padStart(2, "0");
  const input = {
    customer_id: `cus_${index + 1}`,
    first_name: ["Ada", "Bo", "Cy", "Dee"][index % 4],
    last_name: `Surname${index + 1}`,
    email: `person${index + 1}@example.com`,
    plan: ["free", "pro"][index % 2],
    mrr_cents: 1035 + index * 137,
    seats: index + 1,
    is_active: index % 2 === 0,
    country: ["DE", "NL"][index % 2],
    city: ["Berlin", "Utrecht"][index % 2],
    postal_code: `10${index}15`,
    created_at: `2026-01-${day}T12:00:00.000Z`,
  };
  return {
    input,
    output: {
      customerId: input.customer_id,
      fullName: `${input.first_name} ${input.last_name}`,
      email: input.email,
      plan: input.plan,
      mrr: input.mrr_cents / 100,
      seats: input.seats,
      status: input.is_active ? "active" : "inactive",
      country: input.country,
      city: input.city,
      postalCode: input.postal_code,
      joinDate: input.created_at.slice(0, 10),
    },
  };
});
const wideContract = learnContract({ examples: wideExamples }, { evidenceSource: "coverage-test" });
const wideMutationReport = runTransformationMutationSuite(wideContract, {
  inputRecords: wideExamples.map(example => example.input),
  outputRecords: wideExamples.map(example => example.output),
  failedRecords: [],
});
assert.equal(wideMutationReport.coverage.operationTargetCount, 11);
assert.ok(wideMutationReport.coverage.targetCoverage > 0.8);
assert.ok(wideMutationReport.mutations.length >= 22);

const approved = approveContract(learnedWrapper, {
  coreFingerprint: learned.identity.coreFingerprint,
  acknowledgedChallenges: learned.challenges
    .filter(item => item.severity === "advisory" && ["open", "deferred"].includes(item.status))
    .map(item => item.id),
});
assert.equal(approved.lifecycle.approvalState, "approved");

const run = runContract({
  contract: approved,
  input: [{ id: "evt_003", status: "paid", amount: 5 }],
});
assert.equal(run.verdict, "pass");
assert.deepEqual(run.records[0].output, {
  eventId: "evt_003",
  state: "READY",
  amountCents: 500,
});

const check = checkContract({
  contract: approved,
  input: [{ id: "evt_003", status: "paid", amount: 5 }],
  output: [{ eventId: "evt_003", state: "WRONG", amountCents: 500 }],
});
assert.equal(check.verdict, "quarantine");
assert.equal(check.quarantined.length, 1);

const comparison = compareContracts(learned, approved);
assert.equal(comparison.relation, "non_behavioral_change");
assert.equal(comparison.requiresReapproval, false);

console.log("contracts.test.js passed");
