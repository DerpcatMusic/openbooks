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
  /** Stable id for dismissing: payer and direction, plus the starting price for a fixed-price plan. */
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
  /** Charges in the series, the ones at an earlier price (before `priceChange`) included. */
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
/** The payer-and-direction part of a key (a dismissal stored under it covers every plan of that payer). */
export const recurringBase = (key: string) => key.split("|").slice(0, 2).join("|");

/**
 * Regular payers, per payer and direction:
 * - fixed price (a subscription): charges at one price (within 1%) whose gaps fit one cadence, 2 in a row are enough (3 weekly). A payer can have
 *   several (two Cloudflare plans), and a plan that changed price continues the old one (Tello 9.11 → 5.95 is one series, flagged).
 * - otherwise a varying amount (a utility bill, royalties): at least 3 in a row on one cadence, amounts within 35% of their median.
 * A series is lapsed when its account shows later activity well past the expected next charge (`now`, default the latest date in txns,
 * caps it): books that stopped syncing say nothing about whether a subscription stopped.
 */
export function recurring(txns: readonly Row[], now?: string): Recurring[] {
  const groups = new Map<string, Row[]>(),
    seen = new Map<string, string>();
  for (const t of txns) {
    if (t.source === "journal") continue;
    if ((seen.get(t.account ?? "") ?? "") < t.date) seen.set(t.account ?? "", t.date);
    if (!t.amount || ["transfer", "own", "equity"].includes(group(t.category))) continue;
    const k = recurringKey(payerOf(t), t.amount);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const latest = now ?? txns.reduce((m, t) => (t.date > m ? t.date : m), "");
  const out: Recurring[] = [];
  for (const [key, ts] of groups) {
    if (ts.length < 2) continue;
    const payer = key.slice(0, key.lastIndexOf("|"));
    const cats = new Map<string, number>();
    for (const t of ts) cats.set(t.category, (cats.get(t.category) ?? 0) + 1);
    const account = [...cats].sort((a, b) => b[1] - a[1])[0]![0];
    const seenTill = (rows: readonly Row[]) => {
      const a = rows.map((t) => seen.get(t.account ?? "") ?? "").reduce((m, d) => (d > m ? d : m), "");
      return latest && latest < a ? latest : a;
    };
    const found: Recurring[] = [];
    const take = (occ: [string, number][], cadence: Cadence, tol: number, rows: readonly Row[], fixed: boolean) => {
      const last = occ.at(-1)![0],
        next = nextDate(last, cadence),
        till = seenTill(rows);
      if (till && day(till) > day(next) + 2 * tol + 1) return; // lapsed
      const amounts = occ.map(([, a]) => a);
      const r: Recurring = { key, payer, account, cadence, amount: amounts.at(-1)!, last, next, count: occ.length };
      if (!fixed) {
        // a step change: the last change of more than 1%, after at least two payments at the old price, and steady since
        let j = amounts.length - 1;
        while (j > 0 && close(amounts[j]!, amounts[j - 1]!, 0.01)) j--;
        if (j >= 2 && close(amounts[j - 2]!, amounts[j - 1]!, 0.01) && amounts.slice(j).every((a) => close(a, amounts.at(-1)!, 0.01)))
          r.priceChange = { from: amounts[j - 1]!, to: amounts.at(-1)!, date: occ[j]![0] };
      }
      found.push(r);
      return r;
    };
    // the latest unbroken run of occ at one cadence (judged on the recent gaps), or null
    const runOf = (occ: [string, number][]) => {
      if (occ.length < 2) return null;
      const gaps = occ.slice(1).map(([d], i) => day(d) - day(occ[i]![0]));
      const cad = CADENCES.find(([, g, tol]) => Math.abs(median(gaps.slice(-4)) - g) <= tol);
      if (!cad) return null;
      let start = occ.length - 1;
      while (start > 0 && Math.abs(gaps[start - 1]! - cad[1]) <= cad[2]) start--;
      return { run: occ.slice(start), cad, start };
    };
    const byDate = ts.toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // 1. fixed-price plans: one series per price
    const prices: number[] = [];
    for (const t of byDate) if (!prices.some((p) => close(t.amount, p, 0.01))) prices.push(t.amount);
    for (const p of prices) {
      const rows = byDate.filter((t) => close(t.amount, p, 0.01));
      // two equal charges on one day (two seats, two plans billed together) add up, never overwrite
      const sums = new Map<string, number>();
      for (const t of rows) sums.set(t.date, (sums.get(t.date) ?? 0) + t.amount);
      const occ = [...sums];
      const hit = runOf(occ);
      if (!hit) continue;
      const [cadence, g, tol] = hit.cad;
      if (hit.run.length < (g < 28 ? 3 : 2)) continue; // two weekly charges are a coincidence more often than a plan
      // a plan is most of what the payer charges while it runs: two equal amounts among many varying ones (cashback, ad spend) are chance
      const [from, to] = [hit.run[0]![0], hit.run.at(-1)![0]];
      if (byDate.filter((t) => t.date >= from && t.date <= to && !close(t.amount, p, 0.01)).length > hit.run.length) continue;
      // the plan before a price change: the payer's charge one cadence before this run, at another price, continues the series
      const first = hit.run[0]![0],
        prev = byDate.filter((t) => t.date < first && !close(t.amount, p, 0.01)).at(-1);
      // the plan's first charge at a new price, one cadence after the run (once so far): the series goes on at the new price
      const later = byDate.filter((t) => t.date > to && !close(t.amount, p, 0.01)),
        bump = later.length === 1 && Math.abs(day(later[0]!.date) - day(to) - g) <= tol && close(later[0]!.amount, p, 0.6) ? later[0]! : null;
      const r = take(bump ? [...hit.run, [bump.date, bump.amount]] : hit.run, cadence, tol, bump ? [...rows, bump] : rows, true);
      if (!r) continue;
      if (bump) r.priceChange = { from: hit.run.at(-1)![1], to: bump.amount, date: bump.date };
      // ...only when the old price stopped: an old plan still charging alongside is a second plan, not this one's past
      const ended = prev && !byDate.some((t) => t.date >= first && close(t.amount, prev.amount, 0.01));
      if (prev && ended && Math.abs(day(first) - day(prev.date) - g) <= tol && close(prev.amount, p, 0.6)) {
        // the old price's own run ends where this one starts: it is this series, not a second plan
        const old = found.findIndex((x) => x !== r && x.last === prev.date);
        r.priceChange = { from: prev.amount, to: r.amount, date: first };
        const before = [...new Map(byDate.filter((t) => t.date < first && close(t.amount, prev.amount, 0.01)).map((t) => [t.date, t.amount]))];
        r.count += runOf(before)?.run.length ?? 1;
        if (old >= 0) found.splice(old, 1);
      }
    }
    if (found.length) {
      // each plan its own dismiss key, by the price it started at: stable when a sibling plan comes or goes, or the price changes
      for (const r of found) r.key = `${key}|${Math.abs(r.priceChange?.from ?? r.amount).toFixed(2)}`;
      out.push(...found);
      continue;
    }

    // 2. a varying amount: same-day rows from one payer are one occurrence
    const byDay = new Map<string, number>();
    for (const t of byDate) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount);
    const hit = runOf([...byDay]);
    if (!hit || hit.run.length < 3) continue;
    const amounts = hit.run.map(([, a]) => a),
      mid = median(amounts);
    if (!amounts.every((a) => close(a, mid, 0.35))) continue;
    take(hit.run, hit.cad[0], hit.cad[2], byDate, false);
    out.push(...found);
  }
  return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/** Rough monthly equivalent of a recurring amount (for totals). */
export const perMonth = (r: Pick<Recurring, "amount" | "cadence">) =>
  r.amount * { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[r.cadence];
