// The write checks of the Books service as pure code over a read-only view of one entity's books, so the server (books.db) and the
// browser-only store (IndexedDB) refuse exactly the same writes: the close date first, then each doc's own rules.
import {
  accountProblem,
  canon,
  checkBooks,
  journalProblem,
  ledger,
  movedBefore,
  payrollProblem,
  splitProblem,
  tripProblem,
  type BooksDoc,
  type Coa,
  type JournalProblem,
  type LedgerExtras,
  type PayrollProblem,
  type PayrollRun,
  type SplitProblem,
  type Trip,
  type TripProblem,
} from "@openbooks/core";
import type { JournalEntry, RuleInput, SplitsDoc, StoredTxn, TagsDoc, Txn } from "@openbooks/schema";

const JOURNAL: Record<JournalProblem, string> = {
  date: "has no valid date",
  beforeStart: "is dated before the books' entries start date",
  empty: "has no line with an amount",
  account: "has a line with an amount but no ledger account",
  archived: "uses an archived ledger account",
  noDebit: "needs at least one debit line",
  noCredit: "needs at least one credit line",
  unbalanced: "has debits that do not equal credits",
};
const SPLIT: Record<SplitProblem, string> = {
  lines: "needs at least two lines",
  amount: "has a line without an amount",
  account: "has a line without a usable ledger account (missing or archived)",
  sum: "lines do not add up to the transaction amount to the cent",
};
const TRIP: Record<TripProblem, string> = {
  name: "needs a name",
  dates: "needs real dates with the last day on or after the first",
  country: "needs a destination country (two capital letters, e.g. DE)",
  nights: "has more nights than days",
  businessDays: "has more business days than days",
  fx: "needs an exchange rate above zero",
  carDays: "has more car days than days",
};
const PAYROLL: Record<PayrollProblem, string> = {
  period: "needs a period",
  payDate: "needs a real pay date",
  provider: "needs a provider",
  amount: "needs gross pay above zero and no negative or missing figure",
  net: "has net pay that is not gross pay less withholding and benefits",
  over: "has payments above what the run costs (gross pay plus employer taxes)",
};
const BOOKS = {
  date: "The close date and the entries start date must be real dates (YYYY-MM-DD).",
  closeFuture: "The close date can't be in the future.",
  closeBeforeStart: "The close date can't be before the entries start date.",
  startLater: "The entries start date can only move earlier, never later: that would drop history the books already counted.",
  basis: "The accounting basis is cash or accrual.",
} as const;
/** The machine's date, YYYY-MM-DD (the screens use the same clock). */
export const localToday = () => new Date().toLocaleDateString("sv");

/** What the checks read of one entity's books. */
export interface BooksView {
  doc: <A>(name: string, fallback: A) => A;
  rules: () => RuleInput[];
  stored: () => StoredTxn[];
}
/** closed: the write changes something on or before the close date (HTTP 409); bad: the value breaks the doc's own rules (HTTP 400). */
export type Closed = { closed: string };
export type Refusal = Closed | { bad: string };
export type Change = { rules?: readonly RuleInput[]; overrides?: Record<string, string>; journal?: JournalEntry[] } & LedgerExtras;

// books.py tolerates entries without lines or memo (je.get("lines", []))
export const journalOf = (b: BooksView) => b.doc<JournalEntry[]>("journal", []).map((je) => ({ ...je, lines: je.lines ?? [] }));
/** What besides rules/overrides/journal shapes the ledger: splits, the chart (archived accounts) and the entries start date. */
export const extrasOf = (b: BooksView): LedgerExtras => ({
  splits: b.doc<SplitsDoc>("splits", {}),
  coa: b.doc<Coa>("coa", {}),
  from: b.doc<BooksDoc>("books", {}).startDate,
});
/** The ledger rows, tags applied: what the screens show. */
export const ledgerOf = (b: BooksView): Txn[] =>
  ledger(b.stored(), b.doc("overrides", {}), b.rules(), journalOf(b), b.doc<TagsDoc | null>("tags", null) ?? undefined, extrasOf(b));

const closeDate = (b: BooksView) => b.doc<{ closeDate?: string | null }>("books", {}).closeDate || null;
const refuse = (close: string, n: number): Closed | null =>
  n
    ? {
        closed: `The books are closed through ${close}: this would change ${n} ${n === 1 ? "entry" : "entries"} dated on or before it. Move the close date to change them.`,
      }
    : null;
/** The ledger rows as the close check compares them: id, date and ledger account. */
const accountsOf = (ts: readonly Txn[]) => ts.map((t) => ({ id: t.id, date: t.date, category: t.category }));
const rowsOf = (b: BooksView, c: Change = {}) =>
  ledger(b.stored(), c.overrides ?? b.doc("overrides", {}), c.rules ?? b.rules(), c.journal ?? journalOf(b), undefined, { ...extrasOf(b), ...c });

/** Refuse a change (new rules/overrides/splits/chart/start date) that would move a ledger row dated on or before the close date. */
export function ledgerRefusal(b: BooksView, change: Change): Closed | null {
  const close = closeDate(b);
  return close ? refuse(close, movedBefore(accountsOf(rowsOf(b)), accountsOf(rowsOf(b, change)), close).length) : null;
}

/** Items of a list or map whose canonical JSON differs between the stored doc and the new value (added, changed). */
const changedIn = <T>(before: Record<string, T>, after: Record<string, T>) => Object.keys(after).filter((k) => canon(before[k]) !== canon(after[k]));
/** List items (by id) that differ from what is stored. */
const changedItems = <T extends { id: string }>(before: unknown, after: unknown) => {
  const old = new Map(((Array.isArray(before) ? before : []) as T[]).map((x) => [x.id, x]));
  return ((Array.isArray(after) ? after : []) as T[]).filter((x) => canon(old.get(x.id)) !== canon(x));
};

/**
 * Refuse a write to a doc that shapes the ledger: the close date first (journal, reconciliations, review marks, splits, chart, books),
 * then the doc's own rules (a journal entry must balance, a split must add up, the books' dates must make sense). Only entries that
 * differ from what is stored are validated, so books saved before a rule existed still open and save.
 */
export function docRefusal(b: BooksView, name: string, value: unknown, today = localToday()): Refusal | null {
  const close = closeDate(b);
  const months = (v: unknown) =>
    Object.entries((v ?? {}) as Record<string, Record<string, unknown>>).flatMap(([acct, ms]) =>
      Object.entries(ms ?? {}).map(([ym, rec]) => ({ id: `${acct}|${ym}`, date: `${ym}-01`, rec })),
    );
  const entries = (v: unknown) => (Array.isArray(v) ? (v as JournalEntry[]) : []);
  switch (name) {
    case "reconciliations":
      return close ? refuse(close, movedBefore(months(b.doc(name, {})), months(value), close).length) : null;
    case "journal": {
      const after = entries(value);
      if (close) {
        const r = refuse(close, movedBefore(entries(b.doc(name, [])), after, close).length);
        if (r) return r;
      }
      const ctx = { coa: b.doc<Coa>("coa", {}), from: b.doc<BooksDoc>("books", {}).startDate };
      for (const x of changedItems<JournalEntry>(b.doc(name, []), after)) {
        const p = journalProblem({ date: x.date, lines: x.lines ?? [] }, ctx);
        if (p) return { bad: `Journal entry ${x.memo ? `“${x.memo}” ` : ""}${x.date} ${JOURNAL[p]}.` };
      }
      return null;
    }
    case "splits": {
      const after = (value ?? {}) as SplitsDoc,
        amounts = new Map(b.stored().map((t) => [t.id, t.amount])),
        coa = b.doc<Coa>("coa", {});
      for (const id of changedIn(b.doc<SplitsDoc>(name, {}), after)) {
        const amount = amounts.get(id);
        if (amount === undefined) return { bad: `Split of ${id}: no such transaction.` };
        const p = splitProblem(amount, after[id]!, (a) => !accountProblem(a, coa));
        if (p) return { bad: `Split of ${id} ${SPLIT[p]}.` };
      }
      return ledgerRefusal(b, { splits: after });
    }
    case "coa":
      return ledgerRefusal(b, { coa: (value ?? {}) as Coa });
    case "books": {
      const next = (value ?? {}) as BooksDoc,
        p = checkBooks(b.doc<BooksDoc>(name, {}), next, today);
      return p ? { bad: BOOKS[p] } : ledgerRefusal(b, { from: next.startDate });
    }
    case "trips": {
      // a trip changes what the Taxximizer counts, not the ledger: only its own shape is checked
      for (const x of changedItems<Trip>(b.doc(name, []), value)) {
        const p = tripProblem(x);
        if (p) return { bad: `Trip ${x.name ? `“${x.name}” ` : ""}${TRIP[p]}.` };
      }
      return null;
    }
    case "payroll": {
      // a run is the provider's figures, checked against each other (no tax is calculated)
      for (const x of changedItems<PayrollRun>(b.doc(name, []), value)) {
        const p = payrollProblem(x);
        if (p) return { bad: `Payroll run ${x.period ? `“${x.period}” ` : ""}${PAYROLL[p]}.` };
      }
      return null;
    }
    case "reviewed": {
      if (!close) return null;
      // a review mark is bookkeeping, not an amount, but a closed period is closed: its marks stay as they were
      const dates = new Map(b.stored().map((t) => [t.id, t.date])),
        marks = (v: unknown) =>
          Object.entries((v ?? {}) as Record<string, unknown>).flatMap(([id, on]) => (dates.has(id) ? [{ id, date: dates.get(id)!, on: !!on }] : []));
      return refuse(close, movedBefore(marks(b.doc(name, {})), marks(value), close).length);
    }
    default:
      return null;
  }
}
