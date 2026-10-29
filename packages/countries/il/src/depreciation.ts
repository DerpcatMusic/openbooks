// Fixed-asset register and annual depreciation (פחת, appendix 1342 to the return). Pure.
// Rates are the il.depreciation rule's `values` in tables/deductions.json (Income Tax (Depreciation) Regulations 1941, Hebrew Wikisource text):
// personal computers 33%, other computers 25%, electronic and computerised equipment 15%, general furniture 6%, private car 15%.
// Straight line on the original cost (before reclaimed VAT), from the month the asset is put to use, never beyond the cost.
// ponytail: the month of purchase stands for the month of first use and counts as a full month; immediate expensing of low-value items and
// accelerated rates are not applied (the rule marks them unverified). The asset class is guessed from the description unless the user sets it.

export type AssetClass = "computersPersonal" | "computersOther" | "electronicEquipment" | "furnitureGeneral" | "privateCar";
export const ASSET_CLASSES: readonly AssetClass[] = ["computersPersonal", "computersOther", "electronicEquipment", "furnitureGeneral", "privateCar"];

const CLASS_WORDS: readonly (readonly [AssetClass, RegExp])[] = [
  ["privateCar", /\b(car|vehicle|toyota|mazda|hyundai|tesla)\b|רכב|מכונית/i],
  ["computersOther", /\b(server|mainframe|nas)\b|שרת/i],
  ["computersPersonal", /laptop|macbook|computer|\bpc\b|notebook|desktop|ipad|tablet|מחשב|לפטופ|מחשבים|טאבלט/i],
  ["furnitureGeneral", /desk|chair|furniture|shelf|cabinet|table|שולחן|כיסא|ריהוט|ארון|מדף/i],
  ["electronicEquipment", /monitor|printer|camera|phone|iphone|router|screen|scanner|display|מסך|מדפסת|מצלמה|טלפון|נתב|סורק/i],
];
/** The class a description suggests; electronic equipment (15%) when nothing matches. */
export function guessClass(desc: string, rule?: string): AssetClass {
  if (rule === "il.vehicle.purchase") return "privateCar";
  return CLASS_WORDS.find(([, re]) => re.test(desc))?.[0] ?? "electronicEquipment";
}

export interface AssetIn {
  id: string;
  date: string;
  desc: string;
  /** Original cost: the price less the VAT that was reclaimed on it. */
  cost: number;
  rule?: string;
  /** The user's class for this asset, else guessed. */
  cls?: AssetClass;
}
export interface DepRow {
  id: string;
  desc: string;
  date: string;
  cls: AssetClass;
  guessed: boolean;
  cost: number;
  rate: number;
  /** Months in use during the year (0 before it was bought). */
  months: number;
  /** This year's depreciation. */
  amount: number;
  /** Total up to the end of the year, and what is left. */
  accumulated: number;
  remaining: number;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Depreciation of every asset bought on or before the end of `year`, for that year. */
export function depreciation(
  assets: readonly AssetIn[],
  rates: Readonly<Record<string, number>>,
  year: number,
): { rows: DepRow[]; totals: { cost: number; amount: number; accumulated: number; remaining: number; bought: number } } {
  const rows: DepRow[] = [];
  for (const a of assets) {
    const y0 = +a.date.slice(0, 4);
    if (y0 > year) continue;
    const cls = a.cls ?? guessClass(a.desc, a.rule),
      rate = rates[cls] ?? 0,
      m0 = +a.date.slice(5, 7);
    // accumulated through year-1 and through year, capped at the cost
    const monthsTo = (y: number) => (y < y0 ? 0 : (y - y0) * 12 + (13 - m0));
    const upto = (y: number) => Math.min(a.cost, (a.cost * rate * monthsTo(y)) / 12);
    const acc = r2(upto(year)),
      prev = r2(upto(year - 1));
    rows.push({
      id: a.id,
      desc: a.desc,
      date: a.date,
      cls,
      guessed: !a.cls,
      cost: r2(a.cost),
      rate,
      months: y0 === year ? 13 - m0 : prev < a.cost ? 12 : 0,
      amount: r2(acc - prev),
      accumulated: acc,
      remaining: r2(a.cost - acc),
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const sum = (f: (r: DepRow) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
  return {
    rows,
    totals: {
      cost: sum((r) => r.cost),
      amount: sum((r) => r.amount),
      accumulated: sum((r) => r.accumulated),
      remaining: sum((r) => r.remaining),
      bought: r2(rows.filter((r) => +r.date.slice(0, 4) === year).reduce((s, r) => s + r.cost, 0)),
    },
  };
}
