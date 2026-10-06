// Roving focus for radio groups, tab lists and menus: arrows (mirrored in RTL for Left/Right), Home, End.
// Returns the new index, or null if the key isn't a navigation key.
export function nextIndex(e: KeyboardEvent, i: number, n: number): number | null {
  const rtl = e.currentTarget instanceof Element && getComputedStyle(e.currentTarget).direction === "rtl";
  const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
  if (step) return (i + step + n) % n;
  if (e.key === "Home") return 0;
  if (e.key === "End") return n - 1;
  return null;
}
