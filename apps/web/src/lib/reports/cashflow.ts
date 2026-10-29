// Cash flow analysis (Mercury Books): the bank and card balances at the start of each period, the ledger movement that changed them,
// and the balances at its end. Pure: rows and spans in, columns and statement lines out. Only rows on a bank or card account move cash
// (journal lines don't), so per account start + movement = end, and transfers between accounts net to zero in the movement section.
// Each column is computed on its own from the whole ledger, so any subset of columns can be shown.
import type { Txn } from "@openbooks/schema";
import type { Line } from "./statements.ts";

export type Row = Pick<Txn, "date" | "amount" | "account" | "category">;
export type Gran = "monthly" | "quarterly";
/** One column's dates (inclusive ISO). `mtd`: the span that contains today, cut at today (month / quarter to date). */
export interface Span {
  key: string;
  /** Month number (monthly) or quarter number (quarterly), 1-based. */
  n: number;
  months: number[];
  from: string;
  to: string;
  mtd: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The months or quarters of `year` that have started by `today`, the current one cut at today. */
export function spans(year: number, gran: Gran, today: string): Span[] {
  const size = gran === "monthly" ? 1 : 3;
  return Array.from({ length: 12 / size }, (_, i) => {
    const m0 = i * size + 1,
      m1 = m0 + size - 1;
    const from = `${year}-${pad(m0)}-01`,
      last = `${year}-${pad(m1)}-${pad(new Date(year, m1, 0).getDate())}`;
    return {
      key: gran === "monthly" ? `${year}-${pad(m0)}` : `${year}-Q${i + 1}`,
      n: i + 1,
      months: Array.from({ length: size }, (_, k) => m0 + k),
      from,
      to: last < today ? last : today,
      mtd: from <= today && today <= last,
    };
  }).filter((s) => s.from <= today);
}

export interface Col {
  span: Span;
  /** Balance of each bank / card account before the span began, and at its end. */
  start: Record<string, number>;
  end: Record<string, number>;
  /** Net movement per ledger account inside the span (all bank and card accounts together). */
  move: Record<string, number>;
  startTotal: number;
  endTotal: number;
  net: number;
}
const add = (xs: readonly number[]) => xs.reduce((a, x) => a + x, 0);
const total = (r: Record<string, number>) => add(Object.values(r));

export function cashFlow(rows: readonly Row[], banks: readonly string[], cuts: readonly Span[]): Col[] {
  const own = new Set(banks),
    cash = rows.filter((r) => own.has(r.account));
  return cuts.map((span) => {
    const start = Object.fromEntries(banks.map((a) => [a, 0])),
      end = { ...start },
      move: Record<string, number> = {};
    for (const r of cash) {
      if (r.date < span.from) start[r.account]! += r.amount;
      if (r.date <= span.to) end[r.account]! += r.amount;
      if (r.date >= span.from && r.date <= span.to) move[r.category] = (move[r.category] ?? 0) + r.amount;
    }
    return { span, start, end, move, startTotal: total(start), endTotal: total(end), net: total(move) };
  });
}

type Tr = (key: string) => string;
/** The analysis as statement rows: Starting balance, Movement (a row per ledger account, biggest inflow first), Ending balance. */
export function cfaLines(cols: readonly Col[], banks: readonly string[], t: Tr, cat: Tr): Line[] {
  const head = (label: string): Line => ({ kind: "head", label, v: [] }),
    sum = (kind: "sum" | "total", label: string, f: (c: Col) => number): Line => ({ kind, label, v: cols.map(f) }),
    per = (of: (c: Col) => Record<string, number>) =>
      banks.map((a): Line => ({ kind: "line", label: a, key: `account:${a}`, v: cols.map((c) => of(c)[a] ?? 0) }));
  const moves = [...new Set(cols.flatMap((c) => Object.keys(c.move)))]
    .map((key): Line => ({ kind: "line", label: cat(key), key, v: cols.map((c) => c.move[key] ?? 0) }))
    .sort((a, b) => add(b.v) - add(a.v));
  return [
    head(t("cfa.starting")),
    ...per((c) => c.start),
    sum("sum", t("cfa.totalStarting"), (c) => c.startTotal),
    head(t("cfa.movement")),
    ...moves,
    sum("sum", t("cfa.netMovement"), (c) => c.net),
    head(t("cfa.ending")),
    ...per((c) => c.end),
    sum("total", t("cfa.totalEnding"), (c) => c.endTotal),
  ];
}
