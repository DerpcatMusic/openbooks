// Three-column sankey layout (pure): sources → one middle node → targets. Pixels only; Sankey.svelte draws it.
// The two sides are balanced first: more in than out adds a surplus target, more out than in a deficit source, so every column sums to the middle.
export interface FlowItem {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Optional subtitle / parent tag for hub nodes (e.g. "2 accounts" or parent business name). */
  sub?: string;
  /** True if this middle hub can be clicked to expand child accounts (or collapse back). */
  expandable?: boolean;
  /** True if this middle hub is currently an expanded child node. */
  isChild?: boolean;
  /** Parent hub key when `isChild` is true. */
  parentKey?: string;
}
export interface FlowHubEdge {
  from: string;
  to: string;
  value: number;
}
export interface FlowNode extends FlowItem {
  col: 0 | 1 | 2;
  x: number;
  /** Top of the bar and its height; `cy` is the centre of its label slot. */
  y: number;
  h: number;
  cy: number;
}
export interface FlowLink {
  from: FlowNode;
  to: FlowNode;
  value: number;
  /** Tops of the band at each end and its thickness. */
  y0: number;
  y1: number;
  w: number;
}
export interface FlowOpts {
  width: number;
  height: number;
  nodeW?: number;
  gap?: number;
  /** Room each label needs: a node's slot is at least this tall. */
  minSlot?: number;
  /** Space left for labels on each side of the outer columns. */
  inset?: number;
  mid: Omit<FlowItem, "value">;
  surplus: Omit<FlowItem, "value">;
  deficit: Omit<FlowItem, "value">;
}

/** The n largest items, the rest folded into one `other` item (kept only when it is worth something). */
export function topN(items: readonly FlowItem[], n: number, other: Omit<FlowItem, "value">): FlowItem[] {
  const s = items.filter((i) => i.value > 0).toSorted((a, b) => b.value - a.value);
  if (s.length <= n) return s;
  const rest = s.slice(n - 1).reduce((a, i) => a + i.value, 0);
  return [...s.slice(0, n - 1), { ...other, value: rest }];
}

export function sankey(sources: readonly FlowItem[], targets: readonly FlowItem[], o: FlowOpts) {
  const { width, height, nodeW = 12, gap = 8, minSlot = 34, inset = 0 } = o;
  const src = sources.filter((s) => s.value > 0),
    dst = targets.filter((s) => s.value > 0);
  const tin = src.reduce((a, s) => a + s.value, 0),
    tout = dst.reduce((a, s) => a + s.value, 0);
  if (tin > tout) dst.push({ ...o.surplus, value: tin - tout });
  if (tout > tin) src.push({ ...o.deficit, value: tout - tin });
  const total = Math.max(tin, tout);
  if (!total) return { nodes: [] as FlowNode[], links: [] as FlowLink[], total: 0 };

  // one scale k (px per unit) for all columns, so a link is as thick at both ends: the largest k that fits every column,
  // where a node shorter than minSlot still takes minSlot of height for its label
  const fit = (col: readonly FlowItem[]) => {
    const room = height - gap * (col.length - 1);
    let k = room / total;
    for (let i = 0; i < col.length; i++) {
      const small = col.filter((c) => c.value * k < minSlot);
      const big = total - small.reduce((a, c) => a + c.value, 0);
      const next = big > 0 ? Math.max(0, room - small.length * minSlot) / big : k;
      if (Math.abs(next - k) < 1e-9) break;
      k = Math.min(k, next);
    }
    return k;
  };
  const k = Math.min(fit(src), fit(dst), height / total);
  const xs = [inset, (width - nodeW) / 2, width - inset - nodeW];
  const place = (col: readonly FlowItem[], c: 0 | 1 | 2): FlowNode[] => {
    const slot = (v: number) => Math.max(v * k, c === 1 ? 0 : minSlot);
    const used = col.reduce((a, s) => a + slot(s.value), 0) + gap * (col.length - 1);
    let y = Math.max(0, (height - used) / 2);
    return col.map((s) => {
      const sl = slot(s.value),
        h = s.value * k;
      const n = { ...s, col: c, x: xs[c]!, y: y + (sl - h) / 2, h, cy: y + sl / 2 };
      y += sl + gap;
      return n;
    });
  };
  const L = place(src, 0),
    [M] = place([{ ...o.mid, value: total }], 1),
    R = place(dst, 2);
  const links: FlowLink[] = [];
  let mIn = M!.y,
    mOut = M!.y;
  for (const n of L) {
    links.push({ from: n, to: M!, value: n.value, y0: n.y, y1: mIn, w: n.h });
    mIn += n.h;
  }
  for (const n of R) {
    links.push({ from: M!, to: n, value: n.value, y0: mOut, y1: n.y, w: n.h });
    mOut += n.h;
  }
  return { nodes: [...L, M!, ...R], links, total };
}

/**
 * Multi-hub three-column sankey layout: sources (col 0) → business/bank hubs or expanded child accounts (col 1) → targets (col 2).
 * Each hub's inflow and outflow are balanced with surplus/deficit links so every column and hub conserves flow accurately.
 */
export function sankeyHubs(
  sources: readonly FlowItem[],
  hubs: readonly FlowItem[],
  targets: readonly FlowItem[],
  edges: readonly FlowHubEdge[],
  o: Omit<FlowOpts, "mid">,
) {
  const { width, height, nodeW = 12, gap = 8, minSlot = 36, inset = 0 } = o;
  const srcList = sources.filter((s) => s.value > 0).map((s) => ({ ...s }));
  const dstList = targets.filter((t) => t.value > 0).map((t) => ({ ...t }));
  const hubList = hubs.filter((h) => h.value > 0).map((h) => ({ ...h }));
  if (!hubList.length) return { nodes: [] as FlowNode[], links: [] as FlowLink[], total: 0 };

  const srcKeys = new Set(srcList.map((s) => s.key));
  const hubKeys = new Set(hubList.map((h) => h.key));
  const dstKeys = new Set(dstList.map((d) => d.key));

  // Aggregate directed edges: col0→col1 and col1→col2
  const inEdges: FlowHubEdge[] = [];
  const outEdges: FlowHubEdge[] = [];
  const hubIn = new Map<string, number>();
  const hubOut = new Map<string, number>();
  for (const e of edges) {
    if (e.value <= 0) continue;
    if (srcKeys.has(e.from) && hubKeys.has(e.to)) {
      inEdges.push(e);
      hubIn.set(e.to, (hubIn.get(e.to) ?? 0) + e.value);
    } else if (hubKeys.has(e.from) && dstKeys.has(e.to)) {
      outEdges.push(e);
      hubOut.set(e.from, (hubOut.get(e.from) ?? 0) + e.value);
    }
  }

  // Balance each hub individually: excess inflow goes to surplus, excess outflow comes from deficit.
  let totalSurplus = 0;
  let totalDeficit = 0;
  for (const h of hubList) {
    const hi = hubIn.get(h.key) ?? 0;
    const ho = hubOut.get(h.key) ?? 0;
    if (hi > ho + 0.005) {
      const diff = hi - ho;
      totalSurplus += diff;
      outEdges.push({ from: h.key, to: o.surplus.key, value: diff });
      hubOut.set(h.key, hi);
    } else if (ho > hi + 0.005) {
      const diff = ho - hi;
      totalDeficit += diff;
      inEdges.push({ from: o.deficit.key, to: h.key, value: diff });
      hubIn.set(h.key, ho);
    }
    h.value = Math.max(hi, ho);
  }
  const activeHubs = hubList.filter((h) => h.value > 0);
  if (totalSurplus > 0.005) dstList.push({ ...o.surplus, value: totalSurplus });
  if (totalDeficit > 0.005) srcList.push({ ...o.deficit, value: totalDeficit });

  const total = activeHubs.reduce((a, h) => a + h.value, 0);
  if (!total) return { nodes: [] as FlowNode[], links: [] as FlowLink[], total: 0 };

  const fit = (col: readonly FlowItem[], colMinSlot: number) => {
    const room = height - gap * (col.length - 1);
    let k = room / total;
    for (let i = 0; i < col.length; i++) {
      const small = col.filter((c) => c.value * k < colMinSlot);
      const big = total - small.reduce((a, c) => a + c.value, 0);
      const next = big > 0 ? Math.max(0, room - small.length * colMinSlot) / big : k;
      if (Math.abs(next - k) < 1e-9) break;
      k = Math.min(k, next);
    }
    return k;
  };
  const hubSlot = Math.max(minSlot, 40);
  const k = Math.min(fit(srcList, minSlot), fit(activeHubs, hubSlot), fit(dstList, minSlot), height / total);
  const xs = [inset, (width - nodeW) / 2, width - inset - nodeW];
  const place = (col: readonly FlowItem[], c: 0 | 1 | 2): FlowNode[] => {
    const ms = c === 1 ? hubSlot : minSlot;
    const slot = (v: number) => Math.max(v * k, ms);
    const used = col.reduce((a, s) => a + slot(s.value), 0) + gap * (col.length - 1);
    let y = Math.max(0, (height - used) / 2);
    return col.map((s) => {
      const sl = slot(s.value),
        h = s.value * k;
      const n: FlowNode = { ...s, col: c, x: xs[c]!, y: y + (sl - h) / 2, h, cy: y + sl / 2 };
      y += sl + gap;
      return n;
    });
  };
  const L = place(srcList, 0),
    M = place(activeHubs, 1),
    R = place(dstList, 2);

  const byKey = new Map<string, FlowNode>();
  for (const n of [...L, ...M, ...R]) byKey.set(`${n.col}:${n.key}`, n);

  const srcOff = new Map<string, number>(L.map((n) => [n.key, n.y]));
  const hubInOff = new Map<string, number>(M.map((n) => [n.key, n.y]));
  const hubOutOff = new Map<string, number>(M.map((n) => [n.key, n.y]));
  const dstOff = new Map<string, number>(R.map((n) => [n.key, n.y]));

  // Order edges by target/source vertical order to minimize band crossings.
  const idxMap = (arr: readonly FlowNode[]) => new Map(arr.map((n, i) => [n.key, i]));
  const lIdx = idxMap(L),
    mIdx = idxMap(M),
    rIdx = idxMap(R);

  const links: FlowLink[] = [];
  for (const e of [...inEdges].sort((a, b) => (lIdx.get(a.from) ?? 0) - (lIdx.get(b.from) ?? 0) || (mIdx.get(a.to) ?? 0) - (mIdx.get(b.to) ?? 0))) {
    const from = byKey.get(`0:${e.from}`),
      to = byKey.get(`1:${e.to}`);
    if (!from || !to) continue;
    const w = e.value * k;
    const y0 = srcOff.get(from.key)!,
      y1 = hubInOff.get(to.key)!;
    links.push({ from, to, value: e.value, y0, y1, w });
    srcOff.set(from.key, y0 + w);
    hubInOff.set(to.key, y1 + w);
  }
  for (const e of [...outEdges].sort((a, b) => (mIdx.get(a.from) ?? 0) - (mIdx.get(b.from) ?? 0) || (rIdx.get(a.to) ?? 0) - (rIdx.get(b.to) ?? 0))) {
    const from = byKey.get(`1:${e.from}`),
      to = byKey.get(`2:${e.to}`);
    if (!from || !to) continue;
    const w = e.value * k;
    const y0 = hubOutOff.get(from.key)!,
      y1 = dstOff.get(to.key)!;
    links.push({ from, to, value: e.value, y0, y1, w });
    hubOutOff.set(from.key, y0 + w);
    dstOff.set(to.key, y1 + w);
  }

  return { nodes: [...L, ...M, ...R], links, total };
}

/** The band between two node edges as an SVG path (cubic, horizontal tangents). */
export const bandPath = (x0: number, y0: number, x1: number, y1: number, w: number) => {
  const m = (x0 + x1) / 2;
  return `M${x0},${y0}C${m},${y0} ${m},${y1} ${x1},${y1}L${x1},${y1 + w}C${m},${y1 + w} ${m},${y0 + w} ${x0},${y0 + w}Z`;
};
