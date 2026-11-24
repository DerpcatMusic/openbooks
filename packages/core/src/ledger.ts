// The ledger (books.py ledger()): every stored transaction gets a ledger account — a split's lines, else manual override, else the first
// matching rule that sets one (rules.ts), else "ask" — plus its tags (by hand and from every matching rule, one per tag group); journal
// entries become ledger rows on the "Journal" account.
import type { JournalEntry, RuleInput, SplitsDoc, StoredTxn, TagsDoc, Txn } from "@openbooks/schema";
import type { Coa } from "./coa.ts";
import { pyRound } from "./py.ts";
import { applyRules, cleanRules, normalizeRule } from "./rules.ts";
import { daysBetween } from "./accrual.ts";
import { isCard } from "./reports.ts";
import { groupMap, pickByGroup } from "./tags.ts";
import { splitId, splitOf } from "./splits.ts";

/**
 * Unambiguous bank-reported internal card payoffs and internal account transfers (e.g. Mercury Checking paying off
 * Mercury Credit). Classified automatically as `transfer:internal` when no manual override or user rule applies,
 * preventing credit-card payments from ever duplicating card expenses or cluttering the uncategorized queue.
 */
export function isAutoCardPayoff(t: Pick<StoredTxn, "source" | "account" | "amount" | "desc" | "memo" | "kind">): boolean {
  if (t.source !== "mercury") return false;
  if (t.kind === "creditCardPayment" || t.kind === "internalTransfer") return true;
  const text = `${t.desc ?? ""} ${t.memo ?? ""}`;
  if (isCard(t.account) && t.amount > 0 && /\b(credit card payment|autopay|payment thank you|mercury checking)\b/i.test(text)) return true;
  if (!isCard(t.account) && t.amount < 0 && /\b(mercury credit|credit card payment)\b/i.test(text)) return true;
  return false;
}

/**
 * Israeli card issuers: how each names itself on a bank statement line, and how its scraped card account is named. A bank debit to an
 * issuer whose card account is in the same books is the card bill being paid: the card's own charges are the spending.
 */
const ISSUERS: readonly { bank: RegExp; card: RegExp }[] = [
  { bank: /מקס איט|\bmax it\b|לאומי ?קארד|leumi ?card/i, card: /^max\b|leumi ?card/i },
  { bank: /ישראכרט|isracard/i, card: /isracard/i },
  { bank: /אמריקן אקספרס|american express|\bamex\b/i, card: /amex|american express/i },
  { bank: /כרטיסי אשראי לישראל|(^|[\s-])כ\.?א\.?ל([\s-]|$)|visa ?cal|\bcal\b/i, card: /visa ?cal|^cal\b/i },
  { bank: /דיינרס|diners/i, card: /diners/i },
];
/** Card bills paid from a bank account in these books whose card account is also here (see ISSUERS). */
export function isCardBill(t: Pick<StoredTxn, "account" | "amount" | "desc" | "memo">, cardAccounts: readonly string[]): boolean {
  if (t.amount >= 0 || isCard(t.account) || !cardAccounts.length) return false;
  const text = `${t.desc ?? ""} ${t.memo ?? ""}`;
  return ISSUERS.some((i) => i.bank.test(text) && cardAccounts.some((a) => i.card.test(a)));
}

/** What else shapes the ledger. All optional: without them the ledger is the plain one. */
export interface LedgerExtras {
  /** doc "splits": a split transaction becomes one row per line (why "split"), ignoring overrides and rules for its account. */
  splits?: SplitsDoc | undefined;
  /** doc "coa": rules whose account is archived are skipped. */
  coa?: Coa | undefined;
  /** The books' entries start date: stored transactions and journal entries dated before it are left out. */
  from?: string | null | undefined;
  /** doc "transfers": a rejected pair is never filed as a transfer automatically. */
  transfers?: { rejected?: readonly { out: string; in: string }[] } | undefined;
  /** The close date: rows on or before it keep the ledger account they had (nothing is filed automatically there). */
  close?: string | null | undefined;
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
  const cards = [...new Set(stored.filter((t) => isCard(t.account)).map((t) => t.account))];
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
        out.push({
          ...bare,
          id: splitId(t.id, i),
          amount: l.amount,
          category: l.account,
          why: "split",
          ...(l.memo ? { memo: l.memo } : {}),
          ...(own.length ? { tags: own } : {}),
        });
      });
      continue;
    }
    const manual = overrides[t.id];
    if (manual !== undefined) out.push({ ...row, category: manual, why: "manual" });
    else if (hit.account) out.push({ ...row, category: hit.account, why: hit.why });
    else if (isAutoCardPayoff(t) || isCardBill(t, cards)) out.push({ ...row, category: "transfer:internal", why: "auto-transfer" });
    else out.push({ ...row, category: "ask", why: "" });
  }
  autoPairs(out, extra);
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

/**
 * Money that left one of these books' accounts and arrived in another of them, both still uncategorized: same currency, the same amount
 * to the cent, at most 4 days apart, nearest first, each row once. That's a move between your own accounts, never income or spending,
 * so it's filed as transfer:internal (why "auto-transfer"), unless the pair was rejected or sits on or before the close date.
 * ponytail: exact amounts only; a fee-sized difference within one business stays for the Transfers review.
 */
function autoPairs(rows: Txn[], extra: LedgerExtras) {
  // a rejected pair is stored as "entity/id": within one entity's books the ids alone tell the pair
  const id = (ref: string) => ref.slice(ref.indexOf("/") + 1);
  const close = extra.close || "",
    no = new Set((extra.transfers?.rejected ?? []).map((p) => `${id(p.out)}|${id(p.in)}`));
  const open = rows.filter((r) => r.category === "ask" && r.date > close && r.amount !== 0);
  const ins = open.filter((r) => r.amount > 0),
    used = new Set<string>();
  const pairs: [Txn, Txn, number][] = [];
  for (const o of open)
    if (o.amount < 0)
      for (const i of ins) {
        const gap = Math.abs(daysBetween(o.date, i.date));
        if (gap > 4 || o.account === i.account || (o.currency ?? "") !== (i.currency ?? "") || Math.abs(o.amount + i.amount) > 0.005) continue;
        pairs.push([o, i, gap]);
      }
  pairs.sort((a, b) => a[2] - b[2] || a[0].date.localeCompare(b[0].date) || a[0].id.localeCompare(b[0].id));
  for (const [o, i] of pairs) {
    if (used.has(o.id) || used.has(i.id) || no.has(`${o.id}|${i.id}`)) continue;
    used.add(o.id).add(i.id);
  }
  for (const r of rows) if (used.has(r.id)) Object.assign(r, { category: "transfer:internal", why: "auto-transfer" });
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
