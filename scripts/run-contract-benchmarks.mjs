import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { TRANSFORMATION_CONTRACT_BENCHMARKS } from "../src/intelligence/contracts/benchmarks.js";
import { answerTransformationChallenge } from "../src/intelligence/contracts/answers.js";
import { learnContract } from "../src/intelligence/contracts/builder.js";
import { generateTransformationChallenges } from "../src/intelligence/contracts/challenges.js";
import {
  acceptTransformationInvariants,
  evaluateTransformationInvariants,
} from "../src/intelligence/contracts/invariants.js";
import {
  approveContract,
  revokeContract,
  supersedeContract,
} from "../src/intelligence/contracts/lifecycle.js";
import { compareContracts } from "../src/intelligence/contracts/comparison.js";
import {
  checkContract,
  runContract,
} from "../src/intelligence/contracts/execution.js";
import { runTransformationMutationSuite } from "../src/intelligence/contracts/mutations.js";
import { validateTransformationContract } from "../src/intelligence/contracts/schema.js";

function readFixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`../fixtures/contracts/${name}`, import.meta.url), "utf8"));
}

const fixtures = new Map();
const getFixture = name => {
  if (!fixtures.has(name)) fixtures.set(name, readFixture(name));
  return fixtures.get(name);
};

const runsPerCase = 250;
const learningRunsPerCase = 25;
const challengeRunsPerCase = 25;
const mutationRunsPerCase = 25;
const comparisonRunsPerCase = 25;
const runtimeRunsPerCase = 3;
const results = [];
let failed = 0;

function approvedRuntimeContract() {
  const fixture = getFixture("invariant-cases.json");
  const learned = learnContract(fixture.task);
  const suggestionIds = learned.extensions.latentmachine.invariantSuggestions
    .map(item => item.id);
  const guarded = acceptTransformationInvariants(learned, [
    ...suggestionIds,
    {
      id: "inv_benchmark_key_set",
      kind: "key_set_preserved",
      scope: "batch",
      severity: "blocking",
      parameters: {
        inputKeyPath: "$.id",
        outputKeyPath: "$.customerId",
      },
    },
    {
      id: "inv_benchmark_input_key_unique",
      kind: "key_unique",
      scope: "batch",
      severity: "blocking",
      parameters: {
        subject: "input",
        keyPath: "$.id",
      },
    },
    {
      id: "inv_benchmark_output_key_unique",
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
    note: "Approved runtime performance benchmark.",
  });
}

function runtimeSignature(report) {
  return {
    kind: report.kind,
    contractFingerprint: report.contractFingerprint,
    verdict: report.verdict,
    totals: report.totals,
    firstRowId: report.records[0]?.rowId || null,
    lastRowId: report.records.at(-1)?.rowId || null,
    trace: report.trace,
  };
}

for (const benchmark of TRANSFORMATION_CONTRACT_BENCHMARKS) {
  try {
    const fixture = getFixture(benchmark.fixture);
    const baseline = benchmark.compareFixture ? getFixture(benchmark.compareFixture) : null;
    const startedAt = performance.now();
    let validation;

    for (let index = 0; index < runsPerCase; index += 1) {
      validation = validateTransformationContract(fixture);
    }

    const durationMs = performance.now() - startedAt;
    assert.equal(validation.ok, benchmark.expected.valid, `${benchmark.id} validity`);

    if (benchmark.expected.errorCode) {
      assert.ok(validation.errors.some(error => error.code === benchmark.expected.errorCode), `${benchmark.id} should report ${benchmark.expected.errorCode}`);
    }
    if (baseline) {
      assert.equal(
        fixture.identity.coreFingerprint === baseline.identity.coreFingerprint,
        benchmark.expected.sameCoreFingerprint,
        `${benchmark.id} core identity relation`,
      );
      assert.equal(
        fixture.identity.programFingerprint === baseline.identity.programFingerprint,
        benchmark.expected.sameProgramFingerprint,
        `${benchmark.id} program identity relation`,
      );
    }

    results.push({
      id: benchmark.id,
      kind: "validation",
      passed: true,
      runs: runsPerCase,
      averageDurationMs: Number((durationMs / runsPerCase).toFixed(3)),
    });
    console.log(`PASS ${benchmark.id}: ${runsPerCase} deterministic validations`);
  } catch (error) {
    failed += 1;
    results.push({ id: benchmark.id, kind: "validation", passed: false, error: error.message });
    console.error(`FAIL ${benchmark.id}: ${error.message}`);
  }
}

const learningFixture = readFixture("learning-cases.json");
const learningCases = [...learningFixture.statusCases, ...learningFixture.formatCases];

for (const benchmark of learningCases) {
  try {
    const durations = [];
    let contract;
    let expectedFingerprint;
    for (let index = 0; index < learningRunsPerCase; index += 1) {
      const startedAt = performance.now();
      contract = learnContract(benchmark.task);
      durations.push(performance.now() - startedAt);
      expectedFingerprint ??= contract.identity.coreFingerprint;
      assert.equal(contract.identity.coreFingerprint, expectedFingerprint, `${benchmark.id} identity must be deterministic`);
    }

    const sortedDurations = [...durations].sort((a, b) => a - b);
    const medianDurationMs = sortedDurations[Math.floor(sortedDurations.length / 2)];
    const expectedStatus = benchmark.expectedStatus || "safe";
    const expectedApprovalState = benchmark.expectedApprovalState || "unreviewed";
    assert.equal(validateTransformationContract(contract).ok, true, `${benchmark.id} contract validity`);
    assert.equal(contract.inference.status, expectedStatus, `${benchmark.id} inference status`);
    assert.equal(contract.lifecycle.approvalState, expectedApprovalState, `${benchmark.id} approval state`);
    assert.deepEqual(contract.program.ops.map(operation => operation.op), benchmark.expectedOperationKinds, `${benchmark.id} operation kinds`);
    if (benchmark.expectedInputFormat) assert.equal(contract.formats.input, benchmark.expectedInputFormat, `${benchmark.id} input format`);
    if (benchmark.expectedOutputFormat) assert.equal(contract.formats.output, benchmark.expectedOutputFormat, `${benchmark.id} output format`);
    assert.ok(medianDurationMs <= 250, `${benchmark.id} median ${medianDurationMs.toFixed(1)}ms exceeded the 250ms learning budget`);

    results.push({
      id: benchmark.id,
      kind: "learning",
      passed: true,
      runs: learningRunsPerCase,
      medianDurationMs: Number(medianDurationMs.toFixed(3)),
      maximumDurationMs: Number(Math.max(...durations).toFixed(3)),
    });
    console.log(`PASS ${benchmark.id}: ${learningRunsPerCase} deterministic contract builds`);
  } catch (error) {
    failed += 1;
    results.push({ id: benchmark.id, kind: "learning", passed: false, error: error.message });
    console.error(`FAIL ${benchmark.id}: ${error.message}`);
  }
}

try {
  const twentyExampleTask = {
    examples: Array.from({ length: 20 }, (_, index) => ({
      input: { source_id: `source-${index}`, value: index },
      output: { id: `source-${index}`, value: index },
    })),
    newInput: { source_id: "source-next", value: 20 },
  };
  const durations = [];
  for (let index = 0; index < learningRunsPerCase; index += 1) {
    const startedAt = performance.now();
    const contract = learnContract(twentyExampleTask);
    durations.push(performance.now() - startedAt);
    assert.equal(contract.inference.status, "safe");
  }
  const sortedDurations = [...durations].sort((a, b) => a - b);
  const medianDurationMs = sortedDurations[Math.floor(sortedDurations.length / 2)];
  assert.ok(medianDurationMs <= 250, `20-example median ${medianDurationMs.toFixed(1)}ms exceeded the 250ms learning budget`);
  results.push({
    id: "learn-performance-20-examples",
    kind: "performance",
    passed: true,
    runs: learningRunsPerCase,
    medianDurationMs: Number(medianDurationMs.toFixed(3)),
    maximumDurationMs: Number(Math.max(...durations).toFixed(3)),
  });
  console.log(`PASS learn-performance-20-examples: median ${medianDurationMs.toFixed(3)}ms`);
} catch (error) {
  failed += 1;
  results.push({ id: "learn-performance-20-examples", kind: "performance", passed: false, error: error.message });
  console.error(`FAIL learn-performance-20-examples: ${error.message}`);
}

const challengeFixture = readFixture("challenge-cases.json");
for (const benchmark of challengeFixture.evidenceCases) {
  try {
    const initial = learnContract(benchmark.task);
    const challenge = initial.challenges.find(item => item.kind === benchmark.expectedChallengeKind);
    assert.ok(challenge, `${benchmark.id} required challenge`);
    const generationDurations = [];
    let regenerated;
    for (let index = 0; index < challengeRunsPerCase; index += 1) {
      const startedAt = performance.now();
      regenerated = generateTransformationChallenges(initial);
      generationDurations.push(performance.now() - startedAt);
    }
    assert.deepEqual(regenerated.challenges, initial.challenges, `${benchmark.id} challenge generation must be deterministic`);
    const sortedGeneration = [...generationDurations].sort((a, b) => a - b);
    const generationMedianMs = sortedGeneration[Math.floor(sortedGeneration.length / 2)];
    assert.ok(generationMedianMs <= 250, `${benchmark.id} challenge generation exceeded 250ms`);

    const answerDurations = [];
    let revised;
    for (let index = 0; index < challengeRunsPerCase; index += 1) {
      const startedAt = performance.now();
      revised = answerTransformationChallenge(initial, challenge.id, benchmark.answer);
      answerDurations.push(performance.now() - startedAt);
    }
    const sortedAnswers = [...answerDurations].sort((a, b) => a - b);
    const answerMedianMs = sortedAnswers[Math.floor(sortedAnswers.length / 2)];
    assert.equal(revised.inference.status, benchmark.expectedFinalStatus);
    assert.equal(validateTransformationContract(revised).ok, true);
    assert.ok(answerMedianMs <= 250, `${benchmark.id} answer and re-learning exceeded 250ms`);

    results.push({
      id: benchmark.id,
      kind: "challenge",
      passed: true,
      runs: challengeRunsPerCase,
      generationMedianMs: Number(generationMedianMs.toFixed(3)),
      answerMedianMs: Number(answerMedianMs.toFixed(3)),
    });
    console.log(`PASS ${benchmark.id}: deterministic generation and re-learning`);
  } catch (error) {
    failed += 1;
    results.push({ id: benchmark.id, kind: "challenge", passed: false, error: error.message });
    console.error(`FAIL ${benchmark.id}: ${error.message}`);
  }
}

for (const benchmark of challengeFixture.policyCases) {
  try {
    const initial = learnContract(benchmark.task);
    const challenge = initial.challenges.find(item => item.kind === benchmark.expectedChallengeKind);
    const revised = answerTransformationChallenge(initial, challenge.id, { policy: benchmark.policy });
    assert.equal(revised.evidence.count, initial.evidence.count);
    assert.equal(revised.identity.programFingerprint, initial.identity.programFingerprint);
    assert.notEqual(revised.identity.coreFingerprint, initial.identity.coreFingerprint);
    assert.equal(validateTransformationContract(revised).ok, true);
    results.push({
      id: benchmark.id,
      kind: "challenge-policy",
      passed: true,
      runs: 1,
    });
    console.log(`PASS ${benchmark.id}: explicit policy without fabricated evidence`);
  } catch (error) {
    failed += 1;
    results.push({ id: benchmark.id, kind: "challenge-policy", passed: false, error: error.message });
    console.error(`FAIL ${benchmark.id}: ${error.message}`);
  }
}

try {
  const fixture = readFixture("invariant-cases.json");
  const learned = learnContract(fixture.task);
  const selectedIds = learned.extensions.latentmachine.invariantSuggestions
    .filter(item => fixture.acceptedKinds.includes(item.kind))
    .map(item => item.id);
  const accepted = acceptTransformationInvariants(learned, selectedIds);
  const evaluationDurations = [];
  const mutationDurations = [];
  let expectedMutationReport;

  for (let index = 0; index < mutationRunsPerCase; index += 1) {
    let startedAt = performance.now();
    const evaluation = evaluateTransformationInvariants(accepted, fixture.runtime);
    evaluationDurations.push(performance.now() - startedAt);
    assert.equal(evaluation.verdict, "pass");

    startedAt = performance.now();
    const report = runTransformationMutationSuite(accepted, fixture.runtime);
    mutationDurations.push(performance.now() - startedAt);
    expectedMutationReport ??= report;
    assert.deepEqual(report, expectedMutationReport, "mutation report must be deterministic");
  }

  const evaluationMedianMs = [...evaluationDurations].sort((a, b) => a - b)[Math.floor(evaluationDurations.length / 2)];
  const mutationMedianMs = [...mutationDurations].sort((a, b) => a - b)[Math.floor(mutationDurations.length / 2)];
  assert.ok(evaluationMedianMs <= 250, `invariant evaluation exceeded 250ms: ${evaluationMedianMs.toFixed(1)}ms`);
  assert.ok(mutationMedianMs <= 500, `mutation suite exceeded 500ms: ${mutationMedianMs.toFixed(1)}ms`);
  for (const kind of fixture.requiredMutationKinds) {
    assert.equal(expectedMutationReport.mutations.find(item => item.kind === kind)?.detected, true, `${kind} detection`);
  }
  assert.ok(expectedMutationReport.undetected.length > 0, "mutation report should disclose at least one unprotected behavior");

  results.push({
    id: "invariant-evaluation-performance",
    kind: "invariant",
    passed: true,
    runs: mutationRunsPerCase,
    medianDurationMs: Number(evaluationMedianMs.toFixed(3)),
  });
  results.push({
    id: "mutation-suite-performance",
    kind: "mutation",
    passed: true,
    runs: mutationRunsPerCase,
    medianDurationMs: Number(mutationMedianMs.toFixed(3)),
    mutationCount: expectedMutationReport.mutations.length,
    undetectedCount: expectedMutationReport.undetected.length,
  });
  console.log(`PASS invariant-evaluation-performance: median ${evaluationMedianMs.toFixed(3)}ms`);
  console.log(`PASS mutation-suite-performance: ${expectedMutationReport.mutations.length} mutations, median ${mutationMedianMs.toFixed(3)}ms`);
} catch (error) {
  failed += 2;
  results.push({ id: "invariant-evaluation-performance", kind: "invariant", passed: false, error: error.message });
  results.push({ id: "mutation-suite-performance", kind: "mutation", passed: false, error: error.message });
  console.error(`FAIL invariant and mutation benchmarks: ${error.message}`);
}

try {
  const fixture = readFixture("approval-comparison-cases.json");
  const baseline = getFixture("safe-v1.json");
  const replacement = getFixture("behavior-change-v1.json");
  const acknowledgement = {
    coreFingerprint: baseline.identity.coreFingerprint,
    ...fixture.approval,
  };
  const replacementAcknowledgement = {
    coreFingerprint: replacement.identity.coreFingerprint,
    ...fixture.approval,
  };
  const durations = [];
  let expectedApproved;
  let expectedSuperseded;
  let expectedRevoked;

  for (let index = 0; index < comparisonRunsPerCase; index += 1) {
    const startedAt = performance.now();
    const approved = approveContract(baseline, acknowledgement);
    const approvedReplacement = approveContract(replacement, replacementAcknowledgement);
    const superseded = supersedeContract(approved, approvedReplacement);
    const revoked = revokeContract(approved, fixture.revocation);
    durations.push(performance.now() - startedAt);
    expectedApproved ??= approved;
    expectedSuperseded ??= superseded;
    expectedRevoked ??= revoked;
    assert.deepEqual(approved, expectedApproved, "approval must be deterministic");
    assert.deepEqual(superseded, expectedSuperseded, "supersession must be deterministic");
    assert.deepEqual(revoked, expectedRevoked, "revocation must be deterministic");
  }
  const medianDurationMs = [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)];
  assert.ok(medianDurationMs <= 250, `approval lifecycle exceeded 250ms: ${medianDurationMs.toFixed(1)}ms`);
  results.push({
    id: "approval-lifecycle-performance",
    kind: "approval",
    passed: true,
    runs: comparisonRunsPerCase,
    medianDurationMs: Number(medianDurationMs.toFixed(3)),
  });
  console.log(`PASS approval-lifecycle-performance: median ${medianDurationMs.toFixed(3)}ms`);
} catch (error) {
  failed += 1;
  results.push({ id: "approval-lifecycle-performance", kind: "approval", passed: false, error: error.message });
  console.error(`FAIL approval-lifecycle-performance: ${error.message}`);
}

try {
  const baseline = getFixture("safe-v1.json");
  const metadata = getFixture("metadata-only-edit-v1.json");
  const behavior = getFixture("behavior-change-v1.json");
  const durations = [];
  let expectedMetadata;
  let expectedBehavior;

  for (let index = 0; index < comparisonRunsPerCase; index += 1) {
    const startedAt = performance.now();
    const metadataComparison = compareContracts(baseline, metadata);
    const behaviorComparison = compareContracts(baseline, behavior);
    durations.push(performance.now() - startedAt);
    expectedMetadata ??= metadataComparison;
    expectedBehavior ??= behaviorComparison;
    assert.deepEqual(metadataComparison, expectedMetadata, "metadata comparison must be deterministic");
    assert.deepEqual(behaviorComparison, expectedBehavior, "behavior comparison must be deterministic");
  }
  const medianDurationMs = [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)];
  assert.equal(expectedMetadata.classification, "metadata_only");
  assert.equal(expectedMetadata.breaking, false);
  assert.equal(expectedBehavior.classification, "behavioral_change");
  assert.equal(expectedBehavior.breaking, true);
  assert.ok(medianDurationMs <= 250, `contract comparison exceeded 250ms: ${medianDurationMs.toFixed(1)}ms`);
  results.push({
    id: "contract-comparison-performance",
    kind: "comparison",
    passed: true,
    runs: comparisonRunsPerCase,
    medianDurationMs: Number(medianDurationMs.toFixed(3)),
  });
  console.log(`PASS contract-comparison-performance: median ${medianDurationMs.toFixed(3)}ms`);
} catch (error) {
  failed += 1;
  results.push({ id: "contract-comparison-performance", kind: "comparison", passed: false, error: error.message });
  console.error(`FAIL contract-comparison-performance: ${error.message}`);
}

const runtimeRecordCount = 10_000;
const runtimeInput = Array.from({ length: runtimeRecordCount }, (_, index) => ({
  id: `customer-${String(index).padStart(5, "0")}`,
  status: index % 2 === 0 ? "new" : "done",
}));
const runtimeOutput = runtimeInput.map(record => ({
  customerId: record.id,
  state: record.status === "new" ? "N" : "D",
}));

try {
  const contract = approvedRuntimeContract();
  runContract({ contract, input: runtimeInput.slice(0, 10) });
  const durations = [];
  let expectedSignature;
  for (let index = 0; index < runtimeRunsPerCase; index += 1) {
    const startedAt = performance.now();
    const report = runContract({ contract, input: runtimeInput });
    durations.push(performance.now() - startedAt);
    const signature = runtimeSignature(report);
    expectedSignature ??= signature;
    assert.deepEqual(signature, expectedSignature, "large run signature must be deterministic");
    assert.equal(report.verdict, "pass");
    assert.deepEqual(report.totals, {
      input: runtimeRecordCount,
      passed: runtimeRecordCount,
      warned: 0,
      quarantined: 0,
      blocked: 0,
    });
    assert.ok(report.trace.some(event => event.type === "program.executed"));
    assert.ok(report.trace.some(event => event.type === "invariants.evaluated"));
  }
  const medianDurationMs = [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)];
  assert.ok(
    medianDurationMs <= 2_000,
    `10,000-record run median ${medianDurationMs.toFixed(1)}ms exceeded the 2,000ms budget`,
  );
  results.push({
    id: "runtime-run-10000-flat-records",
    kind: "runtime-run",
    passed: true,
    runs: runtimeRunsPerCase,
    recordCount: runtimeRecordCount,
    medianDurationMs: Number(medianDurationMs.toFixed(3)),
    maximumDurationMs: Number(Math.max(...durations).toFixed(3)),
  });
  console.log(`PASS runtime-run-10000-flat-records: median ${medianDurationMs.toFixed(3)}ms`);
} catch (error) {
  failed += 1;
  results.push({
    id: "runtime-run-10000-flat-records",
    kind: "runtime-run",
    passed: false,
    error: error.message,
  });
  console.error(`FAIL runtime-run-10000-flat-records: ${error.message}`);
}

try {
  const contract = approvedRuntimeContract();
  const reorderedOutput = [...runtimeOutput].reverse();
  checkContract({
    contract,
    input: runtimeInput.slice(0, 10),
    output: runtimeOutput.slice(0, 10).reverse(),
  });
  const durations = [];
  let expectedSignature;
  for (let index = 0; index < runtimeRunsPerCase; index += 1) {
    const startedAt = performance.now();
    const report = checkContract({
      contract,
      input: runtimeInput,
      output: reorderedOutput,
    });
    durations.push(performance.now() - startedAt);
    const signature = runtimeSignature(report);
    expectedSignature ??= signature;
    assert.deepEqual(signature, expectedSignature, "large check signature must be deterministic");
    assert.equal(report.verdict, "pass", "keyed output reordering must not create false changes");
    assert.deepEqual(report.totals, {
      input: runtimeRecordCount,
      passed: runtimeRecordCount,
      warned: 0,
      quarantined: 0,
      blocked: 0,
    });
    assert.ok(report.trace.some(event => event.type === "output.parsed"));
    assert.ok(report.trace.some(event => event.type === "program.expected_outputs_computed"));
    assert.ok(report.trace.some(event => event.type === "invariants.evaluated"));
  }
  const medianDurationMs = [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)];
  assert.ok(
    medianDurationMs <= 4_000,
    `10,000-record check median ${medianDurationMs.toFixed(1)}ms exceeded the 4,000ms budget`,
  );
  results.push({
    id: "runtime-check-10000-keyed-records",
    kind: "runtime-check",
    passed: true,
    runs: runtimeRunsPerCase,
    recordCount: runtimeRecordCount,
    medianDurationMs: Number(medianDurationMs.toFixed(3)),
    maximumDurationMs: Number(Math.max(...durations).toFixed(3)),
  });
  console.log(`PASS runtime-check-10000-keyed-records: median ${medianDurationMs.toFixed(3)}ms`);
} catch (error) {
  failed += 1;
  results.push({
    id: "runtime-check-10000-keyed-records",
    kind: "runtime-check",
    passed: false,
    error: error.message,
  });
  console.error(`FAIL runtime-check-10000-keyed-records: ${error.message}`);
}

const summary = {
  total: results.length,
  passed: results.length - failed,
  failed,
  runsPerCase: {
    validation: runsPerCase,
    learning: learningRunsPerCase,
    challenge: challengeRunsPerCase,
    mutation: mutationRunsPerCase,
    comparison: comparisonRunsPerCase,
    runtime: runtimeRunsPerCase,
  },
  results,
};

console.log(JSON.stringify(summary, null, 2));

if (failed) process.exit(1);
