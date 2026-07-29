import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(packageRoot, "..", "..");
const publishRoot = join(packageRoot, "publish");
const temporaryRoot = mkdtempSync(join(tmpdir(), "latentmachine-pack-"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd) {
  const useNpmCli = process.platform === "win32"
    && command.endsWith(".cmd")
    && process.env.npm_execpath;
  const executable = useNpmCli ? process.execPath : command;
  const executableArgs = useNpmCli ? [process.env.npm_execpath, ...args] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with exit code ${result.status}.`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function filesUnder(root, relative = "") {
  const current = join(root, relative);
  return readdirSync(current).flatMap(name => {
    const child = join(relative, name);
    return statSync(join(root, child)).isDirectory()
      ? filesUnder(root, child)
      : [child.replaceAll("\\", "/")];
  });
}

try {
  run(process.execPath, ["packages/verify/scripts/prepare-publish.mjs"], repoRoot);
  const cacheRoot = join(temporaryRoot, "npm-cache");
  run(npmCommand, [
    "pack",
    "--pack-destination", temporaryRoot,
    "--cache", cacheRoot,
  ], publishRoot);

  const tarballName = readdirSync(temporaryRoot).find(name => name.endsWith(".tgz"));
  assert.ok(tarballName, "npm pack should create a tarball");
  run(npmCommand, [
    "init", "--yes",
    "--cache", cacheRoot,
  ], temporaryRoot);
  run(npmCommand, [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--cache", cacheRoot,
    join(temporaryRoot, tarballName),
  ], temporaryRoot);

  const installedRoot = join(temporaryRoot, "node_modules", "@latentmachine", "verify");
  const installedPackage = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
  assert.equal(installedPackage.private, undefined);
  assert.equal(installedPackage.bin.latentmachine, "./bin/latentmachine.js");
  assert.equal(installedPackage.bin["latentmachine-verify"], "./bin/latentmachine.js");
  assert.equal(installedPackage.exports["./contracts"], "./src/contracts.js");

  const installedFiles = filesUnder(installedRoot);
  assert.equal(installedFiles.some(path => /(^|\/)(notes|fixtures|test)(\/|$)/.test(path)), false);
  for (const path of installedFiles.filter(path => path.endsWith(".js"))) {
    assert.equal(
      readFileSync(join(installedRoot, path), "utf8").includes("../../../src/"),
      false,
      `${path} must not contain a monorepo-relative source import`,
    );
  }

  const consumerSource = `
import assert from "node:assert/strict";
import {
  approveContract,
  checkContract,
  learnContract,
  runContract,
  validateTransformationContract,
} from "@latentmachine/verify";

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
const learned = learnContract({ examples }, { evidenceSource: "external-consumer-test" });
assert.equal(validateTransformationContract(learned).ok, true);
const approved = approveContract(learned, {
  coreFingerprint: learned.identity.coreFingerprint,
  acknowledgedChallenges: learned.challenges
    .filter(item => item.severity === "advisory" && ["open", "deferred"].includes(item.status))
    .map(item => item.id),
});
const input = [{ id: "evt_003", status: "paid", amount: 5 }];
const run = runContract({ contract: approved, input });
assert.equal(run.verdict, "pass");
const check = checkContract({
  contract: approved,
  input,
  output: run.records.map(record => record.output),
});
assert.equal(check.verdict, "pass");
console.log(JSON.stringify({
  flow: ["learn", "approve", "run", "check"],
  contractId: approved.identity.contractId,
  verdict: check.verdict,
}));
`;
  writeFileSync(join(temporaryRoot, "consumer.mjs"), consumerSource);
  const consumer = run(process.execPath, ["consumer.mjs"], temporaryRoot);
  const result = JSON.parse(consumer.stdout);
  assert.deepEqual(result.flow, ["learn", "approve", "run", "check"]);
  assert.equal(result.verdict, "pass");

  const cli = run(
    process.execPath,
    [join(installedRoot, "bin", "latentmachine.js"), "--help"],
    temporaryRoot,
  );
  assert.match(cli.stdout, /latentmachine contract learn/);

  console.log(JSON.stringify({
    passed: 4,
    package: `${installedPackage.name}@${installedPackage.version}`,
    tarball: tarballName,
    installedFileCount: installedFiles.length,
    externalFlow: result.flow,
    cliAliases: Object.keys(installedPackage.bin),
  }, null, 2));
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
