export function normalizeLineEndings(text) {
  return String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
