// Squarified treemap (Bruls, Huizing & van Wijk 2000), pure: each item gets a rectangle whose area is proportional to its value,
// rows laid along the shorter side so the boxes stay close to square. Treemap.svelte draws it.
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Tile<T> = Rect & { item: T };

export function squarify<T extends { value: number }>(items: readonly T[], box: Rect): Tile<T>[] {
  const xs = items.filter((i) => i.value > 0).toSorted((a, b) => b.value - a.value);
  const total = xs.reduce((a, i) => a + i.value, 0);
  if (!total || box.w <= 0 || box.h <= 0) return [];
  const scale = (box.w * box.h) / total;
  const out: Tile<T>[] = [];
  let r = { ...box },
    row: T[] = [];
  const area = (i: T) => i.value * scale;
  /** Worst aspect ratio of a row laid along a side of length `side`. */
  const worst = (rw: readonly T[], side: number) => {
    const s = rw.reduce((a, i) => a + area(i), 0),
      max = Math.max(...rw.map(area)),
      min = Math.min(...rw.map(area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const flush = () => {
    const s = row.reduce((a, i) => a + area(i), 0);
    if (r.w >= r.h) {
      // a column on the left, as wide as the row's area needs
      const cw = s / r.h;
      let y = r.y;
      for (const i of row) out.push({ x: r.x, y, w: cw, h: area(i) / cw, item: i }), (y += area(i) / cw);
      r = { x: r.x + cw, y: r.y, w: r.w - cw, h: r.h };
    } else {
      const rh = s / r.w;
      let x = r.x;
      for (const i of row) out.push({ x, y: r.y, w: area(i) / rh, h: rh, item: i }), (x += area(i) / rh);
      r = { x: r.x, y: r.y + rh, w: r.w, h: r.h - rh };
    }
    row = [];
  };
  for (const i of xs) {
    const side = Math.min(r.w, r.h);
    if (row.length && worst([...row, i], side) > worst(row, side)) flush();
    row.push(i);
  }
  if (row.length) flush();
  return out;
}

/** A box of the spending treemap. */
export interface TreeItem {
  key: string;
  label: string;
  value: number;
  avg: number;
  /** (value - avg) / avg; null = no history. */
  change: number | null;
}
