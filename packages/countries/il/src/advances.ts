// Advance payments (מקדמות) of an Israeli self-employed person or company, per period: income tax and, for sole proprietors, Bituach Leumi.
//
// Income tax (Income Tax Regulations (Determination of Advances by Turnover) 1982, reg.2, Hebrew Wikisource consolidated text read 2026-10-29):
//  - 12 monthly advances, the first due 15 February of the tax year and then on the 15th of each month, until 15 January of the next year; each is
//    the Assessing Officer's rate (שיעור המקדמות, set in his notice to the taxpayer: the user enters it) times the turnover of the month BEFORE
//    the due month (reg.2(a)). "Turnover" = מחזור עסקאות of Ordinance s.175(b): sales before VAT.
//  - A taxpayer whose advances in the determining year did not exceed the Commissioner's threshold pays six bimonthly advances from 15 March,
//    each the rate times the turnover of the two preceding months (reg.2(b),(c)). The threshold is in the notice: the user chooses.
//  - A due date on a rest day moves by Ordinance s.175(f) (same rule as VAT, calendar.ts dueDate).
// Bituach Leumi (self-employed, sole proprietor): monthly advance on a declared monthly income between the table's minimum and maximum base:
//  reduced rate (BL + health) up to the reduced-rate ceiling, full rate above it (tables/<year>.json, btl.gov.il rates for the self-employed).
//  Due on the 15th of the month after the month it covers: Tax-Authority-style rest-day rule is NOT assumed for BL (shown as 15th; unverified).
import { bands } from "./calc.ts";
import { dueDate } from "./calendar.ts";
import type { IlRates } from "./schema.ts";

export type AdvanceKind = "tax" | "bl";
export interface AdvanceRow {
  /** Stable id: "tax:2026-02" (kind and the month the advance is due in), "bl:2026-01" (kind and the month it covers). */
  id: string;
  kind: AdvanceKind;
  /** The turnover (tax) or income (BL) months this advance covers. */
  from: string;
  to: string;
  due: string;
  /** Turnover of the covered months (tax) or the monthly income used (BL). */
  base: number;
  amount: number;
}
export interface PaidAdvance {
  id: string;
  kind: AdvanceKind;
  /** The schedule row it settles ("tax:2026-02") or "" for an extra payment. */
  row: string;
  /** Tax year it counts for. */
  year: number;
  date: string;
  amount: number;
  /** The bank transaction it was paid with. */
  txn?: string;
  note?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The year's income-tax advance schedule. `ratePct` is the Assessing Officer's percentage (4.5 = 4.5%); `turnover(from, to)` the sales before VAT between
 * two dates. The first advance (15 Feb) covers January; with bimonthly advances the first (15 Mar) covers January and February.
 */
export function taxAdvances(year: number, frequency: "monthly" | "bimonthly", ratePct: number, turnover: (from: string, to: string) => number): AdvanceRow[] {
  const step = frequency === "monthly" ? 1 : 2;
  return Array.from({ length: 12 / step }, (_, i) => {
    const m0 = i * step + 1, // first covered month
      m1 = m0 + step - 1,
      dueM = m1 + 1, // paid the month after the last covered month
      dy = year + (dueM > 12 ? 1 : 0),
      dm = dueM > 12 ? 1 : dueM,
      from = `${year}-${pad(m0)}-01`,
      to = `${year}-${pad(m1)}-${pad(lastDay(year, m1))}`,
      base = r2(turnover(from, to));
    return { id: `tax:${dy}-${pad(dm)}`, kind: "tax" as const, from, to, due: dueDate(`${dy}-${pad(dm)}-15`), base, amount: Math.round((base * ratePct) / 100) };
  });
}

/** Monthly Bituach Leumi + health advance for a declared monthly income (clamped to the table's minimum and maximum base). */
export function blMonthly(T: Pick<IlRates, "blReducedMonthly" | "blMaxMonthly" | "blMinMonthly" | "blRateReduced" | "blRateFull" | "healthRateReduced" | "healthRateFull">, monthlyIncome: number): { base: number; bl: number; health: number; total: number } {
  const base = Math.min(Math.max(monthlyIncome, T.blMinMonthly), T.blMaxMonthly),
    bl = bands(base, [
      [T.blReducedMonthly, T.blRateReduced],
      [null, T.blRateFull],
    ]),
    health = bands(base, [
      [T.blReducedMonthly, T.healthRateReduced],
      [null, T.healthRateFull],
    ]);
  return { base, bl: r2(bl), health: r2(health), total: Math.round(bl + health) };
}

/** The year's 12 Bituach Leumi advances: month m is paid by the 15th of month m+1. */
export function blAdvances(year: number, T: Parameters<typeof blMonthly>[0], monthlyIncome: number): AdvanceRow[] {
  const x = blMonthly(T, monthlyIncome);
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1,
      dy = year + (m === 12 ? 1 : 0),
      dm = m === 12 ? 1 : m + 1;
    return { id: `bl:${year}-${pad(m)}`, kind: "bl" as const, from: `${year}-${pad(m)}-01`, to: `${year}-${pad(m)}-${pad(lastDay(year, m))}`, due: `${dy}-${pad(dm)}-15`, base: x.base, amount: x.total };
  });
}

/** Paid so far for the year and kind. */
export const paidTotal = (paid: readonly PaidAdvance[], year: number, kind: AdvanceKind) => r2(paid.filter((p) => p.year === year && p.kind === kind).reduce((a, p) => a + p.amount, 0));

/** The schedule with what has been paid against each row (by the row it settles) and what is still owed up to `today`. */
export function withPaid(rows: readonly AdvanceRow[], paid: readonly PaidAdvance[]) {
  return rows.map((r) => {
    const p = paid.filter((x) => x.row === r.id).reduce((a, x) => a + x.amount, 0);
    return { ...r, paid: r2(p), open: r2(Math.max(0, r.amount - p)) };
  });
}
