// Interface language: en | he. t("nav.home"), t("x.count", { n: 3 }) with {var} interpolation; plurals { one, two?, other }.
// Missing Hebrew falls back to English, then to the key. The app dictionaries (./locales) are merged with every country pack's
// strings at load: pack keys are biz.<type>*, taxximizer.*, and new ones are prefixed <packId>. (docs/architecture.md § i18n).
import { translate, localeOf, dirOf, type Dict, type Lang } from "@openbooks/core";
import { il } from "@openbooks/country-il";
import { us } from "@openbooks/country-us";
import en from "./locales/en.ts";
import he from "./locales/he.ts";

export { bidi, ltr } from "@openbooks/core";
export type { Lang };

export const PACKS = [il, us] as const;
export const DICTS: Readonly<Record<Lang, Dict>> = {
  en: Object.assign({}, en, ...PACKS.map((p) => p.strings.en)),
  he: Object.assign({}, he, ...PACKS.map((p) => p.strings.he)),
};

const KEY = "ob-lang";
const isLang = (l: unknown): l is Lang => l === "en" || l === "he";
let saved: Lang | null = null;
try {
  const s = localStorage.getItem(KEY);
  if (isLang(s)) saved = s;
} catch {}
const initial: Lang = saved ?? (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("he") ? "he" : "en");

export const I = $state<{ lang: Lang }>({ lang: initial });
/** The current language, reactive inside components. */
export const lang = () => I.lang;
/** "he-IL" | "en-US" for Intl. */
export const locale = () => localeOf(I.lang);
export const dir = () => dirOf(I.lang);

function apply() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = I.lang;
  document.documentElement.dir = dirOf(I.lang);
}
apply();

export function setLang(l: Lang, remember = true) {
  if (!isLang(l)) return;
  I.lang = l;
  apply();
  if (remember) {
    saved = l;
    try {
      localStorage.setItem(KEY, l);
    } catch {}
  }
}
/** No saved choice yet: an Israeli business opens in Hebrew. Called once the books load. */
export function autoLang(country: string | null) {
  if (!saved && country === "il" && I.lang !== "he") setLang("he", false);
}

export const t = (key: string, vars?: Readonly<Record<string, string | number>>) => translate(DICTS, I.lang, key, vars);
/** Has a translation for this key (for optional, data-driven labels). */
export const has = (key: string) => key in DICTS.en;
