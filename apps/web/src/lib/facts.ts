// Person facts & entity holding helpers (doc _app/person, see person.ts): pure helpers, no Svelte runes, so they are unit-tested on their own.
import type { CountryPack, EntityYear, Facts, Person, ResidenceTreatment } from "@openbooks/core";
import { il } from "@openbooks/country-il";
import { us } from "@openbooks/country-us";
import type { Entity } from "./api.ts";

const DEFAULT_PACKS: readonly CountryPack[] = [il, us];

type Answer = Facts[string];

/** Key in person facts for the foreign tax paid by an entity in a year (flat, so facts stay a plain answer map). */
export const taxKey = (e: string, y: number) => `foreignTax.${e}.${y}`;
/** Key in person facts for the date foreign tax was paid/withheld (YYYY-MM-DD), used for BoI FX lookup instead of a future Dec 31. */
export const taxDateKey = (e: string, y: number) => `foreignTaxDate.${e}.${y}`;
/** Key in person facts for the year-specific Israeli tax treatment of a foreign entity ("unresolved" | "transparent" | "company"). */
export const ilTreatmentKey = (e: string, y: number) => `ilTreatment.${e}.${y}`;

/**
 * Year-specific Israeli tax position for a foreign holding, separated from the foreign entity's own U.S. type.
 * For foreign transparent/partnership entities (e.g. U.S. LLCs), defaults to "unresolved" until the owner explicitly
 * confirms the Israeli treatment (Circular 5/2004 / management & control) for that tax year.
 */
export function ilTreatmentOf(facts: Facts | undefined, entityId: string, y: number, manifestTreatment: EntityYear["treatment"]): ResidenceTreatment {
  const saved = facts?.[ilTreatmentKey(entityId, y)];
  if (saved === "transparent" || saved === "company" || saved === "unresolved") return saved;
  return manifestTreatment === "company" ? "company" : "unresolved";
}

/**
 * The business type in force in tax year y: respects formation/disposal dates and never falls back to a legacy kind
 * when explicit year entries exist only for later years (so an LLC formed in 2026 does not appear as a 2025 holding).
 */
export function typeOf(e: Partial<Entity>, y: number, packs: readonly CountryPack[] = DEFAULT_PACKS): string | undefined {
  if (e.formed && e.formed > `${y}-12-31`) return undefined;
  if (e.disposed && e.disposed < `${y}-01-01`) return undefined;
  const t = e.types ?? {},
    keys = Object.keys(t);
  const from = keys
    .filter((k) => +k <= y)
    .sort()
    .at(-1);
  if (from) return t[from];
  if (keys.length) return undefined; // typed for later years only -> did not exist in year y
  return e.kind ? packs.find((p) => e.kind! in p.manifest.legacyKinds)?.manifest.legacyKinds[e.kind] : undefined;
}

export const packOf = (e: Partial<Entity>, y: number, packs: readonly CountryPack[] = DEFAULT_PACKS): CountryPack | undefined => {
  const ty = typeOf(e, y, packs);
  return ty ? packs.find((p) => p.manifest.businessTypes.some((b) => b.key === ty)) : undefined;
};

/** What every business is, in year y, from the entity list alone (no books fetched): enough to decide osek zair eligibility and Form 150. */
export function holdings(es: readonly Partial<Entity>[], y: number, residence: string, facts?: Facts, packs: readonly CountryPack[] = DEFAULT_PACKS) {
  return es.flatMap((e) => {
    const p = packOf(e, y, packs),
      type = typeOf(e, y, packs);
    if (!p || !type) return [];
    const treatment = p.manifest.businessTypes.find((b) => b.key === type)!.treatment;
    const foreign = p.manifest.id !== residence;
    const id = e.id ?? "";
    return [
      {
        entity: id,
        country: p.manifest.id,
        type,
        treatment,
        foreign,
        ...(foreign && residence === "il" ? { ilTreatment: ilTreatmentOf(facts, id, y, treatment) } : {}),
      },
    ];
  });
}

/** facts with k set (empty = removed, so the advisor asks again). */
export const withFact = (p: Person, k: string, v: Answer): Person => {
  const facts: Record<string, Answer> = { ...p.facts };
  if (v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v))) delete facts[k];
  else facts[k] = v;
  // the legacy twins (see normalizeFacts) must not outvote a new answer
  if (k === "dischargeDate") delete facts.discharge;
  if (k === "fullService" && facts.serviceMonths !== undefined && +facts.serviceMonths >= 23 !== v) delete facts.serviceMonths;
  if (k === "serviceMonths") {
    if (k in facts) facts.fullService = +facts.serviceMonths! >= 23;
    else delete facts.fullService;
  }
  return { ...p, facts };
};

/**
 * The playbook asks `dischargeDate` / `fullService`; the old 1301 profile (and the server's first-load merge) stored `discharge` /
 * `serviceMonths`. Fill the asked keys from those, so an answered question is never listed as open.
 */
export function normalizeFacts(f: Facts): Facts {
  const o: Record<string, Answer> = { ...f };
  if ((o.dischargeDate === undefined || o.dischargeDate === "") && o.discharge) o.dischargeDate = o.discharge;
  if (o.fullService === undefined && o.serviceMonths !== undefined && o.serviceMonths !== "") o.fullService = +o.serviceMonths >= 23;
  return o;
}
/** The 1301 profile fields that are really person facts (release date, months served): the person's answer wins over the profile. */
export function profileFromPerson<P extends Record<string, unknown>>(profile: P, f: Facts | undefined): P & { discharge?: string; serviceMonths?: number } {
  if (!f) return profile;
  const discharge = String(f.dischargeDate ?? f.discharge ?? "") || (profile.discharge as string | undefined);
  const months =
    f.serviceMonths !== undefined && f.serviceMonths !== ""
      ? +f.serviceMonths
      : f.fullService === true
        ? 23
        : f.fullService === false
          ? 0
          : (profile.serviceMonths as number | undefined);
  return { ...profile, ...(discharge ? { discharge } : {}), ...(months !== undefined ? { serviceMonths: months } : {}) };
}
/** An answer as the advisor asks it (legacy keys mapped, see normalizeFacts). */
export const answerOf = (f: Facts, k: string): Answer => normalizeFacts(f)[k];
