# @latentmachine/verify

Deterministic verification for AI data transformations.

Latentmachine checks whether a batch of transformed rows all followed the same inferred rule. It can also infer a transformation rule from examples and apply that rule to new records.

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

## CLI

```sh
latentmachine-verify original.json transformed.json
npx @latentmachine/verify original.json transformed.json
latentmachine-verify fingerprint data.json
latentmachine-verify fingerprint before.json after.json
```

Exit code `0` means consistent. Exit code `1` means inconsistent. Exit code `2` means the input could not be parsed or verified.
For `fingerprint`, exit code `1` means the two compared files have different fingerprints.
