# Vendored YAML Parser

- Package: `yaml`
- Version: `2.9.0`
- Author: Eemeli Aro
- Repository: `https://github.com/eemeli/yaml`
- License: ISC
- Tarball: `https://registry.npmjs.org/yaml/-/yaml-2.9.0.tgz`
- Integrity: `sha512-2AvhNX3mb8zd6Zy7INTtSpl1F15HW6Wnqj0srWlkKLcpYl/gMIMJiyuGq2KeI2YFxUPjdlB+3Lc10seMLtL4cA==`
- Shasum: `78274afd93598a1dfdd6130df6a566defcbf9aa4`
- Date vendored: 2026-05-24

## Files Copied

- `browser/index.js` to `src/vendor/yaml/index.js`
- `browser/dist/**` to `src/vendor/yaml/dist/**`
- `LICENSE` to `src/vendor/yaml/LICENSE`

## Audit Notes

- Downloaded with `npm pack yaml@2.9.0 --ignore-scripts`.
- No package lifecycle scripts were run.
- `package.json` reports no runtime `dependencies`.
- The project does not import `yaml` from `node_modules`.
- Scanned vendored source for obvious dangerous APIs and found no matches for `eval`, dynamic `Function`, `fetch`, XHR/WebSocket, dynamic import, `require`, Node `fs`, `child_process`, `process`, browser storage, `window`, or `document`.
- This vendored copy should be updated manually only, with benchmarks and acceptance tests.
