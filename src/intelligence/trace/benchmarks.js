export const TRACE_FIXTURES = {
  nested: {
    service: "billing",
    enabled: true,
    limits: { daily: 1000, burst: 50 },
    sensors: Array.from({ length: 10 }, (_, index) => ({
      id: `S${index}`,
      temp: index === 7 ? 48 : 21 + index / 10,
      ok: index !== 3,
    })),
  },
  keyOrderA: {
    b: 2,
    a: 1,
    rows: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ],
  },
  keyOrderB: {
    rows: [
      { name: "Ada", id: 1 },
      { name: "Grace", id: 2 },
    ],
    a: 1,
    b: 2,
  },
  arrayA: [1, 2, 3],
  arrayB: [1, 3, 2],
};

export const TRACE_BENCHMARKS = [
  {
    id: "nested-golden",
    suite: "golden",
    input: { data: TRACE_FIXTURES.nested },
    expectedFingerprint: "56aa35d78beb8acd",
    expectedProfile: {
      counts: { objects: 12, arrays: 1, strings: 11, numbers: 12, booleans: 11, nulls: 0, leaves: 34 },
      maxDepth: 3,
      maxArrayLength: 10,
      recordArrays: 1,
      outliers: 1,
    },
    expectedLayout: { bounds: { x: 19.07, y: 34, w: 724.93, h: 516 }, cells: 34, panels: 0, texts: 52, bars: 10, truncated: 0 },
  },
  {
    id: "key-order-invariant",
    suite: "regression",
    input: { data: TRACE_FIXTURES.keyOrderA },
    compare: TRACE_FIXTURES.keyOrderB,
    expectedFingerprint: "0f4d7623ec3af335",
    expectedCompareFingerprint: "0f4d7623ec3af335",
    expectedDiffCounts: { added: 0, changed: 0, removed: 0, same: 6 },
    expectedLayout: { bounds: { x: 19.07, y: 34, w: 724.93, h: 168 }, cells: 6, panels: 0, texts: 13, bars: 2, truncated: 0 },
  },
  {
    id: "array-order-sensitive",
    suite: "regression",
    input: { data: TRACE_FIXTURES.arrayA },
    compare: TRACE_FIXTURES.arrayB,
    expectedFingerprint: "e0f965d986885eff",
    expectedCompareFingerprint: "211b59c133e3b42f",
    expectedDiffCounts: { added: 0, changed: 2, removed: 0, same: 1 },
    expectedLayout: { bounds: { x: 24, y: 34, w: 720, h: 90 }, cells: 3, panels: 0, texts: 10, bars: 0, truncated: 0 },
  },
  {
    id: "nested-diff",
    suite: "real-world",
    input: { data: TRACE_FIXTURES.nested },
    compare: {
      ...TRACE_FIXTURES.nested,
      enabled: false,
      limits: { daily: 1000, burst: 75, weekly: 5000 },
      sensors: TRACE_FIXTURES.nested.sensors.slice(0, 9),
    },
    expectedFingerprint: "56aa35d78beb8acd",
    expectedCompareFingerprint: "5eabc936f3c63c7c",
    expectedDiffCounts: { added: 1, changed: 2, removed: 3, same: 29 },
  },
];
