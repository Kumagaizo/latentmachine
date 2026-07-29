import { COMPRESSION_METHOD_NOTE, compressionNoveltyBySegment } from "./compression.js";
import {
  detectFeatures,
  detectProbableRestatements,
  featureRoles,
  linkExceptionToRule,
} from "./features.js";
import {
  byteLength,
  detectStructuredData,
  hashText,
  inferInputMode,
  normalizeLineEndings,
  segmentText,
  validateSignalInput,
} from "./normalize.js";
import {
  confidenceForSegment,
  detectPatternBreaks,
  levelForScore,
  scoreSegment,
} from "./scoring.js";
import { assignExactGroups, assignTemplates } from "./templates.js";

function event(index, type, phase, message, data = {}) {
  return {
    id: `event-${String(index + 1).padStart(2, "0")}-${type}`,
    type,
    phase,
    severity: type === "input.validated" ? "success" : "info",
    message,
    data,
  };
}

function invalidResult(input, validation, routing = null) {
  const text = typeof input?.text === "string" ? normalizeLineEndings(input.text) : "";
  const warnings = [
    ...validation.warnings.map((message, index) => ({ id: `warning-${index + 1}`, type: "input-limitation", message })),
    ...(routing?.detected ? [{
      id: "warning-structured-data",
      type: "structured-data",
      message: `This looks like structured ${routing.format} data. Open it in Trace for field and record analysis, or explicitly continue as line-oriented text.`,
      action: { label: "Open in Trace", route: "/trace" },
    }] : []),
  ];
  return {
    version: "signal-analysis/1",
    status: "invalid",
    validation,
    source: {
      name: input?.name || "Untitled artifact",
      bytes: byteLength(text),
      lines: text ? text.split("\n").length : 0,
      fingerprint: `fnv1a32-${hashText(text)}`,
    },
    routing,
    mode: null,
    summary: { nonblankLines: 0, uniqueTemplates: 0, repeatedShare: 0, attentionCount: 0, notableCount: 0 },
    segments: [],
    templates: [],
    exactGroups: [],
    findings: [],
    warnings,
    events: [event(0, "input.validated", "validate", validation.ok ? "Input requires routing confirmation" : "Input validation failed", { ok: validation.ok, errors: validation.errors.length, warnings: warnings.length })],
    telemetry: { durationMs: 0, method: "signal-evidence-grammar-v1", lineCount: 0, bounded: true },
    method: {
      id: "signal-evidence-grammar-v1",
      compression: COMPRESSION_METHOD_NOTE,
    },
  };
}

function relationMap(relations) {
  const map = new Map();
  for (const relation of relations) map.set(relation.fromSegmentId, relation);
  return map;
}

function evidenceForSegment(segment, pattern, template, exactGroup, relations) {
  const evidence = [
    ...pattern.evidence.map(message => ({ kind: "pattern-break", message })),
    ...segment.features.map(feature => ({ kind: feature.id, message: feature.evidence })),
    ...segment.exactEvidence.map(item => ({ kind: item.kind, message: item.evidence })),
  ];
  if (exactGroup.count > 1) {
    evidence.push({
      kind: "exact-repetition",
      message: `Exactly repeated ${exactGroup.count} times; first occurrence at line ${exactGroup.firstLineNumber}.`,
    });
  } else if (template.count > 1) {
    evidence.push({
      kind: "template-repetition",
      message: `Shares normalized template ${template.id} with ${template.count - 1} other line${template.count === 2 ? "" : "s"}.`,
    });
  }
  const relation = relations.get(segment.id);
  if (relation) evidence.push({ kind: "probable-restatement", message: relation.evidence });
  if (segment.exceptionRelation) evidence.push({ kind: "exception-relation", message: segment.exceptionRelation.evidence });
  if (segment.compressionNovelty.value >= 0.56 && segment.compressionNovelty.reliability >= 0.55) {
    evidence.push({
      kind: "compression-novelty",
      message: `Byte-level predictability differs from earlier context (${Math.round(segment.compressionNovelty.value * 100)}% novelty estimate).`,
    });
  }
  return evidence;
}

function alternativesForSegment(segment, pattern) {
  const alternatives = [];
  if (pattern.strength >= 0.45 && !segment.features.length) alternatives.push("A rare structure can still be routine or harmless.");
  if (segment.features.some(feature => feature.role === "failure" || feature.role === "warning")) {
    alternatives.push("Severity markers are lexical evidence; Signal does not know the operational impact.");
  }
  if (segment.features.some(feature => feature.role === "constraint")) {
    alternatives.push("Constraint markers do not prove that the statement is current, authoritative, or applicable.");
  }
  if (segment.compressionNovelty.value >= 0.56) alternatives.push("Compression novelty measures byte predictability, not meaning.");
  if (!alternatives.length) alternatives.push("Signal found limited independent evidence for this line.");
  return alternatives;
}

function titleForSegment(segment) {
  if (segment.roles.includes("failure")) return "Failure marker";
  if (segment.roles.includes("exception")) return "Exception near a rule";
  if (segment.roles.includes("constraint")) return "Concrete constraint";
  if (segment.roles.includes("warning")) return "Warning marker";
  if (segment.roles.includes("pattern-break")) return "Pattern break";
  if (segment.roles.includes("decision")) return "Decision marker";
  if (segment.roles.includes("definition")) return "Definition";
  return "Line observation";
}

export function analyzeSignal(input = {}) {
  const validation = validateSignalInput(input);
  if (!validation.ok) return invalidResult(input, validation);
  const text = normalizeLineEndings(input.text);
  const routing = detectStructuredData(text);
  if (routing.detected && !input.settings?.forceLineAnalysis) return invalidResult(input, validation, routing);

  const settings = {
    localWindow: Math.max(2, Math.min(12, Number(input.settings?.localWindow) || 4)),
    includeCompressionNovelty: input.settings?.includeCompressionNovelty !== false,
    minimumTemplateGroup: Math.max(2, Math.min(20, Number(input.settings?.minimumTemplateGroup) || 2)),
    forceLineAnalysis: !!input.settings?.forceLineAnalysis,
  };
  const segments = segmentText(text, settings.localWindow);
  const templates = assignTemplates(segments);
  const exactGroups = assignExactGroups(segments);
  const templateById = new Map(templates.map(template => [template.id, template]));
  const exactById = new Map(exactGroups.map(group => [group.id, group]));
  const modeInference = inferInputMode(segments, templates);
  const selectedMode = input.mode && input.mode !== "auto"
    ? input.mode
    : modeInference.inferred === "uncertain" ? "document" : modeInference.inferred;
  const mode = {
    selected: selectedMode,
    inferred: modeInference.inferred,
    confidence: modeInference.confidence,
    evidence: modeInference.evidence,
    scores: modeInference.scores,
    overridden: !!input.mode && input.mode !== "auto" && input.mode !== modeInference.inferred,
  };

  for (const segment of segments) {
    const detected = detectFeatures(segment.text);
    segment.features = detected.features;
    segment.exactEvidence = detected.exactEvidence;
    segment.exceptionRelation = linkExceptionToRule(segment, segments);
  }
  const restatements = selectedMode === "document"
    ? relationMap(detectProbableRestatements(segments))
    : new Map();
  const compression = settings.includeCompressionNovelty
    ? compressionNoveltyBySegment(segments)
    : new Map(segments.map(segment => [segment.id, { value: 0, raw: 0, reliability: 0, method: "skipped" }]));
  const patterns = detectPatternBreaks(segments, templates, settings.localWindow);
  const repeatedLineCount = templates.filter(template => template.count >= settings.minimumTemplateGroup).reduce((sum, template) => sum + template.count, 0);
  const nonblankLines = segments.filter(segment => !segment.blank).length;
  const repeatedShare = repeatedLineCount / Math.max(1, nonblankLines);

  for (const segment of segments) {
    if (segment.blank) {
      segment.roles = ["context"];
      segment.level = "context";
      segment.confidence = { value: 1, label: "structural", meaning: "Blank line retained for document structure." };
      segment.score = scoreSegment(segment, {});
      segment.evidence = [];
      segment.alternatives = [];
      segment.relatedSegmentIds = [];
      segment.compressionNovelty = compression.get(segment.id);
      segment.templateCount = 0;
      segment.exactCount = 0;
      continue;
    }
    const template = templateById.get(segment.templateId);
    const exactGroup = exactById.get(segment.exactGroupId);
    const pattern = patterns.get(segment.id);
    segment.templateCount = template.count;
    segment.exactCount = exactGroup.count;
    segment.compressionNovelty = compression.get(segment.id);
    const restatement = restatements.get(segment.id);
    const roles = featureRoles(segment.features);
    if (pattern.strength >= 0.42) roles.push("pattern-break");
    if (template.count > 1 || exactGroup.count > 1 || restatement) roles.push("repeated");
    if (!roles.length) roles.push(mode.inferred === "uncertain" ? "uncertain" : "context");
    segment.roles = [...new Set(roles)];
    segment.score = scoreSegment(segment, {
      template,
      pattern,
      compression: segment.compressionNovelty,
      repeatedShare,
      mode: mode.inferred,
    });
    segment.level = levelForScore(segment.score, segment);
    segment.confidence = confidenceForSegment(segment, pattern);
    segment.evidence = evidenceForSegment(segment, pattern, template, exactGroup, restatements);
    segment.alternatives = alternativesForSegment(segment, pattern);
    segment.relatedSegmentIds = [
      ...(restatement ? [restatement.toSegmentId] : []),
      ...(segment.exceptionRelation ? [segment.exceptionRelation.segmentId] : []),
      ...(template.representativeSegmentId !== segment.id ? [template.representativeSegmentId] : []),
    ];
    delete segment.features;
    delete segment.exactEvidence;
    delete segment.exceptionRelation;
  }

  const rankedSegments = segments
    .filter(segment => !segment.blank && (segment.level !== "context" || segment.roles.some(role => !["context", "uncertain", "repeated"].includes(role))))
    .sort((a, b) => b.score.total - a.score.total || a.lineNumber - b.lineNumber);
  const findings = rankedSegments.map((segment, rank) => ({
    id: `finding-${segment.id}`,
    kind: segment.roles.find(role => role !== "repeated") || "observation",
    level: segment.level,
    confidence: segment.confidence,
    title: titleForSegment(segment),
    message: segment.evidence[0]?.message || "Observable evidence is limited; review in source context.",
    segmentIds: [segment.id],
    evidence: segment.evidence,
    rank: { position: rank + 1, score: segment.score.total, components: segment.score.components },
  }));
  const attentionCount = segments.filter(segment => segment.level === "attention").length;
  const notableCount = segments.filter(segment => segment.level === "notable").length;
  const warnings = [
    ...validation.warnings.map((message, index) => ({ id: `warning-input-${index + 1}`, type: "input-limitation", message })),
    ...(mode.inferred === "uncertain" ? [{
      id: "warning-mode-uncertain",
      type: "mode-uncertain",
      message: "Stream and document evidence are close. Signal used document mode; review or override the mode if local sequence matters more.",
    }] : []),
    ...(routing.detected ? [{
      id: "warning-structured-override",
      type: "structured-data-override",
      message: `This looks like structured ${routing.format} data. Line-oriented analysis was explicitly requested; Trace may provide stronger field and record analysis.`,
      action: { label: "Open in Trace", route: "/trace" },
    }] : []),
    {
      id: "warning-attention-aid",
      type: "method-limitation",
      message: "Signal ranks observable evidence, not business importance, and never marks lines as safe to discard.",
    },
  ];
  const events = [
    event(0, "input.validated", "validate", "Input validated", { bytes: validation.bytes, lines: validation.lines, warnings: validation.warnings.length }),
    event(1, "input.mode-inferred", "perception", "Input mode inferred", { inferred: mode.inferred, selected: mode.selected, confidence: mode.confidence }),
    event(2, "segments.created", "perception", "Stable line segments created", { total: segments.length, nonblank: nonblankLines, method: "line-endings-v1" }),
    event(3, "templates.normalized", "perception", "Variable fragments normalized into templates", { method: "signal-template-v1", templates: templates.length }),
    event(4, "clusters.created", "hypothesis-generation", "Exact and template clusters created", { exactGroups: exactGroups.length, templateGroups: templates.length }),
    event(5, "features.detected", "perception", "Concrete language and severity features detected", { featuredSegments: segments.filter(segment => segment.roles.some(role => !["context", "uncertain", "repeated", "pattern-break"].includes(role))).length, method: "observable-markers-v1" }),
    event(6, settings.includeCompressionNovelty ? "compression-novelty.computed" : "compression-novelty.skipped", "perception", settings.includeCompressionNovelty ? "Bounded compression novelty computed" : "Compression novelty skipped by setting", { method: settings.includeCompressionNovelty ? COMPRESSION_METHOD_NOTE.method : "skipped", boundedEntries: settings.includeCompressionNovelty ? 32_768 : 0 }),
    event(7, "candidates.generated", "hypothesis-generation", "Pattern-break and relation candidates generated", { candidates: rankedSegments.length, method: "local-evidence-grammar-v1" }),
    event(8, "findings.scored", "scoring", "Findings scored from named evidence components", { findings: findings.length, attention: attentionCount, notable: notableCount, method: "signal-score-v1" }),
    event(9, "analysis.completed", "tracing", "Signal analysis completed", { status: "ready", findings: findings.length, rawContentIncluded: false }),
  ];

  return {
    version: "signal-analysis/1",
    status: "ready",
    source: {
      name: input.name || "Untitled artifact",
      bytes: validation.bytes,
      lines: segments.length,
      fingerprint: `fnv1a32-${hashText(text)}`,
    },
    routing,
    mode,
    settings,
    summary: {
      nonblankLines,
      uniqueTemplates: templates.length,
      repeatedShare: Number(repeatedShare.toFixed(4)),
      patternBreaks: segments.filter(segment => segment.roles.includes("pattern-break")).length,
      constraintsAndExceptions: segments.filter(segment => segment.roles.includes("constraint") || segment.roles.includes("exception")).length,
      failuresAndWarnings: segments.filter(segment => segment.roles.includes("failure") || segment.roles.includes("warning")).length,
      attentionCount,
      notableCount,
    },
    segments,
    templates,
    exactGroups,
    findings,
    warnings,
    events,
    telemetry: {
      durationMs: 0,
      method: "signal-evidence-grammar-v1",
      lineCount: segments.length,
      templateLookups: nonblankLines,
      bounded: true,
    },
    method: {
      id: "signal-evidence-grammar-v1",
      patternBreak: "Learns repeated templates and template-to-template transitions, then tests each line against global, section, and local context.",
      compression: COMPRESSION_METHOD_NOTE,
      limitations: [
        "Feature markers are observable lexical evidence, not semantic proof.",
        "Probable restatements use deterministic term overlap and do not detect full contradiction.",
        "Ranking weights are heuristic and isolated for benchmark-gated revision.",
      ],
    },
  };
}
