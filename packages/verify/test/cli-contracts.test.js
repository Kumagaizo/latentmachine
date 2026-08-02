import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI_EXIT, runCli } from "../src/cli.js";

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function invoke(cwd, args) {
  const captured = capture();
  const exitCode = runCli(args, { cwd, ...captured.io });
  return {
    exitCode,
    stdout: captured.stdout(),
    stderr: captured.stderr(),
  };
}

const root = mkdtempSync(join(tmpdir(), "latentmachine-cli-"));

try {
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
  writeFileSync(join(root, "examples.json"), JSON.stringify(examples));
  writeFileSync(join(root, "input.json"), JSON.stringify([
    { id: "evt_003", status: "paid", amount: 5 },
  ]));
  writeFileSync(join(root, "candidates.json"), JSON.stringify([
    { id: "evt_004", status: "created", amount: 3 },
  ]));
  writeFileSync(join(root, "wrong.json"), JSON.stringify([
    { eventId: "evt_003", state: "WRONG", amountCents: 500 },
  ]));
  writeFileSync(join(root, "original.json"), JSON.stringify(examples.map(item => item.input)));
  writeFileSync(join(root, "transformed.json"), JSON.stringify(examples.map(item => item.output)));
  const memorisedOriginal = Array.from({ length: 8 }, (_, index) => ({ id: index + 1 }));
  const arbitraryLabels = ["quartz", "maple", "indigo", "harbor", "cobalt", "willow", "ember", "saffron"];
  const memorisedTransformed = memorisedOriginal.map((row, index) => ({ label: arbitraryLabels[index] }));
  writeFileSync(join(root, "memorised-original.json"), JSON.stringify(memorisedOriginal));
  writeFileSync(join(root, "memorised-transformed.json"), JSON.stringify(memorisedTransformed));

  const learned = invoke(root, [
    "contract", "learn", "examples.json", "--out", "contract.json",
  ]);
  assert.equal(learned.exitCode, CLI_EXIT.success);
  assert.equal(learned.stderr, "");
  const learnedStdout = JSON.parse(learned.stdout);
  const contract = JSON.parse(readFileSync(join(root, "contract.json"), "utf8"));
  assert.equal(learnedStdout.identity.coreFingerprint, contract.identity.coreFingerprint);

  const inspect = invoke(root, [
    "contract", "inspect", "contract.json", "--format", "human",
  ]);
  assert.equal(inspect.exitCode, CLI_EXIT.success);
  assert.match(inspect.stdout, /Valid\s+yes/);

  const challenged = invoke(root, [
    "contract", "challenge", "contract.json", "--inputs", "candidates.json",
  ]);
  assert.equal(challenged.exitCode, CLI_EXIT.success);
  const challengeResult = JSON.parse(challenged.stdout);
  assert.equal(challengeResult.candidateInputCount, 1);
  assert.deepEqual(challengeResult.candidateOutputs[0].output, {
    eventId: "evt_004",
    state: "NEW",
    amountCents: 300,
  });

  const unacknowledged = invoke(root, [
    "contract", "approve", "contract.json",
  ]);
  assert.equal(unacknowledged.exitCode, CLI_EXIT.reviewRequired);
  assert.equal(unacknowledged.stdout, "");
  assert.match(unacknowledged.stderr, /--fingerprint/);

  const approved = invoke(root, [
    "contract", "approve", "contract.json",
    "--fingerprint", contract.identity.coreFingerprint,
    "--acknowledge-all-advisory",
    "--out", "approved.json",
  ]);
  assert.equal(approved.exitCode, CLI_EXIT.success);
  assert.equal(approved.stderr, "");
  assert.equal(JSON.parse(approved.stdout).lifecycle.approvalState, "approved");

  const ran = invoke(root, [
    "contract", "run", "approved.json",
    "--input", "input.json",
    "--out", "output.json",
    "--report", "run-report.json",
  ]);
  assert.equal(ran.exitCode, CLI_EXIT.success);
  assert.equal(JSON.parse(ran.stdout).verdict, "pass");
  assert.equal(JSON.parse(readFileSync(join(root, "run-report.json"), "utf8")).verdict, "pass");

  const checked = invoke(root, [
    "contract", "check", "approved.json",
    "--input", "input.json",
    "--output", "output.json",
  ]);
  assert.equal(checked.exitCode, CLI_EXIT.success);
  assert.equal(JSON.parse(checked.stdout).verdict, "pass");

  const violated = invoke(root, [
    "contract", "check", "approved.json",
    "--input", "input.json",
    "--output", "wrong.json",
    "--privacy-safe",
  ]);
  assert.equal(violated.exitCode, CLI_EXIT.violation);
  assert.equal(JSON.parse(violated.stdout).verdict, "quarantine");
  assert.equal(violated.stderr, "");

  const legacy = invoke(root, ["original.json", "transformed.json"]);
  assert.equal(legacy.exitCode, CLI_EXIT.success);
  assert.equal(JSON.parse(legacy.stdout).verdict, "consistent");

  const unverifiable = invoke(root, ["memorised-original.json", "memorised-transformed.json"]);
  assert.equal(unverifiable.exitCode, CLI_EXIT.violation);
  assert.equal(JSON.parse(unverifiable.stdout).verdict, "unverifiable");
  assert.equal(JSON.parse(unverifiable.stdout).rule.executable, false);

  const allowedUnverifiable = invoke(root, [
    "memorised-original.json", "memorised-transformed.json", "--allow-unverifiable",
  ]);
  assert.equal(allowedUnverifiable.exitCode, CLI_EXIT.success);
  assert.equal(JSON.parse(allowedUnverifiable.stdout).verdict, "unverifiable");

  const usage = invoke(root, ["contract", "unknown"]);
  assert.equal(usage.exitCode, CLI_EXIT.invalid);
  assert.equal(usage.stdout, "");
  assert.match(usage.stderr, /Unknown contract command/);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("cli-contracts.test.js passed");
