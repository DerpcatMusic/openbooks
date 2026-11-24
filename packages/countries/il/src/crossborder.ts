// Israeli resident with foreign entities. The Israeli tax treatment of a foreign entity (transparent vs company vs unresolved,
// e.g. under Circular 5/2004) is a year-specific Israeli tax position, independent of the entity's U.S. classification.
// Transparent foreign entities are attributed in ₪ at each transaction's Bank of Israel rate; companies are not attributed
// (dividends are taxed when paid). Unresolved entities are flagged clearly rather than silently attributed.
import type { CrossBorder, EntityYear, FxFn, Obligation, Person, ResidenceTreatment } from "@openbooks/core";
import { extraPoints } from "./advisor.ts";
import { bands } from "./calc.ts";
import type { IlRates } from "./schema.ts";

/** What decides osek zair eligibility: the type, foreign manifest treatment, and explicit Israeli treatment (if set). */
export type Holding = Pick<EntityYear, "entity" | "type" | "treatment" | "ilTreatment">;

/** Income Tax Circular 7/2025 §3.3 (osek zair, Ordinance §87ב–87ז, amendment 265) and Kol Zchut's summary of the conditions. */
export const ZAIR_SOURCE = "https://www.gov.il/BlobFolder/policy/inst-07-2025/he/IncomeTax_inst-07-2025.pdf";
export const ZAIR_SOURCE_KZ = "https://www.kolzchut.org.il/he/עסק_זעיר";
/** Form 150: declaration of a holding in a foreign entity, an appendix to the annual return (Circular 7/2025 §3.11). */
export const FORM_150_URL = "https://www.gov.il/he/service/itc-150";
/** Circular 5/2004: Israeli tax treatment of foreign transparent entities (US LLC election). */
export const CIRCULAR_5_2004_URL = "https://www.gov.il/he/service/itc-150";

/** Effective Israeli treatment for a foreign holding: explicit year-specific decision if set, else manifest treatment. */
export function effectiveIlTreatment(h: Pick<Holding, "treatment" | "ilTreatment">): ResidenceTreatment | "partnership" | "sole-proprietor" {
  return h.ilTreatment ?? h.treatment;
}

/**
 * Foreign tax credit cap (Income Tax Ordinance §204, appendix 1324): single shared formula used by both
 * ilCrossBorder() and form1301() so every surface reports the exact same credit for the same inputs.
 * Proportional share of net Israeli ordinary tax (after credit points & payment credits) attributable to the foreign income.
 * Note: Israeli law computes credits per income basket (e.g. business vs royalties); verify baskets with an Israeli accountant.
 */
export function foreignTaxCreditCap(i: {
  /** Net Israeli ordinary tax on all ordinary income (after credit points and payment credits). */
  netOrdinaryTax: number;
  /** Total ordinary income (domestic + foreign) before personal deductions. */
  ordinaryIncome: number;
  /** Attributed foreign ordinary income included in ordinaryIncome. */
  foreignIncome: number;
  /** Foreign tax paid/withheld in ₪ on that foreign income. */
  foreignTaxPaid: number;
}): number {
  if (!(i.foreignIncome > 0) || !(i.foreignTaxPaid > 0) || !(i.ordinaryIncome > 0) || !(i.netOrdinaryTax > 0)) return 0;
  const share = Math.min(1, i.foreignIncome / i.ordinaryIncome);
  const israeliOnForeign = i.netOrdinaryTax * share;
  return Math.max(0, Math.min(i.foreignTaxPaid, israeliOnForeign));
}

/**
 * Why osek zair is closed to the person (Circular 7/2025 §3.3): part of the business income is attributed from a transparent entity
 * (under its resolved Israeli treatment), or the person controls a company (closely held: one owner here).
 * Unresolved foreign holdings do NOT silently trigger an attribution exclusion until the Israeli tax position is confirmed.
 */
export function zairExclusion(home: readonly Holding[], foreign: readonly Holding[]): { key: string; law: string; url: string }[] {
  const hasTransparent = foreign.some((e) => {
    const tr = effectiveIlTreatment(e);
    return tr === "transparent" || tr === "partnership";
  });
  const hasCompany = home.some((e) => e.treatment === "company") || foreign.some((e) => effectiveIlTreatment(e) === "company");
  return [
    ...(hasTransparent ? [{ key: "zair", law: "§87ב–87ז", url: ZAIR_SOURCE }] : []),
    ...(hasCompany ? [{ key: "zairCompany", law: "§87ב–87ז", url: ZAIR_SOURCE }] : []),
  ];
}

/** Sum of amounts converted on their own dates; the ones without a rate are listed, never priced at a default. */
export function convert(currency: string, lines: readonly { date: string; amount: number }[], fx: FxFn) {
  const missing: { currency: string; date: string }[] = [];
  let total = 0;
  for (const l of lines) {
    if (!l.amount) continue;
    const r = currency === "ILS" ? 1 : fx(currency, l.date);
    if (r == null || !Number.isFinite(r)) missing.push({ currency, date: l.date });
    else total += l.amount * r;
  }
  return { total, missing };
}

export function ilCrossBorder(
  T: IlRates,
  person: Person,
  y: number,
  home: readonly EntityYear[],
  foreign: readonly EntityYear[],
  fx: FxFn,
  today = new Date().toISOString().slice(0, 10),
): CrossBorder {
  const unresolved = foreign.filter((e) => e.ilTreatment === "unresolved").map((e) => ({ entity: e.entity, country: e.country, type: e.type }));
  const flows = foreign.filter((e) => {
    const tr = effectiveIlTreatment(e);
    return tr === "transparent" || tr === "partnership";
  });
  // ponytail: the foreign books' expenses are taken as their own pack's P&L; Israeli expense rules (car, phone, meals shares…) are not re-applied
  // to them before attribution. Upgrade: run core deductions() with the IL pack's table over the foreign entity's txns.
  const income = flows.map((e) => convert(e.currency, e.lines, fx));
  // Foreign tax is converted on its recorded payment date (or min(today, Dec 31) so in-year withholding doesn't ask for a future Dec 31 rate).
  const defaultTaxDate = `${y}-12-31` > today && today.startsWith(`${y}-`) ? today : `${y}-12-31`;
  const tax = flows.map((e) =>
    e.foreignTaxPaid > 0 ? convert(e.currency, [{ date: e.foreignTaxDate || defaultTaxDate, amount: e.foreignTaxPaid }], fx) : { total: 0, missing: [] },
  );
  const missing = [...income, ...tax].flatMap((c) => c.missing);
  const attributedIncome = income.reduce((a, c) => a + c.total, 0);
  const foreignTax = tax.reduce((a, c) => a + c.total, 0);
  const blocked = zairExclusion(home, foreign);
  const points = 2.25 + Object.values(extraPoints(person.facts, y)).reduce((a, p) => a + p, 0);
  const turnover = home.reduce((a, e) => a + e.revenue, 0);
  const expenses = home.reduce((a, e) => a + e.expenses, 0);
  const zair = home.some((e) => e.type === "osek-zair") && !blocked.length;
  const domesticBusiness = zair ? turnover * 0.7 : Math.max(0, turnover - expenses);
  const foreignIncome = Math.max(0, attributedIncome);
  const ordinaryIncome = domesticBusiness + foreignIncome;
  const ordTax = bands(ordinaryIncome, T.brackets);
  const credits = Math.min(points * T.point, ordTax);
  const foreignTaxCredit = foreignTaxCreditCap({
    netOrdinaryTax: ordTax - credits,
    ordinaryIncome,
    foreignIncome,
    foreignTaxPaid: foreignTax,
  });
  const obligations: Obligation[] = foreign.length
    ? [
        { form: "1301", country: "il", why: "annual return: a resident with a foreign business must file" },
        ...(attributedIncome || foreignTax || missing.length
          ? [{ form: "1324", country: "il", why: "foreign income and the foreign tax credit (appendix to 1301)" }]
          : []),
        ...foreign.map((e) => ({ form: "150", country: "il", why: `holding in a foreign entity (${e.entity})` })),
      ]
    : [];
  return {
    attributedIncome,
    foreignTax,
    foreignTaxCredit,
    blocked,
    obligations,
    missingFx: missing,
    ...(unresolved.length ? { unresolved } : {}),
  };
}
