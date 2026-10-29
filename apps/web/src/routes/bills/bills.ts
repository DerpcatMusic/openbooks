// Bills payable (accounts payable): pure helpers over the books docs "bills" and "vendors". The mirror of invoices/invoices.ts:
// money you owe, settled by the outgoing payments applied to it.
// bill:   { id, number, vendor: vendor id | null, date, due: string | null, lines: [{ desc, amount, account }],
//           status: "draft"|"open"|"cancelled", payments: [{ id, txn: transaction id | null, amount, date }], memo, created? }
// vendor: { id, name, email?, address?, account? (default expense ledger account), terms? (days; 30 when missing),
//           US 1099-NEC: city?, state?, zip?, tin?, tinType?, w9?, payee?, exempt? }
// Stored status is only draft/open/cancelled. Paid, partially paid and overdue are derived (core displayStatus) from the payments, which are
// applications of bank transactions: one bill can take several payments, one transaction can pay several bills. Old docs (status paid | void,
// one paidTxn) are migrated on read by readBills; the next save writes the new shape.
import { daysBetween, displayStatus, group, migrateBill, outstanding, paidOf, payerOf, type Display, type Payment } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import { addDays, similarity, today } from "../invoices/invoices.ts";

export { addDays, today };
export { uid } from "../invoices/invoices.ts";
export type { Payment };

export type BillStatus = "draft" | "open" | "cancelled";
export type Status = Display;
export interface Line {
  desc: string;
  amount: number | string;
  /** Expense ledger account, e.g. "expense:software". */
  account: string;
}
export interface Bill {
  id: string;
  number: string;
  vendor: string | null;
  date: string;
  due: string | null;
  lines: Line[];
  status: BillStatus;
  payments: Payment[];
  memo: string;
  created?: string;
}
export interface Vendor {
  id: string;
  name: string;
  email?: string;
  address?: string;
  account?: string;
  terms?: number;
  /** US 1099-NEC details (see @openbooks/country-us Vendor1099): `address` is the street. */
  city?: string;
  state?: string;
  zip?: string;
  tin?: string;
  tinType?: "ssn" | "ein";
  w9?: boolean | string;
  payee?: "individual" | "corporation" | "foreign";
  exempt?: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const lineAmount = (l: Line) => +l.amount || 0;
export const total = (b: Pick<Bill, "lines">) => r2((b.lines ?? []).reduce((a, l) => a + lineAmount(l), 0));

/** The bills doc as it is stored today, whichever shape it was saved in. */
export const readBills = (raw: readonly unknown[]): Bill[] => raw.map((b) => migrateBill(b as Parameters<typeof migrateBill>[0]) as unknown as Bill);

export const paid = (b: Pick<Bill, "payments">) => paidOf(b.payments);
/** draft | open | partial | paid | overdue | cancelled. Partly paid wins over overdue; see isOverdue for the past-due test alone. */
export const status = (b: Pick<Bill, "status" | "due" | "lines" | "payments">, now = today()): Status => displayStatus(b.status, total(b), paid(b), b.due, now);

/** Open, still owing, and past its due date (a partly paid bill counts). */
export const isOverdue = (b: Bill, now = today()) => b.status === "open" && !!b.due && b.due < now && amountDue(b) > 0;

/** Still owed to the vendor: the total less the payments applied, for an open bill (0 for a draft or cancelled one). */
export const amountDue = (b: Bill) => (b.status === "open" ? Math.max(0, outstanding(total(b), b.payments)) : 0);

/** Next number in the BILL- series (a vendor's own reference can be typed over it). max+1, so a deleted draft is the only number ever reused. */
export function nextNumber(bills: readonly Bill[]) {
  const max = Math.max(0, ...bills.map((b) => +String(b.number).replace(/\D/g, "") || 0));
  return "BILL-" + String(max + 1).padStart(4, "0");
}

/** Due date on a vendor's terms (days; 30 when the vendor has none, like invoices). */
export const dueOf = (date: string, vendor?: Pick<Vendor, "terms">) => addDays(date, vendor?.terms ?? 30);

// ---------- payment applications ----------
/** Per transaction id: how much of it the bills have taken. */
export function applied(bills: readonly Bill[]) {
  const m = new Map<string, number>();
  for (const b of bills) for (const p of b.payments) if (p.txn) m.set(p.txn, r2((m.get(p.txn) ?? 0) + p.amount));
  return m;
}
/** What is left of a transaction's money to apply (0 when fully applied). */
export const remaining = (t: Pick<Txn, "id" | "amount">, taken: ReadonlyMap<string, number>) => Math.max(0, r2(Math.abs(t.amount) - (taken.get(t.id) ?? 0)));

/** Apply `amount` of a transaction (or money paid outside the books: txn null) to a bill. The amount is capped at what the bill still owes
 *  and, for a transaction, at what is left of it. Returns the bill's payments, unchanged when nothing can be applied. */
export function apply(
  b: Bill,
  txn: Pick<Txn, "id" | "amount" | "date"> | null,
  amount: number,
  date: string,
  taken: ReadonlyMap<string, number>,
  id: string,
): Payment[] {
  const cap = Math.min(Math.max(0, r2(total(b) - paid(b))), txn ? remaining(txn, taken) : Infinity);
  const a = r2(Math.min(amount, cap));
  return a > 0 ? [...b.payments, { id, txn: txn?.id ?? null, amount: a, date: txn?.date ?? date }] : b.payments;
}
export const unapply = (b: Bill, paymentId: string): Payment[] => b.payments.filter((p) => p.id !== paymentId);

// money out that is never a vendor payment: own transfers, owner draws, savings, personal spending
const NOT_BILL = new Set(["transfer", "own", "equity", "capital", "personal"]);
export const outgoing = (t: Txn) => t.amount < 0 && !NOT_BILL.has(group(t.category));

/** Days a payment may land after the due date and still be suggested for the bill (Mercury's rule). */
export const GRACE = 14;
/** Is the transaction inside the bill's suggestion window: bill date to due date + 14 days? */
export const inWindow = (b: Pick<Bill, "date" | "due">, date: string) => date >= b.date && date <= addDays(b.due ?? b.date, GRACE);

/** Outgoing transactions with money left that could pay b, best first: the exact fit first (what is left of the transaction equals what
 *  the bill still owes, and its date is in the window), then the fuzzy ranking: amount within 1% of what is owed, then payee name, then
 *  the earliest date. `taken`: the transactions' applied amounts across all bills. */
export function candidates(b: Bill, txns: readonly Txn[], taken: ReadonlyMap<string, number> = new Map(), vendorName = "") {
  const owed = amountDue(b);
  return txns
    .filter((t) => outgoing(t) && t.date >= b.date && remaining(t, taken) > 0)
    .map((t) => {
      const left = remaining(t, taken);
      return {
        t,
        left,
        exact: owed > 0 && left === owed && inWindow(b, t.date),
        amountMatch: owed > 0 && Math.abs(left - owed) <= owed * 0.01,
        sim: similarity(vendorName, `${payerOf(t)} ${t.memo ?? ""}`),
      };
    })
    .sort((x, y) => +y.exact - +x.exact || +y.amountMatch - +x.amountMatch || y.sim - x.sim || x.t.date.localeCompare(y.t.date));
}

/** Bills one outgoing payment fits exactly (open, owing what is left of the payment, payment inside the window), closest to its due date
 *  first, then overdue first, then earliest bill date, then id. */
export function suggestBills(t: Txn, bills: readonly Bill[], taken: ReadonlyMap<string, number>, now = today()): Bill[] {
  const left = remaining(t, taken);
  if (!outgoing(t) || left <= 0) return [];
  const gap = (b: Bill) => Math.abs(daysBetween(b.due ?? b.date, t.date));
  return bills
    .filter((b) => amountDue(b) === left && inWindow(b, t.date))
    .sort((a, b) => gap(a) - gap(b) || +isOverdue(b, now) - +isOverdue(a, now) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

const COST = new Set(["expense", "cogs"]);
/** Business spending no bill points at (or only partly), vendor look-alikes first. */
export function unmatched(txns: readonly Txn[], bills: readonly Bill[], vendors: readonly Vendor[]) {
  const taken = applied(bills);
  return txns
    .filter((t) => t.amount < 0 && COST.has(group(t.category)) && remaining(t, taken) > 0)
    .map((t) => {
      const v = vendors.map((v) => ({ v, s: similarity(v.name, payerOf(t)) })).sort((a, b) => b.s - a.s)[0];
      return { t, vendor: v && v.s >= 0.5 ? v.v : null };
    })
    .sort((a, b) => +!!b.vendor - +!!a.vendor || b.t.date.localeCompare(a.t.date));
}

/** Per vendor id: still owed, and paid to date (every payment applied, whatever the bill's state). Takes the doc in either shape. */
export function byVendor(raw: readonly unknown[]) {
  const m = new Map<string, { owed: number; paid: number }>();
  for (const b of readBills(raw)) {
    if (!b.vendor) continue;
    const r = m.get(b.vendor) ?? { owed: 0, paid: 0 };
    r.owed = r2(r.owed + amountDue(b));
    r.paid = r2(r.paid + paid(b));
    m.set(b.vendor, r);
  }
  return m;
}
