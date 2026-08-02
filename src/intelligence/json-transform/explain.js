function quote(value) {
  return JSON.stringify(value);
}

function list(items = []) {
  const values = items.filter(Boolean);
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function code(path) {
  return `\`${path || "$"}\``;
}

function valueList(values = [], max = 4) {
  const visible = values.slice(0, max).map(quote);
  return values.length > max ? `${visible.join(", ")}, and ${values.length - max} more` : list(visible);
}

function mapEntries(map = {}) {
  return Object.entries(map).map(([from, to]) => {
    let parsed = from;
    try {
      parsed = JSON.parse(from);
    } catch {
      parsed = from;
    }
    return `${quote(parsed)} to ${quote(to)}`;
  });
}

function mapKeys(map = {}) {
  return Object.keys(map).map(value => {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  });
}

function typeLabel(type = "") {
  const labels = {
    string: "text",
    number: "number",
    boolean: "true or false",
    array: "an array",
    object: "an object",
    null: "null",
  };
  return labels[type] || type;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function transformName(mode = "identity") {
  const labels = {
    collapseWhitespace: "clean repeated spaces",
    dateNormalize: "normalize the date",
    emailLocalPart: "take the email name before \"@\"",
    identity: "keep the text unchanged",
    lower: "lowercase the text",
    phone: "normalize the phone number",
    s3KeyDecode: "decode the S3 key",
    title: "title-case the text",
    trim: "trim spaces",
    upper: "uppercase the text",
  };
  if (String(mode).includes("+")) return mode.split("+").map(transformName).join(", then ");
  return labels[mode] || `apply ${mode}`;
}

export function explanationSourceFields(op = {}) {
  if (!op) return [];
  if (op.op === "template") return op.parts?.filter(part => part.kind === "source").map(part => part.path) || [];
  if (op.op === "concat") return op.sources || [];
  if (op.op === "fallback") return op.sources || [];
  if (op.op === "numericBinary") return [op.left, op.right].filter(Boolean);
  if (op.op === "numericFormula") return [op.base, op.rate].filter(Boolean);
  if (op.op === "arrayProject") {
    return [
      op.source,
      op.where?.path,
      ...(op.fields || []).map(field => field.source),
    ].filter(Boolean);
  }
  if (["arrayMap", "arrayJoin"].includes(op.op)) return [op.source, op.where?.path, op.extract].filter(Boolean);
  if (op.op === "arrayCount") return [op.source, op.where?.path].filter(Boolean);
  if (["arraySum", "arrayIndex"].includes(op.op)) return [op.source, op.extract].filter(Boolean);
  if (op.op === "arrayFind") return [op.source, op.where?.path, op.extract].filter(Boolean);
  if (op.op === "arrayGroupBy") return [op.source, op.groupBy, op.extract].filter(Boolean);
  if (op.op === "templateConflict") return op.sources || [];
  return op.source ? [op.source] : [];
}

function templatePartText(part) {
  if (part.kind === "literal") return quote(part.value);
  const source = code(part.path);
  return part.transform && part.transform !== "identity" ? `${transformName(part.transform)} from ${source}` : source;
}

function projectFieldText(field) {
  const source = code(field.source);
  const target = code(field.target);
  return field.transform ? `${transformName(field.transform)} from ${source} into ${target}` : `${source} into ${target}`;
}

export function explainOp(op = {}) {
  const target = code(op.target);
  if (op.op === "set") return `Copy ${code(op.source)} to ${target}.`;
  if (op.op === "constant") return `Write ${quote(op.value)} to ${target} every time.`;
  if (op.op === "coerce") return `Read ${code(op.source)} as ${op.to} and write it to ${target}.`;
  if (op.op === "stringCase") return `${transformName(op.mode)} from ${code(op.source)} and write it to ${target}.`;
  if (op.op === "stringNormalize") return `${transformName(op.mode)} from ${code(op.source)} and write it to ${target}.`;
  if (op.op === "stringReplace") return `Replace every ${quote(op.search)} in ${code(op.source)} with ${quote(op.replacement)}, then write it to ${target}.`;
  if (op.op === "arrayStringTransform") return `${transformName(op.mode)} for each string in ${code(op.source)} and write the array to ${target}.`;
  if (op.op === "dateFormat") return `Format the date in ${code(op.source)} as ${op.mode} and write it to ${target}.`;
  if (op.op === "booleanNot") return `Invert ${code(op.source)} and write the result to ${target}.`;
  if (op.op === "conditional") {
    const testWord = op.test === "notEquals" ? "is not" : "is";
    return `If ${code(op.source)} ${testWord} ${quote(op.value)}, write ${quote(op.then)} to ${target}; otherwise write ${quote(op.else)}.`;
  }
  if (op.op === "fallback") {
    return `Use the first available value from ${list((op.sources || []).map(code))} and write it to ${target}.`;
  }
  if (op.op === "numericTransform") {
    const action = op.mode === "multiply"
      ? `Multiply ${code(op.source)} by ${op.value}`
      : op.mode === "divide"
        ? `Divide ${code(op.source)} by ${op.value}`
        : `Add ${op.value} to ${code(op.source)}`;
    return `${action} and write the result to ${target}.`;
  }
  if (op.op === "numericBinary") {
    const actions = { add: "Add", subtract: "Subtract", multiply: "Multiply" };
    return `${actions[op.mode] || "Combine"} ${code(op.left)} and ${code(op.right)}, then write the result to ${target}.`;
  }
  if (op.op === "numericFormula") {
    const direction = op.direction === "decrease" ? "subtract" : "add";
    return `Divide ${code(op.base)} by ${op.baseDivisor}, ${direction} the ${code(op.rate)} percentage, round with ${op.rounding || op.round} to ${op.decimals} decimals, and write the result to ${target}.`;
  }
  if (op.op === "quantityTransform") return `Multiply ${code(op.source)} by ${op.factor} for ${op.unit || "the target unit"} and write the result to ${target}.`;
  if (op.op === "concat") {
    const separator = op.separators?.[0] ?? "";
    return `Join ${list((op.sources || []).map(code))} with ${quote(separator)} and write the result to ${target}.`;
  }
  if (op.op === "template") {
    return `Build ${target} from ${list((op.parts || []).map(templatePartText))}.`;
  }
  if (op.op === "splitPart") {
    return `Split ${code(op.source)} on ${quote(op.separator)} and write part ${op.index + 1} to ${target}.`;
  }
  if (op.op === "extractBetween") {
    const prefix = op.prefix ? `after ${quote(op.prefix)}` : "from the start";
    const suffix = op.suffix ? `before ${quote(op.suffix)}` : "through the end";
    return `Take text in ${code(op.source)} ${prefix} and ${suffix}, then write it to ${target}.`;
  }
  if (op.op === "regexExtract") {
    return `Extract the text matching \`/${op.pattern}/\` from ${code(op.source)} and write it to ${target}.`;
  }
  if (op.op === "stringSplit") return `Split ${code(op.source)} on ${quote(op.separator)} and write the values to ${target}.`;
  if (op.op === "valueMap") {
    const pairs = mapEntries(op.map || {});
    return `Use the ${pairs.length} mappings seen for ${code(op.source)} to write ${target}: ${pairs.slice(0, 4).join(", ")}${pairs.length > 4 ? `, and ${pairs.length - 4} more` : ""}.`;
  }
  if (op.op === "arrayMap") {
    const filter = op.where ? ` where ${code(op.where.path)} is ${quote(op.where.equals)}` : "";
    return `From each item in ${code(op.source)}${filter}, take ${code(op.extract)} and write the values to ${target}.`;
  }
  if (op.op === "arrayProject") {
    const filter = op.where ? ` where ${code(op.where.path)} is ${quote(op.where.equals)}` : "";
    return `For each item in ${code(op.source)}${filter}, write ${target} with ${list((op.fields || []).map(projectFieldText))}.`;
  }
  if (op.op === "arrayCount") {
    const filter = op.where ? ` where ${code(op.where.path)} is ${quote(op.where.equals)}` : "";
    return `Count items in ${code(op.source)}${filter} and write the number to ${target}.`;
  }
  if (op.op === "arraySum") {
    const extract = op.extract ? ` at ${code(op.extract)}` : "";
    return `Sum numeric values${extract} in ${code(op.source)} and write the result to ${target}.`;
  }
  if (op.op === "arrayIndex") {
    const extract = op.extract ? `, take ${code(op.extract)}` : "";
    return `Select the ${String(op.index)} item in ${code(op.source)}${extract}, and write it to ${target}.`;
  }
  if (op.op === "arrayJoin") {
    const filter = op.where ? ` where ${code(op.where.path)} is ${quote(op.where.equals)}` : "";
    const extract = op.extract ? ` using ${code(op.extract)}` : "";
    return `Join values from ${code(op.source)}${filter}${extract} with ${quote(op.separator || "")} and write the text to ${target}.`;
  }
  if (op.op === "arrayFind") {
    return `Find the first item in ${code(op.source)} where ${code(op.where?.path)} is ${quote(op.where?.equals)}, take ${code(op.extract)}, and write it to ${target}.`;
  }
  if (op.op === "arrayGroupBy") {
    return `Group items in ${code(op.source)} by ${code(op.groupBy)}, collecting ${code(op.extract)} values, and write the result to ${target}.`;
  }
  if (op.op === "templateConflict") {
    return `The examples do not agree on how ${list((op.sources || []).map(code))} should build ${target}.`;
  }
  if (op.op === "valueMapConflict") {
    return `The examples disagree about which value ${code(op.source)} should write to ${target}.`;
  }
  return `Use ${code(explanationSourceFields(op)[0] || "$")} to write ${target}.`;
}

export function explainProgram(program = {}) {
  return (program.ops || []).map(op => ({
    target: op.target || "$",
    sentence: explainOp(op),
    sourceFields: explanationSourceFields(op),
  }));
}

function assumption(field, sentence, options = {}) {
  return {
    field,
    sentence,
    target: options.target || null,
    sourceFields: options.sourceFields || [field].filter(Boolean),
    kind: options.kind || "precondition",
  };
}

function typeAssumption(precondition = {}) {
  const field = precondition.field;
  if (!field) return null;
  const type = precondition.type && precondition.type !== "unknown" ? ` as ${typeLabel(precondition.type)}` : "";
  return assumption(field, `Assumes ${code(field)} is present${type}.`, {
    target: precondition.usedBy || null,
    kind: "presence",
  });
}

function opAssumptions(op = {}) {
  const target = op.target;
  if (op.op === "conditional") {
    return [assumption(op.source, `Assumes ${code(op.source)} determines the value of ${code(op.target)}.`, {
      target,
      kind: "conditional",
    })];
  }
  if (op.op === "fallback") {
    return [assumption(op.sources?.[0], `Assumes at least one of ${list((op.sources || []).map(code))} is present.`, {
      target,
      sourceFields: op.sources || [],
      kind: "fallback",
    })];
  }
  if (op.op === "constant") {
    return [assumption(target, `Assumes ${code(target)} should always be ${quote(op.value)}.`, { target, sourceFields: [], kind: "constant" })];
  }
  if (op.op === "coerce") {
    return [assumption(op.source, `Assumes ${code(op.source)} can be read as ${op.to}.`, { target, kind: "type" })];
  }
  if (op.op === "dateFormat") {
    return [assumption(op.source, `Assumes ${code(op.source)} contains a valid date.`, { target, kind: "date" })];
  }
  if (op.op === "booleanNot") {
    return [assumption(op.source, `Assumes ${code(op.source)} is true or false.`, { target, kind: "boolean" })];
  }
  if (op.op === "numericTransform") {
    return [assumption(op.source, `Assumes ${code(op.source)} can be read as a number.`, { target, kind: "number" })];
  }
  if (op.op === "numericBinary") {
    return [op.left, op.right].filter(Boolean).map(field => (
      assumption(field, `Assumes ${code(field)} can be read as a number.`, { target, sourceFields: [op.left, op.right].filter(Boolean), kind: "number" })
    ));
  }
  if (op.op === "numericFormula") {
    return [op.base, op.rate].filter(Boolean).map(field => (
      assumption(field, `Assumes ${code(field)} can be read as a number for the percentage formula.`, { target, sourceFields: [op.base, op.rate].filter(Boolean), kind: "number" })
    ));
  }
  if (op.op === "quantityTransform") {
    return [assumption(op.source, `Assumes ${code(op.source)} uses the same quantity shape shown in the examples.`, { target, kind: "quantity" })];
  }
  if (op.op === "stringNormalize" && op.mode === "emailLocalPart") {
    return [assumption(op.source, `Assumes ${code(op.source)} contains "@".`, { target, kind: "text" })];
  }
  if (op.op === "stringReplace") {
    return [assumption(op.source, `Assumes ${code(op.source)} uses ${quote(op.search)} as the delimiter to replace.`, { target, kind: "text" })];
  }
  if (op.op === "stringNormalize" && op.mode === "phone") {
    return [assumption(op.source, `Assumes ${code(op.source)} contains a phone number in the same country-code pattern as the examples.`, { target, kind: "phone" })];
  }
  if (op.op === "stringNormalize" && op.mode === "dateNormalize") {
    return [assumption(op.source, `Assumes ${code(op.source)} contains a date.`, { target, kind: "date" })];
  }
  if (op.op === "splitPart") {
    return [assumption(op.source, `Assumes ${code(op.source)} contains ${quote(op.separator)} and has part ${op.index + 1}.`, { target, kind: "split" })];
  }
  if (op.op === "extractBetween") {
    const markers = [op.prefix ? quote(op.prefix) : null, op.suffix ? quote(op.suffix) : null].filter(Boolean);
    return [assumption(op.source, `Assumes ${code(op.source)} contains ${list(markers)}.`, { target, kind: "text" })];
  }
  if (op.op === "regexExtract") {
    return [assumption(op.source, `Assumes ${code(op.source)} contains text matching \`/${op.pattern}/\`.`, { target, kind: "regex" })];
  }
  if (op.op === "stringSplit") {
    return [assumption(op.source, `Assumes ${code(op.source)} uses ${quote(op.separator)} between values.`, { target, kind: "split" })];
  }
  if (op.op === "valueMap") {
    return [assumption(op.source, `Assumes ${code(op.source)} is one of ${valueList(mapKeys(op.map || {}))}.`, { target, kind: "lookup" })];
  }
  if (op.op === "arrayStringTransform") {
    return [assumption(op.source, `Assumes ${code(op.source)} is an array of strings.`, { target, kind: "array" })];
  }
  if (["arrayMap", "arrayProject", "arrayCount", "arraySum", "arrayIndex", "arrayJoin", "arrayFind", "arrayGroupBy"].includes(op.op)) {
    const rows = [assumption(op.source, `Assumes ${code(op.source)} is an array.`, { target, kind: "array" })];
    if (op.where?.path) {
      rows.push(assumption(op.source, `Assumes items in ${code(op.source)} can be checked at ${code(op.where.path)} for ${quote(op.where.equals)}.`, {
        target,
        sourceFields: [op.source, op.where.path],
        kind: "filter",
      }));
    }
    if (op.extract) {
      rows.push(assumption(op.source, `Assumes matching items in ${code(op.source)} contain ${code(op.extract)}.`, {
        target,
        sourceFields: [op.source, op.extract],
        kind: "extract",
      }));
    }
    if (op.op === "arrayGroupBy") {
      rows.push(assumption(op.source, `Assumes each item in ${code(op.source)} contains a string or number at ${code(op.groupBy)}.`, {
        target,
        sourceFields: [op.source, op.groupBy],
        kind: "group",
      }));
    }
    if (op.op === "arrayProject") {
      for (const field of op.fields || []) {
        rows.push(assumption(op.source, `Assumes each item in ${code(op.source)} can read ${code(field.source)}.`, {
          target,
          sourceFields: [op.source, field.source],
          kind: "project",
        }));
      }
    }
    return rows;
  }
  return [];
}

export function explainAssumptions(program = {}, preconditions = []) {
  const rows = [
    ...preconditions.map(typeAssumption).filter(Boolean),
    ...(program.ops || []).flatMap(opAssumptions),
  ];
  return uniqueBy(rows, row => `${row.field}:${row.sentence}`);
}
