const INVISIBLE = /[\u200B-\u200F\u2060-\u2064\uFEFF]/u;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/u;

function hazard(value) {
  if (typeof value !== "string") return null;
  if (BIDI.test(value)) return "bidi-control";
  if (INVISIBLE.test(value)) return "invisible-character";
  if (value.normalize("NFC") !== value || value.normalize("NFKC") !== value) return "unicode-normalization";
  return null;
}

function escapeUnicode(value) {
  return Array.from(String(value), character => {
    const codepoint = character.codePointAt(0);
    if (codepoint >= 0x20 && codepoint <= 0x7e) return character;
    return codepoint <= 0xffff ? `\\u${codepoint.toString(16).padStart(4, "0")}` : `\\u{${codepoint.toString(16)}}`;
  }).join("");
}

function annotate(item, pathHazard = null) {
  const candidate = [
    ["path", item.path, pathHazard || hazard(item.path)],
    ["value", item.value, hazard(item.value)],
    ["before", item.before, hazard(item.before)],
  ].find(([, , kind]) => kind);
  if (!candidate) return item;
  const [source, value, kind] = candidate;
  return {
    ...item,
    renderHazard: kind,
    hazardSource: source,
    securityRelevant: kind === "bidi-control",
    [source === "path" ? "pathEscaped" : `${source}Escaped`]: escapeUnicode(value),
    codepoints: Array.from(String(value), character => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`),
  };
}

/** Add human-readable Unicode hazard metadata to a structural diff. */
export function annotateStructuralDiffHazards(diff) {
  const addedPaths = new Set(diff.added.map(item => item.path.normalize("NFKC")));
  const removedPaths = new Set(diff.removed.map(item => item.path.normalize("NFKC")));
  return {
    ...diff,
    added: diff.added.map(item => annotate(item, removedPaths.has(item.path.normalize("NFKC")) ? "unicode-normalization" : null)),
    changed: diff.changed.map(item => annotate(item)),
    removed: diff.removed.map(item => annotate(item, addedPaths.has(item.path.normalize("NFKC")) ? "unicode-normalization" : null)),
  };
}
