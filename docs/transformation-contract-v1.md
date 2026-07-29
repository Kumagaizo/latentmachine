# Transformation Contract v1

Status: implemented foundation with inference, challenge, invariant, mutation-testing, approval lifecycle, comparison, deterministic runtime adapters, Contract Studio, and a packed-package/CLI release candidate; not yet published to npm or promoted in primary navigation.

## Purpose

A Transformation Contract is a versioned, reviewable description of a learned data transformation. It separates five concerns that must not be collapsed into one confidence score:

1. Evidence: the examples the behavior was learned from.
2. Inference: what LatentMachine concluded and where uncertainty remains.
3. Program: the deterministic operations that would transform data.
4. Policy: the input, output, invariant, and runtime boundaries around that program.
5. Approval: a human or system decision bound to one exact behavioral core.

Contract v1 is exposed through the isolated Contract Studio preview and the `@latentmachine/verify` package release candidate. Its runtime adapters reuse the existing deterministic program, add no remote processing, and do not alter existing inference behavior.

## Learning a contract

The internal `learnContract(input, options)` adapter runs the existing structured-data translator and converts its result into a valid Transformation Contract. It does not introduce a second inference path.

The mapping is intentionally mechanical:

| Existing inference artifact | Contract section |
| --- | --- |
| Parsed and deduplicated examples | `evidence.examples` |
| Example tests and exact-fit result | `evidence.coverage` |
| Contradiction diagnosis | `evidence.contradictions` |
| Rule program and transform version | `program` and `engine.transformVersion` |
| Rule preconditions | `input.preconditions` |
| Confidence, status, reliability, warnings, and full diagnosis | `inference` |
| Operation-level evidence | `evidenceLinks` |
| Detected input and selected output formats | `formats` |
| Existing display explanation | `extensions.latentmachine` |

Input and output schema expectations are derived only from observed examples:

- Properties present in every observed object are required.
- Optional observed properties remain optional.
- Mixed observed types use deterministic `anyOf` branches.
- Integer and non-integer numeric observations merge to `number`.
- Input objects allow unknown fields; output objects block them.
- No business constraint is invented from field names.

Learning always creates revision 1 with no approval:

- `safe` inference becomes `lifecycle.approvalState: "unreviewed"`.
- `ambiguous`, `contradictory`, `unsafe`, and `insufficient` become `review_required`.
- `approval` remains `null` in every case.

The adapter normalizes missing or duplicate example IDs without altering the source task. Calling it twice with the same input returns the same complete contract and fingerprints. Multiple source formats in one evidence set are represented as normalized `value` input; per-example source formats remain recorded in the evidence.

The source adapter lives under `src/intelligence/contracts/`. Package preparation copies that module graph into the self-contained Verify package snapshot and rewrites its public `contracts` entrypoint so no monorepo-relative import is published.

## Challenges and answers

`learnContract()` now derives review challenges from the existing diagnosis instead of reducing uncertainty to a generic warning.

Challenge generation is deterministic:

1. Existing suggested examples and guardrail detail determine the challenge kind.
2. Candidate disambiguation first tries the supplied new input.
3. If that input does not distinguish the top candidates, LatentMachine changes one bounded field in an existing example.
4. Both candidate operations are executed against the proposed input.
5. The challenge records both outputs and marks whether the probe truly distinguishes them.
6. Challenge IDs bind the program fingerprint to the challenge seed.
7. Blocking challenges, higher candidate coverage, runtime prevention, and lower response effort determine ordering.

Generated questions cover candidate ambiguity, missing sources, unseen values, ambiguous dates, empty values, and invalid arrays. An ambiguous date remains a blocking question even when a separate candidate-disambiguation question exists.

`answerChallenge(contract, challengeId, answer)` supports two deliberately different flows. `answerTransformationChallenge` is the explicit internal alias.

### Evidence answer

```js
{
  expectedOutput: {
    state: "B"
  }
}
```

The challenge's proposed input and the supplied expected output become a correction example. LatentMachine then:

- appends the example with a deterministic evidence ID;
- re-runs the existing inference engine from scratch;
- builds a new contract revision;
- points `lifecycle.supersedes` to the previous contract ID;
- regenerates unresolved challenges;
- retains the answered challenge as history;
- clears any prior approval.

The selected program is never edited directly as a shortcut.

### Policy answer

```js
{
  policy: "block"
}
```

A policy answer does not become example evidence. It is stored under `runtimePolicy.policyAnswers`, which is part of the behavioral core. This changes the core fingerprint while preserving the evidence and program fingerprints. Supported policy values are bounded; arbitrary executable policy is rejected.

Every generated or answered challenge adds a deterministic trace event under `extensions.latentmachine.challengeTrace`. Trace events have revisions but no timestamps, keeping local builds reproducible.

## Invariants and mutation testing

`learnContract()` derives invariant suggestions from program preconditions, observed output schema, selected operations, and explicit output policy. Suggestions live under `extensions.latentmachine.invariantSuggestions`; they are review material, not behavioral core, and cannot silently constrain a transformation.

`acceptTransformationInvariants(contract, selections)` is the behavioral boundary:

- selections may be deterministic suggestion IDs or complete invariant definitions;
- accepted definitions are reduced to `id`, `kind`, `scope`, `severity`, and bounded JSON parameters;
- acceptance creates a new revision and points `lifecycle.supersedes` at the prior contract;
- the core fingerprint changes while the program and evidence fingerprints remain stable;
- prior approval is cleared;
- the full contract is validated before the revision is returned.

The validator enforces parameters by kind. Paths are deterministic `$`-rooted data paths. Subjects are only `input` or `output`. Types use the bounded JSON type vocabulary. Allowed-value sets must be non-empty. Failure limits must be bounded numbers. String patterns are length-limited and reject groups, alternation, lookarounds, backreferences, nested quantifiers, and oversized values. Unknown parameters, arbitrary code, and contradictory requirements such as requiring and forbidding the same output path are errors.

`evaluateTransformationInvariants(contract, context)` returns one explicit result per accepted invariant:

```js
{
  invariantId: "inv_...",
  status: "pass" | "warn" | "fail" | "not_evaluated",
  blocking: true,
  affectedRows: [],
  evidence: {},
  message: "..."
}
```

Advisory violations map to `warn`. Blocking record violations use `runtimePolicy.onRecordViolation`; blocking batch violations use `runtimePolicy.onBatchViolation`. Invalid contracts return `invalid_contract`. Missing runtime data produces `not_evaluated` rather than a fabricated pass.

The first evaluator covers required paths, path types, output presence and absence, unresolved placeholders, unknown output fields, source preservation, allowed values, bounded string patterns, row counts, key sets, key uniqueness, duplicate output keys, and failed-record thresholds.

`runTransformationMutationSuite(contract, context)` generates deterministic input and output mutations from accepted invariants, evaluates each mutated run, and returns:

- every mutation and its exact detecting invariant IDs;
- the policy verdict for that mutation;
- separate `detected` and `undetected` ID lists;
- the complete invariant results used for the decision.

The report intentionally has no aggregate score or coverage percentage. An undetected mutation is retained as a visible gap. The M3 fixture demonstrates this by detecting required-path removal, disallowed values, unknown output fields, unresolved placeholders, and dropped rows while disclosing that an unreferenced input field is not protected.

## Approval lifecycle and contract comparison

`approveContract(contract, acknowledgement)` is the only internal helper that enters the approved lifecycle state. The acknowledgement must echo the exact `identity.coreFingerprint`:

```js
approveContract(contract, {
  coreFingerprint: contract.identity.coreFingerprint,
  method: "local-human-review",
  acknowledgedChallenges: [],
  note: "Reviewed against the supplied evidence."
})
```

Approval fails closed when:

- the contract or deterministic identity is invalid;
- the fingerprint is missing or differs by even one character;
- the contract is already approved, superseded, or revoked;
- a blocking challenge is open or deferred;
- an open or deferred advisory challenge is not named in `acknowledgedChallenges`;
- the approval method, challenge IDs, or note do not match the bounded approval shape.

Supported methods are `local-human-review`, `automated-policy`, and `imported-review`. The method distinguishes human approval from machine policy; it does not upgrade one into the other.

Approval changes lifecycle state but not the behavioral core, contract ID, or revision number. The approval record binds to the existing core fingerprint. Any later core edit causes `approval-fingerprint-mismatch` and must produce an unreviewed revision before it can be approved again.

`supersedeContract(contract, replacement)` requires both contracts to be approved. The replacement must have a different core, a higher revision, and `lifecycle.supersedes` must point to the predecessor contract ID. The predecessor retains its historical approval and records the approved successor under `extensions.latentmachine.supersededBy`.

`revokeContract(contract, { reason })` requires an explicit bounded reason. Revocation is terminal and retains any historical approval for auditability. Approval, supersession, and revocation add deterministic lifecycle events without timestamps under `extensions.latentmachine.lifecycleTrace`.

`compareContracts(baseline, candidate)` returns `transformation-contract-comparison/1`. Invalid inputs produce an `invalid_contract` comparison instead of a partial diff. Valid comparisons contain deterministic path-level changes with before/after presence, exact values, an explanation, runtime-breaking status, and reapproval status.

Comparison categories are:

- `contract_compatibility`;
- `evidence`;
- `program_behavior`;
- `preconditions_schema`;
- `invariants`;
- `runtime_policy`;
- `metadata`;
- `review_state`;
- `review_context`.

Primary classifications are `identical`, `metadata_only`, `evidence_only`, `non_behavioral_change`, or `behavioral_change`. Program, compatibility, schema/precondition, invariant, and runtime-policy changes are conservatively breaking. Evidence-only changes do not claim an executable behavior change, but they still change the core and require reapproval. Metadata-only changes are non-breaking and preserve the core fingerprint.

## Deterministic runtime

`runContract({ contract, input, options })` executes the contract-owned program. `checkContract({ contract, input, output, options })` computes the approved expected output and compares it with output produced elsewhere. Both adapters:

1. validate the complete contract and its deterministic identity;
2. reject `superseded` and `revoked` contracts;
3. require an active approval when `runtimePolicy.requireApproval` is true;
4. parse the declared formats;
5. evaluate schemas, preconditions, program warnings, exact output differences, and accepted invariants;
6. apply record and batch policy separately;
7. return a deterministic JSON report without timestamps or environment paths.

Approval is checked before parsing or executing user data. Expected lifecycle and policy failures return structured reports; caller programming errors and cancellation may throw.

### Run and check reports

Runtime reports use `latentmachine.contract-run` or `latentmachine.contract-check` and `reportVersion: "1.0"`. Every input row appears exactly once in `records` and one status partition:

- `passed`;
- `warned`;
- `quarantined`;
- `blocked`.

The four partition counts always sum to `totals.input`. Blocking record diagnostics use `runtimePolicy.onRecordViolation`. Blocking batch diagnostics use `runtimePolicy.onBatchViolation`; a batch `block` moves every input row to the blocked partition so no partial batch is mistaken for safe output. Advisory diagnostics respect the record warning threshold and cannot silently upgrade a blocking failure.

Each diagnostic contains a deterministic ID, code, severity, scope, row reference where applicable, path, invariant reference where applicable, explanation, and evidence. Failed rows retain `sourceIndex`. When an input key is declared explicitly or derived from a key invariant, `rowId` is stable and key-based; duplicate keys receive deterministic occurrence suffixes.

### Keyed checking

Check mode pairs records by the output key declared in `key_set_preserved`, `key_unique`, or `no_duplicate_output_keys`, unless a caller supplies explicit key paths. A pure reorder therefore passes. Missing, extra, and duplicate keys produce batch evidence; field additions, omissions, and value changes produce exact record paths. Without a key declaration, pairing remains positional.

### Runtime options

- `batch`: explicitly selects batch or single-record interpretation.
- `inputKeyPath`, `outputKeyPath`, or `keyPath`: provides bounded row matching paths when the contract has no accepted key invariant.
- `privacySafe`: omits raw input, expected, and actual record values; row keys are removed and invariant evidence is redacted.
- `signal`: supports cancellation with an `AbortError`.
- `onProgress` and `progressEvery`: emit out-of-band progress events. Callbacks do not enter the deterministic report.

Input and output strings are parsed with the contract's declared formats. The internal `value` format treats supplied values as already parsed.

## Versioning and compatibility

Every contract has:

```json
{
  "kind": "latentmachine.transformation-contract",
  "contractVersion": "1.0"
}
```

- The major version defines the compatibility boundary.
- Readers must reject unknown major versions. Contract v1 fails closed on `2.x`.
- A newer minor version may be read with a structured warning when all required v1 fields remain valid.
- `extensions` is reserved for integration-specific, non-behavioral data. Unknown extension keys are preserved by round trips and ignored by the v1 validator.
- Unknown top-level fields are rejected so that a reader cannot silently ignore behavior. Integration metadata belongs under `extensions`.

The validator returns a structured result:

```js
{
  ok: false,
  errors: [
    {
      path: "$.contractVersion",
      code: "unsupported-major-version",
      message: "Contract major version 2 is not supported."
    }
  ],
  warnings: [],
  version: { major: 2, minor: 0 }
}
```

Validation is side-effect free and does not mutate the supplied object.

## Top-level shape

| Section | Meaning | Behavioral identity |
| --- | --- | --- |
| `kind`, `contractVersion` | Contract type and compatibility boundary | Included |
| `engine` | LatentMachine artifact and transform versions | Included |
| `identity` | Derived IDs and fingerprints | Derived |
| `lifecycle` | Revision and current approval state | Excluded |
| `title`, `description`, `metadata` | Human-facing context | Excluded |
| `formats` | Input and output data formats | Included |
| `evidence` | Source examples, coverage, and contradictions | Included |
| `inference` | Safety status, confidence, ambiguity, reasons | Excluded |
| `input`, `output` | Schemas and field-handling policy | Included |
| `program` | Deterministic transform version and operations | Included |
| `invariants` | Claims that must remain true | Included |
| `challenges` | Open or answered review questions | Excluded |
| `runtimePolicy` | Violation and approval requirements | Included |
| `evidenceLinks` | Navigation from operations to examples | Excluded |
| `approval` | Approval record bound to the core | Excluded and verified |
| `extensions` | Non-core integration data | Excluded |

Inference, challenges, and evidence links explain or help review behavior. They cannot silently change executable meaning. Evidence itself is included because changing the evidence set changes what the contract can honestly claim to cover.

## States

Inference status is one of:

- `safe`
- `ambiguous`
- `contradictory`
- `unsafe`
- `insufficient`

Lifecycle approval state is one of:

- `unreviewed`
- `review_required`
- `approved`
- `superseded`
- `revoked`

Challenge status is one of:

- `open`
- `answered`
- `deferred`
- `not_applicable`

Contract invariants are explicit objects with `id`, `kind`, `scope`, `severity`, and `parameters`. V1 implements a bounded vocabulary for record checks such as required paths, types, allowed values, and output shape, plus batch checks such as row preservation, key uniqueness, and failure thresholds. Arbitrary JavaScript, SQL, and external lookups are not valid invariant kinds.

Challenges use the review shape `id`, `kind`, `severity`, `status`, `prompt`, `reason`, `affectedOperations`, `affectedPaths`, `answerMode`, `choices`, and `answer`. IDs are unique and deterministic; blocking challenges must be resolved before approval.

Invariant evaluation uses this runtime verdict vocabulary:

- `pass`
- `warn`
- `quarantine`
- `block`
- `invalid_contract`

These verdicts describe invariant, mutation, run, and check results across the contract engine, Contract Studio, and package release candidate.

## Package and CLI boundary

`@latentmachine/verify` exports the complete Contract v1 API from both its main entrypoint and `@latentmachine/verify/contracts`. The generated publish snapshot includes the contract engine and its audited local dependencies; it contains no private notes, tests, fixtures, or monorepo-relative imports.

The primary CLI binary is `latentmachine`. `latentmachine-verify` remains a compatibility alias during v0.x. The contract hierarchy is:

```text
latentmachine contract learn
latentmachine contract inspect
latentmachine contract challenge
latentmachine contract test
latentmachine contract approve
latentmachine contract run
latentmachine contract check
latentmachine contract diff
```

Commands emit JSON on stdout by default and send diagnostics to stderr. `--format human` opts into terminal-oriented summaries. Exit codes are `0` for success/pass, `1` for a runtime or check violation, `2` for invalid input/contract/version/usage, and `3` when approval or blocking review is required.

Approval remains deliberate in the CLI. `contract approve` requires the exact core fingerprint and explicit advisory acknowledgements. `local-human-review` is the default method; automated callers must identify themselves with `--method automated-policy`.

The package acceptance gate prepares the publish snapshot, creates a tarball, installs it into a clean temporary Node.js project, audits its contents, imports the installed package, and completes learn → approve → run → check. Publication to npm remains a separate human-controlled release action.

## MCP boundary

Both the local stdio server and hosted HTTP endpoint expose:

```text
learn_transformation_contract
get_contract_challenges
test_transformation_contract
run_transformation_contract
check_transformation_contract
compare_transformation_contracts
```

MCP can learn a contract, return its review state and full artifact, surface challenges, mutation-test it, and use an approved contract. It deliberately exposes no approval tool. A learned contract reports `humanApprovalCreated: false`, and run/check return `reviewRequired: true` when policy requires an approval that is absent.

Results are concise by default. Runtime results cap record summaries and omit the complete report unless requested; mutation tests return counts and exact mutation IDs without the full report by default. The remote endpoint defaults contract run/check to privacy-safe report shaping.

Local stdio inputs stay on the machine running the package. Hosted HTTP inputs travel to Latentmachine's Vercel function for stateless processing. Privacy-safe response shaping redacts raw record values from returned reports but does not change that transport boundary.

## Deterministic identity

Contract v1 derives three identities from canonical JSON with recursively sorted object keys:

- `coreFingerprint`: all behavior-bearing contract sections.
- `programFingerprint`: engine and deterministic program only.
- `evidenceFingerprint`: formats and evidence only.

`contractId` is `lmct_` plus the first 12 hexadecimal characters of the core fingerprint.

Array order remains significant. Object key order does not. Human metadata edits preserve all three fingerprints. Changes to program operations change the program and core fingerprints. Changes to evidence change the evidence and core fingerprints.

The current fingerprint is a domain-separated, deterministic 64-bit pair of FNV-1a hashes. It is intentionally marked `cryptographic: false`. It is suitable for change detection, stable fixtures, approval binding inside the product, and cache keys. It is not a security signature, tamper-proof attestation, or substitute for a cryptographic digest when contracts cross an untrusted boundary.

## Approval semantics

Approval means:

- a reviewer or authorized system accepted one exact `coreFingerprint`;
- the contract had no open blocking challenge at the time it entered the `approved` lifecycle state;
- a behavioral change must derive a new core fingerprint and therefore cannot inherit the old approval.

Approval does not mean:

- every future input will be valid;
- the examples cover every production edge case;
- the transformation is generally correct outside its stated schemas and invariants;
- the fingerprint proves authorship or prevents malicious modification.

The approval record stores `approvedCoreFingerprint`, `method`, `state: "approved"`, and the exact acknowledged challenge IDs. A `superseded` or `revoked` contract may retain this historical record for auditability, but its lifecycle state makes clear that the approval is no longer active. `unreviewed` and `review_required` contracts cannot carry an approval record.

## Fixtures and checks

The committed fixtures under `fixtures/contracts/` cover:

- a valid, hand-authored safe contract;
- an unsupported future major version;
- a metadata-only edit with stable behavioral identity;
- a coherent behavior change with different evidence, program, and core identities.
- learned safe, ambiguous, contradictory, unsafe, and insufficient states;
- JSON, CSV, YAML, TOML, XML, and ENV learning in both directions where supported;
- SQL INSERT learning as an input-only format.
- source-candidate disambiguation followed by complete re-learning;
- unseen-value answers as either evidence or explicit policy;
- blocking ambiguous-date review;
- approval invalidation and revision lineage after an answer;
- deterministic invariant suggestions and explicit acceptance revisions;
- invalid and contradictory invariant rejection;
- record and batch runtime-policy verdicts;
- detected and honestly undetected mutation cases;
- exact fingerprint acknowledgement and advisory-risk acknowledgement;
- deterministic approval, supersession, and revocation;
- metadata-only, evidence-only, and all behavior-bearing comparison categories;
- invalid comparison inputs that fail closed.
- deterministic run and check reports for passing, missing, unseen, extra, dropped, duplicate, reordered, and mixed batches;
- approval and terminal-lifecycle runtime rejection;
- privacy-safe reports, progress, cancellation, and declared-format parsing;
- 10,000-record run and keyed-check performance gates.

Run focused checks with:

```text
npm run bench:contracts
npm run accept:contracts
npm run accept:contract-studio
```

Both are also included in the existing full benchmark orchestration. Contract work remains isolated from current browser entrypoints.
