// The ledger (books.py ledger()): every stored transaction gets a ledger account — a split's lines, else manual override, else the first
// matching rule that sets one (rules.ts), else "ask" — plus its tags (by hand and from every matching rule, one per tag group); journal
// entries become ledger rows on the "Journal" account.
import type { JournalEntry, RuleInput, SplitsDoc, StoredTxn, TagsDoc, Txn } from "@openbooks/schema";
import type { Coa } from "./coa.ts";
import { pyRound } from "./py.ts";
import { applyRules, cleanRules, normalizeRule } from "./rules.ts";
import { groupMap, pickByGroup } from "./tags.ts";
import { splitId, splitOf } from "./splits.ts";

/** What else shapes the ledger. All optional: without them the ledger is the plain one. */
export interface LedgerExtras {
  /** doc "splits": a split transaction becomes one row per line (why "split"), ignoring overrides and rules for its account. */
  splits?: SplitsDoc | undefined;
  /** doc "coa": rules whose account is archived are skipped. */
  coa?: Coa | undefined;
  /** The books' entries start date: stored transactions and journal entries dated before it are left out. */
  from?: string | null | undefined;
}

/** stored: txn.data rows in `order by date, rowid` order. Returns rows sorted by date (stable), journal lines included. */
export function ledger(
  stored: readonly StoredTxn[],
  overrides: Readonly<Record<string, string>>,
  rules: readonly RuleInput[],
  journal: readonly JournalEntry[] = [],
  tags?: TagsDoc,
  extra: LedgerExtras = {},
): Txn[] {
  const rs = rules.map(normalizeRule),
    known = new Set(tags?.tags.map((g) => g.id)), // tag ids of deleted tags fall away here
    groups = groupMap(tags),
    from = extra.from || "";
  /** By hand wins over rules (the earliest rule over a later one), a split line's own tags over both; one tag per group. */
  const tagsOf = (hand: readonly string[], viaRules: readonly string[], line: readonly string[] = []) => {
    if (!hand.length && !viaRules.length && !line.length) return [];
    const keep = pickByGroup(groups, [...line.toReversed(), ...hand.toReversed(), ...viaRules]);
    return [...new Set([...hand, ...viaRules, ...line])].filter((g) => known.has(g) && keep.has(g));
  };
  const out: Txn[] = [];
  for (const t of stored) {
    if (t.date < from) continue;
    const hit = applyRules(rs, t, extra.coa),
      mine = tagsOf(tags?.on[t.id] ?? [], hit.tags),
      row = mine.length ? { ...t, tags: mine } : t;
    const lines = splitOf(extra.splits, t.id, t.amount);
    if (lines) {
      lines.forEach((l, i) => {
        const own = tagsOf(tags?.on[t.id] ?? [], hit.tags, l.tags),
          { tags: _drop, ...bare } = { ...row, tags: undefined };
        out.push({ ...bare, id: splitId(t.id, i), amount: l.amount, category: l.account, why: "split", ...(l.memo ? { memo: l.memo } : {}), ...(own.length ? { tags: own } : {}) });
      });
      continue;
    }
    const manual = overrides[t.id];
    if (manual !== undefined) out.push({ ...row, category: manual, why: "manual" });
    else out.push(hit.account ? { ...row, category: hit.account, why: hit.why } : { ...row, category: "ask", why: "" });
  }
  for (const je of journal) {
    if (je.date < from) continue;
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
  }
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
