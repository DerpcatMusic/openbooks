// Accrual documents (bills payable, invoices): payments as applications, derived status, aging. Pure: pass docs in, get numbers out.
// A document stores only draft | open | cancelled; paid, partial and overdue are derived from the payments applied to it (Mercury Books
// works the same way: docs/mercury-books-spec.md section 5). Money is decimal with 2 places.

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** One payment applied to a document: part (or all) of a bank transaction, or money paid outside the books (txn null). */
export interface Payment {
  id: string;
  txn: string | null;
  amount: number;
  date: string;
}
export type Display = "draft" | "open" | "partial" | "paid" | "overdue" | "cancelled";

/** Paid so far (on or before `asOf` when given). */
export const paidOf = (ps: readonly Pick<Payment, "amount" | "date">[] | undefined, asOf?: string) =>
  r2(sum((ps ?? []).filter((p) => !asOf || p.date <= asOf).map((p) => +p.amount || 0)));
export const outstanding = (gross: number, ps: readonly Pick<Payment, "amount" | "date">[] | undefined, asOf?: string) => r2(gross - paidOf(ps, asOf));

/** Mercury's display status. Draft and cancelled pass through; an open document is paid (gross > 0, nothing left), partial (some paid),
 *  overdue (past due) or open. A credit memo (gross <= 0) is never paid or partial. Legacy "void" reads as cancelled. */
export function displayStatus(stored: string, gross: number, paid: number, due: string | null | undefined, now: string): Display {
  if (stored === "draft") return "draft";
  if (stored === "cancelled" || stored === "void") return "cancelled";
  const left = r2(gross - paid);
  if (stored === "paid" || (gross > 0 && left <= 0)) return "paid";
  if (gross > 0 && paid > 0 && left < gross) return "partial";
  return due && due < now ? "overdue" : "open";
}

// ---------- migration of the old single-payment shape ----------
interface LegacyBill {
  id: string;
  date: string;
  lines?: readonly { amount?: unknown }[];
  status?: string;
  payments?: Payment[];
  paidTxn?: string | null;
  paidDate?: string | null;
}
export const billTotal = (b: Pick<LegacyBill, "lines">) => r2(sum((b.lines ?? []).map((l) => +(l.amount as number) || 0)));
export type Migrated<B> = Omit<B, "paidTxn" | "paidDate" | "status" | "payments"> & { status: "draft" | "open" | "cancelled"; payments: Payment[] };
/** The old bill (status paid | void, one paidTxn) as the payments model: paid becomes open with one payment for the whole total, void
 *  cancelled. Bills already in the new shape come back unchanged. Run on read; the next save writes the new shape. */
export function migrateBill<B extends LegacyBill>(b: B): Migrated<B> {
  const { paidTxn, paidDate, status, payments, ...rest } = b;
  const legacy = payments === undefined && (status === "paid" || paidTxn);
  return {
    ...rest,
    status: status === "paid" ? "open" : status === "void" || status === "cancelled" ? "cancelled" : status === "draft" ? "draft" : "open",
    payments: payments ?? (legacy ? [{ id: `${b.id}-p1`, txn: paidTxn ?? null, amount: billTotal(b), date: paidDate ?? b.date }] : []),
  } as Migrated<B>;
}

// ---------- aging ----------
export interface AgingBucket {
  key: string;
  /** "Current" is the key `current`; the others read "1-30", "31-60", "91+". */
  label: string;
  min: number;
  max: number | null;
}
/** One document to age: what is owed, to/by whom, due when. `payments` are applied by date, so a past as-of date ages the document as it then stood. */
export interface AgingSource {
  id: string;
  party: string | null;
  name: string;
  ref: string;
  date: string;
  due: string | null;
  gross: number;
  payments: readonly Pick<Payment, "amount" | "date">[];
}
export interface AgingSourceRow {
  id: string;
  party: string | null;
  name: string;
  ref: string;
  date: string;
  due: string | null;
  gross: number;
  outstanding: number;
  /** asOf minus due date (the issue date when there is none); <= 0 is current. */
  days: number;
  bucket: number;
}
export interface AgingParty {
  party: string | null;
  name: string;
  buckets: number[];
  overdue: number;
  total: number;
  count: number;
  /** Most days past due among this party's documents (0 when none is). */
  oldest: number;
}
export interface AgingReport {
  asOf: string;
  periods: number;
  days: number;
  buckets: AgingBucket[];
  parties: AgingParty[];
  sources: AgingSourceRow[];
  totals: { buckets: number[]; percents: number[] | null; overdue: number; total: number; count: number; parties: number };
}

export const MAX_PERIODS = 12;
const DAY = 86400000;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Current, then `periods` buckets of `days` days past due, then the open-ended last one. */
export function agingBuckets(periods = 3, days = 30): AgingBucket[] {
  const out: AgingBucket[] = [{ key: "current", label: "current", min: -Infinity, max: 0 }];
  for (let k = 0; k < periods; k++) out.push({ key: `b${k + 1}`, label: `${k * days + 1}-${(k + 1) * days}`, min: k * days + 1, max: (k + 1) * days });
  out.push({ key: `b${periods + 1}`, label: `${periods * days + 1}+`, min: periods * days + 1, max: null });
  return out;
}
/** Bucket index for a document `over` days past due (<= 0: current). */
export const bucketOf = (over: number, periods = 3, days = 30) => (over <= 0 ? 0 : Math.min(periods + 1, Math.ceil(over / days)));

/** Each bucket's share of the total in percent with one decimal, adjusted so the shares add to exactly 100.0 (null: nothing to split). */
export function percents(values: readonly number[]): number[] | null {
  const total = sum(values);
  if (total <= 0 || values.length < 2) return null;
  const out = values.map((v) => Math.round((v / total) * 1000) / 10);
  const big = values.indexOf(Math.max(...values));
  out[big] = Math.round((out[big]! + (100 - sum(out))) * 10) / 10;
  return out;
}

/** Aged balances as of a date. Documents issued after it, or with nothing outstanding then, are left out. */
export function agingReport(sources: readonly AgingSource[], asOf: string, opts: { periods?: number; days?: number; parties?: readonly (string | null)[] } = {}): AgingReport {
  const periods = Math.min(MAX_PERIODS, Math.max(1, Math.trunc(opts.periods ?? 3) || 3)),
    days = Math.max(1, Math.trunc(opts.days ?? 30) || 30);
  const want = opts.parties?.length ? new Set(opts.parties) : null;
  const rows: AgingSourceRow[] = sources
    .filter((s) => s.date <= asOf && (!want || want.has(s.party)))
    .map((s) => {
      const left = outstanding(s.gross, s.payments, asOf),
        over = daysBetween(s.due ?? s.date, asOf);
      return { id: s.id, party: s.party, name: s.name, ref: s.ref, date: s.date, due: s.due, gross: s.gross, outstanding: left, days: over, bucket: bucketOf(over, periods, days) };
    })
    .filter((r) => r.outstanding !== 0);
  const by = new Map<string | null, AgingSourceRow[]>();
  for (const r of rows) by.set(r.party, [...(by.get(r.party) ?? []), r]);
  const parties = [...by]
    .map(([party, rs]): AgingParty => {
      const buckets = Array.from({ length: periods + 2 }, (_, i) => r2(sum(rs.filter((r) => r.bucket === i).map((r) => r.outstanding))));
      return {
        party,
        name: rs[0]!.name,
        buckets,
        overdue: r2(sum(buckets.slice(1))),
        total: r2(sum(buckets)),
        count: rs.length,
        oldest: Math.max(0, ...rs.map((r) => r.days)),
      };
    })
    .sort((a, b) => +!a.name - +!b.name || a.name.localeCompare(b.name));
  const order = new Map(parties.map((p, i) => [p.party, i]));
  const buckets = Array.from({ length: periods + 2 }, (_, i) => r2(sum(parties.map((p) => p.buckets[i]!))));
  return {
    asOf,
    periods,
    days,
    buckets: agingBuckets(periods, days),
    parties,
    sources: rows.sort((a, b) => order.get(a.party)! - order.get(b.party)! || b.days - a.days || a.id.localeCompare(b.id)),
    totals: { buckets, percents: percents(buckets), overdue: r2(sum(buckets.slice(1))), total: r2(sum(buckets)), count: rows.length, parties: parties.length },
  };
}

// ---------- the docs as aging sources ----------
interface InvoiceLike {
  id: string;
  kind?: string;
  number?: string | null;
  customer?: string | null;
  items?: readonly { qty?: unknown; price?: unknown }[];
  vat?: number;
  issued?: string;
  due?: string | null;
  status?: string;
  payments?: readonly Payment[];
  paidDate?: string | null;
}
/** What the customer pays: items plus VAT (the same total as the Invoices page). */
export const invoiceTotal = (i: Pick<InvoiceLike, "items" | "vat">) => {
  const net = r2(sum((i.items ?? []).map((x) => (+(x.qty as number) || 0) * (+(x.price as number) || 0))));
  return r2(net + r2(net * (i.vat ?? 0)));
};
/** Issued invoices that ask for money: not drafts, not receipts (a receipt documents a payment). A document the old way marked paid counts as
 *  one payment of its whole total on its paid date. */
export function invoiceSources(invoices: readonly InvoiceLike[], customer: (id: string | null) => string): AgingSource[] {
  return invoices
    .filter((i) => i.status && i.status !== "draft" && i.status !== "cancelled" && i.kind !== "receipt" && i.issued)
    .map((i) => {
      const gross = invoiceTotal(i);
      return {
        id: i.id,
        party: i.customer ?? null,
        name: customer(i.customer ?? null),
        ref: i.number ?? "",
        date: i.issued!,
        due: i.due ?? null,
        gross,
        payments: i.payments ?? (i.status === "paid" ? [{ amount: gross, date: i.paidDate ?? i.issued! }] : []),
      };
    });
}
interface BillLike extends LegacyBill {
  number?: string;
  vendor?: string | null;
  due?: string | null;
}
/** Approved (open) bills. Old-shape bills are migrated on the way in; cancelled and draft ones are not owed. */
export function billSources(bills: readonly BillLike[], vendor: (id: string | null) => string): AgingSource[] {
  return bills
    .map(migrateBill)
    .filter((b) => b.status === "open")
    .map((b) => ({ id: b.id, party: b.vendor ?? null, name: vendor(b.vendor ?? null), ref: b.number ?? "", date: b.date, due: b.due ?? null, gross: billTotal(b), payments: b.payments }));
}

/** Total still outstanding on `iso` across sources, and the part of it issued before that year (it lands in retained earnings, not the year's). */
export function openAt(sources: readonly AgingSource[], iso: string): { total: number; prior: number } {
  const y = `${iso.slice(0, 4)}-01-01`;
  let total = 0,
    prior = 0;
  for (const s of sources) {
    if (s.date > iso) continue;
    const left = outstanding(s.gross, s.payments, iso);
    total += left;
    if (s.date < y) prior += left;
  }
  return { total: r2(total), prior: r2(prior) };
}
