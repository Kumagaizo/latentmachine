const CELL_W = 16;
const CELL_H = 11;
const GAP_X = 5;
const GAP_Y = 5;
const PAD = 11;
const LABEL_H = 13;
const SIBLING_GAP = 16;

const MAX_TABLE_ROWS = 300;
const MAX_PRIMITIVE_CELLS = 1024;
const MAX_TABLE_COLUMNS = 24;
const MAX_REMOVED_CELLS = 200;
const GLOBAL_CELL_SOFT_CAP = 7000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function valueType(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function pathKey(segments = []) {
  return formatPath(segments);
}

function labelForSegment(segment) {
  return segment === undefined || segment === null || segment === "" ? "root" : String(segment);
}

function shortLabel(segment) {
  return labelForSegment(segment).toUpperCase().slice(0, 18);
}

export function formatPath(segments = []) {
  if (!segments.length) return "$";
  return `$${segments.map(segment => {
    if (typeof segment === "number") return `[${segment}]`;
    return /^[A-Za-z_$][\w$]*$/.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`;
  }).join("")}`;
}

export function canonicalize(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(item => canonicalize(item)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  if (typeof value === "number") return JSON.stringify(value) ?? "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "null";
}

function fnv1a(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hex8(value) {
  return value.toString(16).padStart(8, "0");
}

/**
 * Determinism contract:
 * Same parsed value -> same fingerprint, across formats.
 * Object key order does not affect the fingerprint.
 * Array order does affect the fingerprint.
 *
 * FNV-1a is used here for stable recognition and change detection. It is not
 * a cryptographic or tamper-proof hash.
 */
export function fingerprint(value) {
  const canonical = canonicalize(value);
  return {
    hex: `${hex8(fnv1a(canonical, 0x811c9dc5))}${hex8(fnv1a(canonical, 0x01000193))}`,
    bits: 64,
  };
}

export function groupedFingerprint(hex = "") {
  return String(hex).replace(/(.{4})(?=.)/g, "$1 ").trim();
}

function isLeaf(value) {
  return value === null || value === undefined || typeof value !== "object";
}

function isNumeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function objectEntries(value) {
  return Object.keys(value).sort().map(key => [key, value[key]]);
}

function unionRecordKeys(rows) {
  const keys = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function isRecordArray(value) {
  if (!Array.isArray(value) || value.length < 2) return false;
  if (!value.every(item => item && typeof item === "object" && !Array.isArray(item))) return false;
  const keys = unionRecordKeys(value);
  return keys.length > 0 && keys.length <= 48;
}

function collectOutlierMap(value) {
  const outliers = new Map();
  const flagCells = cells => {
    if (cells.length < 8) return;
    const mean = cells.reduce((sum, cell) => sum + cell.value, 0) / cells.length;
    const variance = cells.reduce((sum, cell) => sum + ((cell.value - mean) ** 2), 0) / cells.length;
    const sigma = Math.sqrt(variance);
    if (!sigma) return;
    for (const cell of cells) {
      const z = (cell.value - mean) / sigma;
      if (Math.abs(z) > 2.5) outliers.set(pathKey(cell.path), z);
    }
  };

  const visit = (node, path = []) => {
    if (Array.isArray(node)) {
      flagCells(node
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => isNumeric(item))
        .map(({ item, index }) => ({ value: item, path: [...path, index] })));

      if (isRecordArray(node)) {
        const columns = new Map();
        node.forEach((row, rowIndex) => {
          for (const [key, item] of Object.entries(row)) {
            if (!isNumeric(item)) continue;
            if (!columns.has(key)) columns.set(key, []);
            columns.get(key).push({ value: item, path: [...path, rowIndex, key] });
          }
        });
        for (const cells of columns.values()) flagCells(cells);
      }

      node.forEach((item, index) => visit(item, [...path, index]));
      return;
    }

    if (node && typeof node === "object") {
      for (const [key, item] of Object.entries(node)) visit(item, [...path, key]);
    }
  };

  visit(value);
  return outliers;
}

export function markOutliers(value) {
  return [...collectOutlierMap(value)].map(([path, z]) => ({ path, z }));
}

export function profileStructure(value) {
  const outlierMap = collectOutlierMap(value);
  const counts = { objects: 0, arrays: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, leaves: 0 };
  const profile = {
    counts,
    maxDepth: 0,
    maxArrayLength: 0,
    recordArrays: 0,
    outliers: outlierMap.size,
  };

  const visit = (node, depth) => {
    profile.maxDepth = Math.max(profile.maxDepth, depth);
    if (Array.isArray(node)) {
      counts.arrays += 1;
      profile.maxArrayLength = Math.max(profile.maxArrayLength, node.length);
      if (isRecordArray(node)) profile.recordArrays += 1;
      node.forEach(item => visit(item, depth + 1));
      return;
    }
    if (node && typeof node === "object") {
      counts.objects += 1;
      Object.values(node).forEach(item => visit(item, depth + 1));
      return;
    }
    counts.leaves += 1;
    if (typeof node === "string") counts.strings += 1;
    else if (typeof node === "number") counts.numbers += 1;
    else if (typeof node === "boolean") counts.booleans += 1;
    else counts.nulls += 1;
  };

  visit(value, 0);
  return profile;
}

function flattenLeaves(value, path = [], map = new Map()) {
  if (Array.isArray(value)) {
    if (!value.length) map.set(pathKey(path), { path: pathKey(path), type: "array", value });
    value.forEach((item, index) => flattenLeaves(item, [...path, index], map));
    return map;
  }
  if (value && typeof value === "object") {
    const entries = objectEntries(value);
    if (!entries.length) map.set(pathKey(path), { path: pathKey(path), type: "object", value });
    entries.forEach(([key, item]) => flattenLeaves(item, [...path, key], map));
    return map;
  }
  map.set(pathKey(path), { path: pathKey(path), type: valueType(value), value });
  return map;
}

export function structuralDiff(a, b) {
  const left = flattenLeaves(a);
  const right = flattenLeaves(b);
  const status = new Map();
  const added = [];
  const changed = [];
  const removed = [];
  let same = 0;

  for (const [path, rightLeaf] of right) {
    const leftLeaf = left.get(path);
    if (!leftLeaf) {
      status.set(path, "add");
      added.push(rightLeaf);
      continue;
    }

    const typeChanged = leftLeaf.type !== rightLeaf.type;
    const valueChanged = canonicalize(leftLeaf.value) !== canonicalize(rightLeaf.value);
    if (typeChanged || valueChanged) {
      status.set(path, "chg");
      changed.push({ ...rightLeaf, before: leftLeaf.value, typeChanged });
    } else {
      status.set(path, "same");
      same += 1;
    }
  }

  for (const [path, leftLeaf] of left) {
    if (!right.has(path)) removed.push(leftLeaf);
  }

  return {
    status,
    added,
    changed,
    removed,
    counts: { added: added.length, changed: changed.length, removed: removed.length, same },
    fingerprints: { a: fingerprint(a).hex, b: fingerprint(b).hex },
  };
}

const V2_FLOW_X = 24;
const V2_FLOW_Y = 34;
const V2_CONTENT_W = 720;
const V2_INDENT = 22;
const V2_KEY_W = 132;
const V2_ROW_H = 30;
const V2_SECTION_GAP = 32;
const V2_CHART_H = 46;
const V2_BAR_W = 3;
const V2_BAR_GAP = 2;
const V2_TEXT_W = 5.7;
const V2_MAX_INLINE_ITEMS = 10;

function v2TextWidth(text = "", size = 10) {
  return String(text).length * (size * 0.58);
}

function v2ValueText(value, limit = 28) {
  if (typeof value === "string") {
    const clipped = value.length > limit ? `${value.slice(0, limit - 1)}...` : value;
    return `"${clipped}"`;
  }
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : Number(value.toFixed(3)).toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.length}]`;
  return "{...}";
}

function v2AddText(layout, x, y, text, options = {}) {
  const item = {
    x,
    y,
    text: String(text),
    size: options.size || 10,
    weight: options.weight || 400,
    role: options.role || "text",
    align: options.align || "left",
    opacity: options.opacity ?? 1,
    strike: Boolean(options.strike),
  };
  layout.texts.push(item);
  return item;
}

function v2AddLine(layout, x1, y1, x2, y2, options = {}) {
  layout.lines.push({
    x1,
    y1,
    x2,
    y2,
    role: options.role || "muted",
    opacity: options.opacity ?? 0.45,
    dash: options.dash || null,
    width: options.width || 1,
  });
}

function v2AddDot(layout, x, y, r, options = {}) {
  layout.dots.push({
    x,
    y,
    r,
    role: options.role || "muted",
    fill: options.fill ?? true,
    opacity: options.opacity ?? 1,
  });
}

function v2AddHit(layout, x, y, w, h, value, path, ctx) {
  const formattedPath = pathKey(path);
  const z = ctx.outlierMap.get(formattedPath);
  const cell = {
    x,
    y,
    w,
    h,
    type: valueType(value),
    value,
    path: formattedPath,
    st: ctx.diffStatus?.get(formattedPath) || null,
    out: z !== undefined,
    z,
  };
  layout.cells.push(cell);
  return cell;
}

function v2AddBar(layout, x, y, w, h, options = {}) {
  const bar = {
    x,
    y,
    w,
    h,
    role: options.role || "muted",
    opacity: options.opacity ?? 0.4,
    path: options.path || null,
    value: options.value,
    type: options.type || "number",
    st: options.st || null,
    out: Boolean(options.out),
    z: options.z,
  };
  layout.bars.push(bar);
  if (bar.path) {
    layout.cells.push({
      x,
      y,
      w: Math.max(w, 5),
      h,
      type: bar.type,
      value: bar.value,
      path: bar.path,
      st: bar.st,
      out: bar.out,
      z: bar.z,
    });
  }
  return bar;
}

function v2BeforeMap(changed = []) {
  const map = new Map();
  for (const item of changed || []) map.set(item.path, item.before);
  return map;
}

function v2StatusRole(status, fallback = "text") {
  if (status === "add") return "safe";
  if (status === "chg" || status === "rem") return "danger";
  return fallback;
}

function v2RowConnector(layout, x, y, key, valueX, status = null) {
  const start = x + Math.min(V2_KEY_W - 20, Math.max(32, v2TextWidth(key, 10) + 14));
  const end = valueX - 14;
  if (end <= start) return;
  v2AddLine(layout, start, y + 12, end, y + 12, {
    role: v2StatusRole(status, "muted"),
    opacity: status ? 0.28 : 0.14,
    width: 0.7,
  });
}

function v2Header(layout, cursor, key, value, depth, type) {
  const x = V2_FLOW_X + depth * V2_INDENT;
  const count = Array.isArray(value) ? value.length : Object.keys(value || {}).length;
  v2AddText(layout, x, cursor.y + 10, `${shortLabel(key)} - ${type} - ${count}`, {
    size: 9,
    role: "muted",
    opacity: 0.55,
    weight: 600,
  });
  cursor.y += 22;
}

function v2NumericStats(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { min, max, mean, span: max - min || 1 };
}

function v2Scalar(layout, cursor, key, value, path, depth, ctx) {
  const x = V2_FLOW_X + depth * V2_INDENT;
  const y = cursor.y;
  const formattedPath = pathKey(path);
  const status = ctx.diffStatus?.get(formattedPath) || null;
  const before = ctx.before.get(formattedPath);
  const z = ctx.outlierMap.get(formattedPath);
  v2AddText(layout, x, y + 15, String(key), { size: 10, role: "muted", opacity: 0.6 });
  const valueX = x + V2_KEY_W;
  v2RowConnector(layout, x, y, String(key), valueX, status);
  if (status === "chg" && before !== undefined) {
    const oldText = v2ValueText(before);
    v2AddText(layout, valueX, y + 15, oldText, { size: 10, role: "muted", opacity: 0.45, strike: true });
    v2AddText(layout, valueX + v2TextWidth(oldText, 10) + 10, y + 15, "->", { size: 10, role: "muted", opacity: 0.5 });
    v2AddText(layout, valueX + v2TextWidth(oldText, 10) + 28, y + 15, v2ValueText(value), { size: 10, role: "danger", weight: 500 });
  } else if (typeof value === "boolean") {
    v2AddDot(layout, valueX + 3, y + 11, 3, { role: v2StatusRole(status, "muted"), fill: value, opacity: value ? 1 : 0.8 });
    v2AddText(layout, valueX + 14, y + 15, value ? "true" : "false", { size: 10, role: v2StatusRole(status, "muted") });
  } else {
    const role = z !== undefined ? "danger" : v2StatusRole(status, value === null || value === undefined || typeof value === "number" ? "muted" : "text");
    const opacity = value === null || value === undefined ? 0.35 : 1;
    const prefix = status === "add" ? "+ " : "";
    v2AddText(layout, valueX, y + 15, `${prefix}${v2ValueText(value)}`, { size: 10, role, weight: typeof value === "string" ? 500 : 400, opacity });
  }
  v2AddHit(layout, x, y, V2_CONTENT_W, V2_ROW_H, value, path, ctx);
  cursor.y += V2_ROW_H;
}

function v2NumericArray(layout, cursor, key, value, path, depth, ctx) {
  const values = value.slice(0, MAX_PRIMITIVE_CELLS).filter(isNumeric);
  if (value.length > values.length) layout.truncated += value.length - values.length;
  if (values.length < 8) return v2InlineArray(layout, cursor, key, value, path, depth, ctx);
  layout.series += 1;
  v2Header(layout, cursor, key, value, depth, "SERIES");
  const x = V2_FLOW_X + depth * V2_INDENT;
  const y = cursor.y;
  const stats = v2NumericStats(values);
  const chartW = values.length * (V2_BAR_W + V2_BAR_GAP) - V2_BAR_GAP;
  values.forEach((item, index) => {
    const h = Math.max(2, ((item - stats.min) / stats.span) * V2_CHART_H);
    const itemPath = [...path, index];
    const formattedPath = pathKey(itemPath);
    const out = ctx.outlierMap.get(formattedPath);
    const st = ctx.diffStatus?.get(formattedPath) || null;
    v2AddBar(layout, x + index * (V2_BAR_W + V2_BAR_GAP), y + V2_CHART_H - h, V2_BAR_W, h, {
      role: out !== undefined || st === "chg" ? "danger" : v2StatusRole(st, "muted"),
      opacity: out !== undefined || st === "chg" ? 0.95 : 0.4,
      path: formattedPath,
      value: item,
      st,
      out: out !== undefined,
      z: out,
    });
  });
  const meanY = y + V2_CHART_H - ((stats.mean - stats.min) / stats.span) * V2_CHART_H;
  v2AddLine(layout, x, meanY, x + chartW, meanY, { role: "text", opacity: 0.25, dash: [4, 4] });
  const outliers = values
    .map((item, index) => ({ index, z: ctx.outlierMap.get(pathKey([...path, index])) }))
    .filter(item => item.z !== undefined);
  const annotationX = x + chartW + 16;
  v2AddText(layout, annotationX, y + 8, `max ${v2ValueText(stats.max)}`, { size: 8.5, role: "muted" });
  v2AddText(layout, annotationX, y + 21, `mean ${v2ValueText(stats.mean)}`, { size: 8.5, role: "muted", opacity: 0.75 });
  v2AddText(layout, annotationX, y + 34, `min ${v2ValueText(stats.min)}`, { size: 8.5, role: "muted" });
  if (outliers.length) {
    v2AddText(layout, annotationX, y + 58, `${outliers.length} outlier ${outliers.map(item => item.index).join(",")}`, { size: 8.5, role: "danger" });
    cursor.y += 70;
  } else {
    cursor.y += V2_CHART_H + V2_SECTION_GAP;
  }
}

function v2InlineArray(layout, cursor, key, value, path, depth, ctx) {
  if (value.length <= V2_MAX_INLINE_ITEMS) {
    const x = V2_FLOW_X + depth * V2_INDENT;
    const y = cursor.y;
    const formattedPath = pathKey(path);
    const status = ctx.diffStatus?.get(formattedPath) || null;
    v2AddText(layout, x, y + 15, String(key), { size: 10, role: "muted", opacity: 0.6 });
    const valueX = x + V2_KEY_W;
    v2RowConnector(layout, x, y, String(key), valueX, status);
    v2AddText(layout, valueX, y + 15, value.map(item => v2ValueText(item, 16)).join(" - "), { size: 10, role: v2StatusRole(status, "text") });
    v2AddHit(layout, x, y, V2_CONTENT_W, V2_ROW_H, value, path, ctx);
    cursor.y += V2_ROW_H;
    return;
  }
  layout.series += 1;
  v2Header(layout, cursor, key, value, depth, "SERIES");
  const x = V2_FLOW_X + depth * V2_INDENT;
  const y = cursor.y;
  const items = value.slice(0, MAX_PRIMITIVE_CELLS);
  if (value.length > items.length) layout.truncated += value.length - items.length;
  const columns = 40;
  items.forEach((item, index) => {
    const st = ctx.diffStatus?.get(pathKey([...path, index])) || null;
    v2AddDot(layout, x + (index % columns) * 7, y + Math.floor(index / columns) * 9, 2.1, {
      role: v2StatusRole(st, "muted"),
      fill: item !== null && item !== false,
      opacity: st ? 1 : 0.45,
    });
  });
  v2AddText(layout, x, y + Math.ceil(items.length / columns) * 9 + 12, `${value.length} items - ${new Set(value.map(item => canonicalize(item))).size} distinct`, { size: 8.5, role: "muted" });
  cursor.y += Math.ceil(items.length / columns) * 9 + 28;
}

function v2ColumnKind(rows, key) {
  const values = rows.map(row => row?.[key]).filter(value => value !== undefined && value !== null);
  if (values.length && values.filter(isNumeric).length / values.length >= 0.8) return "number";
  if (values.length && values.every(value => typeof value === "boolean")) return "boolean";
  return "text";
}

function v2RecordTable(layout, cursor, key, value, path, depth, ctx) {
  layout.tables += 1;
  const allKeys = unionRecordKeys(value);
  const keys = allKeys.slice(0, MAX_TABLE_COLUMNS);
  if (allKeys.length > keys.length) layout.truncated += allKeys.length - keys.length;
  const rows = value.slice(0, MAX_TABLE_ROWS);
  if (value.length > rows.length) layout.truncated += value.length - rows.length;
  v2Header(layout, cursor, key, value, depth, "TBL");
  const x = V2_FLOW_X + depth * V2_INDENT;
  let y = cursor.y;
  const dense = rows.length > 24;
  const rowH = dense ? 20 : 32;
  const indexW = 34;
  const kinds = keys.map(column => v2ColumnKind(rows, column));
  const widths = kinds.map(kind => kind === "number" ? 112 : 88);
  const colX = [];
  let currentX = x + indexW;
  keys.forEach((column, index) => {
    colX[index] = currentX;
    v2AddText(layout, currentX, y + 9, String(column).toUpperCase().slice(0, 12), { size: 8.5, role: "muted", opacity: 0.72, weight: 600 });
    currentX += widths[index];
  });
  y += 22;
  v2AddLine(layout, x + indexW - 6, y - 4, currentX - 12, y - 4, { role: "muted", opacity: 0.18, width: 0.7 });
  const scales = new Map();
  keys.forEach((column, index) => {
    if (kinds[index] !== "number") return;
    const nums = rows.map(row => row?.[column]).filter(isNumeric);
    scales.set(column, nums.length ? v2NumericStats(nums) : { min: 0, max: 1, span: 1 });
  });
  rows.forEach((row, rowIndex) => {
    const baseline = y + (dense ? 13 : 19);
    if (!dense) {
      v2AddLine(layout, x + indexW - 6, y + rowH - 3, currentX - 12, y + rowH - 3, { role: "muted", opacity: 0.055, width: 0.6 });
    }
    if (!dense || rowIndex % 8 === 0) v2AddText(layout, x, baseline, String(rowIndex), { size: 8.5, role: "muted", opacity: 0.52, align: "right" });
    keys.forEach((column, columnIndex) => {
      const item = row?.[column];
      const itemPath = [...path, rowIndex, column];
      const formattedPath = pathKey(itemPath);
      const st = ctx.diffStatus?.get(formattedPath) || null;
      const out = ctx.outlierMap.get(formattedPath);
      const cx = colX[columnIndex];
      const kind = kinds[columnIndex];
      v2AddHit(layout, cx, y, widths[columnIndex] - 8, rowH, item, itemPath, ctx);
      if (kind === "number" && isNumeric(item)) {
        const scale = scales.get(column);
        const w = Math.max(2, ((item - scale.min) / scale.span) * 54);
        const role = out !== undefined || st === "chg" ? "danger" : v2StatusRole(st, "muted");
        const barX = cx + widths[columnIndex] - 64;
        v2AddLine(layout, barX, y + rowH / 2, barX + 54, y + rowH / 2, { role: "muted", opacity: 0.12, width: 1 });
        v2AddBar(layout, barX, y + 8, w, Math.max(3, rowH - 16), { role, opacity: out !== undefined || st === "chg" ? 0.95 : 0.4 });
        if (!dense || out !== undefined || st === "chg" || st === "add") {
          v2AddText(layout, barX - 8, baseline, v2ValueText(item), { size: 8.5, role, align: "right" });
        }
      } else if (kind === "boolean") {
        v2AddDot(layout, cx + 4, y + rowH / 2, 3, { role: v2StatusRole(st, "muted"), fill: Boolean(item), opacity: item ? 1 : 0.65 });
        if (!dense) v2AddText(layout, cx + 14, baseline, item ? "true" : "false", { size: 8.5, role: v2StatusRole(st, "muted") });
      } else {
        v2AddText(layout, cx, baseline, v2ValueText(item, 10), { size: 8.5, role: v2StatusRole(st, "text") });
      }
    });
    y += rowH;
  });
  cursor.y = y + V2_SECTION_GAP;
}

function v2Object(layout, cursor, key, value, path, depth, ctx) {
  const entries = Array.isArray(value)
    ? value.map((item, index) => [index, item])
    : objectEntries(value);
  if (depth > 0) {
    v2Header(layout, cursor, key, value, depth, Array.isArray(value) ? "SERIES" : "OBJ");
    const guideX = V2_FLOW_X + depth * V2_INDENT - 10;
    const startY = cursor.y - 12;
    const beforeY = cursor.y;
    entries.forEach(([childKey, item]) => v2Node(layout, cursor, childKey, item, [...path, childKey], depth + 1, ctx));
    v2AddLine(layout, guideX, startY, guideX, Math.max(beforeY, cursor.y - V2_SECTION_GAP), { role: "muted", opacity: 0.35 });
    cursor.y += 4;
    return;
  }
  entries.forEach(([childKey, item]) => v2Node(layout, cursor, childKey, item, [...path, childKey], depth, ctx));
}

function v2Node(layout, cursor, key, value, path, depth, ctx) {
  if (isLeaf(value)) return v2Scalar(layout, cursor, key, value, path, depth, ctx);
  if (isRecordArray(value)) return v2RecordTable(layout, cursor, key, value, path, depth, ctx);
  if (Array.isArray(value) && value.every(isNumeric)) return v2NumericArray(layout, cursor, key, value, path, depth, ctx);
  if (Array.isArray(value) && value.every(isLeaf)) return v2InlineArray(layout, cursor, key, value, path, depth, ctx);
  return v2Object(layout, cursor, key, value, path, depth, ctx);
}

function v2RemovedLine(layout, cursor, removed = []) {
  if (!removed.length) return;
  const items = removed.slice(0, MAX_REMOVED_CELLS);
  if (removed.length > items.length) layout.truncated += removed.length - items.length;
  v2AddText(layout, V2_FLOW_X, cursor.y + 15, `- removed ${items.map(item => item.path).join(", ")}`, { size: 10, role: "danger" });
  layout.cells.push({ x: V2_FLOW_X, y: cursor.y, w: V2_CONTENT_W, h: V2_ROW_H, type: "removed", value: items.map(item => item.path).join(", "), path: "$removed", st: "rem" });
  cursor.y += V2_ROW_H + V2_SECTION_GAP;
}

function v2Bounds(layout) {
  const rects = [];
  for (const item of layout.cells) rects.push(item);
  for (const item of layout.bars) rects.push(item);
  for (const item of layout.dots) rects.push({ x: item.x - item.r, y: item.y - item.r, w: item.r * 2, h: item.r * 2 });
  for (const item of layout.lines) rects.push({ x: Math.min(item.x1, item.x2), y: Math.min(item.y1, item.y2), w: Math.abs(item.x2 - item.x1) || 1, h: Math.abs(item.y2 - item.y1) || 1 });
  for (const item of layout.texts) {
    rects.push({ x: item.align === "right" ? item.x - v2TextWidth(item.text, item.size) : item.x, y: item.y - item.size, w: v2TextWidth(item.text, item.size), h: item.size + 3 });
  }
  if (!rects.length) return { x: 0, y: 0, w: 100, h: 80 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  rects.forEach(rect => {
    x0 = Math.min(x0, rect.x);
    y0 = Math.min(y0, rect.y);
    x1 = Math.max(x1, rect.x + rect.w);
    y1 = Math.max(y1, rect.y + rect.h);
  });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function buildBoardLayout(value, options = {}) {
  const layout = {
    panels: [],
    cells: [],
    labels: [],
    wires: [],
    texts: [],
    bars: [],
    dots: [],
    lines: [],
    bounds: { x: 0, y: 0, w: 100, h: 80 },
    truncated: 0,
    series: 0,
    tables: 0,
  };
  const ctx = {
    outlierMap: collectOutlierMap(value),
    diffStatus: options.diffStatus || null,
    before: v2BeforeMap(options.changed || []),
  };
  const cursor = { y: V2_FLOW_Y };
  v2Object(layout, cursor, "root", value, [], 0, ctx);
  v2RemovedLine(layout, cursor, options.removed || []);
  layout.bounds = v2Bounds(layout);
  return layout;
}

export function summarizeProfile(profile) {
  const c = profile.counts;
  return `${c.leaves} values, ${c.objects} objects, ${c.arrays} arrays, depth ${profile.maxDepth}, ${profile.outliers} outliers`;
}
