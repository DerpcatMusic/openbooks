// Accounting basis (doc "books" = { basis: "cash" | "accrual" }). The ledger is cash by nature: a bank row is income or an expense the day
// money moves. The accrual basis re-reads it with the invoices and bills the books holds:
//   - an issued invoice is revenue on its issue date (Dr Accounts receivable, Cr revenue), an approved bill is expense on its bill date
//     (Dr expense per line, Cr Accounts payable);
//   - a bank row matched to an invoice or bill is a payment: the matched part clears receivable / payable and leaves the P&L, so nothing counts twice;
//   - money applied outside the books (a payment with no bank row) clears receivable / payable alone: the balance sheet shows the gap as cash in transit.
// The result is a list of ledger rows, so P&L, cash flow, general ledger and the cash-flow analysis take it unchanged. Receivable and payable
// are the accounts "ar:accounts-receivable" and "ap:accounts-payable": not P&L types, so they never reach net income. Pure.
//
// Tax follows the law, not this switch: Israeli individuals in services report on cash basis (the receipt is the income event; playbook item
// il-cash-basis-timing, secondary practice, unverified) and a US sole proprietor on Schedule C normally uses the cash method (IRC 446), so
// the tax screens (1301, 5472, planner, Taxximizer) always read the cash ledger. A company (Israeli Ltd, US C-corp over the §448 gross-receipts
// test) is on accrual by law: its accountant's return is built from the accrual reports. docs/architecture.md § Accounting basis.
import type { Txn } from "@openbooks/schema";
import type { AgingSource } from "./accrual.ts";
import { plOf, pl } from "./reports.ts";

export type Basis = "cash" | "accrual";
export const AR_ACCOUNT = "ar:accounts-receivable";
export const AP_ACCOUNT = "ap:accounts-payable";
export const isReceivable = (c: string) => c.startsWith("ar:");
export const isPayable = (c: string) => c.startsWith("ap:");

const r2 = (n: number) => Math.round(n * 100) / 100 + 0; // + 0: never -0
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export interface AccrualOptions {
  /** Revenue account for an invoice that names none and was paid into none (the pack's first revenue account). */
  revenue: string;
  /** Expense account for a bill line that names none. */
  expense: string;
  /** The books' entries start date: documents dated before it are left out, like the ledger's own rows. */
  from?: string | null | undefined;
}

/**
 * The ledger on the accrual basis. `ar` are the issued invoices and `ap` the approved bills as aging sources (core accrual.ts), `txns` the cash
 * ledger. Rows keep their ids; the part of a row that paid a document gets the id `<id>^ar` / `<id>^ap`. Document rows have source "invoice" /
 * "bill" and the account name "Invoices" / "Bills", so they never count as bank accounts.
 */
export function accrualRows(txns: readonly Txn[], ar: readonly AgingSource[], ap: readonly AgingSource[], o: AccrualOptions): Txn[] {
  const from = o.from ?? "";
  const byId = new Map(txns.map((t) => [t.id, t]));
  const taken = new Map<string, number>(); // ledger row id -> absolute money its payments applied
  const side = new Map<string, "ar" | "ap">(); // ... and which side they settled
  const out: Txn[] = [];
  const base = { file: "", page: 0 };

  // payments: the part of a bank row that settles a document (same direction as the row, never more than is left of it)
  const settle = (docs: readonly AgingSource[], dir: 1 | -1, kind: "ar" | "ap", pls: readonly string[]) => {
    const found = new Map<string, string>(); // txn id -> the revenue / expense account the row is filed under
    for (const s of docs.filter((x) => x.date >= from))
      for (const p of s.payments) {
        const t = p.txn ? byId.get(p.txn) : undefined;
        if (!t || Math.sign(t.amount) !== dir) continue;
        const left = Math.abs(t.amount) - (taken.get(t.id) ?? 0),
          part = r2(Math.min(left, Math.abs(+p.amount || 0)));
        if (part <= 0) continue;
        taken.set(t.id, r2((taken.get(t.id) ?? 0) + part));
        side.set(t.id, kind);
        if (!found.has(t.id) && pls.includes(plOf(t.category) ?? "")) found.set(t.id, t.category);
      }
    return found;
  };
  const filedAr = settle(ar, 1, "ar", ["revenue", "other"]);
  const filedAp = settle(ap, -1, "ap", ["cogs", "expense"]);

  // cash rows: split off the part that paid a receivable or payable
  for (const t of txns) {
    const part = taken.get(t.id) ?? 0;
    if (!part) {
      out.push(t);
      continue;
    }
    const sign = Math.sign(t.amount),
      kind = side.get(t.id)!,
      rest = r2(t.amount - sign * part);
    if (Math.abs(rest) >= 0.005) out.push({ ...t, amount: rest });
    out.push({ ...t, id: `${t.id}^${kind}`, amount: sign * part, category: kind === "ar" ? AR_ACCOUNT : AP_ACCOUNT, why: kind === "ar" ? "invoice" : "bill" });
  }

  // invoices: revenue when issued, receivable until paid. Paid into a row filed under a revenue account? That account.
  for (const s of ar.filter((x) => x.date >= from && x.gross !== 0)) {
    const filed = s.payments.map((p) => (p.txn ? filedAr.get(p.txn) : undefined)).find(Boolean);
    const label = [s.ref, s.name].filter(Boolean).join(" ") || s.id;
    out.push(
      { ...base, id: `inv:${s.id}:rev`, date: s.date, amount: s.gross, desc: label, source: "invoice", account: "Invoices", category: s.account || filed || o.revenue, why: "invoice" },
      { ...base, id: `inv:${s.id}:ar`, date: s.date, amount: -s.gross, desc: label, source: "invoice", account: "Invoices", category: AR_ACCOUNT, why: "invoice" },
    );
    outside(out, s, "inv", AR_ACCOUNT, 1, base);
  }
  // bills: expense per line when approved, payable until paid
  for (const s of ap.filter((x) => x.date >= from && x.gross !== 0)) {
    const label = [s.ref, s.name].filter(Boolean).join(" ") || s.id;
    const lines = s.lines?.length ? s.lines : [{ account: "", amount: s.gross }];
    lines.forEach((l, i) => {
      if (!l.amount) return;
      const filed = s.payments.map((p) => (p.txn ? filedAp.get(p.txn) : undefined)).find(Boolean);
      out.push({ ...base, id: `bill:${s.id}:${i}`, date: s.date, amount: -l.amount, desc: label, source: "bill", account: "Bills", category: l.account || filed || o.expense, why: "bill" });
    });
    out.push({ ...base, id: `bill:${s.id}:ap`, date: s.date, amount: s.gross, desc: label, source: "bill", account: "Bills", category: AP_ACCOUNT, why: "bill" });
    outside(out, s, "bill", AP_ACCOUNT, -1, base);
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** A payment applied outside the books (no bank row): it clears the receivable / payable on its date, with no other side. */
function outside(out: Txn[], s: AgingSource, kind: string, acct: string, dir: 1 | -1, base: { file: string; page: number }) {
  s.payments.forEach((p, i) => {
    if (p.txn || !(+p.amount > 0)) return;
    out.push({
      ...base,
      id: `${kind}:${s.id}:out${i}`,
      date: p.date,
      amount: dir * r2(+p.amount),
      desc: [s.ref, s.name].filter(Boolean).join(" ") || s.id,
      source: kind === "inv" ? "invoice" : "bill",
      account: kind === "inv" ? "Invoices" : "Bills",
      category: acct,
      why: "outside",
    });
  });
}

/** Receivable and payable still open at the end of `iso`, from accrual rows (open invoices and bills; money owed to you / by you). */
export function openBalances(rows: readonly Pick<Txn, "date" | "amount" | "category">[], iso: string) {
  const upto = rows.filter((r) => r.date <= iso);
  return { ar: r2(-sum(upto.filter((r) => isReceivable(r.category)).map((r) => r.amount))), ap: r2(sum(upto.filter((r) => isPayable(r.category)).map((r) => r.amount))) };
}

/**
 * Cash net income to accrual net income for a span: the two bases differ by the change in receivables and payables (and by money settled
 * outside the books, which clears them with no bank row). `rest` is what that does not explain (a payment matched to a row filed under a
 * non-P&L account such as a transfer); zero for books where every matched payment sits on a revenue or expense account.
 */
export function basisBridge(cash: readonly Txn[], accrual: readonly Txn[], from: string, to: string) {
  const inSpan = (r: Pick<Txn, "date">) => r.date >= from && r.date <= to;
  const rows = accrual.filter(inSpan);
  const cashNet = r2(pl(cash.filter(inSpan)).net),
    accrualNet = r2(pl(rows).net);
  const dAr = r2(-sum(rows.filter((r) => isReceivable(r.category)).map((r) => r.amount))),
    dAp = r2(sum(rows.filter((r) => isPayable(r.category)).map((r) => r.amount)));
  // money applied outside the books lowers the receivable (or payable) without ever being a bank row
  const outAr = r2(sum(rows.filter((r) => r.why === "outside" && isReceivable(r.category)).map((r) => r.amount))),
    outAp = r2(-sum(rows.filter((r) => r.why === "outside" && isPayable(r.category)).map((r) => r.amount)));
  return { cashNet, dAr, dAp, outside: r2(outAr - outAp), accrualNet, rest: r2(accrualNet - (cashNet + dAr - dAp + outAr - outAp)) };
}
