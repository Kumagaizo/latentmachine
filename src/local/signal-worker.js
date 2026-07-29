import { analyzeSignal } from "../intelligence/signal/engine.js";

self.addEventListener("message", event => {
  const { id, input } = event.data || {};
  if (!id || !input) return;
  try {
    self.postMessage({ id, progress: "segmenting lines" });
    const result = analyzeSignal(input);
    self.postMessage({ id, progress: "linking evidence" });
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || "Signal could not analyze this artifact." });
  }
});

