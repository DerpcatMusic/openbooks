// Translate a deduction "why" code: the engine's own (taxtags.why.<k>) and a trip's (core trips.ts, sent as "trip.<k>" -> trips.why.<k>).
import { t, bidi, locale } from "../i18n.svelte.ts";

/** Codes whose number is money (shown in the books' currency through `fmt`). */
const MONEY = new Set(["capHit", "mobileLower", "carFormula", "trip.singleRoom", "trip.usPerDiem"]);
const PER = new Set(["capHit", "capUnchecked"]);
let names: { key: string; dn: Intl.DisplayNames } | null = null;
const region = (code: string) => {
  const key = locale();
  if (names?.key !== key) names = { key, dn: new Intl.DisplayNames(key, { type: "region" }) };
  try {
    return names.dn.of(code) ?? code;
  } catch {
    return code;
  }
};
export function whyText(w: { k: string; v?: number; w?: string }, fmt: (n: number, d?: number) => string) {
  const key = w.k.startsWith("trip.") ? `trips.why.${w.k.slice(5)}` : `taxtags.why.${w.k}`;
  const word = w.w && /^[A-Z]{2}$/.test(w.w) ? region(w.w) : PER.has(w.k) && w.w ? t(`taxtags.per.${w.w}`) : bidi(w.w ?? "");
  // plural-aware strings count days: the first number, or the second where that one is the total (business days of N)
  const n = w.k === "trip.mainPurpose" ? Number(w.w) : (w.v ?? 0);
  return t(key, { v: w.v === undefined ? "" : MONEY.has(w.k) ? fmt(w.v, 2) : String(w.v), w: word, n });
}
