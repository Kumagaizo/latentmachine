
// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  ARC PROGRAM SYNTHESIS ENGINE v0.5 — Abstract Rule Engine            ║
// ║  Pure logic — no UI deps above the UI section                        ║
// ╚═══════════════════════════════════════════════════════════════════════╝

// ── Grid Utils ──────────────────────────────────────────────────────────

const validateGrid = g => Array.isArray(g) && g.length > 0 && g[0].length > 0 &&
  g.every(r => r.length === g[0].length && r.every(c => Number.isInteger(c) && c >= 0 && c <= 9));
const clone = g => g.map(r => [...r]);
const eq = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) if (a[r][c] !== b[r][c]) return false;
  }
  return true;
};
const gSz = g => ({ rows: g.length, cols: g[0]?.length || 0 });

function detectBg(grid) {
  const rows = grid.length, cols = grid[0]?.length || 0;
  const bc = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = grid[r][c];
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) bc[v] = (bc[v] || 0) + 1;
  }
  const entries = Object.entries(bc);
  if (entries.length > 0) return Number(entries.sort((a, b) => b[1] - a[1])[0][0]);
  const fc = {}; for (const row of grid) for (const v of row) fc[v] = (fc[v] || 0) + 1;
  return Number(Object.entries(fc).sort((a, b) => b[1] - a[1])[0][0]);
}

function pxSurprise(pred, actual) {
  if (!pred || !actual || pred.length !== actual.length) return 1;
  let d = 0, t = 0;
  for (let r = 0; r < actual.length; r++) {
    if (pred[r].length !== actual[r].length) return 1;
    for (let c = 0; c < actual[r].length; c++) { t++; if (pred[r][c] !== actual[r][c]) d++; }
  }
  return t === 0 ? 1 : d / t;
}

function colorHist(g) {
  const h = {}; for (const row of g) for (const v of row) h[v] = (h[v] || 0) + 1; return h;
}

// ── Diff Analysis ───────────────────────────────────────────────────────

function diffGrid(inp, out) {
  const changes = [];
  if (inp.length !== out.length || (inp[0]?.length || 0) !== (out[0]?.length || 0))
    return { type: "size-change", changes };
  for (let r = 0; r < inp.length; r++)
    for (let c = 0; c < (inp[0]?.length || 0); c++)
      if (inp[r][c] !== out[r][c]) changes.push({ r, c, from: inp[r][c], to: out[r][c] });
  return { type: "same-size", changes };
}

function analyzeDiff(changes) {
  if (!changes.length) return [];
  const tags = [];
  const toC = new Set(changes.map(c => c.to));
  if (toC.size === 1) tags.push({ tag: "single-color", color: [...toC][0] });
  const rows = new Set(changes.map(c => c.r));
  const cols = new Set(changes.map(c => c.c));
  if (rows.size === 1) tags.push({ tag: "h-line", row: [...rows][0], minC: Math.min(...changes.map(c => c.c)), maxC: Math.max(...changes.map(c => c.c)), color: [...toC][0] });
  if (cols.size === 1) tags.push({ tag: "v-line", col: [...cols][0], minR: Math.min(...changes.map(c => c.r)), maxR: Math.max(...changes.map(c => c.r)), color: [...toC][0] });
  const mnR = Math.min(...changes.map(c => c.r)), mxR = Math.max(...changes.map(c => c.r));
  const mnC = Math.min(...changes.map(c => c.c)), mxC = Math.max(...changes.map(c => c.c));
  if (changes.length === (mxR - mnR + 1) * (mxC - mnC + 1)) tags.push({ tag: "rectangle" });
  return tags;
}

// ── Object Detection ────────────────────────────────────────────────────

function makeObj(grid, cells, color) {
  let mnR = Infinity, mxR = -1, mnC = Infinity, mxC = -1;
  for (const { r, c } of cells) { mnR = Math.min(mnR, r); mxR = Math.max(mxR, r); mnC = Math.min(mnC, c); mxC = Math.max(mxC, c); }
  const w = mxC - mnC + 1, h = mxR - mnR + 1;
  const shape = Array.from({ length: h }, () => Array(w).fill(0));
  const mask = Array.from({ length: h }, () => Array(w).fill(false));
  for (const { r, c } of cells) { shape[r - mnR][c - mnC] = grid[r][c]; mask[r - mnR][c - mnC] = true; }
  return { id: `o${mnR}_${mnC}_${color}`, color, cells, bbox: { mnR, mxR, mnC, mxC }, width: w, height: h, area: cells.length, shape, mask, center: { r: Math.round((mnR + mxR) / 2), c: Math.round((mnC + mxC) / 2) } };
}

function findObjs(grid, bg = null) {
  if (bg === null) bg = detectBg(grid);
  const R = grid.length, C = grid[0]?.length || 0;
  const seen = Array.from({ length: R }, () => Array(C).fill(false));
  const objs = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (seen[r][c] || grid[r][c] === bg) continue;
    const color = grid[r][c], cells = [], stk = [[r, c]]; seen[r][c] = true;
    while (stk.length) { const [cr, cc] = stk.pop(); cells.push({ r: cr, c: cc }); for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nr = cr + dr, nc = cc + dc; if (nr >= 0 && nr < R && nc >= 0 && nc < C && !seen[nr][nc] && grid[nr][nc] === color) { seen[nr][nc] = true; stk.push([nr, nc]); } } }
    objs.push(makeObj(grid, cells, color));
  }
  return objs;
}

function findObjsMulti(grid, bg = null) {
  if (bg === null) bg = detectBg(grid);
  const R = grid.length, C = grid[0]?.length || 0;
  const seen = Array.from({ length: R }, () => Array(C).fill(false));
  const objs = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (seen[r][c] || grid[r][c] === bg) continue;
    const cells = [], stk = [[r, c]]; seen[r][c] = true;
    while (stk.length) { const [cr, cc] = stk.pop(); cells.push({ r: cr, c: cc }); for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nr = cr + dr, nc = cc + dc; if (nr >= 0 && nr < R && nc >= 0 && nc < C && !seen[nr][nc] && grid[nr][nc] !== bg) { seen[nr][nc] = true; stk.push([nr, nc]); } } }
    const cs = [...new Set(cells.map(p => grid[p.r][p.c]))];
    objs.push(makeObj(grid, cells, cs.length === 1 ? cs[0] : -1));
  }
  return objs;
}

// ── Shape / Mask Comparison ─────────────────────────────────────────────

function rot90(s) { const R = s.length, C = s[0]?.length || 0; return Array.from({ length: C }, (_, c) => Array.from({ length: R }, (_, r) => s[R - 1 - r][c])); }
function rot180(s) { return rot90(rot90(s)); }
function rot270(s) { return rot90(rot180(s)); }
function flipH(s) { return s.map(r => [...r].reverse()); }
function flipV(s) { return [...s].reverse().map(r => [...r]); }

function maskVariants(mask) { return [mask, rot90(mask), rot180(mask), rot270(mask), flipH(mask), flipV(mask), flipH(rot90(mask)), flipV(rot90(mask))]; }
function eqMask(a, b) {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) { if (a[r].length !== b[r].length) return false; for (let c = 0; c < a[r].length; c++) if (!!a[r][c] !== !!b[r][c]) return false; }
  return true;
}
function sameMask(a, b) { return maskVariants(a.mask).some(v => eqMask(v, b.mask)); }

function objSimilarity(a, b) {
  let s = 0;
  if (a.area === b.area) s += 2;
  if (a.width === b.width && a.height === b.height) s += 2;
  if (sameMask(a, b)) s += 4;
  if (a.color === b.color) s += 1;
  return s;
}

function bestMatch(src, candidates) {
  let best = null, bestS = -1;
  for (const c of candidates) { const s = objSimilarity(src, c); if (s > bestS) { bestS = s; best = c; } }
  return bestS >= 4 ? best : null;
}

// ── Relations ───────────────────────────────────────────────────────────

const DIR_RELS = new Set(["above", "below", "leftOf", "rightOf", "inside", "contains"]);
const SYM_RELS = new Set(["sameColor", "sameShape", "alignedRow", "alignedCol", "touching"]);

function containsBBox(a, b) {
  return a.bbox.mnR <= b.bbox.mnR && a.bbox.mxR >= b.bbox.mxR && a.bbox.mnC <= b.bbox.mnC && a.bbox.mxC >= b.bbox.mxC;
}

function computeRels(objs) {
  const rels = [];
  for (let i = 0; i < objs.length; i++) for (let j = 0; j < objs.length; j++) {
    if (i === j) continue;
    const a = objs[i], b = objs[j];
    if (a.center.r < b.center.r) rels.push({ type: "above", a: a.id, b: b.id });
    if (a.center.r > b.center.r) rels.push({ type: "below", a: a.id, b: b.id });
    if (a.center.c < b.center.c) rels.push({ type: "leftOf", a: a.id, b: b.id });
    if (a.center.c > b.center.c) rels.push({ type: "rightOf", a: a.id, b: b.id });
    if (containsBBox(b, a)) rels.push({ type: "inside", a: a.id, b: b.id });
    if (containsBBox(a, b)) rels.push({ type: "contains", a: a.id, b: b.id });
    if (i < j) {
      if (a.color === b.color && a.color >= 0) rels.push({ type: "sameColor", a: a.id, b: b.id });
      if (sameMask(a, b)) rels.push({ type: "sameShape", a: a.id, b: b.id });
      if (a.center.r === b.center.r) rels.push({ type: "alignedRow", a: a.id, b: b.id });
      if (a.center.c === b.center.c) rels.push({ type: "alignedCol", a: a.id, b: b.id });
      const touching = a.cells.some(ac => b.cells.some(bc => Math.abs(ac.r - bc.r) + Math.abs(ac.c - bc.c) === 1));
      if (touching) rels.push({ type: "touching", a: a.id, b: b.id });
    }
  }
  return rels;
}

// ── Object Correspondence (input → output tracking) ─────────────────────

function trackObjects(inObjs, outObjs) {
  const best = { score: -Infinity, pairs: [] };
  const rec = (idx, used, pairs, total) => {
    if (idx >= inObjs.length) {
      if (total > best.score) { best.score = total; best.pairs = pairs; }
      return;
    }
    const inO = inObjs[idx];
    rec(idx + 1, used, [...pairs, { in: inO, out: null, sim: 0 }], total);
    for (let oi = 0; oi < outObjs.length; oi++) {
      if (used.has(oi)) continue;
      const sim = objSimilarity(inO, outObjs[oi]);
      if (sim < 2) continue;
      const nextUsed = new Set(used); nextUsed.add(oi);
      rec(idx + 1, nextUsed, [...pairs, { in: inO, out: outObjs[oi], sim }], total + sim);
    }
  };
  rec(0, new Set(), [], 0);
  const usedOut = new Set(best.pairs.filter(m => m.out).map(m => m.out.id));
  return { matches: best.pairs, added: outObjs.filter(o => !usedOut.has(o.id)) };
}

// ── Selectors (grid-aware, relational) ──────────────────────────────────

function selectObjs(objects, sel, grid, allObjs) {
  if (!objects.length) return [];
  const R = grid?.length || 0, C = grid?.[0]?.length || 0;
  switch (sel.type) {
    case "all": return [...objects];
    case "largest": return [objects.reduce((a, b) => a.area >= b.area ? a : b)];
    case "smallest": return [objects.reduce((a, b) => a.area <= b.area ? a : b)];
    case "color": return objects.filter(o => o.color === sel.color);
    case "uniqueColor": { const cc = {}; objects.forEach(o => { cc[o.color] = (cc[o.color] || 0) + 1; }); return objects.filter(o => cc[o.color] === 1); }
    case "touchesBorder": return objects.filter(o => o.cells.some(({ r, c }) => r === 0 || c === 0 || r === R - 1 || c === C - 1));
    case "notTouchesBorder": return objects.filter(o => !o.cells.some(({ r, c }) => r === 0 || c === 0 || r === R - 1 || c === C - 1));
    case "topmost": return [objects.reduce((a, b) => a.bbox.mnR <= b.bbox.mnR ? a : b)];
    case "bottommost": return [objects.reduce((a, b) => a.bbox.mxR >= b.bbox.mxR ? a : b)];
    case "leftmost": return [objects.reduce((a, b) => a.bbox.mnC <= b.bbox.mnC ? a : b)];
    case "rightmost": return [objects.reduce((a, b) => a.bbox.mxC >= b.bbox.mxC ? a : b)];
    // Relational selectors
    case "relatedTo": {
      const targets = selectObjs(allObjs || objects, sel.target, grid, allObjs);
      if (!targets.length) return [];
      const targetIds = new Set(targets.map(t => t.id));
      const rels = computeRels(objects.concat(targets.filter(t => !objects.find(o => o.id === t.id))));
      return objects.filter(o => {
        if (targetIds.has(o.id)) return false;
        return rels.some(r => {
          if (r.type !== sel.relation) return false;
          if (DIR_RELS.has(sel.relation)) return r.a === o.id && targetIds.has(r.b);
          return (r.a === o.id && targetIds.has(r.b)) || (r.b === o.id && targetIds.has(r.a));
        });
      });
    }
    default: return [...objects];
  }
}

// ── AST Execution ───────────────────────────────────────────────────────

// Abstract drawing rules
const CORE_SELECTORS = [{ type: "largest" }, { type: "smallest" }, { type: "uniqueColor" }, { type: "touchesBorder" }, { type: "notTouchesBorder" }, { type: "topmost" }, { type: "bottommost" }, { type: "leftmost" }, { type: "rightmost" }];

function selectorName(sel) {
  if (!sel) return "all";
  if (sel.type === "color") return `color${sel.color}`;
  if (sel.type === "relatedTo") return `${sel.relation}(${selectorName(sel.target)})`;
  return sel.type || "all";
}

function oneObj(rule, grid, objects) {
  const sel = rule?.selector ? selectObjs(objects, rule.selector, grid, objects) : [];
  return sel.length === 1 ? sel[0] : null;
}

function twoObjs(rule, grid, objects) {
  const selA = selectObjs(objects, rule?.selectorA || { type: "leftmost" }, grid, objects);
  const selB = selectObjs(objects, rule?.selectorB || { type: "rightmost" }, grid, objects);
  if (selA.length !== 1 || selB.length !== 1 || selA[0].id === selB[0].id) return null;
  return [selA[0], selB[0]];
}

function resolveRow(rule, grid, objects = findObjs(grid)) {
  const R = grid.length;
  switch (rule?.kind) {
    case "absolute": return rule.value;
    case "middleRow": return Math.floor((R - 1) / 2);
    case "objectCenterRow": { const obj = oneObj(rule, grid, objects); return obj ? obj.center.r : null; }
    case "betweenObjectsRow": {
      const pair = twoObjs(rule, grid, objects); if (!pair) return null;
      const v = (pair[0].center.r + pair[1].center.r) / 2;
      return Number.isInteger(v) ? v : null;
    }
    default: return null;
  }
}

function resolveCol(rule, grid, objects = findObjs(grid)) {
  const C = grid[0]?.length || 0;
  switch (rule?.kind) {
    case "absolute": return rule.value;
    case "middleCol": return Math.floor((C - 1) / 2);
    case "objectCenterCol": { const obj = oneObj(rule, grid, objects); return obj ? obj.center.c : null; }
    case "betweenObjectsCol": {
      const pair = twoObjs(rule, grid, objects); if (!pair) return null;
      const v = (pair[0].center.c + pair[1].center.c) / 2;
      return Number.isInteger(v) ? v : null;
    }
    default: return null;
  }
}

function sortedPairByAxis(pair, axis) {
  const [a, b] = pair;
  return axis === "h"
    ? (a.center.c <= b.center.c ? [a, b] : [b, a])
    : (a.center.r <= b.center.r ? [a, b] : [b, a]);
}

function resolveRange(rule, grid, objects = findObjs(grid), axis = "h") {
  const R = grid.length, C = grid[0]?.length || 0;
  switch (rule?.kind) {
    case "absolute": return { a: rule.from, b: rule.to };
    case "fullWidth": return { a: 0, b: C - 1 };
    case "fullHeight": return { a: 0, b: R - 1 };
    case "objectSpanCols": { const obj = oneObj(rule, grid, objects); return obj ? { a: obj.bbox.mnC, b: obj.bbox.mxC } : null; }
    case "objectSpanRows": { const obj = oneObj(rule, grid, objects); return obj ? { a: obj.bbox.mnR, b: obj.bbox.mxR } : null; }
    case "betweenObjectsCols": {
      const pair = twoObjs(rule, grid, objects); if (!pair) return null;
      const [left, right] = sortedPairByAxis(pair, "h");
      return { a: left.bbox.mxC + 1, b: right.bbox.mnC - 1 };
    }
    case "betweenObjectsRows": {
      const pair = twoObjs(rule, grid, objects); if (!pair) return null;
      const [top, bottom] = sortedPairByAxis(pair, "v");
      return { a: top.bbox.mxR + 1, b: bottom.bbox.mnR - 1 };
    }
    default: return null;
  }
}

function resolveColor(rule, input, outputDiff = null, objects = findObjs(input)) {
  switch (rule?.kind) {
    case "constant": return rule.color;
    case "changedColor": {
      const colors = new Set((outputDiff?.changes || []).map(c => c.to));
      return colors.size === 1 ? [...colors][0] : null;
    }
    case "objectColor": { const obj = oneObj(rule, input, objects); return obj ? obj.color : null; }
    case "background": return detectBg(input);
    default: return null;
  }
}

function ruleName(rule) {
  switch (rule?.kind) {
    case "absolute": return rule.value !== undefined ? `${rule.value}` : `${rule.from}-${rule.to}`;
    case "middleRow": return "middle row";
    case "middleCol": return "middle column";
    case "fullWidth": return "full width";
    case "fullHeight": return "full height";
    case "objectCenterRow": return `${selectorName(rule.selector)} center row`;
    case "objectCenterCol": return `${selectorName(rule.selector)} center column`;
    case "objectSpanCols": return `${selectorName(rule.selector)} width`;
    case "objectSpanRows": return `${selectorName(rule.selector)} height`;
    case "betweenObjectsRow": return `between ${selectorName(rule.selectorA)} and ${selectorName(rule.selectorB)} rows`;
    case "betweenObjectsCol": return `between ${selectorName(rule.selectorA)} and ${selectorName(rule.selectorB)} columns`;
    case "betweenObjectsCols": return `between ${selectorName(rule.selectorA)} and ${selectorName(rule.selectorB)}`;
    case "betweenObjectsRows": return `between ${selectorName(rule.selectorA)} and ${selectorName(rule.selectorB)}`;
    case "constant": return `${rule.color}`;
    case "changedColor": return "changed color";
    case "objectColor": return `${selectorName(rule.selector)} color`;
    case "background": return "background";
    default: return "?";
  }
}

function ruleIsLiteral(rule) {
  return !rule || rule.kind === "absolute" || rule.kind === "constant";
}

function ruleCost(rule) {
  switch (rule?.kind) {
    case "objectCenterRow": case "objectCenterCol": case "betweenObjectsCols": case "betweenObjectsRows": case "objectColor": return 0;
    case "middleRow": case "middleCol": case "fullWidth": case "fullHeight": case "objectSpanCols": case "objectSpanRows": return 0.08;
    case "betweenObjectsRow": case "betweenObjectsCol": return 0.05;
    case "constant": return 0.12;
    case "absolute": return 0.25;
    default: return 0.2;
  }
}

function drawingIsAbstract(ast) {
  if (ast.type !== "drawLine") return false;
  const pos = ast.axis === "h" ? ast.rowRule : ast.colRule;
  return !ruleIsLiteral(pos) || !ruleIsLiteral(ast.rangeRule) || !ruleIsLiteral(ast.colorRule);
}

function exec(node, grid) {
  if (!node) return clone(grid);
  switch (node.type) {
    case "identity": return clone(grid);
    case "primitive": return PRIMS[node.name] ? PRIMS[node.name](grid, ...(node.args || [])) : clone(grid);
    case "sequence": return (node.steps || []).reduce((g, s) => exec(s, g), grid);
    case "objectOp": {
      const bg = detectBg(grid);
      const objs = findObjs(grid, bg);
      const sel = selectObjs(objs, node.selector || { type: "all" }, grid, objs);
      if (node.op?.type === "extract") {
        if (sel.length !== 1) return clone(grid);
        return sel[0].shape;
      }
      return applyOp(clone(grid), sel, node.op, bg);
    }
    case "mapObjects": {
      const bg = detectBg(grid);
      const objs = findObjs(grid, bg);
      const sel = selectObjs(objs, node.selector || { type: "all" }, grid, objs);
      let g = clone(grid);
      for (const obj of sel) g = applyOp(g, [obj], node.op, bg);
      return g;
    }
    case "applyUntilStable": {
      let g = clone(grid), prev = null, iters = 0;
      while (!eq(g, prev) && iters < 20) { prev = clone(g); g = exec(node.body, g); iters++; }
      return g;
    }
    case "drawLine": {
      const ng = clone(grid), objs = findObjs(grid);
      const color = resolveColor(node.colorRule, grid, null, objs);
      const range = resolveRange(node.rangeRule, grid, objs, node.axis);
      if (color === null || !range || range.a > range.b) return ng;
      if (node.axis === "h") {
        const row = resolveRow(node.rowRule, grid, objs);
        if (row >= 0 && row < ng.length) for (let c = Math.max(0, range.a); c <= Math.min((ng[0]?.length || 0) - 1, range.b); c++) ng[row][c] = color;
      } else {
        const col = resolveCol(node.colRule, grid, objs);
        if (col >= 0 && col < (ng[0]?.length || 0)) for (let r = Math.max(0, range.a); r <= Math.min(ng.length - 1, range.b); r++) ng[r][col] = color;
      }
      return ng;
    }
    case "drawHLine": {
      const ng = clone(grid);
      const { row, c1, c2, color } = node;
      if (row >= 0 && row < ng.length) for (let c = Math.max(0, c1); c <= Math.min((ng[0]?.length || 0) - 1, c2); c++) ng[row][c] = color;
      return ng;
    }
    case "drawVLine": {
      const ng = clone(grid);
      const { col, r1, r2, color } = node;
      if (col >= 0 && col < (ng[0]?.length || 0)) for (let r = Math.max(0, r1); r <= Math.min(ng.length - 1, r2); r++) ng[r][col] = color;
      return ng;
    }
    default: return clone(grid);
  }
}

function applyOp(g, objs, op, bg) {
  if (!op || !objs.length) return g;
  for (const obj of objs) {
    switch (op.type) {
      case "recolor": for (const { r, c } of obj.cells) g[r][c] = op.color; break;
      case "delete": for (const { r, c } of obj.cells) g[r][c] = bg; break;
      case "move": {
        const vals = obj.cells.map(({ r, c }) => ({ r, c, v: g[r][c] }));
        for (const { r, c } of obj.cells) g[r][c] = bg;
        for (const { r, c, v } of vals) { const nr = r + (op.dr || 0), nc = c + (op.dc || 0); if (nr >= 0 && nr < g.length && nc >= 0 && nc < g[0].length) g[nr][nc] = v; }
        break;
      }
      case "copy": {
        for (const { r, c } of obj.cells) {
          const nr = r + (op.dr || 0), nc = c + (op.dc || 0);
          if (nr >= 0 && nr < g.length && nc >= 0 && nc < g[0].length) g[nr][nc] = g[r][c];
        }
        break;
      }
      case "transform": {
        const shape = transformShape(obj.shape, op.mode);
        if (!shape) break;
        for (const { r, c } of obj.cells) g[r][c] = bg;
        for (let rr = 0; rr < shape.length; rr++) for (let cc = 0; cc < (shape[0]?.length || 0); cc++) {
          if (shape[rr][cc] === 0) continue;
          const nr = obj.bbox.mnR + rr, nc = obj.bbox.mnC + cc;
          if (nr >= 0 && nr < g.length && nc >= 0 && nc < g[0].length) g[nr][nc] = shape[rr][cc];
        }
        break;
      }
    }
  }
  return g;
}

function transformShape(shape, mode) {
  if (mode === "rotate90") return rot90(shape);
  if (mode === "rotate180") return rot180(shape);
  if (mode === "rotate270") return rot270(shape);
  if (mode === "flipH") return flipH(shape);
  if (mode === "flipV") return flipV(shape);
  return null;
}

function explain(node) {
  if (!node) return "noop";
  switch (node.type) {
    case "identity": return "identity";
    case "primitive": return `${node.name}${node.args?.length ? `(${node.args.map(a => typeof a === "object" ? JSON.stringify(a) : a).join(",")})` : ""}`;
    case "sequence": return (node.steps || []).map(explain).join(" → ");
    case "objectOp": return `select(${node.selector?.type || "all"}).${node.op?.type || "?"}${opArgs(node.op)}`;
    case "mapObjects": return `map(${node.selector?.type || "all"}).${node.op?.type || "?"}${opArgs(node.op)}`;
    case "applyUntilStable": return `repeat(${explain(node.body)})`;
    case "drawLine": return node.axis === "h"
      ? `drawH(row:${ruleName(node.rowRule)}, range:${ruleName(node.rangeRule)}, color:${ruleName(node.colorRule)}, ${drawingIsAbstract(node) ? "abstract" : "literal"})`
      : `drawV(col:${ruleName(node.colRule)}, range:${ruleName(node.rangeRule)}, color:${ruleName(node.colorRule)}, ${drawingIsAbstract(node) ? "abstract" : "literal"})`;
    case "drawHLine": return `hline(r${node.row},${node.c1}-${node.c2},c${node.color})`;
    case "drawVLine": return `vline(c${node.col},${node.r1}-${node.r2},c${node.color})`;
    default: return "?";
  }
}
function opArgs(op) {
  if (!op) return "";
  if (op.color !== undefined) return `(${op.color})`;
  if (op.mode !== undefined) return `(${op.mode})`;
  if (op.dr !== undefined) return `(${op.dr},${op.dc})`;
  return "";
}

function complexity(node) {
  if (!node) return 0;
  switch (node.type) {
    case "identity": return 0;
    case "primitive": return 1 + (node.args?.length || 0) * 0.2;
    case "sequence": return (node.steps || []).reduce((s, n) => s + complexity(n), 0);
    case "objectOp": case "mapObjects": return 1.5 + (node.op?.type === "move" ? 0.5 : 0) + (node.op?.type === "transform" ? 0.35 : 0) + (node.selector?.type === "relatedTo" ? 0.5 : 0);
    case "applyUntilStable": return 1 + complexity(node.body);
    case "drawLine": {
      const pos = node.axis === "h" ? node.rowRule : node.colRule;
      return 1.1 + ruleCost(pos) + ruleCost(node.rangeRule) + ruleCost(node.colorRule) + (ruleIsLiteral(pos) ? 0.45 : 0) + (ruleIsLiteral(node.rangeRule) ? 0.35 : 0) + (ruleIsLiteral(node.colorRule) ? 0.15 : 0);
    }
    case "drawHLine": case "drawVLine": return 1.8;
    default: return 1;
  }
}

function specPenalty(ast) {
  const n = explain(ast);
  if (n.includes("fillBg")) return 1.5;
  if (n.includes("fillEnclosed")) return 0.8;
  if (n.includes("tileRows")) return 2.4;
  if (n.includes("colorSub")) return 0.5;
  if (n.includes("Symmetry")) return 0.6;
  return 0;
}

const pN = (name, ...args) => ({ type: "primitive", name, args });
const seq = (...steps) => { const f = steps.flatMap(s => s.type === "sequence" ? s.steps : [s]); return f.length === 1 ? f[0] : { type: "sequence", steps: f }; };
const objOp = (selector, op) => ({ type: "objectOp", selector, op });
const mapOp = (selector, op) => ({ type: "mapObjects", selector, op });

function primitiveBg(grid, bgOverride = null) {
  if (bgOverride !== null) return bgOverride;
  return grid.some(row => row.includes(0)) ? 0 : detectBg(grid);
}

function recolorAllNonBg(grid, color, bgOverride = null) {
  const bg = primitiveBg(grid, bgOverride);
  return grid.map(row => row.map(v => v === bg ? bg : color));
}

function cornerOrder(corner, R, C) {
  const rows = corner.startsWith("bottom") ? [...Array(R).keys()].reverse() : [...Array(R).keys()];
  const cols = corner.endsWith("right") ? [...Array(C).keys()].reverse() : [...Array(C).keys()];
  return rows.flatMap(r => cols.map(c => ({ r, c })));
}

function compactCorner(grid, corner = "top-left", bgOverride = null) {
  const bg = primitiveBg(grid, bgOverride), R = grid.length, C = grid[0]?.length || 0;
  const cells = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (grid[r][c] !== bg) cells.push({ r, c, value: grid[r][c] });
  const rowSign = corner.startsWith("bottom") ? -1 : 1;
  const colSign = corner.endsWith("right") ? -1 : 1;
  cells.sort((a, b) => rowSign * (a.r - b.r) || colSign * (a.c - b.c));
  const out = Array.from({ length: R }, () => Array(C).fill(bg));
  const slots = cornerOrder(corner, R, C);
  cells.forEach((cell, index) => {
    const slot = slots[index];
    if (slot) out[slot.r][slot.c] = cell.value;
  });
  return out;
}

function detectTile(grid) {
  const R = grid.length, C = grid[0]?.length || 0;
  for (let th = 1; th <= R; th++) {
    if (R % th !== 0) continue;
    for (let tw = 1; tw <= C; tw++) {
      if (C % tw !== 0 || (th === R && tw === C)) continue;
      let ok = true;
      for (let r = 0; r < R && ok; r++) for (let c = 0; c < C && ok; c++) if (grid[r][c] !== grid[r % th][c % tw]) ok = false;
      if (ok) return grid.slice(0, th).map(row => row.slice(0, tw));
    }
  }
  return null;
}

function tileRows(grid, bgOverride = null) {
  const bg = primitiveBg(grid, bgOverride);
  const nonEmptyRows = grid.map((row, index) => row.some(v => v !== bg) ? index : -1).filter(index => index >= 0);
  if (!nonEmptyRows.length) return clone(grid);
  const start = nonEmptyRows[0];
  let end = start;
  while (end + 1 < grid.length && grid[end + 1].some(v => v !== bg)) end++;
  const pattern = grid.slice(start, end + 1);
  return Array.from({ length: grid.length }, (_, r) => [...pattern[r % pattern.length]]);
}

function dilate(grid, diagonal = false, bgOverride = null) {
  const bg = primitiveBg(grid, bgOverride), R = grid.length, C = grid[0]?.length || 0;
  const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const dirs8 = [...dirs4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const out = clone(grid);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (grid[r][c] === bg) continue;
    for (const [dr, dc] of diagonal ? dirs8 : dirs4) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < R && nc >= 0 && nc < C && out[nr][nc] === bg) out[nr][nc] = grid[r][c];
    }
  }
  return out;
}

function countDistinctColors(grid, bgOverride = null) {
  const bg = primitiveBg(grid, bgOverride);
  const colors = new Set();
  for (const row of grid) for (const v of row) if (v !== bg) colors.add(v);
  return [[colors.size]];
}

function countNonBgCells(grid, bgOverride = null) {
  const bg = primitiveBg(grid, bgOverride);
  let count = 0;
  for (const row of grid) for (const v of row) if (v !== bg) count++;
  return [[count]];
}

function neighborCount(grid, diagonal = true, bgOverride = null) {
  const bg = primitiveBg(grid, bgOverride), R = grid.length, C = grid[0]?.length || 0;
  const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const dirs8 = [...dirs4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const dirs = diagonal ? dirs8 : dirs4;
  return grid.map((row, r) => row.map((_, c) => dirs.reduce((count, [dr, dc]) => {
    const nr = r + dr, nc = c + dc;
    return count + (nr >= 0 && nr < R && nc >= 0 && nc < C && grid[nr][nc] !== bg ? 1 : 0);
  }, 0)));
}

function completeRotSym(grid) {
  const R = grid.length, C = grid[0]?.length || 0;
  if (R !== C) return clone(grid);
  const bg = primitiveBg(grid), out = clone(grid), seen = new Set();
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const orbit = [[r, c], [c, C - 1 - r], [R - 1 - r, C - 1 - c], [R - 1 - c, r]];
    const key = orbit.map(([or, oc]) => `${or},${oc}`).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const values = [...new Set(orbit.map(([or, oc]) => grid[or][oc]).filter(v => v !== bg))];
    if (values.length !== 1) continue;
    for (const [or, oc] of orbit) if (out[or][oc] === bg) out[or][oc] = values[0];
  }
  return out;
}

// ── Primitives (background-aware) ───────────────────────────────────────

function recolorByRank(grid, property = "area", order = "asc", bgOverride = null) {
  const bg = primitiveBg(grid, bgOverride);
  const objs = findObjs(grid, bg);
  const out = clone(grid).map(row => row.map(v => v === bg ? bg : 0));
  const sign = order === "desc" ? -1 : 1;
  const valueFor = obj => property === "top" ? obj.bbox.mnR : property === "left" ? obj.bbox.mnC : obj.area;
  const sorted = [...objs].sort((a, b) => sign * (valueFor(a) - valueFor(b)) || a.bbox.mnR - b.bbox.mnR || a.bbox.mnC - b.bbox.mnC);
  sorted.forEach((obj, index) => {
    const color = Math.min(9, index + 1);
    for (const { r, c } of obj.cells) out[r][c] = color;
  });
  return out;
}

const PRIMS = {
  rotate90: g => rot90(g),
  rotate180: g => rot180(g),
  rotate270: g => rot270(g),
  flipH: g => flipH(g),
  flipV: g => flipV(g),
  transpose: g => { const R = g.length, C = g[0]?.length || 0; return Array.from({ length: C }, (_, c) => Array.from({ length: R }, (_, r) => g[r][c])); },
  identity: g => clone(g),
  colorSub: (g, map) => typeof map !== "object" ? clone(g) : g.map(r => r.map(c => map[c] !== undefined ? Number(map[c]) : c)),
  recolorAllNonBg,
  tile: (g, tr, tc) => { const R = g.length, C = g[0]?.length || 0; return Array.from({ length: R * tr }, (_, r) => Array.from({ length: C * tc }, (_, c) => g[r % R][c % C])); },
  extractTile: g => detectTile(g) || clone(g),
  tileRows,
  compactCorner,
  dilate4: g => dilate(g, false),
  dilate8: g => dilate(g, true),
  countDistinctColors,
  countNonBgCells,
  countObjects: g => [[findObjs(g, primitiveBg(g)).length]],
  neighborCount4: g => neighborCount(g, false),
  neighborCount8: g => neighborCount(g, true),
  recolorByRank,
  gravityDown: g => { const bg = detectBg(g), R = g.length, C = g[0]?.length || 0, ng = clone(g); for (let c = 0; c < C; c++) { const col = []; for (let r = 0; r < R; r++) if (ng[r][c] !== bg) col.push(ng[r][c]); for (let r = 0; r < R; r++) ng[r][c] = bg; for (let i = 0; i < col.length; i++) ng[R - col.length + i][c] = col[i]; } return ng; },
  gravityUp: g => { const bg = detectBg(g), R = g.length, C = g[0]?.length || 0, ng = clone(g); for (let c = 0; c < C; c++) { const col = []; for (let r = 0; r < R; r++) if (ng[r][c] !== bg) col.push(ng[r][c]); for (let r = 0; r < R; r++) ng[r][c] = r < col.length ? col[r] : bg; } return ng; },
  gravityLeft: g => { const bg = detectBg(g), R = g.length, C = g[0]?.length || 0, ng = clone(g); for (let r = 0; r < R; r++) { const cells = []; for (let c = 0; c < C; c++) if (ng[r][c] !== bg) cells.push(ng[r][c]); for (let c = 0; c < C; c++) ng[r][c] = c < cells.length ? cells[c] : bg; } return ng; },
  gravityRight: g => { const bg = detectBg(g), R = g.length, C = g[0]?.length || 0, ng = clone(g); for (let r = 0; r < R; r++) { const cells = []; for (let c = 0; c < C; c++) if (ng[r][c] !== bg) cells.push(ng[r][c]); for (let c = 0; c < C; c++) ng[r][c] = bg; for (let i = 0; i < cells.length; i++) ng[r][C - cells.length + i] = cells[i]; } return ng; },
  fillBg: (g, color) => { const bg = detectBg(g); return g.map(r => r.map(c => c === bg ? color : c)); },
  addBorder: (g, color) => { const R = g.length, C = g[0]?.length || 0; return Array.from({ length: R + 2 }, (_, r) => Array.from({ length: C + 2 }, (_, c) => (r === 0 || r === R + 1 || c === 0 || c === C + 1) ? color : g[r - 1][c - 1])); },
  cropBBox: g => { const bg = detectBg(g); let mnR = Infinity, mxR = -1, mnC = Infinity, mxC = -1; for (let r = 0; r < g.length; r++) for (let c = 0; c < g[0].length; c++) if (g[r][c] !== bg) { mnR = Math.min(mnR, r); mxR = Math.max(mxR, r); mnC = Math.min(mnC, c); mxC = Math.max(mxC, c); } if (mxR === -1) return [[0]]; return g.slice(mnR, mxR + 1).map(r => r.slice(mnC, mxC + 1)); },
  scale: (g, f) => { const R = g.length, C = g[0]?.length || 0; return Array.from({ length: R * f }, (_, r) => Array.from({ length: C * f }, (_, c) => g[Math.floor(r / f)][Math.floor(c / f)])); },
  fillEnclosed: (g, color, bgOverride = null) => {
    const R = g.length, C = g[0]?.length || 0, bg = bgOverride ?? detectBg(g);
    const ext = Array.from({ length: R }, () => Array(C).fill(false)), stk = [];
    for (let r = 0; r < R; r++) { if (g[r][0] === bg) stk.push([r, 0]); if (g[r][C - 1] === bg) stk.push([r, C - 1]); }
    for (let c = 0; c < C; c++) { if (g[0][c] === bg) stk.push([0, c]); if (g[R - 1][c] === bg) stk.push([R - 1, c]); }
    while (stk.length) { const [r, c] = stk.pop(); if (r < 0 || r >= R || c < 0 || c >= C || ext[r][c] || g[r][c] !== bg) continue; ext[r][c] = true; stk.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]); }
    const ng = clone(g); for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (ng[r][c] === bg && !ext[r][c]) ng[r][c] = color; return ng;
  },
  completeHSym: g => { const R = g.length, C = g[0]?.length || 0, ng = clone(g), bg = detectBg(g); for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { const mc = C - 1 - c; if (ng[r][c] === bg && ng[r][mc] !== bg) ng[r][c] = ng[r][mc]; else if (ng[r][mc] === bg && ng[r][c] !== bg) ng[r][mc] = ng[r][c]; } return ng; },
  completeVSym: g => { const R = g.length, C = g[0]?.length || 0, ng = clone(g), bg = detectBg(g); for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { const mr = R - 1 - r; if (ng[r][c] === bg && ng[mr][c] !== bg) ng[r][c] = ng[mr][c]; else if (ng[mr][c] === bg && ng[r][c] !== bg) ng[mr][c] = ng[r][c]; } return ng; },
  completeRotSym,
};

// ── Size Prediction ─────────────────────────────────────────────────────

function predSize(ast, sz) {
  if (!ast) return null;
  switch (ast.type) {
    case "identity": return sz;
    case "primitive": switch (ast.name) {
      case "rotate90": case "rotate270": case "transpose": return { rows: sz.cols, cols: sz.rows };
      case "rotate180": case "flipH": case "flipV": case "identity":
      case "gravityDown": case "gravityUp": case "gravityLeft": case "gravityRight":
      case "completeHSym": case "completeVSym": case "completeRotSym": case "colorSub": case "recolorAllNonBg":
      case "fillBg": case "fillEnclosed": case "tileRows": case "compactCorner": case "dilate4": case "dilate8":
      case "neighborCount4": case "neighborCount8": case "recolorByRank": return sz;
      case "countDistinctColors": case "countNonBgCells": case "countObjects": return { rows: 1, cols: 1 };
      case "scale": return ast.args?.[0] ? { rows: sz.rows * ast.args[0], cols: sz.cols * ast.args[0] } : null;
      case "tile": return ast.args?.length >= 2 ? { rows: sz.rows * ast.args[0], cols: sz.cols * ast.args[1] } : null;
      case "extractTile": return null;
      case "addBorder": return { rows: sz.rows + 2, cols: sz.cols + 2 };
      default: return null;
    }
    case "sequence": { let s = sz; for (const st of (ast.steps || [])) { s = predSize(st, s); if (!s) return null; } return s; }
    case "objectOp": return ast.op?.type === "extract" ? null : sz;
    case "mapObjects": return sz;
    case "drawLine": case "drawHLine": case "drawVLine": return sz;
    default: return null;
  }
}

// ── Cache ───────────────────────────────────────────────────────────────

let _cache = new Map();
function cached(ast, grid) {
  const k = JSON.stringify(ast) + "|" + grid.map(r => r.join("")).join("/");
  if (_cache.has(k)) return _cache.get(k);
  const out = exec(ast, grid);
  if (_cache.size > 4000) _cache.clear();
  _cache.set(k, out);
  return out;
}

// ── Structural MDL ──────────────────────────────────────────────────────

function score(ast, pairs, lib = null) {
  let totalPx = 0, allCorrect = true, structScore = 0;
  for (const { input, output } of pairs) {
    try {
      const pred = cached(ast, input);
      const px = pxSurprise(pred, output);
      totalPx += px;
      if (px > 0) allCorrect = false;
      // Structural: object count match
      const predObjs = findObjs(pred), outObjs = findObjs(output);
      if (predObjs.length !== outObjs.length) structScore += 0.3;
      // Color histogram distance
      const predH = colorHist(pred), outH = colorHist(output);
      const allColors = new Set([...Object.keys(predH), ...Object.keys(outH)]);
      let histDist = 0;
      for (const c of allColors) histDist += Math.abs((predH[c] || 0) - (outH[c] || 0));
      const totalCells = output.length * (output[0]?.length || 0);
      structScore += totalCells > 0 ? (histDist / totalCells) * 0.5 : 0;
    } catch { totalPx += 1; allCorrect = false; }
  }
  const avgPx = totalPx / pairs.length;
  const avgStruct = structScore / pairs.length;
  const comp = complexity(ast);
  const spec = specPenalty(ast);
  const name = explain(ast).split(" → ")[0].split("(")[0];
  const prior = lib ? lib.priorBonus(name) : 0;
  const mdl = avgPx * 80 + avgStruct * 20 + comp * 0.5 + spec + prior;
  return { avgPx, allCorrect, comp, mdl, avgStruct };
}

// ── Hypothesis Generation ───────────────────────────────────────────────

function inferChangedFromColor(pairs, toColor) {
  let bg = null;
  for (const { input, output } of pairs) {
    const d = diffGrid(input, output);
    if (d.type !== "same-size") return null;
    const relevant = d.changes.filter(ch => ch.to === toColor);
    if (!relevant.length) return null;
    for (const ch of relevant) {
      if (bg === null) bg = ch.from;
      else if (bg !== ch.from) return null;
    }
  }
  return bg;
}

function genWholeGrid(pairs) {
  const hyps = [], logs = [];
  const check = (ast, fn, expl) => {
    if (pairs.every(({ input, output }) => { try { return eq(fn(input), output); } catch { return false; } })) {
      hyps.push({ ast, trainingExact: true, explain: expl, source: "wholeGrid" });
      logs.push(`✓ ${expl}`);
    }
  };
  for (const [n, l] of [["rotate90", "Rotate 90°"], ["rotate180", "Rotate 180°"], ["rotate270", "Rotate 270°"], ["flipH", "Flip H"], ["flipV", "Flip V"], ["transpose", "Transpose"]])
    check(pN(n), PRIMS[n], l);
  const cMap = detectColorSub(pairs);
  if (cMap) check(pN("colorSub", cMap), g => PRIMS.colorSub(g, cMap), `Recolor: ${Object.entries(cMap).map(([a, b]) => `${a}→${b}`).join(",")}`);
  {
    const colors = new Set();
    for (const { output } of pairs) {
      const bg = detectBg(output);
      for (const row of output) for (const v of row) if (v !== bg) colors.add(v);
    }
    for (const color of colors) check(pN("recolorAllNonBg", color), g => PRIMS.recolorAllNonBg(g, color), `Recolor all non-bg→${color}`);
  }
  for (const { input, output } of pairs) {
    const ir = input.length, ic = input[0]?.length || 0, or_ = output.length, oc = output[0]?.length || 0;
    if (or_ > ir && oc > ic && or_ % ir === 0 && oc % ic === 0) { const tr = or_ / ir, tc = oc / ic; check(pN("tile", tr, tc), g => PRIMS.tile(g, tr, tc), `Tile ${tr}×${tc}`); }
    break;
  }
  for (const f of [2, 3, 4, 5]) check(pN("scale", f), g => PRIMS.scale(g, f), `Scale ${f}×`);
  check(pN("extractTile"), PRIMS.extractTile, "Extract repeating tile");
  check(pN("tileRows"), PRIMS.tileRows, "Tile row pattern");
  check(pN("cropBBox"), PRIMS.cropBBox, "Crop BBox");
  for (const d of ["Down", "Up", "Left", "Right"]) check(pN(`gravity${d}`), PRIMS[`gravity${d}`], `Gravity ${d}`);
  for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) check(pN("compactCorner", corner), g => PRIMS.compactCorner(g, corner), `Compact ${corner}`);
  check(pN("dilate4"), PRIMS.dilate4, "Dilate 4-neighbor");
  check(pN("dilate8"), PRIMS.dilate8, "Dilate 8-neighbor");
  check(pN("countDistinctColors"), PRIMS.countDistinctColors, "Count distinct colors");
  check(pN("countNonBgCells"), PRIMS.countNonBgCells, "Count non-bg cells");
  check(pN("countObjects"), PRIMS.countObjects, "Count objects");
  check(pN("neighborCount4"), PRIMS.neighborCount4, "Neighbor count 4");
  check(pN("neighborCount8"), PRIMS.neighborCount8, "Neighbor count 8");
  for (const property of ["area", "top", "left"]) for (const order of ["asc", "desc"]) {
    check(pN("recolorByRank", property, order), g => PRIMS.recolorByRank(g, property, order), `Recolor by ${property} rank ${order}`);
  }
  // Border (validated)
  { let ok = true, bc = null;
    for (const { input, output } of pairs) {
      const ir = input.length, ic = input[0]?.length || 0;
      if (output.length !== ir + 2 || output[0]?.length !== ic + 2) { ok = false; break; }
      for (let r = 0; r < ir; r++) for (let c = 0; c < ic; c++) if (output[r + 1][c + 1] !== input[r][c]) { ok = false; break; }
      if (!ok) break;
      const tb = output[0][0]; if (bc === null) bc = tb; if (bc !== tb) { ok = false; break; }
      for (let r = 0; r < output.length && ok; r++) for (let c = 0; c < output[0].length && ok; c++) { const isBd = r === 0 || r === output.length - 1 || c === 0 || c === output[0].length - 1; if (isBd && output[r][c] !== bc) ok = false; }
    }
    if (ok && bc !== null) check(pN("addBorder", bc), g => PRIMS.addBorder(g, bc), `Border(${bc})`);
  }
  // Fill enclosed
  for (const { input, output } of pairs) {
    const bg = detectBg(input); const cs = new Set();
    for (const row of output) for (const v of row) if (v !== bg) cs.add(v);
    for (const color of cs) {
      const inferredBg = inferChangedFromColor(pairs, color);
      check(pN("fillEnclosed", color), g => PRIMS.fillEnclosed(g, color), `FillEnclosed(${color})`);
      if (inferredBg !== null) check(pN("fillEnclosed", color, inferredBg), g => PRIMS.fillEnclosed(g, color, inferredBg), `FillEnclosed(${color}, bg=${inferredBg})`);
    }
    break;
  }
  // Fill background
  for (const { input, output } of pairs) {
    const bg = detectBg(input); let fc = null, ok2 = true;
    for (let r = 0; r < input.length && ok2; r++) for (let c = 0; c < (input[0]?.length || 0) && ok2; c++) {
      if (input[r][c] === bg && output[r]?.[c] !== bg) { if (fc === null) fc = output[r][c]; else if (output[r][c] !== fc) ok2 = false; }
      else if (input[r][c] !== output[r]?.[c]) ok2 = false;
    }
    if (ok2 && fc !== null) check(pN("fillBg", fc), g => PRIMS.fillBg(g, fc), `FillBg(${fc})`);
    break;
  }
  for (const [n, l] of [["completeHSym", "H-Symmetry"], ["completeVSym", "V-Symmetry"], ["completeRotSym", "Rotational Symmetry"]]) check(pN(n), PRIMS[n], `Complete ${l}`);
  return { hyps, logs };
}

function genObjectHyps(pairs) {
  const hyps = [], logs = [];
  const sels = CORE_SELECTORS;
  const tryAST = (ast, expl) => {
    if (pairs.every(({ input, output }) => { try { return eq(exec(ast, input), output); } catch { return false; } })) {
      hyps.push({ ast, trainingExact: true, explain: expl, source: "objectHypothesis" }); logs.push(`✓ Obj: ${expl}`);
    }
  };
  // Extract via objectOp
  for (const sel of sels) tryAST(objOp(sel, { type: "extract" }), `Extract ${sel.type}`);
  // Delete
  for (const sel of sels) tryAST(objOp(sel, { type: "delete" }), `Delete ${sel.type}`);
  // Recolor
  for (const sel of sels) {
    const outColors = new Set(); for (const { output } of pairs) for (const row of output) for (const v of row) outColors.add(v);
    for (const color of outColors) tryAST(objOp(sel, { type: "recolor", color }), `Recolor ${sel.type}→${color}`);
  }
  // Rotate or flip the selected object's local shape in place.
  for (const sel of sels) {
    for (const mode of ["rotate90", "rotate180", "rotate270", "flipH", "flipV"]) {
      tryAST(objOp(sel, { type: "transform", mode }), `Transform ${sel.type} ${mode}`);
    }
  }
  // Move by consistent delta (using similarity matching)
  for (const sel of sels) {
    try {
      const deltas = [];
      for (const { input, output } of pairs) {
        const bg = detectBg(input);
        const inOs = findObjs(input, bg), outOs = findObjs(output, detectBg(output));
        const selIn = selectObjs(inOs, sel, input, inOs);
        if (selIn.length !== 1) { deltas.push(null); continue; }
        const match = bestMatch(selIn[0], outOs);
        if (!match) { deltas.push(null); continue; }
        deltas.push({ dr: match.center.r - selIn[0].center.r, dc: match.center.c - selIn[0].center.c });
      }
      if (deltas.every(d => d && d.dr === deltas[0].dr && d.dc === deltas[0].dc) && (deltas[0].dr !== 0 || deltas[0].dc !== 0)) {
        const { dr, dc } = deltas[0];
        tryAST(objOp(sel, { type: "move", dr, dc }), `Move ${sel.type} by (${dr},${dc})`);
      }
    } catch { /**/ }
  }
  // Copy by consistent delta
  for (const sel of sels) {
    try {
      const deltas = [];
      for (const { input, output } of pairs) {
        const bg = detectBg(input);
        const inOs = findObjs(input, bg), outOs = findObjs(output, detectBg(output));
        const selIn = selectObjs(inOs, sel, input, inOs);
        if (selIn.length !== 1) { deltas.push(null); continue; }
        const { added } = trackObjects(inOs, outOs);
        const copyTarget = added.length > 0 ? bestMatch(selIn[0], added) : null;
        if (!copyTarget) { deltas.push(null); continue; }
        deltas.push({ dr: copyTarget.center.r - selIn[0].center.r, dc: copyTarget.center.c - selIn[0].center.c });
      }
      if (deltas.every(d => d && d.dr === deltas[0].dr && d.dc === deltas[0].dc) && (deltas[0].dr !== 0 || deltas[0].dc !== 0)) {
        const { dr, dc } = deltas[0];
        tryAST(objOp(sel, { type: "copy", dr, dc }), `Copy ${sel.type} by (${dr},${dc})`);
      }
    } catch { /**/ }
  }
  return { hyps, logs };
}

function uniqRules(rules) {
  const seen = new Set(), out = [];
  for (const r of rules) {
    const k = JSON.stringify(r);
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
}

function lineInfoForPairs(pairs, axis) {
  const lines = [];
  for (const { input, output } of pairs) {
    const d = diffGrid(input, output);
    if (d.type !== "same-size") return null;
    const tags = analyzeDiff(d.changes);
    const line = tags.find(t => t.tag === (axis === "h" ? "h-line" : "v-line"));
    if (!line) return null;
    lines.push(line);
  }
  return lines;
}

function inferPositionRules(pairs, lines, axis) {
  const rules = [];
  const first = axis === "h" ? lines[0].row : lines[0].col;
  rules.push({ kind: "absolute", value: first });
  if (pairs.every(({ input }, i) => axis === "h" ? lines[i].row === Math.floor((input.length - 1) / 2) : lines[i].col === Math.floor(((input[0]?.length || 0) - 1) / 2)))
    rules.push({ kind: axis === "h" ? "middleRow" : "middleCol" });
  for (const selector of CORE_SELECTORS) {
    if (pairs.every(({ input }, i) => {
      const objs = findObjs(input);
      const sel = selectObjs(objs, selector, input, objs);
      return sel.length === 1 && (axis === "h" ? sel[0].center.r === lines[i].row : sel[0].center.c === lines[i].col);
    })) rules.push({ kind: axis === "h" ? "objectCenterRow" : "objectCenterCol", selector });
  }
  const pairsOfSelectors = [[{ type: "topmost" }, { type: "bottommost" }], [{ type: "leftmost" }, { type: "rightmost" }], [{ type: "largest" }, { type: "smallest" }]];
  for (const [selectorA, selectorB] of pairsOfSelectors) {
    if (pairs.every(({ input }, i) => {
      const objs = findObjs(input);
      const pair = twoObjs({ selectorA, selectorB }, input, objs);
      if (!pair) return false;
      const v = axis === "h" ? (pair[0].center.r + pair[1].center.r) / 2 : (pair[0].center.c + pair[1].center.c) / 2;
      return Number.isInteger(v) && v === (axis === "h" ? lines[i].row : lines[i].col);
    })) rules.push({ kind: axis === "h" ? "betweenObjectsRow" : "betweenObjectsCol", selectorA, selectorB });
  }
  return uniqRules(rules);
}

function inferRangeRules(pairs, lines, axis) {
  const rules = [];
  if (axis === "h") {
    rules.push({ kind: "absolute", from: lines[0].minC, to: lines[0].maxC });
    if (pairs.every(({ input }, i) => lines[i].minC === 0 && lines[i].maxC === (input[0]?.length || 0) - 1)) rules.push({ kind: "fullWidth" });
    for (const selector of CORE_SELECTORS) {
      if (pairs.every(({ input }, i) => {
        const objs = findObjs(input), sel = selectObjs(objs, selector, input, objs);
        return sel.length === 1 && sel[0].bbox.mnC === lines[i].minC && sel[0].bbox.mxC === lines[i].maxC;
      })) rules.push({ kind: "objectSpanCols", selector });
    }
    for (const [selectorA, selectorB] of [[{ type: "leftmost" }, { type: "rightmost" }], [{ type: "largest" }, { type: "smallest" }]]) {
      if (pairs.every(({ input }, i) => {
        const objs = findObjs(input), pair = twoObjs({ selectorA, selectorB }, input, objs);
        if (!pair) return false;
        const range = resolveRange({ kind: "betweenObjectsCols", selectorA, selectorB }, input, objs, "h");
        return range && range.a === lines[i].minC && range.b === lines[i].maxC;
      })) rules.push({ kind: "betweenObjectsCols", selectorA, selectorB });
    }
  } else {
    rules.push({ kind: "absolute", from: lines[0].minR, to: lines[0].maxR });
    if (pairs.every(({ input }, i) => lines[i].minR === 0 && lines[i].maxR === input.length - 1)) rules.push({ kind: "fullHeight" });
    for (const selector of CORE_SELECTORS) {
      if (pairs.every(({ input }, i) => {
        const objs = findObjs(input), sel = selectObjs(objs, selector, input, objs);
        return sel.length === 1 && sel[0].bbox.mnR === lines[i].minR && sel[0].bbox.mxR === lines[i].maxR;
      })) rules.push({ kind: "objectSpanRows", selector });
    }
    for (const [selectorA, selectorB] of [[{ type: "topmost" }, { type: "bottommost" }], [{ type: "largest" }, { type: "smallest" }]]) {
      if (pairs.every(({ input }, i) => {
        const objs = findObjs(input), pair = twoObjs({ selectorA, selectorB }, input, objs);
        if (!pair) return false;
        const range = resolveRange({ kind: "betweenObjectsRows", selectorA, selectorB }, input, objs, "v");
        return range && range.a === lines[i].minR && range.b === lines[i].maxR;
      })) rules.push({ kind: "betweenObjectsRows", selectorA, selectorB });
    }
  }
  return uniqRules(rules);
}

function inferColorRules(pairs, lines) {
  const rules = [];
  if (lines.every(l => l.color === lines[0].color)) rules.push({ kind: "constant", color: lines[0].color });
  for (const selector of CORE_SELECTORS) {
    if (pairs.every(({ input }, i) => {
      const objs = findObjs(input), sel = selectObjs(objs, selector, input, objs);
      return sel.length === 1 && sel[0].color === lines[i].color;
    })) rules.push({ kind: "objectColor", selector });
  }
  return uniqRules(rules);
}

function buildDrawingRuleAsts(pairs) {
  const out = [];
  for (const axis of ["h", "v"]) {
    const lines = lineInfoForPairs(pairs, axis);
    if (!lines) continue;
    const posRules = inferPositionRules(pairs, lines, axis);
    const rangeRules = inferRangeRules(pairs, lines, axis);
    const colorRules = inferColorRules(pairs, lines);
    for (const posRule of posRules) for (const rangeRule of rangeRules) for (const colorRule of colorRules) {
      const ast = axis === "h" ? { type: "drawLine", axis, rowRule: posRule, rangeRule, colorRule } : { type: "drawLine", axis, colRule: posRule, rangeRule, colorRule };
      const kind = drawingIsAbstract(ast) ? "abstract" : "literal";
      const explainText = axis === "h"
        ? `Draw H-line (${kind}): row=${ruleName(posRule)}, range=${ruleName(rangeRule)}, color=${ruleName(colorRule)}`
        : `Draw V-line (${kind}): col=${ruleName(posRule)}, range=${ruleName(rangeRule)}, color=${ruleName(colorRule)}`;
      out.push({ ast, explain: explainText, kind });
    }
  }
  out.sort((a, b) => (a.kind === b.kind ? complexity(a.ast) - complexity(b.ast) : a.kind === "abstract" ? -1 : 1));
  return out;
}

function genDrawingHyps(pairs) {
  const hyps = [], logs = [];
  for (const cand of buildDrawingRuleAsts(pairs)) {
    if (pairs.every(({ input, output }) => { try { return eq(exec(cand.ast, input), output); } catch { return false; } })) {
      hyps.push({ ast: cand.ast, trainingExact: true, explain: cand.explain, source: "drawingHypothesis" });
      logs.push(`✓ Draw: ${cand.kind} rule`);
    }
  }
  return { hyps, logs };
}

function genRelationalHyps(pairs) {
  const hyps = [], logs = [];
  // For each pair, check if an object related to a specific target is modified
  const relTypes = ["touching", "sameColor", "sameShape", "alignedRow", "alignedCol", "above", "below", "leftOf", "rightOf", "inside", "contains"];
  const targetSels = [{ type: "largest" }, { type: "smallest" }, { type: "uniqueColor" }];
  for (const rel of relTypes) {
    for (const target of targetSels) {
      for (const opType of ["delete", "recolor"]) {
        const rSel = { type: "relatedTo", relation: rel, target };
        if (opType === "recolor") {
          const outColors = new Set();
          for (const { output } of pairs) for (const row of output) for (const v of row) outColors.add(v);
          for (const color of outColors) {
            const ast = objOp(rSel, { type: "recolor", color });
            if (pairs.every(({ input, output }) => { try { return eq(exec(ast, input), output); } catch { return false; } })) {
              hyps.push({ ast, trainingExact: true, explain: `Recolor ${rel}(${target.type})→${color}`, source: "relationalHypothesis" });
              logs.push(`✓ Rel: Recolor ${rel}(${target.type})→${color}`);
            }
          }
        } else {
          const ast = objOp(rSel, { type: opType });
          if (pairs.every(({ input, output }) => { try { return eq(exec(ast, input), output); } catch { return false; } })) {
            hyps.push({ ast, trainingExact: true, explain: `${opType} ${rel}(${target.type})`, source: "relationalHypothesis" });
            logs.push(`✓ Rel: ${opType} ${rel}(${target.type})`);
          }
        }
      }
    }
  }
  return { hyps, logs };
}

function detectColorSub(pairs) {
  const gm = {};
  for (const { input, output } of pairs) {
    if (input.length !== output.length || (input[0]?.length || 0) !== (output[0]?.length || 0)) return null;
    for (let r = 0; r < input.length; r++) for (let c = 0; c < (input[0]?.length || 0); c++) {
      const ic = input[r][c], oc = output[r][c];
      if (ic !== oc) { if (gm[ic] !== undefined && gm[ic] !== oc) return null; gm[ic] = oc; }
    }
  }
  return Object.keys(gm).length > 0 ? gm : null;
}

// ── Beam Search (with mutation) ─────────────────────────────────────────

function pairsAfter(ast, pairs) {
  return pairs.map(({ input, output }) => ({ input: exec(ast, input), output }));
}

function genCompositionHyps(pairs) {
  const hyps = [], logs = [];
  const tryAST = (ast, expl, source = "compositionHypothesis") => {
    if (pairs.every(({ input, output }) => { try { return eq(exec(ast, input), output); } catch { return false; } })) {
      hyps.push({ ast, trainingExact: true, explain: expl, source });
      logs.push(`✓ Comp: ${expl}`);
    }
  };
  const prefixes = [pN("cropBBox"), pN("flipH"), pN("flipV"), pN("rotate90"), pN("rotate180"), pN("rotate270"), pN("transpose")];
  const suffixes = [];
  for (const f of [2, 3, 4, 5]) suffixes.push({ ast: pN("scale", f), name: `Scale ${f}×` });
  for (const n of ["flipH", "flipV", "rotate90", "rotate180", "rotate270", "transpose", "cropBBox"])
    suffixes.push({ ast: pN(n), name: explain(pN(n)) });

  for (const prefix of prefixes) {
    let midPairs = null;
    try { midPairs = pairsAfter(prefix, pairs); } catch { continue; }
    for (const suffix of suffixes) tryAST(seq(prefix, suffix.ast), `${explain(prefix)} → ${suffix.name}`);
    const cMap = detectColorSub(midPairs);
    if (cMap) {
      const recolor = pN("colorSub", cMap);
      tryAST(seq(prefix, recolor), `${explain(prefix)} → Recolor: ${Object.entries(cMap).map(([a, b]) => `${a}→${b}`).join(",")}`);
    }
    {
      const colors = new Set();
      for (const { output } of pairs) {
        const bg = detectBg(output);
        for (const row of output) for (const v of row) if (v !== bg) colors.add(v);
      }
      for (const color of colors) tryAST(seq(prefix, pN("recolorAllNonBg", color)), `${explain(prefix)} → Recolor all non-bg→${color}`);
    }
    for (const f of [2, 3, 4, 5]) {
      const scaled = seq(prefix, pN("scale", f));
      let scaledPairs = null;
      try { scaledPairs = pairsAfter(scaled, pairs); } catch { continue; }
      const afterScaleMap = detectColorSub(scaledPairs);
      if (afterScaleMap) tryAST(seq(scaled, pN("colorSub", afterScaleMap)), `${explain(prefix)} → Scale ${f}× → Recolor: ${Object.entries(afterScaleMap).map(([a, b]) => `${a}→${b}`).join(",")}`);
    }
  }
  return { hyps, logs };
}

function mutateAST(ast) {
  const mutations = [];
  const swaps = [["rotate90", "rotate180"], ["rotate180", "rotate270"], ["flipH", "flipV"], ["gravityDown", "gravityUp"], ["gravityLeft", "gravityRight"]];
  if (ast.type === "primitive") {
    for (const [a, b] of swaps) {
      if (ast.name === a) mutations.push(pN(b, ...(ast.args || [])));
      if (ast.name === b) mutations.push(pN(a, ...(ast.args || [])));
    }
  }
  if (ast.type === "sequence" && ast.steps?.length >= 2) {
    // Try removing each step
    for (let i = 0; i < ast.steps.length; i++) {
      const reduced = ast.steps.filter((_, j) => j !== i);
      mutations.push(reduced.length === 1 ? reduced[0] : { type: "sequence", steps: reduced });
    }
    // Try swapping adjacent steps
    for (let i = 0; i < ast.steps.length - 1; i++) {
      const swapped = [...ast.steps]; [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
      mutations.push({ type: "sequence", steps: swapped });
    }
  }
  return mutations;
}

function genBeamAtoms(pairs) {
  const atoms = [];
  const colors = new Set();
  for (const { output } of pairs) for (const row of output) for (const v of row) colors.add(v);
  for (const sel of CORE_SELECTORS) {
    atoms.push(objOp(sel, { type: "delete" }));
    for (const color of colors) atoms.push(objOp(sel, { type: "recolor", color }));
  }
  const relTypes = ["touching", "sameColor", "sameShape", "alignedRow", "alignedCol", "above", "below", "leftOf", "rightOf", "inside", "contains"];
  for (const rel of relTypes) for (const target of [{ type: "largest" }, { type: "smallest" }, { type: "uniqueColor" }]) {
    const rSel = { type: "relatedTo", relation: rel, target };
    atoms.push(objOp(rSel, { type: "delete" }));
    for (const color of colors) atoms.push(objOp(rSel, { type: "recolor", color }));
  }
  for (const d of buildDrawingRuleAsts(pairs)) atoms.push(d.ast);
  const seen = new Set();
  return atoms.filter(ast => {
    const k = JSON.stringify(ast);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function beam(pairs, lib, maxD = 2, bw = 20, opts = {}) {
  const simplePrims = ["rotate90", "rotate180", "rotate270", "flipH", "flipV", "transpose", "cropBBox",
    "gravityDown", "gravityUp", "gravityLeft", "gravityRight", "extractTile", "tileRows", "dilate4", "dilate8",
    "countDistinctColors", "countNonBgCells", "countObjects", "neighborCount4", "neighborCount8",
    "completeHSym", "completeVSym", "completeRotSym"];
  const paramPrims = [];
  const cMap = detectColorSub(pairs);
  if (cMap) paramPrims.push(pN("colorSub", cMap));
  for (const f of [2, 3]) paramPrims.push(pN("scale", f));
  for (const color of [1, 2, 3, 4, 5, 6, 7, 8, 9]) { paramPrims.push(pN("fillBg", color)); paramPrims.push(pN("addBorder", color)); paramPrims.push(pN("fillEnclosed", color)); paramPrims.push(pN("recolorAllNonBg", color)); }
  for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) paramPrims.push(pN("compactCorner", corner));
  for (const property of ["area", "top", "left"]) for (const order of ["asc", "desc"]) paramPrims.push(pN("recolorByRank", property, order));
  const outSz = gSz(pairs[0].output);
  let bm = [{ ast: { type: "identity" }, sc: score({ type: "identity" }, pairs, lib) }];
  const seen = new Set(["identity"]);
  const logs = [];

  for (let d = 1; d <= maxD; d++) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      logs.push("⚠ Runtime budget exceeded during beam search");
      return { bm, logs, timedOut: true };
    }
    const next = [];
    const allPrims = [...simplePrims.map(n => pN(n)), ...paramPrims, ...genBeamAtoms(pairs)];
    for (const cand of bm) {
      // Extend with primitives
      for (const prim of allPrims) {
        if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
          logs.push("⚠ Runtime budget exceeded during beam expansion");
          return { bm, logs, timedOut: true };
        }
        const newAST = seq(cand.ast, prim);
        const key = explain(newAST);
        if (seen.has(key)) continue; seen.add(key);
        const inSz = gSz(pairs[0].input);
        const ps = predSize(newAST, inSz);
        if (ps && (ps.rows !== outSz.rows || ps.cols !== outSz.cols)) continue;
        const sc = score(newAST, pairs, lib);
        if (sc.avgPx < 1) next.push({ ast: newAST, sc });
      }
      // Mutations of existing candidates
      for (const mut of mutateAST(cand.ast)) {
        const key = explain(mut);
        if (seen.has(key)) continue; seen.add(key);
        const sc = score(mut, pairs, lib);
        if (sc.avgPx < 1) next.push({ ast: mut, sc });
      }
    }
    next.sort((a, b) => a.sc.mdl - b.sc.mdl);
    bm = [...bm, ...next.slice(0, bw)];
    bm.sort((a, b) => a.sc.mdl - b.sc.mdl);
    bm = bm.slice(0, bw);
    const perf = bm.filter(b => b.sc.avgPx === 0);
    logs.push(`Depth ${d}: ${next.length} new, ${perf.length} perfect, beam=${bm.length}`);
    if (perf.length > 0 && d >= 2) break;
  }
  return { bm, logs };
}

// ── Learned Library ─────────────────────────────────────────────────────

class Library {
  constructor() { this.priors = {}; this.solved = []; }
  record(n, ok, comp, surp) {
    if (!this.priors[n]) this.priors[n] = { s: 0, f: 0 };
    if (ok) this.priors[n].s++; else this.priors[n].f++;
  }
  priorBonus(n) { const p = this.priors[n]; if (!p) return 0; const t = p.s + p.f; return t ? -(p.s / t) * 0.3 : 0; }
  addSolved(ast, name) { this.solved.push({ ast: explain(ast), task: name }); }
  summary() {
    const top = Object.entries(this.priors).filter(([, v]) => v.s > 0).sort((a, b) => b[1].s - a[1].s).slice(0, 10).map(([n, v]) => `${n}: ${v.s}✓ ${v.f}✗`);
    return { total: this.solved.length, top, programs: this.solved };
  }
}

// ── Failure Classification ──────────────────────────────────────────────

function classifyFail(pairs, objAn) {
  const reasons = [];
  const p0 = pairs[0], iS = gSz(p0.input), oS = gSz(p0.output);
  if (iS.rows !== oS.rows || iS.cols !== oS.cols) reasons.push("Size change — may need crop/scale/tile/extract");
  if (objAn?.length) {
    const iC = objAn[0].monoIn.length, oC = objAn[0].monoOut.length;
    if (oC < iC) reasons.push("Objects removed");
    if (oC > iC) reasons.push("Objects added — may need copy/draw");
    if (iC > 1) reasons.push("Multiple objects — likely relational");
    if (objAn[0].multiIn.length !== objAn[0].monoIn.length) reasons.push("Multi-color objects detected");
  }
  for (const { input, output } of pairs) {
    const d = diffGrid(input, output);
    if (d.type === "same-size") for (const t of analyzeDiff(d.changes)) reasons.push(`Diff: ${t.tag}`);
    break;
  }
  if (!reasons.length) reasons.push("No obvious pattern");
  return reasons;
}

// ── Full Solver ─────────────────────────────────────────────────────────

function traceFromLog(message, index) {
  const severity = message.startsWith("✓") ? "success" : message.startsWith("✗") ? "error" : message.startsWith("⚠") ? "warning" : message.startsWith("→") ? "decision" : "info";
  let phase = "solve";
  if (message.includes("pairs") || message.includes("Invalid")) phase = "validate";
  else if (message.startsWith("Bg") || message.startsWith("Objs") || message.startsWith("Correspondence")) phase = "perceive";
  else if (message.startsWith("Rels")) phase = "relations";
  else if (message.startsWith("Diff")) phase = "diff";
  else if (message.includes("Obj:") || message.includes("Draw:") || message.includes("Rel:")) phase = "hypothesize";
  else if (message.includes("Beam") || message.includes("Depth")) phase = "search";
  else if (message.startsWith("→")) phase = "select";
  else if (message.includes("Unsolved")) phase = "failure";
  const depth = message.match(/Depth (\d+)/)?.[1];
  const mdl = message.match(/MDL=([\d.]+)/)?.[1];
  return {
    id: `trace-${index}`,
    phase,
    severity,
    message,
    data: {
      depth: depth ? Number(depth) : undefined,
      mdl: mdl ? Number(mdl) : undefined,
    },
  };
}

function createTraceCollector(seed = "arc-v0.5") {
  const events = [];
  return {
    events,
    emit(type, phase, message, data = {}, severity = "info") {
      const event = {
        id: `evt-${events.length}`,
        type,
        phase,
        severity,
        message,
        data,
        seed,
      };
      events.push(event);
      return event;
    },
    fromLogs(logs, phase, typePrefix = "log") {
      for (const message of logs) {
        const parsed = traceFromLog(message, events.length);
        this.emit(`${typePrefix}.${parsed.phase}`, parsed.phase || phase, message, parsed.data || {}, parsed.severity || "info");
      }
    },
  };
}

function confidenceFor(result) {
  const trainFit = result.best?.sc ? Math.max(0, 1 - result.best.sc.avgPx) : 0;
  const testFit = result.testSurp === null || result.testSurp === undefined ? null : Math.max(0, 1 - result.testSurp);
  const cands = result.cands || [];
  const exact = cands.filter(c => c.sc?.allCorrect).length;
  const mdlGap = cands.length > 1 && cands[0].sc?.mdl !== undefined && cands[1].sc?.mdl !== undefined ? Math.max(0, cands[1].sc.mdl - cands[0].sc.mdl) : null;
  const ambiguity = Math.max(0, exact - 1);
  const testComponent = testFit === null ? 0.08 : testFit * 0.28;
  const gapComponent = mdlGap === null ? 0.04 : Math.min(0.16, mdlGap / 10);
  const riskPenalty = (result.fail ? 0.28 : 0) + (ambiguity > 0 ? Math.min(0.2, ambiguity * 0.04) : 0) + (result.testSurp !== null && result.testSurp > 0 ? 0.22 : 0);
  const value = Math.max(0, Math.min(1, trainFit * 0.52 + testComponent + gapComponent - riskPenalty));
  const label = value >= 0.85 ? "high" : value >= 0.62 ? "medium" : value >= 0.35 ? "low" : "very-low";
  const risks = [];
  if (result.fail) risks.push("unsolved");
  if (ambiguity > 0) risks.push("ambiguous-training-fit");
  if (testFit === null) risks.push("no-test-ground-truth");
  if (result.testSurp !== null && result.testSurp > 0) risks.push("test-mismatch");
  return { value, label, trainFit, testFit, ambiguity, exactCandidateCount: exact, mdlGap, risks };
}

function finalizeSolveResult(result, ctx) {
  const traces = ctx.tracer?.events?.length ? ctx.tracer.events : (result.logs || []).map(traceFromLog);
  const telemetry = {
    durationMs: Date.now() - ctx.startMs,
    budgetMs: ctx.budgetMs || null,
    timedOut: !!ctx.timedOut,
    seed: ctx.seed,
    cacheEntries: _cache.size,
    candidateCount: result.cands?.length || 0,
    traceCount: traces.length,
    method: result.method || "error",
  };
  return { ...result, traces, events: traces, confidence: confidenceFor(result), telemetry, budgetExceeded: telemetry.timedOut };
}

function solve(task, lib, options = {}) {
  const startMs = Date.now();
  const seed = options.seed ?? "arc-v0.5";
  const budgetMs = Number.isFinite(options.budgetMs) && options.budgetMs > 0 ? options.budgetMs : null;
  const deadlineMs = budgetMs ? startMs + budgetMs : null;
  const tracer = createTraceCollector(seed);
  const ctx = { startMs, seed, budgetMs, timedOut: false, tracer };
  _cache.clear();
  const pairs = task.train, logs = [];
  const finish = result => finalizeSolveResult(result, ctx);
  tracer.emit("solve.started", "solve", "Solver started", { taskId: task.id || null, name: task.name || null, budgetMs }, "info");
  for (const p of pairs) if (!validateGrid(p.input) || !validateGrid(p.output)) {
    tracer.emit("validation.failed", "validate", "Invalid grid", { taskId: task.id || null }, "error");
    return finish({ error: true, method: "invalid", logs: ["✗ Invalid grid"], cands: [], testPred: null, testSurp: null, fail: ["Invalid grid"] });
  }
  logs.push(`✓ ${pairs.length} pairs`);
  tracer.emit("validation.passed", "validate", "Training pairs validated", { pairs: pairs.length }, "success");
  const bg = detectBg(pairs[0].input);
  logs.push(`Bg: ${bg}`);
  tracer.emit("perception.background", "perceive", "Background color detected", { color: bg }, "info");

  const objAn = pairs.map(({ input, output }) => ({
    monoIn: findObjs(input), multiIn: findObjsMulti(input),
    monoOut: findObjs(output), multiOut: findObjsMulti(output),
  }));
  logs.push(`Objs: ${objAn[0].monoIn.length} in → ${objAn[0].monoOut.length} out`);
  tracer.emit("perception.objects", "perceive", "Objects perceived", { monoIn: objAn[0].monoIn.length, monoOut: objAn[0].monoOut.length, multiIn: objAn[0].multiIn.length, multiOut: objAn[0].multiOut.length }, "info");

  // Correspondence
  if (objAn[0].monoIn.length > 0) {
    const corr = trackObjects(objAn[0].monoIn, objAn[0].monoOut);
    const matched = corr.matches.filter(m => m.out).length;
    const lost = corr.matches.filter(m => !m.out).length;
    const added = corr.added.length;
    if (matched || lost || added) logs.push(`Correspondence: ${matched} matched, ${lost} lost, ${added} new`);
    tracer.emit("perception.correspondence", "perceive", "Object correspondence computed", { matched, lost, added }, "info");
  }

  // Relations
  if (objAn[0].monoIn.length > 1) {
    const rels = computeRels(objAn[0].monoIn);
    if (rels.length) logs.push(`Rels: ${rels.slice(0, 3).map(r => r.type).join(", ")}${rels.length > 3 ? "…" : ""}`);
    tracer.emit("relations.computed", "relations", "Directional and symbolic relations computed", { count: rels.length, sample: rels.slice(0, 6).map(r => r.type) }, "info");
  }

  // Diff
  const d0 = diffGrid(pairs[0].input, pairs[0].output);
  if (d0.type === "same-size" && d0.changes.length) {
    const tags = analyzeDiff(d0.changes);
    if (tags.length) logs.push(`Diff: ${tags.map(t => t.tag).join(", ")}`);
    tracer.emit("diff.analyzed", "diff", "First training diff analyzed", { changes: d0.changes.length, tags: tags.map(t => t.tag) }, "info");
  } else {
    tracer.emit("diff.analyzed", "diff", "First training diff analyzed", { type: d0.type, changes: d0.changes.length }, "info");
  }

  // Phase 1-4: Generate hypotheses from all sources
  const { hyps: h1, logs: l1 } = genWholeGrid(pairs); logs.push(...l1);
  const { hyps: h2, logs: l2 } = genObjectHyps(pairs); logs.push(...l2);
  const { hyps: h3, logs: l3 } = genDrawingHyps(pairs); logs.push(...l3);
  const { hyps: h4, logs: l4 } = genRelationalHyps(pairs); logs.push(...l4);
  const { hyps: h5, logs: l5 } = genCompositionHyps(pairs); logs.push(...l5);
  tracer.emit("hypotheses.generated", "hypothesize", "Hypotheses generated", { wholeGrid: h1.length, object: h2.length, drawing: h3.length, relational: h4.length, composition: h5.length }, "info");
  if (deadlineMs && Date.now() > deadlineMs) {
    ctx.timedOut = true;
    logs.push("⚠ Runtime budget exceeded before search");
    tracer.emit("budget.exceeded", "budget", "Runtime budget exceeded before search", { budgetMs }, "warning");
    return finish({ method: "budgetExceeded", best: null, cands: [], testPred: null, testSurp: null, logs, objAn, fail: ["Runtime budget exceeded"] });
  }

  const allH = [...h1, ...h2, ...h3, ...h4, ...h5].filter(h => h.trainingExact);

  if (allH.length > 0) {
    const scored = allH.map(h => ({ ...h, sc: score(h.ast, pairs, lib) }));
    scored.sort((a, b) => a.sc.mdl - b.sc.mdl);
    const best = scored[0];
    logs.push(`→ ${best.explain} [${best.source}] MDL=${best.sc.mdl.toFixed(2)}`);
    tracer.emit("candidates.scored", "score", "Exact hypotheses scored", { count: scored.length, top: scored.slice(0, 5).map(h => ({ explain: h.explain, source: h.source, mdl: Number(h.sc.mdl.toFixed(3)) })) }, "info");
    tracer.emit("rule.selected", "select", "Selected best exact hypothesis", { explain: best.explain, source: best.source, mdl: best.sc.mdl, allCorrect: best.sc.allCorrect }, "decision");
    const pName = explain(best.ast).split(" → ")[0].split("(")[0];
    lib.record(pName, true, best.sc.comp, best.sc.avgPx);
    lib.addSolved(best.ast, task.name || task.id);

    let testPred = null, testSurp = null;
    if (task.test?.[0]) { try { testPred = cached(best.ast, task.test[0].input); if (task.test[0].output) testSurp = pxSurprise(testPred, task.test[0].output); } catch { /**/ } }
    if (best.sc.allCorrect && testSurp !== null && testSurp > 0) logs.push("⚠ Training-perfect but test failed — likely overfit or ambiguous rule");
    tracer.emit("test.predicted", "execute", "Test prediction generated", { testSurp, hasGroundTruth: !!task.test?.[0]?.output }, testSurp === 0 ? "success" : testSurp === null ? "info" : "warning");
    return finish({ method: best.source, best: { ast: best.ast, explain: best.explain, sc: best.sc }, cands: scored.slice(0, 8).map(h => ({ explain: h.explain, source: h.source, sc: h.sc })), testPred, testSurp, logs, objAn, fail: null });
  }

  // Phase 5: Beam
  logs.push("Beam search…");
  tracer.emit("beam.started", "search", "Beam search started", { maxDepth: options.maxDepth || 2, beamWidth: options.beamWidth || 20 }, "info");
  const { bm, logs: bl, timedOut } = beam(pairs, lib, options.maxDepth || 2, options.beamWidth || 20, { deadlineMs }); logs.push(...bl);
  if (timedOut) ctx.timedOut = true;
  tracer.fromLogs(bl, "search", "beam");
  const bestB = bm[0];
  if (bestB?.sc?.allCorrect) {
    const e = explain(bestB.ast);
    logs.push(`→ Beam: ${e}`);
    tracer.emit("rule.selected", "select", "Selected best beam program", { explain: e, source: "beamSearch", mdl: bestB.sc.mdl, allCorrect: bestB.sc.allCorrect }, "decision");
    lib.record(e.split(" → ")[0].split("(")[0], true, bestB.sc.comp, bestB.sc.avgPx);
    lib.addSolved(bestB.ast, task.name || task.id);
    let testPred = null, testSurp = null;
    if (task.test?.[0]) { try { testPred = cached(bestB.ast, task.test[0].input); if (task.test[0].output) testSurp = pxSurprise(testPred, task.test[0].output); } catch { /**/ } }
    if (bestB.sc.allCorrect && testSurp !== null && testSurp > 0) logs.push("⚠ Training-perfect but test failed — likely overfit");
    tracer.emit("test.predicted", "execute", "Test prediction generated", { testSurp, hasGroundTruth: !!task.test?.[0]?.output }, testSurp === 0 ? "success" : testSurp === null ? "info" : "warning");
    return finish({ method: "beamSearch", best: { ast: bestB.ast, explain: e, sc: bestB.sc }, cands: bm.slice(0, 8).map(b => ({ explain: explain(b.ast), sc: b.sc })), testPred, testSurp, logs, objAn, fail: null });
  }

  const fr = classifyFail(pairs, objAn);
  if (ctx.timedOut) fr.unshift("Runtime budget exceeded");
  logs.push("✗ Unsolved"); logs.push(...fr.map(r => `  → ${r}`));
  tracer.emit("failure.classified", "failure", "Solver failed to find exact program", { reasons: fr, best: bestB ? explain(bestB.ast) : null }, "error");
  lib.record("unsolved", false, 0, 1);
  return finish({ method: ctx.timedOut ? "budgetExceeded" : "failed", best: bestB ? { ast: bestB.ast, explain: explain(bestB.ast), sc: bestB.sc } : null, cands: bm.slice(0, 6).map(b => ({ explain: explain(b.ast), sc: b.sc })), testPred: null, testSurp: null, logs, objAn, fail: fr });
}

export {
  Library,
  PRIMS,
  analyzeDiff,
  beam,
  cached,
  clone,
  colorHist,
  confidenceFor,
  computeRels,
  createTraceCollector,
  detectBg,
  diffGrid,
  eq,
  exec,
  explain,
  finalizeSolveResult,
  findObjs,
  findObjsMulti,
  genCompositionHyps,
  gSz,
  pxSurprise,
  score,
  solve,
  traceFromLog,
  trackObjects,
  validateGrid,
};
