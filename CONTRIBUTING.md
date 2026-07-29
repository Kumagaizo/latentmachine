# Contributing to Latentmachine

Thanks for taking the time to improve Latentmachine. Useful contributions include reproducible bug reports, difficult but synthetic transformation examples, accessibility feedback, focused code changes, and clearer documentation.

## Before you start

- Use GitHub Issues for bugs and feature discussions.
- Use a private security advisory for vulnerabilities; see [SECURITY.md](SECURITY.md).
- Never commit customer data, credentials, private prompts, or internal project notes.
- Keep fixtures synthetic and small unless a benchmark specifically exercises scale.

## Local setup

Latentmachine requires Node.js 24 for the root workspace. The separately packaged API and MCP adapters support Node.js 20 or newer.

```sh
npm install
npm run dev
```

The browser product is intentionally built with plain HTML, CSS, and JavaScript. The core engines are framework-independent ES modules.

## Project boundaries

- `src/intelligence/` owns deterministic inference, execution, formats, evidence, and reliability.
- `src/local/` owns browser state, rendering, interaction, and the shared design system.
- `packages/` contains distribution adapters around the same engine.
- `fixtures/` and benchmark modules make product claims executable.
- `dist/` is generated and must not be committed.

Prefer a small, explainable operation over a broad heuristic. New inference behavior should expose evidence, remain deterministic, and include a regression case that would fail without the change.

## Checks

Run the focused test for the area you changed, then run the full gate before opening a pull request:

```sh
npm run test:package:verify
npm --workspace packages/mcp run smoke
npm run check
```

For UI work, verify keyboard behavior, narrow layouts, light and dark themes, and reduced-motion preferences. Reuse the design tokens and component vocabulary in `src/local/styles.css`.

## Pull requests

Keep pull requests narrow enough to review. Explain the user-facing problem, the chosen behavior, and the checks you ran. Screenshots are helpful for visual changes; before-and-after fixtures are helpful for engine changes.

By submitting a contribution, you agree that it will be licensed under the repository's MIT License.
