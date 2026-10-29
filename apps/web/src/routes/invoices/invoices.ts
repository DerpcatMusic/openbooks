// Invoices, bills and receipts: pure helpers over the books docs "invoices" and "customers" (port of web/src/lib/invoices.js + VAT).
// invoice: { id, kind, number: null until issued, customer, items: [{ desc, qty, price }], issued, due, currency, notes, method,
//            status: "draft"|"open"|"paid", paidTxn, paidDate, ref, created, vat?, noVat? }
// US books issue "invoice". Israeli exempt books (osek patur / zair) issue "bill" (חשבון עסקה) and "receipt" (קבלה), never a
// חשבונית מס. VAT-registered Israeli books (osek murshe, ltd) also issue "tax" (חשבונית מס) and add VAT to every document.
// `vat` is the rate frozen on the document when it is saved (from the issue year's table), so issued documents never change.
import { isBiz, paidOf, payerOf, type Payment } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";

export type Kind = "invoice" | "bill" | "receipt" | "tax";
export interface Line {
  desc: string;
  qty: number | string;
  price: number | string;
}
export interface Invoice {
  id: string;
  kind: Kind;
  number: string | null;
  customer: string | null;
  items: Line[];
  issued: string;
  due: string | null;
  currency?: string;
  notes?: string;
  method?: string;
  status: "draft" | "open" | "paid";
  paidTxn: string | null;
  paidDate: string | null;
  /** Partial payments applied (see Payment in core). Missing = none, or one payment of the whole total when status is "paid". */
  payments?: Payment[];
  ref: string | null;
  /** Kind of the document `ref` numbers (a receipt for a bill or a tax invoice); missing = bill. */
  refKind?: Kind;
  created?: string;
  /** VAT rate on this document (0.18); missing = none. */
  vat?: number;
  /** VAT-registered books: this document charges 0% (e.g. services exported abroad). */
  noVat?: boolean;
}
export interface Customer {
  id: string;
  name: string;
  email?: string;
  address?: string;
}
export type Status = "draft" | "unpaid" | "partial" | "overdue" | "paid";

export const today = () => new Date().toLocaleDateString("sv"); // local YYYY-MM-DD
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv");
};
export const uid = () => Math.random().toString(36).slice(2, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Document kinds the books can issue: US invoice; IL exempt bill/receipt; IL VAT-registered tax invoice too. */
export const kindsFor = (us: boolean, registered: boolean): Kind[] => (us ? ["invoice"] : registered ? ["tax", "bill", "receipt"] : ["bill", "receipt"]);

export const lineTotal = (i: Line) => (+i.qty || 0) * (+i.price || 0);
/** Before VAT. */
export const net = (inv: Pick<Invoice, "items">) => r2((inv.items ?? []).reduce((a, i) => a + lineTotal(i), 0));
export const vatOf = (inv: Pick<Invoice, "items" | "vat">) => r2(net(inv) * (inv.vat ?? 0));
/** What the customer pays: net + VAT. */
export const total = (inv: Pick<Invoice, "items" | "vat">) => r2(net(inv) + vatOf(inv));

/** What has been paid on an invoice: the payments applied, else its whole total when it was marked paid the old way. A receipt documents a payment. */
export const paidAmount = (inv: Invoice) =>
  inv.kind === "receipt" ? total(inv) : inv.payments?.length ? paidOf(inv.payments) : inv.status === "paid" ? total(inv) : 0;
/** Still owed: the total less what was paid (0 for a draft, a receipt or a settled invoice). */
export const owedOf = (inv: Invoice) => (inv.status === "draft" || inv.kind === "receipt" ? 0 : Math.max(0, r2(total(inv) - paidAmount(inv))));
/** Issued, still owing and past its due date (a partly paid invoice counts). */
export const isLate = (inv: Invoice, now = today()) => !!inv.due && inv.due < now && owedOf(inv) > 0;

/** draft | unpaid | partial | overdue | paid. Receipts document a payment, so an issued receipt is paid. Partly paid wins over overdue (Mercury's
 *  order); isLate tells whether it is past due as well. */
export function status(inv: Invoice, now = today()): Status {
  if (inv.status === "draft") return "draft";
  if (inv.status === "paid" || inv.kind === "receipt") return "paid";
  const t = total(inv),
    p = paidAmount(inv);
  if (t > 0 && p >= t) return "paid";
  if (t > 0 && p > 0) return "partial";
  return inv.due && inv.due < now ? "overdue" : "unpaid";
}

// ---------- payment applications (a payment can cover part of an invoice; a transaction can pay several) ----------
/** Per transaction id: how much the documents have taken of it. A document marked paid the old way (one paidTxn) takes the whole transaction.
 *  skip leaves documents out (the one being edited, a receipt that shares its bill's payment). */
export function applied(invoices: readonly Invoice[], skip: (i: Invoice) => boolean = () => false) {
  const m = new Map<string, number>();
  for (const i of invoices) {
    if (skip(i)) continue;
    if (i.payments?.length) for (const p of i.payments) p.txn && m.set(p.txn, r2((m.get(p.txn) ?? 0) + p.amount));
    else if (i.paidTxn) m.set(i.paidTxn, Infinity);
  }
  return m;
}
export const remaining = (t: Pick<Txn, "id" | "amount">, taken: ReadonlyMap<string, number>) => Math.max(0, r2(Math.abs(t.amount) - (taken.get(t.id) ?? 0)));
/** The invoice's payments with `amount` of a transaction (or money received outside the books: txn null) added, capped at what is owed and at
 *  what is left of the transaction. Unchanged when nothing can be applied. `owed` is what the invoice still owes (VAT included). */
export function apply(
  inv: Invoice,
  owed: number,
  txn: Pick<Txn, "id" | "amount" | "date"> | null,
  amount: number,
  date: string,
  taken: ReadonlyMap<string, number>,
  id: string,
): Payment[] {
  const have = inv.payments ?? [];
  const a = r2(Math.min(amount, owed, txn ? remaining(txn, taken) : Infinity));
  return a > 0 ? [...have, { id, txn: txn?.id ?? null, amount: a, date: txn?.date ?? date }] : have;
}

/** Next number in this kind's series. Numbers are given only when a document is issued, and only drafts can be deleted,
 *  so max+1 never reuses a number. US: INV-0001. IL: one running series per document type, 0001. */
export function nextNumber(invoices: readonly Invoice[], kind: Kind) {
  const prefix = kind === "invoice" ? "INV-" : "";
  const max = Math.max(0, ...invoices.filter((i) => i.kind === kind && i.number).map((i) => +String(i.number).replace(/\D/g, "") || 0));
  return prefix + String(max + 1).padStart(4, "0");
}

const words = (s: string) =>
  new Set(
    (s ?? "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3),
  );
/** 0..1: share of the customer name's words found in the payer text. */
export function similarity(name: string, payer: string) {
  const a = words(name),
    b = words(payer);
  if (!a.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w) || [...b].some((x) => x.includes(w) || w.includes(x))) n++;
  return n / a.size;
}

// money in that is never a customer paying: own transfers, owner money, cashback, savings, IDF pay
const NOT_PAYMENT = new Set(["transfer", "own", "equity", "other-income", "capital", "exempt"]);
export const incoming = (t: Txn) => t.amount > 0 && !NOT_PAYMENT.has((t.category || "ask").split(":")[0]!);

/** Days a payment may land after the due date and still count as the exact fit (Mercury's rule). */
export const GRACE = 14;
/** Incoming transactions with money left that could pay inv (owed: what it still owes, VAT included), best first: the exact fit (what is left of
 *  the transaction equals what is owed, dated issue .. due + 14 days), then the amount within 1%, then the payer's name, then the earliest date.
 *  taken: how much of each transaction the documents already took. */
export function candidates(inv: Invoice, owed: number, txns: readonly Txn[], taken: ReadonlyMap<string, number> = new Map(), customerName = "") {
  const from = inv.issued ?? "",
    until = addDays(inv.due ?? from, GRACE);
  return txns
    .filter((t) => incoming(t) && t.date >= from && remaining(t, taken) > 0)
    .map((t) => {
      const left = remaining(t, taken);
      return {
        t,
        left,
        exact: owed > 0 && left === owed && t.date <= until,
        amountMatch: owed > 0 && Math.abs(left - owed) <= owed * 0.01,
        sim: similarity(customerName, `${payerOf(t)} ${t.memo ?? ""}`),
      };
    })
    .sort((x, y) => +y.exact - +x.exact || +y.amountMatch - +x.amountMatch || y.sim - x.sim || x.t.date.localeCompare(y.t.date));
}

/** Business income no document points at (or only in part), customer look-alikes first. */
export function unmatched(txns: readonly Txn[], invoices: readonly Invoice[], customers: readonly Customer[]) {
  const taken = applied(invoices);
  return txns
    .filter((t) => t.amount > 0 && isBiz(t.category) && remaining(t, taken) > 0)
    .map((t) => {
      const c = customers.map((c) => ({ c, s: similarity(c.name, payerOf(t)) })).sort((a, b) => b.s - a.s)[0];
      return { t, customer: c && c.s >= 0.5 ? c.c : null };
    })
    .sort((a, b) => +!!b.customer - +!!a.customer || b.t.date.localeCompare(a.t.date));
}
