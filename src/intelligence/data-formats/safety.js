const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function assertSafeObjectKey(key, context = "object") {
  if (UNSAFE_OBJECT_KEYS.has(String(key))) {
    throw new Error(`${context} uses unsafe key "${key}".`);
  }
}

export function assertSafeParsedValue(value, context = "parsed data") {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeParsedValue(item, `${context}[${index}]`));
    return value;
  }

  for (const [key, item] of Object.entries(value)) {
    assertSafeObjectKey(key, context);
    assertSafeParsedValue(item, `${context}.${key}`);
  }
  return value;
}
