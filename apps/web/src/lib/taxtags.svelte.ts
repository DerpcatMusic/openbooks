// Smart tax tags bound to the open books: the country pack's deduction rules (tables/deductions.json, per-books edits in doc "taxrules"),
// the tags and account defaults (doc "tags", coa taxRule), and the engine in @openbooks/core deductions.ts. Memoised on the state's parts,
// so the drawer, the Tags page and the Taxximizer share one run per change.
import {
  createTag,
  deductions,
  relevantMoves,
  setTag,
  setTagTax,
  suggestTags,
  taggableRules,
  withOverrides,
  type DeductionInput,
  type DeductionResult,
  type RuleOverrides,
  type TagSuggestion,
  type Trip,
} from "@openbooks/core";
import type { DeductionRule, TagsDoc, TagTax } from "@openbooks/schema";
import { lang, t } from "./i18n.svelte.ts";
import { personNow } from "./person.ts";
import { S, bizType, coa, doc, ent, family, pack, saveTags, tagsDoc, taxTable } from "./stores/books.svelte.ts";

/** The business trips (doc "trips"). */
export const trips = () => doc<Trip[]>("trips", []);
/** The pack's table, when the open business has a type and its country ships rules. */
export const table = () => (bizType() ? (pack()?.deductions ?? null) : null);
export const hasRules = () => !!table();
/** Every rule of the table with this business's edits (doc "taxrules": rule id → { incomeTaxPct, vatPct, cap }). */
export const allRules = (): DeductionRule[] => withOverrides(table()?.rules ?? [], doc<RuleOverrides>("taxrules", {}));
/** Rules a tag or an account can point at for the business type in force that year. */
export const rulesFor = (y = S.year) => taggableRules(allRules(), bizType(y) ?? "");
export const ruleOf = (id: string | undefined) => allRules().find((r) => r.id === id);
export const ruleName = (r: DeductionRule | string | undefined) => {
  const x = typeof r === "string" ? ruleOf(r) : r;
  return x ? x.label[lang()] : String(r ?? "");
};
/** "80%" / "50% of business use" / "needs your share": the rule's own number, for chips. */
export const pctText = (r: DeductionRule) => (r.incomeTaxPct === null ? null : `${+r.incomeTaxPct.toFixed(2)}%`);

function inputFor(y: number): DeductionInput | null {
  const d = S.data,
    ty = bizType(y);
  if (!d || !ty) return null;
  const car = Number(personNow()?.facts.carPrice);
  const vat = family() === "il" ? ((taxTable(y) as { vatRate?: number }).vatRate ?? 0.18) : undefined;
  return {
    txns: d.txns,
    tags: $state.snapshot(tagsDoc()) as TagsDoc,
    rules: allRules(),
    accountRules: Object.fromEntries(Object.entries(coa()).flatMap(([k, v]) => (v.taxRule ? [[k, v.taxRule]] : []))),
    type: ty,
    year: y,
    currency: ent().currency ?? "ILS",
    attachments: d.attachments,
    ...(vat ? { vatRate: vat } : {}),
    facts: { ...(car > 0 ? { carPrice: car } : {}), usTrade: d.profile.usTrade === true },
    trips: $state.snapshot(doc<Trip[]>("trips", [])) as Trip[],
  };
}

let memo: { key: unknown[]; inp: DeductionInput; res: DeductionResult; sug?: TagSuggestion[] } | null = null;
function run(y: number) {
  const d = S.data;
  if (!d || !bizType(y) || !table()) return null;
  const key = [d.txns, d.docs, d.attachments, d.profile, y, personNow()?.facts, S.e];
  if (!memo || memo.key.some((k, i) => k !== key[i])) {
    const inp = inputFor(y)!;
    memo = { key, inp, res: deductions(inp) };
  }
  return memo;
}
const perYear = new Map<number, { key: unknown[]; res: DeductionResult }>();
/** Deductions of any year (own memo per year, so the filings can read several years without evicting the open year's run). */
export function resultOf(y: number): DeductionResult | null {
  const d = S.data;
  if (!d || !bizType(y) || !table()) return null;
  const key = [d.txns, d.docs, d.attachments, d.profile, y, personNow()?.facts, S.e];
  const hit = perYear.get(y);
  if (hit && !hit.key.some((k, i) => k !== key[i])) return hit.res;
  const res = deductions(inputFor(y)!);
  perYear.set(y, { key, res });
  return res;
}
/** The year's deductions for the open books (null when the business has no rule table). */
export const result = (y = S.year): DeductionResult | null => run(y)?.res ?? null;
export const input = (y = S.year) => run(y)?.inp ?? null;
/** "Tag these as X": untagged matches. */
export function suggestions(y = S.year): TagSuggestion[] {
  const m = run(y);
  return m ? (m.sug ??= suggestTags(m.inp)) : [];
}
/** Expenses the rules disallow, in the books' currency: what calculators take off the raw expense sum (0 without rules). */
export const disallowed = (y = S.year) => result(y)?.totals.nonDeductible ?? 0;
/** The deduction row of one transaction (an expense of the year), else undefined. */
export const rowOf = (id: string, y: number) => result(y)?.rows.find((r) => r.id === id);
export const movesFor = (y = S.year) => {
  const m = run(y),
    tb = table();
  if (!m || !tb) return { relevant: [], other: [] };
  return relevantMoves(tb.moves, m.inp.type, new Set([...m.res.byRule.map((x) => x.rule), ...suggestions(y).map((x) => x.rule)]));
};

// ---------- presets: one-click tags with a tax meaning (labels: taxtags.preset.<key>) ----------
export interface Preset {
  key: string;
  rule?: string;
  pct?: number;
}
const PRESETS: Readonly<Record<string, readonly Preset[]>> = {
  il: [
    { key: "refreshments", rule: "il.refreshments" },
    { key: "cafe", rule: "il.cafe-work" },
    { key: "tripFlights", rule: "il.travel.flights" },
    { key: "tripLodging", rule: "il.travel.lodging" },
    { key: "companion", rule: "il.travel.companion" },
    { key: "gifts", rule: "il.gifts" },
    { key: "phone", rule: "il.phone.mobile" },
    { key: "car", rule: "il.vehicle.running" },
    { key: "software", rule: "il.software" },
    { key: "homeOffice", rule: "il.home-office" },
    { key: "personal", pct: 0 },
  ],
  us: [
    { key: "clientMeals", rule: "us.meals" },
    { key: "solo", rule: "us.meals.solo" },
    { key: "tripFlights", rule: "us.travel.transport" },
    { key: "tripLodging", rule: "us.travel.lodging" },
    { key: "companion", rule: "us.travel.companion" },
    { key: "gifts", rule: "us.gifts" },
    { key: "phone", rule: "us.phone" },
    { key: "car", rule: "us.vehicle.actual" },
    { key: "software", rule: "us.software" },
    { key: "homeOffice", rule: "us.homeoffice" },
    { key: "personal", pct: 0 },
  ],
};
/** Presets whose rule applies to the business type in force. */
export const presets = (y = S.year): Preset[] => {
  const ok = new Set(rulesFor(y).map((r) => r.id));
  return (PRESETS[family() ?? ""] ?? []).filter((p) => !p.rule || ok.has(p.rule));
};

// ---------- writes: all through the tags doc ----------
const snap = () => $state.snapshot(tagsDoc()) as TagsDoc;
/** A tag for a preset (named in the interface language), made once: a tag with the same name and meaning is reused. */
export function addPreset(p: Preset, name: string) {
  const d = snap(),
    tax: TagTax = { ...(p.rule ? { rule: p.rule } : {}), ...(p.pct !== undefined ? { pct: p.pct } : {}) };
  if (d.tags.some((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase())) return false;
  void saveTags(createTag(d, name, undefined, tax));
  return true;
}
/** Tag these transactions as the suggestion's rule: the tag that already means it, else a new one named after the rule. */
export function applySuggestion(s: TagSuggestion) {
  let d = snap(),
    tag = d.tags.find((g) => g.tax?.rule === s.rule && g.tax.pct === undefined);
  if (!tag) {
    const preset = (PRESETS[family() ?? ""] ?? []).find((p) => p.rule === s.rule && p.pct === undefined), // a short name when a preset means the same
      name = preset ? t(`taxtags.preset.${preset.key}`) : ruleName(s.rule),
      same = d.tags.find((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (same && !same.tax) d = setTagTax(d, same.id, { rule: s.rule });
    else d = createTag(d, same ? `${name} (${s.rule})` : name, undefined, { rule: s.rule });
    tag = d.tags.find((g) => g.tax?.rule === s.rule && g.tax.pct === undefined)!;
  }
  void saveTags(setTag(d, s.ids, tag.id, true));
  return tag.name;
}
