// Advisor (port of web/src/lib/advisor.js): turns playbook items into "what you should do" for one person and year.
// Every estimate re-runs ilPlan with and without the move, so savings include credit caps, BL and brackets. Items without an
// estimator still show up as checks; nothing is invented.
import type { Answer, Facts, PlaybookItem } from "@openbooks/core";
import { ilPlan, reservistPoints, type PlanInput } from "./calc.ts";
import type { IlRates } from "./schema.ts";

const kidPoints = (age: number, mother: boolean) =>
  age === 0 ? 2.5 : age <= 2 ? 4.5 : age === 3 ? 3.5 : age <= 5 ? 2.5 : age <= 17 ? (mother ? 2 : 1) : age === 18 ? (mother ? 0.5 : 0) : 0;
const RANK = { save: 0, check: 1, ask: 2, info: 3, na: 4 } as const;
const years = (s: Answer) =>
  String(s ?? "")
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
const num = (v: unknown) => +(v as number);

/** Extra credit points the answers earn in year y (beyond what the books already count). */
export function extraPoints(a: Facts, y: number): Record<string, number> {
  const kids = years(a.childBirthYears).filter((b) => y - b >= 0 && y - b <= 18);
  const deg = a.degreeType,
    end = num(a.degreeEndYear) || 0,
    n = Math.min(num(a.studyYears) || 3, deg === "MA" ? 2 : 3);
  const degree =
    !end || deg === "none" || !deg
      ? 0
      : end >= 2023
        ? y > end && y <= end + n
          ? deg === "MA"
            ? 0.5
            : 1
          : 0
        : end >= 2014 && y === end + 1
          ? deg === "MA"
            ? 0.5
            : 1
          : 0;
  return {
    "il-credit-woman": a.isWoman ? 0.5 : 0,
    "il-credit-children": kids.reduce((s, b) => s + kidPoints(y - b, a.parentRole !== "father"), 0),
    "il-credit-single-parent": a.singleParent && kids.length ? 1 + (a.otherParentDeceasedOrUnlisted ? 1 : 0) : 0,
    "il-credit-academic-degree": degree,
    "il-credit-disabled-child": a.disabledChild ? 2 : 0,
    "il-credit-alimony-remarried": a.paysAlimonyRemarried ? 1 : 0,
    "il-credit-reservist": reservistPoints(num(a.combatReserveDaysPrevYear) || 0, y),
  };
}

export interface AdviseContext {
  y: number;
  type: string;
  types: readonly string[];
  turnover: number;
  expenses: number;
  points: number;
  T: IlRates;
  fx?: number;
  usRoyalties?: number;
}
export type Status = keyof typeof RANK;
export interface Advice {
  item: PlaybookItem;
  status: Status;
  saving: number;
  missing: PlaybookItem["ask"][number][];
}

/** → advice sorted: biggest saving first, then checks, questions, info, n/a. */
export function advise(items: readonly PlaybookItem[], a: Facts, c: AdviseContext): Advice[] {
  const zair = c.type === "osek-zair";
  const base: PlanInput = {
    turnover: c.turnover,
    expenses: c.expenses,
    zair,
    points: c.points,
    pension: num(a.pensionDeposits) || 0,
    donations: num(a.donationsTotal) || 0,
    selfEmployed: true,
  };
  const total = (i: Partial<PlanInput>) => ilPlan({ ...base, ...i }, c.T).total;
  const now = c.T?.blRateReduced != null ? total({}) : null;
  const N = now ?? 0;
  const profit = Math.max(0, zair ? c.turnover * 0.7 : c.turnover - c.expenses);
  const pts = extraPoints(a, c.y);
  const est: Record<string, () => number> = {
    ...Object.fromEntries(Object.entries(pts).map(([id, p]) => [id, () => (p ? N - total({ points: c.points + p }) : 0)])),
    "il-pension-self-employed-47": () => {
      const best = Math.round((c.T.depositPct + c.T.creditPct) * Math.min(profit, c.T.mezakaMonthly * 24));
      return best > base.pension ? N - total({ pension: best }) : 0;
    },
    "il-keren-hishtalmut-self": () => {
      const cap = 0.045 * Math.min(profit, 293397);
      return Math.max(0, N - total({ deductions: cap - Math.min(num(a.khDeposits) || 0, cap) }));
    },
    "il-disability-insurance": () =>
      num(a.disabilityPremium) ? N - total({ deductions: Math.min(num(a.disabilityPremium), 0.035 * Math.min(profit, 356100)) }) : 0,
    "il-life-insurance-45a": () =>
      num(a.lifeInsurancePremium) ? N - total({ credits: 0.25 * Math.min(num(a.lifeInsurancePremium), 0.05 * Math.min(profit, 225600)) }) : 0,
    "il-donations-46": () => 0, // already in base when answered; shown as a check
    "il-osek-zair-vs-actual": () => {
      if (c.turnover > c.T.zairCeiling) return 0;
      const z = total({ zair: true }),
        r = total({ zair: false });
      return Math.max(0, N - Math.min(z, r));
    },
    "il-phone": () => (!zair && num(a.phoneCosts) ? N - total({ expenses: c.expenses + (num(a.phoneCosts) - Math.min(0.5 * num(a.phoneCosts), 1380)) }) : 0),
    "il-home-office": () =>
      !zair && num(a.homeCosts) && num(a.homeOfficeRooms) ? N - total({ expenses: c.expenses + num(a.homeCosts) * Math.min(1, num(a.homeOfficeRooms)) }) : 0,
    "il-car-expenses": () =>
      !zair && num(a.carCosts)
        ? N - total({ expenses: c.expenses + Math.max(0.45 * num(a.carCosts), num(a.carCosts) - 12 * 0.0248 * (num(a.carPrice) || 0)) })
        : 0,
    "us-w8ben-royalties-treaty": () => (num(a.usRoyalties) || c.usRoyalties || 0) * Math.max(0, (num(a.usWithheldPct) || 30) / 100 - 0.1) * (c.fx ?? 3.6),
  };
  const relevant = items.filter((it) => it.applies_to.some((t) => c.types.includes(t)));
  return relevant
    .map((it): Advice => {
      const missing = it.ask.filter((q) => a[q.key] === undefined || a[q.key] === "");
      const f = est[it.id];
      if ((f && now != null && missing.length < it.ask.length) || (f && !it.ask.length && now != null)) {
        const saving = Math.max(0, Math.round(f()));
        if (saving > 0) return { item: it, status: "save", saving, missing };
        if (!missing.length) return { item: it, status: "na", saving: 0, missing };
      }
      if (missing.length) return { item: it, status: "ask", saving: 0, missing };
      return { item: it, status: f ? "na" : ["compliance", "timing"].includes(it.kind) ? "check" : "info", saving: 0, missing };
    })
    .sort((x, z) => RANK[x.status] - RANK[z.status] || z.saving - x.saving);
}
