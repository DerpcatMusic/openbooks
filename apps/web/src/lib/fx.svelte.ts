// The one place the app gets an exchange rate: residence currency (₪) per unit of `currency` on `date`, the Bank of Israel
// representative rate (server: /api/fx, cached in books.db). Nothing else may hard-code or default a rate; null = "rate missing".
// A rate not loaded yet is null too: the first ask fetches that currency's year, and every derived that read it recomputes.
import { fxOf, type FxFn, type RateTable } from "@openbooks/core";
import { api } from "./api.ts";

let table = $state<RateTable>({});
let fxRev = $state(0);
const asked = new Set<string>(); // not reactive: a derived may ask, only the async answer writes state
const missingKeys = new Set<string>();

const today = () => new Date().toLocaleDateString("sv");
function want(currency: string, date: string) {
  const y = date.slice(0, 4),
    key = `${currency}|${y}`;
  if (currency === "ILS" || asked.has(key) || !/^[A-Z]{3}$/.test(currency)) return;
  asked.add(key);
  const end = `${y}-12-31` < today() ? `${y}-12-31` : today();
  void api
    .fx([currency], `${y}-01-01`, end)
    .then((r) => {
      missingKeys.delete(key);
      table = { ...table, [currency]: { ...table[currency], ...r.rates[currency] } };
    })
    .catch(() => asked.delete(key));
}

export const rateOf: FxFn = (currency, date) => {
  void fxRev; // reactive trigger so invalidating missing/current-year FX re-runs callers and triggers a fresh fetch
  want(currency, date);
  const r = fxOf(table, "ILS")(currency, date);
  if (r === null && currency !== "ILS" && /^[A-Z]{3}$/.test(currency)) missingKeys.add(`${currency}|${date.slice(0, 4)}`);
  return r;
};

/** Re-allow FX fetches for any missing currency/year (and optionally current year when `_app/fx` or external sync updates). */
export function invalidateMissingFx(includeCurrentYear = false) {
  let changed = false;
  for (const key of missingKeys) {
    asked.delete(key);
    changed = true;
  }
  missingKeys.clear();
  if (includeCurrentYear) {
    const curY = `|${today().slice(0, 4)}`;
    for (const key of [...asked]) {
      if (key.endsWith(curY)) {
        asked.delete(key);
        changed = true;
      }
    }
  }
  if (changed) fxRev++;
}

/** Today's rate for planning screens (Taxximizer, planner) when the user hasn't typed one; null = missing (or still loading). */
export const rateToday = (currency: string) => rateOf(currency, today());
