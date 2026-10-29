// Israeli VAT periodic report (דוח תקופתי / PCN874 summary) from the books. Pure: issued documents and bank-expense rows in, the report's
// fields, the PCN874 detail lines and the problems the Tax Authority's simulator would raise out.
//
// Sources: VAT Law 1975 s.67 (report and payment within 15 days after the period, see calendar.ts); the Tax Authority's PCN874 file layout
// ("Clarifications regarding the structure of the PCN874 invoices file", Appendix A/C, gov.il software-houses page, English version, read
// 2026-10-29); allocation numbers: Income Tax Reg. / the Tax Authority's "Israel Invoices" thresholds as stored in tables/deductions.json
// (il.recordkeeping.allocationThreshold).
//
// What counts, and its limits (shown in the UI, docs/filings-il.md):
//  - Output VAT: documents of kind "tax" (חשבונית מס) by issue date, plus receipts that do not point at a tax invoice (a receipt for a tax invoice only
//    documents the payment). Bills (חשבון עסקה) are not tax documents. Drafts are left out.
//  - Input VAT: bank expenses by transaction date, using the deduction engine's vatReclaimable (the rule's vatPct). The tax-invoice date is what the
//    law uses; the bank date is the books' proxy. Equipment (fixed-asset rules) goes to its own line.
//  - Whole shekels: the form and the PCN874 file take whole shekels, so every figure here is the sum of the per-document rounded values.
import { reportDue, type Period } from "./calendar.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Round to a whole shekel, half away from zero. */
export const shekel = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

/** Israeli ID / company / licensed-dealer number check digit (9 digits, weights 1,2,1,2..., digit sums, total divisible by 10). */
export function validVatId(id: string): boolean {
  if (!/^\d{5,9}$/.test(id)) return false;
  const s = id.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const p = +s[i]! * (i % 2 === 0 ? 1 : 2);
    sum += p > 9 ? p - 9 : p;
  }
  return sum % 10 === 0;
}

/** A customer must be identified on a sale above this amount before VAT (PCN874 spec Appendix C note A; the spec says the amount can change). */
export const IDENTIFY_ABOVE = 5000;
/** The allocation number (מספר הקצאה) is required from this net amount on, by invoice date (tables/deductions.json il.recordkeeping). */
export const allocationThreshold = (date: string) => (date < "2026-01-01" ? 20000 : date < "2026-06-01" ? 10000 : 5000);

export interface VatSaleDoc {
  id: string;
  kind: string;
  number: string | null;
  status: string;
  issued: string;
  items: readonly { qty?: unknown; price?: unknown }[];
  /** VAT rate frozen on the document (0.18); missing or 0 = no VAT charged. */
  vat?: number;
  /** Zero-rated (e.g. a service exported abroad). */
  noVat?: boolean;
  /** Number and kind of the document this one refers to (a receipt for a bill or a tax invoice). */
  ref?: string | null;
  refKind?: string;
  currency?: string;
  customer?: string | null;
  customerName?: string;
  /** The customer's licensed-dealer / company number. */
  customerVatId?: string | null;
  /** The Tax Authority allocation number, when the invoice needed one. */
  alloc?: string | null;
}
export interface VatInputRow {
  id: string;
  date: string;
  desc: string;
  /** What was paid, VAT included. */
  gross: number;
  /** Input VAT that may be reclaimed (the deduction engine's vatReclaimable). */
  vatReclaimable: number;
  rule?: string;
  /** Whom it was paid to (the transaction's payer), the key of `supplierIds`. */
  supplier?: string;
}
export interface VatReportInput {
  period: Pick<Period, "key" | "from" | "to" | "months">;
  docs: readonly VatSaleDoc[];
  inputs: readonly VatInputRow[];
  /** Standard VAT rate of the period (0.18): turns a gross payment into its net. */
  rate: number;
  /** Rules whose inputs are fixed assets (VAT on equipment). */
  fixedAssetRules?: ReadonlySet<string>;
  /** Supplier name (as on the transaction) → licensed-dealer number. Inputs without one are reported as petty cash. */
  supplierIds?: Readonly<Record<string, string>>;
  /** The books' currency (documents in another currency need `fx`). */
  baseCurrency?: string;
  /** Units of the base currency per unit of `currency` on `date`; null = unknown. */
  fx?: (currency: string, date: string) => number | null;
}

export type VatLineType = "S" | "L" | "Y" | "T" | "K";
export interface VatLine {
  side: "sale" | "input";
  type: VatLineType;
  /** 9 digits (zeros when the type has none). */
  party: string;
  date: string;
  /** Series (4 chars), usually blank/zeros. */
  group: string;
  /** Document number (digits), or for aggregates the number of documents. */
  ref: string;
  /** Whole shekels, signed: negative = credit/cancellation. */
  vat: number;
  net: number;
  /** Allocation number or "". */
  alloc: string;
  /** A sale charged VAT at the standard rate (false = zero-rated or exempt). */
  taxable: boolean;
  /** An input that is a fixed asset. */
  equipment: boolean;
  label: string;
  /** Ids of the documents / transactions behind the line. */
  src: string[];
}
export interface VatIssue {
  level: "error" | "warn";
  /** Translatable key vat.issue.<code>. */
  code: string;
  ref?: string;
  v?: number;
}
export interface VatTotals {
  /** Sales taxed at the standard rate, before VAT. */
  taxableSales: number;
  /** VAT on those sales. */
  outputVat: number;
  /** Zero-rated and exempt sales. */
  zeroExempt: number;
  salesRecords: number;
  /** VAT on inputs other than equipment, VAT on equipment inputs. */
  otherInputsVat: number;
  equipmentVat: number;
  inputRecords: number;
  /** Positive: payable; negative: refund. */
  payable: number;
}
export interface VatReport {
  period: Pick<Period, "key" | "from" | "to" | "months">;
  lines: VatLine[];
  totals: VatTotals;
  issues: VatIssue[];
  /** Report and payment dates (statutory 15th, online practice 19th, detailed filers 23rd), rest days applied. */
  due: { statutory: string; online: string; detailed: string };
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const refOf = (s: string | null | undefined) => digits(s).slice(-9) || "0";
const monthEnd = (d: string) => {
  const y = +d.slice(0, 4),
    m = +d.slice(5, 7);
  return `${d.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

export function vatReport(inp: VatReportInput): VatReport {
  const { period, rate } = inp,
    base = inp.baseCurrency ?? "ILS",
    fixed = inp.fixedAssetRules ?? new Set(["il.depreciation"]),
    issues: VatIssue[] = [],
    lines: VatLine[] = [],
    inPeriod = (d: string) => d >= period.from && d <= period.to;

  // ---- sales ----
  const agg = new Map<string, VatLine>(); // unidentified small sales, one line per month-end and taxable flag
  for (const d of inp.docs) {
    if (d.status === "draft" || !inPeriod(d.issued)) continue;
    const counts = d.kind === "tax" || (d.kind === "receipt" && d.refKind !== "tax");
    if (!counts) continue;
    const label = `${d.kind === "tax" ? "" : "receipt "}${d.number ?? d.id}`;
    let net = (d.items ?? []).reduce((a, i) => a + (+(i.qty as number) || 0) * (+(i.price as number) || 0), 0);
    if (d.currency && d.currency !== base) {
      const f = inp.fx?.(d.currency, d.issued);
      if (!f) {
        issues.push({ level: "error", code: "noRate", ref: label });
        continue;
      }
      net *= f;
    }
    const taxable = !d.noVat && (d.vat ?? 0) > 0,
      vatExact = taxable ? net * d.vat! : 0,
      nShekel = shekel(net),
      vShekel = shekel(vatExact),
      id = digits(d.customerVatId),
      absNet = Math.abs(net);
    if (!d.number) issues.push({ level: "error", code: "noNumber", ref: d.id });
    if (id && !validVatId(id)) issues.push({ level: "warn", code: "badCustomerId", ref: label });
    if (!id && absNet > IDENTIFY_ABOVE && !d.noVat) issues.push({ level: "error", code: "customerIdNeeded", ref: label, v: IDENTIFY_ABOVE });
    if (taxable && absNet >= allocationThreshold(d.issued) && !digits(d.alloc))
      issues.push({ level: "warn", code: "allocationNeeded", ref: label, v: allocationThreshold(d.issued) });
    const common = { side: "sale" as const, group: "0000", alloc: digits(d.alloc).slice(-9), taxable, equipment: false, label, src: [d.id] };
    if (d.noVat && !id) {
      // Export of services / goods: counterparty 999999999 (spec note D), no VAT
      lines.push({ ...common, type: "Y", party: "999999999", date: d.issued, ref: refOf(d.number), vat: 0, net: nShekel });
    } else if (!id && absNet <= IDENTIFY_ABOVE) {
      const date = monthEnd(d.issued),
        key = `${date}|${taxable}`,
        l = agg.get(key) ?? { ...common, type: "L" as const, party: "000000000", date, ref: "0", vat: 0, net: 0, label: "", src: [], alloc: "" };
      l.net += nShekel;
      l.vat += vShekel;
      l.ref = String(+l.ref + 1);
      l.src.push(d.id);
      l.label = `${l.src.length} unidentified`;
      agg.set(key, l);
    } else {
      lines.push({ ...common, type: "S", party: (id || "0").padStart(9, "0"), date: d.issued, ref: refOf(d.number), vat: vShekel, net: nShekel });
    }
  }
  lines.push(...agg.values());

  // ---- inputs ----
  for (const r of inp.inputs) {
    if (!inPeriod(r.date) || !(r.vatReclaimable > 0)) continue;
    const full = r2((r.gross * rate) / (1 + rate)),
      id = digits(inp.supplierIds?.[r.supplier ?? ""]),
      known = id.length > 0;
    if (known && !validVatId(id)) issues.push({ level: "warn", code: "badSupplierId", ref: r.supplier });
    lines.push({
      side: "input",
      type: known ? "T" : "K",
      party: known ? id.padStart(9, "0") : "000000000",
      date: r.date,
      group: "0000",
      ref: known ? "0" : "1",
      vat: shekel(r.vatReclaimable),
      net: shekel(r.gross - full),
      alloc: "",
      taxable: true,
      equipment: !!r.rule && fixed.has(r.rule),
      label: r.desc,
      src: [r.id],
    });
  }
  lines.sort((a, b) => (a.side === b.side ? a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref) : a.side === "sale" ? -1 : 1));

  // ---- totals ----
  const sum = (xs: VatLine[], f: (l: VatLine) => number) => xs.reduce((a, l) => a + f(l), 0);
  const sales = lines.filter((l) => l.side === "sale"),
    inputs = lines.filter((l) => l.side === "input");
  const totals: VatTotals = {
    taxableSales: sum(sales.filter((l) => l.taxable), (l) => l.net),
    outputVat: sum(sales, (l) => l.vat),
    zeroExempt: sum(sales.filter((l) => !l.taxable), (l) => l.net),
    salesRecords: sales.length,
    otherInputsVat: sum(inputs.filter((l) => !l.equipment), (l) => l.vat),
    equipmentVat: sum(inputs.filter((l) => l.equipment), (l) => l.vat),
    inputRecords: inputs.length,
    payable: 0,
  };
  totals.payable = totals.outputVat - totals.otherInputsVat - totals.equipmentVat;

  // petty cash (K): the total VAT of the entries must stay under 2% of the file's VAT or 2,000, whichever is larger (spec note E; the limits can change)
  const petty = sum(inputs.filter((l) => l.type === "K"), (l) => l.vat),
    fileVat = sum(lines, (l) => Math.abs(l.vat)),
    pettyMax = Math.max(0.02 * fileVat, 2000);
  if (petty > pettyMax) issues.push({ level: "error", code: "pettyCashOver", v: Math.round(pettyMax) });
  else if (petty > 0 && inputs.some((l) => l.type === "K" && l.vat > 0 && Math.abs(l.net) > IDENTIFY_ABOVE)) issues.push({ level: "warn", code: "pettyCashBig" });

  const due = (day: 15 | 19 | 23) => reportDue(period, day);
  return { period, lines, totals, issues, due: { statutory: due(15), online: due(19), detailed: due(23) } };
}
