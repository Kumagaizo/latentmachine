import { executeJsonTransform } from "./runtime.js";
import { runTransform } from "./translator.js";
import { deepEqual } from "./shared.js";

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

export function inferVerifyRule(originalRows, transformedRows) {
  const examples = originalRows.map((input, index) => ({ input, output: transformedRows[index] }));
  const fullResult = runTransform({ examples });
  let best = evaluateResult(fullResult, originalRows, transformedRows);

  if (originalRows.length > 2 && (fullResult.status !== "safe" || best.flagged.length === originalRows.length)) {
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
