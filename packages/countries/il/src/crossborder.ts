// Israeli resident with foreign entities. A transparent foreign entity (US single-member LLC, disregarded) is taxed in Israel
// as the owner's own business income: attributed in ₪ at the rate of each transaction's date, without osek zair's 30% deemed
// expenses, with BL; US tax on it is credited up to the Israeli tax it causes. Companies (C-corp) are not attributed here (their
// dividends are). Reports the forms that follow and why osek zair is closed to the person.
import type { CrossBorder, EntityYear, FxFn, Obligation, Person } from "@openbooks/core";
import { extraPoints } from "./advisor.ts";
import { ilPlan } from "./calc.ts";
import type { IlRates } from "./schema.ts";

/** What decides osek zair eligibility: the type and treatment of each entity the person holds. */
export type Holding = Pick<EntityYear, "entity" | "type" | "treatment">;

/** Income Tax Circular 7/2025 §3.3 (osek zair, Ordinance §87ב–87ז, amendment 265) and Kol Zchut's summary of the conditions. */
export const ZAIR_SOURCE = "https://www.gov.il/BlobFolder/policy/inst-07-2025/he/IncomeTax_inst-07-2025.pdf";
export const ZAIR_SOURCE_KZ = "https://www.kolzchut.org.il/he/עסק_זעיר";
/** Form 150: declaration of a holding in a foreign entity, an appendix to the annual return (Circular 7/2025 §3.11). */
export const FORM_150_URL = "https://www.gov.il/he/service/itc-150";

/**
 * Why osek zair is closed to the person (Circular 7/2025 §3.3): part of the business income is attributed from a transparent entity
 * (a foreign disregarded LLC or partnership is treated so here), or the person controls a company (closely held: one owner here).
 * ponytail: every company in the books is assumed controlled by the person (single-owner books); a minority holding would not block.
 */
export function zairExclusion(home: readonly Holding[], foreign: readonly Holding[]): { key: string; law: string; url: string }[] {
  const all = [...home, ...foreign];
  return [
    ...(foreign.some((e) => e.treatment === "transparent" || e.treatment === "partnership") ? [{ key: "zair", law: "§87ב–87ז", url: ZAIR_SOURCE }] : []),
    ...(all.some((e) => e.treatment === "company") ? [{ key: "zairCompany", law: "§87ב–87ז", url: ZAIR_SOURCE }] : []),
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

export function ilCrossBorder(T: IlRates, person: Person, y: number, home: readonly EntityYear[], foreign: readonly EntityYear[], fx: FxFn): CrossBorder {
  const flows = foreign.filter((e) => e.treatment === "transparent" || e.treatment === "partnership");
  // ponytail: the foreign books' expenses are taken as their own pack's P&L; Israeli expense rules (car, phone, meals shares…) are not re-applied
  // to them before attribution. Upgrade: run core deductions() with the IL pack's table over the foreign entity's txns.
  const income = flows.map((e) => convert(e.currency, e.lines, fx));
  // foreign tax is a per-year answer: priced at the year-end rate (ponytail: per payment date once payments are recorded one by one)
  const tax = flows.map((e) => convert(e.currency, [{ date: `${y}-12-31`, amount: e.foreignTaxPaid }], fx));
  const missing = [...income, ...tax].flatMap((c) => c.missing);
  const attributedIncome = income.reduce((a, c) => a + c.total, 0);
  const foreignTax = tax.reduce((a, c) => a + c.total, 0);
  const blocked = zairExclusion(home, foreign);
  const points = 2.25 + Object.values(extraPoints(person.facts, y)).reduce((a, p) => a + p, 0);
  const base = {
    turnover: home.reduce((a, e) => a + e.revenue, 0),
    expenses: home.reduce((a, e) => a + e.expenses, 0),
    zair: home.some((e) => e.type === "osek-zair") && !blocked.length,
    points,
    pension: 0,
    donations: 0,
    selfEmployed: true,
  };
  const extraTax = ilPlan({ ...base, foreign: attributedIncome }, T).tax - ilPlan(base, T).tax;
  const obligations: Obligation[] = foreign.length
    ? [
        { form: "1301", country: "il", why: "annual return: a resident with a foreign business must file" },
        ...(attributedIncome || foreignTax || missing.length ? [{ form: "1324", country: "il", why: "foreign income and the foreign tax credit (appendix to 1301)" }] : []),
        ...foreign.map((e) => ({ form: "150", country: "il", why: `holding in a foreign entity (${e.entity})` })),
      ]
    : [];
  return {
    attributedIncome,
    foreignTaxCredit: Math.max(0, Math.min(foreignTax, extraTax)),
    blocked,
    obligations,
    missingFx: missing,
  };
}
