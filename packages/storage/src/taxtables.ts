// Pure (no sqlite, no fs): the browser-only mode (apps/web/src/lib/local) imports this file directly.
import { il } from "@openbooks/country-il";
import { us } from "@openbooks/country-us";

/**
 * Pack tax tables in taxtables.json's shape ({country: {year: table}}, without the packs' `sources`, so state matches books.py),
 * with the app's overrides (doc(_app, "taxtables")) on top; an override of null removes that year.
 */
export function taxTables(overrides: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const p of [il, us])
    out[p.manifest.id] = Object.fromEntries(
      Object.entries(p.tables).map(([y, t]) => {
        const copy: Record<string, unknown> = { ...t };
        delete copy.sources;
        return [y, copy];
      }),
    );
  for (const [c, ys] of Object.entries(overrides))
    for (const [y, t] of Object.entries(ys)) {
      const to = (out[c] ??= {});
      if (t === null) delete to[y];
      else to[y] = t;
    }
  return out;
}
