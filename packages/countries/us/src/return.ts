// One entity-year of US federal tax from the books: the framing (entity.ts) picks which pieces run. Pure: the caller (the web store, an MCP
// tool) gathers the ledger rows, the deduction engine's rows, the vendors/bills, the owner's inputs and the year's table; the same numbers
// come out everywhere. Not tax advice: a worksheet that stops where a return needs facts the books don't have (credits, other income).
import { pl as corePl } from "@openbooks/core";
import { corpTax, type CorpInput } from "./irs.ts";
import { usTrack, type UsTrack } from "./entity.ts";
import { prepare1099s, type BillLike, type Row1099, type TxnLike, type Vendor1099 } from "./contractors.ts";
import { passThrough, type Owner, type PassThrough } from "./passthrough.ts";
import { scheduleC, type DedRow, type LedgerRow, type SchedCInputs, type SchedCResult } from "./schedc.ts";
import type { UsTable } from "./schema.ts";
import { corpEstimates, estimatedTaxes, personalTax, rd, type EstimateResult, type PersonalResult, type Status } from "./tax.ts";

/** The owner's per-year inputs (books doc "taxus", keyed by year): what the ledger cannot know. */
export interface UsInputs {
  status?: Status;
  schedC?: SchedCInputs;
  otherIncome?: number;
  w2SsWages?: number;
  w2MedicareWages?: number;
  withholding?: number;
  seHealthInsurance?: number;
  retirement?: number;
  otherAdjustments?: number;
  itemized?: number;
  credits?: number;
  netCapitalGain?: number;
  /** Flat state income tax rate in percent. */
  stateRate?: number;
  /** Total tax and AGI on the prior year's return (the safe-harbor basis). */
  priorTax?: number;
  priorAgi?: number;
  /** Partnership / S-corp owners. */
  owners?: Owner[];
  /** Estimated tax already paid for the year; when blank the payments found in the ledger are used. */
  paidEstimates?: number;
}

const IRS_PAYMENT = /\b(usataxpymt|eftps|irs\s*(usataxpymt|treas|tax|est)|us\s*treasury|united states treasury|internal revenue)/i;
/** Outflows that look like federal tax payments (EFTPS / IRS Direct Pay / "USATAXPYMT"): estimated tax for year y is paid Apr y … Jan y+1. */
export function irsPayments(txns: readonly Pick<TxnLike, "id" | "date" | "amount" | "desc" | "memo">[], y: number) {
  return txns.filter((t) => t.amount < 0 && t.date >= `${y}-01-01` && t.date <= `${y + 1}-01-31` && IRS_PAYMENT.test(`${t.desc} ${t.memo ?? ""}`));
}

/** Ledger P&L pieces for the corporate / pass-through tracks: gross revenue, cost of revenue, allowed deductions (the engine's), other income. */
export function booksPl(txns: readonly LedgerRow[], nonDeductible: number) {
  const P = corePl(txns as never),
    advertising = -(P.lines.expense.find((l) => l.key === "expense:advertising")?.value ?? 0);
  return {
    revenue: P.revenue,
    cogs: P.cogs,
    advertising,
    otherDeductions: Math.max(0, P.opex - advertising - nonDeductible),
    otherIncome: P.other,
    opexAllowed: Math.max(0, P.opex - nonDeductible),
  };
}
/** The C-corporation's 1120 inputs from the books. */
export const corpFromBooks = (txns: readonly LedgerRow[], nonDeductible: number, corpRate: number): Pick<CorpInput, "revenue" | "cogs" | "advertising" | "otherDeductions" | "otherIncome" | "corpRate"> => {
  const b = booksPl(txns, nonDeductible);
  return { revenue: b.revenue, cogs: b.cogs, advertising: b.advertising, otherDeductions: b.otherDeductions, otherIncome: b.otherIncome, corpRate };
};

export interface UsReturnInput {
  year: number;
  /** Business type key in force that year. */
  type: string;
  table: UsTable;
  /** The table of the following year (planning the next year's estimates); defaults to the same one. */
  nextTable?: UsTable;
  /** The year's ledger rows. */
  txns: readonly (LedgerRow & TxnLike)[];
  /** Deduction engine rows of the year. */
  deductions: readonly DedRow[];
  nonDeductible: number;
  inputs?: UsInputs;
  vendors?: readonly Vendor1099[];
  bills?: readonly BillLike[];
}
export interface UsReturn {
  track: UsTrack;
  year: number;
  schedC: SchedCResult | null;
  personal: PersonalResult | null;
  /** This year's estimated payments, and the next year's planned from this year's numbers. */
  estimates: EstimateResult | null;
  nextEstimates: EstimateResult | null;
  corp: (ReturnType<typeof corpTax> & { estimates: ReturnType<typeof corpEstimates>; next: ReturnType<typeof corpEstimates> }) | null;
  passThrough: PassThrough | null;
  contractors: Row1099[];
  needs1099: boolean;
  /** Estimated payments found in the ledger. */
  paid: { count: number; total: number };
  notes: string[];
}

export function usReturn(i: UsReturnInput): UsReturn {
  const track = usTrack(i.type),
    inp = i.inputs ?? {},
    fed = i.table.fed,
    status = inp.status ?? "single",
    notes: string[] = [],
    contractors = track === "foreign-owned" ? [] : prepare1099s({ year: i.year, threshold: i.table.nec1099, vendors: i.vendors ?? [], bills: i.bills ?? [], txns: i.txns }),
    paidRows = irsPayments(i.txns, i.year),
    paid = { count: paidRows.length, total: rd(paidRows.reduce((s, t) => s - t.amount, 0)) };
  const base = { track, year: i.year, contractors, needs1099: contractors.some((r) => r.file), paid, notes };
  const nextFed = (i.nextTable ?? i.table).fed;

  if (track === "individual") {
    const schedC = scheduleC({ year: i.year, fed, txns: i.txns, deductions: i.deductions, inputs: inp.schedC }),
      personalIn = {
        year: i.year,
        status,
        netProfit: schedC.netProfit,
        otherIncome: inp.otherIncome,
        w2SsWages: inp.w2SsWages,
        w2MedicareWages: inp.w2MedicareWages,
        withholding: inp.withholding,
        seHealthInsurance: inp.seHealthInsurance,
        retirement: inp.retirement,
        otherAdjustments: inp.otherAdjustments,
        itemized: inp.itemized,
        credits: inp.credits,
        netCapitalGain: inp.netCapitalGain,
        stateRate: inp.stateRate,
      },
      personal = personalTax(fed, personalIn);
    return {
      ...base,
      schedC,
      personal,
      estimates: estimatedTaxes(fed, { year: i.year, status, expectedTax: personal.totalTax, withholding: inp.withholding, priorTax: inp.priorTax ?? null, priorAgi: inp.priorAgi ?? null }),
      // next year: this year's tax is the projection and, to the dollar, the 100% / 110% safe harbor
      nextEstimates: estimatedTaxes(nextFed, { year: i.year + 1, status, expectedTax: personal.totalTax, withholding: inp.withholding, priorTax: personal.totalTax, priorAgi: personal.agi }),
      corp: null,
      passThrough: null,
    };
  }
  if (track === "c-corp") {
    const c = corpTax(corpFromBooks(i.txns, i.nonDeductible, i.table.corpRate));
    return {
      ...base,
      schedC: null,
      personal: null,
      estimates: null,
      nextEstimates: null,
      corp: { ...c, estimates: corpEstimates(fed, i.year, c.tax, inp.priorTax ?? null), next: corpEstimates(nextFed, i.year + 1, c.tax, c.tax) },
      passThrough: null,
    };
  }
  if (track === "partnership" || track === "s-corp") {
    const b = booksPl(i.txns, i.nonDeductible),
      dist = i.txns.filter((t) => t.category.startsWith("equity:") && t.amount < 0).reduce((s, t) => s - t.amount, 0);
    return {
      ...base,
      schedC: null,
      personal: null,
      estimates: null,
      nextEstimates: null,
      corp: null,
      passThrough: passThrough({ type: track, year: i.year, revenue: b.revenue, cogs: b.cogs, deductions: b.opexAllowed, otherIncome: b.otherIncome, distributions: dist, owners: inp.owners ?? [] }),
    };
  }
  notes.push("foreignOwned");
  return { ...base, schedC: null, personal: null, estimates: null, nextEstimates: null, corp: null, passThrough: null };
}
