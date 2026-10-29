// Linking invoice and bill payments to the bank rows that hold the money. A payment recorded without a bank row (txn null) clears receivable /
// payable on the accrual basis while the deposit it describes is still ordinary revenue / expense in the ledger: counted twice. So the
// accrual basis (basis.ts) first links each such payment to its bank row when that is unambiguous, and the UI offers the rest as one-click links.
// Pure and deterministic: the same books always link the same way, whatever the input order.
//
// Auto-link needs all of: same direction (money in for invoices, out for bills); exactly the amount still left on the row, to the cent; the
// row dated within WINDOW days of the payment (and not before the document); a row filed where the money would hit the P&L (revenue or
// other income, expense or cost of sales, or not categorised yet); the same currency (a document in another currency is never linked);
// and a reason to believe it is this customer: the document number in the row's text, or the customer's name in it. One bank row per payment.
import type { Txn } from "@openbooks/schema";
import type { AgingSource } from "./accrual.ts";
import { daysBetween } from "./accrual.ts";
import { plOf, payerOf, type PlLine } from "./reports.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;
const cents = (n: number) => Math.round(Math.abs(n) * 100);

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

/** Days a bank row may sit from the payment's date and still be taken for it. */
export const LINK_WINDOW = 7;
/** How far the suggestion for a payment that did not auto-link may look. */
export const SUGGEST_WINDOW = 60;
const NAME_MIN = 0.5;

export interface LinkOptions {
  /** The books' currency. A document in another currency is never linked (its amount is not the bank row's). */
  currency?: string | undefined;
}
type Dir = 1 | -1;
const PL: Record<Dir, readonly PlLine[]> = { 1: ["revenue", "other", "ask"], [-1]: ["cogs", "expense", "ask"] };
const text = (t: Txn) => `${payerOf(t)} ${t.memo ?? ""} ${t.desc}`;
const isoDate = (s: string) => s.slice(0, 10);

/** The payment has no bank row yet and a document that can be linked. */
const linkable = (s: AgingSource, o: LinkOptions) => !s.payable && (!s.currency || !o.currency || s.currency === o.currency);

/** How well a bank row fits a payment: 0 = not at all; otherwise 1 + the document number in its text (2) + the name overlap. */
function evidence(s: AgingSource, t: Txn): number {
  const hay = text(t);
  const ref = (s.ref ?? "").trim();
  const byRef = ref.length >= 3 && hay.toLowerCase().includes(ref.toLowerCase()) ? 2 : 0;
  return byRef + similarity(s.name, hay);
}

interface Slot {
  s: AgingSource;
  i: number;
  key: string;
}
interface Pair {
  slot: Slot;
  t: Txn;
  score: number;
  gap: number;
}
const keyOf = (id: string, i: number) => `${id}\u0000${i}`;

/** The money each row has already been applied to (payments that name it), so only what is left can be linked. */
function taken(docs: readonly AgingSource[]) {
  const m = new Map<string, number>();
  for (const s of docs) for (const p of s.payments) if (p.txn) m.set(p.txn, r2((m.get(p.txn) ?? 0) + Math.abs(+p.amount || 0)));
  return m;
}

/** Pairs of (unlinked payment, bank row) that fit, strongest first; each slot and each row used once. */
function assign(docs: readonly AgingSource[], txns: readonly Txn[], dir: Dir, o: LinkOptions, loose: boolean) {
  const used = new Set<string>();
  const slots: Slot[] = [];
  for (const s of docs)
    if (linkable(s, o))
      s.payments.forEach((p, i) => {
        if (!p.txn && +p.amount > 0) slots.push({ s, i, key: keyOf(s.id, i) });
      });
  const left = new Map<string, number>(),
    spent = taken(docs);
  const rows = txns.filter((t) => Math.sign(t.amount) === dir && PL[dir].includes(plOf(t.category) ?? ("" as PlLine)));
  for (const t of rows) left.set(t.id, cents(t.amount) - Math.round((spent.get(t.id) ?? 0) * 100));
  const window = loose ? SUGGEST_WINDOW : LINK_WINDOW;
  const pairs: Pair[] = [];
  for (const slot of slots) {
    const p = slot.s.payments[slot.i]!,
      want = cents(+p.amount);
    for (const t of rows) {
      if (left.get(t.id) !== want || t.date < slot.s.date) continue;
      const gap = Math.abs(daysBetween(isoDate(p.date), isoDate(t.date)));
      if (gap > window) continue;
      const ev = evidence(slot.s, t);
      if (!loose && ev < NAME_MIN) continue;
      pairs.push({ slot, t, score: ev, gap });
    }
  }
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      a.gap - b.gap ||
      a.t.date.localeCompare(b.t.date) ||
      a.t.id.localeCompare(b.t.id) ||
      a.slot.s.id.localeCompare(b.slot.s.id) ||
      a.slot.i - b.slot.i,
  );
  const out = new Map<string, Txn>();
  for (const x of pairs) {
    if (out.has(x.slot.key) || used.has(x.t.id)) continue;
    out.set(x.slot.key, x.t);
    used.add(x.t.id);
  }
  return out;
}

/**
 * The documents with every unambiguous unlinked payment pointed at its bank row (date moved to the row's). `docs` are one side only: all
 * invoices (dir 1) or all bills (dir -1). `txns` is the cash ledger. Payroll runs (own payable account) are left to payroll's own matching.
 */
export function autoLink(docs: readonly AgingSource[], txns: readonly Txn[], dir: Dir, o: LinkOptions = {}): AgingSource[] {
  const made = assign(docs, txns, dir, o, false);
  if (!made.size) return [...docs];
  return docs.map((s) =>
    s.payments.some((_, i) => made.has(keyOf(s.id, i)))
      ? {
          ...s,
          payments: s.payments.map((p, i) =>
            made.has(keyOf(s.id, i)) ? { ...p, txn: made.get(keyOf(s.id, i))!.id, date: made.get(keyOf(s.id, i))!.date } : p,
          ),
        }
      : s,
  );
}

/** A payment still without a bank row after auto-link: money received or paid outside the books, or a match to confirm. */
export interface Unlinked {
  kind: "ar" | "ap";
  /** The invoice / bill id and the payment's id in it. */
  doc: string;
  payment: string;
  ref: string;
  name: string;
  amount: number;
  date: string;
  /** The best bank row for it (same amount, within SUGGEST_WINDOW days), for a one-click link; null when there is none. */
  suggest: { id: string; date: string; desc: string; amount: number } | null;
}

/** What auto-link left: payments with no bank row, each with the most likely bank row to link it to. */
export function unlinkedPayments(ar: readonly AgingSource[], ap: readonly AgingSource[], txns: readonly Txn[], o: LinkOptions = {}): Unlinked[] {
  const out: Unlinked[] = [];
  for (const [kind, dir, docs] of [
    ["ar", 1, ar],
    ["ap", -1, ap],
  ] as const) {
    const linked = autoLink(docs, txns, dir, o);
    const hints = assign(linked, txns, dir, o, true);
    for (const s of linked) {
      if (s.payable) continue;
      s.payments.forEach((p, i) => {
        if (p.txn || !(+p.amount > 0)) return;
        const t = hints.get(keyOf(s.id, i));
        out.push({
          kind,
          doc: s.id,
          payment: p.id ?? `${s.id}-p${i + 1}`,
          ref: s.ref,
          name: s.name,
          amount: r2(+p.amount),
          date: p.date,
          suggest: t ? { id: t.id, date: t.date, desc: t.desc, amount: t.amount } : null,
        });
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.doc.localeCompare(b.doc));
}

/**
 * The stored invoice / bill with one payment pointed at a bank row. A document marked paid the old way (no payments list: the whole total on
 * `paidDate`) gets `paidTxn` / `paidDate`, which both readers still understand; otherwise the payment in the list is updated.
 */
export function linkPayment<
  D extends {
    id: string;
    payments?: readonly { id: string; txn: string | null; amount: number; date: string }[];
    paidTxn?: string | null;
    paidDate?: string | null;
  },
>(d: D, payment: string, txn: { id: string; date: string }): D {
  if (d.payments?.some((p) => p.id === payment))
    return { ...d, payments: d.payments.map((p) => (p.id === payment ? { ...p, txn: txn.id, date: txn.date } : p)) };
  if (!d.payments && payment === `${d.id}-p1`) return { ...d, paidTxn: txn.id, paidDate: txn.date };
  return d;
}
