#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fingerprint, parseWithFormat, profileStructure, structuralDiff, verify } from "../src/index.js";

const args = process.argv.slice(2);

function printHelp() {
  console.log(`Usage:
  latentmachine-verify <original-data-file> <transformed-data-file>
  latentmachine-verify fingerprint <data-file> [--format auto]
  latentmachine-verify fingerprint <data-file-a> <data-file-b> [--format auto]

Verify that transformed rows followed one deterministic rule.
Compute deterministic non-cryptographic fingerprints for structured data.

Arguments:
  original-data-file      JSON, CSV, YAML, TOML, XML, .env, or SQL INSERT input
  transformed-data-file   Transformed output in a supported structured format
  data-file               Structured data input for fingerprinting

Exit codes:
  0  Consistent, or fingerprint command completed with identical inputs
  1  Inconsistent, or fingerprint diff found different inputs
  2  Could not parse or verify input`);
}

function optionValue(options, name, fallback) {
  const index = options.indexOf(name);
  if (index < 0) return fallback;
  return options[index + 1] || fallback;
}

function grouped(hex) {
  return String(hex).replace(/(.{4})(?=.)/g, "$1 ").trim();
}

function parseFile(path, format) {
  return parseWithFormat(readFileSync(path, "utf8"), format);
}

function profileLine(profile) {
  const counts = profile.counts;
  return `profile      ${counts.leaves} values, ${counts.objects} objects, ${counts.arrays} arrays, depth ${profile.maxDepth}, ${profile.outliers} outliers`;
}

function runFingerprint(rawArgs) {
  const optionStart = rawArgs.findIndex(arg => arg.startsWith("--"));
  const paths = optionStart === -1 ? rawArgs : rawArgs.slice(0, optionStart);
  const options = optionStart === -1 ? [] : rawArgs.slice(optionStart);
  const format = optionValue(options, "--format", "auto");

  if (paths.length < 1 || paths.length > 2) {
    printHelp();
    process.exit(1);
  }

  const left = parseFile(paths[0], format);
  const leftFingerprint = fingerprint(left);
  const leftProfile = profileStructure(left);

  if (paths.length === 1) {
    console.log(`fingerprint  ${leftFingerprint.hex}  ${grouped(leftFingerprint.hex)}`);
    console.log(profileLine(leftProfile));
    process.exit(0);
  }

  const right = parseFile(paths[1], format);
  const rightFingerprint = fingerprint(right);
  const diff = structuralDiff(left, right);
  console.log(`fingerprintA ${leftFingerprint.hex}  ${grouped(leftFingerprint.hex)}`);
  console.log(`fingerprintB ${rightFingerprint.hex}  ${grouped(rightFingerprint.hex)}`);
  console.log(`diff         +${diff.counts.added} ~${diff.counts.changed} -${diff.counts.removed} =${diff.counts.same}`);
  process.exit(leftFingerprint.hex === rightFingerprint.hex ? 0 : 1);
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args[0] === "fingerprint") {
  try {
    runFingerprint(args.slice(1));
  } catch (error) {
    console.error(error?.message || "Fingerprint failed.");
    process.exit(2);
  }
}

const [originalPath, transformedPath] = args;

if (!originalPath || !transformedPath) {
  printHelp();
  process.exit(1);
}

try {
  const result = verify({
    original: readFileSync(originalPath, "utf8"),
    transformed: readFileSync(transformedPath, "utf8"),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.verdict === "consistent" ? 0 : 1);
} catch (error) {
  console.error(error?.message || "Verification failed.");
  process.exit(2);
}
