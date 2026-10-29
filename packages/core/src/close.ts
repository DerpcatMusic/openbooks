// The close date (books doc "books" = { closeDate: "YYYY-MM-DD" }): everything dated on or before it is locked. Pure: the server's
// guard (packages/storage) and the screens' lock icons use the same two functions.

/** True when something dated `date` sits on or before the close date. */
export const closedOn = (date: string | undefined, close?: string | null) => !!date && !!close && date <= close;

export interface Dated {
  id: string;
  date: string;
}
/** JSON with sorted keys, so two copies of one object compare equal whatever order their keys were written in. */
const canon = (v: unknown) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );

/**
 * Ids that differ between two states of the same list (matched by id, compared as canonical JSON) where the item is dated on or
 * before the close date on either side. A missing item counts as changed, so adding or deleting a closed entry is caught too.
 * Journal entries, ledger rows ({ id, date, category }) and reconciliation months ({ id: "account|YYYY-MM", date: "YYYY-MM-01" })
 * all go through this one check.
 */
export function movedBefore<T extends Dated>(before: readonly T[], after: readonly T[], close: string): string[] {
  const b = new Map(before.map((x) => [x.id, x])),
    a = new Map(after.map((x) => [x.id, x]));
  return [...new Set([...b.keys(), ...a.keys()])].filter((id) => {
    const x = b.get(id),
      y = a.get(id);
    return (closedOn(x?.date, close) || closedOn(y?.date, close)) && canon(x) !== canon(y);
  });
}
