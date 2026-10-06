// "You": the human behind every business (docs/architecture.md § Country packs, person level). One doc(_app, "person") on the
// server (GET/POST /api/person). Until it's saved the server merges the old per-entity `advisor` docs (first non-empty answer per
// key wins); loadPerson() stores that merge once, so the migration happens on first load and loses nothing.
// Also: each business's EntityYear (its own books, its own pack) for the residence pack's crossBorder hook.
import { pl, type CountryPack, type EntityYear, type Facts, type Obligation, type Person } from "@openbooks/core";
import { soldierPoints } from "@openbooks/country-il";
import { llcObligations, us } from "@openbooks/country-us";
import { api, request, type Entity } from "./api.ts";
import { PACKS } from "./i18n.svelte.ts";
import { ME } from "./me.svelte.ts";
import { normalizeFacts } from "./facts.ts";
export { answerOf, normalizeFacts, profileFromPerson, withFact } from "./facts.ts";

export type { Person };

/** The business type in force in tax year y: the latest change on or before y, else the legacy kind's default. */
export function typeOf(e: Partial<Entity>, y: number): string | undefined {
  const t = e.types ?? {},
    from = Object.keys(t)
      .filter((k) => +k <= y)
      .sort()
      .at(-1);
  return from ? t[from] : e.kind ? PACKS.find((p) => e.kind! in p.manifest.legacyKinds)?.manifest.legacyKinds[e.kind] : undefined;
}
export const packOf = (e: Partial<Entity>, y: number): CountryPack | undefined => {
  const ty = typeOf(e, y);
  return ty ? PACKS.find((p) => p.manifest.businessTypes.some((b) => b.key === ty)) : undefined;
};
export const packById = (id: string): CountryPack | undefined => PACKS.find((p) => p.manifest.id === id);
/** Residence when nothing is saved: the first business whose pack can be a residence pack (has crossBorder). */
export const defaultResidence = (es: readonly Partial<Entity>[], y: number) =>
  es.map((e) => packOf(e, y)).find((p) => !!p?.crossBorder)?.manifest.id ?? PACKS.find((p) => "crossBorder" in p)!.manifest.id;

type Got = { person: Person; saved: boolean };
let queue: Promise<unknown> = Promise.resolve();
/** Writes go out in order: each POST replaces the whole doc, so a later answer must never be overtaken by an earlier one. */
export function savePerson(p: Person): Promise<Person> {
  ME.person = p;
  const r = queue.then(() => request<Got>("/api/person", p)).then((d) => (ME.person = d.person));
  queue = r.catch(() => {});
  return r;
}
export async function loadPerson(es: readonly Partial<Entity>[], y: number, migrated?: () => void): Promise<Person> {
  const d = await request<Got>("/api/person");
  const facts = normalizeFacts(d.person.facts);
  if (d.saved && d.person.residence && Object.keys(facts).length === Object.keys(d.person.facts).length) return (ME.person = d.person);
  if (!(d.saved && d.person.residence) && Object.keys(facts).length) migrated?.();
  return savePerson({ residence: d.person.residence || defaultResidence(es, y), facts });
}
/** The person for screens that only read it (tax return, planner): fetched once, no migration write; null until it arrives. */
let fetching = false;
export function personNow(): Person | null {
  if (!ME.person && !fetching) {
    fetching = true;
    request<Got>("/api/person")
      .then((d) => (ME.person ??= { ...d.person, facts: normalizeFacts(d.person.facts) }))
      .catch(() => (fetching = false));
  }
  return ME.person;
}

/** Credit points the person facts give before the advisor's extras: resident 2.25 + released soldier (IL). */
export function basePoints(f: Facts, y: number) {
  const discharge = String(f.dischargeDate ?? f.discharge ?? "") || undefined;
  const months = f.serviceMonths !== undefined ? +f.serviceMonths : f.fullService === true ? 23 : f.fullService === false ? 0 : undefined;
  return 2.25 + soldierPoints(discharge, months, y);
}

/** The questions that describe the person (not one business), grouped for /you; texts come from the packs' playbooks. */
export const PERSON_GROUPS: Readonly<Record<string, readonly string[]>> = {
  family: ["isWoman", "childBirthYears", "parentRole", "singleParent", "otherParentDeceasedOrUnlisted", "disabledChild", "paysAlimonyRemarried"],
  service: ["dischargeDate", "fullService", "combatReserveDaysPrevYear"],
  studies: ["degreeType", "degreeEndYear", "studyYears"],
  home: ["aliyahDate", "residencyStartDate"],
};
export type Ask = CountryPack["playbook"][number]["ask"][number];
export function question(key: string, packs: readonly CountryPack[] = PACKS): Ask | undefined {
  for (const p of packs) for (const it of p.playbook) for (const q of it.ask) if (q.key === key) return q;
  return undefined;
}

// ---------- cross-border: every business's year, each from its own books and pack ----------
/** Keys in person facts for the cross-border inputs (flat, so facts stay a plain answer map). */
export const fxKey = (cur: string, y: number) => `fx.${cur}.${y}`;
export const taxKey = (e: string, y: number) => `foreignTax.${e}.${y}`;
/** Residence-currency per unit, when the person hasn't typed one: the Taxximizer's default for dollars. */
export const FX_DEFAULT: Readonly<Record<string, number>> = { USD: 3.6 };

export interface Biz {
  entity: Entity;
  pack: CountryPack;
  year: EntityYear;
  profile: Record<string, unknown>;
}
/** Every business with a country pack, for year y (foreignTaxPaid 0: it's a person answer, see taxKey). Other businesses' books are fetched (GET /api/state?e=…) once per call. */
export async function businesses(es: readonly Entity[], y: number): Promise<Biz[]> {
  const out: Biz[] = [];
  for (const e of es) {
    const p = packOf(e, y),
      type = typeOf(e, y);
    if (!p || !type) continue;
    const st = await api.state(e.id);
    if ("setup" in st) continue;
    const r = pl(st.txns.filter((x) => +x.date.slice(0, 4) === y));
    out.push({
      entity: st.entity,
      pack: p,
      profile: st.profile ?? {},
      year: {
        entity: e.id,
        country: p.manifest.id,
        type,
        treatment: p.manifest.businessTypes.find((b) => b.key === type)!.treatment,
        year: y,
        currency: st.entity.currency || p.manifest.currency,
        revenue: r.revenue,
        expenses: r.cogs + r.opex,
        foreignTaxPaid: 0, // the caller fills it from facts[taxKey(entity, y)]
      },
    });
  }
  return out;
}
/** What the foreign business's own country requires of it (its pack's form hook), when its owner lives elsewhere. */
export function foreignObligations(b: Biz, y: number): readonly Obligation[] {
  if (b.pack.manifest.id === "us" && b.year.type === "llc-disregarded") return llcObligations(y, us.table(y), b.profile);
  return [];
}
