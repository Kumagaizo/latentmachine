export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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

function assertSafePathParts(parts, path) {
  for (const part of parts) {
    if (typeof part === "string" && UNSAFE_PATH_KEYS.has(part)) {
      throw new Error(`Unsafe object path segment "${part}" in ${path}.`);
    }
  }
}

export function parsePath(path = "$") {
  if (path === "$") return [];
  const parts = [];
  const regex = /\.([A-Za-z_$][\w$]*)|\[(\d+|".*?"|'.*?')\]/g;
  let match;
  while ((match = regex.exec(path))) {
    if (match[1]) parts.push(match[1]);
    else if (/^\d+$/.test(match[2])) parts.push(Number(match[2]));
    else parts.push(JSON.parse(match[2].replace(/^'/, "\"").replace(/'$/, "\"")));
  }
  assertSafePathParts(parts, path);
  return parts;
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
