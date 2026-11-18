// The one place the app gets an exchange rate: residence currency (₪) per unit of `currency` on `date`, the Bank of Israel
// representative rate. Nothing else may hard-code or default a rate; a null here is shown as "rate missing".
// ponytail: no rate source is wired yet (the Bank of Israel source lands on its own branch and plugs in here), so every rate is missing.
import type { FxFn } from "@openbooks/core";

export const rateOf: FxFn = () => null;

/** Today's rate for planning screens (Taxximizer, planner) when the user hasn't typed one; null = missing. */
export const rateToday = (currency: string) => rateOf(currency, new Date().toLocaleDateString("sv"));
