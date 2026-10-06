// Israeli resident with foreign entities. A transparent foreign entity (US single-member LLC, disregarded) is taxed in Israel
// as the owner's own business income: attributed in ₪, without osek zair's 30% deemed expenses, with BL; US tax on it is credited
// up to the Israeli tax it causes. Companies (C-corp) are not attributed here (their dividends are). Reports the forms that follow.
import type { CrossBorder, EntityYear, Obligation, Person } from "@openbooks/core";
import { extraPoints } from "./advisor.ts";
import { ilPlan } from "./calc.ts";
import type { IlRates } from "./schema.ts";

export function ilCrossBorder(
  T: IlRates,
  person: Person,
  y: number,
  home: readonly EntityYear[],
  foreign: readonly EntityYear[],
  fx: Readonly<Record<string, number>>,
): CrossBorder {
  const rate = (e: EntityYear) => (e.currency === "ILS" ? 1 : (fx[e.currency] ?? NaN)); // NaN on a missing rate: never silently 0
  const flows = foreign.filter((e) => e.treatment === "transparent" || e.treatment === "partnership");
  const attributedIncome = flows.reduce((a, e) => a + (e.revenue - e.expenses) * rate(e), 0);
  const foreignTax = flows.reduce((a, e) => a + e.foreignTaxPaid * rate(e), 0);
  const points = 2.25 + Object.values(extraPoints(person.facts, y)).reduce((a, p) => a + p, 0);
  const base = {
    turnover: home.reduce((a, e) => a + e.revenue, 0),
    expenses: home.reduce((a, e) => a + e.expenses, 0),
    zair: home.some((e) => e.type === "osek-zair"),
    points,
    pension: 0,
    donations: 0,
    selfEmployed: true,
  };
  const extraTax = ilPlan({ ...base, foreign: attributedIncome }, T).tax - ilPlan(base, T).tax;
  const obligations: Obligation[] = foreign.length
    ? [
        { form: "1301", country: "il", why: "annual return: a resident with a foreign business must file" },
        ...(attributedIncome || foreignTax ? [{ form: "1324", country: "il", why: "foreign income and the foreign tax credit (appendix to 1301)" }] : []),
        ...foreign.map((e) => ({ form: "150", country: "il", why: `holding in a foreign entity (${e.entity})` })),
      ]
    : [];
  return {
    attributedIncome,
    foreignTaxCredit: Math.max(0, Math.min(foreignTax, extraTax)),
    // ponytail: section as given in the phase-1 brief; playbook-style source/verification still to do (docs/architecture.md, open items)
    blocked: attributedIncome ? [{ key: "zair", law: "§87ה" }] : [],
    obligations,
  };
}
