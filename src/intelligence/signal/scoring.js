import { featureStrength, severityStrength } from "./features.js";

export const SIGNAL_SCORE_WEIGHTS = Object.freeze({
  patternBreak: 0.3,
  templateRarity: 0.13,
  concreteEvidence: 0.17,
  severityEvidence: 0.24,
  compressionNovelty: 0.07,
  localContext: 0.13,
  repetitionFrequency: 0.08,
  ambiguityPenalty: 0.12,
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function transitionModel(nonblank) {
  const transitions = new Map();
  const sourceCounts = new Map();
  for (let index = 1; index < nonblank.length; index += 1) {
    const previous = nonblank[index - 1].templateId;
    const current = nonblank[index].templateId;
    const key = `${previous}>${current}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);
    sourceCounts.set(previous, (sourceCounts.get(previous) || 0) + 1);
  }
  return { transitions, sourceCounts };
}

function blockTemplateCounts(segments) {
  const blocks = new Map();
  for (const segment of segments) {
    if (segment.blank) continue;
    if (!blocks.has(segment.blockIndex)) blocks.set(segment.blockIndex, new Map());
    const counts = blocks.get(segment.blockIndex);
    counts.set(segment.templateId, (counts.get(segment.templateId) || 0) + 1);
  }
  return blocks;
}

function dominantNeighborValue(neighbors, key) {
  const counts = new Map();
  for (const neighbor of neighbors) counts.set(neighbor[key], (counts.get(neighbor[key]) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0] || [null, 0];
}

export function detectPatternBreaks(segments, templates, localWindow = 4) {
  const nonblank = segments.filter(segment => !segment.blank);
  const byId = new Map(templates.map(template => [template.id, template]));
  const bySegmentId = new Map(segments.map(segment => [segment.id, segment]));
  const repeatedShare = templates.filter(template => template.count > 1).reduce((sum, template) => sum + template.count, 0) / Math.max(1, nonblank.length);
  const transitions = transitionModel(nonblank);
  const blockCounts = blockTemplateCounts(segments);
  const firstOccurrences = new Set();
  const results = new Map();

  for (let position = 0; position < nonblank.length; position += 1) {
    const segment = nonblank[position];
    const template = byId.get(segment.templateId);
    const evidence = [];
    let strength = 0;
    let localContext = 0;
    const neighbors = segment.localWindow
      .map(id => bySegmentId.get(id))
      .filter(candidate => candidate && !candidate.blank && Math.abs(candidate.index - segment.index) <= localWindow);
    const [dominantTemplate, dominantCount] = dominantNeighborValue(neighbors, "templateId");
    if (neighbors.length >= 3 && dominantTemplate !== segment.templateId && dominantCount / neighbors.length >= 0.6) {
      const value = clamp(0.62 + dominantCount / neighbors.length * 0.28);
      strength = Math.max(strength, value);
      localContext = Math.max(localContext, dominantCount / neighbors.length);
      evidence.push(`Different from ${dominantCount} of ${neighbors.length} neighboring nonblank lines.`);
    }

    const section = blockCounts.get(segment.blockIndex);
    const sectionTotal = [...(section?.values() || [])].reduce((sum, count) => sum + count, 0);
    const sectionDominant = Math.max(0, ...(section?.values() || []));
    if (sectionTotal >= 5 && (section?.get(segment.templateId) || 0) === 1 && sectionDominant >= 3) {
      strength = Math.max(strength, 0.66);
      localContext = Math.max(localContext, sectionDominant / sectionTotal);
      evidence.push("Rare in this section while another structure repeats.");
    }

    if (position > 0) {
      const previous = nonblank[position - 1];
      const key = `${previous.templateId}>${segment.templateId}`;
      const transitionCount = transitions.transitions.get(key) || 0;
      const sourceCount = transitions.sourceCounts.get(previous.templateId) || 0;
      if (transitionCount === 1 && sourceCount >= 3) {
        strength = Math.max(strength, 0.58);
        localContext = Math.max(localContext, 0.65);
        evidence.push(`Introduces a rare transition after the repeated structure at line ${previous.lineNumber}.`);
      }
    }

    const [dominantDelimiter, delimiterCount] = dominantNeighborValue(neighbors, "delimiter");
    if (neighbors.length >= 4 && dominantDelimiter !== segment.delimiter && delimiterCount / neighbors.length >= 0.75) {
      strength = Math.max(strength, 0.42);
      evidence.push(`Changes the dominant local delimiter from ${dominantDelimiter} to ${segment.delimiter}.`);
    }
    const [dominantIndent, indentCount] = dominantNeighborValue(neighbors, "indentation");
    if (neighbors.length >= 4 && dominantIndent !== segment.indentation && indentCount / neighbors.length >= 0.75) {
      strength = Math.max(strength, 0.36);
      evidence.push("Changes the dominant local indentation.");
    }

    if (template.count === 1 && repeatedShare >= 0.35) {
      strength = Math.max(strength, 0.28);
      evidence.push("Globally rare: this normalized template occurs once.");
    }
    if (!firstOccurrences.has(segment.templateId)) {
      firstOccurrences.add(segment.templateId);
      if (template.count <= 2 && repeatedShare >= 0.35) evidence.push("New template introduced here.");
    }

    results.set(segment.id, {
      strength: Number(strength.toFixed(4)),
      localContext: Number(localContext.toFixed(4)),
      evidence,
    });
  }
  return results;
}

export function scoreSegment(segment, context) {
  if (segment.blank) {
    return {
      total: 0,
      components: {
        patternBreak: 0,
        templateRarity: 0,
        concreteEvidence: 0,
        severityEvidence: 0,
        compressionNovelty: 0,
        localContext: 0,
        repetitionFrequency: 0,
        ambiguityPenalty: 0,
      },
    };
  }
  const templateCount = context.template.count;
  const rarityBaseline = context.repeatedShare >= 0.25 ? 1 / Math.sqrt(templateCount) : 0.12 / Math.sqrt(templateCount);
  const concrete = featureStrength(segment.features);
  const severity = severityStrength(segment.features);
  const repetitionFrequency = (severity > 0 || segment.features.some(feature => feature.id === "prohibition"))
    ? clamp(Math.log2(templateCount + 1) / 5)
    : 0;
  const ambiguityPenalty = segment.features.length === 0 && context.pattern.strength < 0.45
    ? (context.mode === "uncertain" ? 0.55 : 0.28)
    : 0;
  const components = {
    patternBreak: context.pattern.strength,
    templateRarity: clamp(rarityBaseline),
    concreteEvidence: concrete,
    severityEvidence: severity,
    compressionNovelty: context.compression.value,
    localContext: context.pattern.localContext,
    repetitionFrequency,
    ambiguityPenalty,
  };
  let total = (
    components.patternBreak * SIGNAL_SCORE_WEIGHTS.patternBreak
    + components.templateRarity * SIGNAL_SCORE_WEIGHTS.templateRarity
    + components.concreteEvidence * SIGNAL_SCORE_WEIGHTS.concreteEvidence
    + components.severityEvidence * SIGNAL_SCORE_WEIGHTS.severityEvidence
    + components.compressionNovelty * SIGNAL_SCORE_WEIGHTS.compressionNovelty
    + components.localContext * SIGNAL_SCORE_WEIGHTS.localContext
    + components.repetitionFrequency * SIGNAL_SCORE_WEIGHTS.repetitionFrequency
    - components.ambiguityPenalty * SIGNAL_SCORE_WEIGHTS.ambiguityPenalty
  );
  if (severity >= 0.85) total = Math.max(total, 0.68);
  if (segment.features.some(feature => feature.id === "prohibition")) total = Math.max(total, 0.66);
  total = clamp(total);
  return {
    total: Number(total.toFixed(4)),
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Number(value.toFixed(4))])),
  };
}

export function levelForScore(score, segment) {
  if (segment.blank) return "context";
  if (score.total >= 0.62) return "attention";
  if (score.total >= 0.36) return "notable";
  return "context";
}

export function confidenceForSegment(segment, pattern) {
  const independentSignals = [
    pattern.strength >= 0.45,
    segment.features.length > 0,
    segment.exactCount > 1,
    segment.templateCount > 1,
    segment.compressionNovelty?.reliability >= 0.7,
  ].filter(Boolean).length;
  const value = Math.min(0.98, 0.42 + independentSignals * 0.12 + (pattern.evidence.length > 1 ? 0.08 : 0));
  return {
    value: Number(value.toFixed(3)),
    label: value >= 0.78 ? "strong" : value >= 0.6 ? "moderate" : "limited",
    meaning: "Strength of observable evidence, not probability of business importance.",
  };
}

