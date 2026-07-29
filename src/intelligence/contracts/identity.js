const CONTRACT_FINGERPRINT_ALGORITHM = "fnv1a-64-pair";
const CONTRACT_FINGERPRINT_BITS = 64;

function fnv1a(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hex8(value) {
  return value.toString(16).padStart(8, "0");
}

function canonicalize(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(item => canonicalize(item)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "null";
}

function fingerprintValue(value, purpose) {
  const canonical = `${purpose}\u0000${canonicalize(value)}`;
  return {
    hex: `${hex8(fnv1a(canonical, 0x811c9dc5))}${hex8(fnv1a(canonical, 0x01000193))}`,
    bits: CONTRACT_FINGERPRINT_BITS,
    algorithm: CONTRACT_FINGERPRINT_ALGORITHM,
    purpose,
  };
}

/**
 * Return the behavior-bearing portion of a Transformation Contract.
 *
 * Deliberately excluded:
 * - identity, because including it would create a circular fingerprint
 * - lifecycle and approval, because approval binds to this core
 * - title, description, and metadata, because they do not change behavior
 * - inference and challenges, because they explain or review the behavior
 * - evidenceLinks, because they are derived navigation metadata
 * - extensions, because Contract v1 reserves them for non-core integration data
 */
export function transformationContractCore(contract = {}) {
  return {
    kind: contract.kind,
    contractVersion: contract.contractVersion,
    engine: contract.engine,
    formats: contract.formats,
    evidence: contract.evidence,
    input: contract.input,
    output: contract.output,
    program: contract.program,
    invariants: contract.invariants,
    runtimePolicy: contract.runtimePolicy,
  };
}

export function transformationProgramCore(contract = {}) {
  return {
    engine: {
      name: contract.engine?.name,
      transformVersion: contract.engine?.transformVersion,
      artifactVersion: contract.engine?.artifactVersion,
    },
    program: contract.program,
  };
}

export function transformationEvidenceCore(contract = {}) {
  return {
    formats: contract.formats,
    evidence: contract.evidence,
  };
}

export function fingerprintTransformationContract(contract) {
  return fingerprintValue(transformationContractCore(contract), "latentmachine.transformation-contract.core/1");
}

export function fingerprintTransformationProgram(contract) {
  return fingerprintValue(transformationProgramCore(contract), "latentmachine.transformation-contract.program/1");
}

export function fingerprintTransformationEvidence(contract) {
  return fingerprintValue(transformationEvidenceCore(contract), "latentmachine.transformation-contract.evidence/1");
}

export function fingerprintTransformationChallenge(contract, seed) {
  return fingerprintValue({
    programFingerprint: contract?.identity?.programFingerprint || fingerprintTransformationProgram(contract).hex,
    seed,
  }, "latentmachine.transformation-contract.challenge/1");
}

export function fingerprintTransformationInvariant(contract, seed) {
  return fingerprintValue({
    programFingerprint: contract?.identity?.programFingerprint || fingerprintTransformationProgram(contract).hex,
    seed,
  }, "latentmachine.transformation-contract.invariant/1");
}

export function fingerprintTransformationMutation(contract, seed) {
  return fingerprintValue({
    coreFingerprint: contract?.identity?.coreFingerprint || fingerprintTransformationContract(contract).hex,
    seed,
  }, "latentmachine.transformation-contract.mutation/1");
}

export function fingerprintTransformationRuntimeDiagnostic(contract, seed) {
  return fingerprintValue({
    coreFingerprint: contract?.identity?.coreFingerprint || fingerprintTransformationContract(contract).hex,
    seed,
  }, "latentmachine.transformation-contract.runtime-diagnostic/1");
}

export function deriveTransformationContractIdentity(contract) {
  const coreFingerprint = fingerprintTransformationContract(contract).hex;
  return {
    contractId: `lmct_${coreFingerprint.slice(0, 12)}`,
    coreFingerprint,
    programFingerprint: fingerprintTransformationProgram(contract).hex,
    evidenceFingerprint: fingerprintTransformationEvidence(contract).hex,
  };
}

export function withTransformationContractIdentity(contract) {
  return {
    ...contract,
    identity: deriveTransformationContractIdentity(contract),
  };
}

export const TRANSFORMATION_CONTRACT_FINGERPRINT = Object.freeze({
  algorithm: CONTRACT_FINGERPRINT_ALGORITHM,
  bits: CONTRACT_FINGERPRINT_BITS,
  cryptographic: false,
});
