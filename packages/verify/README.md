# @latentmachine/verify

Deterministic verification for AI data transformations.

Latentmachine checks whether a batch of transformed rows all followed the same inferred rule. It can also learn, review, approve, run, and check versioned Transformation Contracts.

## Install

```sh
npm install @latentmachine/verify
```

## Verify a transformation

```js
import { verify } from "@latentmachine/verify";

const result = verify({
  original: [
    { first: "Ana", last: "Meyer", joined: "2026-03-02" },
    { first: "Bo", last: "Singh", joined: "2026-03-04" },
  ],
  transformed: [
    { name: "Ana Meyer", joinedDate: "2026-03-02" },
    { name: "Bo Singh", joinedDate: "March 4, 2026" },
  ],
});

console.log(result.verdict);
console.log(result.flaggedRows);
```

`result.verdict` is `consistent`, `inconsistent`, or `unverifiable`. The third state means at least one field was fitted by a high-cardinality lookup or did not have enough in-domain examples to establish a reusable rule. Affected fields, lookup ratios, and support counts are available in `result.memorisation` and `result.summary`. Unverifiable rules never receive `confidence.label: "proven"`.

`result.memorisation` distinguishes `ruleVerifiedTargets`, unchanged `passthroughTargets`, high-cardinality `memorisedTargets`, `insufficientSupportTargets`, and `incompleteLookupTargets`. `unverifiableTargets` combines all targets for which no reusable rule was established. `ruleDemotions` identifies a reusable rule that fitted at least 95% of a field domain, including its privacy-safe fit ratio and exact contradicting row indices. Lookup diagnostics include total support and counts of repeated source values with consistent or conflicting outputs; they never expose raw values.

Optional output fields are evaluated only on rows where their source domain is present. When that domain is too small to prove a rule, the field is reported as unverifiable and is excluded from row flags; rows outside the field's domain are never treated as contradictions.

For batches above 200 rows, Latentmachine generates candidate rules from a deterministic, output-diverse evidence sample and then validates the selected program against every row. `result.inference` discloses the evidence limit and full validation count. Rare low-cardinality output variants are retained in the evidence sample. A sampled lookup that does not cover the complete source domain is reported as unverifiable rather than producing false row flags.

Learned `numericFormula` steps expose both `rounding` (`half-up`, `half-even`, `half-away`, `floor`, `ceil`, `trunc`, or `none`) and `evaluationOrder`. When the bounded evidence sample cannot distinguish equivalent arithmetic associations, the full batch resolves them in linear time before rows are classified. Global `stringReplace` rules are learned only for identifier-like fields with repeated literal delimiters; arbitrary regular expressions are not synthesised, and phone, date, and email guardrails keep precedence.

`arraySum` rules may contain either one `extract` path or two item-relative `factors` plus a `divisor`. Weighted rules are considered only for amount-like targets, require multi-item evidence, and must satisfy the same dominant-support threshold before they can classify an exception.

Executable rules retain lookup tables in memory. Before logging or serialising a diagnostic result, use the exported compaction helpers:

```js
import { compactRuleArtifact, compactVerificationResult } from "@latentmachine/verify";

const safeResult = compactVerificationResult(result);
const safeRuleSummary = compactRuleArtifact(result.rule);
```

Both helpers remove lookup bodies and mark compact rule artifacts `executable: false`; pass only a full rule from `infer()` to `transform()`.

## Infer and apply a rule

```js
import { infer, transform } from "@latentmachine/verify";

const inferred = infer({
  examples: [
    { input: { first: "Ana", last: "Meyer" }, output: { name: "Ana Meyer" } },
    { input: { first: "Bo", last: "Singh" }, output: { name: "Bo Singh" } },
  ],
});

if (inferred.status === "safe") {
  const output = transform({
    rule: inferred.rule,
    input: { first: "Clara", last: "Diaz" },
  });
  console.log(output);
}
```

## Structured formats

`verify()` accepts parsed arrays or strings. String input can be auto-detected across JSON, CSV, YAML, TOML, XML, `.env`, and SQL INSERT data.

```js
import { detectFormat, parseWithFormat } from "@latentmachine/verify";

const format = detectFormat("id,name\n1,Ada");
const rows = parseWithFormat("id,name\n1,Ada", format);
```

## Transformation Contracts

A Transformation Contract binds evidence, a deterministic program, runtime policy, and an explicit approval to one behavioral fingerprint.

```js
import {
  approveContract,
  checkContract,
  learnContract,
  runContract,
} from "@latentmachine/verify";

const learned = learnContract({
  examples: [
    {
      input: { id: "evt_1", status: "created" },
      output: { eventId: "evt_1", state: "NEW" },
    },
    {
      input: { id: "evt_2", status: "paid" },
      output: { eventId: "evt_2", state: "READY" },
    },
  ],
});

const approved = approveContract(learned, {
  coreFingerprint: learned.identity.coreFingerprint,
  acknowledgedChallenges: learned.challenges
    .filter((challenge) => challenge.severity === "advisory")
    .map((challenge) => challenge.id),
});

const input = [{ id: "evt_3", status: "paid" }];
const run = runContract({ contract: approved, input });
const check = checkContract({
  contract: approved,
  input,
  output: run.records.map((record) => record.output),
});
```

Contract APIs are also available from the `@latentmachine/verify/contracts` export. Runtime use fails closed when a contract is invalid, inactive, or still requires approval.

## Fingerprint

```js
import { canonicalize, fingerprint, profileStructure, structuralDiff } from "@latentmachine/verify";

const data = { b: 2, a: 1 };

console.log(canonicalize(data));
console.log(fingerprint(data).hex);
console.log(profileStructure(data).counts);
console.log(structuralDiff({ a: 1 }, { a: 2 }).counts);
```

Determinism contract: same parsed value, same fingerprint; object key order is ignored; array order is significant. The fingerprint is non-cryptographic and intended for identity and change detection, not tamper-proofing.

## Resource limits

The public APIs accept at most 5,000 rows per aligned input and at most 2,500,000 serialized characters per parsed value. String inputs are additionally capped at 500,000 characters. These are independent safety limits: whichever limit is reached first applies.

## CLI

```sh
latentmachine contract learn examples.json --out contract.json
latentmachine contract inspect contract.json
latentmachine contract challenge contract.json --inputs candidates.json
latentmachine contract test contract.json
latentmachine contract approve contract.json \
  --fingerprint <exact-core-fingerprint> \
  --acknowledge-all-advisory \
  --out approved.contract.json
latentmachine contract run approved.contract.json \
  --input input.json \
  --out output.json \
  --report run-report.json
latentmachine contract check approved.contract.json \
  --input input.json \
  --output output.json
latentmachine contract diff contract-v1.json contract-v2.json
```

JSON is written to stdout by default. Use `--format human` for concise terminal output. Diagnostics go to stderr.

The verification command exits with code `1` for both `inconsistent` and `unverifiable`. Use `--allow-unverifiable` only when a CI workflow intentionally accepts the latter. JSON verification output caps flagged-row details and omits lookup table bodies.

Contract command exit codes:

- `0`: pass or successful command.
- `1`: runtime, mutation-test, or contract-check violation.
- `2`: invalid input, invalid contract, unsupported version, or usage error.
- `3`: approval required or blocking review state.

The primary binary is `latentmachine`. `latentmachine-verify` remains an alias during v0.x. Existing commands remain available:

```sh
latentmachine original.json transformed.json
latentmachine fingerprint data.json
latentmachine fingerprint before.json after.json
npx @latentmachine/verify original.json transformed.json
```
