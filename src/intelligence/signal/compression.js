const encoder = new TextEncoder();

function gramKey(bytes, index) {
  return (
    (bytes[index] * 0x1000000)
    + (bytes[index + 1] << 16)
    + (bytes[index + 2] << 8)
    + bytes[index + 3]
  ) >>> 0;
}

export function compressionNoveltyBySegment(segments, options = {}) {
  const maxDictionaryEntries = options.maxDictionaryEntries || 32_768;
  const dictionary = new Map();
  const scores = new Map();

  for (const segment of segments) {
    if (segment.blank) {
      scores.set(segment.id, { value: 0, raw: 0, reliability: 0, method: "bounded-byte-gram-v1" });
      continue;
    }
    const bytes = encoder.encode(segment.text);
    const grams = Math.max(0, bytes.length - 3);
    const stride = bytes.length > 48 ? 2 : 1;
    const withinLine = new Set();
    let unseen = 0;
    let sampled = 0;
    for (let index = 0; index < grams; index += stride) {
      const key = gramKey(bytes, index);
      if (!dictionary.has(key) && !withinLine.has(key)) unseen += 1;
      withinLine.add(key);
      sampled += 1;
    }
    const raw = sampled ? unseen / sampled : 0;
    const reliability = Math.max(0, Math.min(1, (bytes.length - 7) / 48));
    const shortCap = bytes.length < 20 ? 0.45 : 1;
    const value = Math.min(shortCap, raw * reliability);
    scores.set(segment.id, {
      value: Number(value.toFixed(4)),
      raw: Number(raw.toFixed(4)),
      reliability: Number(reliability.toFixed(4)),
      method: "bounded-byte-gram-v1",
    });
    for (const key of withinLine) {
      if (dictionary.has(key)) dictionary.delete(key);
      dictionary.set(key, 1);
      if (dictionary.size > maxDictionaryEntries) {
        const oldest = dictionary.keys().next().value;
        dictionary.delete(oldest);
      }
    }
  }
  return scores;
}

export const COMPRESSION_METHOD_NOTE = {
  method: "bounded-byte-gram-v1",
  label: "Compression novelty",
  description: "Estimates byte-level predictability from deterministically sampled four-byte sequences observed earlier in a bounded rolling context.",
  limitations: [
    "It is order-sensitive because only earlier lines provide context.",
    "Very short lines are down-weighted because their estimates are unreliable.",
    "It is an approximation of marginal compression, not a semantic measure and not a standalone finding.",
  ],
};
