import type { XxTable } from "./schema.ts";

/** Progressive tax on income. */
export function incomeTax(income: number, T: XxTable): number {
  let tax = 0,
    lo = 0;
  for (const [hi, rate] of T.brackets) {
    tax += Math.max(0, Math.min(income, hi ?? Infinity) - lo) * rate;
    lo = hi ?? Infinity;
  }
  return tax;
}
