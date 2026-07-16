import { arrayPaths, clone, distinctDefinedValues, getPath, hasPathToken, itemLeafPaths, parsePath, typeOf } from "./core.js";
import { COST_ADJUSTMENT_WEIGHTS, costOf } from "./costs.js";
import { coerce, formatDateParts, normalizeString, parseDateParts, parseQuantity, phonePolicyForExamples, projectArrayRow, titleCase, transformString } from "./operations.js";
import { deepEqual, stableStringify } from "./shared.js";

const SPLIT_SEPARATORS = [" ", ",", "-", "_", "|", "/", "."];

function candidate(id, title, summary, hints, op, target, source = null) {
  return { id, title, summary, cost: costOf(op, hints), op, target, source };
}

function inferDirect(examples, targetPath, targetValues, sourceEntries) {
  return sourceEntries
    .filter(source => examples.every((example, index) => deepEqual(getPath(example.input, source.path), targetValues[index])))
    .map(source => candidate(
      "set",
      source.path === targetPath ? `Keep ${targetPath}` : `Move ${source.path} to ${targetPath}`,
      "Copy a value from the input structure to the target structure.",
      { pathMatch: source.path === targetPath, pathDistance: Math.abs(parsePath(source.path).length - parsePath(targetPath).length) },
      { op: "set", source: source.path, target: targetPath },
      targetPath,
      source.path,
    ));
}

function inferCoerce(examples, targetPath, targetValues, sourceEntries) {
  const targetType = typeOf(targetValues[0]);
  if (!["number", "string", "boolean"].includes(targetType)) return [];
  return sourceEntries
    .filter(source => examples.every((example, index) => deepEqual(coerce(getPath(example.input, source.path), targetType), targetValues[index])))
    .filter(source => examples.some((example, index) => !deepEqual(getPath(example.input, source.path), targetValues[index])))
    .map(source => candidate(
      "coerce",
      `Coerce ${source.path} to ${targetType}`,
      `Convert the source value to ${targetType} before writing it.`,
      {},
      { op: "coerce", source: source.path, to: targetType, target: targetPath },
      targetPath,
      source.path,
    ));
}

function inferStringCase(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => typeof value === "string")) return [];
  const modes = ["upper", "lower", "title", "trim", "trim+upper", "trim+lower", "trim+title"];
  const candidates = [];
  for (const source of sourceEntries.filter(entry => entry.type === "string")) {
    for (const mode of modes) {
      const changesAtLeastOneExample = examples.some(example => transformString(getPath(example.input, source.path), mode) !== getPath(example.input, source.path));
      if (changesAtLeastOneExample && examples.every((example, index) => transformString(getPath(example.input, source.path), mode) === targetValues[index])) {
        candidates.push(candidate(
          "stringCase",
          `${mode} ${source.path}`,
          `Apply ${mode} casing to a source string.`,
          {},
          { op: "stringCase", source: source.path, mode, target: targetPath },
          targetPath,
          source.path,
        ));
      }
    }
  }
  return candidates;
}

function inferStringNormalize(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => typeof value === "string")) return [];
  const modes = [
    { mode: "collapseWhitespace", title: "Normalize whitespace", allowed: () => true },
    { mode: "phone", title: "Normalize phone", allowed: (source, target) => hasPathToken(source.path, /^(phone|tel|mobile)$/) || hasPathToken(target, /^(phone|tel|mobile)$/) },
    { mode: "dateNormalize", title: "Normalize date", allowed: (source, target) => hasPathToken(source.path, /(date|created|updated|login)/) || hasPathToken(target, /(date|created|updated|login)/) },
    { mode: "s3KeyDecode", title: "Decode S3 key", allowed: (source, target) => hasPathToken(source.path, /^(key|object)$/) || hasPathToken(target, /^(key|object)$/) },
  ];
  const candidates = [];
  for (const source of sourceEntries.filter(entry => entry.type === "string")) {
    for (const { mode, title, allowed } of modes) {
      if (!allowed(source, targetPath)) continue;
      const phonePolicy = mode === "phone" ? phonePolicyForExamples(examples, source.path, targetValues) : null;
      const matches = examples.every((example, index) => normalizeString(getPath(example.input, source.path), mode, { phonePolicy }) === targetValues[index]);
      const changes = examples.some((example, index) => String(getPath(example.input, source.path) ?? "") !== targetValues[index]);
      if (!matches || !changes) continue;
      candidates.push(candidate(
        "stringNormalize",
        `${title} from ${source.path}`,
        "Apply a deterministic string cleanup before writing the value.",
        {},
        { op: "stringNormalize", source: source.path, mode, target: targetPath, ...(phonePolicy ? { phonePolicy } : {}) },
        targetPath,
        source.path,
      ));
    }
  }
  return candidates;
}

function inferNumericTransform(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => typeof value === "number")) return [];
  const numericSources = sourceEntries.filter(entry => ["number", "string"].includes(entry.type));
  const candidates = [];
  for (const source of numericSources) {
    const pairs = examples.map((example, index) => ({ from: Number(getPath(example.input, source.path)), to: targetValues[index] }));
    if (!pairs.every(pair => Number.isFinite(pair.from) && Number.isFinite(pair.to))) continue;
    const delta = pairs[0].to - pairs[0].from;
    if (delta !== 0 && pairs.every(pair => pair.from + delta === pair.to)) {
      candidates.push(candidate(
        "numericTransform",
        `Add ${delta} to ${source.path}`,
        "Add a stable offset to a numeric source value.",
        { magnitude: delta },
        { op: "numericTransform", source: source.path, mode: "add", value: delta, target: targetPath },
        targetPath,
        source.path,
      ));
    }
    const factor = pairs[0].from === 0 ? null : pairs[0].to / pairs[0].from;
    if (factor !== null && factor !== 1 && Number.isFinite(factor) && pairs.every(pair => pair.from * factor === pair.to)) {
      candidates.push(candidate(
        "numericTransform",
        `Multiply ${source.path} by ${factor}`,
        "Multiply a numeric source value by a stable factor.",
        { magnitude: factor - 1 },
        { op: "numericTransform", source: source.path, mode: "multiply", value: factor, target: targetPath },
        targetPath,
        source.path,
      ));
    }
  }
  for (const left of numericSources) {
    for (const right of numericSources) {
      if (left.path === right.path) continue;
      const pairs = examples.map((example, index) => ({
        left: Number(getPath(example.input, left.path)),
        right: Number(getPath(example.input, right.path)),
        to: targetValues[index],
      }));
      if (!pairs.every(pair => Number.isFinite(pair.left) && Number.isFinite(pair.right) && Number.isFinite(pair.to))) continue;
      for (const mode of ["add", "subtract", "multiply"]) {
        const valueFor = pair => mode === "add" ? pair.left + pair.right : mode === "subtract" ? pair.left - pair.right : pair.left * pair.right;
        if (pairs.every(pair => valueFor(pair) === pair.to)) {
          candidates.push(candidate(
            "numericBinary",
            `${mode} ${left.path} and ${right.path}`,
            "Combine two numeric source values.",
            {},
            { op: "numericBinary", left: left.path, right: right.path, mode, target: targetPath },
            targetPath,
            left.path,
          ));
        }
      }
    }
  }
  return candidates;
}

function inferQuantityTransform(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => typeof value === "string")) return [];
  const candidates = [];
  for (const source of sourceEntries.filter(entry => entry.type === "string")) {
    const pairs = examples.map((example, index) => ({
      from: parseQuantity(getPath(example.input, source.path)),
      to: parseQuantity(targetValues[index]),
    }));
    if (!pairs.every(pair => pair.from && pair.to && pair.from.unit === pair.to.unit && pair.from.amount !== 0)) continue;
    const factor = pairs[0].to.amount / pairs[0].from.amount;
    if (!Number.isFinite(factor) || factor === 1) continue;
    if (!pairs.every(pair => Math.abs(pair.from.amount * factor - pair.to.amount) < 0.000001)) continue;
    candidates.push(candidate(
      "quantityTransform",
      `Scale quantity ${source.path} by ${factor}`,
      "Scale a resource quantity while preserving its unit suffix.",
      { magnitude: factor - 1 },
      { op: "quantityTransform", source: source.path, factor, unit: pairs[0].from.unit, target: targetPath },
      targetPath,
      source.path,
    ));
  }
  return candidates;
}

function inferBooleanNot(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => typeof value === "boolean")) return [];
  return sourceEntries
    .filter(source => source.type === "boolean")
    .filter(source => examples.every((example, index) => !getPath(example.input, source.path) === targetValues[index]))
    .map(source => candidate(
      "booleanNot",
      `Invert ${source.path}`,
      "Invert a boolean source value.",
      {},
      { op: "booleanNot", source: source.path, target: targetPath },
      targetPath,
      source.path,
    ));
}

function inferFallback(examples, targetPath, targetValues, sourceEntries) {
  const primitiveSources = sourceEntries.filter(source => !["array", "object", "undefined"].includes(source.type));
  const candidates = [];
  for (const primary of primitiveSources) {
    for (const secondary of primitiveSources) {
      if (primary.path === secondary.path || primary.type !== secondary.type) continue;
      let usedPrimary = false;
      let usedSecondary = false;
      const matches = examples.every((example, index) => {
        const primaryValue = getPath(example.input, primary.path);
        const usePrimary = primaryValue !== undefined && primaryValue !== null && primaryValue !== "";
        usedPrimary ||= usePrimary;
        usedSecondary ||= !usePrimary;
        const selected = usePrimary ? primaryValue : getPath(example.input, secondary.path);
        return deepEqual(selected, targetValues[index]);
      });
      if (!matches || !usedPrimary || !usedSecondary) continue;
      candidates.push(candidate(
        "fallback",
        `Resolve ${targetPath} from available fields`,
        `Use ${primary.path}, falling back to ${secondary.path} when it is empty.`,
        {
          pathMatch: primary.path === targetPath,
          fallbackChainLength: 0,
        },
        { op: "fallback", sources: [primary.path, secondary.path], target: targetPath },
        targetPath,
        primary.path,
      ));
    }
  }
  return candidates;
}

function inferDateFormat(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => typeof value === "string")) return [];
  const modes = ["isoDate", "usSlash", "euSlash", "yearMonth", "year"];
  const candidates = [];
  for (const source of sourceEntries.filter(entry => entry.type === "string")) {
    for (const mode of modes) {
      const matches = examples.every((example, index) => {
        const parts = parseDateParts(getPath(example.input, source.path));
        return formatDateParts(parts, mode) === targetValues[index];
      });
      const changes = examples.some((example, index) => String(getPath(example.input, source.path)) !== targetValues[index]);
      if (matches && changes) {
        candidates.push(candidate(
          "dateFormat",
          `Format date from ${source.path}`,
          "Parse a common date string and write a stable date format.",
          {},
          { op: "dateFormat", source: source.path, mode, target: targetPath },
          targetPath,
          source.path,
        ));
      }
    }
  }
  return candidates;
}

function inferConcat(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => typeof value === "string")) return [];
  const sources = capTemplateSources(sourceEntries.filter(source => source.type === "string"), examples, targetValues);
  const candidates = [];
  for (const first of sources) {
    for (const second of sources) {
      if (first.path === second.path) continue;
      const separators = examples.map((example, index) => {
        const a = getPath(example.input, first.path);
        const b = getPath(example.input, second.path);
        const target = targetValues[index];
        if (typeof a !== "string" || typeof b !== "string") return null;
        return target.startsWith(a) && target.endsWith(b) ? target.slice(a.length, target.length - b.length) : null;
      });
      if (separators.every(separator => separator !== null && separator === separators[0])) {
        candidates.push(candidate(
          "concat",
          `Merge ${first.path} and ${second.path}`,
          "Concatenate source fields with a stable separator.",
          { separator: !!separators[0] },
          { op: "concat", sources: [first.path, second.path], separators: [separators[0]], target: targetPath },
          targetPath,
          first.path,
        ));
      }
    }
  }
  return candidates;
}

function permutations(items, length, prefix = []) {
  if (prefix.length === length) return [prefix];
  return items.flatMap(item => prefix.includes(item) ? [] : permutations(items, length, [...prefix, item]));
}

function sourceRelevanceScore(source, examples, targetValues) {
  return examples.reduce((score, example, index) => {
    const sourceValue = getPath(example.input, source.path);
    const targetValue = targetValues[index];
    if (sourceValue === undefined || targetValue === undefined) return score;
    if (deepEqual(sourceValue, targetValue)) return score + 5;
    if (typeof targetValue === "string") {
      const variants = [
        sourceValue,
        typeof sourceValue === "string" ? sourceValue.toLowerCase() : null,
        typeof sourceValue === "string" ? sourceValue.toUpperCase() : null,
        typeof sourceValue === "string" ? titleCase(sourceValue) : null,
        sourceValue !== null ? String(sourceValue) : null,
      ].filter(value => value !== null && value !== "");
      return score + variants.reduce((sum, value) => sum + (targetValue.includes(String(value)) ? 2 : 0), 0);
    }
    if (typeof targetValue === "number" && ["number", "string"].includes(typeof sourceValue)) return score + 1;
    if (typeof targetValue === "boolean") return score + 1;
    return score;
  }, 0);
}

function prioritizeSources(sources, examples, targetValues) {
  return [...sources].sort((first, second) => sourceRelevanceScore(second, examples, targetValues) - sourceRelevanceScore(first, examples, targetValues));
}

function capTemplateSources(sources, examples, targetValues, limit = 8) {
  return sources.length <= limit ? sources : prioritizeSources(sources, examples, targetValues).slice(0, limit);
}

function relevantSources(examples, targetValues, sourceEntries) {
  return sourceEntries.filter(source => sourceRelevanceScore(source, examples, targetValues) > 0);
}

function sourceModes(source, examples, targetValues) {
  if (source.type !== "string") return ["identity"];
  const modes = ["identity"];
  const sourceValues = examples.map(example => String(getPath(example.input, source.path) ?? ""));
  for (const mode of ["lower", "upper", "title"]) {
    const useful = sourceValues.some((value, index) => {
      const transformed = transformString(value, mode);
      return transformed !== value && typeof targetValues[index] === "string" && targetValues[index].includes(transformed);
    });
    if (useful) modes.push(mode);
  }
  return modes;
}

function modeCombinations(sources, examples, targetValues, index = 0, prefix = []) {
  if (index === sources.length) return [prefix];
  return sourceModes(sources[index], examples, targetValues).flatMap(mode => modeCombinations(sources, examples, targetValues, index + 1, [...prefix, mode]));
}

function dataLiteralPenalty(literals) {
  return literals
    .filter(literal => /[A-Za-z0-9]/.test(literal))
    .reduce((sum, literal) => sum + Math.min(COST_ADJUSTMENT_WEIGHTS.templateLiteralData, literal.replace(/[^A-Za-z0-9]/g, "").length * COST_ADJUSTMENT_WEIGHTS.templateLiteralDataChar), 0);
}

function analyzeTemplateConflict(examples, literalRows, orderedSources, allSources) {
  const changedSlots = literalRows[0]
    .map((_, index) => [...new Set(literalRows.map(row => row[index]))])
    .map((values, index) => ({ index, values }))
    .filter(slot => slot.values.length > 1);
  const used = new Set(orderedSources.map(source => source.path));
  const unusedSources = allSources.filter(source => !used.has(source.path));
  const suggestions = [];
  for (const slot of changedSlots) {
    for (const source of unusedSources) {
      const rows = examples.map((example, exampleIndex) => {
        const expected = String(getPath(example.input, source.path) ?? "");
        const actual = literalRows[exampleIndex]?.[slot.index] ?? "";
        return {
          exampleIndex,
          actual,
          expected,
          matches: !!expected && actual.includes(expected),
        };
      });
      const matchCount = rows.filter(row => row.matches).length;
      if (matchCount > 0 && matchCount < rows.length) {
        suggestions.push({ type: "source-slot-mismatch", source: source.path, slot: slot.index, rows });
      }
    }
  }
  return { changedSlots, suggestions };
}

function inferTemplate(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => typeof value === "string")) return [];
  const sources = capTemplateSources(sourceEntries.filter(source => ["string", "number", "boolean"].includes(source.type)), examples, targetValues);
  const candidates = [];
  for (let length = 1; length <= Math.min(4, sources.length); length++) {
    for (const orderedSources of permutations(sources, length)) {
      for (const modes of modeCombinations(orderedSources, examples, targetValues)) {
        if (modes.some((mode, index) => mode !== "identity" && examples.every(example => transformString(getPath(example.input, orderedSources[index].path), mode) === getPath(example.input, orderedSources[index].path)))) continue;
        const literalRows = examples.map((example, exampleIndex) => {
          const target = targetValues[exampleIndex];
          let cursor = 0;
          const literals = [];
          for (const [sourceIndex, source] of orderedSources.entries()) {
            const raw = getPath(example.input, source.path);
            const fragment = raw === undefined ? "" : transformString(raw, modes[sourceIndex]);
            if (!fragment) return null;
            const foundAt = target.indexOf(fragment, cursor);
            if (foundAt < cursor) return null;
            literals.push(target.slice(cursor, foundAt));
            cursor = foundAt + fragment.length;
          }
          literals.push(target.slice(cursor));
          return literals;
        });
        if (!literalRows.every(Boolean)) continue;
        const first = literalRows[0];
        const stable = literalRows.every(row => row.length === first.length && row.every((literal, index) => literal === first[index]));
        if (!stable) continue;
        const parts = [];
        for (const [index, source] of orderedSources.entries()) {
          if (first[index]) parts.push({ kind: "literal", value: first[index] });
          parts.push({ kind: "source", path: source.path, transform: modes[index] });
        }
        if (first.at(-1)) parts.push({ kind: "literal", value: first.at(-1) });
        const verified = examples.every((example, index) => {
          const output = parts.map(part => {
            if (part.kind === "literal") return part.value;
            const raw = getPath(example.input, part.path);
            return raw === undefined ? "" : transformString(raw, part.transform || "identity");
          }).join("");
          return output === targetValues[index];
        });
        if (!verified) continue;
        const literalPenalty = dataLiteralPenalty(first);
        candidates.push(candidate(
          "template",
          `Build ${targetPath} from ${orderedSources.map(source => source.path).join(", ")}`,
          "Fill a stable string template with source values.",
          { sourceCount: orderedSources.length, literalCount: first.filter(Boolean).length, transformCount: modes.filter(mode => mode !== "identity").length, literalPenalty },
          { op: "template", parts, target: targetPath },
          targetPath,
          orderedSources[0].path,
        ));
      }
    }
  }
  return candidates;
}

function inferTemplateConflicts(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => typeof value === "string")) return [];
  const sources = capTemplateSources(sourceEntries.filter(source => ["string", "number", "boolean"].includes(source.type)), examples, targetValues);
  const conflicts = [];
  for (let length = 1; length <= Math.min(4, sources.length); length++) {
    for (const orderedSources of permutations(sources, length)) {
      const literalRows = examples.map((example, exampleIndex) => {
        const target = targetValues[exampleIndex];
        let cursor = 0;
        const literals = [];
        for (const source of orderedSources) {
          const fragment = String(getPath(example.input, source.path) ?? "");
          if (!fragment) return null;
          const foundAt = target.indexOf(fragment, cursor);
          if (foundAt < cursor) return null;
          literals.push(target.slice(cursor, foundAt));
          cursor = foundAt + fragment.length;
        }
        literals.push(target.slice(cursor));
        return literals;
      });
      if (!literalRows.every(Boolean)) continue;
      const first = literalRows[0];
      const stable = literalRows.every(row => row.length === first.length && row.every((literal, index) => literal === first[index]));
      if (stable) continue;
      const analysis = analyzeTemplateConflict(examples, literalRows, orderedSources, sources);
      conflicts.push(candidate(
        "template-conflict",
        `Examples conflict for ${targetPath}`,
        "The source fields appear in the output, but the fixed words around them are not consistent.",
        { sourceReward: orderedSources.length, changedSlots: analysis.changedSlots.length, suggestions: analysis.suggestions.length },
        {
          op: "templateConflict",
          target: targetPath,
          sources: orderedSources.map(source => source.path),
          conflicts: analysis.changedSlots.map(slot => slot.values),
          suggestions: analysis.suggestions,
        },
        targetPath,
        orderedSources[0].path,
      ));
    }
  }
  return conflicts;
}

function inferSplitPart(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => typeof value === "string")) return [];
  const candidates = [];
  for (const source of sourceEntries.filter(entry => entry.type === "string")) {
    for (const separator of SPLIT_SEPARATORS) {
      for (let index = 0; index < 6; index++) {
        if (examples.every((example, exampleIndex) => String(getPath(example.input, source.path) ?? "").split(separator)[index] === targetValues[exampleIndex])) {
          candidates.push(candidate(
            "splitPart",
            `Split ${source.path}`,
            `Split a source string on ${JSON.stringify(separator)} and take part ${index + 1}.`,
            { index },
            { op: "splitPart", source: source.path, separator, index, target: targetPath },
            targetPath,
            source.path,
          ));
        }
      }
    }
  }
  return candidates;
}

function inferExtractBetween(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => typeof value === "string")) return [];
  const candidates = [];
  for (const source of sourceEntries.filter(entry => entry.type === "string")) {
    const rows = examples.map((example, index) => {
      const text = String(getPath(example.input, source.path) ?? "");
      const target = targetValues[index];
      const start = text.indexOf(target);
      if (start < 0) return null;
      return { text, target, prefix: text.slice(0, start), suffix: text.slice(start + target.length) };
    });
    if (!rows.every(Boolean)) continue;
    const prefix = rows.reduce((current, row) => {
      let length = 0;
      while (length < current.length && length < row.prefix.length && current[current.length - 1 - length] === row.prefix[row.prefix.length - 1 - length]) length++;
      return current.slice(current.length - length);
    }, rows[0].prefix);
    const suffix = rows.reduce((current, row) => {
      let length = 0;
      while (length < current.length && length < row.suffix.length && current[length] === row.suffix[length]) length++;
      return current.slice(0, length);
    }, rows[0].suffix);
    if (!prefix && !suffix) continue;
    const matches = rows.every(row => {
      const start = prefix ? row.text.indexOf(prefix) : 0;
      const from = start + prefix.length;
      const end = suffix ? row.text.indexOf(suffix, from) : row.text.length;
      return start >= 0 && end >= from && row.text.slice(from, end) === row.target;
    });
    if (!matches) continue;
    candidates.push(candidate(
      "extractBetween",
      `Extract text from ${source.path}`,
      "Take the text between stable surrounding markers.",
      { missingPrefix: !prefix, missingSuffix: !suffix },
      { op: "extractBetween", source: source.path, prefix, suffix, target: targetPath },
      targetPath,
      source.path,
    ));
  }
  return candidates;
}

function synthesizePattern(values) {
  if (values.every(value => /^\d+$/.test(value))) {
    const lengths = new Set(values.map(value => value.length));
    return lengths.size === 1 ? `\\d{${[...lengths][0]}}` : "\\d+";
  }
  if (values.every(value => /^[A-Z]+$/.test(value))) {
    const lengths = new Set(values.map(value => value.length));
    return lengths.size === 1 ? `[A-Z]{${[...lengths][0]}}` : "[A-Z]+";
  }
  if (values.every(value => /^[A-Z]+\d+$/.test(value))) return "[A-Z]+\\d+";
  if (values.every(value => /^[a-z]+$/.test(value))) return "[a-z]+";
  if (values.every(value => /^[A-Za-z]+$/.test(value))) return "[A-Za-z]+";
  if (values.every(value => /^\w+$/.test(value))) return "\\w+";
  return null;
}

function regexElementCount(pattern) {
  return pattern.match(/\\[dwsDWS]|\[[^\]]+\]|\./g)?.length || 1;
}

function inferRegexExtract(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => typeof value === "string" && value.length > 0)) return [];
  const pattern = synthesizePattern(targetValues);
  if (!pattern) return [];
  const markerSources = new Set(inferExtractBetween(examples, targetPath, targetValues, sourceEntries).map(item => item.source));
  const candidates = [];
  for (const source of sourceEntries.filter(entry => entry.type === "string" && !markerSources.has(entry.path))) {
    const rows = examples.map((example, index) => ({
      text: String(getPath(example.input, source.path) ?? ""),
      target: targetValues[index],
    }));
    if (!rows.every(row => row.text.includes(row.target))) continue;
    const matches = rows.every(row => {
      const found = [...row.text.matchAll(new RegExp(pattern, "g"))].map(match => match[0]);
      return found.length === 1 && found[0] === row.target;
    });
    if (!matches) continue;
    candidates.push(candidate(
      "regexExtract",
      `Extract patterned text from ${source.path}`,
      `Extract the single value matching /${pattern}/.`,
      { regexComplexity: regexElementCount(pattern), regexGroup: false },
      { op: "regexExtract", source: source.path, pattern, group: 0, target: targetPath },
      targetPath,
      source.path,
    ));
  }
  return candidates;
}

function inferStringSplit(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => Array.isArray(value) && value.every(item => typeof item === "string"))) return [];
  const separators = [", ", ",", "; ", ";", " | ", "|", " - ", " "];
  const candidates = [];
  for (const source of sourceEntries.filter(entry => entry.type === "string")) {
    for (const separator of separators) {
      const matches = examples.every((example, index) => {
        const value = getPath(example.input, source.path);
        if (typeof value !== "string") return false;
        return deepEqual(value.split(separator).map(part => part.trim()), targetValues[index]);
      });
      if (!matches) continue;
      candidates.push(candidate(
        "stringSplit",
        `Split ${source.path} into ${targetPath}`,
        "Split a delimited string into an array of values.",
        {},
        { op: "stringSplit", source: source.path, separator, trim: true, target: targetPath },
        targetPath,
        source.path,
      ));
      break;
    }
  }
  return candidates;
}

function inferArrayStringTransform(examples, targetPath, targetValues, sourceEntries) {
  if (!targetValues.every(value => Array.isArray(value) && value.every(item => typeof item === "string"))) return [];
  const modes = [
    { mode: "trim" },
    { mode: "collapseWhitespace" },
    { mode: "lower" },
    { mode: "upper" },
  ];
  const candidates = [];
  for (const source of sourceEntries.filter(entry => entry.type === "array")) {
    for (const { mode } of modes) {
      const matches = examples.every((example, index) => {
        const values = getPath(example.input, source.path);
        if (!Array.isArray(values) || values.some(value => typeof value !== "string")) return false;
        return deepEqual(values.map(value => normalizeString(value, mode)), targetValues[index]);
      });
      const changes = examples.some((example, index) => !deepEqual(getPath(example.input, source.path), targetValues[index]));
      if (!matches || !changes) continue;
      candidates.push(candidate(
        "arrayStringTransform",
        `${mode} strings in ${source.path}`,
        "Clean each string in an array while preserving the array shape.",
        {},
        { op: "arrayStringTransform", source: source.path, mode, target: targetPath },
        targetPath,
        source.path,
      ));
    }
  }
  return candidates;
}

function inferValueMap(examples, targetPath, targetValues, sourceEntries) {
  if (targetValues.some(value => value && typeof value === "object")) return [];
  const candidates = [];
  for (const source of sourceEntries.filter(entry => !["array", "object"].includes(entry.type))) {
    const map = {};
    let valid = true;
    for (const [index, example] of examples.entries()) {
      const key = JSON.stringify(getPath(example.input, source.path));
      if (Object.prototype.hasOwnProperty.call(map, key) && !deepEqual(map[key], targetValues[index])) valid = false;
      map[key] = clone(targetValues[index]);
    }
    if (valid && Object.keys(map).length >= 2 && !examples.every((example, index) => deepEqual(getPath(example.input, source.path), targetValues[index]))) {
      const sourceKey = pathLeaf(source.path);
      const targetKey = pathLeaf(targetPath);
      const sourceValues = examples.map(example => getPath(example.input, source.path));
      const idPenalty = /(^|_)id$/.test(sourceKey) && !/(^|_)(id|ref|key|value)$/.test(targetKey);
      const numericToTextPenalty = sourceValues.every(value => /^-?\d+(?:\.\d+)?$/.test(String(value))) && targetValues.some(value => typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value));
      const templatedStringPenalty = targetValues.every(value => typeof value === "string")
        && sourceValues.some((value, index) => typeof value === "string" && targetValues[index].toLowerCase().includes(value.toLowerCase()))
      const affinity = nameAffinity(sourceKey, targetKey);
      const nameBonus = targetKey.includes(sourceKey) || sourceKey.includes(targetKey);
      const unrelatedPenalty = !hasNameOverlap(sourceKey, targetKey) && affinity >= 0;
      candidates.push(candidate(
        "valueMap",
        `Map values from ${source.path}`,
        "Use a learned lookup table from example values.",
        { idPenalty, numericToTextPenalty, templatedStringPenalty, nameMatch: nameBonus, unrelated: unrelatedPenalty, affinity },
        { op: "valueMap", source: source.path, map, target: targetPath },
        targetPath,
        source.path,
      ));
    }
  }
  return candidates;
}

function pathLeaf(path) {
  return String(parsePath(path).at(-1) ?? "").toLowerCase();
}

function keyTokens(key) {
  const tokens = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+|_/i)
    .map(token => token.toLowerCase())
    .filter(Boolean);
  const semanticFragments = ["access", "active", "available", "delete", "label", "live", "permission", "status"];
  return uniqueBy(tokens.flatMap(token => [
    token,
    ...semanticFragments.filter(fragment => token !== fragment && token.includes(fragment)),
  ]), token => token);
}

function trigrams(text) {
  const compact = String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (compact.length <= 3) return compact ? [compact] : [];
  return Array.from({ length: compact.length - 2 }, (_, index) => compact.slice(index, index + 3));
}

function hasNameOverlap(sourceKey, targetKey) {
  if (!sourceKey || !targetKey) return false;
  if (sourceKey.includes(targetKey) || targetKey.includes(sourceKey)) return true;
  const sourceTokens = new Set(keyTokens(sourceKey));
  if (keyTokens(targetKey).some(token => sourceTokens.has(token))) return true;
  const sourceTrigrams = new Set(trigrams(sourceKey));
  return trigrams(targetKey).some(token => sourceTrigrams.has(token));
}

function nameAffinity(sourceKey, targetKey) {
  if (!sourceKey || !targetKey) return 0;
  const sourceTokens = new Set(keyTokens(sourceKey));
  const targetTokens = new Set(keyTokens(targetKey));
  const pairings = [
    ["role", "access"],
    ["role", "delete"],
    ["role", "permission"],
    ["access", "delete"],
    ["status", "active"],
    ["status", "available"],
    ["status", "label"],
    ["status", "live"],
    ["state", "status"],
    ["type", "category"],
    ["tier", "plan"],
    ["code", "name"],
    ["id", "key"],
    ["priority", "queue"],
    ["priority", "label"],
    ["fulfillment", "label"],
  ];
  if (pairings.some(([a, b]) => (sourceTokens.has(a) && targetTokens.has(b)) || (sourceTokens.has(b) && targetTokens.has(a)))) return COST_ADJUSTMENT_WEIGHTS.affinityStrong;
  if ([...sourceTokens].some(token => targetTokens.has(token))) return COST_ADJUSTMENT_WEIGHTS.affinityWeak;
  return COST_ADJUSTMENT_WEIGHTS.affinityMismatch;
}

function categoricalSourceScore(sourceKey) {
  if (/^(role|status|type|kind|tier|state|stage|priority|fulfillment|category|source|channel|access)$/.test(sourceKey)) return COST_ADJUSTMENT_WEIGHTS.categoricalStrong;
  if (/(role|status|type|kind|tier|state|stage|priority|fulfillment|category|source|channel|access)$/.test(sourceKey)) return COST_ADJUSTMENT_WEIGHTS.categoricalWeak;
  if (/(^|_)(id|name|title|email|url|date|time)$/.test(sourceKey)) return COST_ADJUSTMENT_WEIGHTS.categoricalBadSource;
  return 0;
}

function inferConditional(examples, targetPath, targetValues, sourceEntries) {
  const distinctTargets = uniqueBy(targetValues, stableStringify);
  if (distinctTargets.length !== 2) return [];
  const candidates = [];
  for (const source of sourceEntries.filter(entry => !["array", "object", "undefined"].includes(entry.type))) {
    const sourceValues = examples.map(example => getPath(example.input, source.path));
    const distinctSourceValues = uniqueBy(sourceValues, stableStringify);
    const categorical = categoricalSourceScore(pathLeaf(source.path));
    if (distinctSourceValues.length === examples.length && categorical >= 0) continue;
    for (const testValue of distinctSourceValues) {
      const thenIndexes = [];
      const elseIndexes = [];
      sourceValues.forEach((value, index) => (deepEqual(value, testValue) ? thenIndexes : elseIndexes).push(index));
      if (!thenIndexes.length || !elseIndexes.length || Math.max(thenIndexes.length, elseIndexes.length) < 2) continue;
      const distinctElseValues = uniqueBy(elseIndexes.map(index => sourceValues[index]), stableStringify);
      const testHasRepeatedEvidence = thenIndexes.length >= 2;
      const elseProvesMultipleAlternatives = distinctElseValues.length >= 2;
      if (!testHasRepeatedEvidence && !elseProvesMultipleAlternatives) continue;
      const thenValue = targetValues[thenIndexes[0]];
      const elseValue = targetValues[elseIndexes[0]];
      const thenConstant = thenIndexes.every(index => deepEqual(targetValues[index], thenValue));
      const elseConstant = elseIndexes.every(index => deepEqual(targetValues[index], elseValue));
      if (!thenConstant || !elseConstant || deepEqual(thenValue, elseValue)) continue;
      const base = {
        source: source.path,
        value: clone(testValue),
        target: targetPath,
      };
      const useNotEquals = !testHasRepeatedEvidence && elseProvesMultipleAlternatives;
      candidates.push(candidate(
        "conditional",
        `Choose ${targetPath} from ${source.path}`,
        `Write one of two values depending on whether ${source.path} ${useNotEquals ? "differs from" : "matches"} the learned condition.`,
        { categorical, conditionalNotEquals: useNotEquals },
        {
          op: "conditional",
          ...base,
          test: useNotEquals ? "notEquals" : "equals",
          then: clone(useNotEquals ? elseValue : thenValue),
          else: clone(useNotEquals ? thenValue : elseValue),
        },
        targetPath,
        source.path,
      ));
    }
  }
  return candidates;
}

function inferValueMapConflicts(examples, targetPath, targetValues, sourceEntries) {
  if (targetValues.some(value => value && typeof value === "object")) return [];
  if (!targetValues.some((value, index) => index > 0 && !deepEqual(value, targetValues[0]))) return [];
  const candidates = [];
  for (const source of sourceEntries.filter(entry => !["array", "object"].includes(entry.type))) {
    const buckets = new Map();
    for (const [index, example] of examples.entries()) {
      const key = JSON.stringify(getPath(example.input, source.path));
      const rows = buckets.get(key) || [];
      rows.push({ exampleId: example.id, inputValue: getPath(example.input, source.path), outputValue: targetValues[index] });
      buckets.set(key, rows);
    }
    const conflicts = [...buckets.values()]
      .map(rows => ({ rows, outputs: uniqueBy(rows.map(row => row.outputValue), stableStringify) }))
      .filter(group => group.outputs.length > 1);
    if (!conflicts.length) continue;
    const sourceKey = pathLeaf(source.path);
    const targetKey = pathLeaf(targetPath);
    const semanticPenalty = hasNameOverlap(sourceKey, targetKey) ? COST_ADJUSTMENT_WEIGHTS.semanticConflictMatch : COST_ADJUSTMENT_WEIGHTS.semanticConflictMismatch;
    candidates.push(candidate(
      "value-map-conflict",
      `Examples conflict for ${targetPath}`,
      "The same source value maps to different target values in the examples.",
      { categorical: categoricalSourceScore(sourceKey), semantic: semanticPenalty },
      {
        op: "valueMapConflict",
        source: source.path,
        target: targetPath,
        conflicts: conflicts.map(group => group.rows),
      },
      targetPath,
      source.path,
    ));
  }
  return candidates;
}

function inferArrayMap(examples, targetPath, targetValues) {
  if (!targetValues.every(Array.isArray)) return [];
  const firstInputArrays = arrayPaths(examples[0].input);
  const candidates = [];
  for (const arrayPath of firstInputArrays) {
    const allRows = examples.flatMap(example => getPath(example.input, arrayPath) || []).filter(row => row && typeof row === "object");
    const extractPaths = itemLeafPaths(allRows);
    const predicatePaths = extractPaths;
    for (const extract of extractPaths) {
      const noFilterMatches = examples.every((example, index) => {
        const rows = getPath(example.input, arrayPath) || [];
        return deepEqual(rows.map(row => getPath(row, extract)), targetValues[index]);
      });
      if (noFilterMatches) {
        candidates.push(candidate(
          "arrayMap",
          `Extract ${extract} from ${arrayPath}`,
          "Map each array item to one of its fields.",
          {},
          { op: "arrayMap", source: arrayPath, extract, target: targetPath },
          targetPath,
          arrayPath,
        ));
      }
      for (const wherePath of predicatePaths) {
        const values = distinctDefinedValues(allRows, wherePath);
        for (const equals of values) {
          const matches = examples.every((example, index) => {
            const rows = getPath(example.input, arrayPath) || [];
            const output = rows.filter(row => deepEqual(getPath(row, wherePath), equals)).map(row => getPath(row, extract));
            return deepEqual(output, targetValues[index]);
          });
          if (matches) {
            candidates.push(candidate(
              "arrayMap",
              `Filter ${arrayPath} then extract ${extract}`,
              `Select array items where ${wherePath} equals ${JSON.stringify(equals)}, then collect ${extract}.`,
              { filtered: true },
              { op: "arrayMap", source: arrayPath, where: { path: wherePath, equals }, extract, target: targetPath },
              targetPath,
              arrayPath,
            ));
          }
        }
      }
    }
  }
  return candidates;
}

function targetObjectMappings(inputRows, outputRows) {
  if (!outputRows.every(row => row && typeof row === "object" && !Array.isArray(row))) return [];
  const inputPaths = itemLeafPaths(inputRows);
  const outputPaths = itemLeafPaths(outputRows);
  const fields = [];
  for (const outputPath of outputPaths) {
    const targetValues = outputRows.map(row => getPath(row, outputPath));
    const source = inputPaths.find(inputPath => inputRows.every((row, index) => deepEqual(getPath(row, inputPath), targetValues[index])));
    if (source) {
      fields.push({ source, target: outputPath });
      continue;
    }
    const decodedSource = inputPaths.find(inputPath => inputRows.every((row, index) => {
      const value = getPath(row, inputPath);
      return typeof value === "string" && deepEqual(normalizeString(value, "s3KeyDecode"), targetValues[index]);
    }));
    if (!decodedSource) return [];
    fields.push({ source: decodedSource, target: outputPath, transform: "s3KeyDecode" });
  }
  return fields;
}

function inferArrayProject(examples, targetPath, targetValues) {
  if (!targetValues.every(Array.isArray)) return [];
  const firstInputArrays = arrayPaths(examples[0].input);
  const candidates = [];
  for (const arrayPath of firstInputArrays) {
    const allRows = examples.flatMap(example => getPath(example.input, arrayPath) || []).filter(row => row && typeof row === "object");
    const predicatePaths = itemLeafPaths(allRows);
    const noFilterMatches = examples.every((example, index) => {
      const rows = getPath(example.input, arrayPath) || [];
      const fields = targetObjectMappings(rows, targetValues[index]);
      return fields.length > 0 && deepEqual(rows.map(row => projectArrayRow(row, fields)), targetValues[index]);
    });
    if (noFilterMatches) {
      const fields = targetObjectMappings(getPath(examples[0].input, arrayPath) || [], targetValues[0]);
      candidates.push(candidate(
        "arrayProject",
        `Project objects from ${arrayPath}`,
        "Map each array item into a reshaped object.",
        {},
        { op: "arrayProject", source: arrayPath, fields, target: targetPath },
        targetPath,
        arrayPath,
      ));
    }
    for (const wherePath of predicatePaths) {
      const values = distinctDefinedValues(allRows, wherePath);
      for (const equals of values) {
        const matches = examples.every((example, index) => {
          const rows = (getPath(example.input, arrayPath) || []).filter(row => deepEqual(getPath(row, wherePath), equals));
          const fields = targetObjectMappings(rows, targetValues[index]);
          return fields.length > 0 && deepEqual(rows.map(row => projectArrayRow(row, fields)), targetValues[index]);
        });
        if (matches) {
          const firstRows = (getPath(examples[0].input, arrayPath) || []).filter(row => deepEqual(getPath(row, wherePath), equals));
          const fields = targetObjectMappings(firstRows, targetValues[0]);
          candidates.push(candidate(
            "arrayProject",
            `Filter and project ${arrayPath}`,
            "Filter array items and map each item into a reshaped object.",
            { filtered: true },
            { op: "arrayProject", source: arrayPath, where: { path: wherePath, equals }, fields, target: targetPath },
            targetPath,
            arrayPath,
          ));
        }
      }
    }
  }
  return candidates;
}

function inferArrayCount(examples, targetPath, targetValues) {
  if (!targetValues.every(value => typeof value === "number")) return [];
  const firstInputArrays = arrayPaths(examples[0].input);
  const candidates = [];
  for (const arrayPath of firstInputArrays) {
    if (examples.every((example, index) => (getPath(example.input, arrayPath) || []).length === targetValues[index])) {
      candidates.push(candidate(
        "arrayCount",
        `Count ${arrayPath}`,
        "Count items in an input array.",
        {},
        { op: "arrayCount", source: arrayPath, target: targetPath },
        targetPath,
        arrayPath,
      ));
    }
    const allRows = examples.flatMap(example => getPath(example.input, arrayPath) || []).filter(row => row && typeof row === "object");
    for (const wherePath of itemLeafPaths(allRows)) {
      const values = distinctDefinedValues(allRows, wherePath);
      for (const equals of values) {
        const matches = examples.every((example, index) => {
          const rows = getPath(example.input, arrayPath) || [];
          return rows.filter(row => deepEqual(getPath(row, wherePath), equals)).length === targetValues[index];
        });
        if (matches) {
          candidates.push(candidate(
            "arrayCount",
            `Count ${arrayPath} where ${wherePath}`,
            "Count input array items matching a stable condition.",
            { filtered: true },
            { op: "arrayCount", source: arrayPath, where: { path: wherePath, equals }, target: targetPath },
            targetPath,
            arrayPath,
          ));
        }
      }
    }
  }
  return candidates;
}

function inferArrayJoin(examples, targetPath, targetValues) {
  if (!targetValues.every(value => typeof value === "string")) return [];
  const firstInputArrays = arrayPaths(examples[0].input);
  const separators = [", ", ",", " | ", "|", " ", "; "];
  const candidates = [];
  for (const arrayPath of firstInputArrays) {
    const allRows = examples.flatMap(example => getPath(example.input, arrayPath) || []);
    const objectRows = allRows.filter(row => row && typeof row === "object" && !Array.isArray(row));
    const extractPaths = objectRows.length ? itemLeafPaths(objectRows) : [null];
    const predicatePaths = objectRows.length ? itemLeafPaths(objectRows) : [];
    for (const extract of extractPaths) {
      for (const separator of separators) {
        const matches = examples.every((example, index) => {
          const rows = getPath(example.input, arrayPath) || [];
          const values = rows.map(row => extract ? getPath(row, extract) : row);
          return values.join(separator) === targetValues[index];
        });
        if (matches) {
          candidates.push(candidate(
            "arrayJoin",
            `Join ${arrayPath}`,
            "Join array values into a string.",
            { extract: !!extract },
            { op: "arrayJoin", source: arrayPath, extract, separator, target: targetPath },
            targetPath,
            arrayPath,
          ));
        }
      }
    }
    for (const wherePath of predicatePaths) {
      const values = [...new Set(objectRows.map(row => JSON.stringify(getPath(row, wherePath))))].map(JSON.parse);
      for (const equals of values) {
        for (const extract of extractPaths.filter(Boolean)) {
          for (const separator of separators) {
            const matches = examples.every((example, index) => {
              const rows = getPath(example.input, arrayPath) || [];
              const output = rows.filter(row => deepEqual(getPath(row, wherePath), equals)).map(row => getPath(row, extract)).join(separator);
              return output === targetValues[index];
            });
            if (matches) {
              candidates.push(candidate(
                "arrayJoin",
                `Filter and join ${arrayPath}`,
                "Filter array items and join one field into a string.",
                { filtered: true, extract: true },
                { op: "arrayJoin", source: arrayPath, where: { path: wherePath, equals }, extract, separator, target: targetPath },
                targetPath,
                arrayPath,
              ));
            }
          }
        }
      }
    }
  }
  return candidates;
}

function inferArrayFind(examples, targetPath, targetValues) {
  if (targetValues.some(value => value && typeof value === "object")) return [];
  const firstInputArrays = arrayPaths(examples[0].input);
  const candidates = [];
  for (const arrayPath of firstInputArrays) {
    const allRows = examples.flatMap(example => getPath(example.input, arrayPath) || []).filter(row => row && typeof row === "object");
    const paths = itemLeafPaths(allRows);
    for (const wherePath of paths) {
      const values = distinctDefinedValues(allRows, wherePath);
      for (const equals of values) {
        for (const extract of paths) {
          if (extract === wherePath) continue;
          const matches = examples.every((example, index) => {
            const rows = getPath(example.input, arrayPath) || [];
            const row = rows.find(item => deepEqual(getPath(item, wherePath), equals));
            return row && deepEqual(getPath(row, extract), targetValues[index]);
          });
          if (matches) {
            candidates.push(candidate(
              "arrayFind",
              `Find ${JSON.stringify(equals)} in ${arrayPath}`,
              "Find the first array item matching a stable condition and extract a field.",
              {},
              { op: "arrayFind", source: arrayPath, where: { path: wherePath, equals }, extract, target: targetPath },
              targetPath,
              arrayPath,
            ));
          }
        }
      }
    }
  }
  return candidates;
}

function groupArrayRows(rows, groupBy, extract) {
  const grouped = Object.create(null);
  for (const row of rows) {
    const keyValue = getPath(row, groupBy);
    const extracted = getPath(row, extract);
    if ((typeof keyValue !== "string" && typeof keyValue !== "number") || extracted === undefined) return null;
    const key = String(keyValue);
    grouped[key] ||= [];
    grouped[key].push(clone(extracted));
  }
  return grouped;
}

export function inferArrayGroupBy(examples, targetPath, targetValues) {
  if (!targetValues.every(value => value && typeof value === "object" && !Array.isArray(value))) return [];
  const candidates = [];
  for (const arrayPath of arrayPaths(examples[0].input)) {
    const exampleRows = examples.map(example => getPath(example.input, arrayPath));
    if (!exampleRows.every(Array.isArray)) continue;
    const allRows = exampleRows.flat();
    if (!allRows.length || !allRows.every(row => row && typeof row === "object" && !Array.isArray(row))) continue;
    const paths = itemLeafPaths(allRows);
    for (const groupBy of paths) {
      const distinctKeyCounts = exampleRows.map(rows => new Set(rows.map(row => {
        const value = getPath(row, groupBy);
        return typeof value === "string" || typeof value === "number" ? String(value) : null;
      }).filter(value => value !== null)).size);
      if (!distinctKeyCounts.some(count => count >= 2)) continue;
      for (const extract of paths) {
        if (extract === groupBy) continue;
        const matches = exampleRows.every((rows, index) => {
          const grouped = groupArrayRows(rows, groupBy, extract);
          return grouped !== null && deepEqual(grouped, targetValues[index]);
        });
        if (!matches) continue;
        const groupName = pathLeaf(groupBy);
        const targetName = pathLeaf(targetPath);
        candidates.push(candidate(
          "arrayGroupBy",
          `Group ${arrayPath} by ${groupBy}`,
          `Partition array items by ${groupBy} and collect ${extract}.`,
          { extract: true, pathMatch: !!groupName && targetName.includes(groupName) },
          { op: "arrayGroupBy", source: arrayPath, groupBy, extract, target: targetPath },
          targetPath,
          arrayPath,
        ));
      }
    }
  }
  return candidates;
}

function inferConstant(targetPath, targetValues) {
  if (!targetValues.every(value => deepEqual(value, targetValues[0]))) return [];
  return [candidate(
    "constant",
    `Set constant ${targetPath}`,
    "Write the same value for every input.",
    {},
    { op: "constant", value: clone(targetValues[0]), target: targetPath },
    targetPath,
  )];
}

export function inferTargetCandidates(examples, targetEntry, sourceEntries) {
  const targetPath = targetEntry.path;
  const targetValues = examples.map(example => getPath(example.output, targetPath));
  const direct = inferDirect(examples, targetPath, targetValues, sourceEntries);
  const coerceCandidates = inferCoerce(examples, targetPath, targetValues, sourceEntries);
  const cheapExact = [...direct, ...coerceCandidates].some(item => item.id === "set" || item.id === "coerce");
  if (cheapExact) {
    return [
      ...direct,
      ...coerceCandidates,
      ...inferStringCase(examples, targetPath, targetValues, sourceEntries),
      ...inferStringNormalize(examples, targetPath, targetValues, sourceEntries),
      ...inferDateFormat(examples, targetPath, targetValues, sourceEntries),
      ...inferQuantityTransform(examples, targetPath, targetValues, sourceEntries),
      ...inferConstant(targetPath, targetValues),
    ].sort((a, b) => a.cost - b.cost);
  }

  const relevant = relevantSources(examples, targetValues, sourceEntries);
  const expensiveSources = relevant.length ? relevant : sourceEntries;
  const templates = inferTemplate(examples, targetPath, targetValues, expensiveSources);
  const templateConflicts = templates.length ? [] : inferTemplateConflicts(examples, targetPath, targetValues, expensiveSources);
  const fullCandidates = [
    ...direct,
    ...coerceCandidates,
    ...inferStringCase(examples, targetPath, targetValues, sourceEntries),
    ...inferStringNormalize(examples, targetPath, targetValues, sourceEntries),
    ...inferDateFormat(examples, targetPath, targetValues, sourceEntries),
    ...inferNumericTransform(examples, targetPath, targetValues, sourceEntries),
    ...inferQuantityTransform(examples, targetPath, targetValues, sourceEntries),
    ...inferBooleanNot(examples, targetPath, targetValues, sourceEntries),
    ...inferFallback(examples, targetPath, targetValues, sourceEntries),
    ...templates,
    ...templateConflicts,
    ...inferConcat(examples, targetPath, targetValues, expensiveSources),
    ...inferSplitPart(examples, targetPath, targetValues, sourceEntries),
    ...inferExtractBetween(examples, targetPath, targetValues, sourceEntries),
    ...inferRegexExtract(examples, targetPath, targetValues, sourceEntries),
    ...inferStringSplit(examples, targetPath, targetValues, sourceEntries),
    ...inferArrayStringTransform(examples, targetPath, targetValues, sourceEntries),
    ...inferArrayMap(examples, targetPath, targetValues),
    ...inferArrayProject(examples, targetPath, targetValues),
    ...inferArrayCount(examples, targetPath, targetValues),
    ...inferArrayJoin(examples, targetPath, targetValues),
    ...inferArrayFind(examples, targetPath, targetValues),
    ...inferArrayGroupBy(examples, targetPath, targetValues),
    ...inferValueMapConflicts(examples, targetPath, targetValues, sourceEntries),
    ...inferConditional(examples, targetPath, targetValues, sourceEntries),
    ...inferValueMap(examples, targetPath, targetValues, sourceEntries),
    ...inferConstant(targetPath, targetValues),
  ];
  return fullCandidates.sort((a, b) => a.cost - b.cost);
}


function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
