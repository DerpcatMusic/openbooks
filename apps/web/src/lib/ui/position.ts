// Where to put a floating box (menu, tooltip) next to its trigger: below if it fits, else above; aligned to the trigger's
// start or end edge (start = left in LTR, right in RTL); always clamped inside the viewport with an 8px margin.
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function place(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { align?: "start" | "end" | "center"; rtl?: boolean; gap?: number } = {},
): { top: number; left: number } {
  const { align = "start", rtl = false, gap = 6 } = opts,
    m = 8;
  const below = anchor.top + anchor.height + gap;
  const top = below + size.height <= viewport.height - m || anchor.top - gap - size.height < m ? below : anchor.top - gap - size.height;
  const leftEdge = (align === "start") !== rtl;
  let left = align === "center" ? anchor.left + anchor.width / 2 - size.width / 2 : leftEdge ? anchor.left : anchor.left + anchor.width - size.width;
  left = Math.max(m, Math.min(left, viewport.width - m - size.width));
  return { top: Math.max(m, Math.min(top, viewport.height - m - size.height)), left };
}
