// Glue between the books (docs, ledger rows, deduction results) and the Israeli generators: saved filing settings, the sales documents and
// input rows the VAT report reads, the turnover advances use, and the uniform-structure input. Pure; the web app and the MCP tools both call this.
import { payerOf, type TxnDeduction } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import { type PaidAdvance } from "./advances.ts";
import { type VatFrequency, type Period } from "./calendar.ts";
import type { AssetClass } from "./depreciation.ts";
import type { UniformDoc, UniformInput } from "./openfrmt.ts";
import { vatReport, type VatInputRow, type VatReport, type VatSaleDoc } from "./vat.ts";

export interface IlSettings {
  /** The business's licensed-dealer (or company) number, 9 digits. */
  vatId: string;
  vatFrequency: VatFrequency;
  /** Income-tax advance schedule from the Assessing Officer's notice. */
  taxAdvanceFrequency: "monthly" | "bimonthly" | "none";
  /** The advance rate (percent of turnover) from the notice; 0 = not entered yet. */
  taxAdvanceRatePct: number;
  /** Pay Bituach Leumi advances (sole proprietors). */
  blAdvances: boolean;
  /** Monthly income Bituach Leumi advances are based on; null = from last year's profit. */
  blMonthlyIncome: number | null;
  /** Supplier name → licensed-dealer number (turns petty-cash inputs into named ones). */
  supplierIds: Record<string, string>;
  /** Transaction id → asset class for the depreciation register. */
  assetClass: Record<string, AssetClass>;
  advancesPaid: PaidAdvance[];
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
/** The IL settings out of the "filings" doc's settings bag, defaults filled in. */
export function ilSettings(bag: Record<string, unknown> | undefined): IlSettings {
  const s = obj(bag?.il ?? bag);
  const f = s.taxAdvanceFrequency;
  return {
    vatId: str(s.vatId).replace(/\D/g, ""),
    vatFrequency: s.vatFrequency === "bimonthly" ? "bimonthly" : "monthly",
    taxAdvanceFrequency: f === "bimonthly" || f === "none" ? f : "monthly",
    taxAdvanceRatePct: Math.max(0, num(s.taxAdvanceRatePct)),
    blAdvances: s.blAdvances !== false,
    blMonthlyIncome: typeof s.blMonthlyIncome === "number" ? s.blMonthlyIncome : null,
    supplierIds: Object.fromEntries(Object.entries(obj(s.supplierIds)).filter(([, v]) => typeof v === "string")) as Record<string, string>,
    assetClass: obj(s.assetClass) as Record<string, AssetClass>,
    advancesPaid: Array.isArray(s.advancesPaid) ? (s.advancesPaid as PaidAdvance[]) : [],
  };
}
/** The bag to store: the IL settings under "il", other packs' keys untouched. */
export const withIlSettings = (bag: Record<string, unknown> | undefined, s: IlSettings): Record<string, unknown> => ({ ...bag, il: s });

export type InvoiceDoc = Omit<VatSaleDoc, "customerName" | "customerVatId">;
export interface CustomerDoc {
  id: string;
  name: string;
  address?: string;
  vatId?: string;
}
/** The invoices doc as VAT sale documents (customer name and licensed-dealer number attached). */
export function saleDocs(invoices: readonly InvoiceDoc[], customers: readonly CustomerDoc[]): VatSaleDoc[] {
  const byId = new Map(customers.map((c) => [c.id, c]));
  return invoices.map((i) => {
    const c = i.customer ? byId.get(i.customer) : undefined;
    return { ...i, customerName: c?.name ?? "", customerVatId: c?.vatId ?? null };
  });
}
/** Input rows for the VAT report: deduction rows with reclaimable VAT, the payer attached so supplier numbers can be looked up. */
export function inputRows(rows: readonly TxnDeduction[], txns: readonly Txn[]): VatInputRow[] {
  const byId = new Map(txns.map((t) => [t.id, t]));
  return rows
    .filter((r) => r.vatReclaimable > 0)
    .map((r) => {
      const t = byId.get(r.id);
      return {
        id: r.id,
        date: r.date,
        desc: r.desc,
        gross: r.gross,
        vatReclaimable: r.vatReclaimable,
        ...(r.rule ? { rule: r.rule } : {}),
        ...(t ? { supplier: payerOf(t) } : {}),
      };
    });
}

export interface VatContext {
  invoices: readonly InvoiceDoc[];
  customers: readonly CustomerDoc[];
  /** deductions() rows for the period's year. */
  rows: readonly TxnDeduction[];
  txns: readonly Txn[];
  /** Standard VAT rate of the year (tables vatRate). */
  rate: number;
  settings: IlSettings;
  currency?: string;
}
export function periodReport(period: Pick<Period, "key" | "from" | "to" | "months">, c: VatContext): VatReport {
  return vatReport({
    period,
    docs: saleDocs(c.invoices, c.customers),
    inputs: inputRows(c.rows, c.txns),
    rate: c.rate,
    supplierIds: c.settings.supplierIds,
    ...(c.currency ? { baseCurrency: c.currency } : {}),
  });
}
/** Sales before VAT between two dates (the VAT report's taxable + zero-rated/exempt sales): the "turnover" of Ordinance s.175(b). */
export function vatTurnover(from: string, to: string, c: VatContext): number {
  const r = periodReport({ key: from.slice(0, 7), from, to, months: 1 }, c);
  return r.totals.taxableSales + r.totals.zeroExempt;
}

const KIND_CODE: Record<string, UniformDoc["type"] | undefined> = { tax: 305, bill: 300, receipt: 400 };
/** Issued documents as uniform-structure documents (drafts and US invoices are skipped). */
export function uniformDocs(
  invoices: readonly (Omit<InvoiceDoc, "items"> & { items: readonly { desc?: string; qty?: unknown; price?: unknown }[] })[],
  customers: readonly CustomerDoc[],
  method?: (i: InvoiceDoc) => string,
): UniformDoc[] {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const out: UniformDoc[] = [];
  for (const i of invoices) {
    const type = KIND_CODE[i.kind];
    if (!type || i.status === "draft" || !i.number) continue;
    const c = i.customer ? byId.get(i.customer) : undefined;
    out.push({
      id: i.id,
      type,
      number: i.number,
      date: i.issued,
      customerKey: c?.id ?? "",
      customerName: c?.name ?? "",
      ...(c?.address ? { customerAddress: c.address } : {}),
      ...(c?.vatId ? { customerVatId: c.vatId } : {}),
      lines: i.items.map((x) => ({ desc: String(x.desc ?? ""), qty: +(x.qty as number) || 0, price: +(x.price as number) || 0 })),
      vat: i.noVat ? 0 : (i.vat ?? 0),
      ...(i.currency ? { currency: i.currency } : {}),
      ...(method ? { method: method(i) } : {}),
      ...(i.kind === "receipt" && i.ref ? { base: { type: i.refKind === "tax" ? 305 : 300, number: i.ref } } : {}),
    });
  }
  return out;
}
export type { UniformInput };
