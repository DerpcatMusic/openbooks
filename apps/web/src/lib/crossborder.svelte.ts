// The person's foreign holdings for a year, shared by /you (cross-border card), the Israeli tax return and checks, and the filings
// calendar. What each business is comes from the entity list (no fetch): osek zair eligibility and Form 150. The amounts (attributed
// income, foreign tax credit) need the other businesses' books, fetched per year, entity list, and SSE change version so editing an
// LLC transaction refreshes the Israeli calculation in the same session.
import { il, zairExclusion } from "@openbooks/country-il";
import type { CrossBorder } from "@openbooks/core";
import { S } from "./stores/books.svelte.ts";
import { businesses, holdings, ilTreatmentOf, personNow, taxDateKey, taxKey, type Biz } from "./person.ts";
import { rateOf } from "./fx.svelte.ts";

const books = $state<Record<string, Biz[] | { error: string }>>({});
const asked = new Set<string>(); // not reactive: a derived may ask for a fetch, only the async result writes state

/** Clear cached foreign books (e.g., after an explicit refresh). */
export function invalidateCrossBorder() {
  asked.clear();
  for (const k of Object.keys(books)) delete books[k];
}

/** Every business's year with its own books, or null while they load (`{ error }` if a fetch failed). */
export function bizFor(y: number): Biz[] | { error: string } | null {
  const es = S.data?.entities ?? [];
  // Include S.v (SSE change version) and current entity txn count so editing an LLC transaction invalidates the cache immediately.
  const txnSig = `${S.e}:${S.data?.txns.length ?? 0}`;
  const key = `${y}|v${S.v}|${txnSig}|${es.map((e) => `${e.id}:${e.formed ?? ""}:${JSON.stringify(e.types ?? {})}`).join()}`;
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

/** The person's Israeli year with foreign holdings: what blocks osek zair, unresolved positions, Form 150s, and the crossBorder result. */
export function ilForeign(y: number) {
  const person = personNow();
  const residence = person?.residence ?? "il";
  const facts = person?.facts;
  const hs = holdings(S.data?.entities ?? [], y, residence, facts);
  const foreign = hs.filter((h) => h.foreign),
    unresolved = foreign.filter((h) => h.ilTreatment === "unresolved"),
    blocked =
      residence === "il"
        ? zairExclusion(
            hs.filter((h) => !h.foreign),
            foreign,
          )
        : [];
  return {
    foreign,
    unresolved,
    blocked,
    zairExcluded: blocked.length > 0,
    /** The crossBorder result (null while loading or without foreign businesses); amounts are incomplete while `missingFx` or `unresolved` is non-empty. */
    cb: (): CrossBorder | null => {
      if (!foreign.length || !person || residence !== "il") return null;
      const b = bizFor(y);
      if (!b || "error" in b) return null;
      const abroad = b
        .filter((x) => x.year.country !== residence)
        .map((x) => {
          const dt = person.facts[taxDateKey(x.entity.id, y)];
          return {
            ...x.year,
            ilTreatment: ilTreatmentOf(person.facts, x.entity.id, y, x.year.treatment),
            foreignTaxPaid: +(person.facts[taxKey(x.entity.id, y)] ?? 0) || 0,
            ...(typeof dt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dt) ? { foreignTaxDate: dt } : {}),
          };
        });
      if (!abroad.length) return null;
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
