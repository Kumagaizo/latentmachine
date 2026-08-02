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
  const rowCount = examples.length;
  return {
    ...program,
    ops: (program.ops || []).map(op => {
      if (!["valueMap", "valueMapConflict"].includes(op.op)) return op;
      const tableEntries = op.op === "valueMap"
        ? Object.keys(op.map || {}).length
        : distinctSourceCount(op, examples);
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
  const targets = [...new Set((program?.ops || []).map(op => op.target).filter(Boolean))];
  return {
    maxRatio: lookups.length ? Math.max(...lookups.map(item => item.ratio)) : 0,
    memorisedTargets,
    verifiedTargets: targets.filter(target => !memorisedTargets.includes(target)),
    threshold: MEMORISATION_RATIO_THRESHOLD,
    minimumRows: MEMORISATION_MINIMUM_ROWS,
    lookups,
  };
}

export function memorisationSummary(memorisation = {}) {
  const lookups = (memorisation.lookups || []).filter(item => (
    (memorisation.memorisedTargets || []).includes(item.target)
  ));
  const total = (memorisation.verifiedTargets || []).length + (memorisation.memorisedTargets || []).length;
  if (!lookups.length) {
    return `${total} field${total === 1 ? "" : "s"} checked. All were verified against a reusable rule.`;
  }
  const fields = lookups.map(item => `${item.target} (${item.tableEntries} of ${item.rowCount} rows)`).join(", ");
  return `${total} fields checked. ${memorisation.verifiedTargets.length} verified against a reusable rule. ${lookups.length} could not be verified because the engine fitted memorised lookups: ${fields}. Drift in these fields would not be detected.`;
}
