export const COST_PRIOR_STEP = 0.25;
const COST_SIZE_SCALE = 0.00025;
const COST_SIZE_CAP = 0.04;
const COST_ADJUSTMENT_CAP = COST_PRIOR_STEP;

// Ordered by structural complexity. Small evidence adjustments below are allowed
// to choose between candidates of the same broad kind, but not to make a large
// learned lookup look simpler than a direct symbolic operation.
const COST_PRIORS = {
  set: 1.05,
  constant: 1.9,
  coerce: 1.45,
  stringCase: 1.35,
  stringNormalize: 1.16,
  dateFormat: 1.22,
  booleanNot: 1.35,
  quantityTransform: 1.32,
  numericBinary: 1.45,
  numericTransform: 1.55,
  fallback: 1.52,
  stringSplit: 1.4,
  extractBetween: 1.42,
  splitPart: 1.9,
  concat: 1.65,
  regexExtract: 1.72,
  template: 1.58,
  templateConflict: 2.1,
  conditional: 2.0,
  arrayStringTransform: 1.18,
  arrayCount: 1.65,
  arrayJoin: 1.82,
  arrayMap: 1.85,
  arrayFind: 2.18,
  arrayProject: 2.15,
  arrayGroupBy: 2.3,
  valueMapConflict: 1.8,
  valueMap: 2.25,
};

// Each adjustment is a bounded nudge inside a structural prior band. The sum is
// capped by COST_ADJUSTMENT_CAP so hints can break ties, but cannot rewrite the
// operation-kind ordering encoded in COST_PRIORS.
export const COST_ADJUSTMENT_WEIGHTS = {
  pathDistance: 0.08,          // Prefer shorter source-target path moves when values tie.
  pathMatch: -0.2,             // Exact path names are stronger evidence than accidental equal values.
  composedStringMode: 0.18,    // Multiple string edits are less direct than one string edit.
  numericScale: 0.2,           // Multiplication generalizes less safely than additive offsets.
  arrayCollapseWhitespace: 0.25, // Whitespace normalization changes more text than trim/case cleanup.
  arrayCaseChange: 0.08,       // Case-only array cleanup is a small, predictable edit.
  numericMagnitude: 0.02,      // Larger numeric constants are weaker than small offsets.
  numericMultiplyMagnitude: 0.18, // Multiplicative constants grow risk faster than offsets.
  quantityMagnitude: 0.16,     // Quantity conversions are useful but still scale with factor size.
  missingMarker: 0.12,         // Extraction with only one boundary is less constrained.
  splitPosition: 0.04,         // Earlier split parts are usually less arbitrary than later parts.
  templateSource: 0.06,        // More template sources mean more assumptions.
  templateSourceReward: -0.08, // Conflict explanations improve when more observed sources participate.
  templateLiteral: 0.02,       // Literal glue is acceptable, but each literal is another assumption.
  templateTransform: 0.05,     // Templates with transformed slots are less direct.
  templateLiteralData: 0.25,   // Data-looking literals risk memorizing example values.
  templateLiteralDataChar: 0.04, // Longer data-looking literals add risk until the cap saturates.
  changedTemplateSlot: 0.04,   // More unstable literal slots make a conflict explanation less crisp.
  conflictSuggestion: -0.08,   // Actionable disambiguation evidence makes conflicts easier to trust.
  arrayFilter: 0.25,           // Filtering is a stronger claim than mapping every row.
  arrayExtract: 0.12,          // Joining/extracting a nested field is less direct than joining values.
  separator: 0.08,             // Explicit separators are small literal assumptions.
  idValueMap: 0.2,             // IDs commonly coincide with labels but should not drive label maps.
  numericTextValueMap: 0.18,   // Numeric-looking sources mapping to prose are often categorical guesses.
  templatedStringValueMap: 0.25, // If the source text appears inside the output, prefer a string rule.
  valueMapNameMatch: -0.15,    // Similar field names are weak evidence for a lookup.
  unrelatedValueMap: 0.2,      // Unrelated field names make a lookup more likely accidental.
  affinityStrong: -0.2,        // Known categorical source-target pairs support lookup rules.
  affinityWeak: -0.12,         // Shared names are weaker support than known categorical pairs.
  affinityMismatch: 0.18,      // Unrelated categorical names should not win close lookup choices.
  categoricalStrong: -0.2,     // Canonical categorical fields are plausible lookup sources.
  categoricalWeak: -0.12,      // Suffix matches are useful but weaker categorical evidence.
  categoricalBadSource: 0.2,   // IDs, names, titles, and timestamps are risky lookup sources.
  fallbackChainLength: 0.06,   // Longer priority chains make a broader structural claim.
  conditionalNotEquals: 0.08,  // Negative tests are a slightly less direct rule statement.
  regexComplexity: 0.04,       // Each character-class element adds a small inference cost.
  regexGroupPenalty: 0.1,      // Capture groups are less direct than extracting the full match.
  semanticConflictMatch: -0.12, // Name overlap makes a value-map conflict more likely meaningful.
  semanticConflictMismatch: 0.18, // No name overlap makes a conflict explanation less targeted.
};

function stableCostJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableCostJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableCostJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sizeTerm(op) {
  return Math.min(COST_SIZE_CAP, stableCostJson(op).length * COST_SIZE_SCALE);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function costAdjustment(op, hints = {}) {
  const pathDistance = hints.pathDistance || 0;
  const pathMatch = hints.pathMatch ? COST_ADJUSTMENT_WEIGHTS.pathMatch : 0;
  const composedStringMode = op.mode && String(op.mode).includes("+") ? COST_ADJUSTMENT_WEIGHTS.composedStringMode : 0;
  const numericScale = op.op === "numericTransform" && ["multiply", "divide"].includes(op.mode) ? COST_ADJUSTMENT_WEIGHTS.numericScale : 0;
  const arrayStringModePenalty = op.op === "arrayStringTransform"
    ? op.mode === "collapseWhitespace" ? COST_ADJUSTMENT_WEIGHTS.arrayCollapseWhitespace : ["lower", "upper"].includes(op.mode) ? COST_ADJUSTMENT_WEIGHTS.arrayCaseChange : 0
    : 0;
  const magnitudeWeight = op.op === "numericTransform" && ["multiply", "divide"].includes(op.mode)
    ? COST_ADJUSTMENT_WEIGHTS.numericMultiplyMagnitude
    : op.op === "quantityTransform"
      ? COST_ADJUSTMENT_WEIGHTS.quantityMagnitude
      : COST_ADJUSTMENT_WEIGHTS.numericMagnitude;
  const numericMagnitude = Number.isFinite(hints.magnitude) ? Math.min(COST_ADJUSTMENT_CAP, Math.abs(hints.magnitude) * magnitudeWeight) : 0;
  const missingMarkerPenalty = (hints.missingPrefix ? COST_ADJUSTMENT_WEIGHTS.missingMarker : 0) + (hints.missingSuffix ? COST_ADJUSTMENT_WEIGHTS.missingMarker : 0);
  const positionPenalty = Number.isFinite(hints.index) ? hints.index * COST_ADJUSTMENT_WEIGHTS.splitPosition : 0;
  const sourceCountPenalty = Number.isFinite(hints.sourceCount) ? hints.sourceCount * COST_ADJUSTMENT_WEIGHTS.templateSource : 0;
  const sourceCountReward = Number.isFinite(hints.sourceReward) ? hints.sourceReward * COST_ADJUSTMENT_WEIGHTS.templateSourceReward : 0;
  const literalCountPenalty = Number.isFinite(hints.literalCount) ? hints.literalCount * COST_ADJUSTMENT_WEIGHTS.templateLiteral : 0;
  const transformPenalty = Number.isFinite(hints.transformCount) ? hints.transformCount * COST_ADJUSTMENT_WEIGHTS.templateTransform : 0;
  const literalPenalty = Number.isFinite(hints.literalPenalty) ? Math.min(COST_ADJUSTMENT_WEIGHTS.templateLiteralData, hints.literalPenalty) : 0;
  const changedSlotPenalty = Number.isFinite(hints.changedSlots) ? hints.changedSlots * COST_ADJUSTMENT_WEIGHTS.changedTemplateSlot : 0;
  const suggestionBonus = Number.isFinite(hints.suggestions) ? hints.suggestions * COST_ADJUSTMENT_WEIGHTS.conflictSuggestion : 0;
  const arrayFilterPenalty = hints.filtered ? COST_ADJUSTMENT_WEIGHTS.arrayFilter : 0;
  const arrayExtractPenalty = hints.extract ? COST_ADJUSTMENT_WEIGHTS.arrayExtract : 0;
  const separatorPenalty = hints.separator ? COST_ADJUSTMENT_WEIGHTS.separator : 0;
  const idPenalty = hints.idPenalty ? COST_ADJUSTMENT_WEIGHTS.idValueMap : 0;
  const numericTextPenalty = hints.numericToTextPenalty ? COST_ADJUSTMENT_WEIGHTS.numericTextValueMap : 0;
  const templatedStringPenalty = hints.templatedStringPenalty ? COST_ADJUSTMENT_WEIGHTS.templatedStringValueMap : 0;
  const nameBonus = hints.nameMatch ? COST_ADJUSTMENT_WEIGHTS.valueMapNameMatch : 0;
  const unrelatedPenalty = hints.unrelated ? COST_ADJUSTMENT_WEIGHTS.unrelatedValueMap : 0;
  const affinity = Number.isFinite(hints.affinity) ? hints.affinity : 0;
  const categorical = Number.isFinite(hints.categorical) ? hints.categorical : 0;
  const semantic = Number.isFinite(hints.semantic) ? hints.semantic : 0;
  const fallbackChainPenalty = Number.isFinite(hints.fallbackChainLength)
    ? hints.fallbackChainLength * COST_ADJUSTMENT_WEIGHTS.fallbackChainLength
    : 0;
  const conditionalTestPenalty = hints.conditionalNotEquals
    ? COST_ADJUSTMENT_WEIGHTS.conditionalNotEquals
    : 0;
  const regexComplexityPenalty = Number.isFinite(hints.regexComplexity)
    ? hints.regexComplexity * COST_ADJUSTMENT_WEIGHTS.regexComplexity
    : 0;
  const regexGroupPenalty = hints.regexGroup ? COST_ADJUSTMENT_WEIGHTS.regexGroupPenalty : 0;
  const rawAdjustment = pathDistance * COST_ADJUSTMENT_WEIGHTS.pathDistance
    + pathMatch
    + composedStringMode
    + numericScale
    + arrayStringModePenalty
    + numericMagnitude
    + missingMarkerPenalty
    + positionPenalty
    + sourceCountPenalty
    + sourceCountReward
    + literalCountPenalty
    + transformPenalty
    + literalPenalty
    + changedSlotPenalty
    + suggestionBonus
    + arrayFilterPenalty
    + arrayExtractPenalty
    + separatorPenalty
    + idPenalty
    + numericTextPenalty
    + templatedStringPenalty
    + nameBonus
    + unrelatedPenalty
    + affinity
    + categorical
    + semantic
    + fallbackChainPenalty
    + conditionalTestPenalty
    + regexComplexityPenalty
    + regexGroupPenalty;
  return clamp(rawAdjustment, -COST_ADJUSTMENT_CAP, COST_ADJUSTMENT_CAP);
}

export function costOf(op, hints = {}) {
  return (COST_PRIORS[op.op] ?? 2.5) + costAdjustment(op, hints) + sizeTerm(op);
}
