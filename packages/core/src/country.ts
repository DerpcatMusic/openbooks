// The country-pack contract (docs/architecture.md § Country packs). A pack is pure data + pure functions; the server loads packs,
// the UI and tools only ever talk to this interface. packages/countries/_template is the starting point for a new country.
import type { Dict } from "./i18n.ts";

export type Bilingual = { readonly en: string; readonly he: string };

export interface BusinessType {
  readonly key: string; // stable id stored in entity.meta.types: "osek-zair", "llc-disregarded"
  readonly label: Bilingual;
  readonly sub: Bilingual; // one-line explanation
  /** How the residence country sees it: own legal person, or its profit flows to the owner. */
  readonly treatment: "sole-proprietor" | "company" | "transparent" | "partnership";
}

export interface Manifest {
  readonly id: string; // ISO 3166 alpha-2, lowercase: "il", "us"
  readonly names: Bilingual;
  readonly flag: string;
  readonly currency: string; // ISO 4217
  readonly businessTypes: readonly BusinessType[];
  readonly defaultType: string;
  /** Legacy entity.meta.kind values this pack owns → their default business type ("il-osek-zair" → "osek-zair"). */
  readonly legacyKinds: Readonly<Record<string, string>>;
  /** Tax year = calendar year in both built-in packs; dates are MM-DD in the following year. */
  readonly taxYear: { readonly start: string; readonly filingDue?: string; readonly extendedDue?: string };
  /** The default chart of accounts for new books ("type:name"). */
  readonly accounts: readonly string[];
}

/** One sourced, legal tax move (playbook.json). The advisor turns these into "what you should do". */
export interface PlaybookItem {
  readonly id: string;
  readonly country: string;
  readonly title_en: string;
  readonly title_he: string;
  readonly applies_to: readonly string[]; // business type keys
  readonly kind: string; // credit | deduction | timing | structure | vat | bl | refund | compliance
  readonly ask: readonly { readonly key: string; readonly q_en: string; readonly q_he: string; readonly type: string; readonly options?: readonly string[] }[];
  readonly rule: string;
  readonly saving: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly how_en: string;
  readonly how_he: string;
  readonly risk: string;
  readonly source: string;
  readonly verified: boolean;
}

export type Answer = string | number | boolean | undefined;
/** Person-level facts (one human, many entities): advisor answers, credit-point facts, family. Stored as doc "advisor". */
export type Facts = Readonly<Record<string, Answer>>;

/** "You": the human behind the entities. Residence decides which pack computes personal tax and runs crossBorder. */
export interface Person {
  readonly residence: string; // pack id
  readonly facts: Facts; // isWoman, childBirthYears, parentRole, discharge, serviceMonths, degreeType, combatReserveDaysPrevYear, …
}

/** What any pack reports for one entity-year, in that entity's currency; the residence pack converts with fx. */
export interface EntityYear {
  readonly entity: string;
  readonly country: string;
  readonly type: string; // business type key in force that year
  readonly treatment: BusinessType["treatment"]; // from the entity's own pack manifest
  readonly year: number;
  readonly currency: string;
  readonly revenue: number;
  readonly expenses: number; // positive
  readonly foreignTaxPaid: number; // tax withheld/paid in the entity's country, its currency
}

export interface Obligation {
  readonly form: string;
  readonly country: string;
  readonly why: string;
  readonly due?: string;
}
export interface CrossBorder {
  /** Income the residence country taxes the person on, in the residence currency. */
  readonly attributedIncome: number;
  /** Credit for foreign tax, capped at the residence tax on that income. */
  readonly foreignTaxCredit: number;
  /** Reliefs that do not apply to the attributed income (e.g. IL osek zair's 30% deemed expenses). */
  readonly blocked: readonly { readonly key: string; readonly law: string }[];
  readonly obligations: readonly Obligation[];
}

/** A form hook: form id → field values computed from the books (strings, as printed on the form). Overrides are applied by the caller. */
export type FormHook<Ctx> = (ctx: Ctx) => Readonly<Record<string, string>>;

export interface CountryPack<Table = unknown> {
  readonly manifest: Manifest;
  /** tables/<year>.json, parsed and validated by the pack's schema. */
  readonly tables: Readonly<Record<number, Table>>;
  /** The table for tax year y: its own, else the closest earlier year, else the earliest. */
  table(y: number): Table & { readonly year: number };
  readonly playbook: readonly PlaybookItem[];
  readonly strings: { readonly en: Dict; readonly he: Dict };
  /**
   * Residence pack only: fold foreign entities' results into the person's home tax. `home`: the person's entities in this country;
   * `fx`: residence-currency units per one unit of each foreign currency for year y. Called by the server/UI once per person-year.
   */
  crossBorder?(person: Person, y: number, home: readonly EntityYear[], foreign: readonly EntityYear[], fx: Readonly<Record<string, number>>): CrossBorder;
}

/** Shared table lookup: closest earlier year, else the earliest. */
export function pickTable<T>(tables: Readonly<Record<number, T>>, y: number): T & { year: number } {
  const ys = Object.keys(tables)
    .map(Number)
    .sort((a, b) => a - b);
  const pick = ys.filter((x) => x <= y).at(-1) ?? ys[0];
  if (pick === undefined) throw new Error("pack has no tax tables");
  return { ...tables[pick]!, year: pick };
}
