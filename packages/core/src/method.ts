// How a ledger row got its account ("categorization method", Mercury Books spec section 2.5) and which uncategorized rows have a
// suggestion. Derived from Txn.why and the category, never stored. Pure.
import type { Txn } from "@openbooks/schema";
import { payerOf, plOf } from "./reports.ts";
import { haystack } from "./rules.ts";

/** How the row got its account. `suggested` is only a filter: an uncategorized row for which `suggest` has a candidate (see suggestedIds). */
export type Method = "uncategorized" | "suggested" | "manual" | "rule" | "split" | "journal";
/** The filter's options, in the order the page offers them. */
export const METHODS: readonly Method[] = ["uncategorized", "suggested", "manual", "rule", "split", "journal"];

/** uncategorized (an "ask" row, takes precedence), else journal, split, manual, or rule (the row's `why` is then the rule's text). */
export function methodOf(t: Pick<Txn, "category" | "why" | "source">): Exclude<Method, "suggested"> {
  if (t.source === "journal" || t.why === "journal") return "journal";
  if (t.category === "ask") return "uncategorized";
  return t.why === "split" ? "split" : t.why === "manual" ? "manual" : "rule";
}

// the same words and Mercury-category hints as suggest() in reports.ts, indexed once instead of re-scanned per row
const MCAT: Readonly<Record<string, string>> = {
  Software: "expense:software",
  Advertising: "expense:advertising",
  Travel: "expense:travel",
  Restaurants: "expense:meals",
  "Food & Dining": "expense:meals",
  Fees: "expense:bank-fees",
  "Office Supplies": "expense:equipment",
  Equipment: "expense:equipment",
  Entertainment: "expense:games",
  Utilities: "expense:phone-internet",
  "Professional Services": "expense:professional",
  Legal: "expense:professional",
};
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4),
  );

/** Ids of the uncategorized rows among `rows` that have at least one suggestion in `all` — the same answer as suggest([row], all).length > 0, in one pass. */
export function suggestedIds(rows: readonly Txn[], all: readonly Txn[]): Set<string> {
  const byPayer = new Map<string, Set<string>>(),
    byWord = new Map<string, Set<string>>();
  const put = (m: Map<string, Set<string>>, k: string, c: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(c);
  for (const x of all) {
    if (x.category === "ask") continue;
    put(byPayer, payerOf(x), x.category);
    for (const w of words(haystack(x))) put(byWord, w, x.category);
  }
  const out = new Set<string>();
  for (const t of rows) {
    if (t.category !== "ask") continue;
    const cats = new Set(byPayer.get(payerOf(t)));
    for (const w of words(haystack(t))) for (const c of byWord.get(w) ?? []) cats.add(c);
    const hint = MCAT[t.mcat ?? ""];
    if (hint) cats.add(hint);
    const bad = t.amount < 0 ? ["revenue", "other"] : t.amount > 0 ? ["cogs", "expense"] : [];
    if ([...cats].some((c) => !bad.includes(plOf(c) ?? ""))) out.add(t.id);
  }
  return out;
}
