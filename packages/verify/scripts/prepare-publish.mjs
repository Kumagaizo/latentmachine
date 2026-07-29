import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const repoRoot = join(packageRoot, "..", "..");
const snapshotRoot = join(packageRoot, "publish");
const snapshotEngineRoot = join(snapshotRoot, "src", "_engine");

function copyDirectory(from, to) {
  if (!existsSync(from)) throw new Error(`Missing source directory: ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, force: true });
}

function copyFile(from, to) {
  if (!existsSync(from)) throw new Error(`Missing source file: ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { force: true });
}

rmSync(snapshotRoot, { recursive: true, force: true });
mkdirSync(snapshotRoot, { recursive: true });
copyDirectory(join(packageRoot, "src"), join(snapshotRoot, "src"));
rmSync(snapshotEngineRoot, { recursive: true, force: true });
copyDirectory(join(repoRoot, "src", "vendor"), join(snapshotEngineRoot, "vendor"));
copyDirectory(
  join(repoRoot, "src", "intelligence", "data-formats"),
  join(snapshotEngineRoot, "intelligence", "data-formats"),
);
copyDirectory(
  join(repoRoot, "src", "intelligence", "trace"),
  join(snapshotEngineRoot, "intelligence", "trace"),
);
copyDirectory(
  join(repoRoot, "src", "intelligence", "contracts"),
  join(snapshotEngineRoot, "intelligence", "contracts"),
);
for (const file of [
  "candidates.js",
  "core.js",
  "costs.js",
  "engine.js",
  "explain.js",
  "operations.js",
  "program-builder.js",
  "program-view.js",
  "reliability.js",
  "runtime.js",
  "schema.js",
  "shared.js",
  "suggestions.js",
  "translator.js",
  "verify-inference.js",
]) {
  copyFile(
    join(repoRoot, "src", "intelligence", "json-transform", file),
    join(snapshotEngineRoot, "intelligence", "json-transform", file),
  );
}
copyDirectory(join(packageRoot, "bin"), join(snapshotRoot, "bin"));
cpSync(join(packageRoot, "README.md"), join(snapshotRoot, "README.md"), { force: true });
cpSync(join(packageRoot, "LICENSE"), join(snapshotRoot, "LICENSE"), { force: true });
cpSync(join(packageRoot, "package.json"), join(snapshotRoot, "package.json"), { force: true });

const snapshotPackagePath = join(snapshotRoot, "package.json");
const snapshotPackage = JSON.parse(readFileSync(snapshotPackagePath, "utf8"));
delete snapshotPackage.private;
snapshotPackage.scripts = {};
writeFileSync(snapshotPackagePath, `${JSON.stringify(snapshotPackage, null, 2)}\n`);

const rewriteMap = new Map([
  ["../../../src/intelligence/data-formats/index.js", "./_engine/intelligence/data-formats/index.js"],
  ["../../../src/intelligence/trace/engine.js", "./_engine/intelligence/trace/engine.js"],
  ["../../../src/intelligence/json-transform/verify-inference.js", "./_engine/intelligence/json-transform/verify-inference.js"],
  ["../../../src/intelligence/json-transform/translator.js", "./_engine/intelligence/json-transform/translator.js"],
  ["../../../src/intelligence/json-transform/runtime.js", "./_engine/intelligence/json-transform/runtime.js"],
  ["../../../src/intelligence/contracts/index.js", "./_engine/intelligence/contracts/index.js"],
]);

for (const file of ["verify.js", "infer.js", "transform.js", "formats.js", "fingerprint.js", "contracts.js"]) {
  const path = join(snapshotRoot, "src", file);
  let source = readFileSync(path, "utf8");
  for (const [from, to] of rewriteMap) {
    source = source.replaceAll(from, to);
  }
  writeFileSync(path, source);
}

await import(pathToFileURL(join(snapshotRoot, "src", "index.js")).href);
console.log("Prepared self-contained package snapshot at packages/verify/publish");
