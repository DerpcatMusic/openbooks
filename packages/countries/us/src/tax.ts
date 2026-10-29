// Federal individual tax pieces for a self-employed owner (Schedule C → Schedule SE → Form 8995 → Form 1040 estimate → 1040-ES). Pure,
// whole dollars like the IRS forms (each line rounded, the next line computed from the rounded one so the printed arithmetic adds up).
// Figures come from tables/<year>.json `fed` (sourced there). Not tax advice: no credits, AMT, itemizing, capital gains or phase-outs
// beyond what is named; the result says what it left out.
import type { FedTable } from "./schema.ts";
import { dueOn } from "./dates.ts";

export type Status = "single" | "mfj" | "hoh" | "mfs";
export const STATUSES: readonly Status[] = ["single", "mfj", "hoh", "mfs"];
/** Whole dollars, halves away from zero (what the forms ask for). */
export const rd = (n: number) => (n < 0 ? -Math.round(-n) : Math.round(n)) || 0;

/** Tax on taxable income from the rate table of the filing status. */
export function incomeTax(fed: FedTable, status: Status, taxable: number): number {
  let tax = 0,
    lo = 0;
  for (const [hi, rate] of fed.brackets[status]) {
    const top = hi ?? Infinity;
    if (taxable > lo) tax += (Math.min(taxable, top) - lo) * rate;
    lo = top;
    if (taxable <= top) break;
  }
  return rd(tax);
}
/** Marginal rate at that taxable income. */
export function marginalRate(fed: FedTable, status: Status, taxable: number): number {
  for (const [hi, rate] of fed.brackets[status]) if (taxable <= (hi ?? Infinity)) return rate;
  return 0;
}

export interface SeInput {
  /** Schedule C line 31 (plus any partnership K-1 box 14 earnings). */
  netProfit: number;
  /** Social security wages already taxed (W-2 box 3 + 7): Schedule SE line 8a; they use up the wage base. */
  w2SsWages?: number;
  /** Medicare wages (W-2 box 5), for the Additional Medicare Tax threshold. */
  w2MedicareWages?: number;
}
/** Schedule SE (long form) lines, 2025 numbering. */
export interface SeResult {
  /** Line 2: net profit from Schedule C; line 3 is the same without farm / minister amounts. */
  line2: number;
  line3: number;
  /** Line 4a / 4c: 92.35% of line 3, and the line 4c amount tested against the $400 minimum. */
  line4a: number;
  line4c: number;
  line6: number;
  line7: number;
  line8d: number;
  line9: number;
  line10: number;
  line11: number;
  /** Line 12: self-employment tax. 0 when line 4c is under $400. */
  line12: number;
  /** Line 13: the deductible half (Schedule 1, line 15). */
  line13: number;
  owes: boolean;
  /** Form 8959: 0.9% on Medicare wages + SE earnings over the threshold (not part of Schedule SE; goes on Schedule 2). */
  additionalMedicare: number;
}
export function seTax(fed: FedTable, status: Status, i: SeInput): SeResult {
  const line2 = rd(i.netProfit),
    line3 = line2,
    line4a = line3 > 0 ? rd(line3 * fed.seFactor) : line3,
    line4c = line4a,
    owes = line4c >= fed.seMinimum,
    line6 = line4c,
    line7 = fed.ssWageBase,
    line8d = rd(i.w2SsWages ?? 0),
    line9 = Math.max(0, line7 - line8d),
    line10 = owes ? rd(Math.min(line6, line9) * fed.ssRate) : 0,
    line11 = owes ? rd(line6 * fed.medicareRate) : 0,
    line12 = line10 + line11,
    line13 = rd(line12 / 2);
  const over = (i.w2MedicareWages ?? 0) + (owes ? line6 : 0) - fed.addlMedicare.threshold[status];
  return {
    line2,
    line3,
    line4a,
    line4c,
    line6,
    line7,
    line8d,
    line9,
    line10,
    line11,
    line12,
    line13,
    owes,
    additionalMedicare: owes && over > 0 ? rd(Math.min(over, line6) * fed.addlMedicare.rate) : 0,
  };
}

export interface QbiInput {
  /** Qualified business income: Schedule C profit less the deductible half of SE tax, SE health insurance and retirement contributions (Reg. 1.199A-3(b)(1)(vi)). */
  qbi: number;
  /** Form 1040 line 11 less line 12 (AGI minus the standard / itemized deduction), before the QBI deduction. */
  taxableBefore: number;
  netCapitalGain?: number;
}
export interface QbiResult {
  /** Form 8995 line numbers. */
  line2: number;
  line4: number;
  line5: number;
  line10: number;
  line11: number;
  line12: number;
  line13: number;
  line14: number;
  /** Line 15 (Form 1040 line 13a): the deduction. */
  deduction: number;
  /** Taxable income is over the threshold: the simple Form 8995 no longer applies (wage / property limits, specified service trades: Form 8995-A). The deduction shown is only an upper bound. */
  above: boolean;
  /** Over the top of the phase-in range: a specified service business (consulting, law, health, …) gets nothing; others are limited by W-2 wages and property. */
  fullyPhasedIn: boolean;
  minimumApplied: boolean;
}
export function qbiDeduction(fed: FedTable, status: Status, i: QbiInput): QbiResult {
  const thr = fed.qbi.threshold[status],
    range = fed.qbi.phaseIn[status],
    line2 = rd(i.qbi),
    line4 = Math.max(0, line2),
    line5 = rd(line4 * 0.2),
    line10 = line5,
    line11 = Math.max(0, rd(i.taxableBefore)),
    line12 = rd(i.netCapitalGain ?? 0),
    line13 = Math.max(0, line11 - line12),
    line14 = rd(line13 * 0.2);
  let deduction = Math.min(line10, line14),
    minimumApplied = false;
  const min = fed.qbi.minimum;
  if (min && line4 >= min.minQbi && deduction < min.amount) {
    deduction = Math.min(min.amount, line13); // OBBBA §199A(i): $400 minimum, still capped by taxable income
    minimumApplied = deduction > Math.min(line10, line14);
  }
  return { line2, line4, line5, line10, line11, line12, line13, line14, deduction, above: line11 > thr, fullyPhasedIn: line11 > thr + range, minimumApplied };
}

export interface PersonalInput {
  year: number;
  status: Status;
  /** Schedule C line 31 (all of the owner's businesses). */
  netProfit: number;
  /** Wages, interest, spouse's business… everything else on the 1040, before adjustments. */
  otherIncome?: number;
  w2SsWages?: number;
  w2MedicareWages?: number;
  /** Federal income tax withheld from wages (W-2 box 2). */
  withholding?: number;
  /** Self-employed health insurance (Schedule 1 line 17) and SEP / solo 401(k) / SIMPLE contributions (line 16): reduce AGI and QBI. */
  seHealthInsurance?: number;
  retirement?: number;
  otherAdjustments?: number;
  /** Itemized deductions, used when larger than the standard deduction. */
  itemized?: number;
  /** Nonrefundable credits (child tax credit, …), as the user figured them. */
  credits?: number;
  netCapitalGain?: number;
  /** Flat state income tax rate in percent, user entered. */
  stateRate?: number;
}
export interface PersonalResult {
  se: SeResult;
  adjustments: number;
  agi: number;
  deduction: number;
  usedItemized: boolean;
  qbi: QbiResult;
  taxableBeforeQbi: number;
  taxable: number;
  incomeTax: number;
  marginal: number;
  /** Income tax after credits + SE tax + Additional Medicare Tax: Form 1040 "total tax". */
  totalTax: number;
  withholding: number;
  /** Total tax less withholding: what estimated payments and the balance due must cover. */
  afterWithholding: number;
  effectiveRate: number;
  state: { rate: number; tax: number };
}
export function personalTax(fed: FedTable, i: PersonalInput): PersonalResult {
  const se = seTax(fed, i.status, { netProfit: i.netProfit, w2SsWages: i.w2SsWages, w2MedicareWages: i.w2MedicareWages }),
    health = rd(i.seHealthInsurance ?? 0),
    retire = rd(i.retirement ?? 0),
    adjustments = se.line13 + health + retire + rd(i.otherAdjustments ?? 0),
    income = rd(i.netProfit) + rd(i.otherIncome ?? 0),
    agi = income - adjustments,
    std = fed.standardDeduction[i.status],
    usedItemized = (i.itemized ?? 0) > std,
    deduction = usedItemized ? rd(i.itemized!) : std,
    taxableBeforeQbi = Math.max(0, agi - deduction),
    qbi = qbiDeduction(fed, i.status, {
      qbi: rd(i.netProfit) - se.line13 - health - retire,
      taxableBefore: taxableBeforeQbi,
      netCapitalGain: i.netCapitalGain,
    }),
    taxable = Math.max(0, taxableBeforeQbi - qbi.deduction),
    tax = incomeTax(fed, i.status, taxable),
    afterCredits = Math.max(0, tax - rd(i.credits ?? 0)),
    totalTax = afterCredits + se.line12 + se.additionalMedicare,
    withholding = rd(i.withholding ?? 0),
    rate = i.stateRate && i.stateRate > 0 ? i.stateRate : 0;
  return {
    se,
    adjustments,
    agi,
    deduction,
    usedItemized,
    qbi,
    taxableBeforeQbi,
    taxable,
    incomeTax: tax,
    marginal: marginalRate(fed, i.status, taxable),
    totalTax,
    withholding,
    afterWithholding: totalTax - withholding,
    effectiveRate: income > 0 ? totalTax / income : 0,
    state: { rate, tax: rd(Math.max(0, income - se.line13) * (rate / 100)) },
  };
}

// ---------- estimated tax (Form 1040-ES; corporations: Form 1120-W) ----------
export interface EstimateInput {
  /** Tax year the payments are for. */
  year: number;
  status: Status;
  /** Expected total tax for that year (Form 1040 "total tax"), before payments. */
  expectedTax: number;
  /** Withholding expected for the year (counts as paid evenly). */
  withholding?: number;
  /** Total tax shown on the prior year's return, and its AGI. Unknown = only the 90% rule is used. */
  priorTax?: number | null;
  priorAgi?: number | null;
}
export interface Installment {
  n: 1 | 2 | 3 | 4;
  /** ISO date, moved off weekends and legal holidays. */
  due: string;
  amount: number;
}
export interface EstimateResult {
  /** Required annual payment (the smaller of the safe harbors), before withholding. */
  required: number;
  basis: "current" | "prior" | "none";
  /** 90% of the expected tax, and the prior-year safe harbor (null when unknown). */
  currentSafeHarbor: number;
  priorSafeHarbor: number | null;
  /** 110% rule applies (prior AGI over $150,000, $75,000 if married filing separately). */
  highIncome: boolean;
  /** No estimates needed: expected tax less withholding is under $1,000, or the prior year's tax was zero. */
  exempt: boolean;
  installments: Installment[];
  total: number;
  /** Jan 15 of the next year payment can be skipped by filing by Feb 1 and paying the balance (1040-ES). */
  skipLast: string;
}
/** 1040-ES due dates for year y: Apr 15, Jun 15, Sep 15 and Jan 15 of y+1, each moved to the next business day. */
export const estimateDates = (y: number): [string, string, string, string] => [dueOn(y, 4, 15), dueOn(y, 6, 15), dueOn(y, 9, 15), dueOn(y + 1, 1, 15)];
export const feb1 = (y: number) => dueOn(y + 1, 2, 1);

export function estimatedTaxes(fed: FedTable, i: EstimateInput): EstimateResult {
  const sh = fed.safeHarbor,
    wh = rd(i.withholding ?? 0),
    expected = Math.max(0, rd(i.expectedTax)),
    current = rd(expected * sh.current),
    highIncome = i.priorAgi != null && i.priorAgi > (i.status === "mfs" ? sh.highAgiMfs : sh.highAgi),
    prior = i.priorTax == null ? null : rd(Math.max(0, i.priorTax) * (highIncome ? sh.priorHighAgi : sh.prior)),
    useCurrent = prior === null || current <= prior,
    required = useCurrent ? current : prior!,
    exempt = expected - wh < sh.minOwe || (i.priorTax != null && i.priorTax <= 0),
    pay = exempt ? 0 : Math.max(0, required - wh),
    q = rd(pay / 4),
    dates = estimateDates(i.year);
  const installments = dates.map((due, k) => ({ n: (k + 1) as Installment["n"], due, amount: k === 3 ? pay - q * 3 : q }));
  return {
    required,
    basis: exempt ? "none" : useCurrent ? "current" : "prior",
    currentSafeHarbor: current,
    priorSafeHarbor: prior,
    highIncome,
    exempt,
    installments,
    total: pay,
    skipLast: feb1(i.year),
  };
}

/** C-corporation (Form 1120-W): four equal installments on the 15th of the 4th, 6th, 9th and 12th months; none if the tax is under $500. */
export function corpEstimates(fed: FedTable, year: number, expectedTax: number, priorTax?: number | null) {
  const exp = Math.max(0, rd(expectedTax)),
    exempt = exp < fed.corpEstimateMin,
    required = priorTax != null && priorTax > 0 ? Math.min(exp, rd(priorTax)) : exp, // ponytail: the prior-year rule is barred for "large" corporations (≥ $1M taxable income in any of the 3 prior years)
    q = exempt ? 0 : rd(required / 4);
  return {
    exempt,
    required: exempt ? 0 : required,
    installments: [dueOn(year, 4, 15), dueOn(year, 6, 15), dueOn(year, 9, 15), dueOn(year, 12, 15)].map((due, k) => ({
      n: k + 1,
      due,
      amount: exempt ? 0 : k === 3 ? required - q * 3 : q,
    })),
  };
}

/** Business standard mileage: miles × the rate in force on each trip's date (the 2026 rate changed on July 1). */
export function mileageDeduction(fed: FedTable, trips: readonly { date: string; miles: number }[]) {
  const rates = [...fed.mileage].sort((a, b) => (a.from < b.from ? -1 : 1));
  let total = 0,
    miles = 0;
  const bands = new Map<number, { miles: number; amount: number }>();
  for (const t of trips) {
    const r = [...rates].reverse().find((x) => x.from <= t.date) ?? rates[0];
    if (!r || !(t.miles > 0)) continue;
    const amount = (t.miles * r.cents) / 100;
    total += amount;
    miles += t.miles;
    const b = bands.get(r.cents) ?? { miles: 0, amount: 0 };
    b.miles += t.miles;
    b.amount += amount;
    bands.set(r.cents, b);
  }
  return { miles, amount: rd(total), bands: [...bands].map(([cents, b]) => ({ cents, miles: b.miles, amount: rd(b.amount) })) };
}
