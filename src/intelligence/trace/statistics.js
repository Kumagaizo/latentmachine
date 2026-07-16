export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function quantile(sorted, probability) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = clamp(probability, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}

export function medianAbsoluteDeviation(values, center = median(values)) {
  if (center === null) return null;
  return median(values.filter(Number.isFinite).map(value => Math.abs(value - center)));
}

function histogram(values, stats) {
  if (!values.length) return { bins: [], method: "empty" };
  if (stats.min === stats.max) {
    return { bins: [{ x0: stats.min, x1: stats.max, count: values.length }], method: "constant" };
  }
  const iqr = stats.p75 - stats.p25;
  let count = 0;
  if (iqr > 0) {
    const width = 2 * iqr / Math.cbrt(values.length);
    count = width > 0 ? Math.ceil((stats.max - stats.min) / width) : 0;
  }
  if (!count) count = Math.ceil(Math.sqrt(values.length));
  count = clamp(count, 8, 24);
  const width = (stats.max - stats.min) / count;
  const bins = Array.from({ length: count }, (_, index) => ({
    x0: stats.min + index * width,
    x1: index === count - 1 ? stats.max : stats.min + (index + 1) * width,
    count: 0,
  }));
  for (const value of values) {
    const index = clamp(Math.floor((value - stats.min) / width), 0, count - 1);
    bins[index].count += 1;
  }
  return {
    bins: bins.map(bin => ({ x0: round(bin.x0), x1: round(bin.x1), count: bin.count })),
    method: iqr > 0 ? "freedman-diaconis" : "square-root",
  };
}

export function numericStatistics(input = []) {
  const values = input.filter(Number.isFinite);
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  const center = quantile(sorted, 0.5);
  const mad = medianAbsoluteDeviation(values, center);
  const stats = {
    count: values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: round(mean),
    median: round(center),
    standardDeviation: round(Math.sqrt(variance)),
    mad: round(mad),
    p05: round(quantile(sorted, 0.05)),
    p25: round(quantile(sorted, 0.25)),
    p75: round(quantile(sorted, 0.75)),
    p95: round(quantile(sorted, 0.95)),
    zeroCount: values.filter(value => value === 0).length,
    positiveCount: values.filter(value => value > 0).length,
    negativeCount: values.filter(value => value < 0).length,
  };
  const unusual = [];
  if (values.length >= 8) {
    if (mad > 0) {
      values.forEach((value, index) => {
        const score = 0.6745 * (value - center) / mad;
        if (Math.abs(score) > 3.5) unusual.push({ index, value, score: round(score, 2), method: "modified-z" });
      });
    } else {
      const counts = new Map();
      values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
      const dominant = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      if (dominant && dominant[1] / values.length >= 0.75) {
        values.forEach((value, index) => {
          if (value !== dominant[0]) unusual.push({ index, value, score: null, method: "rare-deviation" });
        });
      }
    }
  }
  return {
    ...stats,
    iqr: round(stats.p75 - stats.p25),
    unusual,
    histogram: histogram(values, stats),
  };
}

export function categoricalStatistics(values = [], limit = 8) {
  if (!values.length) return null;
  const counts = new Map();
  for (const value of values) {
    const key = typeof value === "string" ? value : JSON.stringify(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const ordered = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ordered.slice(0, limit).map(([value, count]) => ({ value, count, share: round(count / values.length) }));
  const visible = top.reduce((sum, item) => sum + item.count, 0);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / values.length;
    entropy -= probability * Math.log2(probability);
  }
  const maximumEntropy = counts.size > 1 ? Math.log2(counts.size) : 0;
  return {
    count: values.length,
    distinctCount: counts.size,
    distinctRatio: round(counts.size / values.length),
    top,
    remainderCount: values.length - visible,
    normalizedEntropy: maximumEntropy ? round(entropy / maximumEntropy) : 0,
  };
}

export function stringStatistics(values = []) {
  if (!values.length) return null;
  const lengths = values.map(value => String(value).length);
  const sorted = lengths.slice().sort((a, b) => a - b);
  const patterns = [
    ["uuid-like", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i],
    ["email-like", /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
    ["url-like", /^https?:\/\/[^\s]+$/i],
    ["iso-datetime-like", value => parseIsoTemporal(value)?.role === "datetime"],
    ["iso-date-like", value => parseIsoTemporal(value)?.role === "date"],
    ["integer-like", /^-?\d+$/],
    ["decimal-like", /^-?(?:\d+\.\d+|\d+\.)$/],
  ];
  const patternCoverage = patterns.map(([id, matcher]) => ({
    id,
    count: values.filter(value => typeof matcher === "function" ? matcher(String(value)) : matcher.test(String(value))).length,
  })).map(item => ({ ...item, share: round(item.count / values.length) }))
    .filter(item => values.length >= 8 && item.share >= 0.9)
    .sort((a, b) => b.share - a.share || a.id.localeCompare(b.id));
  return {
    count: values.length,
    minLength: sorted[0],
    medianLength: round(quantile(sorted, 0.5)),
    p95Length: round(quantile(sorted, 0.95)),
    maxLength: sorted[sorted.length - 1],
    patternCoverage,
  };
}

export function parseIsoTemporal(value) {
  if (typeof value !== "string") return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value);
  if (!dateOnly && !dateTime) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? { timestamp, role: dateOnly ? "date" : "datetime" } : null;
}

export function temporalStatistics(values = []) {
  const parsed = values.map(parseIsoTemporal).filter(Boolean);
  if (values.length < 8 || parsed.length / values.length < 0.9) return null;
  const sorted = [...new Set(parsed.map(item => item.timestamp))].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const intervals = sorted.slice(1).map((value, index) => value - sorted[index]).filter(value => value > 0);
  const medianInterval = median(intervals);
  const span = sorted[sorted.length - 1] - sorted[0];
  const gaps = [];
  if (intervals.length && medianInterval > 0 && span > 0) {
    intervals.forEach((interval, index) => {
      if (interval > medianInterval * 3 && interval > span * 0.05) {
        gaps.push({
          after: new Date(sorted[index]).toISOString(),
          before: new Date(sorted[index + 1]).toISOString(),
          intervalMs: interval,
          medianIntervalMs: medianInterval,
        });
      }
    });
  }
  return {
    count: parsed.length,
    role: parsed.every(item => item.role === "date") ? "date" : "datetime",
    earliest: new Date(sorted[0]).toISOString(),
    latest: new Date(sorted[sorted.length - 1]).toISOString(),
    spanMs: span,
    medianIntervalMs: medianInterval,
    uniqueCount: sorted.length,
    gaps,
  };
}

export function ksStatistic(a = [], b = []) {
  const left = a.filter(Number.isFinite).slice().sort((x, y) => x - y);
  const right = b.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!left.length || !right.length) return null;
  let i = 0;
  let j = 0;
  let maximum = 0;
  while (i < left.length || j < right.length) {
    const nextLeft = i < left.length ? left[i] : Infinity;
    const nextRight = j < right.length ? right[j] : Infinity;
    const value = Math.min(nextLeft, nextRight);
    while (i < left.length && left[i] <= value) i += 1;
    while (j < right.length && right[j] <= value) j += 1;
    maximum = Math.max(maximum, Math.abs(i / left.length - j / right.length));
  }
  return round(maximum);
}

export function jensenShannon(leftCounts = new Map(), rightCounts = new Map()) {
  const keys = new Set([...leftCounts.keys(), ...rightCounts.keys()]);
  const leftTotal = [...leftCounts.values()].reduce((sum, value) => sum + value, 0);
  const rightTotal = [...rightCounts.values()].reduce((sum, value) => sum + value, 0);
  if (!leftTotal || !rightTotal) return null;
  const divergence = (counts, total) => {
    let value = 0;
    for (const key of keys) {
      const p = (counts.get(key) || 0) / total;
      const q = ((leftCounts.get(key) || 0) / leftTotal + (rightCounts.get(key) || 0) / rightTotal) / 2;
      if (p > 0 && q > 0) value += p * Math.log2(p / q);
    }
    return value;
  };
  return round((divergence(leftCounts, leftTotal) + divergence(rightCounts, rightTotal)) / 2);
}
