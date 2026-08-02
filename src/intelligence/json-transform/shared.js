export function stableStringify(value) {
  if (value === undefined) return "__undefined__";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "__number__:NaN";
    if (value === Infinity) return "__number__:Infinity";
    if (value === -Infinity) return "__number__:-Infinity";
    if (Object.is(value, -0)) return "__number__:-0";
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${Array.from({ length: value.length }, (_, index) => (
      index in value ? stableStringify(value[index]) : "__hole__"
    )).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function deepEqual(first, second) {
  return stableStringify(first) === stableStringify(second);
}

export function opSources(op = {}) {
  if (op.op === "template") return (op.parts || []).filter(part => part.kind === "source").map(part => part.path);
  if (op.op === "concat" || op.op === "fallback") return op.sources || [];
  if (op.op === "numericBinary") return [op.left, op.right].filter(Boolean);
  if (op.op === "numericFormula") return [op.base, op.rate].filter(Boolean);
  if (["arrayMap", "arrayProject", "arrayCount", "arraySum", "arrayIndex", "arrayJoin", "arrayFind", "arrayGroupBy", "arrayStringTransform"].includes(op.op)) return [op.source].filter(Boolean);
  return op.source ? [op.source] : [];
}
