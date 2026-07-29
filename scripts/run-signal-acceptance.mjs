import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { analyzeSignal } from "../src/intelligence/signal/engine.js";
import { createEvidencePack, privacySafeSignalReport } from "../src/intelligence/signal/explain.js";
import { SIGNAL_LIMITS } from "../src/intelligence/signal/normalize.js";

const fixtures = JSON.parse(await readFile(new URL("../fixtures/signal/cases.json", import.meta.url), "utf8"));
const REQUIRED_EVENTS = [
  "input.validated",
  "input.mode-inferred",
  "segments.created",
  "templates.normalized",
  "clusters.created",
  "features.detected",
  "compression-novelty.computed",
  "candidates.generated",
  "findings.scored",
  "analysis.completed",
];

function assertFixture(fixture, result) {
  if (fixture.expect === "trace-route") {
    assert.equal(result.status, "invalid");
    assert.equal(result.routing.detected, true);
    assert.equal(result.warnings.some(warning => warning.type === "structured-data"), true);
    return;
  }
  assert.equal(result.status, "ready", fixture.id);
  assert.equal(result.segments.filter(segment => !segment.blank).every(segment => segment.score?.components), true, `${fixture.id}: score components`);
  assert.equal(result.segments.filter(segment => segment.level === "attention").every(segment => segment.evidence.length > 0), true, `${fixture.id}: attention evidence`);
  for (const eventType of REQUIRED_EVENTS) assert.equal(result.events.some(event => event.type === eventType), true, `${fixture.id}: ${eventType}`);

  if (fixture.expect === "fatal-top") assert.equal(result.findings[0]?.kind, "failure");
  if (fixture.expect === "one-template") assert.equal(result.templates.length, 1);
  if (fixture.expect === "two-failures") assert.equal(result.segments.filter(segment => segment.roles.includes("failure")).length, 2);
  if (fixture.expect === "exception-link") assert.equal(result.segments.some(segment => segment.roles.includes("exception") && segment.relatedSegmentIds.length), true);
  if (fixture.expect === "prohibitions-attention") assert.equal(result.segments.filter(segment => segment.text.includes("must not")).every(segment => segment.level === "attention"), true);
  if (fixture.expect === "identifiers-not-attention") assert.equal(result.summary.attentionCount, 0);
  if (fixture.expect === "no-failure-role") assert.equal(result.segments.some(segment => segment.roles.includes("failure")), false);
  if (fixture.expect === "failures-stay-visible") assert.equal(result.segments.every(segment => segment.blank || segment.level === "attention"), true);
  if (fixture.expect === "no-invented-attention") assert.equal(result.summary.attentionCount, 0);
  if (fixture.expect === "unicode-warning") assert.equal(result.segments.some(segment => segment.roles.includes("warning")), true);
  if (fixture.expect === "distant-exception-link") assert.equal(result.segments.some(segment => segment.roles.includes("exception") && segment.relatedSegmentIds.length), true);
}

for (const fixture of fixtures) {
  const input = { text: fixture.text, name: `${fixture.id}.txt`, mode: "auto" };
  const first = analyzeSignal(input);
  const second = analyzeSignal(input);
  assert.deepEqual(first, second, `${fixture.id}: deterministic output`);
  assertFixture(fixture, first);
  if (first.status === "ready") {
    const pack = createEvidencePack(first, { includeAttention: true, includeNotable: true, includeRepresentatives: true, contextLines: 1, reviewed: true });
    const lineNumbers = pack.artifact.lines.map(line => line.lineNumber);
    assert.deepEqual(lineNumbers, [...lineNumbers].sort((a, b) => a - b), `${fixture.id}: evidence source order`);
    assert.match(pack.text, /L\d+/);
    const privacy = JSON.stringify(privacySafeSignalReport(first));
    for (const line of fixture.text.split("\n").filter(line => line.length > 18).slice(0, 3)) {
      assert.equal(privacy.includes(line), false, `${fixture.id}: privacy report leaked fixture content`);
    }
  }
}

const performanceText = Array.from({ length: SIGNAL_LIMITS.maxLines }, (_, index) => {
  if (index === 17_321) return `2026-07-29T12:00:00Z FATAL job ${80000 + index} rollback after 850ms`;
  return `2026-07-29T12:00:00Z INFO job ${80000 + index} completed after ${20 + index % 80}ms`;
}).join("\n");
const startedAt = performance.now();
const performanceResult = analyzeSignal({ text: performanceText, name: "performance.log", mode: "stream" });
const durationMs = performance.now() - startedAt;
assert.equal(performanceResult.status, "ready");
assert.equal(performanceResult.findings[0]?.kind, "failure");
assert.ok(
  durationMs <= SIGNAL_LIMITS.maxAnalysisMs,
  `${SIGNAL_LIMITS.maxLines.toLocaleString("en-US")}-line analysis took ${Math.round(durationMs)}ms; budget is ${SIGNAL_LIMITS.maxAnalysisMs}ms`,
);

const stabilityRoutine = Array.from({ length: 16 }, (_, index) => `2026-07-29T13:00:${String(index).padStart(2, "0")}Z INFO job ${91000 + index} completed after ${20 + index}ms`);
const stabilityFatal = "2026-07-29T13:00:16Z FATAL job 91016 rollback after 840ms";
const stabilityInputs = [
  [...stabilityRoutine.slice(0, 8), stabilityFatal, ...stabilityRoutine.slice(8)].join("\n"),
  ["2026-07-29T12:59:59Z INFO job 90999 completed after 19ms", ...stabilityRoutine.slice(0, 8), stabilityFatal, ...stabilityRoutine.slice(8)].join("\n"),
  [...stabilityRoutine.slice().reverse(), stabilityFatal].join("\n"),
];
const stabilityResults = stabilityInputs.map(text => analyzeSignal({ text, name: "stability.log", mode: "stream" }));
for (const result of stabilityResults) {
  assert.equal(result.status, "ready");
  assert.equal(result.findings[0]?.kind, "failure", "planted fatal template must survive routine insertion or reorder");
  assert.equal(result.findings[0]?.level, "attention");
}
const noveltyScores = stabilityResults.map(result => result.segments.find(segment => segment.roles.includes("failure"))?.compressionNovelty.value || 0);
assert.ok(Math.max(...noveltyScores) - Math.min(...noveltyScores) <= 0.22, `compression novelty drifted too far: ${noveltyScores.join(", ")}`);

const structuredFixture = fixtures.find(fixture => fixture.expect === "trace-route");
const structuredOverride = analyzeSignal({
  text: structuredFixture.text,
  name: "structured.csv",
  mode: "stream",
  settings: { forceLineAnalysis: true },
});
assert.equal(structuredOverride.status, "ready");
assert.equal(structuredOverride.warnings.some(warning => warning.type === "structured-data-override"), true);

const compressionSkipped = analyzeSignal({
  text: stabilityInputs[0],
  name: "no-compression.log",
  mode: "stream",
  settings: { includeCompressionNovelty: false },
});
assert.equal(compressionSkipped.events.some(event => event.type === "compression-novelty.skipped"), true);
assert.equal(compressionSkipped.segments.every(segment => segment.compressionNovelty.method === "skipped"), true);

const minified = analyzeSignal({ text: `payload=${"a".repeat(6_000)}`, name: "encoded.txt", mode: "auto" });
assert.equal(minified.status, "invalid");
assert.match(minified.validation.errors.join(" "), /minified or encoded/i);

console.log(JSON.stringify({
  passed: fixtures.length + 5,
  fixtures: fixtures.map(fixture => fixture.id),
  performance: {
    lines: SIGNAL_LIMITS.maxLines,
    durationMs: Math.round(durationMs),
    budgetMs: SIGNAL_LIMITS.maxAnalysisMs,
  },
  stability: { variants: stabilityResults.length, compressionNovelty: noveltyScores },
}, null, 2));
