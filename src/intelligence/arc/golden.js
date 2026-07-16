export const ARC_GOLDEN = {
  minSolved: 22,
  expectedFailures: [],
  tasks: {
    "c-cs2": {
      method: "compositionHypothesis",
      explanationIncludes: "cropBBox → Scale 2×",
      expectedTestSurp: 0,
    },
    "c-fc": {
      method: "compositionHypothesis",
      explanationIncludes: "flipH → Recolor",
      expectedTestSurp: 0,
    },
    "d-mid-hl": {
      method: "drawingHypothesis",
      explanationIncludes: "middle row",
      expectedTestSurp: 0,
    },
    "d-obj-vl": {
      method: "drawingHypothesis",
      explanationIncludes: "center column",
      expectedTestSurp: 0,
    },
    "d-between": {
      method: "drawingHypothesis",
      explanationIncludes: "between leftmost and rightmost",
      expectedTestSurp: 0,
    },
  },
};
