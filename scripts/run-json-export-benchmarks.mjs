import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  generateCLIExport,
  generateJavaScriptTransform,
  generateMakeCode,
  generateN8nCode,
  generatePlainFunction,
  runJsonTransform,
  runTransform,
} from "../src/intelligence/json-transform/index.js";
import { JSON_TRANSFORM_BENCHMARKS } from "../src/intelligence/json-transform/benchmarks.js";

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function importGeneratedFunction(source, id) {
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(`${source}\n//# sourceURL=latentmachine-export-${id}.mjs`)}`;
  return import(url);
}

function evaluateTransform(source) {
  return new Function(`${source}\nreturn transform;`)();
}

async function assertExportSyntax(result, id) {
  const javascript = generateJavaScriptTransform(result);
  evaluateTransform(javascript);
  await importGeneratedFunction(generatePlainFunction(result), `${id}-plain-syntax`);
  new Function(generateMakeCode(result));
  new Function(generateN8nCode(result));
}

const runnable = JSON_TRANSFORM_BENCHMARKS;

const results = [];
let syntaxChecked = 0;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "latentmachine-cli-export-"));

try {
  for (const task of runnable) {
    const result = runJsonTransform(task);
    const engineExact = deepEqual(result.output, task.expectedOutput);
    const generated = generatePlainFunction(result);
    let exportedOutput = null;
    let error = null;
    let cliOutput = null;
    let cliError = null;
    let cliExit = null;
    let cliSurfaceError = null;

    try {
      const mod = await importGeneratedFunction(generated, task.id);
      exportedOutput = mod.transform(task.newInput);
    } catch (caught) {
      error = caught?.message || String(caught);
    }

    if (result.status === "safe") {
      const safeId = task.id.replace(/[^a-z0-9_-]/gi, "_");
      const filename = `latentmachine-${safeId}-cli.mjs`;
      const cliPath = path.join(tempDir, filename);
      try {
        await assertExportSyntax(result, task.id);
        syntaxChecked += 4;

        await writeFile(cliPath, generateCLIExport(result, {
          filename,
          sampleInputText: JSON.stringify(task.newInput),
          sampleOutput: result.output,
        }), "utf8");
        const cli = spawnSync(process.execPath, [cliPath, "--output", "json"], {
          input: JSON.stringify(task.newInput),
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        });
        cliExit = cli.status;
        if (cli.error) throw cli.error;
        if (cli.status !== 0) {
          cliError = cli.stderr || `CLI exited ${cli.status}`;
        } else {
          cliOutput = JSON.parse(cli.stdout);
        }

        const explicitStdout = spawnSync(process.execPath, [cliPath, "--output", "json", "--stdout"], {
          input: JSON.stringify(task.newInput),
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        });
        if (explicitStdout.status !== 0 || !deepEqual(JSON.parse(explicitStdout.stdout), result.output)) {
          throw new Error("--stdout did not preserve default stdout output behavior");
        }

        const info = spawnSync(process.execPath, [cliPath, "--info"], { encoding: "utf8" });
        if (info.status !== 0) throw new Error(`--info exited ${info.status}`);
        const parsedInfo = JSON.parse(info.stdout);
        if (parsedInfo.meta.cliVersion !== 3) throw new Error("--info did not expose CLI v3 metadata");
        if (parsedInfo.meta.filename !== filename) throw new Error("--info did not expose the exported filename");
        if (!parsedInfo.sample.available) throw new Error("--info did not expose baked self-test sample metadata");

        const readme = spawnSync(process.execPath, [cliPath, "--readme"], { encoding: "utf8" });
        if (readme.status !== 0 || !readme.stdout.includes("CI pattern")) throw new Error("--readme did not print usage guidance");
        if (!readme.stdout.includes(`node ${filename} --self-test`)) throw new Error("--readme did not use the exported filename");

        const sampleInput = spawnSync(process.execPath, [cliPath, "--sample-input"], { encoding: "utf8" });
        if (sampleInput.status !== 0 || !deepEqual(JSON.parse(sampleInput.stdout), task.newInput)) {
          throw new Error("--sample-input did not print the baked sample input");
        }

        const sampleOutput = spawnSync(process.execPath, [cliPath, "--sample-output"], { encoding: "utf8" });
        if (sampleOutput.status !== 0 || !deepEqual(JSON.parse(sampleOutput.stdout), result.output)) {
          throw new Error("--sample-output did not print the baked sample output");
        }

        const selfTest = spawnSync(process.execPath, [cliPath, "--self-test"], { encoding: "utf8" });
        if (selfTest.status !== 0 || !selfTest.stdout.includes("self-test passed")) {
          throw new Error(`--self-test failed: ${selfTest.stderr || selfTest.stdout}`);
        }

        const dryRun = spawnSync(process.execPath, [cliPath, "--dry-run"], {
          input: JSON.stringify(task.newInput),
          encoding: "utf8",
        });
        if (dryRun.status !== 0) throw new Error(`--dry-run exited ${dryRun.status}`);

        const outputPath = path.join(tempDir, `${safeId}.out.json`);
        const reportPath = path.join(tempDir, `${safeId}.report.json`);
        const fileRun = spawnSync(process.execPath, [cliPath, "--output", "json", "--out", outputPath, "--report", reportPath], {
          input: JSON.stringify(task.newInput),
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        });
        if (fileRun.status !== 0) throw new Error(`--out/--report exited ${fileRun.status}: ${fileRun.stderr}`);
        const fileOutput = JSON.parse(await readFile(outputPath, "utf8"));
        if (!deepEqual(fileOutput, result.output)) throw new Error("--out file did not match engine output");
        const report = JSON.parse(await readFile(reportPath, "utf8"));
        if (report.exitCode !== 0 || report.status !== "success" || report.summary.totalRecords < 1) {
          throw new Error("--report did not capture a clean successful run");
        }
        if (!report.startedAt || typeof report.durationMs !== "number" || report.inputSource?.type !== "stdin" || report.outputTarget?.type !== "file") {
          throw new Error("--report did not capture run timing and IO target metadata");
        }

        const printReportOutputPath = path.join(tempDir, `${safeId}.print-report.out.json`);
        const printReportRun = spawnSync(process.execPath, [cliPath, "--output", "json", "--out", printReportOutputPath, "--print-report"], {
          input: JSON.stringify(task.newInput),
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        });
        if (printReportRun.status !== 0) throw new Error(`--print-report exited ${printReportRun.status}: ${printReportRun.stderr}`);
        const printReportOutput = JSON.parse(await readFile(printReportOutputPath, "utf8"));
        if (!deepEqual(printReportOutput, result.output)) throw new Error("--print-report run did not write transformed output to --out");
        const printedReport = JSON.parse(printReportRun.stdout);
        if (printedReport.status !== "success" || printedReport.outputTarget?.path !== printReportOutputPath) {
          throw new Error("--print-report did not print report JSON to stdout");
        }
      } catch (caught) {
        cliSurfaceError = caught?.message || String(caught);
        cliError = cliError || cliSurfaceError;
      }
    }

    const exportExact = !error && deepEqual(exportedOutput, task.expectedOutput);
    const cliExact = result.status !== "safe" || (!cliError && cliExit === 0 && deepEqual(cliOutput, result.output));
    results.push({
      id: task.id,
      status: result.status,
      engineExact,
      exportExact,
      cliExact,
      expected: task.expectedOutput,
      predicted: exportedOutput,
      cliOutput,
      error,
      cliError,
      cliSurfaceError,
      cliExit,
    });
  }

  const warningTask = JSON_TRANSFORM_BENCHMARKS.find(row => row.id === "value-map");
  if (warningTask) {
    const result = runJsonTransform(warningTask);
    const cliPath = path.join(tempDir, "latentmachine-warning-behavior-cli.mjs");
    const reportPath = path.join(tempDir, "warning-behavior.report.json");
    const outputPath = path.join(tempDir, "warning-behavior.out.json");
    let error = null;
    try {
      await writeFile(cliPath, generateCLIExport(result, {
        filename: "latentmachine-warning-behavior-cli.mjs",
        sampleInputText: JSON.stringify(warningTask.newInput),
        sampleOutput: result.output,
      }), "utf8");
      const warningInput = JSON.stringify({ status: "archived" });
      const defaultRun = spawnSync(process.execPath, [cliPath, "--output", "json"], {
        input: warningInput,
        encoding: "utf8",
      });
      if (defaultRun.status !== 1) throw new Error(`warning default exit expected 1, got ${defaultRun.status}`);

      const warningsOkRun = spawnSync(process.execPath, [cliPath, "--output", "json", "--warnings-ok", "--report", reportPath], {
        input: warningInput,
        encoding: "utf8",
      });
      if (warningsOkRun.status !== 0) throw new Error(`--warnings-ok exit expected 0, got ${warningsOkRun.status}`);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      if (report.status !== "warning" || report.exitCode !== 0 || report.warningsOk !== true) {
        throw new Error("--warnings-ok report did not preserve warning status with exit 0");
      }

      const printReportRun = spawnSync(process.execPath, [cliPath, "--output", "json", "--warnings-ok", "--out", outputPath, "--print-report"], {
        input: warningInput,
        encoding: "utf8",
      });
      if (printReportRun.status !== 0) throw new Error(`warning --print-report exit expected 0, got ${printReportRun.status}`);
      const printedReport = JSON.parse(printReportRun.stdout);
      if (printedReport.status !== "warning" || printedReport.exitCode !== 0 || printedReport.outputTarget?.type !== "file") {
        throw new Error("--print-report did not preserve warning report status on stdout");
      }

      const strictRun = spawnSync(process.execPath, [cliPath, "--output", "json", "--strict"], {
        input: warningInput,
        encoding: "utf8",
      });
      if (strictRun.status !== 2) throw new Error(`--strict warning exit expected 2, got ${strictRun.status}`);

      const stdoutGuard = spawnSync(process.execPath, [cliPath, "--output", "json", "--out", outputPath, "--stdout"], {
        input: warningInput,
        encoding: "utf8",
      });
      if (stdoutGuard.status !== 2) throw new Error(`--out plus --stdout exit expected 2, got ${stdoutGuard.status}`);

      const printReportGuard = spawnSync(process.execPath, [cliPath, "--output", "json", "--print-report"], {
        input: warningInput,
        encoding: "utf8",
      });
      if (printReportGuard.status !== 2) throw new Error(`--print-report without --out exit expected 2, got ${printReportGuard.status}`);
    } catch (caught) {
      error = caught?.message || String(caught);
    }
    results.push({
      id: "cli-warning-exit-behavior",
      status: "behavior",
      engineExact: true,
      exportExact: !error,
      cliExact: !error,
      error,
      cliError: error,
    });
  }

  {
    const envTask = {
      examples: [
        { input: { app: "api", environment: "production" }, output: "APP_NAME=api\nAPP_ENV=production\n", outputFormat: "env" },
        { input: { app: "web", environment: "staging" }, output: "APP_NAME=web\nAPP_ENV=staging\n", outputFormat: "env" },
      ],
      newInput: { app: "worker", environment: "production" },
      outputFormat: "env",
    };
    const result = runTransform(envTask);
    const cliPath = path.join(tempDir, "latentmachine-env-output-cli.mjs");
    let error = null;
    try {
      await writeFile(cliPath, generateCLIExport(result, {
        filename: "latentmachine-env-output-cli.mjs",
        sampleInputText: JSON.stringify(envTask.newInput),
        sampleOutput: result.output,
      }), "utf8");
      const run = spawnSync(process.execPath, [cliPath, "--output", "env"], {
        input: JSON.stringify(envTask.newInput),
        encoding: "utf8",
      });
      if (run.status !== 0) throw new Error(`env output CLI exited ${run.status}: ${run.stderr}`);
      if (run.stdout !== "APP_NAME=worker\nAPP_ENV=production\n") {
        throw new Error(`env output CLI mismatch: ${JSON.stringify(run.stdout)}`);
      }
      const selfTest = spawnSync(process.execPath, [cliPath, "--self-test"], { encoding: "utf8" });
      if (selfTest.status !== 0) throw new Error(`env output CLI self-test failed: ${selfTest.stderr || selfTest.stdout}`);
    } catch (caught) {
      error = caught?.message || String(caught);
    }
    results.push({
      id: "cli-env-output",
      status: "behavior",
      engineExact: true,
      exportExact: !error,
      cliExact: !error,
      error,
      cliError: error,
    });
  }

  {
    const envTask = {
      examples: [
        { input: "APP_NAME=api\nAPP_ENV=production\nPORT=3000", inputFormat: "env", output: { app: "api", environment: "production", port: 3000 } },
        { input: "APP_NAME=web\nAPP_ENV=staging\nPORT=8080", inputFormat: "env", output: { app: "web", environment: "staging", port: 8080 } },
      ],
      newInput: "APP_NAME=worker\nAPP_ENV=production\nPORT=9000\nPUBLIC_URL=https://app.example.com/path#fragment\nPRIVATE_KEY=\"line1\nline2\"",
      inputFormat: "env",
      outputFormat: "json",
    };
    const result = runTransform(envTask);
    const cliPath = path.join(tempDir, "latentmachine-env-input-cli.mjs");
    let error = null;
    let output = null;
    try {
      await writeFile(cliPath, generateCLIExport(result, {
        filename: "latentmachine-env-input-cli.mjs",
        sampleInputText: envTask.newInput,
        sampleOutput: result.output,
      }), "utf8");
      const autoRun = spawnSync(process.execPath, [cliPath, "--output", "json"], {
        input: envTask.newInput,
        encoding: "utf8",
      });
      if (autoRun.status !== 0) throw new Error(`env input auto-detect CLI exited ${autoRun.status}: ${autoRun.stderr}`);
      output = JSON.parse(autoRun.stdout);
      if (!deepEqual(output, result.output)) {
        throw new Error(`env input auto-detect output mismatch: ${JSON.stringify(output)}`);
      }

      const explicitRun = spawnSync(process.execPath, [cliPath, "--format", "env", "--output", "json", "--pretty"], {
        input: envTask.newInput,
        encoding: "utf8",
      });
      if (explicitRun.status !== 0) throw new Error(`env input explicit-format CLI exited ${explicitRun.status}: ${explicitRun.stderr}`);
      if (!deepEqual(JSON.parse(explicitRun.stdout), result.output)) {
        throw new Error("--format env output did not match engine output");
      }

      const selfTest = spawnSync(process.execPath, [cliPath, "--self-test"], { encoding: "utf8" });
      if (selfTest.status !== 0 || !selfTest.stdout.includes("self-test passed")) {
        throw new Error(`env input CLI self-test failed: ${selfTest.stderr || selfTest.stdout}`);
      }
    } catch (caught) {
      error = caught?.message || String(caught);
    }
    results.push({
      id: "cli-env-input",
      status: "behavior",
      engineExact: true,
      exportExact: !error,
      cliExact: !error && deepEqual(output, result.output),
      cliOutput: output,
      error,
      cliError: error,
    });
  }

  {
    const tomlTask = {
      examples: [
        { input: "[service]\nname = \"api\"\nport = 3000\nenabled = true", inputFormat: "toml", output: { app: "api", port: 3000, enabled: true } },
        { input: "[service]\nname = \"web\"\nport = 8080\nenabled = false", inputFormat: "toml", output: { app: "web", port: 8080, enabled: false } },
      ],
      newInput: "[service]\nname = \"worker\"\nport = 9000\nenabled = true",
      inputFormat: "toml",
      outputFormat: "json",
    };
    const result = runTransform(tomlTask);
    const cliPath = path.join(tempDir, "latentmachine-toml-input-cli.mjs");
    let error = null;
    let output = null;
    try {
      await writeFile(cliPath, generateCLIExport(result, {
        filename: "latentmachine-toml-input-cli.mjs",
        sampleInputText: tomlTask.newInput,
        sampleOutput: result.output,
      }), "utf8");
      const autoRun = spawnSync(process.execPath, [cliPath, "--output", "json"], {
        input: tomlTask.newInput,
        encoding: "utf8",
      });
      if (autoRun.status !== 0) throw new Error(`toml input auto-detect CLI exited ${autoRun.status}: ${autoRun.stderr}`);
      output = JSON.parse(autoRun.stdout);
      if (!deepEqual(output, result.output)) {
        throw new Error(`toml input auto-detect output mismatch: ${JSON.stringify(output)}`);
      }

      const explicitRun = spawnSync(process.execPath, [cliPath, "--format", "toml", "--output", "json", "--pretty"], {
        input: tomlTask.newInput,
        encoding: "utf8",
      });
      if (explicitRun.status !== 0) throw new Error(`toml input explicit-format CLI exited ${explicitRun.status}: ${explicitRun.stderr}`);
      if (!deepEqual(JSON.parse(explicitRun.stdout), result.output)) {
        throw new Error("--format toml output did not match engine output");
      }

      const selfTest = spawnSync(process.execPath, [cliPath, "--self-test"], { encoding: "utf8" });
      if (selfTest.status !== 0 || !selfTest.stdout.includes("self-test passed")) {
        throw new Error(`toml input CLI self-test failed: ${selfTest.stderr || selfTest.stdout}`);
      }
    } catch (caught) {
      error = caught?.message || String(caught);
    }
    results.push({
      id: "cli-toml-input",
      status: "behavior",
      engineExact: true,
      exportExact: !error,
      cliExact: !error && deepEqual(output, result.output),
      cliOutput: output,
      error,
      cliError: error,
    });
  }

  {
    const result = {
      status: "safe",
      output: { status: "Active", priority: "High" },
      rule: {
        title: "Two value maps",
        display: [],
        program: {
          ops: [
            {
              op: "valueMap",
              source: "$.status",
              target: "$.status",
              map: {
                "\"active\"": "Active",
                "\"inactive\"": "Inactive",
              },
            },
            {
              op: "valueMap",
              source: "$.priority",
              target: "$.priority",
              map: {
                "\"p1\"": "High",
                "\"p2\"": "Normal",
              },
            },
          ],
        },
      },
    };
    let error = null;
    let output = null;
    try {
      const codeByFormat = {
        javascript: generateJavaScriptTransform(result),
        plain: generatePlainFunction(result),
        make: generateMakeCode(result),
        n8n: generateN8nCode(result),
      };
      for (const [format, code] of Object.entries(codeByFormat)) {
        const declarations = code.match(/const map_\d+ = /g) || [];
        const uniqueDeclarations = new Set(declarations);
        if (declarations.length !== 2 || uniqueDeclarations.size !== declarations.length) {
          throw new Error(`${format} expected two unique value-map declarations, got ${JSON.stringify(declarations)}`);
        }
      }
      const transform = evaluateTransform(codeByFormat.javascript);
      output = transform({ status: "active", priority: "p1" });
      if (!deepEqual(output, result.output)) {
        throw new Error(`Generated value maps returned ${JSON.stringify(output)}`);
      }
      const plain = await importGeneratedFunction(codeByFormat.plain, "two-value-maps-plain");
      if (!deepEqual(plain.transform({ status: "active", priority: "p1" }), result.output)) {
        throw new Error("Plain function value maps did not match expected output");
      }
      const makeOutput = new Function("inputData", codeByFormat.make)({ status: "active", priority: "p1" });
      if (!deepEqual(makeOutput, result.output)) {
        throw new Error(`Make value maps returned ${JSON.stringify(makeOutput)}`);
      }
      const n8nOutput = new Function("$input", codeByFormat.n8n)({
        all: () => [{ json: { status: "active", priority: "p1" } }],
      });
      if (!deepEqual(n8nOutput, [{ json: result.output }])) {
        throw new Error(`n8n value maps returned ${JSON.stringify(n8nOutput)}`);
      }
    } catch (caught) {
      error = caught?.message || String(caught);
    }
    results.push({
      id: "export-two-value-map-declarations",
      status: "behavior",
      engineExact: true,
      exportExact: !error,
      cliExact: !error,
      expected: result.output,
      predicted: output,
      error,
      cliError: error,
    });
  }

  {
    const input = { emails: [{ type: "home", value: "t@home.com" }, { type: "work", value: "t@work.com" }] };
    const result = {
      status: "safe",
      output: { email: "t@work.com" },
      rule: {
        title: "Array find",
        display: [],
        program: {
          ops: [
            {
              op: "arrayFind",
              source: "$.emails",
              where: { path: "$.type", equals: "work" },
              extract: "$.value",
              target: "$.email",
            },
          ],
        },
      },
    };
    let error = null;
    let output = null;
    try {
      const javascript = generateJavaScriptTransform(result);
      if (!javascript.includes("const arr =") || !javascript.includes("arr.find(")) {
        throw new Error("arrayFind codegen did not use the single-evaluation local array shape");
      }
      const transform = evaluateTransform(javascript);
      output = transform(input);
      if (!deepEqual(output, result.output)) {
        throw new Error(`JavaScript arrayFind returned ${JSON.stringify(output)}`);
      }
      const plain = await importGeneratedFunction(generatePlainFunction(result), "array-find-plain");
      if (!deepEqual(plain.transform(input), result.output)) {
        throw new Error("Plain function arrayFind did not match expected output");
      }
      const makeOutput = new Function("inputData", generateMakeCode(result))(input);
      if (!deepEqual(makeOutput, result.output)) {
        throw new Error(`Make arrayFind returned ${JSON.stringify(makeOutput)}`);
      }
      const n8nOutput = new Function("$input", generateN8nCode(result))({
        all: () => [{ json: input }],
      });
      if (!deepEqual(n8nOutput, [{ json: result.output }])) {
        throw new Error(`n8n arrayFind returned ${JSON.stringify(n8nOutput)}`);
      }
    } catch (caught) {
      error = caught?.message || String(caught);
    }
    results.push({
      id: "export-array-find-single-evaluation",
      status: "behavior",
      engineExact: true,
      exportExact: !error,
      cliExact: !error,
      expected: result.output,
      predicted: output,
      error,
      cliError: error,
    });
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const failed = results.filter(row => !row.engineExact || !row.exportExact || !row.cliExact || row.error || row.cliError);
const summary = {
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.map(row => row.id),
  cliChecked: results.filter(row => row.status === "safe").length,
  syntaxChecked,
};

console.log(JSON.stringify(summary, null, 2));

if (failed.length) {
  console.error(failed.map(row => {
    if (row.error) return `- ${row.id}: generated export threw ${JSON.stringify(row.error)}.`;
    if (row.cliError) return `- ${row.id}: CLI export failed ${JSON.stringify(row.cliError)}.`;
    if (!row.engineExact) return `- ${row.id}: engine output did not match expected export baseline.`;
    return `- ${row.id}: generated export expected ${JSON.stringify(row.expected)}, got ${JSON.stringify(row.predicted)}.`;
  }).join("\n"));
  process.exit(1);
}
