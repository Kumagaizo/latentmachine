import { hashText, stableId } from "./normalize.js";

const replacements = [
  ["timestamp", /\b\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?\b/gi],
  ["date", /\b\d{4}-\d{2}-\d{2}\b/g],
  ["time", /\b[0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d+)?)?\b/g],
  ["uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi],
  ["ipv4", /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
  ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ["url", /\bhttps?:\/\/[^\s<>"')\]]+/gi],
  ["quoted", /(["'])(?:\\.|(?!\1).)*\1/g],
  ["duration", /\b\d+(?:\.\d+)?\s?(?:ns|µs|us|ms|s|sec|secs|seconds?|m|min|mins|minutes?|h|hrs?|hours?)\b/gi],
  ["bytes", /\b\d+(?:\.\d+)?\s?(?:B|KB|KiB|MB|MiB|GB|GiB|TB)\b/g],
  ["hex", /\b0x[0-9a-f]+\b|\b[0-9a-f]{16,}\b/gi],
  ["windows-path", /\b[A-Za-z]:\\(?:[^\\\s:*?"<>|]+\\)*[^\\\s:*?"<>|]*/g],
  ["unix-path", /(^|[\s=(])\/(?:[\w.@+-]+\/)*[\w.@+-]+/g],
  ["decimal", /(?<![\w.])-?\d+\.\d+(?![\w.])/g],
  ["integer", /(?<![\w])-?\d{2,}(?![\w])/g],
];

export function templateSignature(text = "") {
  let signature = String(text).normalize("NFC").replace(/\u001b\[[0-9;]*m/g, "");
  for (const [token, pattern] of replacements) {
    signature = signature.replace(pattern, (...args) => {
      if (token === "unix-path" && args[1]) return `${args[1]}<path>`;
      return `<${token}>`;
    });
  }
  return signature
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function assignTemplates(segments) {
  const groups = new Map();
  for (const segment of segments) {
    if (segment.blank) {
      segment.templateId = null;
      segment.templateSignature = "";
      continue;
    }
    const signature = templateSignature(segment.text);
    const templateId = stableId("tpl", signature);
    segment.templateId = templateId;
    segment.templateSignature = signature;
    if (!groups.has(templateId)) {
      groups.set(templateId, {
        id: templateId,
        signature,
        count: 0,
        representativeSegmentId: segment.id,
        segmentIds: [],
        firstLineNumber: segment.lineNumber,
      });
    }
    const group = groups.get(templateId);
    group.count += 1;
    group.segmentIds.push(segment.id);
  }
  return [...groups.values()].sort((a, b) => a.firstLineNumber - b.firstLineNumber || a.id.localeCompare(b.id));
}

export function assignExactGroups(segments) {
  const groups = new Map();
  for (const segment of segments) {
    if (segment.blank) continue;
    const key = segment.text;
    if (!groups.has(key)) {
      groups.set(key, {
        id: `exact-${hashText(key)}`,
        text: key,
        count: 0,
        representativeSegmentId: segment.id,
        firstLineNumber: segment.lineNumber,
        segmentIds: [],
      });
    }
    const group = groups.get(key);
    group.count += 1;
    group.segmentIds.push(segment.id);
    segment.exactGroupId = group.id;
  }
  return [...groups.values()].sort((a, b) => a.firstLineNumber - b.firstLineNumber || a.id.localeCompare(b.id));
}

export function tokenClasses(text = "") {
  return templateSignature(text)
    .split(/\s+/)
    .filter(Boolean)
    .map(token => {
      if (/^<[^>]+>$/.test(token)) return token;
      if (/^[A-Z_]{2,}$/.test(token)) return "<upper>";
      if (/^[a-z]+$/i.test(token)) return "<word>";
      if (/^[^\w]+$/.test(token)) return "<punctuation>";
      return "<mixed>";
    });
}

