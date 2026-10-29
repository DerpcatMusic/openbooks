// The filings pages' shared state: the saved "filings" doc (done marks, Israeli settings), the open books' deadlines and VAT report inputs,
// the 1301 adjustments (VAT-exclusive figures, equipment depreciation, advances paid). Logic lives in core filings.ts and the IL pack.
import { dueInYear, filingRows, markDone, readFilings, unmarkDone, type FilingDone, type FilingRow, type FilingsDoc } from "@openbooks/core";
import {
  depreciation,
  ilFacts,
  ilSettings,
  paidTotal,
  periodReport,
  vatRegistered,
  withIlSettings,
  type CustomerDoc,
  type DepRow,
  type IlSettings,
  type InvoiceDoc,
  type VatContext,
  type VatReport,
} from "@openbooks/country-il";
import type { Period } from "@openbooks/country-il";
import { isBiz } from "@openbooks/core";
import { S, bizType, doc, ent, family, pack, saveDoc, taxTable } from "./stores/books.svelte.ts";
import { resultOf } from "./taxtags.svelte.ts";
import { usFacts } from "./ustax/books.ts";

export const filings = (): FilingsDoc => readFilings(doc<unknown>("filings", null));
export const saveFilings = (d: FilingsDoc) => saveDoc("filings", d);
export const il = (): IlSettings => ilSettings(filings().settings);
export const patchIl = (p: Partial<IlSettings>) => saveFilings({ ...filings(), settings: withIlSettings(filings().settings, { ...il(), ...p }) });
export const markFiled = (id: string, done: FilingDone) => saveFilings(markDone(filings(), id, done));
export const unmarkFiled = (id: string) => saveFilings(unmarkDone(filings(), id));

/** The open books have a country calendar (the pack has `deadlines` and the year has a business type). */
export const hasCalendar = () => !!S.data && !!pack()?.deadlines && !!bizType();
export const isIL = () => family() === "il";
export const vatBooks = (y = S.year) => isIL() && vatRegistered(bizType(y));

/** Deadlines due in calendar `year` with their status today. */
export function calendar(year: number, today: string): FilingRow[] {
  const p = pack(year);
  if (!p?.deadlines) return [];
  const f = filings(),
    s = il();
  const facts = (y: number) => {
    const type = bizType(y);
    if (!type) return null;
    return isIL() ? ilFacts(type, s) : usFacts(type);
  };
  return filingRows(dueInYear(p, year, facts), f, today);
}

// ---------- Israeli VAT ----------
/** Everything the VAT report reads for tax year y, or null (not Israeli, no type). */
export function vatCtx(y: number): VatContext | null {
  if (!isIL() || !S.data) return null;
  const res = resultOf(y);
  return {
    invoices: doc<InvoiceDoc[]>("invoices"),
    customers: doc<CustomerDoc[]>("customers"),
    rows: res?.rows ?? [],
    txns: S.data.txns,
    rate: Number((taxTable(y) as { vatRate?: number }).vatRate ?? 0.18),
    settings: il(),
    currency: ent().currency ?? "ILS",
  };
}
export const vatFor = (p: Pick<Period, "key" | "from" | "to" | "months">): VatReport | null => {
  const c = vatCtx(+p.from.slice(0, 4));
  return c ? periodReport(p, c) : null;
};

/** What the 1301 takes for a VAT-registered business: sales before VAT and the VAT reclaimed on expenses (zero-rated sales included). */
export function vat1301(y: number): { turnover: number; reclaimed: number; estimated: boolean } | undefined {
  if (!vatBooks(y)) return undefined;
  const c = vatCtx(y)!,
    year = periodReport({ key: String(y), from: `${y}-01-01`, to: `${y}-12-31`, months: 12 }, c),
    reclaimed = resultOf(y)?.totals.vatReclaimable ?? 0,
    fromDocs = year.totals.taxableSales + year.totals.zeroExempt;
  if (fromDocs > 0) return { turnover: fromDocs, reclaimed, estimated: false };
  // no tax invoices issued in OpenBooks: the receipts include VAT, take it out at the standard rate
  const receipts = S.data!.txns.filter((t) => +t.date.slice(0, 4) === y && isBiz(t.category)).reduce((a, t) => a + t.amount, 0);
  return { turnover: Math.round(receipts / (1 + c.rate)), reclaimed, estimated: true };
}

/** Equipment register through year y (deduction rows of rule il.depreciation, cost net of the VAT reclaimed on it). */
export function register(y: number): { rows: DepRow[]; totals: ReturnType<typeof depreciation>["totals"] } {
  const rule = (pack(y)?.deductions?.rules ?? []).find((r) => r.id === "il.depreciation");
  const rates = (rule?.values ?? {}) as Record<string, number>;
  const s = il();
  const assets = (S.data?.years ?? [])
    .filter((yy) => yy <= y)
    .flatMap((yy) => resultOf(yy)?.rows ?? [])
    .filter((r) => r.rule === "il.depreciation")
    .map((r) => ({
      id: r.id,
      date: r.date,
      desc: r.desc,
      cost: Math.max(0, r.gross - r.vatReclaimable),
      rule: r.rule,
      ...(s.assetClass[r.id] ? { cls: s.assetClass[r.id] } : {}),
    }));
  return depreciation(assets, rates, y);
}

/** Income-tax advances paid for the year (Filings > Advances). */
export const advancesPaid = (y: number) => paidTotal(il().advancesPaid, y, "tax");

/** A file download from the browser. */
export function download(name: string, data: BlobPart, type = "application/octet-stream") {
  const a = document.createElement("a"),
    href = URL.createObjectURL(new Blob([data], { type }));
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
