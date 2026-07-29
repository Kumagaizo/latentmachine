import { runBuiltTransform } from "../intelligence/json-transform/translator.js";

self.addEventListener("message", event => {
  const { id, rawTask, transformTask } = event.data || {};
  try {
    const result = runBuiltTransform(rawTask, transformTask, { applyBatch: false });
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message || "Transform could not be evaluated." });
  }
});
