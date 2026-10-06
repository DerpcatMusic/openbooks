// The ledger (books.py ledger()): every stored transaction gets a ledger account — manual override, else the first rule whose
// text appears in "desc memo [mcat]", else "ask" — and journal entries become ledger rows on the "Journal" account.
import type { JournalEntry, Rule, StoredTxn, Txn } from "@openbooks/schema";
import { pyRound } from "./py.ts";

/** What a rule sees (same string in books.py, web and here). */
export const haystack = (t: { desc: string; memo?: string; mcat?: string }) => `${t.desc} ${t.memo ?? ""} [${t.mcat ?? ""}]`;

/** stored: txn.data rows in `order by date, rowid` order. Returns rows sorted by date (stable), journal lines included. */
export function ledger(
  stored: readonly StoredTxn[],
  overrides: Readonly<Record<string, string>>,
  rules: readonly Rule[],
  journal: readonly JournalEntry[] = [],
): Txn[] {
  const out: Txn[] = stored.map((t) => {
    const manual = overrides[t.id];
    if (manual !== undefined) return { ...t, category: manual, why: "manual" };
    const hay = haystack(t),
      hit = rules.find(([k]) => hay.includes(k));
    return hit ? { ...t, category: hit[1].trim(), why: hit[0] } : { ...t, category: "ask", why: "" };
  });
  for (const je of journal)
    je.lines.forEach((l, i) =>
      out.push({
        id: `${je.id}-${i}`,
        source: "journal",
        account: "Journal",
        date: je.date,
        amount: pyRound((l.credit ?? 0) - (l.debit ?? 0)),
        desc: je.memo || "Journal entry",
        category: l.account,
        why: "journal",
        file: "",
        page: 0,
      }),
    );
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** classify(): with `rule`, prepend [rule, category] and drop these ids' overrides; else set manual overrides. Returns new state. */
export function classify(ids: readonly string[], category: string, rules: readonly Rule[], overrides: Readonly<Record<string, string>>, rule?: string) {
  const ov = { ...overrides };
  if (rule) {
    for (const i of ids) delete ov[i];
    return { rules: cleanRules([[rule, category], ...rules]), overrides: ov };
  }
  for (const i of ids) ov[i] = category;
  return { rules: [...rules], overrides: ov };
}

/** write_rules(): commas become spaces in the match text (rules.csv heritage), blanks dropped, both sides trimmed. */
export const cleanRules = (rs: readonly Rule[]): Rule[] =>
  rs.filter(([m, c]) => m.trim() && c.trim()).map(([m, c]) => [m.replaceAll(",", " ").trim(), c.trim()] as const);
