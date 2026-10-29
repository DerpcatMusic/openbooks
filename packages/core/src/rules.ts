// Categorization rules, "If … Then …": a rule holds when ALL its conditions do. Rules are ordered; the first matching rule that has an
// account sets the ledger account, and the tags of every matching rule are added. A legacy [match text, account] tuple is one "text"
// condition (case-sensitive substring of "desc memo [mcat]"), so books written before rule objects behave exactly as before.
import type { LegacyRule, Rule, RuleCondition, RuleInput } from "@openbooks/schema";
import { accountProblem, type Coa } from "./coa.ts";
import { payerOf } from "./reports.ts";

/** What a "text" condition sees (same string in books.py, web and here). */
export const haystack = (t: { desc: string; memo?: string; mcat?: string }) => `${t.desc} ${t.memo ?? ""} [${t.mcat ?? ""}]`;

/** The fields of a transaction a rule can read. */
export interface RuleRow {
  desc: string;
  memo?: string | undefined;
  mcat?: string | undefined;
  who?: string | undefined;
  source: string;
  account: string;
  amount: number;
}

/** A rule that matches nothing (stands in for a rule that cleanRule dropped). */
export const NO_RULE: Rule = { when: [], then: {} };

export const isLegacy = (r: RuleInput): r is LegacyRule => Array.isArray(r);
/** Legacy tuples become one "text" condition; rule objects pass through. This is the only place the two shapes meet. */
export const normalizeRule = (r: RuleInput): Rule =>
  isLegacy(r) ? { when: [{ field: "text", op: "contains", value: r[0] }], then: { account: r[1].trim() } } : r;

const cents = (n: number) => Math.round(n * 100);
type TextCondition = Extract<RuleCondition, { value: string }>;
const isText = (c: RuleCondition): c is TextCondition => typeof (c as TextCondition).value === "string";
/** Blank text or a number that is not finite (an empty amount box): the condition can't be saved and never holds. */
const unusable = (c: RuleCondition) => (isText(c) ? !c.value.trim() : "value" in c && !Number.isFinite(c.value)) || ("to" in c && !Number.isFinite(c.to));

/** Does one condition hold? Description and counterparty ignore case; "text" and bank account are exact. Blank text or a missing number never matches. */
export function holds(c: RuleCondition, t: RuleRow): boolean {
  if (unusable(c)) return false;
  switch (c.field) {
    case "text":
      return haystack(t).includes(c.value);
    case "description": {
      const d = t.desc.toLowerCase(),
        v = c.value.trim().toLowerCase();
      return c.op === "equals" ? d === v : c.op === "startsWith" ? d.startsWith(v) : d.includes(v);
    }
    case "counterparty":
      return payerOf(t).toLowerCase().includes(c.value.trim().toLowerCase());
    case "account":
      return t.account === c.value.trim();
    case "direction":
      return c.op === "in" ? t.amount > 0 : t.amount < 0;
    case "amount": {
      const a = cents(Math.abs(t.amount));
      if (c.op === "between") return a >= cents(c.value) && a <= cents(c.to);
      return c.op === "eq" ? a === cents(c.value) : c.op === "gte" ? a >= cents(c.value) : a <= cents(c.value);
    }
  }
}

/** All conditions hold (a rule with none matches nothing). */
export const matches = (r: Rule, t: RuleRow) => r.when.length > 0 && r.when.every((c) => holds(c, t));

const condLabel = (c: RuleCondition) =>
  c.field === "text"
    ? c.value
    : c.field === "direction"
      ? `direction ${c.op}`
      : c.op === "between"
        ? `amount ${c.value}–${c.to}`
        : `${c.field} ${c.op} ${c.value}`;
/** The rule in words, for a transaction's `why`. A legacy rule's label is its own match text. */
export const ruleLabel = (r: Rule) => r.when.map(condLabel).join(" · ");
/** The match text of a rule that is just one "text" condition (what a quick "create rule" makes), else undefined. */
export const textOf = (r: Rule) => (r.when.length === 1 && r.when[0]!.field === "text" ? r.when[0]!.value : undefined);

/**
 * Why a rule can't be used, or undefined: its ledger account is archived in the chart ("archived"), or is not a ledger account at all
 * ("missing": "ask", or of no known type). A rule that only adds tags is never invalid. Invalid rules are kept and shown, but the
 * engine skips them, so they neither set an account nor add tags until the account is restored or the rule is fixed.
 */
export function ruleProblem(r: Rule, coa?: Coa): "archived" | "missing" | undefined {
  return r.then.account?.trim() ? accountProblem(r.then.account, coa) : undefined;
}

/** The ledger's answer for one transaction: the first matching rule that has an account sets it (`why` = that rule); tags from all matches. Invalid rules (ruleProblem) are skipped. */
export function applyRules(rules: readonly Rule[], t: RuleRow, coa?: Coa): { account: string | undefined; why: string; tags: string[] } {
  let account: string | undefined,
    why = "";
  const tags = new Set<string>();
  for (const r of rules) {
    if (!matches(r, t) || ruleProblem(r, coa)) continue;
    if (account === undefined && r.then.account) [account, why] = [r.then.account.trim(), ruleLabel(r)];
    for (const g of r.then.tags ?? []) tags.add(g);
  }
  return { account, why, tags: [...tags] };
}

/**
 * write_rules() for one rule: commas become spaces in legacy match text (rules.csv heritage), text trimmed; undefined when the rule is
 * unusable (blank text or account, no condition, nothing to do). Rule objects keep their shape; only usable fields are written.
 */
export function cleanRule(r: RuleInput): RuleInput | undefined {
  if (isLegacy(r)) {
    const [m, c] = [r[0].replaceAll(",", " ").trim(), r[1].trim()];
    return m && c ? ([m, c] as const) : undefined;
  }
  const when = r.when.map((c): RuleCondition => (isText(c) ? { ...c, value: (c.field === "text" ? c.value.replaceAll(",", " ") : c.value).trim() } : c));
  const account = r.then.account?.trim(),
    tags = [...new Set((r.then.tags ?? []).filter(Boolean))];
  if (!when.length || when.some(unusable) || !(account || tags.length)) return undefined;
  return { when, then: { ...(account ? { account } : {}), ...(tags.length ? { tags } : {}) } };
}
// map + filter, not flatMap: flatMap would flatten a legacy [match, account] tuple into two strings
export const cleanRules = (rs: readonly RuleInput[]): RuleInput[] => rs.map(cleanRule).filter((r): r is RuleInput => r !== undefined);
