const VALID_INTENTS = ["transform", "extract", "complete", "classify", "explain"];
const ARROW = /\s*(?:->|=>|\u2192)\s*/;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function lines(text) {
  return String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function splitExamples(text) {
  return lines(text).map((line, index) => {
    const parts = line.split(ARROW);
    return {
      index,
      raw: line,
      input: clean(parts[0]),
      output: clean(parts.slice(1).join(" -> ")),
      paired: parts.length > 1,
    };
  });
}

function normalizeInput(input = {}) {
  const explicitExamples = input.examplesText || input.examples || "";
  const tryText = input.tryText || "";
  const inlineRows = splitExamples(tryText);
  const inlineExamples = inlineRows.filter(row => row.paired);
  if (explicitExamples || !inlineExamples.length) return { examplesText: explicitExamples, tryText };

  const targetRows = inlineRows.filter(row => !row.paired).map(row => row.raw);
  const fallbackRows = inlineExamples.map(row => row.input);
  return {
    examplesText: inlineExamples.map(row => row.raw).join("\n"),
    tryText: (targetRows.length ? targetRows : fallbackRows).join("\n"),
  };
}

function isValidIntent(intent) {
  return VALID_INTENTS.includes(intent);
}

function isNumericSequence(text) {
  const values = String(text || "").split(/[,\s]+/).map(clean).filter(Boolean);
  return values.length >= 3 && values.every(value => /^-?\d+(?:\.\d+)?$/.test(value));
}

function hasExtractableEntity(text) {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)
    || /\bhttps?:\/\/[^\s,;|]+/i.test(text);
}

function looksLikeShortLabel(value) {
  const label = clean(value);
  return !!label
    && label.length <= 32
    && !/[|=,;:{}[\]<>]/.test(label)
    && label.split(/\s+/).length <= 3;
}

function inferIntent(examples, tryText) {
  const paired = examples.filter(ex => ex.paired && ex.output);
  const combined = [examples.map(ex => ex.raw).join("\n"), tryText].filter(Boolean).join("\n");

  if (isNumericSequence(tryText)) return "complete";
  if (paired.length) {
    const uniqueOutputs = new Set(paired.map(ex => ex.output));
    const repeatedLabels = uniqueOutputs.size < paired.length;
    const compactLabels = paired.every(ex => looksLikeShortLabel(ex.output));
    if (compactLabels && repeatedLabels) return "classify";
    if (compactLabels && paired.length >= 3 && uniqueOutputs.size <= Math.max(2, paired.length - 1)) return "classify";
    return "transform";
  }
  if (isNumericSequence(tryText || examples.map(ex => ex.raw).join(", "))) return "complete";
  if (hasExtractableEntity(combined)) return "extract";
  return "explain";
}

function splitPersonLike(value) {
  const normalized = clean(value);
  const commaMatch = normalized.match(/^(.+?)\s*,\s*(\d{1,3})\s*,\s*(.+)$/);
  if (commaMatch) return { name: clean(commaMatch[1]), age: commaMatch[2], place: clean(commaMatch[3]) };
  const spaceMatch = normalized.match(/^(.+?)\s+(\d{1,3})\s+(.+)$/);
  return spaceMatch ? { name: clean(spaceMatch[1]), age: spaceMatch[2], place: clean(spaceMatch[3]) } : null;
}

function splitDelimitedRow(value) {
  const parts = String(value || "").split(",").map(clean).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createDelimitedTemplate(examples) {
  const source = examples.filter(ex => ex.paired && splitDelimitedRow(ex.input) && ex.output).at(-1);
  if (!source) return null;
  const parts = splitDelimitedRow(source.input);
  const replacements = parts
    .map((value, index) => ({ token: `{field${index}}`, value }))
    .sort((a, b) => b.value.length - a.value.length);
  const tokenByValue = new Map(replacements.map(item => [item.value, item.token]));
  const template = source.output.replace(new RegExp(replacements.map(item => escapeRegExp(item.value)).join("|"), "g"), value => tokenByValue.get(value) || value);
  const usedFields = replacements.filter(item => template.includes(item.token));
  if (!usedFields.length) return null;
  return record => usedFields.reduce((text, item) => text.replaceAll(item.token, record[Number(item.token.match(/\d+/)?.[0])] ?? ""), template);
}

function createPersonTemplate(examples) {
  const source = examples.filter(ex => ex.paired && splitPersonLike(ex.input) && ex.output).at(-1);
  if (!source) return null;
  const row = splitPersonLike(source.input);
  const replacements = [
    { token: "{name}", value: row.name },
    { token: "{place}", value: row.place },
    { token: "{age}", value: row.age },
  ].sort((a, b) => b.value.length - a.value.length);
  let template = source.output;
  for (const item of replacements) {
    template = template.replace(new RegExp(escapeRegExp(item.value), "g"), item.token);
  }
  if (!template.includes("{name}") || !template.includes("{age}") || !template.includes("{place}")) return null;
  return record => template
    .replaceAll("{name}", record.name)
    .replaceAll("{age}", record.age)
    .replaceAll("{place}", record.place);
}

function filenameParts(value) {
  const base = clean(value).replace(/\.[a-z0-9]+$/i, "");
  const parts = base.split(/[_\-\s]+/).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

function transformFromPerson(examples) {
  const delimitedTemplate = createDelimitedTemplate(examples);
  if (delimitedTemplate) {
    const rule = record => {
      const row = splitDelimitedRow(record);
      return row ? delimitedTemplate(row) : "";
    };
    return {
      id: "delimited-row-template",
      title: "Split rows into fields",
      confidence: 0.9,
      summary: "Use each separated value as a reusable field in the desired output.",
      rule,
    };
  }

  const personRows = examples.filter(ex => splitPersonLike(ex.input));
  if (!personRows.length) return null;
  const usesPipe = examples.some(ex => ex.output.includes("|"));
  const usesLabels = examples.some(ex => /=/.test(ex.output));
  const template = createPersonTemplate(personRows);
  const rule = record => {
    const row = splitPersonLike(record);
    if (!row) return "";
    if (usesLabels) return `name=${row.name}, age=${row.age}, place=${row.place}`;
    if (usesPipe) return `${row.name} | ${row.age} | ${row.place}`;
    if (template) return template(row);
    return `${row.name}, ${row.age}, ${row.place}`;
  };
  return {
    id: "person-row-transform",
    title: "Split rows into fields",
    confidence: 0.9,
    summary: "Text before the age becomes the name, the number becomes the age, and the rest becomes the place.",
    rule,
  };
}

function transformFromFilename(examples) {
  const fileRows = examples.filter(ex => filenameParts(ex.input));
  if (!fileRows.length) return null;
  const rule = record => {
    const parts = filenameParts(record);
    if (!parts) return "";
    const [asset, page, viewport, version, status] = parts;
    return [asset && `asset=${asset}`, page && `page=${page}`, viewport && `viewport=${viewport}`, version && `version=${version}`, status && `status=${status}`].filter(Boolean).join(", ");
  };
  return {
    id: "filename-token-transform",
    title: "Read filename parts",
    confidence: 0.82,
    summary: "Split file names into reusable pieces and label the pieces in order.",
    rule,
  };
}

function transformFromCase(examples) {
  const paired = examples.filter(ex => ex.paired && ex.output);
  if (!paired.length) return null;
  if (paired.every(ex => ex.output === ex.input.toUpperCase())) {
    return { id: "uppercase", title: "Uppercase text", confidence: 0.95, summary: "Convert each new item to uppercase.", rule: value => value.toUpperCase() };
  }
  if (paired.every(ex => ex.output === ex.input.toLowerCase())) {
    return { id: "lowercase", title: "Lowercase text", confidence: 0.95, summary: "Convert each new item to lowercase.", rule: value => value.toLowerCase() };
  }
  return null;
}

function inferTransform(examples) {
  return transformFromCase(examples) || transformFromPerson(examples) || transformFromFilename(examples) || {
    id: "identity",
    title: "Keep text as-is",
    confidence: 0.35,
    summary: "Add clearer examples to teach a reusable change.",
    rule: value => value,
  };
}

function runTransform(examples, tryText) {
  const hypothesis = inferTransform(examples);
  const inputs = lines(tryText || examples.filter(ex => ex.paired).map(ex => ex.input).join("\n"));
  const output = inputs.map(input => hypothesis.rule(input)).join("\n");
  return { hypothesis, output };
}

function extractEntities(text) {
  const all = lines(text).join("\n");
  const emails = [...all.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)].map(m => m[0]);
  const numbers = [...all.matchAll(/\b\d+(?:[.,]\d+)?\b/g)].map(m => m[0]);
  const urls = [...all.matchAll(/\bhttps?:\/\/[^\s,;|]+/gi)].map(m => m[0]);
  const people = lines(text).map(line => splitPersonLike(line)?.name || line.match(/^([^<\-|]+)/)?.[1]).map(clean).filter(Boolean);
  return { emails, numbers, urls, people };
}

function runExtract(examples, tryText) {
  const target = tryText || examples.map(ex => ex.input || ex.raw).join("\n");
  const extracted = extractEntities(target);
  return {
    hypothesis: {
      id: "entity-extraction",
      title: "Pull out visible details",
      confidence: Object.values(extracted).some(list => list.length) ? 0.82 : 0.34,
      summary: "Find repeated recognizable details such as emails, numbers, URLs, and person-like rows.",
    },
    output: JSON.stringify(extracted, null, 2),
  };
}

function completeSequence(values) {
  const nums = values.map(v => Number(v)).filter(v => Number.isFinite(v));
  if (nums.length < 2) return null;
  const diffs = nums.slice(1).map((n, i) => n - nums[i]);
  if (diffs.every(d => d === diffs[0])) return nums.at(-1) + diffs[0];
  const ratios = nums.slice(1).map((n, i) => nums[i] ? n / nums[i] : NaN);
  if (ratios.every(r => Number.isFinite(r) && r === ratios[0])) return nums.at(-1) * ratios[0];
  return null;
}

function runComplete(examples, tryText) {
  const target = tryText || examples.map(ex => ex.input || ex.raw).join(", ");
  const values = target.split(/[,\s]+/).map(clean).filter(Boolean);
  const next = completeSequence(values);
  return {
    hypothesis: {
      id: "sequence-completion",
      title: next === null ? "No sequence found" : "Continue the sequence",
      confidence: next === null ? 0.25 : 0.88,
      summary: next === null ? "Add a clearer numeric sequence to continue it." : "Continue the numbers using a consistent difference or ratio.",
    },
    output: next === null ? "" : String(next),
  };
}

function runClassify(examples, tryText) {
  const paired = examples.filter(ex => ex.paired && ex.output);
  const labels = [...new Set(paired.map(ex => ex.output))];
  const target = clean(tryText || paired[0]?.input || "");
  const scored = labels.map(label => {
    const examplesForLabel = paired.filter(ex => ex.output === label);
    const words = new Set(examplesForLabel.flatMap(ex => ex.input.toLowerCase().split(/\W+/).filter(w => w.length > 3)));
    const score = target.toLowerCase().split(/\W+/).filter(word => words.has(word)).length;
    return { label, score };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0] || { label: "", score: 0 };
  return {
    hypothesis: {
      id: "keyword-classifier",
      title: "Choose a matching label",
      confidence: best.score ? 0.72 : 0.38,
      summary: "Use the examples to route new text to the closest label.",
    },
    output: best.label,
  };
}

function runExplain(examples, tryText) {
  const target = tryText || examples.map(ex => ex.input || ex.raw).join("\n");
  const records = lines(target);
  const hasArrow = examples.some(ex => ex.paired);
  const hasPeople = records.some(splitPersonLike);
  const hasFiles = records.some(filenameParts);
  const hasEmails = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(target);
  const parts = [
    hasArrow && "paired examples",
    hasPeople && "person-like rows",
    hasFiles && "filename tokens",
    hasEmails && "email addresses",
    `${records.length} record${records.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return {
    hypothesis: {
      id: "structure-explanation",
      title: "Describe the pattern",
      confidence: parts.length > 1 ? 0.78 : 0.45,
      summary: "Summarize what is visible before applying a rule.",
    },
    output: parts.join("; "),
  };
}

export function runPatternLab(input = {}) {
  const normalized = normalizeInput(input);
  const examples = splitExamples(normalized.examplesText);
  const tryText = normalized.tryText;
  const intent = isValidIntent(input.intent) ? input.intent : inferIntent(examples, tryText);
  const started = Date.now();
  const result = intent === "extract" ? runExtract(examples, tryText)
    : intent === "complete" ? runComplete(examples, tryText)
      : intent === "classify" ? runClassify(examples, tryText)
        : intent === "explain" ? runExplain(examples, tryText)
          : runTransform(examples, tryText);

  return {
    method: "patternLab",
    intent,
    examples,
    output: result.output,
    hypothesis: result.hypothesis,
    confidence: {
      value: result.hypothesis.confidence,
      label: result.hypothesis.confidence >= 0.8 ? "high" : result.hypothesis.confidence >= 0.55 ? "medium" : "low",
    },
    telemetry: {
      durationMs: Date.now() - started,
      method: "patternLab",
      intent,
      exampleCount: examples.length,
      budgetMs: input.budgetMs ?? 500,
      timedOut: false,
    },
  };
}
