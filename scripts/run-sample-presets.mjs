import { JSON_TRANSFORM_SAMPLES } from "../src/intelligence/json-transform/samples.js";
import { runTransform } from "../src/intelligence/json-transform/translator.js";

const results = [];
const requiredEnvPresets = new Set(["vercel-env-config", "docker-env-runtime", "json-to-env-runtime"]);

for (const sample of JSON_TRANSFORM_SAMPLES) {
  const started = Date.now();
  try {
    const result = runTransform({
      examples: sample.examples,
      newInput: sample.newInput,
      inputFormat: sample.inputFormat || "auto",
      newInputFormat: sample.newInputFormat || sample.inputFormat || "auto",
      outputFormat: sample.outputFormat || "auto",
    });

    const hasOutput = result.output !== undefined && result.serializedOutput !== undefined;
    const failures = [];
    if (!hasOutput) failures.push("no output");
    if (result.status !== "safe") failures.push(`preset should open safe, got ${result.status}`);

    results.push({
      id: sample.id,
      passed: failures.length === 0,
      failures,
      status: result.status,
      outputFormat: result.outputFormat,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    results.push({
      id: sample.id,
      passed: false,
      failures: [error?.message || "Unknown error"],
      durationMs: Date.now() - started,
    });
  }
}

for (const id of requiredEnvPresets) {
  const sample = JSON_TRANSFORM_SAMPLES.find(item => item.id === id);
  const usesEnv = sample?.newInputFormat === "env"
    || sample?.inputFormat === "env"
    || sample?.outputFormat === "env"
    || sample?.examples?.some(example => example.inputFormat === "env" || example.outputFormat === "env");
  results.push({
    id: `${id}-exists`,
    passed: !!sample && usesEnv,
    failures: sample ? ["preset does not use .env"] : ["missing .env preset"],
    status: sample ? "present" : "missing",
    outputFormat: sample?.outputFormat,
    durationMs: 0,
  });
}

const failed = results.filter(result => !result.passed);
console.log(JSON.stringify({
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.map(result => result.id),
  averageDurationMs: Math.round(results.reduce((sum, result) => sum + result.durationMs, 0) / Math.max(1, results.length)),
}, null, 2));

if (failed.length) {
  console.error(failed.map(result => `- ${result.id}: ${result.failures.join("; ")}`).join("\n"));
  process.exit(1);
}
