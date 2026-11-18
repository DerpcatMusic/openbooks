// Net worth over time (GET /api/networth): pure helpers for NetWorth.svelte.
export interface NetWorthSeries {
  entity: string;
  account: string;
  currency: string;
  liability: boolean;
  /** Converted balance on dates[i]. */
  values: number[];
}
export interface NetWorthData {
  currency: string;
  dates: string[];
  series: NetWorthSeries[];
  /** Days a currency had no rate to convert with. */
  missing: { currency: string; date: string }[];
}
export type Range = "3m" | "6m" | "1y" | "ytd" | "all";

/** What an account adds to net worth: a liability always subtracts, whichever sign its balance is stored with. */
export const worth = (s: Pick<NetWorthSeries, "liability">, v: number) => (s.liability ? -Math.abs(v) : v);
/** Net worth per date. */
export const netSeries = (d: NetWorthData) => d.dates.map((_, i) => d.series.reduce((a, s) => a + worth(s, s.values[i] ?? 0), 0));

/** First date of a range ending on `last` (YYYY-MM-DD). */
export function rangeStart(r: Range, last: string): string {
  if (r === "all") return "";
  if (r === "ytd") return `${last.slice(0, 4)}-01-01`;
  const m = { "3m": 3, "6m": 6, "1y": 12 }[r];
  const y = +last.slice(0, 4),
    mo = +last.slice(5, 7) - 1 - m;
  const end = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(); // 31 May − 3 months = 28/29 Feb, not 3 March
  return new Date(Date.UTC(y, mo, Math.min(+last.slice(8, 10), end))).toISOString().slice(0, 10);
}

/** The hovered day broken down by entity, accounts largest first; zero balances left out. */
export function breakdown(d: NetWorthData, i: number) {
  const m = new Map<string, { entity: string; total: number; accounts: { account: string; value: number; liability: boolean }[] }>();
  for (const s of d.series) {
    const v = worth(s, s.values[i] ?? 0);
    if (Math.abs(v) < 0.005) continue;
    const e = m.get(s.entity) ?? { entity: s.entity, total: 0, accounts: [] };
    e.total += v;
    e.accounts.push({ account: s.account, value: v, liability: s.liability });
    m.set(s.entity, e);
  }
  return [...m.values()].map((e) => ({ ...e, accounts: e.accounts.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)) })).sort((a, b) => b.total - a.total);
}
