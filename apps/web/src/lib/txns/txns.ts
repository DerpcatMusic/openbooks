// Pure helpers for the transactions, review and rules screens (no Svelte, no store): filter links, rule previews, CSV.
import { haystack } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";

export type Tab = "all" | "in" | "out" | "ask";
export interface Filter {
  tab: Tab;
  /** a ledger account, or "type:<group>" for a whole account type */
  cat: string;
  acct: string;
  /** "YYYY-MM" or "" for the whole period */
  month: string;
}
export const NO_FILTER: Filter = { tab: "all", cat: "", acct: "", month: "" };

/**
 * /transactions/<arg> (the old #/transactions/<arg> links): ask | month:2026-04 | cat:expense:software | type:own | account:Mercury Credit.
 * Anything else is no filter.
 */
export function parseArg(a: string): Filter {
  const f = { ...NO_FILTER };
  if (a === "ask") f.tab = "ask";
  else if (a.startsWith("month:")) f.month = a.slice(6);
  else if (a.startsWith("cat:")) f.cat = a.slice(4);
  else if (a.startsWith("type:")) f.cat = a;
  else if (a.startsWith("account:")) f.acct = a.slice(8);
  return f;
}

export const inTab = (t: Pick<Txn, "amount" | "category">, tab: Tab) =>
  tab === "all" || (tab === "in" && t.amount > 0) || (tab === "out" && t.amount < 0) || (tab === "ask" && t.category === "ask");

export const inCat = (t: Pick<Txn, "category">, cat: string) =>
  !cat || (cat.startsWith("type:") ? (t.category || "ask").split(":")[0] === cat.slice(5) : t.category === cat);

/** Lowercased search text of a row: description, memo, [Mercury category], bit name, ledger label, amount. */
export const searchText = (t: Txn, label: string) => `${haystack(t)} ${t.who ?? ""} ${label} ${t.amount}`.toLowerCase();

export interface RuleHit {
  n: number;
  sum: number;
  ids: string[];
}
/**
 * Which rule each transaction would land on (first match wins, like the ledger). Manual and journal rows are left out:
 * rules don't touch them. `none` lists the rows no rule matches.
 */
export function ruleHits(rules: readonly { m: string }[], txns: readonly Txn[]): { h: RuleHit[]; none: string[] } {
  const h = rules.map(() => ({ n: 0, sum: 0, ids: [] as string[] }));
  const ms = rules.map((r) => r.m.replaceAll(",", " ").trim()); // as the server will store them (core.cleanRules)
  const none: string[] = [];
  for (const t of txns) {
    if (t.why === "manual" || t.why === "journal" || t.source === "journal") continue;
    const hay = haystack(t),
      i = ms.findIndex((m) => m && hay.includes(m));
    const hit = h[i];
    if (!hit) none.push(t.id);
    else {
      hit.n++;
      hit.sum += t.amount;
      hit.ids.push(t.id);
    }
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
