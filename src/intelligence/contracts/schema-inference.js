const TYPE_ORDER = Object.freeze([
  "null",
  "boolean",
  "integer",
  "number",
  "string",
  "array",
  "object",
]);

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "object") return "object";
  return typeof value;
}

function objectSchema(values, options) {
  const keys = [...new Set(values.flatMap(value => Object.keys(value)))].sort();
  const required = keys.filter(key => values.every(value => Object.prototype.hasOwnProperty.call(value, key)));
  const properties = Object.fromEntries(keys.map(key => [
    key,
    inferSchema(
      values.filter(value => Object.prototype.hasOwnProperty.call(value, key)).map(value => value[key]),
      options,
    ),
  ]));

  return {
    type: "object",
    required,
    properties,
    additionalProperties: options.unknownFieldPolicy !== "block",
  };
}

function arraySchema(values, options) {
  const items = values.flat();
  return {
    type: "array",
    items: items.length ? inferSchema(items, options) : {},
  };
}

function schemaForType(type, values, options) {
  if (type === "object") return objectSchema(values, options);
  if (type === "array") return arraySchema(values, options);
  return { type };
}

export function inferSchema(values = [], options = {}) {
  const definedValues = values.filter(value => value !== undefined);
  if (!definedValues.length) return {};

  const grouped = new Map();
  for (const value of definedValues) {
    const type = valueType(value);
    if (!TYPE_ORDER.includes(type)) {
      throw new Error(`Cannot infer a Transformation Contract schema for ${type}.`);
    }
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push(value);
  }

  if (grouped.has("integer") && grouped.has("number")) {
    grouped.set("number", [...grouped.get("integer"), ...grouped.get("number")]);
    grouped.delete("integer");
  }

  const types = TYPE_ORDER.filter(type => grouped.has(type));
  if (types.length === 1) return schemaForType(types[0], grouped.get(types[0]), options);
  return {
    anyOf: types.map(type => schemaForType(type, grouped.get(type), options)),
  };
}

export function inferInputSchema(examples = []) {
  return inferSchema(examples.map(example => example.input), { unknownFieldPolicy: "allow" });
}

export function inferOutputSchema(examples = []) {
  return inferSchema(examples.map(example => example.output), { unknownFieldPolicy: "block" });
}
