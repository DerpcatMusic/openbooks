// Manual journal entries (books doc "journal"): [{ id, date, memo, lines: [{ account, debit, credit }] }]. The server turns each
// line into a ledger row (credit − debit) on the "Journal" account, so every report and the tax engines include them.
// While editing, amounts are the strings typed into the inputs; saving stores numbers and drops empty lines. The rules (a debit and a
// credit line, debits = credits in cents, no archived account, not before the entries start date) are core journal.ts.
import { journalProblem, type JournalCtx, type JournalProblem } from "@openbooks/core";

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
/**
 * Why this entry can't be saved, or null (core journalProblem, shared with the server's write guard): "date", "beforeStart", "empty",
 * "account" (a line with an amount but no ledger account), "archived", "noDebit", "noCredit" or "unbalanced" (compared in whole cents).
 */
export const problem = (e: Entry, ctx: JournalCtx = {}): JournalProblem | null => journalProblem({ date: e.date, lines: e.lines }, ctx);
/** A copy of an entry as a new draft: same date, memo and lines (Mercury's "Duplicate"). */
export const duplicate = (e: Entry, id: string): Entry => ({
  id,
  date: e.date,
  memo: e.memo ?? "",
  lines: e.lines.map((l) => ({ account: l.account, debit: l.debit ?? "", credit: l.credit ?? "" })),
});
/** What gets stored: numbers only, lines without an amount dropped. */
export const clean = (es: readonly Entry[]): Entry[] =>
  es.map((e) => ({ ...e, lines: e.lines.filter(used).map((l) => ({ account: l.account, debit: num(l.debit), credit: num(l.credit) })) }));
export const blankLine = (): JLine => ({ account: "ask", debit: "", credit: "" });
