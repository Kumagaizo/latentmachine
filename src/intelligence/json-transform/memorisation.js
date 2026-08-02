import { getPath } from "./core.js";

export const MEMORISATION_RATIO_THRESHOLD = 0.5;
export const MEMORISATION_MINIMUM_ROWS = 8;

function roundRatio(value) {
  return Number(value.toFixed(4));
}

function distinctSourceCount(op, examples) {
  return new Set(examples.map(example => JSON.stringify(getPath(example.input, op.source)))).size;
}

export function instrumentProgramMemorisation(program, examples = []) {
  return {
    ...program,
    ops: (program.ops || []).map(op => {
      if (!["valueMap", "valueMapConflict"].includes(op.op)) return op;
      const rowCount = op.domain?.supportCount ?? examples.length;
      const tableEntries = op.op === "valueMap"
        ? Object.keys(op.map || {}).length
        : distinctSourceCount(op, op.domain?.optional
          ? examples.filter(example => getPath(example.output, op.target) !== undefined)
          : examples);
      return {
        ...op,
        memorisation: {
          tableEntries,
          rowCount,
          ratio: rowCount ? roundRatio(tableEntries / rowCount) : 0,
        },
      };
    }),
  };
}

export function memorisationForProgram(program) {
  const lookups = (program?.ops || [])
    .filter(op => ["valueMap", "valueMapConflict"].includes(op.op))
    .map(op => ({
      op: op.op,
      source: op.source,
      target: op.target,
      ...(op.memorisation || { tableEntries: 0, rowCount: 0, ratio: 0 }),
    }));
  const memorised = lookups.filter(item => (
    item.rowCount >= MEMORISATION_MINIMUM_ROWS
    && item.ratio >= MEMORISATION_RATIO_THRESHOLD
  ));
  const memorisedTargets = [...new Set(memorised.map(item => item.target).filter(Boolean))];
  const fieldDomains = (program?.fieldDomains || []).filter(domain => domain?.target);
  const insufficientSupport = fieldDomains
    .filter(domain => domain.unverifiable)
    .map(domain => ({
      target: domain.target,
      supportCount: domain.supportCount,
      rowCount: domain.totalRows,
      coverage: domain.coverage,
      reason: domain.reason || "unproven-domain",
      detail: domain.reason === "insufficient-support"
        ? `${domain.target} was present in ${domain.supportCount} of ${domain.totalRows} rows; too few examples to infer a rule.`
        : `${domain.target} was optional, but its presence could not be tied to a reusable input-field domain.`,
      caps: "unverified",
    }));
  const insufficientTargets = insufficientSupport.map(item => item.target);
  const unverifiableTargets = [...new Set([...memorisedTargets, ...insufficientTargets])];
  const targets = [...new Set([
    ...(program?.ops || []).map(op => op.target),
    ...fieldDomains.map(domain => domain.target),
  ].filter(Boolean))];
  const nonMemorisedTargets = targets.filter(target => !memorisedTargets.includes(target));
  const passthroughTargets = [...new Set((program?.ops || [])
    .filter(op => op.op === "set" && op.source === op.target && !unverifiableTargets.includes(op.target))
    .map(op => op.target))];
  return {
    maxRatio: lookups.length ? Math.max(...lookups.map(item => item.ratio)) : 0,
    memorisedTargets,
    insufficientSupportTargets: insufficientTargets,
    unverifiableTargets,
    insufficientSupport,
    nonMemorisedTargets,
    ruleVerifiedTargets: nonMemorisedTargets.filter(target => (
      !passthroughTargets.includes(target) && !unverifiableTargets.includes(target)
    )),
    passthroughTargets,
    threshold: MEMORISATION_RATIO_THRESHOLD,
    minimumRows: MEMORISATION_MINIMUM_ROWS,
    lookups,
  };
}

export function memorisationSummary(memorisation = {}) {
  const lookups = (memorisation.lookups || []).filter(item => (
    (memorisation.memorisedTargets || []).includes(item.target)
  ));
  const reusableCount = (memorisation.ruleVerifiedTargets || []).length;
  const passthroughCount = (memorisation.passthroughTargets || []).length;
  const unverifiableTargets = memorisation.unverifiableTargets || memorisation.memorisedTargets || [];
  const total = reusableCount + passthroughCount + unverifiableTargets.length;
  const verifiedText = `${reusableCount} verified against reusable rules. ${passthroughCount} passed through unchanged.`;
  const insufficient = memorisation.insufficientSupport || [];
  if (!lookups.length && !insufficient.length) {
    return `${total} field${total === 1 ? "" : "s"} checked. ${verifiedText}`;
  }
  const parts = [];
  if (lookups.length) {
    const fields = lookups.map(item => `${item.target} (${item.tableEntries} of ${item.rowCount} rows)`).join(", ");
    parts.push(`${lookups.length} could not be verified because the engine fitted memorised lookups: ${fields}.`);
  }
  if (insufficient.length) {
    parts.push(`${insufficient.length} could not be verified because support was insufficient: ${insufficient.map(item => `${item.target} (${item.supportCount} of ${item.rowCount} rows)`).join(", ")}.`);
  }
  const driftHint = lookups.length === 1 && unverifiableTargets.length === 1 && reusableCount + passthroughCount > 0
    ? ` ${lookups[0].target} was the only field that could not be reduced to a rule; inspect it first for a small number of drifted values.`
    : "";
  const domainNote = insufficient.length
    ? " Rows outside insufficiently supported field domains were not treated as contradictions."
    : "";
  return `${total} fields checked. ${verifiedText} ${parts.join(" ")}${domainNote} Unverifiable fields do not contribute row flags.${driftHint}`;
}
