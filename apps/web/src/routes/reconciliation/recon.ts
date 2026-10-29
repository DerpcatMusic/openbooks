// Monthly bank reconciliation, pure (the page binds it to the store). Books doc "reconciliations" = { [account]: { "YYYY-MM": Rec } }.
// A month's reconciled balance is where the last reconciled month before it ended plus what is ticked cleared in it (before any
// reconciled month: the books' balance at the start of the month, i.e. earlier history is taken as given); the difference is the
// statement's ending balance less that, and a month is marked reconciled only at a zero difference.
// A month is auto-reconciled when the books' balance on its last day equals a balance the bank itself reported for that day (the
// readers' balance checks: total = the bank's balance, period[1] = its date): every transaction in it then counts as cleared.
import { balances, priorPeriod } from "@openbooks/core";
import type { StatementCheck, Txn } from "@openbooks/schema";

export interface Rec {
  /** The statement's ending balance; null until typed when the bank data has none to prefill from. */
  ending: number | null;
  /** ids of the transactions ticked cleared */
  cleared: string[];
  done: boolean;
  at?: string;
}
export type Recs = Record<string, Record<string, Rec>>;

/** Two amounts that agree to the cent: sums of cents in floats differ by far less than half of one. */
export const agrees = (a: number, b: number) => Math.abs(a - b) < 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100 || 0; // || 0: never -0
/** Last day of "YYYY-MM". */
export const monthEnd = (ym: string) => `${ym}-${String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()).padStart(2, "0")}`;

/** What the bank reported for an account: balance checks, dated at their period's end. */
const reported = (checks: readonly StatementCheck[], account: string) =>
  checks.filter((c) => c.balance && c.label === account && c.period[1]).map((c) => ({ date: c.period[1], amount: c.total }));
/** The ending balance a month starts with: the latest bank-reported balance dated in it, else null. */
export const prefill = (checks: readonly StatementCheck[], account: string, ym: string): number | null =>
  reported(checks, account)
    .filter((b) => b.date.startsWith(ym))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .at(-1)?.amount ?? null;
/** Months the bank already agrees with: books balance on the last day = the bank's balance for that day. ym → that balance. */
export function autoMonths(txns: readonly Txn[], checks: readonly StatementCheck[], account: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of reported(checks, account)) {
    const ym = b.date.slice(0, 7);
    if (b.date === monthEnd(ym) && agrees(balances(txns, checks, b.date)[account] ?? 0, b.amount)) out.set(ym, b.amount);
  }
  return out;
}
/** Where the last reconciled month before `ym` (marked done, or auto) ended; `start` (the books' balance before `ym`) when there is none. */
export function carriedIn(recs: Recs, auto: ReadonlyMap<string, number>, account: string, ym: string, start: number): number {
  const ends = new Map<string, number>();
  for (const [m, r] of Object.entries(recs[account] ?? {})) if (r.done && r.ending !== null) ends.set(m, r.ending);
  for (const [m, v] of auto) ends.set(m, v);
  const prev = [...ends.keys()]
    .filter((m) => m < ym)
    .sort()
    .at(-1);
  return prev === undefined ? start : ends.get(prev)!;
}

export interface Row {
  txn: Txn;
  /** the books' balance after this transaction */
  balance: number;
  cleared: boolean;
}
export interface Month {
  ym: string;
  auto: boolean;
  status: "auto" | "reconciled" | "open";
  /** reconciled balance carried in */
  opening: number;
  rows: Row[];
  /** sum of the cleared rows */
  cleared: number;
  /** opening + cleared */
  reconciled: number;
  ending: number | null;
  /** ending − reconciled; null while there is no ending balance */
  difference: number | null;
}
/** Everything the page shows for one account and month. txns are the ledger rows sorted by date. */
export function monthOf(txns: readonly Txn[], checks: readonly StatementCheck[], recs: Recs, account: string, ym: string): Month {
  const bank = autoMonths(txns, checks, account),
    auto = bank.has(ym),
    rec = recs[account]?.[ym],
    ticked = new Set(rec?.cleared);
  const start = round2(balances(txns, checks, monthEnd(priorPeriod({ from: ym, to: ym }).to))[account] ?? 0); // the books before this month
  let run = start;
  const rows: Row[] = [];
  for (const t of txns)
    if (t.account === account && t.date.startsWith(ym)) {
      run = round2(run + t.amount);
      rows.push({ txn: t, balance: run, cleared: auto || ticked.has(t.id) });
    }
  const cleared = round2(rows.reduce((a, r) => a + (r.cleared ? r.txn.amount : 0), 0)),
    opening = carriedIn(recs, bank, account, ym, start),
    reconciled = round2(opening + cleared),
    ending = auto ? bank.get(ym)! : (rec?.ending ?? prefill(checks, account, ym)),
    difference = ending === null ? null : round2(ending - reconciled);
  const status = auto ? "auto" : rec?.done && difference !== null && agrees(difference, 0) ? "reconciled" : "open";
  return { ym, auto, status, opening, rows, cleared, reconciled, ending, difference };
}
/** A month can be marked reconciled once its difference is zero (auto months already are). */
export const canMark = (m: Month) => !m.auto && m.difference !== null && agrees(m.difference, 0);

/** Recs with one month changed by `fn`. A month with no record yet starts from the ending shown for it; any edit un-marks it. */
export function edit(recs: Recs, account: string, ym: string, shown: number | null, fn: (r: Rec) => Partial<Rec>): Recs {
  const cur = recs[account]?.[ym] ?? { ending: shown, cleared: [], done: false };
  return { ...recs, [account]: { ...recs[account], [ym]: { ...cur, done: false, ...fn(cur) } } };
}

const cell = (v: string | number | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
/** The month as CSV: its balances, then its transactions (headers stay English, like the transactions export). */
export const monthCsv = (account: string, m: Month, label: (c: string) => string) =>
  [
    ...(
      [
        ["Account", account],
        ["Month", m.ym],
        ["Carried in", m.opening],
        ["Cleared", m.cleared],
        ["Reconciled balance", m.reconciled],
        ["Ending balance", m.ending ?? ""],
        ["Difference", m.difference ?? ""],
      ] as const
    ).map((r) => r.map(cell).join(",")),
    "",
    "Date,Description,Ledger account,Amount,Balance,Cleared",
    ...m.rows.map((r) => [r.txn.date, r.txn.who ?? r.txn.desc, label(r.txn.category), r.txn.amount, r.balance, r.cleared ? "yes" : "no"].map(cell).join(",")),
  ].join("\n");
