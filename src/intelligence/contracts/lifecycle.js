import {
  TRANSFORMATION_APPROVAL_METHODS,
  validateTransformationContract,
} from "./schema.js";
import { unwrapTransformationContract } from "./contract-input.js";

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertValidContract(contract, action) {
  const validation = validateTransformationContract(contract);
  if (!validation.ok) {
    const details = validation.errors.slice(0, 3)
      .map(error => `${error.path} [${error.code}] ${error.message}`)
      .join("; ");
    throw new Error(`Cannot ${action} an invalid Transformation Contract: ${details}`);
  }
}

function appendLifecycleTrace(contract, event) {
  const prior = Array.isArray(contract.extensions?.latentmachine?.lifecycleTrace)
    ? contract.extensions.latentmachine.lifecycleTrace
    : [];
  return {
    ...cloneJson(contract),
    extensions: {
      ...(cloneJson(contract.extensions) || {}),
      latentmachine: {
        ...(cloneJson(contract.extensions?.latentmachine) || {}),
        lifecycleTrace: [...prior.map(cloneJson), event],
      },
    },
  };
}

function approvalArguments(contractOrInput, acknowledgement) {
  if (contractOrInput?.contract?.kind) {
    return {
      contract: unwrapTransformationContract(contractOrInput),
      acknowledgement: acknowledgement ?? contractOrInput.acknowledgement,
    };
  }
  if (
    acknowledgement === undefined
    && contractOrInput
    && typeof contractOrInput === "object"
    && contractOrInput.contract
  ) {
    return {
      contract: contractOrInput.contract,
      acknowledgement: contractOrInput.acknowledgement,
    };
  }
  return { contract: contractOrInput, acknowledgement };
}

export function approveContract(contractOrInput, acknowledgementInput) {
  const { contract, acknowledgement } = approvalArguments(contractOrInput, acknowledgementInput);
  assertValidContract(contract, "approve");
  if (!acknowledgement || typeof acknowledgement !== "object" || Array.isArray(acknowledgement)) {
    throw new Error("Approval requires an acknowledgement object containing the exact coreFingerprint.");
  }
  const unknownFields = Object.keys(acknowledgement)
    .filter(field => !["coreFingerprint", "method", "acknowledgedChallenges", "note"].includes(field));
  if (unknownFields.length) {
    throw new Error(`Approval acknowledgement contains unknown field ${unknownFields[0]}.`);
  }
  if (contract.lifecycle.approvalState === "approved") {
    throw new Error("Transformation Contract is already approved.");
  }
  if (["superseded", "revoked"].includes(contract.lifecycle.approvalState)) {
    throw new Error(`A ${contract.lifecycle.approvalState} Transformation Contract cannot be approved.`);
  }
  if (acknowledgement.coreFingerprint !== contract.identity.coreFingerprint) {
    throw new Error(`Approval fingerprint acknowledgement must exactly equal ${contract.identity.coreFingerprint}.`);
  }

  const method = acknowledgement.method || "local-human-review";
  if (!TRANSFORMATION_APPROVAL_METHODS.includes(method)) {
    throw new Error(`Approval method must be one of ${TRANSFORMATION_APPROVAL_METHODS.join(", ")}.`);
  }
  const acknowledgedChallenges = acknowledgement.acknowledgedChallenges || [];
  if (!Array.isArray(acknowledgedChallenges) || acknowledgedChallenges.some(id => typeof id !== "string")) {
    throw new Error("acknowledgedChallenges must be an array of challenge IDs.");
  }
  const uniqueAcknowledgements = [...new Set(acknowledgedChallenges)].sort(compareText);
  if (uniqueAcknowledgements.length !== acknowledgedChallenges.length) {
    throw new Error("acknowledgedChallenges must not contain duplicate IDs.");
  }
  const challengesById = new Map((contract.challenges || []).map(challenge => [challenge.id, challenge]));
  for (const challengeId of uniqueAcknowledgements) {
    if (!challengesById.has(challengeId)) {
      throw new Error(`Acknowledged challenge ${challengeId} does not exist.`);
    }
  }

  const unresolvedBlocking = (contract.challenges || [])
    .filter(challenge => challenge.severity === "blocking" && ["open", "deferred"].includes(challenge.status));
  if (unresolvedBlocking.length) {
    throw new Error(`Cannot approve while blocking challenge ${unresolvedBlocking[0].id} is unresolved.`);
  }
  const unacknowledgedAdvisory = (contract.challenges || [])
    .filter(challenge => challenge.severity === "advisory" && ["open", "deferred"].includes(challenge.status))
    .filter(challenge => !uniqueAcknowledgements.includes(challenge.id));
  if (unacknowledgedAdvisory.length) {
    throw new Error(`Approval must acknowledge advisory challenge ${unacknowledgedAdvisory[0].id}.`);
  }
  if (acknowledgement.note !== undefined && (
    typeof acknowledgement.note !== "string"
    || acknowledgement.note.length > 2000
  )) {
    throw new Error("Approval note must be a string of at most 2000 characters.");
  }

  const approval = {
    method,
    state: "approved",
    approvedCoreFingerprint: contract.identity.coreFingerprint,
    acknowledgedChallenges: uniqueAcknowledgements,
    ...(acknowledgement.note !== undefined ? { note: acknowledgement.note } : {}),
  };
  const approved = appendLifecycleTrace({
    ...cloneJson(contract),
    lifecycle: {
      ...cloneJson(contract.lifecycle),
      approvalState: "approved",
    },
    approval,
  }, {
    type: "contract.approved",
    revision: contract.lifecycle.revision,
    coreFingerprint: contract.identity.coreFingerprint,
    method,
    acknowledgedChallenges: uniqueAcknowledgements,
  });
  assertValidContract(approved, "return from approval");
  return approved;
}

function supersedeArguments(contractOrInput, replacementInput) {
  if (
    replacementInput === undefined
    && contractOrInput
    && typeof contractOrInput === "object"
    && contractOrInput.contract
  ) {
    return {
      contract: contractOrInput.contract,
      replacement: contractOrInput.replacement,
    };
  }
  return { contract: contractOrInput, replacement: replacementInput };
}

export function supersedeContract(contractOrInput, replacementInput) {
  const { contract, replacement } = supersedeArguments(contractOrInput, replacementInput);
  assertValidContract(contract, "supersede");
  assertValidContract(replacement, "use as a replacement for");
  if (contract.lifecycle.approvalState !== "approved") {
    throw new Error("Only an approved Transformation Contract can be superseded.");
  }
  if (replacement.lifecycle.approvalState !== "approved") {
    throw new Error("A replacement Transformation Contract must be approved before it supersedes another contract.");
  }
  if (replacement.identity.coreFingerprint === contract.identity.coreFingerprint) {
    throw new Error("A replacement must have a different behavioral core.");
  }
  if (replacement.lifecycle.supersedes !== contract.identity.contractId) {
    throw new Error(`Replacement lineage must point lifecycle.supersedes to ${contract.identity.contractId}.`);
  }
  if (replacement.lifecycle.revision <= contract.lifecycle.revision) {
    throw new Error("Replacement revision must be greater than the contract it supersedes.");
  }

  const superseded = appendLifecycleTrace({
    ...cloneJson(contract),
    lifecycle: {
      ...cloneJson(contract.lifecycle),
      approvalState: "superseded",
    },
  }, {
    type: "contract.superseded",
    revision: contract.lifecycle.revision,
    replacementContractId: replacement.identity.contractId,
    replacementCoreFingerprint: replacement.identity.coreFingerprint,
    replacementRevision: replacement.lifecycle.revision,
  });
  superseded.extensions.latentmachine.supersededBy = {
    contractId: replacement.identity.contractId,
    coreFingerprint: replacement.identity.coreFingerprint,
    revision: replacement.lifecycle.revision,
  };
  assertValidContract(superseded, "return from supersession");
  return superseded;
}

function revokeArguments(contractOrInput, optionsInput) {
  if (
    optionsInput === undefined
    && contractOrInput
    && typeof contractOrInput === "object"
    && contractOrInput.contract
  ) {
    return {
      contract: contractOrInput.contract,
      options: {
        reason: contractOrInput.reason,
      },
    };
  }
  return { contract: contractOrInput, options: optionsInput || {} };
}

export function revokeContract(contractOrInput, optionsInput) {
  const { contract, options } = revokeArguments(contractOrInput, optionsInput);
  assertValidContract(contract, "revoke");
  if (["superseded", "revoked"].includes(contract.lifecycle.approvalState)) {
    throw new Error(`A ${contract.lifecycle.approvalState} Transformation Contract is already terminal.`);
  }
  if (typeof options.reason !== "string" || !options.reason.trim() || options.reason.length > 2000) {
    throw new Error("Revocation requires a non-empty reason of at most 2000 characters.");
  }

  const revoked = appendLifecycleTrace({
    ...cloneJson(contract),
    lifecycle: {
      ...cloneJson(contract.lifecycle),
      approvalState: "revoked",
    },
  }, {
    type: "contract.revoked",
    revision: contract.lifecycle.revision,
    coreFingerprint: contract.identity.coreFingerprint,
    reason: options.reason,
  });
  assertValidContract(revoked, "return from revocation");
  return revoked;
}

export const approveTransformationContract = approveContract;
export const supersedeTransformationContract = supersedeContract;
export const revokeTransformationContract = revokeContract;
