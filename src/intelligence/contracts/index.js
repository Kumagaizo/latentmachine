export {
  deriveTransformationContractIdentity,
  fingerprintTransformationContract,
  fingerprintTransformationChallenge,
  fingerprintTransformationEvidence,
  fingerprintTransformationInvariant,
  fingerprintTransformationMutation,
  fingerprintTransformationProgram,
  fingerprintTransformationRuntimeDiagnostic,
  transformationContractCore,
  transformationEvidenceCore,
  transformationProgramCore,
  TRANSFORMATION_CONTRACT_FINGERPRINT,
  withTransformationContractIdentity,
} from "./identity.js";

export { unwrapTransformationContract } from "./contract-input.js";

export {
  acceptTransformationInvariants,
  evaluateTransformationInvariants,
  suggestTransformationInvariants,
  withTransformationInvariantSuggestions,
  withTransformationInvariants,
} from "./invariants.js";

export {
  generateTransformationMutations,
  runTransformationMutationSuite,
} from "./mutations.js";

export {
  approveContract,
  approveTransformationContract,
  revokeContract,
  revokeTransformationContract,
  supersedeContract,
  supersedeTransformationContract,
} from "./lifecycle.js";

export {
  compareContracts,
  compareTransformationContracts,
} from "./comparison.js";

export {
  checkContract,
  runContract,
} from "./execution.js";

export {
  generateTransformationChallenges,
  orderTransformationChallenges,
  withTransformationChallengeTrace,
} from "./challenges.js";

export {
  answerChallenge,
  answerTransformationChallenge,
  deferChallenge,
  deferTransformationChallenge,
} from "./answers.js";

export {
  buildTransformationContract,
  learnContract,
  TRANSFORMATION_CONTRACT_ARTIFACT_VERSION,
} from "./builder.js";

export {
  inferInputSchema,
  inferOutputSchema,
  inferSchema,
} from "./schema-inference.js";

export {
  TRANSFORMATION_APPROVAL_METHODS,
  TRANSFORMATION_APPROVAL_STATES,
  TRANSFORMATION_CHALLENGE_ANSWER_MODES,
  TRANSFORMATION_CHALLENGE_KINDS,
  TRANSFORMATION_CHALLENGE_STATUSES,
  TRANSFORMATION_CONTRACT_KIND,
  TRANSFORMATION_CONTRACT_SUPPORTED_MAJOR,
  TRANSFORMATION_CONTRACT_SUPPORTED_MINOR,
  TRANSFORMATION_CONTRACT_V1_SCHEMA,
  TRANSFORMATION_CONTRACT_VERSION,
  TRANSFORMATION_FORMATS,
  TRANSFORMATION_INFERENCE_STATUSES,
  TRANSFORMATION_INVARIANT_KINDS,
  TRANSFORMATION_INVARIANT_SCOPES,
  TRANSFORMATION_RUNTIME_VERDICTS,
  validateTransformationContract,
} from "./schema.js";
