// Financial statements as rows × columns, for the Reports page (port of web/src/views/Reports.svelte). Pure: callers pass the
// transactions of each column (months, the period total, or this period vs the prior one) and the label functions.
// Each column is computed independently, so the same builder serves the monthly view, the total and the period comparison.
import { group, isCard, isPayable, isReceivable, PAYROLL_ACCOUNT, pl, plOf, type AgingReport, type PL } from "@openbooks/core";
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
  const hasCogs = !!(all.cogs || all.lines.cogs.length),
    hasOpex = all.lines.expense.length > 0;
  // Mercury's order: revenue, total, cost of goods, gross profit, operating expenses, operating profit, other income, net. US books always show both profit
  // rows (zeros when a section is empty); Israeli books, which are mostly income, show them with their section.
  return [
    head(t(us ? "reports.revenue" : "reports.businessIncome")),
    ...all.lines.revenue.map((l) => line(l.key, 1)),
    tot(t(us ? "reports.totalRevenue" : "reports.totalBusinessIncome"), (p) => p.revenue),
    ...(hasCogs ? [head(t("reports.cogs")), ...all.lines.cogs.map((l) => line(l.key, -1)), tot(t("reports.totalCogs"), (p) => p.cogs)] : []),
    ...(hasCogs || us ? [tot(t("reports.grossProfit"), (p) => p.gross)] : []),
    ...(hasOpex ? [head(t("reports.opex")), ...all.lines.expense.map((l) => line(l.key, -1)), tot(t("reports.totalOpex"), (p) => p.opex)] : []),
    ...(hasOpex || us ? [tot(t("reports.operatingIncome"), (p) => p.operating)] : []),
    ...(all.lines.other.length
      ? [head(t("reports.otherIncome")), ...all.lines.other.map((l) => line(l.key, 1)), tot(t("reports.totalOtherIncome"), (p) => p.other)]
      : []),
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

/** Cash flow on the accrual basis, indirect: net income, the change in receivables and payables (and money settled outside the books, which moved
 *  no cash) = cash from operations; then the sections that are not income (financing, other, transfers) as the direct statement shows them.
 *  `cols` are accrual rows (core basis.ts); the last line is the change in cash, which the sections add up to. */
export function cfIndirect(cols: readonly (readonly Row[])[], t: Tr, cat: Tr): Line[] {
  type R = Row & { source?: string; why?: string };
  const rs = cols as readonly (readonly R[])[];
  const doc = (x: R) => x.source === "invoice" || x.source === "bill" || x.source === "payroll";
  const out: Line[] = [{ kind: "head", label: t("reports.cf.operating"), v: [] }];
  const net = rs.map((c) => pl(c).net),
    ar = rs.map((c) => sum(c.filter((x) => isReceivable(x.category)))),
    ap = rs.map((c) => sum(c.filter((x) => isPayable(x.category) && x.category !== PAYROLL_ACCOUNT))),
    pr = rs.map((c) => sum(c.filter((x) => x.category === PAYROLL_ACCOUNT))),
    gone = rs.map((c) => -sum(c.filter((x) => x.why === "outside")));
  out.push(
    { kind: "line", label: t("reports.netIncome"), v: net },
    { kind: "line", label: t("reports.cf.dAr"), v: ar, key: "ar:accounts-receivable" },
    { kind: "line", label: t("reports.cf.dAp"), v: ap, key: "ap:accounts-payable" },
    ...(pr.some((x) => Math.abs(x) > 0.005) ? [{ kind: "line" as const, label: t("gaps3.cf.dPr"), v: pr, key: PAYROLL_ACCOUNT }] : []),
    ...(gone.some((x) => Math.abs(x) > 0.005) ? [{ kind: "line" as const, label: t("reports.cf.outside"), v: gone }] : []),
    { kind: "sum", label: t("reports.cfNet.operating"), v: net.map((n, i) => n + ar[i]! + ap[i]! + pr[i]! + gone[i]!) },
  );
  const all = rs.flat();
  for (const s of ["financing", "other", "transfers"] as const) {
    const keys = [...new Set(all.filter((x) => !isReceivable(x.category) && !isPayable(x.category) && cfSection(x.category) === s).map((x) => x.category))];
    if (!keys.length) continue;
    const lines = keys
      .map((key): Line => ({ kind: "line", label: cat(key), key, v: rs.map((c) => of(c, key)) }))
      .sort((a, b) => b.v.reduce((x, y) => x + y, 0) - a.v.reduce((x, y) => x + y, 0));
    out.push({ kind: "head", label: t(`reports.cf.${s}`), v: [] }, ...lines, {
      kind: "sum",
      label: t(`reports.cfNet.${s}`),
      v: rs.map((_, i) => lines.reduce((a, l) => a + l.v[i]!, 0)),
    });
  }
  out.push({ kind: "total", label: t("reports.netChange"), v: rs.map((c) => sum(c.filter((x) => !doc(x)))) });
  return out;
}

/** One balance-sheet column: account balances at the date and every transaction up to it. `open` = invoices and bills still unpaid that day. */
export interface BsPoint {
  /** The day the column is as of (YYYY-MM-DD): its year splits earnings into retained and current-year. */
  iso: string;
  balances: Readonly<Record<string, number>>;
  upto: readonly Row[];
  open?: { ar: { total: number; prior: number }; ap: { total: number; prior: number }; pr?: { total: number; prior: number } };
  /** Accrual only: receivable / payable cleared with no bank row (core basis.ts outsideNet), up to the day and up to the end of the year before. It is
   *  income (or expense) the accrual P&L counts that no bank row carries, so earnings include it and an equity line of its own offsets it. */
  outside?: { total: number; prior: number };
}
/** Balance sheet: bank accounts are assets, cards liabilities; equity = owner's net + retained earnings (earlier years) + current-year earnings
 *  (+ cash in transit, the gap cash-basis books leave). Retained and current-year are synthetic roll-ups of the P&L, as in Mercury.
 *  accrual adds Accounts receivable (open invoices) and Accounts payable (open bills) and, to keep the sheet balanced, the earnings they imply
 *  (an item issued before this year lands in retained earnings); off, they are a memo under the totals. */
export function bsStatement(points: readonly BsPoint[], t: Tr, accrual = false): { lines: Line[]; totals: { assets: number; liab: number; equity: number }[] } {
  const names = [...new Set(points.flatMap((p) => Object.keys(p.balances)))];
  const cash = names.filter((a) => !isCard(a)),
    cards = names.filter(isCard);
  const at = points.map((p) => {
    const b = (a: string) => p.balances[a] ?? 0;
    const ar = p.open?.ar.total ?? 0,
      ap = p.open?.ap.total ?? 0,
      arPrior = p.open?.ar.prior ?? 0,
      apPrior = p.open?.ap.prior ?? 0,
      pr = p.open?.pr?.total ?? 0,
      prPrior = p.open?.pr?.prior ?? 0;
    const cashAssets = cash.reduce((s, a) => s + b(a), 0),
      cardDebt = -cards.reduce((s, a) => s + b(a), 0);
    const assets = cashAssets + (accrual ? ar : 0),
      liab = cardDebt + (accrual ? ap + pr : 0);
    const owner = sum(p.upto.filter((x) => group(x.category) === "equity"));
    const year = `${p.iso.slice(0, 4)}-01-01`,
      thisYear = pl(p.upto.filter((x) => x.date >= year)).net,
      allTime = pl(p.upto).net;
    const out = accrual ? (p.outside ?? { total: 0, prior: 0 }) : { total: 0, prior: 0 };
    const cy = thisYear + (accrual ? ar - arPrior - (ap - apPrior) - (pr - prPrior) + out.total - out.prior : 0),
      re = allTime - thisYear + (accrual ? arPrior - apPrior - prPrior + out.prior : 0);
    const transit = cashAssets - cardDebt - owner - allTime,
      settled = -out.total;
    return { b, assets, liab, owner, re, cy, ar, ap, pr, transit, settled, equity: owner + re + cy + transit + settled };
  });
  const row = (kind: Kind, label: string, f: (x: (typeof at)[number]) => number, key?: string): Line => ({
    kind,
    label,
    v: at.map(f),
    ...(key ? { key } : {}),
  });
  const head = (label: string): Line => ({ kind: "head", label, v: [] });
  const memo = !accrual && at.some((x) => x.ar || x.ap || x.pr);
  const lines = [
    head(t("reports.assets")),
    ...cash.map((a) => row("line", a, (x) => x.b(a))),
    ...(accrual ? [row("line", t("reports.ar"), (x) => x.ar)] : []),
    row("sum", t("reports.totalAssets"), (x) => x.assets),
    head(t("reports.liabilities")),
    ...cards.map((a) => row("line", a, (x) => -x.b(a) || 0)),
    ...(accrual ? [row("line", t("reports.ap"), (x) => x.ap)] : []),
    ...(accrual && at.some((x) => x.pr) ? [row("line", t("gaps3.payroll.liabilities"), (x) => x.pr)] : []),
    row("sum", t("reports.totalLiabilities"), (x) => x.liab),
    head(t("reports.equity")),
    row("line", t("reports.ownerNet"), (x) => x.owner, "type:equity"),
    row("line", t("reports.retained"), (x) => x.re),
    row("line", t("reports.currentYear"), (x) => x.cy),
    ...(at.some((x) => Math.abs(x.transit) > 0.005) ? [{ ...row("line", t("reports.transit"), (x) => x.transit), warn: true }] : []),
    ...(at.some((x) => Math.abs(x.settled) > 0.005) ? [row("line", t("reports.settledOutside"), (x) => x.settled)] : []),
    row("sum", t("reports.totalEquity"), (x) => x.equity),
    row("total", t("reports.liabEquity"), (x) => x.liab + x.equity),
    ...(memo
      ? [
          head(t("reports.memo")),
          row("line", t("reports.arOpen"), (x) => x.ar),
          row("line", t("reports.apOpen"), (x) => x.ap),
          ...(at.some((x) => x.pr) ? [row("line", t("gaps3.payroll.liabilities"), (x) => x.pr)] : []),
        ]
      : []),
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

/** An aging report as CSV: by party (one column per bucket, Overdue, Total, a totals row) or by document. Plain 2-decimal numbers.
 *  `bucket(i)` names bucket i ("Current", "1-30 days"); `label` holds the party, document and no-party captions. */
export function agingCsv(
  r: AgingReport,
  view: "party" | "source",
  t: Tr,
  bucket: (i: number) => string,
  label: { party: string; ref: string; none: string },
): string {
  const n = (x: number) => (Math.abs(x) < 0.005 ? 0 : x).toFixed(2);
  if (view === "source")
    return csv([
      [label.party, label.ref, t("common.date"), t("bills.col.dueDate"), t("aging.pastDue"), t("aging.bucket"), t("aging.outstanding")],
      ...r.sources.map((s) => [s.name || label.none, s.ref, s.date, s.due ?? "", String(Math.max(0, s.days)), bucket(s.bucket), n(s.outstanding)]),
    ]);
  return csv([
    [label.party, ...r.buckets.map((_, i) => bucket(i)), t("aging.overdue"), t("common.total")],
    ...r.parties.map((p) => [p.name || label.none, ...p.buckets.map(n), n(p.overdue), n(p.total)]),
    [t("common.total"), ...r.totals.buckets.map(n), n(r.totals.overdue), n(r.totals.total)],
    ...(r.totals.percents ? [[t("aging.pct"), ...r.totals.percents.map((x) => x.toFixed(1)), "", "100.0"]] : []),
  ]);
}
