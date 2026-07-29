import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  approveContract,
  checkContract,
  compareContracts,
  fingerprint,
  generateTransformationChallenges,
  learnContract,
  parseWithFormat,
  profileStructure,
  runContract,
  runTransformationMutationSuite,
  serializeWithFormat,
  structuralDiff,
  transform,
  validateTransformationContract,
  verify,
} from "./index.js";

export const CLI_EXIT = Object.freeze({
  success: 0,
  violation: 1,
  invalid: 2,
  reviewRequired: 3,
});

const VALUE_OPTIONS = new Set([
  "--acknowledge",
  "--fingerprint",
  "--format",
  "--input",
  "--inputs",
  "--method",
  "--note",
  "--out",
  "--output",
  "--report",
]);
const BOOLEAN_OPTIONS = new Set([
  "--acknowledge-all-advisory",
  "--help",
  "--privacy-safe",
]);

class CliError extends Error {
  constructor(message, exitCode = CLI_EXIT.invalid) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

function helpText() {
  return `Usage:
  latentmachine <original-data-file> <transformed-data-file> [--format human]
  latentmachine fingerprint <data-file> [--format auto]
  latentmachine fingerprint <data-file-a> <data-file-b> [--format auto]

  latentmachine contract learn <examples.json> [--out contract.json] [--format human]
  latentmachine contract inspect <contract.json> [--format human]
  latentmachine contract challenge <contract.json> [--inputs candidates.json] [--format human]
  latentmachine contract test <contract.json> [--format human]
  latentmachine contract approve <contract.json> --fingerprint <exact-fingerprint>
      [--acknowledge <challenge-id>] [--acknowledge-all-advisory]
      [--method local-human-review|automated-policy] [--out approved.contract.json]
  latentmachine contract run <approved.contract.json> --input <input-file>
      [--out output-file] [--report report.json] [--privacy-safe] [--format human]
  latentmachine contract check <approved.contract.json> --input <input-file>
      --output <output-file> [--report report.json] [--privacy-safe] [--format human]
  latentmachine contract diff <baseline.json> <candidate.json> [--format human]

Transformation Contract exit codes:
  0  Pass or successful command
  1  Runtime, mutation-test, or contract-check violation
  2  Invalid input, invalid contract, unsupported version, or usage error
  3  Approval required or blocking review state

JSON is written to stdout by default. Diagnostics are written to stderr.
Use --format human for concise terminal output.`;
}

function parseOptions(args) {
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equalsIndex = argument.indexOf("=");
    const name = equalsIndex > 0 ? argument.slice(0, equalsIndex) : argument;
    if (BOOLEAN_OPTIONS.has(name)) {
      if (equalsIndex > 0) throw new CliError(`${name} does not accept a value.`);
      options.set(name, [true]);
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) throw new CliError(`Unknown option ${name}.`);
    const value = equalsIndex > 0 ? argument.slice(equalsIndex + 1) : args[index + 1];
    if (!value || (equalsIndex < 0 && value.startsWith("--"))) {
      throw new CliError(`${name} requires a value.`);
    }
    if (equalsIndex < 0) index += 1;
    options.set(name, [...(options.get(name) || []), value]);
  }
  return { positionals, options };
}

function option(parsed, name, fallback) {
  return parsed.options.get(name)?.at(-1) ?? fallback;
}

function optionList(parsed, name) {
  return parsed.options.get(name) || [];
}

function hasOption(parsed, name) {
  return parsed.options.has(name);
}

function outputMode(parsed) {
  const mode = option(parsed, "--format", "json");
  if (!["json", "human"].includes(mode)) {
    throw new CliError("--format must be json or human for contract commands.");
  }
  return mode;
}

function readText(path, cwd) {
  if (!path) throw new CliError("A file path is required.");
  try {
    return readFileSync(resolve(cwd, path), "utf8");
  } catch (error) {
    throw new CliError(`Could not read ${path}: ${error.message}`);
  }
}

function readJson(path, cwd, label) {
  try {
    return JSON.parse(readText(path, cwd));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`${label} must contain valid JSON: ${error.message}`);
  }
}

function writeArtifact(path, value, cwd, serialized) {
  if (!path) return;
  try {
    writeFileSync(resolve(cwd, path), serialized ?? `${JSON.stringify(value, null, 2)}\n`);
  } catch (error) {
    throw new CliError(`Could not write ${path}: ${error.message}`);
  }
}

function emit(io, mode, value, humanLines) {
  const text = mode === "human"
    ? humanLines.filter(Boolean).join("\n")
    : JSON.stringify(value, null, 2);
  io.stdout.write(`${text}\n`);
}

function contractSummary(contract, validation = validateTransformationContract(contract)) {
  const challenges = Array.isArray(contract?.challenges) ? contract.challenges : [];
  return {
    valid: validation.ok,
    contractId: contract?.identity?.contractId || null,
    coreFingerprint: contract?.identity?.coreFingerprint || null,
    title: contract?.title || null,
    inferenceStatus: contract?.inference?.status || null,
    approvalState: contract?.lifecycle?.approvalState || null,
    revision: contract?.lifecycle?.revision || null,
    examples: contract?.evidence?.count || 0,
    invariants: Array.isArray(contract?.invariants) ? contract.invariants.length : 0,
    challenges: {
      total: challenges.length,
      blockingOpen: challenges.filter(item => (
        item.severity === "blocking" && ["open", "deferred"].includes(item.status)
      )).length,
      advisoryOpen: challenges.filter(item => (
        item.severity === "advisory" && ["open", "deferred"].includes(item.status)
      )).length,
    },
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

function assertContract(value) {
  const validation = validateTransformationContract(value);
  if (!validation.ok) {
    const first = validation.errors[0];
    throw new CliError(
      `Invalid Transformation Contract at ${first?.path || "$"}: ${first?.message || "validation failed"}.`,
    );
  }
  return value;
}

function reportExitCode(report) {
  if (report.verdict === "invalid_contract") {
    return report.errors.some(error => error.code === "approval-required")
      ? CLI_EXIT.reviewRequired
      : CLI_EXIT.invalid;
  }
  return ["quarantine", "block"].includes(report.verdict)
    ? CLI_EXIT.violation
    : CLI_EXIT.success;
}

function runtimeOutput(report) {
  const values = report.records
    .filter(record => record.output !== undefined)
    .map(record => record.output);
  const parsedAsBatch = report.trace.some(event => event.type === "input.parsed" && event.batch);
  return parsedAsBatch ? values : values[0];
}

function runtimeHuman(report) {
  return [
    `Contract ${report.contractId || "unknown"}`,
    `Verdict  ${report.verdict}`,
    `Records  ${report.totals.input} input, ${report.totals.passed} passed, ${report.totals.warned} warned, ${report.totals.quarantined} quarantined, ${report.totals.blocked} blocked`,
    report.errors[0] ? `Error    ${report.errors[0].message}` : "",
  ];
}

function runLegacyFingerprint(args, io, cwd) {
  const parsed = parseOptions(args);
  const format = option(parsed, "--format", "auto");
  if (parsed.positionals.length < 1 || parsed.positionals.length > 2) {
    throw new CliError("fingerprint requires one or two data files.");
  }
  const left = parseWithFormat(readText(parsed.positionals[0], cwd), format);
  const leftFingerprint = fingerprint(left);
  const leftProfile = profileStructure(left);
  if (parsed.positionals.length === 1) {
    io.stdout.write(`fingerprint  ${leftFingerprint.hex}\n`);
    io.stdout.write(`profile      ${leftProfile.counts.leaves} values, ${leftProfile.counts.objects} objects, ${leftProfile.counts.arrays} arrays, depth ${leftProfile.maxDepth}, ${leftProfile.outliers || 0} outliers\n`);
    return CLI_EXIT.success;
  }
  const right = parseWithFormat(readText(parsed.positionals[1], cwd), format);
  const rightFingerprint = fingerprint(right);
  const diff = structuralDiff(left, right);
  io.stdout.write(`fingerprintA ${leftFingerprint.hex}\n`);
  io.stdout.write(`fingerprintB ${rightFingerprint.hex}\n`);
  io.stdout.write(`diff         +${diff.counts.added} ~${diff.counts.changed} -${diff.counts.removed} =${diff.counts.same}\n`);
  return leftFingerprint.hex === rightFingerprint.hex ? CLI_EXIT.success : CLI_EXIT.violation;
}

function runLegacyVerify(args, io, cwd) {
  const parsed = parseOptions(args);
  if (parsed.positionals.length !== 2) {
    throw new CliError("Verification requires original and transformed data files.");
  }
  const result = verify({
    original: readText(parsed.positionals[0], cwd),
    transformed: readText(parsed.positionals[1], cwd),
  });
  const mode = option(parsed, "--format", "json");
  if (!["json", "human"].includes(mode)) throw new CliError("--format must be json or human.");
  emit(io, mode, result, [
    `Verdict      ${result.verdict}`,
    `Rows         ${result.totalRows}`,
    `Flagged      ${result.flaggedRows.length}`,
  ]);
  return result.verdict === "consistent" ? CLI_EXIT.success : CLI_EXIT.violation;
}

function runContractLearn(args, io, cwd) {
  const parsed = parseOptions(args);
  if (parsed.positionals.length !== 1) throw new CliError("contract learn requires one examples JSON file.");
  const value = readJson(parsed.positionals[0], cwd, "Examples");
  const input = Array.isArray(value) ? { examples: value } : value;
  if (!Array.isArray(input?.examples)) throw new CliError("Examples JSON must be an array or an object with an examples array.");
  const contract = learnContract(input, { evidenceSource: "cli" });
  writeArtifact(option(parsed, "--out"), contract, cwd);
  const summary = contractSummary(contract);
  emit(io, outputMode(parsed), contract, [
    `Learned      ${summary.title}`,
    `Contract     ${summary.contractId}`,
    `Fingerprint  ${summary.coreFingerprint}`,
    `Inference    ${summary.inferenceStatus}`,
    `Review       ${summary.challenges.blockingOpen} blocking, ${summary.challenges.advisoryOpen} advisory`,
    option(parsed, "--out") ? `Wrote         ${option(parsed, "--out")}` : "",
  ]);
  return summary.inferenceStatus === "safe" && summary.challenges.blockingOpen === 0
    ? CLI_EXIT.success
    : CLI_EXIT.reviewRequired;
}

function runContractInspect(args, io, cwd) {
  const parsed = parseOptions(args);
  if (parsed.positionals.length !== 1) throw new CliError("contract inspect requires one contract file.");
  const contract = readJson(parsed.positionals[0], cwd, "Contract");
  const validation = validateTransformationContract(contract);
  const summary = contractSummary(contract, validation);
  emit(io, outputMode(parsed), { summary, validation }, [
    `Contract     ${summary.contractId || "invalid"}`,
    `Valid        ${summary.valid ? "yes" : "no"}`,
    `Fingerprint  ${summary.coreFingerprint || "unavailable"}`,
    `Inference    ${summary.inferenceStatus || "unavailable"}`,
    `Approval     ${summary.approvalState || "unavailable"}`,
    `Review       ${summary.challenges.blockingOpen} blocking, ${summary.challenges.advisoryOpen} advisory`,
    validation.errors[0] ? `Error        ${validation.errors[0].path}: ${validation.errors[0].message}` : "",
  ]);
  return validation.ok ? CLI_EXIT.success : CLI_EXIT.invalid;
}

function runContractChallenge(args, io, cwd) {
  const parsed = parseOptions(args);
  if (parsed.positionals.length !== 1) throw new CliError("contract challenge requires one contract file.");
  const contract = assertContract(readJson(parsed.positionals[0], cwd, "Contract"));
  const challenged = generateTransformationChallenges(contract);
  let candidateInputCount = 0;
  let candidateOutputs = [];
  const candidatesPath = option(parsed, "--inputs");
  if (candidatesPath) {
    const candidates = readJson(candidatesPath, cwd, "Candidate inputs");
    const values = Array.isArray(candidates) ? candidates : [candidates];
    candidateInputCount = values.length;
    candidateOutputs = values.map((input, index) => {
      try {
        return {
          index,
          input,
          output: transform({ rule: { program: contract.program }, input }),
        };
      } catch (error) {
        return { index, input, error: error.message };
      }
    });
  }
  const open = challenged.challenges.filter(item => ["open", "deferred"].includes(item.status));
  const result = {
    contractId: challenged.identity.contractId,
    coreFingerprint: challenged.identity.coreFingerprint,
    candidateInputCount,
    candidateOutputs,
    challenges: open,
  };
  emit(io, outputMode(parsed), result, [
    `Contract     ${result.contractId}`,
    `Candidates   ${candidateInputCount}`,
    `Challenges   ${open.length}`,
    ...open.map(item => `${item.severity.padEnd(12)} ${item.question}`),
  ]);
  return CLI_EXIT.success;
}

function runContractTest(args, io, cwd) {
  const parsed = parseOptions(args);
  if (parsed.positionals.length !== 1) throw new CliError("contract test requires one contract file.");
  const contract = assertContract(readJson(parsed.positionals[0], cwd, "Contract"));
  const report = runTransformationMutationSuite(contract, {
    inputRecords: contract.evidence.examples.map(example => example.input),
    outputRecords: contract.evidence.examples.map(example => example.output),
    failedRecords: [],
  });
  emit(io, outputMode(parsed), report, [
    `Contract     ${report.contractFingerprint}`,
    `Mutations    ${report.mutations.length}`,
    `Detected     ${report.detected.length}`,
    `Gaps         ${report.undetected.length}`,
  ]);
  return report.undetected.length ? CLI_EXIT.violation : CLI_EXIT.success;
}

function runContractApprove(args, io, cwd) {
  const parsed = parseOptions(args);
  if (parsed.positionals.length !== 1) throw new CliError("contract approve requires one contract file.");
  const contract = assertContract(readJson(parsed.positionals[0], cwd, "Contract"));
  const acknowledgedFingerprint = option(parsed, "--fingerprint");
  if (!acknowledgedFingerprint) {
    throw new CliError(
      `Approval requires --fingerprint ${contract.identity.coreFingerprint}.`,
      CLI_EXIT.reviewRequired,
    );
  }
  const advisories = contract.challenges
    .filter(item => item.severity === "advisory" && ["open", "deferred"].includes(item.status))
    .map(item => item.id);
  const acknowledgedChallenges = hasOption(parsed, "--acknowledge-all-advisory")
    ? advisories
    : optionList(parsed, "--acknowledge");
  let approved;
  try {
    approved = approveContract(contract, {
      coreFingerprint: acknowledgedFingerprint,
      method: option(parsed, "--method", "local-human-review"),
      acknowledgedChallenges,
      ...(option(parsed, "--note") ? { note: option(parsed, "--note") } : {}),
    });
  } catch (error) {
    throw new CliError(error.message, CLI_EXIT.reviewRequired);
  }
  writeArtifact(option(parsed, "--out"), approved, cwd);
  emit(io, outputMode(parsed), approved, [
    `Approved     ${approved.identity.contractId}`,
    `Fingerprint  ${approved.identity.coreFingerprint}`,
    `Method       ${approved.approval.method}`,
    `Challenges   ${approved.approval.acknowledgedChallenges.length} acknowledged`,
    option(parsed, "--out") ? `Wrote         ${option(parsed, "--out")}` : "",
  ]);
  return CLI_EXIT.success;
}

function runContractRuntime(command, args, io, cwd) {
  const parsed = parseOptions(args);
  if (parsed.positionals.length !== 1) throw new CliError(`contract ${command} requires one contract file.`);
  const contract = assertContract(readJson(parsed.positionals[0], cwd, "Contract"));
  const inputPath = option(parsed, "--input");
  if (!inputPath) throw new CliError(`contract ${command} requires --input.`);
  const input = readText(inputPath, cwd);
  const options = { privacySafe: hasOption(parsed, "--privacy-safe") };
  const report = command === "run"
    ? runContract({ contract, input, options })
    : checkContract({
      contract,
      input,
      output: readText(option(parsed, "--output"), cwd),
      options,
    });
  if (command === "run" && option(parsed, "--out") && ["pass", "warn"].includes(report.verdict)) {
    const output = runtimeOutput(report);
    const format = contract.formats.output === "value" ? "json" : contract.formats.output;
    writeArtifact(option(parsed, "--out"), output, cwd, `${serializeWithFormat(output, format)}\n`);
  }
  writeArtifact(option(parsed, "--report"), report, cwd);
  emit(io, outputMode(parsed), report, runtimeHuman(report));
  return reportExitCode(report);
}

function runContractDiff(args, io, cwd) {
  const parsed = parseOptions(args);
  if (parsed.positionals.length !== 2) throw new CliError("contract diff requires baseline and candidate contract files.");
  const comparison = compareContracts(
    readJson(parsed.positionals[0], cwd, "Baseline contract"),
    readJson(parsed.positionals[1], cwd, "Candidate contract"),
  );
  emit(io, outputMode(parsed), comparison, [
    `Relation      ${comparison.relation}`,
    `Classification ${comparison.classification}`,
    `Changes       ${comparison.summary?.totalChanges ?? 0}`,
    `Breaking      ${comparison.summary?.breakingChanges ?? 0}`,
    `Reapproval    ${comparison.requiresReapproval ? "required" : "not required"}`,
  ]);
  return comparison.validation?.baseline?.ok && comparison.validation?.candidate?.ok
    ? CLI_EXIT.success
    : CLI_EXIT.invalid;
}

function runContractCommand(args, io, cwd) {
  const [command, ...rest] = args;
  if (!command || command === "--help") {
    io.stdout.write(`${helpText()}\n`);
    return CLI_EXIT.success;
  }
  if (command === "learn") return runContractLearn(rest, io, cwd);
  if (command === "inspect") return runContractInspect(rest, io, cwd);
  if (command === "challenge") return runContractChallenge(rest, io, cwd);
  if (command === "test") return runContractTest(rest, io, cwd);
  if (command === "approve") return runContractApprove(rest, io, cwd);
  if (command === "run") return runContractRuntime(command, rest, io, cwd);
  if (command === "check") {
    const parsed = parseOptions(rest);
    if (!option(parsed, "--output")) throw new CliError("contract check requires --output.");
    return runContractRuntime(command, rest, io, cwd);
  }
  if (command === "diff") return runContractDiff(rest, io, cwd);
  throw new CliError(`Unknown contract command ${command}.`);
}

export function runCli(
  args,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    cwd = process.cwd(),
  } = {},
) {
  const io = { stdout, stderr };
  try {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      stdout.write(`${helpText()}\n`);
      return CLI_EXIT.success;
    }
    if (args[0] === "contract") return runContractCommand(args.slice(1), io, cwd);
    if (args[0] === "fingerprint") return runLegacyFingerprint(args.slice(1), io, cwd);
    return runLegacyVerify(args, io, cwd);
  } catch (error) {
    stderr.write(`${error?.message || "Latentmachine command failed."}\n`);
    return Number.isInteger(error?.exitCode) ? error.exitCode : CLI_EXIT.invalid;
  }
}
