// Invoices, bills and receipts: pure helpers over the books docs "invoices" and "customers" (port of web/src/lib/invoices.js + VAT).
// invoice: { id, kind, number: null until issued, customer, items: [{ desc, qty, price }], issued, due, currency, notes, method,
//            status: "draft"|"open"|"paid", paidTxn, paidDate, ref, created, vat?, noVat? }
// US books issue "invoice". Israeli exempt books (osek patur / zair) issue "bill" (חשבון עסקה) and "receipt" (קבלה), never a
// חשבונית מס. VAT-registered Israeli books (osek murshe, ltd) also issue "tax" (חשבונית מס) and add VAT to every document.
// `vat` is the rate frozen on the document when it is saved (from the issue year's table), so issued documents never change.
import { isBiz, payerOf } from "@openbooks/core";
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
export type Status = "draft" | "unpaid" | "overdue" | "paid";

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

/** draft | unpaid | overdue | paid. Receipts document a payment, so an issued receipt is paid. */
export function status(inv: Invoice, now = today()): Status {
  if (inv.status === "draft") return "draft";
  if (inv.status === "paid" || inv.kind === "receipt") return "paid";
  return inv.due && inv.due < now ? "overdue" : "unpaid";
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

/** Incoming transactions that could pay inv, best first. taken: txn ids already linked to another document. */
export function candidates(inv: Invoice, txns: readonly Txn[], taken = new Set<string>(), customerName = "") {
  const amt = total(inv),
    from = inv.issued ?? "";
  return txns
    .filter((t) => incoming(t) && t.date >= from && (!taken.has(t.id) || t.id === inv.paidTxn))
    .map((t) => ({ t, amountMatch: amt > 0 && Math.abs(t.amount - amt) <= amt * 0.01, sim: similarity(customerName, `${payerOf(t)} ${t.memo ?? ""}`) }))
    .sort((x, y) => +y.amountMatch - +x.amountMatch || y.sim - x.sim || x.t.date.localeCompare(y.t.date));
}

/** Business income no document points at, customer look-alikes first. */
export function unmatched(txns: readonly Txn[], invoices: readonly Invoice[], customers: readonly Customer[]) {
  const taken = new Set(invoices.map((i) => i.paidTxn).filter(Boolean));
  return txns
    .filter((t) => t.amount > 0 && isBiz(t.category) && !taken.has(t.id))
    .map((t) => {
      const c = customers.map((c) => ({ c, s: similarity(c.name, payerOf(t)) })).sort((a, b) => b.s - a.s)[0];
      return { t, customer: c && c.s >= 0.5 ? c.c : null };
    })
    .sort((a, b) => +!!b.customer - +!!a.customer || b.t.date.localeCompare(a.t.date));
}
