import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  acceptTransformationInvariants,
  approveContract,
  checkContract,
  compareContracts,
  deferChallenge,
  learnContract,
  runContract,
  runTransformationMutationSuite,
  validateTransformationContract,
} from "../src/intelligence/contracts/index.js";
import {
  decodeShareState,
  encodeShareState,
} from "../src/local/share-state.js";

const root = new URL("../", import.meta.url);
const page = await readFile(new URL("contract.html", root), "utf8");
const ui = await readFile(new URL("src/local/contract.js", root), "utf8");
const styles = await readFile(new URL("src/local/styles.css", root), "utf8");

const cases = [
  {
    id: "contract-studio-page-shell",
    run() {
      for (const expected of [
        'id="contract"',
        "Loading Contract Studio",
        "/src/local/contract.js",
        "https://latentmachine.com/contract",
        "Nothing is sent to a server",
      ]) {
        assert.ok(page.includes(expected), `contract.html must include ${expected}`);
      }
    },
  },
  {
    id: "contract-studio-five-stage-workflow",
    run() {
      for (const expected of [
        '{ id: "evidence", label: "Evidence" }',
        '{ id: "rule", label: "Rule" }',
        '{ id: "challenges", label: "Challenges" }',
        '{ id: "guardrails", label: "Guardrails" }',
        '{ id: "approval", label: "Approve & export" }',
        'role="tablist"',
        'aria-live="polite"',
        "Observed, not yet approved.",
      ]) {
        assert.ok(ui.includes(expected), `Contract Studio must include ${expected}`);
      }
    },
  },
  {
    id: "contract-studio-local-only-boundary",
    run() {
      for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource("]) {
        assert.equal(ui.includes(forbidden), false, `Contract Studio must not include ${forbidden}`);
      }
      assert.ok(ui.includes("Local & private"));
      assert.ok(ui.includes("No model call. No upload."));
      assert.ok(ui.includes("This link contains the examples and runtime drafts themselves"));
    },
  },
  {
    id: "contract-studio-responsive-accessibility-contract",
    run() {
      for (const expected of [
        "@media (max-width: 980px)",
        "@media (max-width: 760px)",
        "@media (max-width: 480px)",
        "@media (pointer: coarse)",
        "@media (prefers-reduced-motion: reduce)",
        ".contract-progress",
        ".contract-summary",
      ]) {
        assert.ok(styles.includes(expected), `Contract Studio CSS must include ${expected}`);
      }
    },
  },
  {
    id: "contract-studio-webhook-happy-path",
    async run() {
      const evidence = [
        {
          input: { id: "evt_001", status: "created", amount: 129 },
          output: { eventId: "evt_001", state: "NEW", amountCents: 12900 },
        },
        {
          input: { id: "evt_002", status: "paid", amount: 48.5 },
          output: { eventId: "evt_002", state: "READY", amountCents: 4850 },
        },
      ];
      const learned = learnContract({ examples: evidence }, {
        title: "Contract Studio transformation",
        evidenceSource: "contract-studio",
      });
      assert.equal(learned.inference.status, "safe");
      assert.equal(learned.lifecycle.approvalState, "unreviewed");
      assert.equal(learned.challenges.filter(item => item.status === "open").length, 0);
      assert.deepEqual(
        learned.program.ops.map(operation => operation.op),
        ["set", "valueMap", "numericTransform"],
      );

      const guarded = acceptTransformationInvariants(
        learned,
        learned.extensions.latentmachine.invariantSuggestions.map(item => item.id),
      );
      const mutations = runTransformationMutationSuite(guarded, {
        inputRecords: evidence.map(example => example.input),
        outputRecords: evidence.map(example => example.output),
        failedRecords: [],
      });
      assert.ok(mutations.detected.length > 0);
      assert.ok(Array.isArray(mutations.undetected));

      const approved = approveContract(guarded, {
        coreFingerprint: guarded.identity.coreFingerprint,
        note: "Reviewed and approved in Contract Studio.",
      });
      const run = runContract({
        contract: approved,
        input: [{ id: "evt_101", status: "created", amount: 24.5 }],
      });
      assert.equal(run.verdict, "pass");
      assert.deepEqual(run.records[0].output, {
        eventId: "evt_101",
        state: "NEW",
        amountCents: 2450,
      });

      const check = checkContract({
        contract: approved,
        input: [{ id: "evt_101", status: "created", amount: 24.5 }],
        output: [{ eventId: "evt_101", state: "WRONG", amountCents: 2450 }],
      });
      assert.equal(check.verdict, "quarantine");
      assert.ok(check.records[0].diagnostics.some(item => (
        item.code === "output-value-mismatch"
        && item.path === "$.state"
      )));

      const imported = JSON.parse(JSON.stringify(approved));
      assert.equal(validateTransformationContract(imported).ok, true);
      assert.equal(imported.identity.coreFingerprint, approved.identity.coreFingerprint);
      assert.equal(compareContracts(approved, imported).classification, "identical");

      const shared = {
        version: 1,
        stage: "approval",
        contract: approved,
        runtimeInput: JSON.stringify(evidence.map(example => example.input)),
      };
      assert.deepEqual(await decodeShareState(await encodeShareState(shared)), shared);
    },
  },
  {
    id: "contract-studio-blocking-deferral-remains-honest",
    run() {
      const learned = learnContract({
        examples: [
          { input: { first: "Ada", last: "Lovelace" }, output: { name: "Ada" } },
          { input: { first: "Grace", last: "Hopper" }, output: { name: "Hopper" } },
        ],
        newInput: { first: "Tim", last: "Berners-Lee" },
      });
      const challenge = learned.challenges.find(item => (
        item.status === "open"
        && item.severity === "blocking"
      ));
      assert.ok(challenge, "ambiguous evidence must create a blocking challenge");
      const deferred = deferChallenge(learned, challenge.id);
      assert.equal(deferred.lifecycle.approvalState, "review_required");
      assert.equal(
        deferred.challenges.find(item => item.id === challenge.id)?.status,
        "deferred",
      );
      assert.throws(
        () => approveContract(deferred, {
          coreFingerprint: deferred.identity.coreFingerprint,
        }),
        /blocking challenge/,
      );
    },
  },
];

let failed = 0;
for (const testCase of cases) {
  try {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${testCase.id}: ${error.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} Contract Studio acceptance case${failed === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log(`\nAll ${cases.length} Contract Studio acceptance cases passed.`);
