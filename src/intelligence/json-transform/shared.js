export function stableStringify(value) {
  if (value === undefined) return "__undefined__";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function deepEqual(first, second) {
  return stableStringify(first) === stableStringify(second);
}

export function opSources(op = {}) {
  if (op.op === "template") return (op.parts || []).filter(part => part.kind === "source").map(part => part.path);
  if (op.op === "concat" || op.op === "fallback") return op.sources || [];
  if (op.op === "numericBinary") return [op.left, op.right].filter(Boolean);
  if (["arrayMap", "arrayProject", "arrayCount", "arrayJoin", "arrayFind", "arrayGroupBy", "arrayStringTransform"].includes(op.op)) return [op.source].filter(Boolean);
  return op.source ? [op.source] : [];
}
