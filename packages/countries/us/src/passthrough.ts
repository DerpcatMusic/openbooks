// Partnerships (Form 1065 + Schedule K-1) and S corporations (Form 1120-S + K-1): ordinary business income from the books, allocated to the
// owners by their percentages. A computed worksheet, not the IRS forms: the owners' K-1 numbers (box 1 ordinary income, box 4 guaranteed
// payments, box 14 self-employment earnings of a partner) are what each owner puts on their own return (Schedule E / Schedule SE).
// Sources: Instructions for Form 1065 https://www.irs.gov/instructions/i1065 and for Form 1120-S https://www.irs.gov/instructions/i1120s.
// Left out: separately stated items (§179, charitable gifts, credits), special allocations, basis and at-risk limits, state composite returns.
import { rd } from "./tax.ts";

export interface Owner {
  id?: string;
  name: string;
  tin?: string;
  /** Profit / ownership share in percent. The shares must add up to 100. */
  pct: number;
  /** Partnership: a general partner or an LLC member active in the business owes self-employment tax on their share; a limited partner does not. */
  role?: "general" | "limited";
  /** Guaranteed payments to a partner for services (Form 1065 line 10, K-1 box 4a): deducted by the partnership, SE income to the partner. */
  guaranteed?: number;
}
export interface PassThroughInput {
  type: "partnership" | "s-corp";
  year: number;
  revenue: number;
  cogs: number;
  /** Everything deductible from the deduction engine, in total. */
  deductions: number;
  otherIncome: number;
  /** Money paid out to the owners in the year (equity:owner outflows). */
  distributions: number;
  owners: readonly Owner[];
}
export interface K1 {
  name: string;
  tin?: string;
  pct: number;
  /** Box 1 ordinary business income (loss). */
  box1: number;
  /** Partnership only: box 4a guaranteed payments for services; box 14 code A self-employment earnings. */
  box4: number;
  box14: number;
  /** Share of the year's distributions (box 19A on a 1065, box 16D on a 1120-S), by percentage. */
  distribution: number;
}
export interface PassThrough {
  type: "partnership" | "s-corp";
  /** Return lines: gross receipts, COGS, gross profit, other income, total income, guaranteed payments, deductions, ordinary business income. */
  lines: { grossReceipts: number; cogs: number; grossProfit: number; otherIncome: number; totalIncome: number; guaranteedPayments: number; deductions: number; totalDeductions: number; ordinary: number };
  k1: K1[];
  pctTotal: number;
  warnings: string[];
}
export function passThrough(i: PassThroughInput): PassThrough {
  const part = i.type === "partnership",
    gp = part ? rd(i.owners.reduce((s, o) => s + Math.max(0, o.guaranteed ?? 0), 0)) : 0,
    grossProfit = rd(i.revenue) - rd(i.cogs),
    totalIncome = grossProfit + rd(i.otherIncome),
    ded = rd(i.deductions),
    ordinary = totalIncome - gp - ded,
    pctTotal = Math.round(i.owners.reduce((s, o) => s + (+o.pct || 0), 0) * 100) / 100,
    warnings: string[] = [];
  if (!i.owners.length) warnings.push("noOwners");
  else if (Math.abs(pctTotal - 100) > 0.005) warnings.push("pctNot100");
  if (!part) warnings.push("reasonableComp");
  let box1Left = ordinary;
  const k1 = i.owners.map((o, n): K1 => {
    const last = n === i.owners.length - 1,
      box1 = last && Math.abs(pctTotal - 100) < 0.005 ? box1Left : rd((ordinary * o.pct) / 100), // the last owner takes the rounding cent
      box4 = part ? rd(Math.max(0, o.guaranteed ?? 0)) : 0;
    box1Left -= box1;
    const se = part && o.role !== "limited"; // an S-corp shareholder's K-1 income is not SE income at all
    return {
      name: o.name,
      tin: o.tin,
      pct: o.pct,
      box1,
      box4,
      box14: se ? box1 + box4 : box4, // a limited partner's guaranteed payments for services are still SE income
      distribution: rd((i.distributions * o.pct) / 100),
    };
  });
  return {
    type: i.type,
    lines: { grossReceipts: rd(i.revenue), cogs: rd(i.cogs), grossProfit, otherIncome: rd(i.otherIncome), totalIncome, guaranteedPayments: gp, deductions: ded, totalDeductions: gp + ded, ordinary },
    k1,
    pctTotal,
    warnings,
  };
}
