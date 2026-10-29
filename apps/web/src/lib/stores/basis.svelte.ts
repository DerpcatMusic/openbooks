// The books on their accounting basis: the cash ledger as it is, or (books "accrual") the ledger re-read with the issued invoices and approved
// bills (core basis.ts). Reports use ledgerRows(); tax screens and the transaction list stay on S.data.txns, the cash ledger.
import { accrualRows, billSources, invoiceSources, linkPayment, payrollSources, plOf, unlinkedPayments, type Basis, type PayrollRun, type Unlinked } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import { S, allCats, booksDoc, doc, ent, isArchived, saveBooks, saveDoc, startDate } from "./books.svelte.ts";

/** "accrual" when the books are set to it, else "cash". */
export const basis = (): Basis => (booksDoc().basis === "accrual" ? "accrual" : "cash");
export const setBasis = (b: Basis) => saveBooks({ basis: b === "accrual" ? "accrual" : null });

const nameOf = (docName: string) => {
  const m = new Map(doc<{ id: string; name?: string }[]>(docName).map((x) => [x.id, x.name ?? ""]));
  return (id: string | null) => (id ? (m.get(id) ?? "") : "");
};
/** Open invoices and bills as aging sources (receivable / payable). */
export const arSources = () => invoiceSources(doc<Parameters<typeof invoiceSources>[0]>("invoices"), nameOf("customers"));
export const apSources = () => billSources(doc<Parameters<typeof billSources>[0]>("bills"), nameOf("vendors"));

/** Payroll runs as accrual sources (a bill-shaped document per run; core payroll.ts). */
export const payrollRuns = () => doc<PayrollRun[]>("payroll");
export const prSources = () => payrollSources(payrollRuns());

let memo: { key: unknown[]; rows: Txn[] } | null = null;
/** The ledger rows on the books' basis: S.data.txns itself on cash, the accrual rows otherwise (memoised on the state's parts). */
export function ledgerRows(): Txn[] {
  const d = S.data;
  if (!d) return [];
  if (basis() === "cash") return d.txns;
  const key = [d.txns, d.docs?.invoices, d.docs?.bills, d.docs?.customers, d.docs?.vendors, d.docs?.payroll, startDate(), ent().currency];
  if (!memo || memo.key.some((k, i) => k !== key[i])) {
    const cats = allCats().filter((c) => !isArchived(c));
    memo = {
      key,
      rows: accrualRows(d.txns, arSources(), [...apSources(), ...prSources()], {
        revenue: cats.find((c) => plOf(c) === "revenue") ?? "revenue:sales",
        expense: cats.find((c) => plOf(c) === "expense") ?? "expense:other",
        from: startDate(),
        currency: ent().currency,
      }),
    };
  }
  return memo.rows;
}

/** Payments with no bank row that accrual could not link on its own (core autolink.ts), each with the deposit / payment that would fit. */
export const unlinked = (): Unlinked[] => unlinkedPayments(arSources(), apSources(), S.data?.txns ?? [], { currency: ent().currency });
/** One click: point the payment at the suggested bank row (writes the invoice / bill). */
export function linkSuggested(u: Unlinked) {
  const t = u.suggest;
  if (!t) return;
  const name = u.kind === "ar" ? "invoices" : "bills";
  return saveDoc(
    name,
    doc<{ id: string }[]>(name).map((d) => (d.id === u.doc ? linkPayment(d as never, u.payment, t) : d)),
  );
}
