// The write checks of the Books service as pure code over a read-only view of one entity's books, so the server (books.db) and the
// browser-only store (IndexedDB) refuse exactly the same writes: the close date first, then each doc's own rules.
import {
  accountProblem,
  assetProblem,
  baseId,
  billProblem,
  issueDocs,
  type AssetProblem,
  type DocProblem,
  type IssuedDoc,
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
import type { AssetAccount, JournalEntry, RuleInput, SplitsDoc, StoredTxn, TagsDoc, Txn } from "@openbooks/schema";

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
const ASSET: Record<AssetProblem, string> = {
  id: "needs an id",
  kind: "has an unknown asset kind",
  name: "needs a name",
  currency: "needs a 3-letter ISO currency code (e.g. ILS, USD)",
  valuations: "has a valuation with an invalid date or negative/missing value",
  chain: "needs a supported crypto chain (btc or eth)",
  address: "has an invalid public wallet address",
  privateKey: "looks like a private key or seed phrase — only public addresses are allowed",
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
  /** The entity id (transfer pairs name their sides "entity/txn id"). */
  entity: string;
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
  transfers: b.doc<{ rejected?: { out: string; in: string }[] }>("transfers", {}),
  close: b.doc<{ closeDate?: string | null }>("books", {}).closeDate || null,
});
/** The ledger rows, tags applied: what the screens show. */
export const ledgerOf = (b: BooksView): Txn[] =>
  ledger(b.stored(), b.doc("overrides", {}), b.rules(), journalOf(b), b.doc<TagsDoc | null>("tags", null) ?? undefined, extrasOf(b));

export const closeDate = (b: BooksView) => b.doc<{ closeDate?: string | null }>("books", {}).closeDate || null;
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
    case "anchors": {
      // { account: [{ date, balance }] }: a balance on or before the close date stays as it was
      if (!close) return null;
      const pts = (v: unknown) =>
        Object.entries((v ?? {}) as Record<string, { date: string; balance: number }[]>).flatMap(([acct, xs]) =>
          (Array.isArray(xs) ? xs : []).map((x) => ({ id: `${acct}|${x.date}`, date: x.date, balance: x.balance })),
        );
      return refuse(close, movedBefore(pts(b.doc(name, {})), pts(value), close).length);
    }
    case "transfers": {
      // { confirmed, rejected: [{ out, in }] } ("entity/txn id"): a pair is dated by this entity's side(s); closed pairs stay decided
      if (!close) return null;
      const dates = new Map(b.stored().map((t) => [`${b.entity}/${t.id}`, t.date]));
      const pairs = (v: unknown) =>
        (["confirmed", "rejected"] as const).flatMap((k) =>
          (((v ?? {}) as Record<string, { out: string; in: string }[]>)[k] ?? []).flatMap((p) => {
            const d = [dates.get(p.out), dates.get(p.in)].filter((x): x is string => !!x).sort()[0];
            return d ? [{ id: `${k}|${p.out}|${p.in}`, date: d }] : [];
          }),
        );
      return refuse(close, movedBefore(pairs(b.doc(name, {})), pairs(value), close).length);
    }
    case "tags": {
      if (!close) return null;
      // which tags a closed transaction carries is settled with its period (deductions read them)
      const dates = new Map(b.stored().map((t) => [t.id, t.date])),
        on = (v: unknown) =>
          Object.entries(((v ?? {}) as Partial<TagsDoc>).on ?? {}).flatMap(([id, tags]) => {
            const date = dates.get(baseId(id));
            return date ? [{ id, date, tags: [...tags].sort() }] : [];
          });
      return refuse(close, movedBefore(on(b.doc(name, null)), on(value), close).length);
    }
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
      // a trip changes what the Taxximizer counts, not the ledger: a closed trip stays, and only the trips that changed are checked
      if (close) {
        const dated = (v: unknown) => ((Array.isArray(v) ? v : []) as Trip[]).map((x) => ({ ...x, date: x.start }));
        const r = refuse(close, movedBefore(dated(b.doc(name, [])), dated(value), close).length);
        if (r) return r;
      }
      for (const x of changedItems<Trip>(b.doc(name, []), value)) {
        const p = tripProblem(x);
        if (p) return { bad: `Trip ${x.name ? `“${x.name}” ` : ""}${TRIP[p]}.` };
      }
      return null;
    }
    case "payroll": {
      // a run is the provider's figures, checked against each other (no tax is calculated); a closed run stays
      if (close) {
        const dated = (v: unknown) => ((Array.isArray(v) ? v : []) as PayrollRun[]).map((x) => ({ ...x, date: x.payDate }));
        const r = refuse(close, movedBefore(dated(b.doc(name, [])), dated(value), close).length);
        if (r) return r;
      }
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
    case "assets": {
      if (value === null || value === undefined) return null;
      if (!Array.isArray(value)) return { bad: "Assets must be a list." };
      const seen = new Set<string>();
      for (const x of value as Partial<AssetAccount>[]) {
        const p = assetProblem(x);
        if (p) return { bad: `Asset ${x?.name ? `“${x.name}” ` : ""}${ASSET[p]}.` };
        if (seen.has(x.id!)) return { bad: `Duplicate asset id “${x.id}”.` };
        seen.add(x.id!);
      }
      return null;
    }
    default:
      return null;
  }
}

/** Why an issued document (or approved bill) write is refused. */
const issuedRefusal = (p: DocProblem | { code: "deleteIssued" | "closed"; number: string }, close: string | null): Refusal => {
  const n = "number" in p ? p.number : "";
  switch (p.code) {
    case "deleteIssued":
      return { bad: `Document ${n} is issued: it can't be deleted. Issue a cancellation for it instead.` };
    case "editIssued":
      return { bad: `Document ${n} is issued: it can't be changed, renumbered or turned back into a draft. Only its payments can change.` };
    case "cancelled":
      return { bad: `Document ${n} is cancelled: it can't change any more.` };
    case "date":
      return { bad: "A document needs a real issue date (YYYY-MM-DD) to be issued." };
    case "kind":
      return { bad: "Unknown document type." };
    case "status":
      return { bad: "A document is cancelled only by issuing a cancellation for it." };
    case "backdate":
      return { bad: `A document can't be dated before the last one of its type (${p.last}).` };
    case "cancelTarget":
      return { bad: "A cancellation must point at an issued document that isn't already cancelled." };
    case "closed":
      return {
        closed: `The books are closed through ${"close" in p ? p.close : close}: ${n ? `bill ${n}` : "this document"} is dated on or before it. Move the close date to change it.`,
      };
  }
};
/**
 * Issued documents and approved bills against what is stored (`before`): invoices are numbered and frozen once issued, approved bills
 * stay. The caller runs this inside the write's own transaction, so two tabs issuing at once can't take the same number.
 */
export function issuedWrite(b: BooksView, name: string, before: unknown, value: unknown): { value: unknown } | Refusal {
  const list = (v: unknown) => (Array.isArray(v) ? (v as IssuedDoc[]) : []);
  const close = closeDate(b);
  if (name === "invoices") {
    const r = issueDocs(list(before), list(value), close);
    if ("problem" in r) return issuedRefusal(r.problem, close);
    return { value: value === null || value === undefined ? value : r.docs };
  }
  if (name === "bills") {
    const p = billProblem(list(before), list(value), close);
    if (p) return issuedRefusal(p, close);
  }
  return { value };
}
