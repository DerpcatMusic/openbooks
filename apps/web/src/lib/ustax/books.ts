// The US tax inputs the TaxUS and Planner pages share, read from the open books for tax year y (owner money, year-end assets,
// the C-corp's P&L for its 1120). The maths is the US pack's (irs.ts); this only gathers the numbers.
import { group, isCard, pl } from "@openbooks/core";
import type { CorpInput, IrsInput } from "@openbooks/country-us";
import { balances, bizType, S, taxTable, yearTxns } from "../stores/books.svelte.ts";

export const isCorp = (y = S.year) => bizType(y) === "llc-ccorp";
/** Transactions with the owner (equity:*): contributions > 0, distributions < 0. */
export const ownerTxns = (y = S.year) => yearTxns(y).filter((t) => group(t.category) === "equity");
/** Bank balances (not cards) at the end of the year: 5472 line 1c / 1120 item D. */
export const totalAssets = (y = S.year) =>
  Object.entries(balances(`${y}-12-31`))
    .filter(([a]) => !isCard(a))
    .reduce((s, [, v]) => s + v, 0);

export function irsInput(y = S.year): IrsInput {
  return {
    year: y,
    ...S.data?.profile,
    totalAssets: totalAssets(y),
    transactions: ownerTxns(y).map((t) => ({ date: t.date, desc: t.memo ? `${t.desc} · ${t.memo}` : t.desc, amount: t.amount })),
  };
}

export function corpInput(y = S.year): CorpInput {
  const P = pl(yearTxns(y)),
    advertising = -(P.lines.expense.find((l) => l.key === "expense:advertising")?.value ?? 0);
  return {
    ...irsInput(y),
    revenue: P.revenue,
    cogs: P.cogs,
    advertising,
    otherDeductions: P.opex - advertising,
    otherIncome: P.other,
    corpRate: taxTable(y, "us").corpRate ?? 0.21,
  };
}
