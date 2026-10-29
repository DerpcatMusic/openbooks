// Split transactions (doc "splits" = { txnId: [{ account, amount, memo?, tags? }] }): one bank transaction allocated to several
// ledger accounts. Amounts are signed like the transaction and must add up to it to the cent. The ledger (ledger.ts) emits one row per
// line, id `${txnId}~${i}`, so reports, tags and deductions follow with no further code. Pure.
import type { SplitLine, SplitsDoc } from "@openbooks/schema";

export const SPLIT_SEP = "~";
/** The stored transaction a ledger row belongs to: "abc~1" → "abc"; any other id is its own. */
export const baseId = (id: string) => id.split(SPLIT_SEP, 1)[0]!;
export const splitId = (id: string, i: number) => `${id}${SPLIT_SEP}${i}`;
/** Is this ledger row one line of a split? */
export const isSplitRow = (id: string) => id.includes(SPLIT_SEP);

const cents = (n: number) => Math.round(n * 100);
/** What is left of the transaction after these lines, in cents' worth of money (0 = exact). */
export const remaining = (amount: number, lines: readonly Pick<SplitLine, "amount">[]) =>
  (cents(amount) - lines.reduce((a, l) => a + (Number.isFinite(l.amount) ? cents(l.amount) : 0), 0)) / 100;

export type SplitProblem = "lines" | "amount" | "account" | "sum";
/**
 * Why these lines can't split a transaction of `amount`, or null: fewer than two lines, a line without an amount (zero cents or not a
 * number), a line without a usable ledger account ("ask" is not one), or lines that do not add up to the amount exactly in cents.
 * `usable` lets the caller refuse accounts it knows are archived.
 */
export function splitProblem(amount: number, lines: readonly SplitLine[], usable: (account: string) => boolean = () => true): SplitProblem | null {
  if (lines.length < 2) return "lines";
  if (lines.some((l) => !Number.isFinite(l.amount) || cents(l.amount) === 0)) return "amount";
  if (lines.some((l) => !l.account.trim() || l.account === "ask" || !usable(l.account.trim()))) return "account";
  return remaining(amount, lines) === 0 ? null : "sum";
}

/** `n` equal lines of `amount`: the cents that don't divide go one each to the first lines, so the lines always add up exactly. */
export function evenAmounts(amount: number, n: number): number[] {
  const total = cents(amount),
    sign = total < 0 ? -1 : 1,
    abs = Math.abs(total),
    base = Math.floor(abs / n),
    extra = abs - base * n;
  return Array.from({ length: n }, (_, i) => (sign * (base + (i < extra ? 1 : 0))) / 100);
}

/** Lines as stored: trimmed account, cleaned memo, no empty tag lists, amounts rounded to the cent. */
export const cleanSplit = (lines: readonly SplitLine[]): SplitLine[] =>
  lines.map((l) => {
    const memo = l.memo?.trim(),
      tags = [...new Set((l.tags ?? []).filter(Boolean))];
    return { account: l.account.trim(), amount: cents(l.amount) / 100, ...(memo ? { memo } : {}), ...(tags.length ? { tags } : {}) };
  });

/** The lines of a transaction if its stored split still adds up to it (a re-import with a different amount silently drops the split). */
export const splitOf = (doc: SplitsDoc | undefined, id: string, amount: number): readonly SplitLine[] | undefined => {
  const lines = doc?.[id];
  return lines && splitProblem(amount, lines) === null ? lines : undefined;
};
