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
