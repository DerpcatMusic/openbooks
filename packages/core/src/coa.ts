// Chart of accounts. A ledger account is "type:slug": that id is the key on transactions and rules and is never renamed. The books keep an
// overlay (doc "coa") of per-account { code, name, subtype, archived } over the derived set (country pack + accounts in use + accounts the
// user added). Bank and card accounts are chart rows too (assets / liabilities), keyed by their account name. Pure: no labels here.
import { group, isCard, TYPES } from "./reports.ts";

export interface CoaEntry {
  code?: number;
  name?: string;
  subtype?: string;
  /** Hidden from account pickers; transactions keep it and every report still shows it. */
  archived?: boolean;
  /** Default deduction rule id (Taxximizer) for expenses on this account; a tag's rule wins. */
  taxRule?: string;
}
export type Coa = Readonly<Record<string, CoaEntry>>;
export type Klass = "asset" | "liability" | "equity" | "revenue" | "expense" | "other";
export type Side = "debit" | "credit";

/** Account type → [class, normal side, default code block]. "bank" / "card" are the statement accounts; unknown types count as "other". */
const KIND: Readonly<Record<string, readonly [Klass, Side | null, number]>> = {
  bank: ["asset", "debit", 1],
  card: ["liability", "credit", 2],
  equity: ["equity", "credit", 3],
  revenue: ["revenue", "credit", 4],
  business: ["revenue", "credit", 4],
  cogs: ["expense", "debit", 5],
  expense: ["expense", "debit", 6],
  "other-income": ["revenue", "credit", 7],
  capital: ["revenue", "credit", 8],
};
const OTHER = ["other", null, 8] as const; // exempt, transfer, personal, own, anything unknown
const kindOf = (type: string) => KIND[type] ?? OTHER;

export interface CoaRow {
  /** "type:slug" for ledger accounts, the account name for bank and card accounts. */
  id: string;
  /** "bank" | "card" | the ledger type ("expense", "business", …). */
  type: string;
  klass: Klass;
  side: Side | null;
  code: number;
  /** The user's overrides; callers fall back to the built-in name / type label. */
  name?: string;
  subtype?: string;
  archived: boolean;
}

const stored = (e: CoaEntry | undefined) => (e && Number.isInteger(e.code) && e.code! > 0 ? e.code : undefined);

/**
 * Every account with its code, sorted by code. `ledger` must be in a stable order (pack chart, then first use, then added): a default
 * code is its block (1 assets … 8 other: ×10000) plus the account's place in its block, moving up past codes already taken.
 * ponytail: a default follows first use; set a code on an account to pin it.
 */
export function chartOfAccounts(ledger: readonly string[], banks: readonly string[], coa: Coa): CoaRow[] {
  const taken = new Set(Object.values(coa).flatMap((e) => stored(e) ?? []));
  const seen: Record<number, number> = {};
  const rows = [...banks.map((id) => [id, isCard(id) ? "card" : "bank"] as const), ...ledger.map((id) => [id, group(id)] as const)].map(([id, type]) => {
    const [klass, side, block] = kindOf(type),
      e = coa[id];
    const place = (seen[block] = (seen[block] ?? 0) + 1); // pinned accounts hold their place, so pinning one never renumbers the rest
    let code = stored(e);
    if (!code) {
      code = block * 10000 + place;
      while (taken.has(code)) code++;
      taken.add(code);
    }
    return { id, type, klass, side, code, ...(e?.name ? { name: e.name } : {}), ...(e?.subtype ? { subtype: e.subtype } : {}), archived: !!e?.archived };
  });
  return rows.sort((a, b) => a.code - b.code);
}

/** The code a new account of `type` would get. */
export const nextCode = (ledger: readonly string[], banks: readonly string[], coa: Coa, type: string) =>
  chartOfAccounts([...ledger, `${type}:`], banks, coa).find((r) => r.id === `${type}:`)!.code;

/**
 * Why a ledger account can't take new postings (rules, splits, journal lines): "missing" = "ask", blank, or of no known type;
 * "archived" = hidden in the chart. undefined = fine. Existing rows on an archived account stay (and every report still shows them).
 */
export function accountProblem(account: string | undefined, coa?: Coa): "archived" | "missing" | undefined {
  const a = (account ?? "").trim();
  if (!a || a === "ask" || !a.includes(":") || !Object.hasOwn(TYPES, group(a))) return "missing";
  return coa?.[a]?.archived ? "archived" : undefined;
}
