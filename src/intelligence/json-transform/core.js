export function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

export function formatPath(path = []) {
  if (!path.length) return "$";
  return `$${path.map(part => typeof part === "number" ? `[${part}]` : /^[A-Za-z_$][\w$]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`).join("")}`;
}

const UNSAFE_PATH_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const PATH_CACHE_LIMIT = 2048;
const PATH_CACHE = new Map([["$", Object.freeze([])]]);
const PATH_TOKEN_PATTERN = /\.([A-Za-z_$][\w$]*)|\[(?:(\d+)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*'))\]/y;

function parseQuotedPathPart(token) {
  if (token.startsWith('"')) return JSON.parse(token);

  const inner = token.slice(1, -1);
  let json = '"';
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char === '"') {
      json += '\\"';
      continue;
    }
    if (char === "\\" && inner[index + 1] === "'") {
      json += "'";
      index += 1;
      continue;
    }
    json += char;
  }
  return JSON.parse(`${json}"`);
}

function assertSafePathParts(parts, path) {
  for (const part of parts) {
    if (typeof part === "string" && UNSAFE_PATH_KEYS.has(part)) {
      throw new Error(`Unsafe object path segment "${part}" in ${path}.`);
    }
  }
}

export function parsePath(path = "$") {
  if (typeof path !== "string" || !path.startsWith("$")) {
    throw new Error(`Invalid object path ${JSON.stringify(path)}. Paths must start with $.`);
  }
  const cached = PATH_CACHE.get(path);
  if (cached) return cached;
  const parts = [];
  let cursor = 1;
  while (cursor < path.length) {
    PATH_TOKEN_PATTERN.lastIndex = cursor;
    const match = PATH_TOKEN_PATTERN.exec(path);
    if (!match) throw new Error(`Invalid object path ${JSON.stringify(path)} at position ${cursor}.`);
    if (match[1]) parts.push(match[1]);
    else if (match[2]) {
      const index = Number(match[2]);
      if (!Number.isSafeInteger(index)) throw new Error(`Invalid array index in object path ${JSON.stringify(path)}.`);
      parts.push(index);
    } else parts.push(parseQuotedPathPart(match[3] || match[4]));
    cursor = PATH_TOKEN_PATTERN.lastIndex;
  }
  assertSafePathParts(parts, path);
  const frozen = Object.freeze(parts);
  if (PATH_CACHE.size >= PATH_CACHE_LIMIT) {
    for (const key of PATH_CACHE.keys()) {
      if (key === "$") continue;
      PATH_CACHE.delete(key);
      break;
    }
  }
  PATH_CACHE.set(path, frozen);
  return frozen;
}

export function getPath(value, path) {
  return parsePath(path).reduce((current, part) => current?.[part], value);
}

export function setPath(root, path, value) {
  const parts = parsePath(path);
  if (!parts.length) return clone(value);
  let target = root;
  parts.forEach((part, index) => {
    const last = index === parts.length - 1;
    if (last) {
      target[part] = clone(value);
      return;
    }
    const next = parts[index + 1];
    if (target[part] === undefined) target[part] = typeof next === "number" ? [] : {};
    target = target[part];
  });
  return root;
}

export function omitPaths(value, paths = []) {
  const result = clone(value);
  for (const path of paths) {
    const parts = parsePath(path);
    if (!parts.length) return undefined;
    const parent = parts.slice(0, -1).reduce((current, part) => current?.[part], result);
    if (parent && typeof parent === "object") delete parent[parts.at(-1)];
  }
  return result;
}

export function entries(value, path = [], options = {}) {
  const includeContainers = options.includeContainers ?? false;
  const includeArrayLeaves = options.includeArrayLeaves ?? true;
  const current = { path: formatPath(path), rawPath: path, value, type: typeOf(value) };
  if (Array.isArray(value)) {
    const childEntries = value.flatMap((item, index) => entries(item, [...path, index], { ...options, includeArrayLeaves: false }));
    return includeArrayLeaves || !childEntries.length ? [current] : childEntries;
  }
  if (value && typeof value === "object") {
    const childEntries = Object.entries(value).flatMap(([key, item]) => entries(item, [...path, key], options));
    return includeContainers ? [current, ...childEntries] : childEntries;
  }
  return [current];
}

export function objectFields(value, path = []) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => objectFields(item, [...path, index]));
  return Object.entries(value).flatMap(([key, item]) => [
    { path: formatPath([...path, key]), key, type: typeOf(item), depth: path.length + 1 },
    ...objectFields(item, [...path, key]),
  ]);
}

export function arrayPaths(value) {
  return entries(value, [], { includeArrayLeaves: true })
    .filter(entry => Array.isArray(entry.value))
    .map(entry => entry.path);
}

export function distinctDefinedValues(rows, path) {
  return [...new Set(rows.map(row => JSON.stringify(getPath(row, path))).filter(value => value !== undefined))].map(JSON.parse);
}

export function itemLeafPaths(items) {
  const found = new Set();
  for (const item of items) {
    for (const entry of entries(item, [], { includeArrayLeaves: false })) found.add(entry.path);
  }
  return [...found].filter(path => path !== "$");
}

export function hasPathToken(path, pattern) {
  return parsePath(path).some(part => pattern.test(String(part).toLowerCase()));
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
