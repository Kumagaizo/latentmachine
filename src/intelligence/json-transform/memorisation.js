import { getPath } from "./core.js";
import { stableStringify } from "./shared.js";

export const MEMORISATION_RATIO_THRESHOLD = 0.5;
export const MEMORISATION_MINIMUM_ROWS = 8;

function roundRatio(value) {
  return Number(value.toFixed(4));
}

function distinctSourceCount(op, examples) {
  return new Set(examples.map(example => JSON.stringify(getPath(example.input, op.source)))).size;
}

function lookupConsistency(op, examples) {
  const groups = new Map();
  for (const example of examples) {
    const source = stableStringify(getPath(example.input, op.source));
    const group = groups.get(source) || { count: 0, outputs: new Set() };
    group.count += 1;
    group.outputs.add(stableStringify(getPath(example.output, op.target)));
    groups.set(source, group);
  }
  const repeated = [...groups.values()].filter(group => group.count > 1);
  return {
    repeatedSourceValues: repeated.length,
    conflictingSourceValues: repeated.filter(group => group.outputs.size > 1).length,
  };
}

export function instrumentProgramMemorisation(program, examples = []) {
  return {
    ...program,
    ops: (program.ops || []).map(op => {
      if (!["valueMap", "valueMapConflict"].includes(op.op)) return op;
      const rowCount = op.inference?.rowCount ?? op.domain?.supportCount ?? examples.length;
      const domainExamples = op.domain?.optional
        ? examples.filter(example => getPath(example.output, op.target) !== undefined)
        : examples;
      const tableEntries = op.op === "valueMap"
        ? Object.keys(op.map || {}).length
        : distinctSourceCount(op, domainExamples);
      const unseenSourceCount = op.op === "valueMap"
        ? domainExamples.filter(example => !Object.prototype.hasOwnProperty.call(op.map || {}, JSON.stringify(getPath(example.input, op.source)))).length
        : 0;
      const consistency = lookupConsistency(op, domainExamples);
      return {
        ...op,
        memorisation: {
          tableEntries,
          rowCount,
          ratio: rowCount ? roundRatio(tableEntries / rowCount) : 0,
          supportCount: domainExamples.length,
          sampled: !!op.inference?.sampled,
          unseenSourceCount,
          ...consistency,
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
  const ruleDemotions = (program?.ops || [])
    .filter(op => op.fit?.contradictingRows?.length && !memorisedTargets.includes(op.target))
    .map(op => ({
      target: op.target,
      demotedFrom: op.op,
      source: op.source || op.base || null,
      contradictingRows: op.fit.contradictingRows,
      ruleFitRatio: op.fit.ratio,
      supportCount: op.fit.supportCount,
      rowCount: op.fit.rowCount,
    }));
  const incompleteLookups = lookups.filter(item => item.sampled && item.unseenSourceCount > 0 && !memorisedTargets.includes(item.target));
  const incompleteLookupTargets = [...new Set(incompleteLookups.map(item => item.target).filter(Boolean))];
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
  const nearFitTargets = (program?.nearFits || []).map(item => item.target).filter(Boolean);
  const unverifiableTargets = [...new Set([...memorisedTargets, ...insufficientTargets, ...incompleteLookupTargets, ...nearFitTargets])];
  const nearFits = (program?.nearFits || []).filter(item => unverifiableTargets.includes(item.target));
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
    incompleteLookupTargets,
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
    ruleDemotions,
    nearFits,
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
  const incomplete = (memorisation.lookups || []).filter(item => (memorisation.incompleteLookupTargets || []).includes(item.target));
  const nearFits = memorisation.nearFits || [];
  if (!lookups.length && !insufficient.length && !incomplete.length && !nearFits.length) {
    return `${total} field${total === 1 ? "" : "s"} checked. ${verifiedText}`;
  }
  const parts = [];
  if (lookups.length) {
    const fields = lookups.map(item => {
      const support = item.supportCount && item.supportCount !== item.rowCount ? `; ${item.supportCount} total supported rows` : "";
      const consistency = item.repeatedSourceValues
        ? item.conflictingSourceValues
          ? `; ${item.conflictingSourceValues} repeated source value${item.conflictingSourceValues === 1 ? "" : "s"} had conflicting outputs`
          : `; ${item.repeatedSourceValues} repeated source value${item.repeatedSourceValues === 1 ? " was" : "s were"} internally consistent`
        : "; no repeated source values were available for a consistency check";
      return `${item.target} (${item.tableEntries} lookup entries from ${item.rowCount} inference rows${support}${consistency})`;
    }).join(", ");
    parts.push(`${lookups.length} could not be verified because the engine fitted memorised lookups: ${fields}.`);
  }
  if (insufficient.length) {
    parts.push(`${insufficient.length} could not be verified because support was insufficient: ${insufficient.map(item => `${item.target} (${item.supportCount} of ${item.rowCount} rows)`).join(", ")}.`);
  }
  if (incomplete.length) {
    parts.push(`${incomplete.length} could not be verified because bounded inference did not observe every source value: ${incomplete.map(item => `${item.target} (${item.unseenSourceCount} outside the inference sample)`).join(", ")}.`);
  }
  if (nearFits.length) {
    parts.push(`${nearFits.length} near-fit rule${nearFits.length === 1 ? " was" : "s were"} retained as non-accusing evidence: ${nearFits.map(item => `${item.target} (${item.supportCount} of ${item.rowCount} rows; ${(item.fitRatio * 100).toFixed(1)}% fit, ${(item.promotionThreshold * 100).toFixed(0)}% required)`).join(", ")}.`);
  }
  const domainNote = insufficient.length
    ? " Rows outside insufficiently supported field domains were not treated as contradictions."
    : "";
  return `${total} fields checked. ${verifiedText} ${parts.join(" ")}${domainNote} Unverifiable fields do not contribute row flags.`;
}
