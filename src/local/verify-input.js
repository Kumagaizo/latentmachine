const FORMAT_LABELS = [
  "json",
  "xml",
  "csv",
  "tsv",
  "toml",
  "env",
  "dotenv",
  "sql",
  "sql insert",
  "yaml",
  "yml",
];

const FENCE_PATTERN = new RegExp(`^\\s*\`\`\`(?:${FORMAT_LABELS.map(label => label.replace(" ", "\\s+")).join("|")})?\\s*\\r?\\n?`, "i");
const FENCE_END_PATTERN = /\r?\n?\s*```\s*$/;
const LABEL_LINE_PATTERN = new RegExp(`^(?:${FORMAT_LABELS.map(label => label.replace(" ", "\\s+")).join("|")})\\s*:?\\s*$`, "i");
const INLINE_LABEL_PATTERN = new RegExp(`^\\s*(?:${FORMAT_LABELS.map(label => label.replace(" ", "\\s+")).join("|")})\\s*:\\s*`, "i");
const DATA_START_PATTERN = /^[\s\r\n]*(?:[\[{<]|[A-Za-z_][\w-]*\s*=|INSERT\s+INTO\b|--|#)/i;

export function normalizeVerifyInputText(text = "") {
  let next = String(text ?? "").replace(/^\uFEFF/, "").trim();
  if (!next) return "";

  if (FENCE_PATTERN.test(next) && FENCE_END_PATTERN.test(next)) {
    next = next.replace(FENCE_PATTERN, "").replace(FENCE_END_PATTERN, "").trim();
  }

  const lines = next.split(/\r\n|\r|\n/);
  if (lines.length > 1 && LABEL_LINE_PATTERN.test(lines[0].trim())) {
    next = lines.slice(1).join("\n").trim();
  }

  const inlineLabel = next.match(INLINE_LABEL_PATTERN);
  if (inlineLabel) {
    const candidate = next.slice(inlineLabel[0].length);
    if (DATA_START_PATTERN.test(candidate)) next = candidate.trim();
  }

  return next;
}
