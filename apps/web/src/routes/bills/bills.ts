// Bills payable (accounts payable): pure helpers over the books docs "bills" and "vendors". The mirror of invoices/invoices.ts:
// money you owe, closed by the outgoing payment that settled it.
// bill:   { id, number, vendor: vendor id | null, date, due: string | null, lines: [{ desc, amount, account }], status: "draft"|"open"|"paid"|"void",
//           paidTxn, paidDate, memo, created? }
// vendor: { id, name, email?, address?, account? (default expense ledger account), terms? (days; 30 when missing) }
// Derived: "overdue" = open and past its due date. Amount due = the whole total of an open or overdue bill.
// ponytail: no partial payments (a bill is paid by one transaction or by hand); add paid[] and sum it in amountDue if that matters.
import { group, payerOf } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import { addDays, similarity, today } from "../invoices/invoices.ts";

export { addDays, today };
export { uid } from "../invoices/invoices.ts";

export type BillStatus = "draft" | "open" | "paid" | "void";
export type Status = BillStatus | "overdue";
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
  paidTxn: string | null;
  paidDate: string | null;
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
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const lineAmount = (l: Line) => +l.amount || 0;
export const total = (b: Pick<Bill, "lines">) => r2((b.lines ?? []).reduce((a, l) => a + lineAmount(l), 0));

/** draft | open | overdue | paid | void. */
export const status = (b: Pick<Bill, "status" | "due">, now = today()): Status => (b.status === "open" && b.due && b.due < now ? "overdue" : b.status);

/** Still owed to the vendor: the whole total of an open or overdue bill. */
export function amountDue(b: Bill, now = today()) {
  const s = status(b, now);
  return s === "open" || s === "overdue" ? total(b) : 0;
}

/** Next number in the BILL- series (a vendor's own reference can be typed over it). max+1, so a deleted draft is the only number ever reused. */
export function nextNumber(bills: readonly Bill[]) {
  const max = Math.max(0, ...bills.map((b) => +String(b.number).replace(/\D/g, "") || 0));
  return "BILL-" + String(max + 1).padStart(4, "0");
}

/** Due date on a vendor's terms (days; 30 when the vendor has none, like invoices). */
export const dueOf = (date: string, vendor?: Pick<Vendor, "terms">) => addDays(date, vendor?.terms ?? 30);

// money out that is never a vendor payment: own transfers, owner draws, savings, personal spending
const NOT_BILL = new Set(["transfer", "own", "equity", "capital", "personal"]);
export const outgoing = (t: Txn) => t.amount < 0 && !NOT_BILL.has(group(t.category));

/** Outgoing transactions that could have paid b, best first: amount within 1%, then payee name, then the earliest date.
 *  taken: txn ids already linked to another bill. */
export function candidates(b: Bill, txns: readonly Txn[], taken = new Set<string>(), vendorName = "") {
  const amt = total(b);
  return txns
    .filter((t) => outgoing(t) && t.date >= b.date && (!taken.has(t.id) || t.id === b.paidTxn))
    .map((t) => ({ t, amountMatch: amt > 0 && Math.abs(-t.amount - amt) <= amt * 0.01, sim: similarity(vendorName, `${payerOf(t)} ${t.memo ?? ""}`) }))
    .sort((x, y) => +y.amountMatch - +x.amountMatch || y.sim - x.sim || x.t.date.localeCompare(y.t.date));
}

const COST = new Set(["expense", "cogs"]);
/** Business spending no bill points at, vendor look-alikes first. */
export function unmatched(txns: readonly Txn[], bills: readonly Bill[], vendors: readonly Vendor[]) {
  const taken = new Set(bills.map((b) => b.paidTxn).filter(Boolean));
  return txns
    .filter((t) => t.amount < 0 && COST.has(group(t.category)) && !taken.has(t.id))
    .map((t) => {
      const v = vendors.map((v) => ({ v, s: similarity(v.name, payerOf(t)) })).sort((a, b) => b.s - a.s)[0];
      return { t, vendor: v && v.s >= 0.5 ? v.v : null };
    })
    .sort((a, b) => +!!b.vendor - +!!a.vendor || b.t.date.localeCompare(a.t.date));
}

/** Per vendor id: still owed, and paid to date. */
export function byVendor(bills: readonly Bill[], now = today()) {
  const m = new Map<string, { owed: number; paid: number }>();
  for (const b of bills) {
    if (!b.vendor) continue;
    const r = m.get(b.vendor) ?? { owed: 0, paid: 0 };
    r.owed = r2(r.owed + amountDue(b, now));
    if (b.status === "paid") r.paid = r2(r.paid + total(b));
    m.set(b.vendor, r);
  }
  return m;
}
