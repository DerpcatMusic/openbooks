// The close date (books doc "books" = { closeDate: "YYYY-MM-DD" }): everything dated on or before it is locked. Pure: the server's
// guard (packages/storage) and the screens' lock icons use the same two functions.

/** True when something dated `date` sits on or before the close date. */
export const closedOn = (date: string | undefined, close?: string | null) => !!date && !!close && date <= close;

export interface Dated {
  id: string;
  date: string;
}
/** JSON with sorted keys, so two copies of one object compare equal whatever order their keys were written in. */
export const canon = (v: unknown) =>
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

// ---------- books details (doc "books"): the entries start date and the close date ----------
export interface BooksDoc {
  /** Everything dated on or before it is locked. */
  closeDate?: string | null | undefined;
  /** Transactions and journal entries dated before it are left out of the books. Once set it can only move earlier. */
  startDate?: string | null | undefined;
}
export type BooksProblem = "date" | "closeFuture" | "closeBeforeStart" | "startLater";

const isoOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
/**
 * Why a new "books" doc is refused, or null. Both dates must be real dates; the close date can't be in the future (`today`, the
 * machine's date) or before the start date; a start date that is already set can only move earlier (or be cleared, which is the
 * same as moving it to the beginning of time), never later: later would drop history the books already counted.
 */
export function checkBooks(prev: BooksDoc | null | undefined, next: BooksDoc | null | undefined, today: string): BooksProblem | null {
  const close = next?.closeDate || null,
    start = next?.startDate || null,
    wasClose = prev?.closeDate || null,
    was = prev?.startDate || null;
  if ((close && close !== wasClose && !isoOk(close)) || (start && start !== was && !isoOk(start))) return "date";
  if (close && close !== wasClose && close > today) return "closeFuture"; // an old value saved before this check stays as it is
  if (start && was && start > was) return "startLater";
  if (close && start && (close !== wasClose || start !== was) && close < start) return "closeBeforeStart";
  return null;
}
