const FEATURE_DEFINITIONS = [
  { id: "prohibition", role: "constraint", strength: 1, pattern: /\b(?:must\s+not|shall\s+not|never|forbidden|cannot|prohibited)\b/i, label: "prohibition" },
  { id: "obligation", role: "constraint", strength: 0.86, pattern: /\b(?:must|shall|required|requires?)\b/i, label: "obligation" },
  { id: "recommendation", role: "constraint", strength: 0.52, pattern: /\b(?:should|prefer(?:red)?)\b/i, label: "recommendation" },
  { id: "exception", role: "exception", strength: 0.9, pattern: /\b(?:unless|except(?:ion)?|however|may\s+override|with\s+the\s+exception)\b/i, label: "exception marker" },
  { id: "decision", role: "decision", strength: 0.82, pattern: /\b(?:we\s+chose|decision|will\s+use|selected\s+approach)\b/i, label: "decision marker" },
  { id: "definition", role: "definition", strength: 0.72, pattern: /\b(?:means|defined\s+as|refers\s+to|is\s+the\s+term\s+for)\b/i, label: "definition marker" },
  { id: "threshold", role: "constraint", strength: 0.78, pattern: /(?:<=|>=|<|>|at\s+(?:least|most)|no\s+more\s+than|fewer\s+than|within)\s*\d+(?:\.\d+)?(?:\s?(?:%|ms|s|seconds?|minutes?|hours?|B|KB|MB|GB|rows?|records?|lines?))?/i, label: "numeric threshold" },
  { id: "failure", role: "failure", strength: 1, pattern: /\b(?:fatal|failed|failure|rejected|rollback|panic|aborted)\b/i, label: "failure marker" },
  { id: "error", role: "failure", strength: 0.88, pattern: /\berrors?\b/i, label: "error marker" },
  { id: "warning", role: "warning", strength: 0.72, pattern: /\b(?:warn(?:ing)?|deprecated|partial(?:ly)?|skipped)\b/i, label: "warning marker" },
  { id: "action", role: "constraint", strength: 0.66, pattern: /\b(?:TODO|FIXME|owner|deadline)\b/i, label: "action marker" },
];

const ERROR_NEGATIONS = [
  /\b(?:no|zero|without)\s+(?:new\s+)?errors?\b/i,
  /\b0\s+errors?\b/i,
  /\berrors?\s*(?:count\s*)?[:=]\s*0\b/i,
  /\b(?:success|successful|passed|resolved|handled)\b[^.\n]{0,48}\berrors?\b/i,
];

function exactMarker(match) {
  return match?.[0]?.trim() || "";
}

export function detectFeatures(text = "") {
  const features = [];
  for (const definition of FEATURE_DEFINITIONS) {
    const match = String(text).match(definition.pattern);
    if (!match) continue;
    if (definition.id === "error" && ERROR_NEGATIONS.some(pattern => pattern.test(text))) continue;
    features.push({
      id: definition.id,
      role: definition.role,
      strength: definition.strength,
      value: exactMarker(match),
      evidence: `Contains the observable ${definition.label} “${exactMarker(match)}”.`,
    });
  }

  const exactEvidence = [];
  const addExact = (kind, pattern, label) => {
    const match = String(text).match(pattern);
    if (match) exactEvidence.push({ kind, value: match[0], evidence: `Contains ${label} “${match[0]}”.` });
  };
  addExact("date", /\b\d{4}-\d{2}-\d{2}\b/, "date");
  addExact("quantity", /\b\d+(?:\.\d+)?\s?(?:%|ms|s|seconds?|minutes?|hours?|B|KB|MB|GB|rows?|records?|lines?)\b/i, "quantity");
  addExact("field", /`[^`\n]+`|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/, "field or code identifier");
  addExact("path", /\b[A-Za-z]:\\[^\s]+|(?:^|\s)\/(?:[\w.@+-]+\/)+[\w.@+-]+/, "path");
  addExact("identifier", /\b[A-Z]{2,8}-\d+\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i, "identifier");

  return { features, exactEvidence };
}

export function featureRoles(features = []) {
  return [...new Set(features.map(feature => feature.role))];
}

export function featureStrength(features = []) {
  if (!features.length) return 0;
  const strongest = Math.max(...features.map(feature => feature.strength));
  const reinforcement = Math.min(0.18, Math.max(0, features.length - 1) * 0.06);
  return Math.min(1, strongest + reinforcement);
}

export function severityStrength(features = []) {
  const severe = features.filter(feature => feature.role === "failure" || feature.role === "warning");
  return severe.length ? Math.max(...severe.map(feature => feature.strength)) : 0;
}

export function linkExceptionToRule(segment, segments, maxDistance = 8) {
  if (!segment.features?.some(feature => feature.role === "exception")) return null;
  let traversed = 0;
  for (let index = segment.index - 1; index >= 0 && traversed < maxDistance; index -= 1) {
    const candidate = segments[index];
    if (candidate.blank) continue;
    traversed += 1;
    if (candidate.features?.some(feature => feature.role === "constraint")) {
      return {
        segmentId: candidate.id,
        evidence: `Probable exception relation to the preceding constraint at line ${candidate.lineNumber}.`,
      };
    }
  }
  return null;
}

const RESTATEMENT_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "with",
]);

function restatementTokens(text) {
  return new Set(String(text).toLowerCase().match(/[a-z0-9_]{3,}/g)?.filter(token => !RESTATEMENT_STOP_WORDS.has(token)) || []);
}

function jaccard(a, b) {
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

export function detectProbableRestatements(segments) {
  const postings = new Map();
  const relations = [];
  for (const segment of segments) {
    if (segment.blank) continue;
    const tokens = restatementTokens(segment.normalized);
    if (tokens.size < 4) continue;
    const candidates = new Set();
    for (const token of tokens) {
      const ids = postings.get(token) || [];
      for (const candidate of ids.slice(-16)) candidates.add(candidate);
      if (candidates.size >= 160) break;
    }
    let best = null;
    for (const candidate of candidates) {
      if (candidate.templateId === segment.templateId) continue;
      const similarity = jaccard(tokens, candidate.tokens);
      if (similarity >= 0.64 && (!best || similarity > best.similarity || (similarity === best.similarity && candidate.segment.lineNumber < best.segment.lineNumber))) {
        best = { segment: candidate.segment, similarity };
      }
    }
    if (best) {
      relations.push({
        fromSegmentId: segment.id,
        toSegmentId: best.segment.id,
        similarity: Number(best.similarity.toFixed(3)),
        evidence: `Probable restatement of line ${best.segment.lineNumber} based on shared concrete terms.`,
      });
    }
    for (const token of tokens) {
      if (!postings.has(token)) postings.set(token, []);
      postings.get(token).push({ segment, templateId: segment.templateId, tokens });
    }
  }
  return relations;
}
