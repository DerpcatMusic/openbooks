// Recurring payments and income (subscriptions, retainers, rent): the same counterparty (payerOf) at a regular cadence with a steady amount.
// Pure. Transfers, own money and equity are not "recurring spending"; journal rows are not bank movements.
import type { Txn } from "@openbooks/schema";
import { group, payerOf } from "./reports.ts";

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
/** Typical gap in days and how far one gap may stray from it. */
const CADENCES: readonly [Cadence, number, number][] = [
  ["weekly", 7, 2],
  ["biweekly", 14, 3],
  ["monthly", 30.44, 6],
  ["quarterly", 91.3, 12],
  ["yearly", 365.25, 20],
];
const STEP: Record<Cadence, [days: number, months: number]> = { weekly: [7, 0], biweekly: [14, 0], monthly: [0, 1], quarterly: [0, 3], yearly: [0, 12] };

export interface Recurring {
  /** Stable id for dismissing: payer and direction. */
  key: string;
  payer: string;
  /** The ledger account most of its payments are filed under. */
  account: string;
  cadence: Cadence;
  /** The latest amount (negative = money out). */
  amount: number;
  /** Dates of the last occurrence and the expected next one. */
  last: string;
  next: string;
  /** Number of occurrences in the regular run. */
  count: number;
  /** The amount stepped from `from` to `to` on `date` after at least two payments at the old price. */
  priceChange?: { from: number; to: number; date: string };
}
type Row = Pick<Txn, "date" | "amount" | "category" | "desc" | "source"> & { who?: string; account?: string };

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
const median = (xs: readonly number[]) => {
  const s = xs.toSorted((a, b) => a - b),
    m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.abs(b);
/** iso + one cadence step, in calendar months where it counts (the 31st clamps to the month's last day). */
export function nextDate(iso: string, c: Cadence): string {
  const [d, m] = STEP[c];
  const y = +iso.slice(0, 4),
    mo = +iso.slice(5, 7) - 1 + m,
    dd = +iso.slice(8, 10);
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo, Math.min(dd, last) + d)).toISOString().slice(0, 10);
}
export const recurringKey = (payer: string, amount: number) => `${payer}|${amount < 0 ? "out" : "in"}`;

/**
 * Regular payers: at least 3 occurrences in a row whose gaps all fit one cadence and whose amounts stay within 35% of their median.
 * `now` (YYYY-MM-DD, default the latest date in txns) drops series that missed their next date by more than two gaps' tolerance.
 * ponytail: one run per payer and direction (the latest); a payer with two parallel subscriptions shows as irregular.
 */
export function recurring(txns: readonly Row[], now?: string): Recurring[] {
  const groups = new Map<string, Row[]>();
  for (const t of txns) {
    if (!t.amount || t.source === "journal" || ["transfer", "own", "equity"].includes(group(t.category))) continue;
    const k = recurringKey(payerOf(t), t.amount);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const today = now ?? txns.reduce((m, t) => (t.date > m ? t.date : m), "");
  const out: Recurring[] = [];
  for (const [key, ts] of groups) {
    if (ts.length < 3) continue;
    // same-day rows from one payer are one occurrence
    const byDay = new Map<string, number>();
    for (const t of ts) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount);
    const occ = [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (occ.length < 3) continue;
    const gaps = occ.slice(1).map(([d], i) => day(d) - day(occ[i]![0]));
    const recent = median(gaps.slice(-4));
    const cad = CADENCES.find(([, g, tol]) => Math.abs(recent - g) <= tol);
    if (!cad) continue;
    const [cadence, g, tol] = cad;
    // the latest unbroken run at this cadence
    let start = occ.length - 1;
    while (start > 0 && Math.abs(gaps[start - 1]! - g) <= tol) start--;
    const run = occ.slice(start);
    if (run.length < 3) continue;
    const amounts = run.map(([, a]) => a),
      mid = median(amounts);
    if (!amounts.every((a) => close(a, mid, 0.35))) continue;
    const last = run.at(-1)![0];
    const next = nextDate(last, cadence);
    if (today && day(today) > day(next) + 2 * tol + 1) continue; // lapsed
    const payer = key.slice(0, key.lastIndexOf("|"));
    const cats = new Map<string, number>();
    for (const t of ts) cats.set(t.category, (cats.get(t.category) ?? 0) + 1);
    const r: Recurring = { key, payer, account: [...cats].sort((a, b) => b[1] - a[1])[0]![0], cadence, amount: amounts.at(-1)!, last, next, count: run.length };
    // a step change: the last change of more than 1%, after at least two payments at the old price, and steady since
    let j = amounts.length - 1;
    while (j > 0 && close(amounts[j]!, amounts[j - 1]!, 0.01)) j--;
    if (j >= 2 && close(amounts[j - 2]!, amounts[j - 1]!, 0.01) && amounts.slice(j).every((a) => close(a, amounts.at(-1)!, 0.01)))
      r.priceChange = { from: amounts[j - 1]!, to: amounts.at(-1)!, date: run[j]![0] };
    out.push(r);
  }
  return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/** Rough monthly equivalent of a recurring amount (for totals). */
export const perMonth = (r: Pick<Recurring, "amount" | "cadence">) =>
  r.amount * { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[r.cadence];
