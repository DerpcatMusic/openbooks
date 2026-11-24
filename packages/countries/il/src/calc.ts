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
  /** A loss-of-work-capacity insurance deduction is claimed: the pension credit base drops from 5.5% to 5% (§45א(ו)). */
  disability?: boolean;
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
/** Self-employed BL dues on a yearly base (reduced rate up to blReducedMonthly, full above). */
const blDues = (base: number, T: IlRates) =>
  bands(base, [
    [T.blReducedMonthly * 12, T.blRateReduced],
    [null, T.blRateFull],
  ]);
/**
 * BL's yearly base for a self-employed person: income after the pension deduction and after the deductible share (blDeductPct, 52%) of the
 * dues themselves (btl.gov.il self-employed rates), within the minimum and maximum. The dues depend on the base, so it is solved by
 * fixed-point iteration (contraction factor 0.52 × 12.83% ≈ 0.07: converges to the cent in a few rounds). `deduct` false: osek zair, whose
 * income is 70% of turnover with no §47א deduction.
 */
export function blBaseOf(income: number, T: IlRates, selfEmployed: boolean, deduct: boolean): number {
  const clamp = (b: number) => Math.min(Math.max(b, selfEmployed ? T.blMinMonthly * 12 : 0), T.blMaxMonthly * 12);
  let base = clamp(income);
  if (deduct) for (let k = 0; k < 30; k++) base = clamp(income - T.blDeductPct * blDues(base, T));
  return base;
}
/**
 * One scenario. deductions: extra §17(5א)/disability-type deductions (taxable income only); credits: extra credits such as §45א life insurance
 * (applied last, capped). zair = 30% deemed expenses (no §47א BL deduction); otherwise actual expenses with 52% of BL deductible.
 * `foreign` (attributed foreign income) is added after the 30%: deemed expenses never apply to it.
 */
export function ilPlan(i: PlanInput, T: IlRates): Plan {
  const business = Math.max(0, i.zair ? i.turnover * 0.7 : i.turnover - i.expenses) + (i.foreign ?? 0);
  const capBase = Math.min(business, T.mezakaMonthly * 24);
  const pensionDed = Math.min(i.pension, T.depositPct * capBase),
    pensionCreditBase = Math.min(i.pension - pensionDed, (i.disability ? T.creditPctDisability : T.creditPct) * capBase);
  const blBase = blBaseOf(business - pensionDed, T, i.selfEmployed, !i.zair);
  const red = T.blReducedMonthly * 12;
  const bl = blDues(blBase, T),
    health = bands(blBase, [
      [red, T.healthRateReduced],
      [null, T.healthRateFull],
    ]);
  const blDed = i.zair ? 0 : Math.min(T.blDeductPct * bl, business - pensionDed);
  const taxable = Math.max(0, business - pensionDed - blDed - (i.deductions ?? 0));
  const gross = bands(taxable, T.brackets);
  const pointsCredit = Math.min(gross, i.points * T.point),
    pensionCredit = Math.min(gross - pointsCredit, T.creditRate * pensionCreditBase);
  const donationCredit = Math.min(gross - pointsCredit - pensionCredit, i.donations >= T.donationMin ? T.creditRate * Math.min(i.donations, 0.3 * taxable) : 0);
  const otherCredit = Math.min(gross - pointsCredit - pensionCredit - donationCredit, i.credits ?? 0);
  const tax = gross - pointsCredit - pensionCredit - donationCredit - otherCredit;
  const total = tax + bl + health;
  const grossIncome = i.turnover + (i.foreign ?? 0);
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
    effective: grossIncome ? total / grossIncome : 0,
    keep: grossIncome - (i.zair ? 0 : i.expenses) - total,
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
    // §121ב: 3% general surtax applies to total income (s + div) above threshold;
    // Amendment 277 (§121ב(א1), 2025+) 2% capital surtax applies ONLY to capital income (`div`) above threshold on its own.
    const overGeneral = Math.min(div, Math.max(0, s + div - Math.max(s, L.surtaxThreshold)));
    const overCapital = Math.max(0, div - L.surtaxThreshold);
    const divTax = div * L.divRate + overGeneral * L.surtax + overCapital * L.surtaxCapital;
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
  /** Osek zair (30% deemed expenses) is legally closed by §87ד (e.g. holding a transparent foreign LLC or controlling a company). */
  zairExcluded?: boolean;
  /** ILS per USD for the foreign structures' US costs; missing = those rows say the rate is missing (never a default). */
  fx?: number | null;
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
    fx = i.fx ?? null,
    under = i.revenue <= T.zairCeiling,
    zairAllowed = under && !i.zairExcluded;
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
  const noRate = (key: StructureKey): Structure => ({ key, label: key, ok: false, why: { k: "noRate" } });
  // ponytail: `as number` mirrors planner.js, where a missing cost is undefined and poisons the row to NaN; tables always carry costs
  const C = { ...T.costs, ...i.costs } as Record<string, number>,
    UC = U?.costs ?? {};
  const rows: Structure[] = [
    under && i.paturOk !== false
      ? osek("patur", "patur", flat, C.patur as number, zairAllowed, "patur")
      : { key: "patur", label: "patur", ok: false, why: i.paturOk === false ? { k: "patur" } : { k: "ceiling", amount: T.zairCeiling } },
    osek("murshe", zairAllowed ? "murshePlus" : "murshe", reg, C.murshe as number, zairAllowed, zairAllowed ? "murshePlus" : "murshe"),
    corp("ltd", "ltd", reg, C.ltd as number, T.ltd.corpRate, "ltd"),
    UC.llc && !fx ? noRate("llc") : osek("llc", "llc", abroad, (UC.llc ?? 0) * (fx ?? 0) + (C.llc as number), false, "llc"),
    UC.ccorp && !fx
      ? noRate("ccorp")
      : corp("ccorp", "ccorp", abroad, (UC.ccorp ?? 0) * (fx ?? 0) + (C.ccorp as number), Math.max(U?.corpRate ?? 0.21, T.ltd.corpRate), "ccorp"),
  ];
  const ranked = rows.filter((r): r is Ok => r.ok).sort((a, b) => b.keep - a.keep);
  return { rows, ranked, best: ranked[0] };
}

// ---------- SITUATION-ADAPTIVE STRATEGY ENGINE ----------
// Computes legal, cited, situation-specific tax-optimization plays tailored to the taxpayer's exact entity mix
// (e.g., Israeli osek + US disregarded LLC), cross-border treatments, current deposits, and uncategorized ledger spend.

export type StrategyCategory = "structure" | "shelter" | "crossborder" | "classification" | "credits";
export type StrategyRisk = "none" | "low" | "medium" | "high";

export interface StrategyHolding {
  readonly entity: string;
  readonly name?: string;
  readonly country: string;
  readonly type: string;
  readonly ilTreatment?: "unresolved" | "transparent" | "company";
  readonly revenueIls?: number;
  readonly expensesIls?: number;
}

export interface StrategyInput {
  readonly year: number;
  readonly types: readonly string[];
  readonly currentType: string | null;
  readonly holdings: readonly StrategyHolding[];
  readonly revenueIls: number;
  readonly expensesIls: number;
  readonly clients: Clients;
  readonly points: number;
  readonly paturOk?: boolean;
  readonly zairExcluded?: boolean;
  readonly pensionDeposited?: number;
  readonly khDeposited?: number;
  readonly donations?: number;
  readonly usRoyaltiesUsd?: number;
  readonly usWithheldPct?: number;
  readonly uncategorizedExpenseIls?: number;
  readonly fx?: number | null;
  readonly costs?: Partial<Record<string, number>>;
}

export interface StrategyPlay {
  readonly id: string;
  readonly category: StrategyCategory;
  readonly title_en: string;
  readonly title_he: string;
  readonly summary_en: string;
  readonly summary_he: string;
  readonly appliesBecause_en: string;
  readonly appliesBecause_he: string;
  readonly guardrail_en: string;
  readonly guardrail_he: string;
  readonly statute: string;
  readonly sourceUrl: string;
  readonly annualSavingIls: number;
  readonly deferralIls?: number;
  readonly risk: StrategyRisk;
  readonly actionHref: string;
}

/**
 * Generate ranked, legally cited, situation-adaptive tax plays for the taxpayer's exact structure & numbers.
 * Every ₪ amount is computed directly by ilPlan / company / taxximize against the statutory table (zero fabricated estimates).
 */
export function strategyPlays(inp: StrategyInput, T: IlRates, U?: ForeignCosts): StrategyPlay[] {
  const plays: StrategyPlay[] = [];
  const hasUsLlc = inp.types.includes("llc-disregarded") || inp.holdings.some((h) => h.type === "llc-disregarded");
  const hasIlOsek = inp.types.some((t) => t.startsWith("osek-"));
  const zairNow = inp.currentType === "osek-zair" && !inp.zairExcluded && inp.revenueIls <= T.zairCeiling;
  const unresolved = inp.holdings.filter((h) => h.ilTreatment === "unresolved");

  const foreignNet = inp.holdings
    .filter((h) => h.ilTreatment === "transparent")
    .reduce((s, h) => s + Math.max(0, (h.revenueIls ?? 0) - (h.expensesIls ?? 0)), 0);

  const basePlanInput: PlanInput = {
    turnover: inp.revenueIls,
    expenses: inp.expensesIls,
    foreign: foreignNet,
    zair: zairNow,
    points: inp.points,
    pension: inp.pensionDeposited ?? 0,
    donations: inp.donations ?? 0,
    selfEmployed: true,
  };
  const baseline = ilPlan(basePlanInput, T);
  const profit = baseline.business;

  // 1. Structure optimization (situation-aware: honors zairExcluded & real entity mix)
  const tx = taxximize(
    {
      revenue: inp.revenueIls,
      expenses: inp.expensesIls,
      clients: inp.clients,
      points: inp.points,
      paturOk: inp.paturOk,
      zairExcluded: inp.zairExcluded,
      fx: inp.fx,
      costs: inp.costs,
    },
    T,
    U,
  );
  const mapKey: Record<string, StructureKey> = {
    "osek-patur": "patur",
    "osek-zair": "murshe",
    "osek-murshe": "murshe",
    ltd: "ltd",
    "llc-disregarded": "llc",
    "llc-ccorp": "ccorp",
  };
  const currentKey = inp.currentType ? mapKey[inp.currentType] : undefined;
  const currentRow = currentKey ? tx.rows.find((x) => x.key === currentKey && x.ok) : undefined;
  if (tx.best && currentRow && currentRow.ok && tx.best.key !== currentRow.key) {
    const gain = Math.round(tx.best.keep - currentRow.keep);
    if (gain > 250) {
      plays.push({
        id: "strategy.structure",
        category: "structure",
        title_en: `Switch structure to ${tx.best.label.toUpperCase()} for maximum net keep`,
        title_he: `מעבר למבנה ${tx.best.label.toUpperCase()} להגדלת הנטו השנתי`,
        summary_en: `At your current revenue, expenses, and client mix, ${tx.best.label.toUpperCase()} keeps more after income tax, Bituach Leumi, VAT, and compliance costs than your current ${inp.currentType}.`,
        summary_he: `בהכנסות, בהוצאות ובתמהיל הלקוחות הנוכחי שלך, מבנה ${tx.best.label.toUpperCase()} משאיר יותר נטו לאחר מס הכנסה, ביטוח לאומי, מע"מ ועלויות רו"ח לעומת ${inp.currentType}.`,
        appliesBecause_en: `Active structure: ${inp.types.join(" + ")}${inp.zairExcluded ? " (Osek Zair 30% deemed expenses excluded under §87ד)" : ""}.`,
        appliesBecause_he: `מבנה פעיל: ${inp.types.join(" + ")}${inp.zairExcluded ? " (מסלול עוסק זעיר 30% חסום לפי סעיף 87ד)" : ""}.`,
        guardrail_en:
          "Structural changes take effect by tax year / VAT registration date; verify VAT-exempt profession list and accounting transition with a CPA.",
        guardrail_he: 'שינוי התאגדות חל לפי שנת מס / מועד רישום במע"מ; יש לוודא רשימת מקצועות פטורים ומעבר מסודר עם רו"ח.',
        statute: "ITO §87ד, §121, §126; VAT Law §31",
        sourceUrl: "https://he.wikisource.org/wiki/פקודת_מס_הכנסה#סעיף_121",
        annualSavingIls: gain,
        risk: "low",
        actionHref: "/settings",
      });
    }
  }

  // 2. Keren Hishtalmut §17(5א): deductible now + tax-free capital gains compounding (up to annual ceiling)
  if (profit > 0 && hasIlOsek) {
    const maxDedKh = T.khPct * Math.min(profit, T.khIncomeCap);
    const alreadyKh = Math.min(inp.khDeposited ?? 0, maxDedKh);
    const addKh = Math.max(0, maxDedKh - alreadyKh);
    if (addKh > 100) {
      const withKh = ilPlan({ ...basePlanInput, deductions: addKh }, T);
      const saving = Math.round(baseline.total - withKh.total);
      if (saving > 0) {
        plays.push({
          id: "strategy.kh",
          category: "shelter",
          title_en: "Max out Keren Hishtalmut (§17(5א)) — immediate deduction + tax-free growth",
          title_he: "מיצוי הפקדה לקרן השתלמות (סעיף 17(5א)) — ניכוי מיידי ופטור ממס רווחי הון",
          summary_en: `Deposit an additional ₪${Math.round(addKh).toLocaleString("en-US")} (up to 4.5% of qualifying profit capped at ₪${T.khIncomeCap.toLocaleString("en-US")}) before Dec 31 to cut tax immediately and unlock tax-free investment compounding after 6 years.`,
          summary_he: `הפקדה נוספת של ₪${Math.round(addKh).toLocaleString("en-US")} (עד 4.5% מההכנסה הקובעת עד תקרת ₪${T.khIncomeCap.toLocaleString("en-US")}) לפני 31.12 מקטינה מס מיד וצוברת פטור ממס רווחי הון לאחר 6 שנים.`,
          appliesBecause_en: `Self-employed Israeli profit of ₪${Math.round(profit).toLocaleString("en-US")} with ₪${Math.round(alreadyKh).toLocaleString("en-US")} deposited so far.`,
          appliesBecause_he: `רווח עצמאי של ₪${Math.round(profit).toLocaleString("en-US")} עם הפקדה נוכחית של ₪${Math.round(alreadyKh).toLocaleString("en-US")}.`,
          guardrail_en: "Must clear in the fund before Dec 31 of the tax year; works even on the Osek Zair 30% track.",
          guardrail_he: "חייב להיקלט בקרן עד 31 בדצמבר של שנת המס; מוכר גם במסלול עוסק זעיר.",
          statute: "ITO §17(5א), §9(16ב)",
          sourceUrl: "https://he.wikisource.org/wiki/פקודת_מס_הכנסה#סעיף_17",
          annualSavingIls: saving,
          risk: "none",
          actionHref: "/tax/il",
        });
      }
    }
  }

  // 3. Self-employed Pension §47 + §45A maximization (deduction + 35% credit + BL base reduction)
  if (profit > 0 && hasIlOsek) {
    const capBase = Math.min(profit, T.mezakaMonthly * 24);
    const optimalPension = Math.round((T.depositPct + T.creditPct) * capBase);
    const currentPension = inp.pensionDeposited ?? 0;
    if (optimalPension > currentPension + 100) {
      const withPension = ilPlan({ ...basePlanInput, pension: optimalPension }, T);
      const saving = Math.round(baseline.total - withPension.total);
      if (saving > 0) {
        plays.push({
          id: "strategy.pension",
          category: "shelter",
          title_en: "Optimize Pension deposits (§47 deduction + §45A 35% credit + BL reduction)",
          title_he: 'אופטימיזציית הפקדות פנסיה (ניכוי סעיף 47 + זיכוי 35% סעיף 45א + הפחתת בט"ל)',
          summary_en: `Increasing pension deposits from ₪${Math.round(currentPension).toLocaleString("en-US")} to ₪${optimalPension.toLocaleString("en-US")} (16.5% up to ₪${Math.round(capBase).toLocaleString("en-US")}) lowers income tax AND Bituach Leumi dues simultaneously.`,
          summary_he: `הגדלת ההפקדה לפנסיה מ-₪${Math.round(currentPension).toLocaleString("en-US")} ל-₪${optimalPension.toLocaleString("en-US")} (16.5% עד תקרת ₪${Math.round(capBase).toLocaleString("en-US")}) מפחיתה במקביל מס הכנסה ודמי ביטוח לאומי.`,
          appliesBecause_en: `Qualifying business profit ₪${Math.round(profit).toLocaleString("en-US")}; mandatory + voluntary headroom remaining.`,
          appliesBecause_he: `הכנסה מזכה של ₪${Math.round(profit).toLocaleString("en-US")}; קיימת תקרת הפקדה פנויה להטבת מס.`,
          guardrail_en: "Funds are locked for retirement (annuity); deposit must settle before Dec 31 and keep Form 867 / annual fund certificate.",
          guardrail_he: "כספי הפנסיה סגורים לגיל פרישה; יש להפקיד עד 31.12 ולשמור אישור שנתי למס הכנסה.",
          statute: "ITO §47, §45א(ו)",
          sourceUrl: "https://he.wikisource.org/wiki/פקודת_מס_הכנסה#סעיף_47",
          annualSavingIls: saving,
          risk: "none",
          actionHref: "/tax/il",
        });
      }
    }
  }

  // 4. Cross-border US LLC classification & Form 150 / Circular 5/2004 optimization
  if (hasUsLlc) {
    const zairDelta =
      inp.currentType === "osek-zair" && inp.revenueIls <= T.zairCeiling
        ? Math.round(Math.max(0, ilPlan({ ...basePlanInput, zair: false }, T).total - ilPlan({ ...basePlanInput, zair: true }, T).total))
        : 0;
    if (unresolved.length > 0) {
      plays.push({
        id: "strategy.crossborder-resolve",
        category: "crossborder",
        title_en: `Resolve Israeli tax classification for ${unresolved.map((u) => u.name || u.entity).join(", ")} (Circular 5/2004)`,
        title_he: `הכרעה בסיווג המס הישראלי של ${unresolved.map((u) => u.name || u.entity).join(", ")} (חוזר 5/2004)`,
        summary_en:
          zairDelta > 0
            ? `A US disregarded LLC is a corporation by default in Israel unless you elect transparent look-through under Circular 5/2004. Transparent election enables direct §204 US tax credit, but closes Osek Zair 30% deemed expenses (costing ~₪${zairDelta.toLocaleString("en-US")} if your real IL expenses are below 30%).`
            : `Decide year-by-year whether your US LLC is treated as transparent (Circular 5/2004 — avoids double-tax on US profits via §204 FTC) or as an opaque foreign company (Form 150 + management-and-control / CFC review).`,
        summary_he:
          zairDelta > 0
            ? `חברת LLC אמריקאית שקופה מסווגת בישראל כחברה כברירת מחדל אלא אם בוחרים בשקיפות לפי חוזר 5/2004. בחירה בשקיפות מאפשרת זיכוי מס זר לפי סעיף 204, אך סוגרת את מסלול עוסק זעיר 30% (פער של כ-₪${zairDelta.toLocaleString("en-US")} אם הוצאותיך נמוכות מ-30%).`
            : `יש לקבוע לכל שנת מס האם ה-LLC מסווגת בישראל כשקופה (חוזר 5/2004 — מאפשרת זיכוי מס זר לפי סעיף 204) או כחברה זרה (טופס 150 + בחינת שליטה וניהול / חנ"ז).`,
        appliesBecause_en: `You hold ${unresolved.length} US entity with unresolved Israeli tax treatment for ${inp.year}.`,
        appliesBecause_he: `קיימת ${unresolved.length} ישות זרה שסיווג המס הישראלי שלה לשנת ${inp.year} טרם הוכרע.`,
        guardrail_en:
          "A US disregarded LLC managed solely from Israel carries Israeli management-and-control ('שליטה וניהול') risk if treated as an opaque company; document the position with a cross-border CPA and file Form 150 + IRS Form 5472.",
        guardrail_he:
          "LLC המנוהלת מישראל בלבד חשופה לטענת 'שליטה וניהול' אם תטופל כחברה אטומה; יש לתעד עמדה עם רו\"ח מיסוי בינלאומי ולהגיש טופס 150 ו-Form 5472.",
        statute: "ITA Circular 5/2004, ITO §75ב, §204; IRC §6038A (Form 5472)",
        sourceUrl: "https://www.irs.gov/instructions/i5472",
        annualSavingIls: zairDelta,
        risk: "high",
        actionHref: "/you#cross-border",
      });
    }

    // 5. US-IL Treaty Art. 14 W-8BEN royalty shield (10% vs 30% withholding)
    if (inp.fx && (inp.usRoyaltiesUsd ?? 0) > 0) {
      const withheldRate = (inp.usWithheldPct ?? 30) / 100;
      const spread = Math.max(0, withheldRate - 0.1);
      const treatySaving = Math.round((inp.usRoyaltiesUsd ?? 0) * spread * inp.fx);
      if (treatySaving > 0) {
        plays.push({
          id: "strategy.treaty-w8ben",
          category: "crossborder",
          title_en: "Claim US–Israel Treaty Art. 14 (10% vs 30% withholding via W-8BEN)",
          title_he: 'הפעלת אמנת המס ארה"ב–ישראל סעיף 14 (10% במקום 30% באמצעות W-8BEN)',
          summary_en: `Filing W-8BEN in your personal name (as beneficial owner of a disregarded LLC) with your Israeli TIN cuts US copyright/film royalty withholding from ${Math.round(withheldRate * 100)}% to 10%. Israel will NOT credit excess withholding above the 10% treaty rate.`,
          summary_he: `הגשת W-8BEN בשמך האישי (כבעלים של LLC שקופה) עם מספר ת.ז. ישראלי מפחיתה את ניכוי המס בארה"ב על תמלוגים מ-${Math.round(withheldRate * 100)}% ל-10%. ישראל אינה מזכה על ניכוי יתר מעבר לשיעור האמנה.`,
          appliesBecause_en: `US-source royalties of $${Math.round(inp.usRoyaltiesUsd ?? 0).toLocaleString("en-US")} at ₪${inp.fx.toFixed(2)}/USD.`,
          appliesBecause_he: `תמלוגים ממקור אמריקאי בסך $${Math.round(inp.usRoyaltiesUsd ?? 0).toLocaleString("en-US")} בשער ₪${inp.fx.toFixed(2)}/USD.`,
          guardrail_en:
            "Never submit a W-9 for a foreign-owned single-member disregarded LLC; for services performed physically in Israel, US withholding is 0% (IRC §862).",
          guardrail_he: 'אין להגיש W-9 עבור LLC שקופה בבעלות זרה; על שירותים המבוצעים פיזית מישראל אין ניכוי מס במקור בארה"ב (0%).',
          statute: "US–Israel Tax Treaty Art. 14; IRC §862 / §1441",
          sourceUrl: "https://www.irs.gov/businesses/international-businesses/israel-tax-treaty-documents",
          annualSavingIls: treatySaving,
          risk: "none",
          actionHref: "/tax/us",
        });
      }
    }
  }

  // 6. Ledger expense classification & uncategorized recovery (dynamic from live books!)
  if ((inp.uncategorizedExpenseIls ?? 0) > 50 && !zairNow) {
    const withCategorized = ilPlan({ ...basePlanInput, expenses: inp.expensesIls + (inp.uncategorizedExpenseIls ?? 0) }, T);
    const saving = Math.round(Math.max(0, baseline.total - withCategorized.total));
    if (saving > 0) {
      plays.push({
        id: "strategy.classify-expenses",
        category: "classification",
        title_en: "Classify uncategorized expenses to capture full business deductions",
        title_he: "סיווג הוצאות לא מסווגות למיצוי מלא של הניכויים העסקיים",
        summary_en: `You have ₪${Math.round(inp.uncategorizedExpenseIls ?? 0).toLocaleString("en-US")} in uncategorized outflows. Every documented, legitimate business expense (software, equipment, professional services, home office) cuts both income tax and Bituach Leumi.`,
        summary_he: `קיימות ₪${Math.round(inp.uncategorizedExpenseIls ?? 0).toLocaleString("en-US")} בהוצאות שטרם סווגו. כל הוצאה עסקית מתועדת כדין (תוכנה, ציוד, שירותים מקצועיים, משרד ביתי) מפחיתה הן מס הכנסה והן ביטוח לאומי.`,
        appliesBecause_en: `Live ledger scan detected ₪${Math.round(inp.uncategorizedExpenseIls ?? 0).toLocaleString("en-US")} in 'ask' expenses on actual-expense track.`,
        appliesBecause_he: `סריקה חיה של הספרים זיהתה ₪${Math.round(inp.uncategorizedExpenseIls ?? 0).toLocaleString("en-US")} בהוצאות לא מסווגות במסלול הוצאות בפועל.`,
        guardrail_en:
          "Only classify genuinely business-related outlays supported by tax invoices/receipts; mixed expenses (phone, car, home office, meals) must use statutory deduction tags.",
        guardrail_he: "יש לסווג רק הוצאות עסקיות אמיתיות המגובות בחשבוניות/קבלות; הוצאות מעורבות (טלפון, רכב, בית, אירוח) חייבות תיוג לפי כללי המס.",
        statute: "ITO §17, §31; Income Tax Regulations (Deduction of Certain Expenses)",
        sourceUrl: "https://he.wikisource.org/wiki/פקודת_מס_הכנסה#סעיף_17",
        annualSavingIls: saving,
        risk: "none",
        actionHref: "/transactions?cat=ask",
      });
    }
  }

  // 7. Israeli Ltd retained-earnings deferral & employer benefits (what high-profit companies legally do)
  const netPreTax = Math.max(0, inp.revenueIls - inp.expensesIls + foreignNet);
  if (netPreTax >= 250_000) {
    // Compare retaining surplus inside an Ltd (23% corporate tax §126) after paying an optimal base salary (~180k)
    // vs taking all profit personally as self-employed (35%–50% marginal + BL).
    const ltdCost = (inp.costs?.ltd ?? T.costs?.ltd ?? 42_700) as number;
    const targetSalary = Math.min(netPreTax - ltdCost, 180_000);
    if (targetSalary > 60_000) {
      const erBl = employerBL(targetSalary, T);
      const eeBl = employeeBL(targetSalary, T);
      const salaryTax = Math.max(0, bands(targetSalary, T.brackets) - inp.points * T.point);
      const retainedPreCorp = Math.max(0, netPreTax - ltdCost - targetSalary - erBl);
      const corpTax = retainedPreCorp * T.ltd.corpRate;
      const totalLtdAnnualTax = salaryTax + eeBl + erBl + corpTax + ltdCost;
      const personalTotal = baseline.total + ((inp.costs?.murshe ?? T.costs?.murshe ?? 6_500) as number);
      const deferralGain = Math.round(personalTotal - totalLtdAnnualTax);
      if (deferralGain > 10_000) {
        plays.push({
          id: "strategy.ltd-deferral",
          category: "structure",
          title_en: "Israeli Ltd retained-earnings deferral (23% corporate rate vs top personal brackets)",
          title_he: 'דחיית מס בחברה בע"מ ישראלית (23% מס חברות לעומת מדרגות מס שוליות גבוהות)',
          summary_en: `Retaining ~₪${Math.round(retainedPreCorp).toLocaleString("en-US")}/yr inside an Israeli Ltd (taxed at 23% under §126) while drawing an optimal ~₪${Math.round(targetSalary).toLocaleString("en-US")} salary defers ~₪${deferralGain.toLocaleString("en-US")}/yr of tax & BL compared to full personal taxation — freeing capital to reinvest or fund employer 7.5% Keren Hishtalmut.`,
          summary_he: `צבירת ~₪${Math.round(retainedPreCorp).toLocaleString("en-US")}/שנה בתוך חברה בע"מ (23% מס חברות לפי סעיף 126) לצד משיכת משכורת אופטימלית של ~₪${Math.round(targetSalary).toLocaleString("en-US")} דוחה כ-₪${deferralGain.toLocaleString("en-US")}/שנה במס וביטוח לאומי ומאפשרת הפקדת מעסיק של 7.5% לקרן השתלמות.`,
          appliesBecause_en: `Combined pre-tax profit of ₪${Math.round(netPreTax).toLocaleString("en-US")} exceeds the 31%–47% personal marginal bracket threshold.`,
          appliesBecause_he: `רווח משולב לפני מס של ₪${Math.round(netPreTax).toLocaleString("en-US")} חוצה את מדרגות המס השוליות הגבוהות (31%–47%).`,
          guardrail_en:
            "This is tax DEFERRAL (30% dividend tax applies on distribution under §125ב). Check §62א (single-client personal-service company attribution) and §81ב (2% undistributed-profits surtax on excess passive reserves above 25% of revenue).",
          guardrail_he:
            "מדובר בדחיית מס (בעת חלוקת דיבידנד חל 30% מס לפי סעיף 125ב). יש לוודא אי-תחולה של סעיף 62א (חברת ארנק / לקוח יחיד) וסעיף 81ב (תוספת 2% על רווחים לא מחולקים עודפים).",
          statute: "ITO §126, §125ב, §62א, §81ב",
          sourceUrl: "https://he.wikisource.org/wiki/פקודת_מס_הכנסה#סעיף_126",
          annualSavingIls: 0,
          deferralIls: deferralGain,
          risk: "medium",
          actionHref: "/taxximizer",
        });
      }
    }
  }

  return plays.sort((a, b) => b.annualSavingIls + (b.deferralIls ?? 0) * 0.5 - (a.annualSavingIls + (a.deferralIls ?? 0) * 0.5));
}
