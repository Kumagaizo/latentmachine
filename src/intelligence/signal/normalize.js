const textEncoder = new TextEncoder();

export const SIGNAL_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxLines: 20_000,
  maxLineBytes: 256 * 1024,
};

export function hashText(value = "") {
  const bytes = textEncoder.encode(String(value));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function stableId(prefix, value) {
  return `${prefix}-${hashText(value)}`;
}

export function byteLength(value = "") {
  return textEncoder.encode(String(value)).length;
}

export function normalizeLineEndings(text = "") {
  return String(text).replace(/\r\n?/g, "\n");
}

export function normalizeLine(text = "") {
  return String(text).normalize("NFC").trim().replace(/[ \t]+/g, " ");
}

function delimiterKind(text = "") {
  const candidates = [
    [",", (text.match(/,/g) || []).length],
    ["|", (text.match(/\|/g) || []).length],
    ["tab", (text.match(/\t/g) || []).length],
    ["=", (text.match(/=/g) || []).length],
    [":", (text.match(/:/g) || []).length],
  ].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return candidates[0][1] ? candidates[0][0] : "none";
}

export function segmentText(text = "", localWindow = 4) {
  const normalizedInput = normalizeLineEndings(text);
  const lines = normalizedInput.split("\n");
  let blockIndex = 0;
  const segments = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const blank = line.trim().length === 0;
    if (blank && index > 0 && !segments[index - 1]?.blank) blockIndex += 1;
    const normalized = normalizeLine(line);
    segments.push({
      id: `seg-${String(index + 1).padStart(5, "0")}-${hashText(line)}`,
      index,
      lineNumber: index + 1,
      text: line,
      bytes: byteLength(line),
      normalized,
      blank,
      blockIndex,
      indentation: line.match(/^[ \t]*/)?.[0].replace(/\t/g, "  ").length || 0,
      delimiter: delimiterKind(line),
      localWindow: [],
    });
  }

  for (let index = 0; index < segments.length; index += 1) {
    const start = Math.max(0, index - localWindow);
    const end = Math.min(segments.length, index + localWindow + 1);
    segments[index].localWindow = segments
      .slice(start, end)
      .filter(segment => segment.index !== index)
      .map(segment => segment.id);
  }

  return segments;
}

function replacementRatio(text) {
  if (!text.length) return 0;
  return (text.match(/\uFFFD/g) || []).length / text.length;
}

function controlRatio(text) {
  if (!text.length) return 0;
  return (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length / text.length;
}

function looksEncodedOrMinified(lines) {
  const nonblank = lines.filter(line => line.trim());
  if (!nonblank.length) return false;
  const longest = nonblank.reduce((best, line) => line.length > best.length ? line : best, "");
  const dominated = longest.length > 5_000 && longest.length / Math.max(1, nonblank.join("\n").length) > 0.82;
  if (!dominated) return false;
  const base64Like = /^[A-Za-z0-9+/=_-]{5000,}$/.test(longest.trim());
  const lowWhitespace = (longest.match(/\s/g) || []).length / longest.length < 0.015;
  return base64Like || lowWhitespace;
}

export function validateSignalInput(input) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== "object") errors.push("Input must be an object.");
  if (typeof input?.text !== "string") errors.push("Input requires text as a string.");
  const text = typeof input?.text === "string" ? normalizeLineEndings(input.text) : "";
  const bytes = byteLength(text);
  const lines = text ? text.split("\n") : [];
  if (!text.trim()) errors.push("Add a line-oriented text artifact to analyze.");
  if (bytes > SIGNAL_LIMITS.maxBytes) errors.push("Text exceeds Signal's 2 MiB safe processing limit.");
  if (lines.length > SIGNAL_LIMITS.maxLines) errors.push("Text exceeds Signal's 20,000 line safe processing limit.");
  if (replacementRatio(text) > 0.01 || controlRatio(text) > 0.002) errors.push("The input looks binary or mostly undecodable.");
  if (lines.some(line => byteLength(line) > SIGNAL_LIMITS.maxLineBytes)) warnings.push("One or more lines are unusually long; line-level evidence may be weak.");
  if (looksEncodedOrMinified(lines)) errors.push("The input is dominated by one minified or encoded line, so line-oriented analysis would be misleading.");
  if (lines.filter(line => line.trim()).length < 5) warnings.push("This artifact is too small to establish a strong repetition baseline.");
  if (!["auto", "stream", "document"].includes(input?.mode || "auto")) errors.push("Mode must be auto, stream, or document.");
  return { ok: errors.length === 0, errors, warnings, bytes, lines: lines.length };
}

function consistentDelimitedRows(lines, delimiter) {
  const rows = lines.slice(0, 80).map(line => line.split(delimiter).length);
  if (rows.length < 3 || Math.max(...rows) < 3) return false;
  const mode = rows.reduce((best, count) => {
    const occurrences = rows.filter(value => value === count).length;
    return occurrences > best.occurrences ? { count, occurrences } : best;
  }, { count: 0, occurrences: 0 });
  return mode.occurrences / rows.length >= 0.8;
}

export function detectStructuredData(text = "") {
  const trimmed = String(text).trim();
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (!trimmed || lines.length < 2) return { detected: false, format: null, confidence: 0, evidence: [] };

  if (/^[\[{]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        return { detected: true, format: "JSON", confidence: 1, evidence: ["The complete input parses as JSON."] };
      }
    } catch {}
  }

  if (/^<\?xml\b|^<([A-Za-z][\w:.-]*)[\s>][\s\S]*<\/\1>\s*$/i.test(trimmed)) {
    return { detected: true, format: "XML", confidence: 0.94, evidence: ["The input has a complete XML document shape."] };
  }

  for (const [delimiter, format] of [[",", "CSV"], ["\t", "TSV"]]) {
    if (consistentDelimitedRows(lines, delimiter)) {
      return { detected: true, format, confidence: 0.88, evidence: [`Rows use a consistent ${format} field structure.`] };
    }
  }

  const yamlKeyLines = lines.filter(line => /^\s*[-]?\s*[A-Za-z_][\w.-]*:\s+\S/.test(line)).length;
  if (yamlKeyLines >= 4 && yamlKeyLines / lines.length > 0.65) {
    return { detected: true, format: "YAML", confidence: 0.82, evidence: ["Most lines use YAML key-value structure."] };
  }

  return { detected: false, format: null, confidence: 0, evidence: [] };
}

export function inferInputMode(segments, templates = []) {
  const nonblank = segments.filter(segment => !segment.blank);
  const text = nonblank.map(segment => segment.text);
  const repeatedLines = templates.filter(template => template.count > 1).reduce((sum, template) => sum + template.count, 0);
  const repeatedShare = repeatedLines / Math.max(1, nonblank.length);
  const streamMarkers = text.filter(line =>
    /^\s*(?:\d{4}-\d{2}-\d{2}[T ]|\d{2}:\d{2}:\d{2}|\[(?:trace|debug|info|warn|error|fatal)\])/i.test(line)
    || /\b(?:INFO|WARN|ERROR|FATAL|DEBUG|TRACE)\b/.test(line)
  ).length / Math.max(1, nonblank.length);
  const documentMarkers = text.filter(line =>
    /^\s{0,3}(?:#{1,6}\s|[-*]\s|\d+[.)]\s)/.test(line)
    || /[.!?]\s*$/.test(line.trim())
  ).length / Math.max(1, nonblank.length);
  const blankShare = segments.filter(segment => segment.blank).length / Math.max(1, segments.length);
  const streamScore = Math.min(1, streamMarkers * 1.25 + repeatedShare * 0.55 + (blankShare < 0.08 ? 0.12 : 0));
  const documentScore = Math.min(1, documentMarkers * 0.95 + Math.min(0.22, blankShare * 1.8));
  const difference = Math.abs(streamScore - documentScore);
  const inferred = difference < 0.14 ? "uncertain" : streamScore > documentScore ? "stream" : "document";
  const confidence = inferred === "uncertain" ? Math.max(0.35, 0.55 - difference) : Math.min(0.98, 0.58 + difference * 0.65);
  const evidence = [
    `${Math.round(repeatedShare * 100)}% of lines belong to repeated structures.`,
    `${Math.round(streamMarkers * 100)}% carry stream-like time or severity markers.`,
    `${Math.round(documentMarkers * 100)} carry document-like headings, bullets, or sentence endings.`,
  ];
  return { inferred, confidence: Number(confidence.toFixed(3)), evidence, scores: { stream: Number(streamScore.toFixed(3)), document: Number(documentScore.toFixed(3)) } };
}
