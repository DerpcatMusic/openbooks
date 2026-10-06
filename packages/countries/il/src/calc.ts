// Israeli tax calculations, ported 1:1 from web/src/lib/planner.js (same expression order, so results are bit-identical).
// Osek zair (30% deemed expenses) vs actual expenses, Bituach Leumi + health tax, mandatory pension §47/§45A, credit points,
// donations §46, and the Taxximizer (every structure an Israeli resident could use, ranked by what you keep). Pure: no I/O.
import type { IlRates } from "./schema.ts";

export type Bands = readonly (readonly [number | null, number])[];

export function bands(income: number, cuts: Bands): number {
  // cuts: [[upTo, rate], ...]; upTo null = ∞
  let tax = 0,
    lo = 0;
  for (const [hi, rate] of cuts) {
    const part = Math.max(0, Math.min(income, hi ?? Infinity) - lo);
    tax += part * rate;
    lo = hi ?? Infinity;
  }
  return tax;
}

/** §39ב combat reservist points for tax year y from days served in y−1 (temporary 2026–2027 table, permanent from 2028). */
export function reservistPoints(days: number, y: number): number {
  if (y < 2026 || !days) return 0;
  if (y <= 2027) return days < 30 ? 0 : days < 40 ? 0.5 : days < 50 ? 0.75 : Math.min(4, 1 + 0.25 * Math.floor((days - 50) / 5));
  return days < 20 ? 0 : Math.min(4, 0.75 + 0.25 * Math.floor((days - 20) / 5));
}

/** Mandatory self-employed pension deposit (4.45% to half the average wage, 12.55% from half to the full average wage). */
export const mandatoryPension = (income: number, T: IlRates) => {
  const half = T.avgWageMonthly * 6;
  return bands(income, [
    [half, T.pensionRate1],
    [half * 2, T.pensionRate2],
    [null, 0],
  ]);
};

/** Released soldier: 2 points/yr (1 if service < 23 months) for 36 months from the month after discharge ("YYYY-MM"). */
export function soldierPoints(discharge: string | undefined, serviceMonths: number | undefined, y: number): number {
  if (!discharge) return 0;
  const [dy = 0, dm = 0] = discharge.split("-").map(Number),
    start = dy * 12 + dm,
    s = y * 12 + 1;
  let months = 0;
  for (let m = s; m < s + 12; m++) if (m > start && m <= start + 36) months++;
  return (((serviceMonths ?? 0) >= 23 ? 2 : 1) * months) / 12;
}

export interface PlanInput {
  turnover: number;
  expenses: number;
  foreign?: number;
  zair: boolean;
  points: number;
  pension: number;
  donations: number;
  selfEmployed: boolean;
  withheld?: number;
  deductions?: number;
  credits?: number;
}
export interface Plan {
  business: number;
  pensionDed: number;
  pensionCredit: number;
  blBase: number;
  bl: number;
  health: number;
  blDed: number;
  taxable: number;
  gross: number;
  pointsCredit: number;
  donationCredit: number;
  tax: number;
  total: number;
  toPay: number;
  effective: number;
  keep: number;
}
/**
 * One scenario. deductions: extra §17(5א)/disability-type deductions (taxable income only); credits: extra credits such as §45א life insurance
 * (applied last, capped). zair = 30% deemed expenses (no §47A BL deduction); otherwise actual expenses with 52% of BL deductible.
 * `foreign` (attributed foreign income) is added after the 30%: deemed expenses never apply to it.
 */
export function ilPlan(i: PlanInput, T: IlRates): Plan {
  const business = Math.max(0, i.zair ? i.turnover * 0.7 : i.turnover - i.expenses) + (i.foreign ?? 0);
  const capBase = Math.min(business, T.mezakaMonthly * 24);
  const pensionDed = Math.min(i.pension, T.depositPct * capBase),
    pensionCreditBase = Math.min(i.pension - pensionDed, T.creditPct * capBase);
  const blBase = Math.min(Math.max(business - pensionDed, i.selfEmployed ? T.blMinMonthly * 12 : 0), T.blMaxMonthly * 12);
  const red = T.blReducedMonthly * 12;
  const bl = bands(blBase, [
      [red, T.blRateReduced],
      [null, T.blRateFull],
    ]),
    health = bands(blBase, [
      [red, T.healthRateReduced],
      [null, T.healthRateFull],
    ]);
  const blDed = i.zair ? 0 : Math.min(0.52 * bl, business - pensionDed);
  const taxable = Math.max(0, business - pensionDed - blDed - (i.deductions ?? 0));
  const gross = bands(taxable, T.brackets);
  const pointsCredit = Math.min(gross, i.points * T.point),
    pensionCredit = Math.min(gross - pointsCredit, 0.35 * pensionCreditBase);
  const donationCredit = Math.min(gross - pointsCredit - pensionCredit, i.donations >= T.donationMin ? 0.35 * Math.min(i.donations, 0.3 * taxable) : 0);
  const otherCredit = Math.min(gross - pointsCredit - pensionCredit - donationCredit, i.credits ?? 0);
  const tax = gross - pointsCredit - pensionCredit - donationCredit - otherCredit;
  const total = tax + bl + health;
  return {
    business,
    pensionDed,
    pensionCredit,
    blBase,
    bl,
    health,
    blDed,
    taxable,
    gross,
    pointsCredit,
    donationCredit,
    tax,
    total,
    toPay: tax - (i.withheld ?? 0),
    effective: i.turnover ? total / i.turnover : 0,
    keep: i.turnover - (i.zair ? 0 : i.expenses) - total,
  };
}

// ---------- TAXXIMIZER ----------
// Assumptions (shown on the page): no ECI / US PE; foreign entities managed from Israel (Israeli-resident for tax); Ltd and C-corp pay all
// profit out the same year; §62א attribution and §81ב 2% not triggered; BL on annualised monthly bands; credit points as entered.

const employerBL = (s: number, T: IlRates) =>
  bands(s, [
    [T.blReducedMonthly * 12, T.ltd.erReduced],
    [T.blMaxMonthly * 12, T.ltd.erFull],
    [null, 0],
  ]);
const employeeBL = (s: number, T: IlRates) =>
  bands(s, [
    [T.blReducedMonthly * 12, T.ltd.eeReduced],
    [T.blMaxMonthly * 12, T.ltd.eeFull],
    [null, 0],
  ]);
const pensionMax = (i: number, T: IlRates) => (T.depositPct + T.creditPct) * Math.min(i, T.mezakaMonthly * 24);

export interface CompanyYear {
  salary: number;
  employerBL: number;
  employeeBL: number;
  salaryTax: number;
  corp: number;
  div: number;
  divTax: number;
  keep: number;
  tax: number;
  bl: number;
}
/** One company year: grid-search the owner's salary (deductible + BL) vs the rest as corporate tax + dividend tax + surtax. */
export function company(profit: number, i: { points: number }, T: IlRates, corpRate = T.ltd.corpRate, bl = true): CompanyYear {
  const L = T.ltd,
    step = Math.max(1000, Math.round(profit / 200));
  let best: CompanyYear | null = null;
  for (let s = 0; s <= profit; s += step) {
    const er = bl ? employerBL(s, T) : 0,
      base = profit - s - er;
    if (base < 0) break;
    const corp = base * corpRate,
      div = base - corp,
      ee = bl ? employeeBL(s, T) : 0;
    const salaryTax = Math.max(0, bands(s, T.brackets) - i.points * T.point);
    const over = Math.min(div, Math.max(0, s + div - Math.max(s, L.surtaxThreshold)));
    const divTax = div * L.divRate + over * (L.surtax + L.surtaxCapital);
    const keep = s - ee - salaryTax + div - divTax;
    if (!best || keep > best.keep)
      best = { salary: s, employerBL: er, employeeBL: ee, salaryTax, corp, div, divTax, keep, tax: corp + salaryTax + divTax, bl: er + ee };
  }
  return best!; // s = 0 always runs (profit ≥ 0)
}

export type Clients = "business" | "consumer" | "foreign";
export type StructureKey = "patur" | "murshe" | "ltd" | "llc" | "ccorp";
export interface TaxximizeInput {
  revenue: number;
  expenses: number;
  vatExpenses?: number;
  clients: Clients;
  points: number;
  paturOk?: boolean;
  fx?: number;
  costs?: Partial<Record<string, number>>;
}
/** The foreign side Taxximizer needs (US pack table: costs in $, corpRate). */
export interface ForeignCosts {
  costs?: { llc?: number; ccorp?: number };
  corpRate?: number;
}
/** label/noteKey/why.k/levers[].k are i18n key suffixes (taxximizer.label.*, .note.*, .why.*, .lever.*). */
export interface Lever {
  k: string;
  amount?: number;
  salary?: number;
  div?: number;
}
export type Structure =
  | {
      key: StructureKey;
      label: string;
      ok: true;
      cost: number;
      vatCost: number;
      tax: number;
      bl: number;
      keep: number;
      cash: number;
      pension: number;
      zair?: boolean;
      noteKey: string;
      levers: Lever[];
      salary?: number;
      div?: number;
    }
  | { key: StructureKey; label: string; ok: false; why: { k: string; amount?: number } };
type Ok = Extract<Structure, { ok: true }>;

export function taxximize(i: TaxximizeInput, T: IlRates, U?: ForeignCosts): { rows: Structure[]; ranked: Ok[]; best: Ok | undefined } {
  const vat = T.vatRate ?? 0.18,
    fx = i.fx ?? 3.6,
    under = i.revenue <= T.zairCeiling;
  const consumer = i.clients === "consumer";
  const recovered = ((i.vatExpenses ?? i.expenses) * vat) / (1 + vat);
  const reg = { turnover: consumer ? i.revenue / (1 + vat) : i.revenue, expenses: i.expenses - recovered };
  const flat = { turnover: i.revenue, expenses: i.expenses };
  type Base = typeof flat;
  const osek = (key: StructureKey, label: string, base: Base, cost: number, zairOk: boolean, noteKey: string): Ok => {
    const plans: (Plan & { zair: boolean; pension: number })[] = [];
    for (const zair of zairOk ? [true, false] : [false])
      for (const pension of [
        0,
        Math.round(mandatoryPension(base.turnover - (zair ? base.turnover * 0.3 : base.expenses), T)),
        Math.round(pensionMax(Math.max(0, zair ? base.turnover * 0.7 : base.turnover - base.expenses), T)),
      ]) {
        const p = ilPlan({ turnover: base.turnover, expenses: base.expenses, zair, points: i.points, pension, donations: 0, selfEmployed: true }, T);
        plans.push({ ...p, zair, pension, keep: base.turnover - base.expenses - p.total - cost });
      }
    const b = plans.reduce((a, x) => (x.keep > a.keep ? x : a));
    return {
      key,
      label,
      ok: true,
      cost,
      vatCost: i.revenue - base.turnover - (i.expenses - base.expenses),
      tax: b.tax,
      bl: b.bl + b.health,
      keep: b.keep,
      cash: b.keep - b.pension,
      pension: b.pension,
      zair: b.zair,
      noteKey,
      levers: [{ k: b.zair ? "zair" : "actual" }, b.pension ? { k: "pension", amount: Math.round(b.pension) } : { k: "noPension" }],
    };
  };
  const corp = (key: StructureKey, label: string, base: Base, cost: number, rate: number, noteKey: string, bl = true): Ok => {
    const c = company(Math.max(0, base.turnover - base.expenses - cost), i, T, rate, bl);
    return {
      key,
      label,
      ok: true,
      cost,
      vatCost: i.revenue - base.turnover - (i.expenses - base.expenses),
      tax: c.tax,
      bl: c.bl,
      keep: c.keep,
      cash: c.keep,
      pension: 0,
      noteKey,
      levers: [{ k: "salaryDiv", salary: Math.round(c.salary), div: Math.round(c.div) }],
      salary: c.salary,
      div: c.div,
    };
  };
  const abroad = i.clients === "foreign" ? flat : reg;
  // ponytail: `as number` mirrors planner.js, where a missing cost is undefined and poisons the row to NaN; tables always carry costs
  const C = { ...T.costs, ...i.costs } as Record<string, number>,
    UC = U?.costs ?? {};
  const rows: Structure[] = [
    under && i.paturOk !== false
      ? osek("patur", "patur", flat, C.patur as number, true, "patur")
      : { key: "patur", label: "patur", ok: false, why: i.paturOk === false ? { k: "patur" } : { k: "ceiling", amount: T.zairCeiling } },
    osek("murshe", under ? "murshePlus" : "murshe", reg, C.murshe as number, under, under ? "murshePlus" : "murshe"),
    corp("ltd", "ltd", reg, C.ltd as number, T.ltd.corpRate, "ltd"),
    osek("llc", "llc", abroad, (UC.llc ?? 0) * fx + (C.llc as number), false, "llc"),
    corp("ccorp", "ccorp", abroad, (UC.ccorp ?? 0) * fx + (C.ccorp as number), Math.max(U?.corpRate ?? 0.21, T.ltd.corpRate), "ccorp"),
  ];
  const ranked = rows.filter((r): r is Ok => r.ok).sort((a, b) => b.keep - a.keep);
  return { rows, ranked, best: ranked[0] };
}
