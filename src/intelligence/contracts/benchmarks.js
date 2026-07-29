export const TRANSFORMATION_CONTRACT_BENCHMARKS = Object.freeze([
  Object.freeze({
    id: "contract-v1-safe",
    fixture: "safe-v1.json",
    expected: Object.freeze({ valid: true }),
  }),
  Object.freeze({
    id: "contract-v1-unsupported-major",
    fixture: "unsupported-v2.json",
    expected: Object.freeze({
      valid: false,
      errorCode: "unsupported-major-version",
    }),
  }),
  Object.freeze({
    id: "contract-v1-metadata-stability",
    fixture: "metadata-only-edit-v1.json",
    compareFixture: "safe-v1.json",
    expected: Object.freeze({
      valid: true,
      sameCoreFingerprint: true,
      sameProgramFingerprint: true,
    }),
  }),
  Object.freeze({
    id: "contract-v1-behavior-change",
    fixture: "behavior-change-v1.json",
    compareFixture: "safe-v1.json",
    expected: Object.freeze({
      valid: true,
      sameCoreFingerprint: false,
      sameProgramFingerprint: false,
    }),
  }),
]);
