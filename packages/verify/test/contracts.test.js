import assert from "node:assert/strict";
import {
  approveContract,
  checkContract,
  compareContracts,
  learnContract,
  runContract,
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

const approved = approveContract(learned, {
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
