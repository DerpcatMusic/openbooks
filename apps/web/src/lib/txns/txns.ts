// Pure helpers for the transactions, review and rules screens (no Svelte, no store): filter links, rule previews, CSV.
import { cleanRule, haystack, matches, NO_RULE, normalizeRule } from "@openbooks/core";
import type { RuleInput, Txn } from "@openbooks/schema";

export type Tab = "all" | "in" | "out" | "ask";
export interface Filter {
  tab: Tab;
  /** a ledger account, or "type:<group>" for a whole account type */
  cat: string;
  acct: string;
  /** "YYYY-MM" or "" for the whole period */
  month: string;
  /** a tag id, or "" for all */
  tag: string;
}
export const NO_FILTER: Filter = { tab: "all", cat: "", acct: "", month: "", tag: "" };

/**
 * /transactions/<arg> (the old #/transactions/<arg> links): ask | month:2026-04 | cat:expense:software | type:own | account:Mercury Credit | tag:<id>.
 * Anything else is no filter.
 */
export function parseArg(a: string): Filter {
  const f = { ...NO_FILTER };
  if (a === "ask") f.tab = "ask";
  else if (a.startsWith("month:")) f.month = a.slice(6);
  else if (a.startsWith("cat:")) f.cat = a.slice(4);
  else if (a.startsWith("type:")) f.cat = a;
  else if (a.startsWith("account:")) f.acct = a.slice(8);
  else if (a.startsWith("tag:")) f.tag = a.slice(4);
  return f;
}

export const inTab = (t: Pick<Txn, "amount" | "category">, tab: Tab) =>
  tab === "all" || (tab === "in" && t.amount > 0) || (tab === "out" && t.amount < 0) || (tab === "ask" && t.category === "ask");

export const inCat = (t: Pick<Txn, "category">, cat: string) =>
  !cat || (cat.startsWith("type:") ? (t.category || "ask").split(":")[0] === cat.slice(5) : t.category === cat);

export const inTag = (t: Pick<Txn, "tags">, tag: string) => !tag || !!t.tags?.includes(tag);

/** Lowercased search text of a row: description, memo, [Mercury category], bit name, ledger label, amount. */
export const searchText = (t: Txn, label: string) => `${haystack(t)} ${t.who ?? ""} ${label} ${t.amount}`.toLowerCase();

export interface RuleHit {
  n: number;
  sum: number;
  ids: string[];
}
/**
 * What each rule catches, in the ledger's order: a transaction's account goes to the first matching rule that sets one; rules that
 * only add tags count every match. Manual rows keep their account (only tag rules count them); journal rows are left out. `none`
 * lists the other rows no rule matches. Legacy match text is cleaned the way the server will store it, unusable rules match nothing.
 */
export function ruleHits(rules: readonly RuleInput[], txns: readonly Txn[]): { h: RuleHit[]; none: string[] } {
  const rs = rules.map((r) => normalizeRule(cleanRule(r) ?? NO_RULE));
  const h = rs.map(() => ({ n: 0, sum: 0, ids: [] as string[] }));
  const none: string[] = [];
  for (const t of txns) {
    if (t.why === "journal" || t.source === "journal") continue;
    const manual = t.why === "manual";
    let taken = false,
      any = false;
    for (const [i, r] of rs.entries()) {
      if (!matches(r, t)) continue;
      any = true;
      if (r.then.account) {
        if (manual || taken) continue;
        taken = true;
      }
      const hit = h[i]!;
      hit.n++;
      hit.sum += t.amount;
      hit.ids.push(t.id);
    }
    if (!any && !manual) none.push(t.id);
  }
  return { h, none };
}

const cell = (v: string | number | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
/** Transactions export (header stays English, like the old app). */
export const toCsv = (rows: readonly Txn[], label: (c: string) => string) =>
  "Date,Account,Ledger account,Description,Amount\n" + rows.map((t) => [t.date, t.account, label(t.category), t.desc, t.amount].map(cell).join(",")).join("\n");

/** Shift-click range: ids between the last clicked row and this one (inclusive), in list order. */
export function range(ids: readonly string[], from: string | null, to: string): string[] {
  const i = from === null ? -1 : ids.indexOf(from),
    j = ids.indexOf(to);
  if (i < 0 || j < 0) return [to];
  return ids.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Slug for a new ledger account name: "Studio rent" → "studio-rent" (letters in any script kept). */
export const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
