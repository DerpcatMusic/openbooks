// Manual journal entries (books doc "journal"): [{ id, date, memo, lines: [{ account, debit, credit }] }]. The server turns each
// line into a ledger row (credit − debit) on the "Journal" account, so every report and the tax engines include them.
// While editing, amounts are the strings typed into the inputs; saving stores numbers and drops empty lines.

export interface JLine {
  account: string;
  debit?: number | string;
  credit?: number | string;
}
export interface Entry {
  id: string;
  date: string;
  memo?: string;
  lines: JLine[];
}

const num = (v: unknown) => +(v ?? 0) || 0;
const used = (l: JLine) => !!(num(l.debit) || num(l.credit));
/** [debits, credits] */
export const totals = (e: Entry): [number, number] => e.lines.reduce<[number, number]>((a, l) => [a[0] + num(l.debit), a[1] + num(l.credit)], [0, 0]);
/** Debits − credits, to the cent (0 = balanced). */
export const off = (e: Entry) => {
  const [d, c] = totals(e);
  return Math.round((d - c) * 100) / 100;
};
/** Why this entry can't be saved: "unbalanced" | "account" (a line with an amount but no account) | "empty" | "date", or null. */
export function problem(e: Entry): "unbalanced" | "account" | "empty" | "date" | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? "")) return "date";
  if (!e.lines.some(used)) return "empty";
  if (off(e)) return "unbalanced";
  if (e.lines.some((l) => used(l) && (!l.account || l.account === "ask"))) return "account";
  return null;
}
/** What gets stored: numbers only, lines without an amount dropped. */
export const clean = (es: readonly Entry[]): Entry[] =>
  es.map((e) => ({ ...e, lines: e.lines.filter(used).map((l) => ({ account: l.account, debit: num(l.debit), credit: num(l.credit) })) }));
export const blankLine = (): JLine => ({ account: "ask", debit: "", credit: "" });
