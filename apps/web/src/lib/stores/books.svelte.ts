// The books store: one reactive State from the server (GET /api/state and every write's answer), the open entity, year, period,
// theme, toasts, and the formatters every screen uses. Pure ledger math lives in @openbooks/core; this file only binds it to S.
// Live updates: one EventSource on /api/events; a change for the open entity (or entity: null) re-fetches the whole state.
import { cashSeries as coreCashSeries, balances as coreBalances, accounts as coreAccounts, suggest as coreSuggest } from "@openbooks/core";
import { group, inPeriod, monthsIn, type Period } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import { api, events, type Change, type Entity, type NoBooks, type State } from "../api.ts";
import { t, has, lang, locale, autoLang, ltr, PACKS } from "../i18n.svelte.ts";
import { scramble } from "../privacy.svelte.ts";

export type Theme = "system" | "light" | "dark";
export interface Toast {
  msg: string;
  action?: { label: string; value?: string; run: (value: string) => void };
  id: number;
}

export const S = $state({
  data: null as State | null,
  /** No books yet (server answered { setup: true }): the layout sends the user to /setup. */
  setup: false,
  e: "",
  year: new Date().getFullYear(),
  period: null as Period | null,
  theme: "system" as Theme,
  toast: null as Toast | null,
  busy: false,
  /** Open transaction drawer (txn id) and the ⌘K bar; rendered by their owners (3.4, 3.10). */
  drawer: null as string | null,
  cmd: false,
  /** Live updates: "sse" connected, "off" = this server has no /api/events (refresh on focus instead), "" = not started. */
  live: "" as "" | "sse" | "off",
  /** Last change version seen from /api/events. */
  v: 0,
});

// ---------- theme (html[data-theme]) and entity, both remembered per browser ----------
try {
  const th = localStorage.getItem("ob-theme");
  S.theme = th === "light" || th === "dark" ? th : "system";
  S.e = localStorage.getItem("ob-entity") || "";
} catch {}
const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};
export function setTheme(th: Theme) {
  S.theme = th;
  if (th === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = th;
  remember("ob-theme", th);
}
export function setEntity(id: string) {
  if (id === S.e) return;
  S.e = id;
  S.period = null;
  S.drawer = null;
  S.data = null;
  remember("ob-entity", id);
  return load();
}

// ---------- entity, country pack, business type per tax year ----------
const NONE = {} as Partial<Entity>;
export const ent = (): Partial<Entity> => S.data?.entity ?? NONE;
/** The country pack of the open entity (by its business type for the year, else its legacy kind). */
export function pack(y = S.year) {
  const e = ent(),
    ty = e.types && typeFrom(e.types, y);
  return PACKS.find((p) => (ty ? p.manifest.businessTypes.some((b) => b.key === ty) : e.kind && e.kind in p.manifest.legacyKinds)) ?? null;
}
const typeFrom = (types: Readonly<Record<string, string>>, y: number) => {
  const from = Object.keys(types)
    .filter((k) => +k <= y)
    .sort()
    .at(-1);
  return from ? types[from] : undefined;
};
/** "il" | "us" | null (plain books). */
export const family = () => pack()?.manifest.id ?? null;
/** US LLC and plain "other" books share the US-style views (English, P&L + balance sheet). */
export const isUS = () => !!S.data && family() !== "il";
/** The structure in force in tax year y: the latest change on or before y, else the kind's default. */
export function bizType(y = S.year): string | null {
  const e = ent();
  return (e.types && typeFrom(e.types, y)) ?? (e.kind ? pack(y)?.manifest.legacyKinds[e.kind] : undefined) ?? null;
}
/** Business types the open entity's country offers: [{ key, label, sub }] in the interface language. */
export const bizTypes = () => (pack()?.manifest.businessTypes ?? []).map((b) => ({ key: b.key, label: t(`biz.${b.key}`), sub: t(`biz.${b.key}.sub`) }));
export const bizLabel = (y = S.year) => {
  const k = bizType(y);
  return k && has(`biz.${k}`) ? t(`biz.${k}`) : t("biz.books");
};
export const setMeta = (m: Partial<Entity>) => call("/api/meta", m);
export const setBizType = (y: number, type: string) => setMeta({ types: { ...ent().types, [y]: type } });

// ---------- period: a month range "YYYY-MM".."YYYY-MM"; defaults to the selected year ----------
export const period = (): Period => S.period ?? { from: `${S.year}-01`, to: `${S.year}-12` };
export const periodLabel = (p = period()) => {
  if (p.from.endsWith("-01") && p.to.endsWith("-12") && p.from.slice(0, 4) === p.to.slice(0, 4)) return p.from.slice(0, 4);
  return p.from === p.to ? monthYear(p.from) : `${monthYear(p.from)} – ${monthYear(p.to)}`;
};
/** Transactions of the selected period / tax year. */
export const periodTxns = (p = period()) => (S.data ? S.data.txns.filter((x) => inPeriod(x, p)) : []);
export const yearTxns = (y = S.year) => (S.data ? S.data.txns.filter((x) => +x.date.slice(0, 4) === y) : []);

// ---------- tax tables (server: taxtables.json / _app overrides). Unknown years borrow the closest earlier year. ----------
const tables = (c = "il") => S.data?.taxTables?.[c] ?? {};
export function taxTable(y: number, c = "il") {
  const tb = tables(c),
    ys = Object.keys(tb)
      .map(Number)
      .sort((a, b) => a - b);
  const pick = ys.filter((x) => x <= y).at(-1) ?? ys[0];
  const row = (pick !== undefined && tb[pick]) || {};
  return { ...row, year: pick, brackets: ((row.brackets ?? []) as [number | null, number][]).map(([hi, r]) => [hi ?? Infinity, r] as [number, number]) };
}
export const knownYear = (y: number, c = "il") => String(y) in tables(c);
export const saveTaxTable = (country: string, year: number, table: unknown) => call("/api/taxtables", { country, year, table });
export const addYear = (year: number) => call("/api/year", { year });
export const removeYear = (year: number) => call("/api/year", { year, remove: true });

// ---------- chart of accounts: "type:name"; the type decides where it lands in the reports ----------
const TYPE_KEYS = ["revenue", "business", "other-income", "capital", "cogs", "expense", "equity", "transfer", "exempt", "personal", "own", "ask"] as const;
export const typeLabel = (k: string) => t(`type.${k}`);
/** Built-in accounts have display names ("cat.<key>"); accounts the user creates show their own name. */
export const catLabel = (c: string) => (has(`cat.${c}`) ? t(`cat.${c}`) : c.split(":")[1] || c).replace(/-/g, " ").replace(/^./, (m) => m.toUpperCase());
export function allCats() {
  const used = S.data ? S.data.txns.map((x) => x.category).concat(S.data.rules.map((r) => r[1].trim())) : [];
  const base = pack()?.manifest.accounts ?? PACKS.find((p) => p.manifest.id === "us")!.manifest.accounts;
  const order: readonly string[] = TYPE_KEYS;
  return [...new Set([...base, ...used])]
    .filter((c) => c !== "ask")
    .sort((a, b) => order.indexOf(group(a)) - order.indexOf(group(b)) || catLabel(a).localeCompare(catLabel(b)));
}
/** Groups for a <Select>: [{ label, options: [{ value, label }] }]. */
export const catGroups = () =>
  TYPE_KEYS.map((g) => ({
    label: typeLabel(g),
    options: allCats()
      .filter((c) => group(c) === g)
      .map((c) => ({ value: c, label: catLabel(c) })),
  })).filter((g) => g.options.length);
export const SERIES = ["var(--color-s1)", "var(--color-s2)", "var(--color-s3)", "var(--color-s4)", "var(--color-s5)", "var(--color-s6)"];

// ---------- ledger bound to the open books (pure versions: @openbooks/core) ----------
export const accounts = () => (S.data ? coreAccounts(S.data.txns) : []);
/** Balance of every bank/card account at the end of day `iso`. */
export const balances = (iso: string) => (S.data ? coreBalances(S.data.txns, S.data.checks, iso) : {});
/** Running cash per month of a period, with a mid-month Date for charts. */
export const cashSeries = (p = period()) =>
  S.data ? coreCashSeries(S.data.txns, p).map((r) => ({ ...r, date: new Date(+r.ym.slice(0, 4), +r.ym.slice(5, 7) - 1, 15) })) : [];
/** Likely ledger accounts for these transactions, best first. */
export const suggest = (ts: readonly Txn[]) => (S.data ? coreSuggest(ts, S.data.txns) : []);
export { monthsIn };

// ---------- formatting: every amount on screen goes through fmt/parts (privacy mode, LTR in Hebrew) ----------
export const sym = () => (({ ILS: "₪", USD: "$", EUR: "€" }) as Record<string, string>)[ent().currency ?? ""] ?? "";
/** "−₪1,234" in the entity's currency; in Hebrew wrapped LRI…PDI so it keeps its order inside right-to-left text. */
export const fmt = (n: number, d = 0) => {
  const v = scramble(n ?? 0),
    s = (v < 0 ? "−" : "") + sym() + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return lang() === "he" ? ltr(s) : s;
};
/** Mercury-style amount parts: 1,234 and .56 (the cents render superscript). */
export const parts = (n: number) => {
  const r = Math.round(scramble(n ?? 0) * 100) / 100,
    [w = "0", c = "00"] = Math.abs(r).toFixed(2).split(".");
  return { sign: r < 0 ? "−" : "", whole: (+w).toLocaleString("en-US"), cents: c };
};
/** A plain 2-decimal number (inputs, exports). Not privacy-scrambled. */
export const money = (n: number) => (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateOf = (iso: string) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) || 15);
/** Short month name in the interface language: mon(0) → "Jan" / "ינו׳". */
export const mon = (i: number) => new Intl.DateTimeFormat(locale(), { month: "short" }).format(new Date(2000, i, 15));
/** "Jan 2026" / "ינו׳ 2026" for a "YYYY-MM". */
export const monthYear = (ym: string) => new Intl.DateTimeFormat(locale(), { month: "short", year: "numeric" }).format(dateOf(ym));
export const dmy = (iso: string) => iso.split("-").reverse().join("/");
/** A date in the interface language: "Jan 5, 2026" / "5 בינו׳ 2026". */
export const mdy = (iso: string) => new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(dateOf(iso));
/** Always English, for documents with a fixed language (US invoices, IRS forms). */
export const mdyEn = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(dateOf(iso));
export const fileUrl = (name: string, sub = "inbox") => api.fileUrl(S.e, name, sub);
export const packUrl = (y: number) => api.packUrl(S.e, y);

// ---------- loading and writes: every write answers with the new State ----------
export function toast(msg: string, action?: Toast["action"]) {
  S.toast = { msg, action, id: Math.random() };
}
function accept(d: State | NoBooks) {
  if ("setup" in d) {
    S.data = null;
    S.setup = true;
    return;
  }
  S.setup = false;
  S.data = d;
  autoLang(family());
  if (d.entity.id !== S.e) {
    S.e = d.entity.id; // server opened another business (unknown or missing ?e=)
    remember("ob-entity", S.e);
  }
  if (!d.years.includes(S.year)) S.year = d.years.at(-1) ?? new Date().getFullYear();
}
/** Run a request for the current entity; drop the answer if the user switched entity meanwhile. */
async function run(req: (e: string) => Promise<State | NoBooks>) {
  const e = S.e;
  S.busy = true;
  try {
    const d = await req(e);
    if (e === S.e) accept(d);
  } catch (x) {
    toast(String((x as Error).message || x));
  } finally {
    S.busy = false;
  }
}
const call = (path: string, body: unknown) => run((e) => api.post(path, body, e));

let loading: Promise<void> | null = null,
  again = false;
/** (Re)fetch the whole state. Overlapping calls collapse into one extra fetch. */
export function load(): Promise<void> {
  if (loading) {
    again = true;
    return loading;
  }
  loading = run(api.state).finally(() => {
    loading = null;
    if (again) {
      again = false;
      void load();
    }
  });
  return loading;
}

/** Add a business: { id, name, short, kind, currency, flag }. Resolves true when created. */
export async function createEntity(meta: Entity) {
  try {
    const d = await api.createEntity(meta);
    S.e = d.entity.id;
    remember("ob-entity", S.e);
    accept(d);
    return true;
  } catch (x) {
    toast(String((x as Error).message));
    return false;
  }
}
export const classify = (ids: readonly string[], category: string, rule?: string) => call("/api/category", { ids, category, rule });
export const saveRules = (rules: readonly (readonly [string, string])[]) => call("/api/rules", { rules });
export const setForm = (values: Record<string, string | null>, year = S.year) => call("/api/form", { year, values });
export const setProfile = (p: Record<string, unknown>) => call("/api/profile", p);
/** Connections: /api/connect | /api/sync | /api/disconnect with the provider's body. */
export const connection = (path: "/api/connect" | "/api/sync" | "/api/disconnect", body: unknown) => call(path, body);

export async function upload(files: File[], to: "auto" | "inbox" | "proofs" = "auto") {
  for (const f of files) await run((e) => api.upload(e, f, S.year, to)).catch(() => {});
  toast(t("toast.addedFiles", { n: files.length }));
}

// ---------- books documents (invoices, journal, customers, …) and attachments ----------
export const doc = <A = unknown[]>(name: string, fallback: A = [] as A): A => (S.data?.docs?.[name] as A) ?? fallback;
/** Local first: a second edit before the server answers must build on this one, not on stale state. */
export function saveDoc(name: string, value: unknown) {
  if (S.data) S.data.docs = { ...S.data.docs, [name]: value };
  return call("/api/doc", { name, value });
}
export const attachmentsOf = (id: string) => S.data?.attachments?.[id] ?? [];
export async function attach(id: string, files: File[]) {
  for (const f of files) await run((e) => api.attach(e, id, f));
}

// ---------- live updates ----------
let refreshOnFocus: (() => void) | null = null;
/** Start live updates (the root layout calls this once). Returns a stop function. */
export function live(): () => void {
  const stop = events({
    onHello(v) {
      S.live = "sse";
      if (S.v && v > S.v) void load(); // missed changes while disconnected
      S.v = v;
    },
    onChange(c: Change) {
      S.v = c.v;
      if (c.entity === null || c.entity === S.e || c.topics.includes("entities")) void load();
    },
    onUnavailable() {
      // ponytail: no event stream (books.py) → re-fetch when the tab comes back, like a manual refresh; writes still answer with state
      S.live = "off";
      refreshOnFocus = () => document.visibilityState === "visible" && void load();
      document.addEventListener("visibilitychange", refreshOnFocus);
    },
  });
  return () => {
    stop();
    if (refreshOnFocus) document.removeEventListener("visibilitychange", refreshOnFocus);
  };
}
