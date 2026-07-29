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
    text: [
      "Check a batch",
      "Verify demo",
      "Understand your data in seconds.",
      "Open Trace →",
      "Find the lines that break the pattern.",
      "Open Signal →",
    ],
    skipLink: true,
  },
  {
    file: "contract.html",
    mounts: ["contract"],
    scripts: ["/src/local/chrome.js", "/src/local/contract.js"],
    text: ["Loading Contract Studio"],
    skipLink: true,
    noscript: true,
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
  {
    file: "signal.html",
    mounts: ["signal"],
    scripts: ["/src/local/chrome.js", "/src/local/signal.js"],
    text: ["Loading Signal"],
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
    signal,
    signalExplain,
    contracts,
  ] = await Promise.all([
    import(pathToFileURL(path.join(dist, "src/intelligence/json-transform/translator.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/json-transform/exporters.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/regex-builder/engine.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/engine.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/analyze.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/compare.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/reports.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/signal/engine.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/signal/explain.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/contracts/index.js")).href),
  ]);

  assert.equal(typeof translator.runTransform, "function", "translator runtime must export runTransform");
  assert.equal(typeof exporters.generateJqQuery, "function", "exporters runtime must export generateJqQuery");
  assert.equal(typeof regexBuilder.runRegexBuilder, "function", "regex runtime must export runRegexBuilder");
  assert.equal(typeof trace.fingerprint, "function", "trace runtime must export fingerprint");
  assert.equal(typeof traceAnalysis.analyzeTrace, "function", "trace runtime must export analysis");
  assert.equal(typeof traceCompare.compareTrace, "function", "trace runtime must export comparison");
  assert.equal(typeof traceReports.serializeTraceReport, "function", "trace runtime must export reports");
  assert.equal(typeof signal.analyzeSignal, "function", "Signal runtime must export line analysis");
  assert.equal(typeof signalExplain.createEvidencePack, "function", "Signal runtime must export evidence packs");
  assert.equal(typeof contracts.learnContract, "function", "Contract runtime must export learning");
  assert.equal(typeof contracts.runContract, "function", "Contract runtime must export execution");
  assert.equal(typeof contracts.checkContract, "function", "Contract runtime must export checking");
  await assertFile("src/local/trace-worker.js");
  await assertFile("src/local/signal-worker.js");
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
    signal,
    signalExplain,
    contracts,
  ] = await Promise.all([
    import(pathToFileURL(path.join(dist, "src/intelligence/json-transform/translator.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/json-transform/exporters.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/regex-builder/engine.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/engine.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/analyze.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/trace/compare.js")).href),
    import(pathToFileURL(path.join(dist, "src/local/share-state.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/signal/engine.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/signal/explain.js")).href),
    import(pathToFileURL(path.join(dist, "src/intelligence/contracts/index.js")).href),
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

  const signalResult = signal.analyzeSignal({
    name: "built-signal.log",
    mode: "stream",
    text: [
      "2026-07-29T10:00:01Z INFO job 1001 completed in 21ms",
      "2026-07-29T10:00:02Z INFO job 1002 completed in 22ms",
      "2026-07-29T10:00:03Z INFO job 1003 completed in 23ms",
      "2026-07-29T10:00:04Z FATAL job 1004 rollback after 801ms",
      "2026-07-29T10:00:05Z INFO job 1005 completed in 25ms",
    ].join("\n"),
  });
  assert.equal(signalResult.status, "ready", "built Signal runtime must analyze line-oriented text");
  assert.equal(signalResult.findings[0]?.kind, "failure", "built Signal runtime must rank the planted fatal template");
  assert.equal(signalResult.events.some(event => event.type === "analysis.completed"), true, "built Signal runtime must emit stable trace events");
  const signalPack = signalExplain.createEvidencePack(signalResult, { includeAttention: true, reviewed: true });
  assert.match(signalPack.text, /L4 \[attention;/, "built Signal evidence pack must preserve source line references");

  const learnedContract = contracts.learnContract({
    examples: [
      { input: { id: "C-1", state: "new" }, output: { customerId: "C-1", status: "N" } },
      { input: { id: "C-2", state: "done" }, output: { customerId: "C-2", status: "D" } },
    ],
    newInput: { id: "C-3", state: "new" },
  });
  const guardedContract = contracts.acceptTransformationInvariants(
    learnedContract,
    learnedContract.extensions.latentmachine.invariantSuggestions.map(item => item.id),
  );
  const approvedContract = contracts.approveContract(guardedContract, {
    coreFingerprint: guardedContract.identity.coreFingerprint,
    note: "Built runtime smoke.",
  });
  const contractRun = contracts.runContract({
    contract: approvedContract,
    input: [{ id: "C-3", state: "new" }],
  });
  assert.equal(contractRun.verdict, "pass", "built Contract runtime should execute an approved contract");
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

async function assertSignalProductSurface() {
  const landing = await readFile(path.join(dist, "index.html"), "utf8");
  const signalUi = await readFile(path.join(dist, "src/local/signal.js"), "utf8");
  const signalWorker = await readFile(path.join(dist, "src/local/signal-worker.js"), "utf8");
  const signalStyles = await readFile(path.join(dist, "src/local/styles.css"), "utf8");
  for (const contract of [
    '"name": "Signal"',
    '"url": "https://latentmachine.com/signal"',
    '<section class="feature-row feature-row--reverse">',
    '<div class="demo-window signal-preview">',
    '<a class="button is-primary" href="/signal">Open Signal →</a>',
    '<a class="site-link" href="/signal">Signal</a>',
    '<a href="/signal">Signal</a>',
  ]) {
    assert.ok(landing.includes(contract), `built landing page must include ${contract}`);
  }
  for (const contract of ["Find the lines that break the pattern.", "data-signal-input", "data-force-signal", "data-pin-segment", "data-open-signal-pack", "data-pack-reviewed", "Nothing is hidden until you choose a filter.", "Compression novelty", "Open in Trace"]) {
    assert.ok(signalUi.includes(contract), `built Signal UI must include ${contract}`);
  }
  for (const contract of [".signal-preview", ".signal-preview-lines", ".signal-line", ".signal-minimap", ".signal-evidence-drawer", ".signal-pack-preview", "@media print"]) {
    assert.ok(signalStyles.includes(contract), `built Signal CSS must include ${contract}`);
  }
  for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "<canvas", "toDataURL("]) {
    assert.ok(!signalUi.includes(forbidden) && !signalWorker.includes(forbidden), `built Signal analysis surfaces must not include ${forbidden}`);
  }
  for (const phase of ["segmenting lines", "linking evidence"]) {
    assert.ok(signalWorker.includes(phase), `built Signal worker must expose ${phase} progress`);
  }
}

async function assertContractProductSurface() {
  const contractUi = await readFile(path.join(dist, "src/local/contract.js"), "utf8");
  const contractStyles = await readFile(path.join(dist, "src/local/styles.css"), "utf8");
  for (const contract of [
    "Transformation contracts learned from examples.",
    "Turn examples into a transformation contract.",
    "Observed, not yet approved.",
    "data-answer-challenge",
    "data-defer-challenge",
    "data-apply-guardrails",
    "Approve exact fingerprint",
    "data-export-contract",
    "data-import-contract",
    "data-run-contract",
    "data-export-quarantine",
    "This link contains the examples and runtime drafts themselves",
    "role=\"tablist\"",
    "aria-live=\"polite\"",
  ]) {
    assert.ok(contractUi.includes(contract), `built Contract Studio must include ${contract}`);
  }
  for (const contract of [
    ".contract-progress",
    ".contract-layout",
    ".contract-guardrail",
    ".contract-runtime-result",
    "@media (max-width:760px)",
    "@media (prefers-reduced-motion:reduce)",
  ]) {
    assert.ok(contractStyles.includes(contract), `built Contract Studio CSS must include ${contract}`);
  }
  for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket"]) {
    assert.ok(!contractUi.includes(forbidden), `built Contract Studio must not include ${forbidden}`);
  }
}

for (const page of pages) await assertPage(page);
await assertRuntimeModulesImport();
await assertRuntimeBehavior();
await assertTraceProductSurface();
await assertSignalProductSurface();
await assertContractProductSurface();

console.log(JSON.stringify({
  passed: pages.length + 5,
  checks: [
    ...pages.map(page => `${page.file} shell and module scripts`),
    "built runtime modules import without benchmark barrels",
    "built runtime modules perform transform, jq, regex, Trace, and Signal smoke cases",
    "built Trace UI ships format, record-set, evidence, export, accessibility, and worker-progress contracts",
    "built Signal landing and UI ship navigation, visualization, local analysis, routing, source-ledger, evidence, export-review, and worker-progress contracts",
    "built Contract Studio ships the five-stage local workflow, runtime review, export, share warning, accessibility, and responsive contracts",
  ],
}, null, 2));
