import {
  clone,
  getPath,
  parsePath,
  setPath,
  typeOf,
} from "../json-transform/core.js";
import { executeJsonTransform } from "../json-transform/runtime.js";
import { deepEqual, stableStringify } from "../json-transform/shared.js";
import { fingerprintTransformationMutation } from "./identity.js";
import { evaluateTransformationInvariants } from "./invariants.js";
import { validateTransformationContract } from "./schema.js";
import { unwrapTransformationContract } from "./contract-input.js";

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function mutationCoverage(contract, mutations) {
  const operationTargets = [...new Set((contract.program?.ops || []).map(operation => operation.target).filter(Boolean))].sort(compareText);
  const targetedPaths = [...new Set(mutations.map(mutation => mutation.parameters?.path).filter(Boolean))].sort(compareText);
  const coveredTargets = operationTargets.filter(target => targetedPaths.includes(target));
  return {
    operationTargetCount: operationTargets.length,
    coveredTargetCount: coveredTargets.length,
    targetCoverage: operationTargets.length ? Number((coveredTargets.length / operationTargets.length).toFixed(4)) : 1,
    coveredTargets,
    uncoveredTargets: operationTargets.filter(target => !coveredTargets.includes(target)),
    mutationKinds: [...new Set(mutations.map(mutation => mutation.kind))].sort(compareText),
  };
}

function mutationId(contract, seed) {
  return `mutation_${fingerprintTransformationMutation(contract, seed).hex.slice(0, 12)}`;
}

function descriptor(contract, invariant, kind, subject, parameters, description) {
  const seed = {
    invariantId: invariant?.id || null,
    kind,
    subject,
    parameters,
  };
  return {
    id: mutationId(contract, seed),
    kind,
    subject,
    invariantId: invariant?.id || null,
    parameters: cloneJson(parameters),
    description,
  };
}

function incompatibleValue(expectedTypes = []) {
  const candidates = [
    ["string", "__latentmachine_wrong_type__"],
    ["integer", 101],
    ["number", 1.5],
    ["boolean", true],
    ["array", []],
    ["object", {}],
    ["null", null],
  ];
  return cloneJson(candidates.find(([type]) => !expectedTypes.includes(type))?.[1] ?? "__latentmachine_wrong_type__");
}

function schemaTypes(schema = {}) {
  if (typeof schema.type === "string") return [schema.type];
  if (Array.isArray(schema.type)) return schema.type;
  if (Array.isArray(schema.anyOf)) return [...new Set(schema.anyOf.flatMap(schemaTypes))];
  return [];
}

function schemaAtPath(schema, path) {
  let current = schema;
  for (const part of parsePath(path)) {
    if (!current) return null;
    if (Array.isArray(current.anyOf)) {
      current = current.anyOf.find(option => option?.properties?.[part] || option?.items) || current.anyOf[0];
    }
    current = typeof part === "number" ? current?.items : current?.properties?.[part];
  }
  return current || null;
}

function observedTargetValues(contract, target) {
  return (contract.evidence?.examples || [])
    .map(example => getPath(example.output, target))
    .filter(value => value !== undefined);
}

function operationTargetMutations(contract) {
  const byTarget = new Map();
  for (const operation of contract.program?.ops || []) {
    if (operation.target && !byTarget.has(operation.target)) byTarget.set(operation.target, operation);
  }
  return [...byTarget.entries()].flatMap(([target, operation]) => {
    const values = observedTargetValues(contract, target);
    const observedTypes = [...new Set(values.map(typeOf))];
    const expectedTypes = schemaTypes(schemaAtPath(contract.output?.schema, target));
    const mutations = [
      descriptor(contract, null, "remove-operation-target", "output", { path: target }, `Remove learned operation target ${target}.`),
      descriptor(contract, null, "change-operation-target-type", "output", {
        path: target,
        value: incompatibleValue(expectedTypes.length ? expectedTypes : observedTypes),
      }, `Replace learned operation target ${target} with an incompatible JSON type.`),
    ];
    if (values.length && values.every(value => typeof value === "string") && values.some(value => /[A-Za-z]/.test(value))) {
      mutations.push(descriptor(contract, null, "change-target-case", "output", {
        path: target,
      }, `Change letter casing at learned string target ${target}.`));
      if (operation.op === "dateFormat" || /(date|time|created|updated|joined)/i.test(target) || values.some(value => /^\d{4}-\d{2}-\d{2}/.test(value))) {
        mutations.push(descriptor(contract, null, "change-target-date-format", "output", {
          path: target,
        }, `Change the date representation at learned target ${target}.`));
      }
    }
    if (values.length && values.every(value => typeof value === "number")) {
      mutations.push(descriptor(contract, null, "scale-target-unit", "output", {
        path: target,
        factor: 100,
      }, `Scale numeric target ${target} by 100 to probe unit drift.`));
    }
    if (["concat", "template"].includes(operation.op)) {
      mutations.push(descriptor(contract, null, "swap-composition-order", "output", {
        path: target,
      }, `Reverse the composed parts at learned target ${target}.`));
    }
    return mutations;
  });
}

function disallowedValue(values = []) {
  const candidates = [
    "__latentmachine_disallowed__",
    987654321,
    false,
    null,
    { mutation: true },
  ];
  return cloneJson(candidates.find(candidate => !values.some(value => deepEqual(value, candidate))));
}

function mutationForInvariant(contract, invariant) {
  const parameters = invariant.parameters;
  if (invariant.kind === "required_path") {
    return descriptor(contract, invariant, "remove-required-path", parameters.subject, {
      path: parameters.path,
    }, `Remove required ${parameters.subject} path ${parameters.path}.`);
  }
  if (invariant.kind === "path_type") {
    return descriptor(contract, invariant, "change-path-type", parameters.subject, {
      path: parameters.path,
      value: incompatibleValue(parameters.expectedTypes),
    }, `Replace ${parameters.subject} path ${parameters.path} with an incompatible JSON type.`);
  }
  if (invariant.kind === "output_path_present") {
    return descriptor(contract, invariant, "remove-output-path", "output", {
      path: parameters.path,
    }, `Remove required output path ${parameters.path}.`);
  }
  if (invariant.kind === "output_path_absent") {
    return descriptor(contract, invariant, "add-forbidden-output-path", "output", {
      path: parameters.path,
      value: "__latentmachine_forbidden__",
    }, `Add forbidden output path ${parameters.path}.`);
  }
  if (invariant.kind === "no_unresolved_values") {
    return descriptor(contract, invariant, "inject-unresolved-output", "output", {
      path: firstOutputPath(contract),
      value: "[unresolved: mutation probe]",
    }, "Inject an unresolved placeholder into a learned output path.");
  }
  if (invariant.kind === "no_unknown_output_fields") {
    return descriptor(contract, invariant, "add-unknown-output-field", "output", {
      path: "$.__latentmachine_unknown",
      value: true,
    }, "Add a field outside the learned output schema.");
  }
  if (["source_path_preserved", "output_equals_source"].includes(invariant.kind)) {
    return descriptor(contract, invariant, "corrupt-preserved-output", "output", {
      path: parameters.targetPath,
      value: "__latentmachine_corrupted__",
    }, `Corrupt copied output path ${parameters.targetPath}.`);
  }
  if (invariant.kind === "allowed_values") {
    return descriptor(contract, invariant, "inject-disallowed-value", parameters.subject, {
      path: parameters.path,
      value: disallowedValue(parameters.values),
    }, `Replace ${parameters.path} with a value outside its allowed set.`);
  }
  if (invariant.kind === "string_pattern") {
    return descriptor(contract, invariant, "break-string-pattern", parameters.subject, {
      path: parameters.path,
      value: "\n__latentmachine_pattern_break__",
    }, `Replace ${parameters.path} with text intended not to match its required pattern.`);
  }
  if (invariant.kind === "row_count_preserved") {
    return descriptor(contract, invariant, "drop-output-row", "outputRecords", {}, "Drop one transformed output row.");
  }
  if (invariant.kind === "key_set_preserved") {
    return descriptor(contract, invariant, "change-output-key", "outputRecords", {
      path: parameters.outputKeyPath,
      value: "__latentmachine_changed_key__",
    }, `Change one output key at ${parameters.outputKeyPath}.`);
  }
  if (invariant.kind === "key_unique") {
    return descriptor(contract, invariant, "duplicate-key", `${parameters.subject}Records`, {
      path: parameters.keyPath,
    }, `Duplicate a ${parameters.subject} key at ${parameters.keyPath}.`);
  }
  if (invariant.kind === "no_duplicate_output_keys") {
    return descriptor(contract, invariant, "duplicate-output-key", "outputRecords", {
      path: parameters.keyPath,
    }, `Duplicate an output key at ${parameters.keyPath}.`);
  }
  if (invariant.kind === "maximum_failed_records" || invariant.kind === "maximum_failed_percent") {
    return descriptor(contract, invariant, "add-failed-record", "failedRecords", {
      count: invariant.kind === "maximum_failed_records" ? parameters.maximum + 1 : null,
      minimumPercent: invariant.kind === "maximum_failed_percent" ? parameters.maximum : null,
    }, "Add failed records beyond the accepted batch threshold.");
  }
  return null;
}

function firstOutputPath(contract) {
  const operationPath = contract.program?.ops?.find(operation => operation.target)?.target;
  if (operationPath) return operationPath;
  const firstProperty = Object.keys(contract.output?.schema?.properties || {}).sort(compareText)[0];
  return firstProperty ? `$.${firstProperty}` : "$.__latentmachine_value";
}

export function generateTransformationMutations(contract) {
  contract = unwrapTransformationContract(contract);
  const validation = validateTransformationContract(contract);
  if (!validation.ok) {
    throw new Error(`Cannot generate mutations for an invalid contract: ${validation.errors[0]?.message || "validation failed"}`);
  }
  const generated = (contract.invariants || [])
    .map(invariant => mutationForInvariant(contract, invariant))
    .filter(Boolean);
  generated.push(...operationTargetMutations(contract));
  generated.push(descriptor(
    contract,
    null,
    "add-unreferenced-input-field",
    "input",
    {
      path: "$.__latentmachine_unreferenced",
      value: true,
    },
    "Add an input field that the learned program and accepted invariants do not reference.",
  ));
  const byShape = new Map();
  for (const mutation of generated) {
    const key = stableStringify({
      kind: mutation.kind,
      subject: mutation.subject,
      parameters: mutation.parameters,
    });
    if (!byShape.has(key)) byShape.set(key, mutation);
  }
  return [...byShape.values()].sort((left, right) => (
    compareText(left.kind, right.kind)
    || compareText(left.id, right.id)
  ));
}

function deletePath(value, path) {
  const result = clone(value);
  const parts = parsePath(path);
  if (!parts.length) return undefined;
  const parent = parts.slice(0, -1).reduce((current, part) => current?.[part], result);
  if (parent && typeof parent === "object") {
    const key = parts.at(-1);
    if (Array.isArray(parent) && Number.isInteger(key)) parent.splice(key, 1);
    else delete parent[key];
  }
  return result;
}

function mutatePath(value, mutation) {
  if (mutation.kind.startsWith("remove-")) return deletePath(value, mutation.parameters.path);
  const current = getPath(value, mutation.parameters.path);
  if (mutation.kind === "change-target-case") {
    const text = String(current ?? "");
    const changed = text === text.toUpperCase() ? text.toLowerCase() : text.toUpperCase();
    return setPath(clone(value), mutation.parameters.path, changed || "LATENTMACHINE_CASE_DRIFT");
  }
  if (mutation.kind === "scale-target-unit") {
    const number = Number(current);
    const changed = Number.isFinite(number) && number !== 0 ? number * mutation.parameters.factor : mutation.parameters.factor;
    return setPath(clone(value), mutation.parameters.path, changed);
  }
  if (mutation.kind === "change-target-date-format") {
    const text = String(current ?? "");
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
    const changed = match ? `${match[2]}/${match[3]}/${match[1]}${match[4]}` : `format-drift:${text}`;
    return setPath(clone(value), mutation.parameters.path, changed);
  }
  if (mutation.kind === "swap-composition-order") {
    const text = String(current ?? "");
    const parts = text.split(/\s+/).filter(Boolean);
    const changed = parts.length > 1 ? parts.reverse().join(" ") : `composition-drift:${text}`;
    return setPath(clone(value), mutation.parameters.path, changed);
  }
  return setPath(clone(value), mutation.parameters.path, mutation.parameters.value);
}

function normalizedContext(context = {}) {
  const inputRecords = Array.isArray(context.inputRecords)
    ? cloneJson(context.inputRecords)
    : context.input !== undefined ? [cloneJson(context.input)] : null;
  const outputRecords = Array.isArray(context.outputRecords)
    ? cloneJson(context.outputRecords)
    : context.output !== undefined ? [cloneJson(context.output)] : null;
  return {
    input: context.input !== undefined ? cloneJson(context.input) : cloneJson(inputRecords?.[0]),
    output: context.output !== undefined ? cloneJson(context.output) : cloneJson(outputRecords?.[0]),
    inputRecords,
    outputRecords,
    failedRecords: Array.isArray(context.failedRecords) ? cloneJson(context.failedRecords) : [],
  };
}

function mutateRecordCollection(records, mutation) {
  if (!records?.length) return records;
  const mutated = cloneJson(records);
  if (mutation.kind.includes("duplicate") && mutated.length >= 2) {
    const first = getPath(mutated[0], mutation.parameters.path);
    mutated[1] = setPath(mutated[1], mutation.parameters.path, first);
    return mutated;
  }
  mutated[0] = mutatePath(mutated[0], mutation);
  return mutated;
}

function applyMutation(contract, base, mutation) {
  const context = normalizedContext(base);
  if (mutation.subject === "input") {
    context.input = mutatePath(context.input, mutation);
    context.inputRecords = mutateRecordCollection(context.inputRecords, mutation);
    context.output = executeJsonTransform(contract.program, context.input);
    context.outputRecords = context.inputRecords?.map(row => executeJsonTransform(contract.program, row)) || null;
  } else if (mutation.subject === "output") {
    context.output = mutatePath(context.output, mutation);
    context.outputRecords = mutateRecordCollection(context.outputRecords, mutation);
  } else if (mutation.subject === "inputRecords") {
    context.inputRecords = mutateRecordCollection(context.inputRecords, mutation);
    context.input = cloneJson(context.inputRecords?.[0]);
    context.outputRecords = context.inputRecords?.map(row => executeJsonTransform(contract.program, row)) || null;
    context.output = cloneJson(context.outputRecords?.[0]);
  } else if (mutation.subject === "outputRecords") {
    if (mutation.kind === "drop-output-row") {
      context.outputRecords = context.outputRecords?.slice(0, -1) || null;
    } else {
      context.outputRecords = mutateRecordCollection(context.outputRecords, mutation);
    }
    context.output = cloneJson(context.outputRecords?.[0]);
  } else if (mutation.subject === "failedRecords") {
    const count = mutation.parameters.count
      ?? Math.min(
        context.inputRecords?.length || 1,
        Math.floor((context.inputRecords?.length || 1) * mutation.parameters.minimumPercent) + 1,
      );
    context.failedRecords = Array.from({ length: count }, (_, index) => ({
      rowIndex: index,
      reason: "deterministic mutation probe",
    }));
  }
  return context;
}

export function runTransformationMutationSuite(contract, context = {}) {
  contract = unwrapTransformationContract(contract);
  const validation = validateTransformationContract(contract);
  if (!validation.ok) {
    return {
      version: "transformation-mutation-report/1",
      contractFingerprint: contract?.identity?.coreFingerprint || null,
      verdict: "invalid_contract",
      mutations: [],
      detected: [],
      undetected: [],
      validationErrors: cloneJson(validation.errors),
    };
  }

  const base = normalizedContext(context);
  if (!base.inputRecords?.length || !base.outputRecords?.length) {
    throw new Error("Mutation testing requires at least one input and corresponding output record.");
  }
  const mutations = generateTransformationMutations(contract).map(mutation => {
    const mutatedContext = applyMutation(contract, base, mutation);
    const evaluation = evaluateTransformationInvariants(contract, mutatedContext);
    const detectedBy = evaluation.results
      .filter(result => result.status === "fail" || result.status === "warn")
      .map(result => result.invariantId)
      .sort(compareText);
    return {
      ...mutation,
      detected: detectedBy.length > 0,
      detectedBy,
      verdict: evaluation.verdict,
      invariantResults: evaluation.results,
    };
  });
  const detected = mutations.filter(item => item.detected).map(item => item.id);
  const undetected = mutations.filter(item => !item.detected).map(item => item.id);
  const coverage = mutationCoverage(contract, mutations);
  const sourceInferenceStatus = contract.inference?.status || null;
  const inferenceStatus = sourceInferenceStatus === "safe"
    && (undetected.length > 0 || coverage.targetCoverage < 0.5)
    ? "unverified"
    : sourceInferenceStatus;

  return {
    version: "transformation-mutation-report/1",
    contractFingerprint: contract.identity.coreFingerprint,
    inferenceStatus,
    sourceInferenceStatus,
    mutations,
    detected,
    undetected,
    coverage,
  };
}
