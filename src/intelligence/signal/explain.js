function selectedSegments(result, options = {}) {
  const pinned = new Set(options.pinnedSegmentIds || []);
  const includeAttention = options.includeAttention !== false;
  const includeNotable = !!options.includeNotable;
  const includeRepresentatives = !!options.includeRepresentatives;
  const contextLines = Math.max(0, Math.min(5, Number(options.contextLines) || 0));
  const selected = new Map();
  const include = (segment, reason) => {
    if (!segment || segment.blank) return;
    if (!selected.has(segment.id)) selected.set(segment.id, { segment, reasons: [] });
    const row = selected.get(segment.id);
    if (!row.reasons.includes(reason)) row.reasons.push(reason);
  };

  for (const segment of result.segments || []) {
    if (pinned.has(segment.id)) include(segment, "pinned");
    if (includeAttention && segment.level === "attention") include(segment, "attention");
    if (includeNotable && segment.level === "notable") include(segment, "notable");
  }
  if (includeRepresentatives) {
    for (const template of result.templates || []) {
      include(result.segments.find(segment => segment.id === template.representativeSegmentId), `representative:${template.id}`);
    }
  }
  const initiallySelected = [...selected.values()].map(row => row.segment.index);
  for (const index of initiallySelected) {
    for (let offset = 1; offset <= contextLines; offset += 1) {
      include(result.segments[index - offset], `context:${result.segments[index]?.lineNumber}`);
      include(result.segments[index + offset], `context:${result.segments[index]?.lineNumber}`);
    }
  }
  return [...selected.values()].sort((a, b) => a.segment.lineNumber - b.segment.lineNumber);
}

export function createEvidencePack(result, options = {}) {
  if (!result || result.status !== "ready") throw new Error("Run Signal before creating an evidence pack.");
  const rows = selectedSegments(result, options);
  const omittedNonblankLines = Math.max(0, result.summary.nonblankLines - rows.length);
  const artifact = {
    version: "signal-evidence-pack/1",
    source: result.source,
    analysisFingerprint: result.source.fingerprint,
    selection: {
      includeAttention: options.includeAttention !== false,
      includeNotable: !!options.includeNotable,
      includeRepresentatives: !!options.includeRepresentatives,
      contextLines: Math.max(0, Math.min(5, Number(options.contextLines) || 0)),
      pinnedSegmentIds: [...new Set(options.pinnedSegmentIds || [])].sort(),
      reviewed: !!options.reviewed,
      includedLines: rows.length,
      omittedNonblankLines,
    },
    warnings: [
      "This pack contains a user-reviewed selection, not a complete source.",
      "Signal ranks observable evidence and does not know what is operationally material.",
      ...(options.reviewed ? [] : ["Selection has not been marked as reviewed."]),
    ],
    lines: rows.map(({ segment, reasons }) => ({
      segmentId: segment.id,
      lineNumber: segment.lineNumber,
      text: segment.text,
      level: segment.level,
      roles: segment.roles,
      reasons,
      evidence: segment.evidence.map(item => item.message),
      relatedSegmentIds: segment.relatedSegmentIds,
    })),
  };
  const width = String(result.source.lines).length;
  const text = [
    `SIGNAL EVIDENCE PACK · ${result.source.name}`,
    `Source ${result.source.fingerprint} · ${result.source.lines} lines · ${result.source.bytes} bytes`,
    `Selection: ${rows.length} included, ${omittedNonblankLines} nonblank lines omitted${options.reviewed ? " · reviewed" : " · not yet reviewed"}`,
    "",
    ...artifact.lines.map(line => `L${String(line.lineNumber).padStart(width, "0")} [${line.level}; ${line.roles.join(", ")}]\n${line.text}`),
    "",
    "LIMITATIONS",
    ...artifact.warnings.map(warning => `- ${warning}`),
  ].join("\n");
  return { artifact, text };
}

export function privacySafeSignalReport(result) {
  return {
    version: result?.version || "signal-analysis/1",
    status: result?.status || "invalid",
    source: result?.source ? {
      nameIncluded: !!result.source.name,
      bytes: result.source.bytes,
      lines: result.source.lines,
      fingerprint: result.source.fingerprint,
    } : null,
    mode: result?.mode,
    summary: result?.summary,
    warnings: (result?.warnings || []).map(warning => ({ id: warning.id, type: warning.type })),
    events: result?.events || [],
    telemetry: result?.telemetry,
    contentIncluded: false,
  };
}

export function explainSignalSegment(segment, result) {
  if (!segment) return null;
  const template = result?.templates?.find(item => item.id === segment.templateId);
  return {
    position: `Line ${segment.lineNumber}`,
    level: segment.level,
    roles: segment.roles,
    confidence: segment.confidence,
    evidence: segment.evidence,
    template: template ? {
      id: template.id,
      signature: template.signature,
      count: template.count,
      representativeSegmentId: template.representativeSegmentId,
    } : null,
    compressionNovelty: segment.compressionNovelty,
    alternatives: segment.alternatives,
    relatedSegmentIds: segment.relatedSegmentIds,
    limitation: "Signal does not know whether this line is operationally material.",
  };
}

