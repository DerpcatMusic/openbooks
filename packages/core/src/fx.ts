// Exchange rates: Bank of Israel representative rates (ILS per unit), looked up the way Israeli tax law reads them: the latest rate
// published on or before the date (BoI publishes none on weekends and holidays). Pure: the table comes in (importers/fx/boi.ts fetches it,
// the server caches it in doc(_app, "fx")). A missing rate is null, never 1.
import type { EntityMeta } from "@openbooks/schema";

/** currency → date (YYYY-MM-DD) → ILS per one unit. */
export type RateTable = Readonly<Record<string, Readonly<Record<string, number>>>>;
/** What callers pass around: units of the base currency per unit of `currency` on `date`; null = unknown. */
export type Fx = (currency: string, date: string) => number | null;

/** How many days back a rate may be carried. Covers the longest BoI gap (Rosh Hashana + a weekend); a stale cache beyond it is "missing". */
export const MAX_GAP_DAYS = 7;
const DAY = 86400000;
const back = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);

/** The entity's books currency: its meta, else its kind's (US LLC → USD), else ILS. */
export const currencyOf = (m: Pick<EntityMeta, "currency" | "kind">) => m.currency || (m.kind === "us-llc" ? "USD" : "ILS");

/** ILS per unit of `currency` on `date`: the latest rate on or before it within MAX_GAP_DAYS; ILS is 1; null when there is none. */
export function rateOn(table: RateTable, currency: string, date: string): number | null {
  if (currency === "ILS") return 1;
  const s = table[currency];
  if (!s) return null;
  for (let i = 0; i <= MAX_GAP_DAYS; i++) {
    const r = s[back(date, i)];
    if (r && r > 0) return r;
  }
  return null;
}

/** `amount` in `from` as `to` on `date`, crossed through ILS; null when either rate is missing. */
export function convert(table: RateTable, amount: number, from: string, to: string, date: string): number | null {
  if (from === to) return amount;
  const a = rateOn(table, from, date),
    b = rateOn(table, to, date);
  return a === null || b === null ? null : (amount * a) / b;
}

/** An Fx in `base` units (ILS: the BoI rate itself), for the VAT report and the tax code. */
export const fxOf =
  (table: RateTable, base = "ILS"): Fx =>
  (currency, date) =>
    convert(table, 1, currency, base, date);

/** The dates and currencies a table must cover: [currency, from, to] per currency, ILS left out. */
export function needed(rows: readonly { currency: string; date: string }[]): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  for (const { currency: c, date: d } of rows) {
    if (c === "ILS") continue;
    const r = out[c];
    if (!r) out[c] = [d, d];
    else {
      if (d < r[0]) r[0] = d;
      if (d > r[1]) r[1] = d;
    }
  }
  return out;
}
