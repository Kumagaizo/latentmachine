import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const pages = [
  {
    file: "index.html",
    mounts: ["landing-demo"],
    scripts: ["/src/local/chrome.js", "/src/local/landing-demo.js"],
    text: ["Check a batch", "Verify demo", "Understand your data in seconds.", "Open Trace →"],
    skipLink: true,
  },
  {
    file: "infer.html",
    mounts: ["app"],
    scripts: ["/src/local/chrome.js", "/src/local/app.js"],
    text: ["Loading Infer"],
    skipLink: true,
    noscript: true,
  },
  {
    file: "verify.html",
    mounts: ["verify"],
    scripts: ["/src/local/chrome.js", "/src/local/verify.js"],
    text: ["Loading Verify"],
    skipLink: true,
    noscript: true,
  },
  {
    file: "regex.html",
    mounts: ["regex"],
    scripts: ["/src/local/chrome.js", "/src/local/regex.js"],
    text: ["Loading Regex Builder"],
    skipLink: true,
    noscript: true,
  },
  {
    file: "jq.html",
    mounts: ["jq"],
    scripts: ["/src/local/chrome.js", "/src/local/jq.js"],
    text: ["Loading jq Builder"],
    skipLink: true,
    noscript: true,
  },
  {
    file: "trace.html",
    mounts: ["trace"],
    scripts: ["/src/local/chrome.js", "/src/local/trace.js"],
    text: ["Loading Trace"],
    skipLink: true,
    noscript: true,
  },
];

async function assertFile(relativePath) {
  const info = await stat(path.join(dist, relativePath));
  assert.equal(info.isFile(), true, `${relativePath} must exist in dist`);
}

function scriptPathFromSrc(src) {
  return src.replace(/^\//, "");
}

async function assertPage(page) {
  await assertFile(page.file);
  const html = await readFile(path.join(dist, page.file), "utf8");

  assert.doesNotMatch(html, /<!--@partial:/, `${page.file} must have injected partials`);

  for (const mount of page.mounts) {
    assert.match(html, new RegExp(`id=["']${mount}["']`), `${page.file} must expose #${mount}`);
  }

  for (const expected of page.text) {
    assert.ok(html.includes(expected), `${page.file} must include ${JSON.stringify(expected)}`);
  }

  if (page.skipLink) {
    assert.ok(html.includes('<a href="#main-content" class="skip-link">Skip to content</a>'), `${page.file} must include the shared skip link`);
    assert.match(html, /\bid=["']main-content["']/, `${page.file} must expose #main-content`);
  }

  if (page.noscript) {
    assert.match(html, /<noscript>[\s\S]*needs JavaScript[\s\S]*Nothing is sent to a server/i, `${page.file} must explain its no-JavaScript state`);
  }

  for (const script of page.scripts) {
    assert.match(
      html,
      new RegExp(`<script\\s+type=["']module["']\\s+src=["']${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']\\s*>`),
      `${page.file} must load ${script}`
    );
    await assertFile(scriptPathFromSrc(script));
  }
}

async function assertRuntimeModulesImport() {
  const [
    translator,
    exporters,
    regexBuilder,
    trace,
    traceAnalysis,
    traceCompare,
    traceReports,
  ] = await Promise.all([
    import(pathToFileURL(path.join(dist, "src/intelligence/json-transform/translator.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/json-transform/exporters.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/regex-builder/engine.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/engine.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/analyze.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/compare.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/reports.js")).href),
  ]);

  assert.equal(typeof translator.runTransform, "function", "translator runtime must export runTransform");
  assert.equal(typeof exporters.generateJqQuery, "function", "exporters runtime must export generateJqQuery");
  assert.equal(typeof regexBuilder.runRegexBuilder, "function", "regex runtime must export runRegexBuilder");
  assert.equal(typeof trace.fingerprint, "function", "trace runtime must export fingerprint");
  assert.equal(typeof traceAnalysis.analyzeTrace, "function", "trace runtime must export analysis");
  assert.equal(typeof traceCompare.compareTrace, "function", "trace runtime must export comparison");
  assert.equal(typeof traceReports.serializeTraceReport, "function", "trace runtime must export reports");
  await assertFile("src/local/trace-worker.js");
}

async function assertRuntimeBehavior() {
  const [
    translator,
    exporters,
    regexBuilder,
    trace,
    traceAnalysis,
    traceCompare,
    shareState,
  ] = await Promise.all([
    import(pathToFileURL(path.join(dist, "src/intelligence/json-transform/translator.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/json-transform/exporters.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/regex-builder/engine.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/engine.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/analyze.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/compare.js")).href),
    import(pathToFileURL(path.join(dist, "src/local/share-state.js")).href),
  ]);

  const transform = translator.runTransform({
    inputFormat: "json",
    outputFormat: "json",
    examples: [
      { input: "{\"first\":\"Ada\",\"last\":\"Lovelace\"}", output: "{\"fullName\":\"Ada Lovelace\"}" },
      { input: "{\"first\":\"Grace\",\"last\":\"Hopper\"}", output: "{\"fullName\":\"Grace Hopper\"}" },
    ],
    newInput: "{\"first\":\"Tim\",\"last\":\"Berners-Lee\"}",
  });
  assert.equal(transform.status, "safe", "built transformer should infer a safe merge rule");
  assert.deepEqual(transform.output, { fullName: "Tim Berners-Lee" });

  const jqResult = translator.runTransform({
    inputFormat: "json",
    outputFormat: "json",
    examples: [
      { input: "{\"users\":[{\"email\":\"ada@example.com\"},{\"email\":\"grace@example.com\"}]}", output: "[\"ada@example.com\",\"grace@example.com\"]" },
      { input: "{\"users\":[{\"email\":\"tim@example.com\"}]}", output: "[\"tim@example.com\"]" },
    ],
    newInput: "{\"users\":[{\"email\":\"linus@example.com\"}]}",
  });
  assert.equal(jqResult.status, "safe", "built jq fixture should infer safely");
  assert.equal(exporters.generateJqQuery(jqResult), "[.users[] | .email]");

  const regex = regexBuilder.runRegexBuilder({
    positives: ["555-1234", "555-9988"],
    negatives: ["phone", "555-12"],
  });
  assert.equal(regex.status, "safe", "built regex runtime should synthesize a safe phone pattern");
  assert.equal(regex.pattern, "^\\d{3}-\\d{4}$");
  assert.equal(regexBuilder.testRegexPattern(regex.pattern, "555-1234").matches[0]?.value, "555-1234");

  assert.equal(trace.fingerprint({ b: 2, a: 1 }).hex, trace.fingerprint({ a: 1, b: 2 }).hex, "built trace runtime should ignore object key order");
  const traceProfile = traceAnalysis.analyzeTrace(Array.from({ length: 20 }, (_, index) => ({ id: `R-${index}`, value: index })));
  assert.equal(traceProfile.shape.recordCount, 20, "built Trace analysis should profile record sets");
  const traceComparison = traceCompare.compareTrace(
    Array.from({ length: 20 }, (_, index) => ({ id: `R-${index}`, value: index })),
    Array.from({ length: 20 }, (_, index) => ({ id: `R-${index}`, value: index })).reverse(),
  );
  assert.deepEqual(traceComparison.rows.counts, { added: 0, removed: 0, changed: 0, unchanged: 20 }, "built Trace comparison should match reordered keyed rows");
  const selectedState = {
    version: 3,
    mode: "compare",
    textA: '[{"id":"R-1","value":1}]',
    textB: '[{"id":"R-1","value":2}]',
    formatA: "json",
    formatB: "json",
    recordSetPathA: "$",
    recordSetPathB: "$",
    settings: { keyPath: "$[*].id", absoluteTolerance: 0.01 },
    activeTab: "rows",
    activeField: null,
    activeRecordFilter: null,
  };
  const encodedState = await shareState.encodeShareState(selectedState);
  assert.deepEqual(await shareState.decodeShareState(encodedState), selectedState, "Trace share codec should restore full selected state");
  const shareUrl = await shareState.shareUrlForState(selectedState, { href: "https://latentmachine.com/trace" });
  assert.deepEqual(await shareState.sharedStateFromLocation({ hash: new URL(shareUrl).hash }), selectedState, "Trace share URL should restore full selected state");
}

async function assertTraceProductSurface() {
  const traceUi = await readFile(path.join(dist, "src/local/trace.js"), "utf8");
  const traceWorker = await readFile(path.join(dist, "src/local/trace-worker.js"), "utf8");
  const traceStyles = await readFile(path.join(dist, "src/local/styles.css"), "utf8");
  for (const contract of ["textA: \"\"", "Paste structured data here, or import a file.", "data-format-override", "data-record-set", "data-insight-records", "data-cancel", "invalidateAnalysisForEdit", "Input changed · run Trace again", "liveRegion.textContent = state.announcement", "field.temporal.earliest", "field.temporal.latest", "data-field-filter", "data-record-column", "data-copy-record", "data-inspect-record", "Bounded nested view", "Sample records", "data-structure-query", "data-structure-toggle", "data-copy-path", "data-compare-preset", "data-setting-key-part", "data-schema-filter", "data-row-filter", "role=\"tabpanel\"", "Privacy-safe report", "Filtered records CSV", "window.print()", "This link contains the data itself", "state.mode === \"compare\" ? state.comparison : state.analysis"]) {
    assert.ok(traceUi.includes(contract), `built Trace UI must include ${contract}`);
  }
  for (const printContract of ["@media print", ".trace-workbench", ".trace-result-bar", "break-inside:avoid"]) {
    assert.ok(traceStyles.includes(printContract), `built Trace print CSS must include ${printContract}`);
  }
  for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "<canvas", "toDataURL("]) {
    assert.ok(!traceUi.includes(forbidden) && !traceWorker.includes(forbidden), `built Trace analysis surfaces must not include ${forbidden}`);
  }
  for (const phase of ["parsing", "profiling structure", "finding observations", "comparing"]) {
    assert.ok(traceWorker.includes(phase), `built Trace worker must expose ${phase} progress`);
  }
}

for (const page of pages) await assertPage(page);
await assertRuntimeModulesImport();
await assertRuntimeBehavior();
await assertTraceProductSurface();

console.log(JSON.stringify({
  passed: pages.length + 3,
  checks: [
    ...pages.map(page => `${page.file} shell and module scripts`),
    "built runtime modules import without benchmark barrels",
    "built runtime modules perform transform, jq, regex, and Trace smoke cases",
    "built Trace UI ships format, record-set, evidence, export, accessibility, and worker-progress contracts",
  ],
}, null, 2));
