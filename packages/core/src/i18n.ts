// The pure half of i18n (web wraps it with a reactive `lang`). Flat dotted keys; a plural entry is { one, two?, other } picked by
// Intl.PluralRules; {var} interpolation; a missing key falls back to English, then to the key itself.
export type Entry = string | { readonly [form: string]: string };
export type Dict = Readonly<Record<string, Entry>>;
export type Lang = "en" | "he";

export const localeOf = (l: Lang) => (l === "he" ? "he-IL" : "en-US");
export const dirOf = (l: Lang) => (l === "he" ? "rtl" : "ltr");

const rules = new Map<string, Intl.PluralRules>();
export function translate(dicts: Readonly<Record<Lang, Dict>>, lang: Lang, key: string, vars?: Readonly<Record<string, string | number>>): string {
  let e = dicts[lang][key] ?? dicts.en[key] ?? key;
  if (typeof e === "object") {
    const loc = localeOf(lang),
      pr = rules.get(loc) ?? new Intl.PluralRules(loc);
    rules.set(loc, pr);
    e = e[pr.select(Number(vars?.n ?? 0))] ?? e.other ?? key;
  }
  return vars ? e.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : e;
}

const FSI = "⁨",
  PDI = "⁩",
  LRI = "⁦";
/** Isolate a user value (a name) inside a translated sentence so it can't reorder it. */
export const bidi = (s: string) => FSI + s + PDI;
/** Force left-to-right for an amount or number inside right-to-left text. */
export const ltr = (s: string) => LRI + s + PDI;

/** Problems between a dictionary and its English reference: missing/extra keys, plural shape, {vars} the translation drops. */
export function checkDictionaries(en: Dict, other: Dict): string[] {
  const bad: string[] = [];
  for (const [k, v] of Object.entries(en)) {
    const o = other[k];
    if (o === undefined) bad.push(`missing: ${k}`);
    else if ((typeof v === "object") !== (typeof o === "object")) bad.push(`plural mismatch: ${k}`);
    else if (typeof v === "string" && typeof o === "string")
      for (const m of v.match(/\{\w+\}/g) ?? []) if (!o.includes(m)) bad.push(`${k}: translation lacks ${m}`);
  }
  for (const k of Object.keys(other)) if (!(k in en)) bad.push(`extra (not in en): ${k}`);
  return bad;
}
