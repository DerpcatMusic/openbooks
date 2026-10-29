// Home-dashboard numbers (docs/mercury-books-spec.md section 11): net cash flow, monthly burn, runway, coverage, margins. Pure.
// "Cash" is every bank account that is not a credit card (the same as the Cash card); a card purchase is not cash out until the card is paid.
import type { Txn } from "@openbooks/schema";
import { isCard, pl } from "./reports.ts";

type Row = Pick<Txn, "date" | "amount" | "category" | "account">;
const r2 = (n: number) => Math.round(n * 100) / 100;
const cash = (ts: readonly Row[]) => ts.filter((t) => !isCard(t.account));

/** Money in, money out and the net of the cash accounts over the given transactions (a period's, already filtered). */
export function cashFlow(ts: readonly Row[]) {
  let inn = 0,
    out = 0;
  for (const t of cash(ts))
    if (t.amount > 0) inn += t.amount;
    else out -= t.amount;
  return { in: r2(inn), out: r2(out), net: r2(inn - out) };
}
/** Cash on hand at the end of day `iso`. */
export const cashAt = (ts: readonly Row[], iso: string) => r2(cash(ts).reduce((a, t) => (t.date <= iso ? a + t.amount : a), 0));

/** This period against the prior one: a percentage, or the plain difference when the prior was 0 (no basis for a percentage). */
export function cashDelta(cur: number, prior: number): { kind: "pct"; value: number } | { kind: "abs"; value: number } | null {
  if (prior === 0) return cur === 0 ? null : { kind: "abs", value: r2(cur - prior) };
  return { kind: "pct", value: ((cur - prior) / Math.abs(prior)) * 100 };
}

const ymAdd = (ym: string, n: number) => {
  const i = +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};
const lastDay = (ym: string) => `${ym}-${String(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate()).padStart(2, "0")}`;

export interface Burn {
  /** burn: the last 3 full months lost cash on average; build: they added cash. */
  kind: "burn" | "build";
  /** Average net cash flow per month over the 3 full calendar months before `now` (negative when burning). */
  avg: number;
  /** Cash at the end of the last full month. */
  cash: number;
  /** Whole months the cash lasts at this burn: floor(cash / |avg|); 0 when cash is negative. Burn only. */
  runway: number | null;
  /** Whole months of expenses the cash covers (cash / average monthly expenses of the same 3 months). Build only; null without expenses. */
  coverage: number | null;
  /** The three months, "YYYY-MM". */
  months: [string, string];
}
/** Monthly burn: the average net cash flow of the last three COMPLETE calendar months, only when the books reach back to the first of them
 *  and the average isn't 0. `now` is today's date (YYYY-MM-DD). Coverage is the spec's inferred formula (cash over average expenses). */
export function burn(ts: readonly Row[], now: string): Burn | null {
  const last = ymAdd(now.slice(0, 7), -1),
    first = ymAdd(last, -2);
  if (!ts.length || ts.reduce((m, t) => (t.date < m ? t.date : m), ts[0]!.date) > `${first}-01`) return null;
  const win = ts.filter((t) => t.date.slice(0, 7) >= first && t.date.slice(0, 7) <= last);
  const avg = r2(cashFlow(win).net / 3);
  if (avg === 0) return null;
  const c = cashAt(ts, lastDay(last));
  const exp = pl(win);
  const monthlyExpenses = (exp.cogs + exp.opex) / 3;
  return {
    kind: avg < 0 ? "burn" : "build",
    avg,
    cash: c,
    runway: avg < 0 ? (c >= 0 ? Math.floor(c / -avg) : 0) : null,
    coverage: avg > 0 && monthlyExpenses > 0 ? (c > 0 ? Math.floor(c / monthlyExpenses) : 0) : null,
    months: [first, last],
  };
}

/** Net margin and expense ratio in percent, only when there is revenue. Net margin = 100 - expense ratio. */
export function margins(revenue: number, expenses: number): { net: number; expenseRatio: number } | null {
  if (!(revenue > 0)) return null;
  const expenseRatio = (expenses / revenue) * 100;
  return { net: 100 - expenseRatio, expenseRatio };
}
/** "42%" (whole percent); a value that rounds below 1 but isn't 0 reads "<1%". */
export const pctLabel = (v: number) => {
  const r = Math.round(v);
  return v > 0 && r < 1 ? "<1%" : `${r === 0 ? 0 : r}%`;
};
