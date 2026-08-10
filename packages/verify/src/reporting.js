const DEFAULT_FLAGGED_ROW_LIMIT = 50;
const MAX_FLAGGED_ROW_LIMIT = 100;

function compactOperation(op = {}) {
  const { map, conflicts, ...safe } = op;
  if (op.op === "valueMap") {
    return {
      ...safe,
      entryCount: op.memorisation?.tableEntries ?? Object.keys(map || {}).length,
    };
  }
  if (op.op === "valueMapConflict") {
    return {
      ...safe,
      conflictGroupCount: Array.isArray(conflicts) ? conflicts.length : 0,
    };
  }
  return safe;
}

export function compactRuleArtifact(rule) {
  if (!rule) return null;
  return {
    version: rule.version,
    id: rule.id,
    title: rule.title,
    summary: rule.summary,
    status: rule.status,
    confidence: rule.confidence,
    memorisation: rule.memorisation,
    program: {
      version: rule.program?.version,
      ops: (rule.program?.ops || []).map(compactOperation),
    },
    executable: false,
  };
}

export function compactVerificationResult(result, { flaggedRowLimit = DEFAULT_FLAGGED_ROW_LIMIT } = {}) {
  const requestedLimit = Number.isInteger(flaggedRowLimit) ? flaggedRowLimit : DEFAULT_FLAGGED_ROW_LIMIT;
  const limit = Math.max(0, Math.min(MAX_FLAGGED_ROW_LIMIT, requestedLimit));
  const flaggedRows = result.flaggedRows || [];
  const unexplained = result.unexplained || [];
  return {
    ...result,
    flaggedRows: flaggedRows.slice(0, limit),
    flaggedRowCount: flaggedRows.length,
    omittedFlaggedRows: Math.max(0, flaggedRows.length - limit),
    flaggedRowLimit: limit,
    unexplained: unexplained.slice(0, limit),
    unexplainedRowCount: unexplained.length,
    omittedUnexplainedRows: Math.max(0, unexplained.length - limit),
    rule: compactRuleArtifact(result.rule),
    note: "Flagged and unexplained row details are capped. Lookup table bodies are omitted from this diagnostic response; counts cover the complete rule.",
  };
}
