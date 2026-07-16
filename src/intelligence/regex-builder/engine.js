const DEFAULT_FLAVOR = "js";
const FLAVORS = ["js", "pcre", "python", "java"];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanExamples(values = []) {
  return values.map(value => String(value ?? "")).filter(value => value.length > 0);
}

function charKind(char) {
  if (/[0-9]/.test(char)) return "digit";
  if (/[a-z]/.test(char)) return "lower";
  if (/[A-Z]/.test(char)) return "upper";
  if (/\s/.test(char)) return "space";
  if (/[A-Za-z]/.test(char)) return "alpha";
  if (/[A-Za-z0-9_]/.test(char)) return "word";
  return "literal";
}

function mergeKind(first, second) {
  if (!first) return second;
  if (!second) return first;
  if (first === second) return first;
  if (["lower", "upper", "alpha"].includes(first) && ["lower", "upper", "alpha"].includes(second)) return "alpha";
  if (["digit", "lower", "upper", "alpha", "word"].includes(first) && ["digit", "lower", "upper", "alpha", "word"].includes(second)) return "word";
  return null;
}

function classForKind(kind) {
  if (kind === "digit") return "\\d";
  if (kind === "lower") return "[a-z]";
  if (kind === "upper") return "[A-Z]";
  if (kind === "alpha") return "[A-Za-z]";
  if (kind === "word") return "\\w";
  if (kind === "space") return "\\s";
  return null;
}

function quantifier(min, max) {
  if (min === 1 && max === 1) return "";
  if (min === 0 && max === 1) return "?";
  if (min === max) return `{${min}}`;
  return `{${min},${max}}`;
}

function chars(value) {
  return [...String(value)].map((char, index) => ({ char, index }));
}

function columnItems(column) {
  return column.items.filter(Boolean);
}

function columnKind(column) {
  return columnItems(column).map(item => charKind(item.char)).reduce((kind, next) => mergeKind(kind, next), null);
}

function columnLiteral(column) {
  const present = columnItems(column);
  if (!present.length) return null;
  const first = present[0].char;
  return present.every(item => item.char === first) ? first : null;
}

function scoreColumn(column, char) {
  const literal = columnLiteral(column);
  if (literal === char) return 5;
  const kind = columnKind(column);
  const nextKind = charKind(char);
  if (kind && mergeKind(kind, nextKind)) return kind === nextKind ? 2 : 1;
  if (literal && charKind(literal) === "literal") return -4;
  return -3;
}

function alignColumnsToChars(columns, nextChars, processedCount) {
  const gap = -1.4;
  const rows = columns.length + 1;
  const cols = nextChars.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  const back = Array.from({ length: rows }, () => Array(cols).fill(""));

  for (let row = 1; row < rows; row += 1) {
    dp[row][0] = dp[row - 1][0] + gap;
    back[row][0] = "up";
  }
  for (let col = 1; col < cols; col += 1) {
    dp[0][col] = dp[0][col - 1] + gap;
    back[0][col] = "left";
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const diag = dp[row - 1][col - 1] + scoreColumn(columns[row - 1], nextChars[col - 1].char);
      const up = dp[row - 1][col] + gap;
      const left = dp[row][col - 1] + gap;
      const best = Math.max(diag, up, left);
      dp[row][col] = best;
      back[row][col] = best === diag ? "diag" : best === up ? "up" : "left";
    }
  }

  const aligned = [];
  let row = columns.length;
  let col = nextChars.length;
  while (row > 0 || col > 0) {
    const move = back[row][col];
    if (move === "diag") {
      aligned.push({ items: [...columns[row - 1].items, nextChars[col - 1]] });
      row -= 1;
      col -= 1;
      continue;
    }
    if (move === "up") {
      aligned.push({ items: [...columns[row - 1].items, null] });
      row -= 1;
      continue;
    }
    aligned.push({ items: [...Array(processedCount).fill(null), nextChars[col - 1]] });
    col -= 1;
  }

  return aligned.reverse();
}

function alignExamples(positives) {
  let columns = chars(positives[0]).map(item => ({ items: [item] }));
  for (let index = 1; index < positives.length; index += 1) {
    columns = alignColumnsToChars(columns, chars(positives[index]), index);
  }
  return columns;
}

function atomFromColumn(column, index, exampleCount) {
  const present = columnItems(column);
  const presence = column.items.map(Boolean);
  const literal = columnLiteral(column);
  if (literal !== null && charKind(literal) === "literal") {
    return {
      index,
      mode: "literal",
      literal,
      presence,
      optional: present.length < exampleCount,
      spans: column.items.map(item => item ? { start: item.index, end: item.index + 1 } : null),
    };
  }

  const kind = columnKind(column);
  if (kind && classForKind(kind)) {
    return {
      index,
      mode: "class",
      kind,
      presence,
      optional: present.length < exampleCount,
      spans: column.items.map(item => item ? { start: item.index, end: item.index + 1 } : null),
    };
  }

  const options = [...new Set(present.map(item => item.char))].sort((a, b) => a.localeCompare(b));
  return {
    index,
    mode: "alternation",
    options,
    presence,
    optional: present.length < exampleCount,
    spans: column.items.map(item => item ? { start: item.index, end: item.index + 1 } : null),
  };
}

function mergeSpans(spans) {
  const present = spans.filter(Boolean);
  if (!present.length) return null;
  return {
    start: Math.min(...present.map(span => span.start)),
    end: Math.max(...present.map(span => span.end)),
  };
}

function canMerge(first, second) {
  if (!first || !second) return false;
  if (first.mode === "class" && second.mode === "class" && first.kind === second.kind) return true;
  if (first.mode === "literal" && second.mode === "literal" && !first.optional && !second.optional) return true;
  return false;
}

function valuesForSegment(segment, positives) {
  return positives.map((value, index) => {
    const span = segment.spans[index];
    return span ? value.slice(span.start, span.end) : "";
  });
}

function finalizeSegment(segment, positives) {
  const spans = segment.spans || [];
  const counts = spans.map(span => span ? span.end - span.start : 0);
  const finalized = {
    ...segment,
    min: Math.min(...counts),
    max: Math.max(...counts),
    optional: counts.some(count => count === 0),
    values: valuesForSegment(segment, positives),
  };
  const presentValues = finalized.values.filter(Boolean);
  if (finalized.mode === "class" && presentValues.length && presentValues.every(value => value === presentValues[0]) && finalized.kind !== "digit") {
    return {
      ...finalized,
      mode: "literal",
      literal: presentValues[0],
    };
  }
  return finalized;
}

function mergeSegments(first, second) {
  if (first.mode === "literal") {
    return {
      ...first,
      literal: `${first.literal}${second.literal}`,
      presence: first.presence.map((present, index) => present || second.presence[index]),
      spans: first.spans.map((span, index) => mergeSpans([span, second.spans[index]])),
    };
  }
  return {
    ...first,
    presence: first.presence.map((present, index) => present || second.presence[index]),
    spans: first.spans.map((span, index) => mergeSpans([span, second.spans[index]])),
  };
}

function compressAtoms(atoms, positives) {
  const segments = [];
  for (const atom of atoms) {
    const previous = segments.at(-1);
    if (canMerge(previous, atom)) {
      segments[segments.length - 1] = mergeSegments(previous, atom);
    } else {
      segments.push(atom);
    }
  }
  return segments.map(segment => finalizeSegment(segment, positives));
}

function sanitizeCaptureName(name, fallback, usedNames) {
  const raw = String(name || fallback).trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z_]+/, "") || fallback;
  if (!usedNames.has(raw)) return raw;
  let suffix = 2;
  while (usedNames.has(`${raw}_${suffix}`)) suffix += 1;
  return `${raw}_${suffix}`;
}

function intersects(span, start, end) {
  return !!span && span.start < end && span.end > start;
}

function applyCaptures(segments, captures = []) {
  const usedNames = new Set();
  for (const capture of captures) {
    const positiveIndex = Number(capture?.positiveIndex ?? capture?.exampleIndex ?? 0);
    const start = Number(capture?.start);
    const end = Number(capture?.end);
    if (!Number.isInteger(positiveIndex) || !Number.isInteger(start) || !Number.isInteger(end) || end <= start) continue;
    const indexes = segments
      .map((segment, index) => intersects(segment.spans?.[positiveIndex], start, end) ? index : -1)
      .filter(index => index >= 0);
    if (!indexes.length) continue;
    const fallback = `g${usedNames.size + 1}`;
    const name = sanitizeCaptureName(capture.name, fallback, usedNames);
    usedNames.add(name);
    segments[indexes[0]].captureOpen = name;
    segments[indexes.at(-1)].captureClose = true;
  }
}

function wrapOptional(body, optional) {
  if (!optional) return body;
  if (body.length === 1 || /^(?:\\[dws.]|[A-Za-z0-9_-])$/.test(body) || /^\[[^\]]+\]$/.test(body)) return `${body}?`;
  return `(?:${body})?`;
}

function renderSegmentBody(segment) {
  if (segment.mode === "literal") return wrapOptional(escapeRegExp(segment.literal), segment.optional);
  if (segment.mode === "class") return `${classForKind(segment.kind)}${quantifier(segment.min, segment.max)}`;
  const body = `(?:${segment.options.map(escapeRegExp).join("|")})`;
  return wrapOptional(body, segment.optional);
}

function renderPattern(segments, { anchored = true, flavor = DEFAULT_FLAVOR } = {}) {
  const body = segments.map(segment => {
    const open = segment.captureOpen ? (flavor === "python" ? `(?P<${segment.captureOpen}>` : `(?<${segment.captureOpen}>`) : "";
    const close = segment.captureClose ? ")" : "";
    return `${open}${renderSegmentBody(segment)}${close}`;
  }).join("");
  return `${anchored ? "^" : ""}${body}${anchored ? "$" : ""}`;
}

function compileJs(pattern) {
  return new RegExp(pattern);
}

function verify(pattern, positives, negatives) {
  let regex;
  try {
    regex = compileJs(pattern);
  } catch (error) {
    return { ok: false, error: error?.message || "Invalid regular expression.", positiveFailures: positives, negativeFailures: negatives };
  }
  const positiveFailures = positives.filter(value => !regex.test(value));
  const negativeFailures = negatives.filter(value => regex.test(value));
  return {
    ok: positiveFailures.length === 0 && negativeFailures.length === 0,
    positiveFailures,
    negativeFailures,
  };
}

function cloneSegments(segments) {
  return segments.map(segment => ({
    ...segment,
    presence: [...(segment.presence || [])],
    spans: [...(segment.spans || [])],
    values: [...(segment.values || [])],
    options: segment.options ? [...segment.options] : undefined,
  }));
}

function tighteningCandidates(segments) {
  return segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.mode === "class" && new Set(segment.values.filter(Boolean)).size > 1 && segment.values.every(value => value.length <= 24))
    .sort((a, b) => {
      const aSpread = a.segment.max - a.segment.min;
      const bSpread = b.segment.max - b.segment.min;
      return aSpread - bSpread || a.segment.values.join("").length - b.segment.values.join("").length;
    });
}

function tightenAgainstNegatives(segments, positives, negatives, options) {
  let current = cloneSegments(segments);
  let pattern = renderPattern(current, options);
  let result = verify(pattern, positives, negatives);
  if (result.ok) return { segments: current, pattern, verification: result };

  for (const { index } of tighteningCandidates(current)) {
    const next = cloneSegments(current);
    const values = [...new Set(next[index].values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    next[index] = {
      ...next[index],
      mode: "alternation",
      options: values,
      optional: next[index].values.some(value => !value),
    };
    const nextPattern = renderPattern(next, options);
    const nextResult = verify(nextPattern, positives, negatives);
    current = next;
    pattern = nextPattern;
    result = nextResult;
    if (nextResult.ok) return { segments: current, pattern, verification: nextResult };
  }

  return { segments: current, pattern, verification: result };
}

function conflictFor(positives, negatives) {
  const positiveSet = new Set(positives);
  const value = negatives.find(negative => positiveSet.has(negative));
  return value ? { type: "same-string", message: `The string \`${value}\` is marked as both match and reject.`, value } : null;
}

function ambiguityFor(positives, negatives, segments) {
  if (positives.length < 2) {
    return {
      type: "single-positive",
      target: "examples",
      message: "One matching example is not enough to know which parts are fixed and which parts vary.",
      suggested: mutateExample(positives[0], segments),
    };
  }
  if (!negatives.length) {
    return {
      type: "no-negative",
      target: "rejections",
      message: "Add at least one string that should be rejected so the pattern is not only fitted to matches.",
      suggested: mutateExample(positives[0], segments),
    };
  }
  const optional = segments.find(segment => segment.optional);
  if (optional && negatives.length < 2) {
    return {
      type: "optional-segment",
      target: "optional",
      message: "The examples show an optional part. Add a close reject to prove where that optional part is allowed.",
      suggested: mutateExample(positives.find(value => !optional.values?.some(part => part && !value.includes(part))) || positives[0], segments),
    };
  }
  const ranged = segments.find(segment => segment.mode === "class" && segment.min !== segment.max);
  if (ranged && negatives.length < 2) {
    return {
      type: "variable-length",
      target: "length",
      message: "The examples show variable length. Add a too-short or too-long reject to pin down the boundary.",
      suggested: mutateExample(positives[0], segments),
    };
  }
  return null;
}

function mutateExample(example = "sample", segments = []) {
  const digit = segments.find(segment => segment.mode === "class" && segment.kind === "digit");
  if (digit) return example.replace(/\d/, "X");
  const alpha = segments.find(segment => segment.mode === "class" && ["lower", "upper", "alpha", "word"].includes(segment.kind));
  if (alpha) return example.replace(/[A-Za-z]/, "9");
  const optional = segments.find(segment => segment.optional && segment.values?.some(Boolean));
  if (optional) return example.replace(optional.values.find(Boolean), "");
  return `${example}_extra`;
}

function segmentExplanation(segment) {
  const label = segment.captureOpen ? `Start capture \`${segment.captureOpen}\` and match ` : "Match ";
  const suffix = segment.captureClose ? " End the capture." : "";
  if (segment.mode === "literal") {
    const optional = segment.optional ? " if present" : "";
    return `${label}literal \`${segment.literal}\`${optional}.${suffix}`;
  }
  if (segment.mode === "alternation") {
    const optional = segment.optional ? " or nothing" : "";
    return `${label}one of ${segment.options.map(value => `\`${value}\``).join(", ")}${optional}.${suffix}`;
  }
  const noun = segment.kind === "digit" ? "digit"
    : segment.kind === "lower" ? "lowercase letter"
      : segment.kind === "upper" ? "uppercase letter"
        : segment.kind === "alpha" ? "letter"
          : segment.kind === "space" ? "whitespace character"
            : "word character";
  const amount = segment.min === segment.max ? `${segment.min}` : `${segment.min} to ${segment.max}`;
  return `${label}${amount} ${noun}${amount === "1" ? "" : "s"}.${suffix}`;
}

function flavorPatterns(segments, anchored) {
  return Object.fromEntries(FLAVORS.map(flavor => [flavor, renderPattern(segments, { anchored, flavor })]));
}

function synthesizeSegments(positives, captures) {
  const columns = alignExamples(positives);
  const atoms = columns.map((column, index) => atomFromColumn(column, index, positives.length));
  const segments = compressAtoms(atoms, positives);
  applyCaptures(segments, captures);
  return segments;
}

export function runRegexBuilder(input = {}) {
  const started = Date.now();
  const positives = cleanExamples(input.positives);
  const negatives = cleanExamples(input.negatives);
  const anchored = input.anchored !== false;
  const flavor = FLAVORS.includes(input.flavor) ? input.flavor : DEFAULT_FLAVOR;
  const base = {
    method: "regexBuilder",
    input: { positives, negatives, anchored, flavor },
    pattern: "",
    patterns: {},
    segments: [],
    explanation: [],
    verification: { ok: false, positiveFailures: positives, negativeFailures: negatives },
    diagnosis: { status: "unsafe", contradictions: [], ambiguities: [], suggestedExamples: [] },
    status: "unsafe",
    telemetry: { durationMs: 0, method: "regexBuilder", positiveCount: positives.length, negativeCount: negatives.length },
  };

  if (!positives.length) {
    return {
      ...base,
      diagnosis: {
        status: "contradictory",
        contradictions: [{ type: "no-positive", message: "Add at least one string that should match." }],
        ambiguities: [],
        suggestedExamples: [],
      },
      status: "contradictory",
      telemetry: { ...base.telemetry, durationMs: Date.now() - started },
    };
  }

  const conflict = conflictFor(positives, negatives);
  if (conflict) {
    return {
      ...base,
      diagnosis: { status: "contradictory", contradictions: [conflict], ambiguities: [], suggestedExamples: [] },
      status: "contradictory",
      telemetry: { ...base.telemetry, durationMs: Date.now() - started },
    };
  }

  const segments = synthesizeSegments(positives, input.captures || []);
  const tightened = tightenAgainstNegatives(segments, positives, negatives, { anchored, flavor: "js" });
  const patterns = flavorPatterns(tightened.segments, anchored);
  const verification = verify(patterns.js, positives, negatives);
  const ambiguity = verification.ok ? ambiguityFor(positives, negatives, tightened.segments) : null;
  const status = verification.ok ? (ambiguity ? "ambiguous" : "safe") : "contradictory";

  return {
    ...base,
    pattern: patterns[flavor],
    patterns,
    segments: tightened.segments,
    explanation: [
      anchored ? "Anchor the pattern to the whole string." : "Allow the pattern to match inside a longer string.",
      ...tightened.segments.map(segmentExplanation),
    ],
    verification,
    diagnosis: {
      status,
      contradictions: status === "contradictory"
        ? verification.negativeFailures.map(value => ({ type: "negative-still-matches", message: `The reject string \`${value}\` still matches the narrowest verified candidate.`, value }))
        : [],
      ambiguities: ambiguity ? [{ type: ambiguity.type, target: ambiguity.target, message: ambiguity.message }] : [],
      suggestedExamples: ambiguity ? [{ reason: ambiguity.message, value: ambiguity.suggested }] : [],
    },
    status,
    telemetry: { ...base.telemetry, durationMs: Date.now() - started },
  };
}

export function explainRegexResult(result) {
  return {
    summary: result?.status === "safe"
      ? "The pattern matches every positive example and rejects every negative example."
      : result?.status === "ambiguous"
        ? "The examples are satisfied, but more evidence would pin down a less surprising pattern."
        : "The examples cannot be satisfied by the current deterministic regex builder.",
    pattern: result?.pattern || "",
    explanation: result?.explanation || [],
    diagnosis: result?.diagnosis || {},
  };
}

export function testRegexPattern(pattern, text) {
  let regex;
  try {
    regex = new RegExp(pattern, "g");
  } catch (error) {
    return { ok: false, error: error?.message || "Invalid regular expression.", matches: [] };
  }
  const matches = [];
  for (const match of String(text || "").matchAll(regex)) {
    matches.push({ value: match[0], index: match.index, groups: match.groups || {} });
    if (match[0] === "") break;
  }
  return { ok: true, matches };
}
