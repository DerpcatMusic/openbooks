// Financial statements as rows × columns, for the Reports page (port of web/src/views/Reports.svelte). Pure: callers pass the
// transactions of each column (months, the period total, or this period vs the prior one) and the label functions.
// Each column is computed independently, so the same builder serves the monthly view, the total and the period comparison.
import { group, isCard, pl, plOf, type PL } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";

type Row = Pick<Txn, "date" | "amount" | "category">;
export type Kind = "head" | "line" | "sum" | "total";
/** One statement row. `v[i]` is column i's value; `key` (lines) is the ledger account to drill into. */
export interface Line {
  kind: Kind;
  label: string;
  v: number[];
  key?: string;
  /** Highlight (in-transit cash on the balance sheet). */
  warn?: boolean;
}
type Tr = (key: string) => string;

const sum = (ts: readonly Row[]) => ts.reduce((a, t) => a + t.amount, 0);
const of = (ts: readonly Row[], key: string) => sum(ts.filter((t) => t.category === key));

/** Cash-basis P&L. Expense sections flip signs so every section reads positive; `us` adds the US wording. */
export function plStatement(cols: readonly (readonly Row[])[], us: boolean, t: Tr, cat: Tr): Line[] {
  const P = cols.map(pl),
    all = pl(cols.flat());
  const line = (key: string, sign: number): Line => ({ kind: "line", label: cat(key), key, v: cols.map((c) => sign * of(c, key) || 0) });
  const tot = (label: string, f: (p: PL) => number, kind: Kind = "sum"): Line => ({ kind, label, v: P.map((p) => f(p) || 0) });
  const head = (label: string): Line => ({ kind: "head", label, v: [] });
  return [
    head(t(us ? "reports.revenue" : "reports.businessIncome")),
    ...all.lines.revenue.map((l) => line(l.key, 1)),
    tot(t(us ? "reports.totalRevenue" : "reports.totalBusinessIncome"), (p) => p.revenue),
    ...(all.cogs || all.lines.cogs.length
      ? [
          head(t("reports.cogs")),
          ...all.lines.cogs.map((l) => line(l.key, -1)),
          tot(t("reports.totalCogs"), (p) => p.cogs),
          tot(t("reports.grossProfit"), (p) => p.gross),
        ]
      : []),
    ...(all.lines.expense.length
      ? [
          head(t("reports.opex")),
          ...all.lines.expense.map((l) => line(l.key, -1)),
          tot(t("reports.totalOpex"), (p) => p.opex),
          tot(t("reports.operatingIncome"), (p) => p.operating),
        ]
      : []),
    ...(all.lines.other.length ? [head(t("reports.otherIncome")), ...all.lines.other.map((l) => line(l.key, 1))] : []),
    ...(all.lines.ask.length
      ? [head(t("common.uncategorized")), { kind: "line" as const, label: t("common.uncategorized"), key: "ask", v: P.map((p) => p.uncat) }]
      : []),
    tot(t("reports.netIncome"), (p) => p.net, "total"),
  ];
}

export type CfSection = "operating" | "financing" | "other" | "transfers";
export const cfSection = (c: string): CfSection =>
  plOf(c) ? "operating" : group(c) === "equity" ? "financing" : group(c) === "transfer" ? "transfers" : "other";

/** Cash flow by section (operating / financing / other / transfers), lines biggest inflow first. */
export function cfStatement(cols: readonly (readonly Row[])[], t: Tr, cat: Tr): Line[] {
  const all = cols.flat(),
    out: Line[] = [];
  for (const s of ["operating", "financing", "other", "transfers"] as const) {
    const keys = [...new Set(all.filter((x) => cfSection(x.category) === s).map((x) => x.category))];
    if (!keys.length) continue;
    const lines = keys
      .map((key): Line => ({ kind: "line", label: cat(key), key, v: cols.map((c) => of(c, key)) }))
      .sort((a, b) => b.v.reduce((x, y) => x + y, 0) - a.v.reduce((x, y) => x + y, 0));
    out.push({ kind: "head", label: t(`reports.cf.${s}`), v: [] }, ...lines, {
      kind: "sum",
      label: t(`reports.cfNet.${s}`),
      v: cols.map((_, i) => lines.reduce((a, l) => a + l.v[i]!, 0)),
    });
  }
  out.push({ kind: "total", label: t("reports.netChange"), v: cols.map(sum) });
  return out;
}

/** One balance-sheet column: account balances at the date and every transaction up to it. */
export interface BsPoint {
  balances: Readonly<Record<string, number>>;
  upto: readonly Row[];
}
/** Cash-basis balance sheet: bank accounts are assets, cards liabilities; equity = owner's net + retained earnings (+ cash in transit). */
export function bsStatement(points: readonly BsPoint[], t: Tr): { lines: Line[]; totals: { assets: number; liab: number; equity: number }[] } {
  const names = [...new Set(points.flatMap((p) => Object.keys(p.balances)))];
  const cash = names.filter((a) => !isCard(a)),
    cards = names.filter(isCard);
  const at = points.map((p) => {
    const b = (a: string) => p.balances[a] ?? 0;
    const assets = cash.reduce((s, a) => s + b(a), 0),
      liab = -cards.reduce((s, a) => s + b(a), 0);
    const owner = sum(p.upto.filter((x) => group(x.category) === "equity")),
      re = pl(p.upto).net,
      transit = assets - liab - owner - re;
    return { b, assets, liab, owner, re, transit, equity: owner + re + transit };
  });
  const row = (kind: Kind, label: string, f: (x: (typeof at)[number]) => number, key?: string): Line => ({
    kind,
    label,
    v: at.map(f),
    ...(key ? { key } : {}),
  });
  const head = (label: string): Line => ({ kind: "head", label, v: [] });
  const lines = [
    head(t("reports.assets")),
    ...cash.map((a) => row("line", a, (x) => x.b(a))),
    row("sum", t("reports.totalAssets"), (x) => x.assets),
    head(t("reports.liabilities")),
    ...cards.map((a) => row("line", a, (x) => -x.b(a) || 0)),
    row("sum", t("reports.totalLiabilities"), (x) => x.liab),
    head(t("reports.equity")),
    row("line", t("reports.ownerNet"), (x) => x.owner, "type:equity"),
    row("line", t("reports.retained"), (x) => x.re),
    ...(at.some((x) => Math.abs(x.transit) > 0.005) ? [{ ...row("line", t("reports.transit"), (x) => x.transit), warn: true }] : []),
    row("sum", t("reports.totalEquity"), (x) => x.equity),
    row("total", t("reports.liabEquity"), (x) => x.liab + x.equity),
  ];
  return { lines, totals: at.map(({ assets, liab, equity }) => ({ assets, liab, equity })) };
}

/** General ledger: one group per ledger account (sorted by name), each transaction with its running balance. */
export function ledgerGroups<T extends Row>(ts: readonly T[], cat: Tr) {
  const m = new Map<string, T[]>();
  for (const x of ts) m.set(x.category, [...(m.get(x.category) ?? []), x]);
  return [...m]
    .map(([key, xs]) => {
      let run = 0;
      return { key, label: cat(key), value: sum(xs), rows: xs.map((tx) => ({ tx, run: (run += tx.amount) })) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Months of a period trimmed to the first and last with activity (a 6-month-old LLC doesn't show empty Jan–Mar). */
export function activeMonths(months: readonly string[], ts: readonly Pick<Row, "date">[]) {
  const has = new Set(ts.map((t) => t.date.slice(0, 7)));
  const a = months.findIndex((m) => has.has(m)),
    b = months.findLastIndex((m) => has.has(m));
  return a < 0 ? [...months] : months.slice(a, b + 1);
}

/** Relative change a vs b (null when b is 0: no basis). */
export const change = (a: number, b: number) => (b ? (a - b) / Math.abs(b) : null);

/** Rows as CSV (RFC 4180 quoting, CRLF). */
export const csv = (rows: readonly (readonly string[])[]) =>
  rows.map((r) => r.map((s) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)).join(",")).join("\r\n") + "\r\n";

/** A statement as CSV: plain 2-decimal numbers, real amounts (privacy mode is for the screen only). */
export const toCsv = (header: readonly string[], lines: readonly Line[]) =>
  csv([header, ...lines.map((l) => [l.label, ...(l.kind === "head" ? [] : l.v.map((n) => (Math.abs(n) < 0.005 ? 0 : n).toFixed(2)))])]);
