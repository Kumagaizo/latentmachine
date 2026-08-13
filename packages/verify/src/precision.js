const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const PRECISION_ITEM_LIMIT = 20;

function jsonPath(segments) {
  if (!segments.length) return "$";
  return `$${segments.map(segment => {
    if (typeof segment === "number") return `[${segment}]`;
    return /^[A-Za-z_$][\w$]*$/.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`;
  }).join("")}`;
}

function unsafeIntegerTokens(text) {
  const tokens = [];
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== "-" && (character < "0" || character > "9")) continue;

    numberPattern.lastIndex = index;
    const match = numberPattern.exec(text);
    if (!match) continue;
    const literal = match[0];
    if (/^-?(?:0|[1-9]\d*)$/.test(literal)) {
      const magnitude = BigInt(literal) < 0 ? -BigInt(literal) : BigInt(literal);
      if (magnitude > MAX_SAFE_INTEGER) tokens.push({ start: index, end: index + literal.length, literal });
    }
    index += literal.length - 1;
  }
  return tokens;
}

function locateTokenPaths(text, tokens) {
  let markerPrefix = "__latentmachine_unsafe_integer_";
  while (text.includes(markerPrefix)) markerPrefix = `_${markerPrefix}`;
  const instrumentedParts = [];
  let cursor = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    instrumentedParts.push(text.slice(cursor, token.start), `"${markerPrefix}${index}__"`);
    cursor = token.end;
  }
  instrumentedParts.push(text.slice(cursor));
  const instrumented = instrumentedParts.join("");

  const parsed = JSON.parse(instrumented);
  const paths = new Map();
  const stack = [{ value: parsed, path: [] }];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current.value === "string" && current.value.startsWith(markerPrefix)) {
      const markerIndex = Number(current.value.slice(markerPrefix.length, -2));
      if (Number.isInteger(markerIndex)) paths.set(markerIndex, jsonPath(current.path));
      continue;
    }
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], path: [...current.path, index] });
      }
    } else if (current.value && typeof current.value === "object") {
      for (const [key, value] of Object.entries(current.value)) {
        stack.push({ value, path: [...current.path, key] });
      }
    }
  }
  return paths;
}

/** Inspect valid raw JSON before JSON.parse can round unsafe integer literals. */
export function inspectJsonPrecision(text) {
  if (typeof text !== "string") return null;
  const tokens = unsafeIntegerTokens(text);
  if (!tokens.length) return null;
  const paths = locateTokenPaths(text, tokens);
  const items = tokens.slice(0, PRECISION_ITEM_LIMIT).map((token, index) => ({
    literal: token.literal,
    path: paths.get(index) || null,
  }));
  return {
    unsafeIntegerLiterals: tokens.length,
    detail: "Input contains integer literals beyond IEEE 754's safe range. Values were compared after number conversion and may be indistinguishable.",
    items,
    paths: items.map(item => item.path).filter(Boolean),
    capped: tokens.length > PRECISION_ITEM_LIMIT,
    limit: PRECISION_ITEM_LIMIT,
  };
}
