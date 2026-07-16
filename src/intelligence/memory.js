export function createMemoryStore(initial = {}) {
  return {
    solvedExamples: [...(initial.solvedExamples || [])],
    corrections: [...(initial.corrections || [])],
    failedAttempts: [...(initial.failedAttempts || [])],
    acceptedOutputs: [...(initial.acceptedOutputs || [])],
  };
}

export function recordSolvedExample(memory, entry) {
  memory.solvedExamples.push({ ...entry, at: new Date().toISOString() });
  return memory;
}

export function recordFailedAttempt(memory, entry) {
  memory.failedAttempts.push({ ...entry, at: new Date().toISOString() });
  return memory;
}

export function createCorrection({ toolId, taskId, input, predicted, corrected, reason = "user-correction", note = "" }) {
  return {
    id: `correction-${Date.now().toString(36)}`,
    toolId,
    taskId,
    input,
    predicted,
    corrected,
    reason,
    note,
    status: "pending-review",
    at: new Date().toISOString(),
  };
}

export function recordCorrection(memory, correction) {
  memory.corrections.push(correction);
  return memory;
}
