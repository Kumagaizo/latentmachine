import { detectFormat, parseWithFormat } from "../intelligence/data-formats/index.js";
import { analyzeTrace } from "../intelligence/trace/analyze.js";
import { compareTrace } from "../intelligence/trace/compare.js";

function parse(text, requestedFormat = "auto") {
  const format = requestedFormat === "auto" ? detectFormat(text) : requestedFormat;
  return {
    value: parseWithFormat(text, requestedFormat),
    format,
    bytes: new TextEncoder().encode(text).length,
  };
}

self.addEventListener("message", event => {
  const { id, mode, textA, textB, nameA, nameB, formatA, formatB, recordSetPathA, recordSetPathB, settings } = event.data;
  try {
    self.postMessage({ id, phase: "parsing" });
    const sourceA = parse(textA, formatA);
    if (mode === "compare") {
      const sourceB = parse(textB, formatB);
      self.postMessage({ id, phase: "comparing" });
      const comparison = compareTrace(sourceA.value, sourceB.value, {
        baselineSource: { format: sourceA.format, bytes: sourceA.bytes, name: nameA },
        candidateSource: { format: sourceB.format, bytes: sourceB.bytes, name: nameB },
        baselineRecordSetPath: recordSetPathA,
        candidateRecordSetPath: recordSetPathB,
        ...settings,
      });
      self.postMessage({ id, phase: "building views" });
      self.postMessage({ id, ok: true, valueA: sourceA.value, valueB: sourceB.value, analysis: comparison.candidate, comparison });
    } else {
      self.postMessage({ id, phase: "profiling structure" });
      const analysis = analyzeTrace(sourceA.value, { format: sourceA.format, bytes: sourceA.bytes, name: nameA, recordSetPath: recordSetPathA });
      self.postMessage({ id, phase: "finding observations" });
      self.postMessage({ id, ok: true, valueA: sourceA.value, valueB: null, analysis, comparison: null });
    }
  } catch (error) {
    self.postMessage({ id, ok: false, kind: "analysis-error", error: error?.message || "Trace could not parse this data." });
  }
});
