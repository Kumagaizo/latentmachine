import { executeJsonTransform } from "./runtime.js";
import { runTransform } from "./translator.js";
import { deepEqual, stableStringify } from "./shared.js";

function evaluateResult(result, originalRows, transformedRows) {
  const program = result.rule?.program;
  const flagged = [];
  originalRows.forEach((row, index) => {
    const predicted = program ? executeJsonTransform(program, row) : null;
    if (!deepEqual(predicted, transformedRows[index])) {
      flagged.push({ i: index, input: row, predicted, actual: transformedRows[index] });
    }
  });
  return {
    result,
    flagged,
    matched: originalRows.length - flagged.length,
  };
}

function dominantRepeatedInputExamples(examples) {
  const inputGroups = new Map();
  for (const example of examples) {
    const inputKey = stableStringify(example.input);
    const group = inputGroups.get(inputKey) || { input: example.input, outputs: new Map(), count: 0 };
    const outputKey = stableStringify(example.output);
    const output = group.outputs.get(outputKey) || { value: example.output, count: 0 };
    output.count += 1;
    group.outputs.set(outputKey, output);
    group.count += 1;
    inputGroups.set(inputKey, group);
  }

  if (![...inputGroups.values()].some(group => group.outputs.size > 1)) return null;
  const training = [];
  for (const group of inputGroups.values()) {
    const ranked = [...group.outputs.values()].sort((left, right) => right.count - left.count);
    if (!ranked[0] || ranked[0].count === ranked[1]?.count) return null;
    training.push({ input: group.input, output: ranked[0].value });
  }
  return training;
}

export function inferVerifyRule(originalRows, transformedRows) {
  const examples = originalRows.map((input, index) => ({ input, output: transformedRows[index] }));
  const fullResult = runTransform({ examples });
  let best = evaluateResult(fullResult, originalRows, transformedRows);

  if (originalRows.length > 2 && (fullResult.status !== "safe" || best.flagged.length === originalRows.length)) {
    const dominantExamples = dominantRepeatedInputExamples(examples);
    if (dominantExamples) {
      const dominantCandidate = evaluateResult(runTransform({ examples: dominantExamples }), originalRows, transformedRows);
      if (dominantCandidate.result.status === "safe" && dominantCandidate.matched > best.matched) {
        best = { ...dominantCandidate, trainedOn: "the dominant output for each repeated input" };
      }
    }

    const prefixSize = Math.min(5, Math.max(2, Math.ceil(examples.length / 2)));
    const prefixCandidate = evaluateResult(runTransform({ examples: examples.slice(0, prefixSize) }), originalRows, transformedRows);
    if (prefixCandidate.result.status === "safe" && prefixCandidate.matched > best.matched) {
      best = { ...prefixCandidate, trainedOn: `first ${prefixSize} rows` };
    }

    for (let omitted = 0; omitted < examples.length; omitted++) {
      const training = examples.filter((_, index) => index !== omitted);
      const candidate = evaluateResult(runTransform({ examples: training }), originalRows, transformedRows);
      const candidateSafe = candidate.result.status === "safe";
      const bestSafe = best.result.status === "safe";
      if (
        candidateSafe && (!bestSafe || candidate.matched > best.matched)
        || candidateSafe === bestSafe && candidate.matched > best.matched
      ) {
        best = { ...candidate, omitted };
      }
    }
  }

  return { ...best, fullResult };
}
