// The one place the app gets an exchange rate: residence currency (₪) per unit of `currency` on `date`, the Bank of Israel
// representative rate (server: /api/fx, cached in books.db). Nothing else may hard-code or default a rate; null = "rate missing".
// A rate not loaded yet is null too: the first ask fetches that currency's year, and every derived that read it recomputes.
import { fxOf, type FxFn, type RateTable } from "@openbooks/core";
import { api } from "./api.ts";

let table = $state<RateTable>({});
const asked = new Set<string>(); // not reactive: a derived may ask, only the async answer writes state

const today = () => new Date().toLocaleDateString("sv");
function want(currency: string, date: string) {
  const y = date.slice(0, 4),
    key = `${currency}|${y}`;
  if (currency === "ILS" || asked.has(key) || !/^[A-Z]{3}$/.test(currency)) return;
  asked.add(key);
  const end = `${y}-12-31` < today() ? `${y}-12-31` : today();
  void api
    .fx([currency], `${y}-01-01`, end)
    .then((r) => (table = { ...table, [currency]: { ...table[currency], ...r.rates[currency] } }))
    .catch(() => asked.delete(key));
}

export const rateOf: FxFn = (currency, date) => {
  want(currency, date);
  return fxOf(table, "ILS")(currency, date);
};

/** Today's rate for planning screens (Taxximizer, planner) when the user hasn't typed one; null = missing (or still loading). */
export const rateToday = (currency: string) => rateOf(currency, today());
