// The person's foreign holdings for a year, shared by /you (cross-border card), the Israeli tax return and checks, and the filings
// calendar. What each business is comes from the entity list (no fetch): osek zair eligibility and Form 150. The amounts (attributed
// income, foreign tax credit) need the other businesses' books, fetched once per year and entity list.
import { il, zairExclusion } from "@openbooks/country-il";
import type { CrossBorder } from "@openbooks/core";
import { S } from "./stores/books.svelte.ts";
import { businesses, holdings, personNow, taxKey, type Biz } from "./person.ts";
import { rateOf } from "./fx.ts";

const books = $state<Record<string, Biz[] | { error: string }>>({});
const asked = new Set<string>(); // not reactive: a derived may ask for a fetch, only the async result writes state

/** Every business's year with its own books, or null while they load (`{ error }` if a fetch failed). */
export function bizFor(y: number): Biz[] | { error: string } | null {
  const es = S.data?.entities ?? [];
  const key = `${y}|${es.map((e) => e.id + ":" + JSON.stringify(e.types ?? {})).join()}`;
  if (!asked.has(key)) {
    asked.add(key);
    const snap = JSON.parse(JSON.stringify(es)) as typeof es;
    businesses(snap, y).then(
      (b) => (books[key] = b),
      (x) => (books[key] = { error: String((x as Error).message || x) }),
    );
  }
  return books[key] ?? null;
}

/** The person's Israeli year with foreign holdings: what blocks osek zair, how many Form 150s, and (once the books load) the crossBorder result. */
export function ilForeign(y: number) {
  const residence = personNow()?.residence ?? "il";
  const hs = holdings(S.data?.entities ?? [], y, residence);
  const foreign = hs.filter((h) => h.foreign),
    blocked =
      residence === "il"
        ? zairExclusion(
            hs.filter((h) => !h.foreign),
            foreign,
          )
        : [];
  return {
    foreign,
    blocked,
    zairExcluded: blocked.length > 0,
    /** The crossBorder result (null while loading or without foreign businesses); amounts are incomplete while `missingFx` is non-empty. */
    cb: (): CrossBorder | null => {
      const person = personNow();
      if (!foreign.length || !person || residence !== "il") return null;
      const b = bizFor(y);
      if (!b || "error" in b) return null;
      const abroad = b
        .filter((x) => x.year.country !== residence)
        .map((x) => ({ ...x.year, foreignTaxPaid: +(person.facts[taxKey(x.entity.id, y)] ?? 0) || 0 }));
      return il.crossBorder!(
        person,
        y,
        b.filter((x) => x.year.country === residence).map((x) => x.year),
        abroad,
        rateOf,
      );
    },
  };
}
