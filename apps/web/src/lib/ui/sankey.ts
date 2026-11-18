// Three-column sankey layout (pure): sources → one middle node → targets. Pixels only; Sankey.svelte draws it.
// The two sides are balanced first: more in than out adds a surplus target, more out than in a deficit source, so every column sums to the middle.
export interface FlowItem {
  key: string;
  label: string;
  value: number;
  color: string;
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

/** The band between two node edges as an SVG path (cubic, horizontal tangents). */
export const bandPath = (x0: number, y0: number, x1: number, y1: number, w: number) => {
  const m = (x0 + x1) / 2;
  return `M${x0},${y0}C${m},${y0} ${m},${y1} ${x1},${y1}L${x1},${y1 + w}C${m},${y1 + w} ${m},${y0 + w} ${x0},${y0 + w}Z`;
};
