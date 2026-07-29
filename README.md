# Latentmachine

**Deterministic tools for understanding, transforming, and verifying data.**

[Try the browser tools](https://latentmachine.com/) · [Read the case study](https://latentmachine.com/case-study) · [Developer guide](https://latentmachine.com/developers)

Latentmachine turns data evidence into inspectable, deterministic artifacts: transformation rules from examples, consistency checks across batches, structural profiles for datasets, and source-linked attention observations for long text. The engine runs locally: no model call, account, or server-side data processing is required for the core workflow.

The repository is both a working product and a design case study. It contains the static browser experience, the inference and verification engine, an npm-ready API and CLI, an MCP server, and the benchmark suites that gate every build.

## What you can do

- **Verify** a batch of transformed records and find the rows that broke the inferred rule.
- **Infer** reusable transformations from JSON, CSV, YAML, TOML, XML, `.env`, or SQL INSERT examples.
- **Build regex and jq expressions** from examples, with a verified preview before export.
- **Trace structured data** with deterministic fingerprints, profiles, and path-level diffs.
- **Signal pattern breaks and concrete evidence** in logs, reports, and technical specifications.
- **Integrate the engine** through JavaScript, a CLI, MCP over stdio, or the HTTP MCP endpoint.

## Design principles

Latentmachine is intentionally opinionated:

1. Show the rule, not only the result.
2. Diagnose ambiguity and contradiction instead of silently guessing.
3. Keep the same input and rule deterministic across runs.
4. Keep user data in the browser for the core workflow.
5. Gate product claims with executable benchmarks and acceptance tests.

The full behavioral contract lives in [docs/latentmachine-product-contract.md](docs/latentmachine-product-contract.md).

## Repository map

```text
api/                     Vercel HTTP/MCP entrypoint
articles/                Long-form product and engineering notes
docs/                    Public architecture and product contracts
fixtures/                Synthetic regression and acceptance data
packages/verify/         JavaScript API and CLI package
packages/mcp/            Stdio MCP server package
scripts/                 Build, benchmark, acceptance, and release tooling
src/intelligence/        Deterministic engines and format adapters
src/local/               Browser UI, state, rendering, and shared styles
src/vendor/              Audited vendored source with its upstream license
```

For a module-by-module tour, see [docs/intelligence-baselayer.md](docs/intelligence-baselayer.md).

## Run locally

Requirement: Node.js 24.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4173`. The site uses plain HTML, CSS, and JavaScript; no framework build step is required during development.

## Use the JavaScript API

The packages are implemented in this monorepo but are not yet published to npm. From a workspace checkout:

```js
import {
  approveContract,
  infer,
  learnContract,
  runContract,
  transform,
  verify,
} from "./packages/verify/src/index.js";

const examples = [
  { input: { first: "Ada", last: "Lovelace" }, output: { name: "Ada Lovelace" } },
  { input: { first: "Grace", last: "Hopper" }, output: { name: "Grace Hopper" } },
];

const inferred = infer({ examples });

if (inferred.status === "safe") {
  const output = transform({
    rule: inferred.rule,
    input: { first: "Katherine", last: "Johnson" },
  });
  console.log(output);
}

const result = verify({
  original: examples.map((example) => example.input),
  transformed: examples.map((example) => example.output),
});

console.log(result.verdict);

const contract = learnContract({ examples });
const approved = approveContract(contract, {
  coreFingerprint: contract.identity.coreFingerprint,
  acknowledgedChallenges: contract.challenges
    .filter((challenge) => challenge.severity === "advisory")
    .map((challenge) => challenge.id),
});
console.log(runContract({
  contract: approved,
  input: [{ first: "Katherine", last: "Johnson" }],
}).verdict);
```

After the first npm release, the package will be installable as `@latentmachine/verify`; `@latentmachine/mcp` will expose the same engine to MCP clients.

## Quality gates

Run the same full check used before deployment:

```sh
npm run check
```

This runs the benchmark suite, builds the deployable site into `dist/`, smoke-tests the built pages, and checks both the source graph and final artifact for accidental private or development files.

Focused checks are available while iterating:

```sh
npm run test:package:verify
npm run test:package:verify:pack
npm --workspace packages/mcp run smoke
npm run bench:json
npm run bench:translator
npm run bench:signal
npm run accept:signal
npm run accept:mcp
```

## Privacy and security

The core browser tools process input locally. Synthetic fixtures are committed for repeatable tests; generated output, credentials, local notes, and internal audit material are excluded from version control. Please report security issues through a private GitHub security advisory as described in [SECURITY.md](SECURITY.md).

## Contributing

Bug reports, difficult transformation examples, design feedback, and focused pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), which documents the project boundaries and expected checks.

## Built by

Latentmachine is designed and built by [Sandro Vogel](https://www.sandrovogel.de/), a Berlin-based AI product designer and creative developer. If the project helps your work, a link to [latentmachine.com](https://latentmachine.com/) or a citation using [CITATION.cff](CITATION.cff) is appreciated.

## License

The code and original project documentation are available under the [MIT License](LICENSE). The required copyright notice includes the author link and must remain with copies or substantial portions of the software. Bundled third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
