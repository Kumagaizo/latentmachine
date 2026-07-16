import { entries } from "./core.js";
import { opSources } from "./shared.js";

export function schemaPathKey(path) {
  return String(path || "$").replace(/\[\d+\]/g, "[]");
}

function schemaTypeMap(value) {
  const map = new Map();
  for (const entry of entries(value, [], { includeContainers: true })) {
    const key = schemaPathKey(entry.path);
    if (!map.has(key)) map.set(key, { path: entry.path, types: new Set() });
    map.get(key).types.add(entry.type);
  }
  return map;
}

function mergedExampleSchema(examples) {
  const merged = new Map();
  for (const example of examples) {
    for (const [key, row] of schemaTypeMap(example.input)) {
      if (!merged.has(key)) merged.set(key, { path: row.path, types: new Set() });
      for (const type of row.types) merged.get(key).types.add(type);
    }
  }
  return merged;
}

export function schemaDriftForProgram(program, examples, newInput) {
  const expected = mergedExampleSchema(examples);
  const actual = schemaTypeMap(newInput);
  const used = new Set((program.ops || []).flatMap(opSources).map(schemaPathKey));
  const blocking = [];
  const advisory = [];

  for (const [key, expectedRow] of expected) {
    if (key === "$") continue;
    const actualRow = actual.get(key);
    if (!actualRow) {
      if (!used.has(key)) {
        advisory.push({
          type: "schema-missing-field",
          path: expectedRow.path,
          expectedTypes: [...expectedRow.types],
          message: `${expectedRow.path} appeared in the examples but is missing from the new input.`,
        });
      }
      continue;
    }

    const actualTypes = [...actualRow.types];
    const changed = actualTypes.some(type => !expectedRow.types.has(type));
    if (!changed) continue;
    const row = {
      type: used.has(key) ? "type-changed-source" : "schema-type-changed",
      path: actualRow.path,
      source: actualRow.path,
      expectedTypes: [...expectedRow.types],
      actualTypes,
      message: `${actualRow.path} changed type from ${[...expectedRow.types].join(" or ")} to ${actualTypes.join(" or ")}.`,
    };
    if (used.has(key)) blocking.push(row);
    else advisory.push(row);
  }

  for (const [key, actualRow] of actual) {
    if (key === "$" || expected.has(key)) continue;
    advisory.push({
      type: "schema-new-field",
      path: actualRow.path,
      actualTypes: [...actualRow.types],
      message: `${actualRow.path} is new in this input and was not present in the examples.`,
    });
  }

  return { blocking, advisory: advisory.slice(0, 20) };
}
