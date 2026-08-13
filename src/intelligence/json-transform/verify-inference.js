import { executeJsonTransform } from "./runtime.js";
import { runTransform } from "./translator.js";
import { omitPaths } from "./core.js";
import { deepEqual, stableStringify } from "./shared.js";
import { INFERENCE_EXAMPLE_LIMIT } from "./program-builder.js";

const SEED_SIZE = 6;
const RESTARTS = 12;
const REFITS = 2;
const MAX_CLUSTERS = 3;
function evaluateResult(result, examples) {
  const program = result.rule?.program;
  const ignoredTargets = result.rule?.memorisation?.unverifiableTargets || [];
  const flagged = [];
  examples.forEach(example => {
    const predicted = program ? executeJsonTransform(program, example.input) : null;
    if (!deepEqual(
      omitPaths(predicted, ignoredTargets),
      omitPaths(example.output, ignoredTargets),
    )) {
      flagged.push({
        i: example.i,
        input: example.input,
        predicted,
        actual: example.output,
      });
    }
  });
  return {
    result,
    flagged,
    matched: examples.length - flagged.length,
  };
}

function isMemorised(evaluated) {
  return (evaluated.result.rule?.memorisation?.maxRatio || 0) >= 1;
}

function isRowPermutation(evaluated) {
  if (evaluated.flagged.length < 2) return false;
  const predicted = evaluated.flagged.map(flag => stableStringify(flag.predicted)).sort();
  const actual = evaluated.flagged.map(flag => stableStringify(flag.actual)).sort();
  return deepEqual(predicted, actual);
}

function seededRandom(seed) {
  let state = seed || 0x51f15e;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function sample(items, limit, random) {
  if (items.length <= limit) return [...items];
  const sample = items.slice(0, limit).map((item, index) => [index, item]);
  for (let index = limit; index < items.length; index += 1) {
    const selected = Math.floor(random() * (index + 1));
    if (selected < limit) sample[selected] = [index, items[index]];
  }
  return sample.sort((left, right) => left[0] - right[0]).map(entry => entry[1]);
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

function improves(candidate, best) {
  if (candidate.result.status !== "safe" || isMemorised(candidate) || isRowPermutation(candidate)) return false;
  return candidate.matched > best.matched || isMemorised(best)
    || candidate.matched === best.matched && best.result.status !== "safe";
}

function consensusCandidate(examples, random, seedSize) {
  let training = sample(examples, Math.min(seedSize, Math.max(2, Math.ceil(examples.length / 2))), random);
  let best = null;

  for (let refit = 0; refit < REFITS; refit += 1) {
    const candidate = evaluateResult(runTransform({ examples: training }), examples);
    if (!best || improves(candidate, best)) best = candidate;
    if (!candidate.flagged.length) break;

    const flaggedIndices = new Set(candidate.flagged.map(flag => flag.i));
    const conforming = examples.filter(example => !flaggedIndices.has(example.i));
    if (!conforming.length) break;
    training = sample(conforming, Math.min(INFERENCE_EXAMPLE_LIMIT, conforming.length), random);
  }

  return best;
}

function recoverConsensus(initial, examples, seedSize = SEED_SIZE) {
  let best = initial;
  const random = seededRandom(0x51f15e);
  for (let restart = 0; restart < RESTARTS; restart += 1) {
    const candidate = consensusCandidate(examples, random, seedSize);
    if (candidate && improves(candidate, best)) {
      best = candidate;
    }
    if (!best.flagged.length && !isMemorised(best)) break;
  }
  return best;
}

function clusterFrom(evaluated, examples, totalRows) {
  const flagged = new Set(evaluated.flagged.map(flag => flag.i));
  const supportedRows = examples.map(example => example.i).filter(index => !flagged.has(index));
  const operations = evaluated.result.rule?.program?.ops || [];
  const primary = operations.find(op => op.op !== "set" || op.source !== op.target) || operations[0];
  const sources = [...(primary?.sources || []), primary?.source].filter(Boolean);
  return {
    rule: primary?.op || "unknown",
    signature: [sources.join(" + "), primary?.target].filter(Boolean).join(" → "),
    support: supportedRows.length,
    share: Number((supportedRows.length / totalRows).toFixed(4)),
    rowIndices: supportedRows,
    fit: evaluated,
  };
}

function inferClusters(best, examples) {
  if (best.result.status !== "safe" || isMemorised(best) || best.matched === 0) return { clusters: [] };

  const totalRows = examples.length;
  const clusters = [clusterFrom(best, examples, totalRows)];
  let remaining = best.flagged.map(flag => examples[flag.i]);

  while (remaining.length >= 2 && clusters.length < MAX_CLUSTERS) {
    const initial = evaluateResult(runTransform({ examples: remaining }), remaining);
    const recovered = initial.flagged.length && remaining.length > 2
      ? recoverConsensus(initial, remaining)
      : initial;
    if (recovered.result.status !== "safe" || isMemorised(recovered) || recovered.matched === 0) break;

    const cluster = clusterFrom(recovered, remaining, totalRows);
    if (!cluster.support || clusters.some(existing => deepEqual(existing.rowIndices, cluster.rowIndices))) break;
    clusters.push(cluster);
    const supported = new Set(cluster.rowIndices);
    remaining = remaining.filter(example => !supported.has(example.i));
  }

  clusters.sort((a,b) => b.support-a.support);
  return { clusters, unexplained: remaining.map(example => example.i) };
}

export function inferVerifyRule(originals, outputs) {
  const examples = originals.map((input, index) => ({ i: index, input, output: outputs[index] }));
  const fullResult = runTransform({ examples });
  let best = evaluateResult(fullResult, examples);

  const strongReplay = best.flagged.length > 0
    && best.matched / originals.length >= 0.95;
  const shouldSearch = !strongReplay && (
    ["unsafe", "ambiguous", "contradictory", "insufficient"].includes(fullResult.status)
    || fullResult.status === "unverified" && isMemorised(best)
    || best.flagged.length === originals.length
  );
  if (originals.length > 2 && originals.length <= 5000 && shouldSearch) {
    const dominantExamples = dominantRepeatedInputExamples(examples);
    if (dominantExamples) {
      const dominantCandidate = evaluateResult(runTransform({ examples: dominantExamples }), examples);
      if (improves(dominantCandidate, best)) {
        best = dominantCandidate;
      }
    }

    const contradictingRows = new Set((fullResult.rule?.memorisation?.nearFits || [])
      .flatMap(({ contradictingRows = [] }) => contradictingRows));
    if (contradictingRows.size) {
      const training = examples.filter(example => !contradictingRows.has(example.i));
      const candidate = evaluateResult(runTransform({ examples: training }), examples);
      if (improves(candidate, best)) best = candidate;
    }

    const prefixSize = Math.min(5, Math.max(2, Math.ceil(examples.length / 2)));
    const prefix = evaluateResult(runTransform({ examples: examples.slice(0, prefixSize) }), examples);
    if (improves(prefix, best)) best = prefix;

    best = recoverConsensus(best, examples);
    const hasTemplateConflict = fullResult.rule?.program?.ops?.some(op => op.op === "templateConflict");
    if (!best.matched && hasTemplateConflict) {
      best = recoverConsensus(best, examples, 2);
    }
  }

  const groups = inferClusters(best, examples);
  const main = groups.clusters[0] || null;
  const split = groups.clusters.length > 1;
  const major = main && main.support > originals.length / 2;

  if (major && main.fit !== best) best = evaluateResult(main.fit.result, examples);

  if (split && !major) {
    best = { ...best, flagged: [], matched: main.support };
  }

  return {
    ...best,
    ...(split && !major ? { verdict: "unverifiable" } : {}),
    clusters: groups.clusters.map(({ rule, signature, support, share }, index) => ({
      label: `Rule ${index + 1}`,
      rule,
      signature,
      support,
      share,
    })),
    unexplained: groups.unexplained,
    fullResult,
  };
}
