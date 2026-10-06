// Reports over ledger rows (port of web/src/lib/books.svelte.js and mcp_server.py pl/by_account/balances). Pure: pass rows in, get numbers out.
// Labels are not here: the UI translates "type.<key>" / "cat.<account>" keys, packs supply their own.
import type { StatementCheck, Txn } from "@openbooks/schema";

type Row = Pick<Txn, "date" | "amount" | "category">;
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
  ask: "ask",
};
export const group = (c: string) => (c || "ask").split(":")[0]!;
export const plOf = (c: string): PlLine | null => TYPES[group(c)] ?? null;
export const isBiz = (c: string) => plOf(c) === "revenue";
export const isCard = (account: string) => /credit|card/i.test(account);

const sum = (ts: readonly Row[]) => ts.reduce((a, t) => a + t.amount, 0);

export interface AccountTotal {
  key: string;
  value: number;
  count: number;
}
export function byAccount(ts: readonly Row[]): AccountTotal[] {
  const m = new Map<string, AccountTotal>();
  for (const t of ts) {
    const a = m.get(t.category) ?? { key: t.category, value: 0, count: 0 };
    a.value += t.amount;
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
export const cashIn = (ts: readonly Row[]) => ts.filter((t) => t.amount > 0 && group(t.category) !== "transfer").reduce((a, t) => a + t.amount, 0);
export const cashOut = (ts: readonly Row[]) => -ts.filter((t) => t.amount < 0 && group(t.category) !== "transfer").reduce((a, t) => a + t.amount, 0);

/** Bank/card accounts seen in the books (journal excluded). */
export const accounts = (txns: readonly Txn[]) => [...new Set(txns.filter((t) => t.source !== "journal").map((t) => t.account))];
/** Balance of every bank/card account at the end of day `iso` (accounts start at 0; statements cover their whole life). */
export function balances(txns: readonly Txn[], checks: readonly StatementCheck[], iso: string): Record<string, number> {
  const b: Record<string, number> = Object.fromEntries([...accounts(txns), ...checks.filter((c) => c.balance).map((c) => c.label)].map((a) => [a, 0]));
  for (const t of txns) if (t.date <= iso && t.account in b) b[t.account]! += t.amount;
  return b;
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

const MCAT: Record<string, string> = {
  Software: "expense:software",
  Advertising: "expense:advertising",
  Travel: "expense:travel",
  Restaurants: "expense:meals",
  "Food & Dining": "expense:meals",
  Fees: "expense:bank-fees",
  "Office Supplies": "expense:equipment",
  Equipment: "expense:equipment",
  Entertainment: "expense:games",
  Utilities: "expense:phone-internet",
  "Professional Services": "expense:professional",
  Legal: "expense:professional",
};
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
  for (const t of ts) add(MCAT[t.mcat ?? ""], 3);
  const sign = Math.sign(sum(ts));
  for (const [c] of sc)
    if ((sign < 0 && ["revenue", "other"].includes(plOf(c) ?? "")) || (sign > 0 && ["cogs", "expense"].includes(plOf(c) ?? ""))) sc.delete(c);
  return [...sc]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c]) => c);
}
