// Home card order and visibility, saved per entity in doc "home-layout" = { order, hidden }. Cards added in a later version
// slot in at their default position; ids that no longer exist are dropped.
export const CARDS = ["metrics", "overview", "flow", "inout", "insights", "networth", "recurring", "chart", "recent"] as const;
/** Hidden by default when no custom layout is saved: Cash in/out is built right into the unified Monthly chart card. */
export const DEFAULT_HIDDEN: readonly CardId[] = ["inout"];
export type CardId = (typeof CARDS)[number];
export interface HomeLayout {
  order?: string[];
  hidden?: string[];
}

export function arrange(saved: HomeLayout | null | undefined): { order: CardId[]; hidden: Set<CardId> } {
  const known = (xs: readonly string[] | undefined) => (xs ?? []).filter((x): x is CardId => (CARDS as readonly string[]).includes(x));
  const order = [...new Set(known(saved?.order))];
  CARDS.forEach((c, i) => {
    if (order.includes(c)) return;
    // after the default card before it, else first
    const prev = CARDS.slice(0, i).findLast((p) => order.includes(p));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, c);
  });
  const hidden = saved?.hidden !== undefined ? known(saved.hidden) : [...DEFAULT_HIDDEN];
  return { order, hidden: new Set(hidden) };
}

/** order with `id` moved one place up (-1) or down (+1). */
export function move<T>(order: readonly T[], id: T, by: -1 | 1): T[] {
  const i = order.indexOf(id),
    j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return [...order];
  const next = [...order];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
