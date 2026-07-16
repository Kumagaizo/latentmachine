export const INTELLIGENCE_PRIMITIVES = [
  { id: "perception", title: "Perception", description: "Turn raw inputs into structured entities, objects, relations, and diffs." },
  { id: "hypothesis-generation", title: "Hypothesis Generation", description: "Generate candidate rules or programs from examples." },
  { id: "search", title: "Search", description: "Explore candidate programs within deterministic runtime budgets." },
  { id: "scoring", title: "Scoring", description: "Rank candidates by fit, complexity, ambiguity, and prior reliability." },
  { id: "execution", title: "Execution", description: "Run selected programs on new inputs." },
  { id: "tracing", title: "Tracing", description: "Emit structured events that explain engine decisions." },
  { id: "benchmarking", title: "Benchmarking", description: "Measure reliability against golden and adversarial suites." },
  { id: "correction-memory", title: "Correction Memory", description: "Capture user corrections and failures for future learning." },
];

export function getPrimitive(id) {
  return INTELLIGENCE_PRIMITIVES.find(p => p.id === id) || null;
}
