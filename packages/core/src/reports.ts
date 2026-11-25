// Reports over ledger rows (port of web/src/lib/books.svelte.js and mcp_server.py pl/by_account/balances). Pure: pass rows in, get numbers out.
// Labels are not here: the UI translates "type.<key>" / "cat.<account>" keys, packs supply their own.
import type { StatementCheck, Txn } from "@openbooks/schema";
import { MCAT_ACCOUNT, mcatKey } from "./mcat.ts";

type Row = Pick<Txn, "date" | "amount" | "category"> & { baseAmount?: number | undefined };
/** What a row counts for in totals: its amount in the books' currency (a foreign-currency row converted at its day's rate). */
export const baseOf = (t: Row) => t.baseAmount ?? t.amount;
export type PlLine = "revenue" | "other" | "cogs" | "expense" | "ask";

/** Account type → where it lands in the P&L (null = not P&L: transfers, equity, personal, own money, exempt). */
export const TYPES: Readonly<Record<string, PlLine | null>> = {
  revenue: "revenue",
  business: "revenue",
  "other-income": "other",
  capital: "other",
  cogs: "cogs",
  expense: "expense",
  equity: null,
  transfer: null,
  exempt: null,
  personal: null,
  own: null,
  loan: null,
  ask: "ask",
};
export const group = (c: string) => (c || "ask").split(":")[0]!;
export const plOf = (c: string): PlLine | null => TYPES[group(c)] ?? null;
export const isBiz = (c: string) => plOf(c) === "revenue";
/** A card account by its name: "credit"/"card", or an Israeli card issuer's scraped account ("Max ••1234", "Visa Cal ••…", "Isracard ••…"). */
export const isCard = (account: string) => /credit|card|^max\b|visa ?cal|isracard|\bamex\b|american express|diners|כרטיס|אשראי/i.test(account);

const sum = (ts: readonly Row[]) => ts.reduce((a, t) => a + baseOf(t), 0);

export interface AccountTotal {
  key: string;
  value: number;
  count: number;
}
export function byAccount(ts: readonly Row[]): AccountTotal[] {
  const m = new Map<string, AccountTotal>();
  for (const t of ts) {
    const a = m.get(t.category) ?? { key: t.category, value: 0, count: 0 };
    a.value += baseOf(t);
    a.count++;
    m.set(t.category, a);
  }
  return [...m.values()].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

export interface PL {
  revenue: number;
  cogs: number;
  gross: number;
  opex: number;
  operating: number;
  other: number;
  uncat: number;
  net: number;
  lines: Record<PlLine, AccountTotal[]>;
}
/** Cash-basis P&L. Expenses come out positive. */
export function pl(ts: readonly Row[]): PL {
  const of = (k: PlLine) => ts.filter((t) => plOf(t.category) === k);
  const revenue = sum(of("revenue")),
    cogs = -sum(of("cogs")),
    opex = -sum(of("expense")),
    other = sum(of("other")),
    uncat = sum(of("ask"));
  const gross = revenue - cogs,
    operating = gross - opex;
  return {
    revenue,
    cogs,
    gross,
    opex,
    operating,
    other,
    uncat,
    net: operating + other + uncat,
    lines: {
      revenue: byAccount(of("revenue")),
      cogs: byAccount(of("cogs")),
      expense: byAccount(of("expense")),
      other: byAccount(of("other")),
      ask: byAccount(of("ask")),
    },
  };
}
/** Types that move money without earning or spending it: between your accounts, to or from the owner, personal, loan principal. */
export const NOT_FLOW: ReadonlySet<string> = new Set(["transfer", "own", "equity", "personal", "loan"]);
/** The row is money really coming in or going out (not a movement between pockets). */
export const isFlow = (c: string) => !NOT_FLOW.has(group(c));
/**
 * Which side of money in / out a row counts on: by what it is, not its sign. A refund filed under spending (the Cursor charge
 * coming back on the card) shrinks the money out instead of showing up as income; a chargeback on income shrinks the money in.
 * Rows still to file go by their sign.
 */
export const inSide = (t: Pick<Row, "amount" | "category">) => {
  const p = plOf(t.category);
  return p === "expense" || p === "cogs" ? false : p === "revenue" || p === "other" ? true : t.amount > 0;
};
export const cashIn = (ts: readonly Row[]) => ts.filter((t) => isFlow(t.category) && inSide(t)).reduce((a, t) => a + baseOf(t), 0);
export const cashOut = (ts: readonly Row[]) => -ts.filter((t) => isFlow(t.category) && !inSide(t)).reduce((a, t) => a + baseOf(t), 0);

/** Bank/card accounts seen in the books (journal excluded). */
export const accounts = (txns: readonly Txn[]) => [...new Set(txns.filter((t) => t.source !== "journal").map((t) => t.account))];
/** Those, plus statement accounts that carry a balance but no transactions yet. */
export const bankAccounts = (txns: readonly Txn[], checks: readonly StatementCheck[]) => [
  ...new Set([...accounts(txns), ...checks.filter((c) => c.balance).map((c) => c.label)]),
];
/** Balance of every bank/card account at the end of day `iso` (accounts start at 0; statements cover their whole life). */
export function balances(txns: readonly Txn[], checks: readonly StatementCheck[], iso: string): Record<string, number> {
  const b: Record<string, number> = Object.fromEntries(bankAccounts(txns, checks).map((a) => [a, 0]));
  for (const t of txns) if (t.date <= iso && t.account in b) b[t.account]! += t.amount;
  return b;
}

// ---------- balances over time ----------
/** doc "anchors": account → known end-of-day balances (an opening balance is one on the day before the first transaction). */
export type Anchors = Readonly<Record<string, readonly { date: string; balance: number }[]>>;
const DAY_MS = 86400000;
/** Every day from..to inclusive (YYYY-MM-DD). */
export function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
/** Statement balances the bank reported (Mercury's current balance) as anchors: the balance at the end of the statement's last day. */
export const checkAnchors = (checks: readonly StatementCheck[]): Anchors => {
  const out: Record<string, { date: string; balance: number }[]> = {};
  for (const c of checks) if (c.balance && c.period[1]) (out[c.label] ??= []).push({ date: c.period[1], balance: c.total });
  return out;
};
/** Stored anchors over automatic ones: on the same account and date the stored one wins. */
export function mergeAnchors(auto: Anchors, stored: Anchors): Anchors {
  const out: Record<string, { date: string; balance: number }[]> = {};
  for (const [a, xs] of Object.entries(auto)) out[a] = xs.filter((x) => !stored[a]?.some((y) => y.date === x.date));
  for (const [a, xs] of Object.entries(stored)) out[a] = [...(out[a] ?? []), ...xs];
  return out;
}
/**
 * End-of-day balance of every bank/card account on each day from..to. An anchor fixes the balance on its date; days after it carry forward
 * from the latest anchor on or before them, days before the first anchor are worked back from it. An account without anchors starts at 0.
 */
export function dailyBalances(txns: readonly Pick<Txn, "date" | "amount" | "account" | "source">[], anchors: Anchors, from: string, to: string) {
  const dates = days(from, to);
  const by = new Map<string, Map<string, number>>();
  for (const t of txns) {
    if (t.source === "journal") continue;
    const m = by.get(t.account) ?? new Map<string, number>();
    m.set(t.date, (m.get(t.date) ?? 0) + t.amount);
    by.set(t.account, m);
  }
  for (const a of Object.keys(anchors)) if (anchors[a]!.length && !by.has(a)) by.set(a, new Map());
  const balances: Record<string, number[]> = {};
  for (const [acct, nets] of by) {
    const sorted = [...nets].sort(([a], [b]) => (a < b ? -1 : 1));
    const cum = (d: string) => sorted.reduce((s, [x, v]) => (x <= d ? s + v : s), 0); // ponytail: O(days × anchors) lookups on few anchors
    const as = [...(anchors[acct] ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1)).map((x) => ({ ...x, off: x.balance - cum(x.date) }));
    let run = cum(back(from)),
      k = 0;
    balances[acct] = dates.map((d) => {
      run += nets.get(d) ?? 0;
      while (k + 1 < as.length && as[k + 1]!.date <= d) k++;
      return Math.round((run + (as[k]?.off ?? 0)) * 100) / 100;
    });
  }
  return { dates, balances };
}
const back = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
/**
 * Each bank account's currency: the one most of its rows are in (absent = the books'). ponytail: a card's odd foreign-charged row is
 * summed into the balance as is; convert per row if mixed-currency accounts turn up.
 */
export function accountCurrencies(txns: readonly Pick<Txn, "account" | "source" | "currency">[], base: string): Record<string, string> {
  const n = new Map<string, Map<string, number>>();
  for (const t of txns) {
    if (t.source === "journal") continue;
    const m = n.get(t.account) ?? new Map<string, number>(),
      c = t.currency ?? base;
    n.set(t.account, m.set(c, (m.get(c) ?? 0) + 1));
  }
  return Object.fromEntries([...n].map(([a, m]) => [a, [...m].sort((x, y) => y[1] - x[1])[0]![0]]));
}

// ---------- periods: month ranges "YYYY-MM".."YYYY-MM" ----------
export interface Period {
  from: string;
  to: string;
}
const monthIdx = (ym: string) => +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1;
const ymOf = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
export const yearPeriod = (y: number): Period => ({ from: `${y}-01`, to: `${y}-12` });
export const inPeriod = (t: { date: string }, p: Period) => t.date.slice(0, 7) >= p.from && t.date.slice(0, 7) <= p.to;
/** The same-length period right before p. */
export function priorPeriod(p: Period): Period {
  const a = monthIdx(p.from),
    n = monthIdx(p.to) - a + 1;
  return { from: ymOf(a - n), to: ymOf(a - 1) };
}
export const monthsIn = (p: Period) => Array.from({ length: monthIdx(p.to) - monthIdx(p.from) + 1 }, (_, i) => ymOf(monthIdx(p.from) + i));
/** MCP-style inclusive bounds that may be YYYY-MM or YYYY-MM-DD. */
export const inRange = (d: string, from?: string, to?: string) => (!from || d.slice(0, from.length) >= from) && (!to || d.slice(0, to.length) <= to);

/** Running cash (non-card accounts) at the end of each month of p. txns sorted by date. */
export function cashSeries(txns: readonly Txn[], p: Period): { ym: string; value: number }[] {
  const out: { ym: string; value: number }[] = [];
  let run = 0,
    i = 0;
  for (; i < txns.length && txns[i]!.date < `${p.from}-01`; i++) if (!isCard(txns[i]!.account)) run += txns[i]!.amount;
  for (const ym of monthsIn(p)) {
    for (; i < txns.length && txns[i]!.date.slice(0, 7) === ym; i++) if (!isCard(txns[i]!.account)) run += txns[i]!.amount;
    out.push({ ym, value: run });
  }
  return out;
}

// ---------- counterparties and suggestions ----------
type Desc = Pick<Txn, "desc" | "source"> & { who?: string; memo?: string; mcat?: string };
/** bit: the sender; Mercury: the counterparty; else the description without dates, amounts and reference numbers. */
export const payerOf = (t: Desc) =>
  t.who
    ? `bit: ${t.who}`
    : t.source === "mercury"
      ? t.desc
      : t.desc
          .replace(/[\d.,:/\\"”'-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
/** The text a rule should match for these transactions ("" = no common word). */
export function suggestRule(ts: readonly Desc[]): string {
  const first = ts[0];
  if (!first) return "";
  if (ts.every((t) => t.who && t.who === first.who)) return `bit: ${first.who}`;
  if (ts.every((t) => t.source === "mercury" && t.desc === first.desc)) return first.desc;
  const words = first.desc
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .sort((x, y) => y.length - x.length);
  return words.find((w) => ts.every((t) => t.desc.includes(w))) ?? "";
}
export function payers(txns: readonly Txn[]) {
  const m = new Map<string, Txn[]>();
  for (const t of txns) {
    const k = payerOf(t);
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  return [...m]
    .map(([key, ts]) => ({
      key,
      ts,
      total: sum(ts),
      in: ts.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0),
      out: ts.filter((t) => t.amount < 0).reduce((a, t) => a - t.amount, 0),
      cats: [...new Set(ts.map((t) => t.category))],
      years: [...new Set(ts.map((t) => t.date.slice(0, 4)))],
      last: ts.at(-1)!.date,
      why: ts.at(-1)!.why,
    }))
    .sort((x, y) => Math.abs(y.total) - Math.abs(x.total));
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4),
  );
const hay = (t: Desc) => `${t.desc} ${t.memo ?? ""} [${t.mcat ?? ""}]`;
/** Up to 5 likely ledger accounts for ts, best first, scored from the other categorized rows in `all`. */
export function suggest(ts: readonly Txn[], all: readonly Txn[]): string[] {
  const sc = new Map<string, number>(),
    add = (c: string | undefined, n: number) => c && c !== "ask" && sc.set(c, (sc.get(c) ?? 0) + n);
  const ids = new Set(ts.map((t) => t.id)),
    keys = new Set(ts.map(payerOf)),
    ws = new Set(ts.flatMap((t) => [...words(hay(t))]));
  for (const x of all) {
    if (ids.has(x.id) || x.category === "ask") continue;
    if (keys.has(payerOf(x))) add(x.category, 5);
    else {
      let n = 0;
      for (const w of words(hay(x))) if (ws.has(w)) n++;
      if (n) add(x.category, n * 0.6);
    }
  }
  // The bank's own category: what you filed under the same one before is the strongest hint (up to 4 points, one per past row), then the usual account for it.
  const asked = new Set(ts.map((t) => mcatKey(t.mcat)).filter(Boolean));
  if (asked.size) {
    const seen = new Map<string, number>();
    for (const x of all)
      if (!ids.has(x.id) && x.category !== "ask" && asked.has(mcatKey(x.mcat))) seen.set(x.category, Math.min(4, (seen.get(x.category) ?? 0) + 1));
    for (const [c, n] of seen) add(c, n + 3);
  }
  for (const t of ts) add(MCAT_ACCOUNT[mcatKey(t.mcat)], 3);
  const sign = Math.sign(sum(ts));
  for (const [c] of sc)
    if ((sign < 0 && ["revenue", "other"].includes(plOf(c) ?? "")) || (sign > 0 && ["cogs", "expense"].includes(plOf(c) ?? ""))) sc.delete(c);
  return [...sc]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c]) => c);
}
