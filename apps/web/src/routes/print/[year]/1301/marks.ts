// Where each 1301 value lands on the form page (old web/src/views/Print.svelte): checkboxes get an X in the box centre,
// "cells" boxes one digit per cell right-aligned into the last cells, text boxes a line aligned as the form box says.
export interface Box {
  page: number;
  kind: "check" | "text";
  align?: "center" | "right" | "cells";
  cells?: number[];
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}
export interface Layout {
  size: [number, number];
  pages: string[];
  fields: Record<string, Box[]>;
}
export interface Mark {
  cls: "x" | "cell" | "txt";
  text: string;
  style: string;
}

const MONEY = new Set(["150", "186", "238", "060", "294", "040"]);
/** 18414 → 18,414 in the money boxes */
const fmtv = (v: string, key: string) => (MONEY.has(key) && /^\d{4,}$/.test(v) ? (+v).toLocaleString("en-US") : v);

export function marks(layout: Layout, page: number, v: (key: string) => string): Mark[] {
  const out: Mark[] = [];
  for (const [key, boxes] of Object.entries(layout.fields)) {
    const val = String(v(key) ?? "");
    if (!val) continue;
    for (const m of boxes.filter((x) => x.page === page)) {
      if (m.kind === "check") out.push({ cls: "x", text: "X", style: `left:${(m.x0 + m.x1) / 2}pt;top:${(m.top + m.bottom) / 2}pt` });
      else if (m.align === "cells" && m.cells) {
        const digits = val.replace(/\D/g, "").split("").slice(-m.cells.length),
          first = m.cells.length - digits.length;
        digits.forEach((ch, i) => out.push({ cls: "cell", text: ch, style: `left:${m.cells![first + i]}pt;top:${m.bottom - 12}pt` }));
      } else
        out.push({
          cls: "txt",
          text: fmtv(val, key),
          style: `left:${m.x0 + 2}pt;width:${m.x1 - m.x0 - 5}pt;top:${(m.top + m.bottom) / 2 - 6}pt;text-align:${m.align === "center" ? "center" : "right"}`,
        });
    }
  }
  return out;
}
