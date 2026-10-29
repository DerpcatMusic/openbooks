// The ledger (books.py ledger()): every stored transaction gets a ledger account — manual override, else the first matching rule
// that sets one (rules.ts), else "ask" — plus its tags (by hand and from every matching rule); journal entries become ledger rows on the
// "Journal" account.
import type { JournalEntry, RuleInput, StoredTxn, TagsDoc, Txn } from "@openbooks/schema";
import { pyRound } from "./py.ts";
import { applyRules, cleanRules, normalizeRule } from "./rules.ts";

/** stored: txn.data rows in `order by date, rowid` order. Returns rows sorted by date (stable), journal lines included. */
export function ledger(
  stored: readonly StoredTxn[],
  overrides: Readonly<Record<string, string>>,
  rules: readonly RuleInput[],
  journal: readonly JournalEntry[] = [],
  tags?: TagsDoc,
): Txn[] {
  const rs = rules.map(normalizeRule),
    known = new Set(tags?.tags.map((g) => g.id)); // tag ids of deleted tags fall away here
  const out: Txn[] = stored.map((t) => {
    const hit = applyRules(rs, t),
      mine = [...new Set([...(tags?.on[t.id] ?? []), ...hit.tags])].filter((g) => known.has(g)),
      row = mine.length ? { ...t, tags: mine } : t;
    const manual = overrides[t.id];
    if (manual !== undefined) return { ...row, category: manual, why: "manual" };
    return hit.account ? { ...row, category: hit.account, why: hit.why } : { ...row, category: "ask", why: "" };
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
export function classify(ids: readonly string[], category: string, rules: readonly RuleInput[], overrides: Readonly<Record<string, string>>, rule?: string) {
  const ov = { ...overrides };
  if (rule) {
    for (const i of ids) delete ov[i];
    return { rules: cleanRules([[rule, category], ...rules]), overrides: ov };
  }
  for (const i of ids) ov[i] = category;
  return { rules: [...rules], overrides: ov };
}
