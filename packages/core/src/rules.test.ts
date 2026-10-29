import { describe, expect, it } from "vite-plus/test";
import type { Rule, RuleInput, StoredTxn, TagsDoc } from "@openbooks/schema";
import { applyRules, classify, cleanRule, cleanRules, ledger, matches, normalizeRule, ruleLabel, textOf, type RuleRow } from "./index.ts";

const row = (id: string, amount: number, desc: string, extra: Partial<StoredTxn> = {}): StoredTxn => ({
  id,
  date: "2025-01-01",
  amount,
  desc,
  source: "bank",
  account: "One Zero",
  file: "a.pdf",
  page: 1,
  ...extra,
});
const R = (when: Rule["when"], then: Rule["then"]): Rule => ({ when, then });

describe("rule conditions", () => {
  const t: RuleRow = { desc: "AWS EMEA Invoice", memo: "May usage", mcat: "Software", source: "mercury", account: "Mercury Checking", amount: -120.5 };
  const m = (when: Rule["when"], x: Partial<RuleRow> = {}) => matches(R(when, { account: "expense:x" }), { ...t, ...x });

  it("description: contains / equals / starts with, ignoring case", () => {
    expect(m([{ field: "description", op: "contains", value: "emea inv" }])).toBe(true);
    expect(m([{ field: "description", op: "equals", value: "aws emea invoice" }])).toBe(true);
    expect(m([{ field: "description", op: "equals", value: "aws" }])).toBe(false);
    expect(m([{ field: "description", op: "startsWith", value: "aws" }])).toBe(true);
    expect(m([{ field: "description", op: "startsWith", value: "emea" }])).toBe(false);
    expect(m([{ field: "description", op: "contains", value: "usage" }])).toBe(false); // the memo is not the description
  });
  it("amount compares the absolute value, to the cent", () => {
    expect(m([{ field: "amount", op: "eq", value: 120.5 }])).toBe(true);
    expect(m([{ field: "amount", op: "gte", value: 120.5 }])).toBe(true);
    expect(m([{ field: "amount", op: "gte", value: 120.51 }])).toBe(false);
    expect(m([{ field: "amount", op: "lte", value: 100 }])).toBe(false);
    expect(m([{ field: "amount", op: "between", value: 100, to: 120.5 }])).toBe(true);
    expect(m([{ field: "amount", op: "between", value: 121, to: 200 }])).toBe(false);
    expect(m([{ field: "amount", op: "eq", value: 10.1 }], { amount: 10.1 + 1e-12 })).toBe(true);
  });
  it("direction, bank account and counterparty", () => {
    expect(m([{ field: "direction", op: "out" }])).toBe(true);
    expect(m([{ field: "direction", op: "in" }])).toBe(false);
    expect(m([{ field: "direction", op: "in" }], { amount: 5 })).toBe(true);
    expect(m([{ field: "account", op: "is", value: "Mercury Checking" }])).toBe(true);
    expect(m([{ field: "account", op: "is", value: "mercury checking" }])).toBe(false);
    expect(m([{ field: "counterparty", op: "contains", value: "aws emea" }])).toBe(true); // Mercury: the counterparty is the description
    expect(m([{ field: "counterparty", op: "contains", value: "dana" }], { source: "bit", who: "Dana K" })).toBe(true);
  });
  it("every condition must hold; none, or blank text, or a missing number, matches nothing", () => {
    const aws = { field: "description", op: "contains", value: "aws" } as const;
    expect(m([aws, { field: "direction", op: "out" }, { field: "amount", op: "gte", value: 100 }])).toBe(true);
    expect(m([aws, { field: "direction", op: "in" }])).toBe(false);
    expect(m([])).toBe(false);
    expect(m([{ field: "description", op: "contains", value: "  " }])).toBe(false);
    expect(m([{ field: "amount", op: "gte", value: Number.NaN }])).toBe(false);
  });
});

describe("legacy [match, account] tuples", () => {
  it("are one case-sensitive text condition over description, memo and [bank category]", () => {
    const r = normalizeRule(["Software]", " expense:software "]);
    expect(r).toEqual({ when: [{ field: "text", op: "contains", value: "Software]" }], then: { account: "expense:software" } });
    const t = { desc: "AWS", memo: "", mcat: "Software", source: "mercury", account: "a", amount: -1 };
    expect(matches(r, t)).toBe(true);
    expect(matches(normalizeRule(["software", "x:y"]), t)).toBe(false);
    expect(matches(normalizeRule(["[Soft", "x:y"]), t)).toBe(true);
  });
  it("ledger: same answers as before (first match wins, why = match text, manual first)", () => {
    const L = ledger(
      [row("a", -1, "PAYPAL *X"), row("b", -2, "stripe payout"), row("c", -3, "PAYPAL STRIPE"), row("d", -4, "nothing")],
      { b: "personal:family" },
      [
        ["PAYPAL", "business:paypal"],
        ["STRIPE", " revenue:stripe "],
        ["stripe", "revenue:lower"],
      ],
    );
    expect(L.map((x) => [x.id, x.category, x.why])).toEqual([
      ["a", "business:paypal", "PAYPAL"],
      ["b", "personal:family", "manual"],
      ["c", "business:paypal", "PAYPAL"],
      ["d", "ask", ""],
    ]);
    expect(L[0]).not.toHaveProperty("tags");
  });
  it("cleanRules keeps tuples as tuples (not flattened) and drops blanks", () => {
    expect(cleanRules([[" a,b ", " c:d "], ["", "c:d"], ["x", " "]])).toEqual([["a b", "c:d"]]);
  });
  it("classify puts a legacy tuple on top of rule objects", () => {
    const obj = R([{ field: "direction", op: "in" }], { tags: ["t"] });
    expect(classify(["a"], "business:client", [obj], {}, "PAY,PAL").rules).toEqual([["PAY PAL", "business:client"], obj]);
  });
});

describe("ordered rules: account, tags, manual overrides", () => {
  const rules: RuleInput[] = [
    R([{ field: "description", op: "contains", value: "aws" }], { tags: ["infra"] }), // tag only: does not take the account
    R([{ field: "description", op: "contains", value: "aws" }, { field: "amount", op: "gte", value: 100 }], { account: "cogs:hosting", tags: ["infra", "big"] }),
    ["AWS", "expense:software"],
    R([{ field: "direction", op: "out" }], { account: "expense:other" }),
  ];
  const tagDoc: TagsDoc = { groups: [], tags: ["infra", "big", "mine"].map((id) => ({ id, name: id })), on: { a: ["mine", "gone"], z: ["mine"] } };

  it("the first matching rule with an account sets it; tags come from every matching rule", () => {
    const rs = rules.map(normalizeRule);
    expect(applyRules(rs, { desc: "aws eu", source: "bank", account: "b", amount: -150 })).toEqual({
      account: "cogs:hosting",
      why: 'description contains aws · amount gte 100',
      tags: ["infra", "big"],
    });
    expect(applyRules(rs, { desc: "aws eu", source: "bank", account: "b", amount: -50 })).toMatchObject({ account: "expense:other", tags: ["infra"] }); // lowercase aws: the legacy rule is exact-case
    expect(applyRules(rs, { desc: "AWS eu", source: "bank", account: "b", amount: -50 })).toMatchObject({ account: "expense:software", why: "AWS" });
    expect(applyRules(rs, { desc: "refund", source: "bank", account: "b", amount: 5 })).toEqual({ account: undefined, why: "", tags: [] });
  });
  it("ledger: tags = by hand + rules, ids of deleted tags dropped, a manual account beats rules but not their tags", () => {
    const L = ledger([row("a", -150, "aws eu"), row("b", -150, "aws eu"), row("c", 5, "gift")], { b: "personal:x" }, rules, [], tagDoc);
    expect(L.map((x) => [x.id, x.category, x.tags])).toEqual([
      ["a", "cogs:hosting", ["mine", "infra", "big"]], // "gone" has no tag any more
      ["b", "personal:x", ["infra", "big"]],
      ["c", "ask", undefined],
    ]);
    expect(ledger([row("a", -150, "aws eu")], {}, rules).at(0)).not.toHaveProperty("tags"); // no tags doc: no tags
  });
  it("labels and text of rules", () => {
    expect(ruleLabel(R([{ field: "direction", op: "in" }, { field: "amount", op: "between", value: 1, to: 2 }, { field: "account", op: "is", value: "X" }], { tags: ["t"] }))).toBe(
      "direction in · amount 1–2 · account is X",
    );
    expect(textOf(normalizeRule(["abc", "a:b"]))).toBe("abc");
    expect(textOf(R([{ field: "description", op: "contains", value: "abc" }], { account: "a:b" }))).toBeUndefined();
  });
});

describe("cleanRule on rule objects", () => {
  const aws = { field: "description", op: "contains", value: " aws " } as const;
  it("trims text and writes only the actions that are set", () => {
    expect(cleanRule(R([aws], { account: " expense:x ", tags: ["a", "a", ""] }))).toEqual({ when: [{ ...aws, value: "aws" }], then: { account: "expense:x", tags: ["a"] } });
    expect(cleanRule(R([aws], { account: "", tags: ["a"] }))).toEqual({ when: [{ ...aws, value: "aws" }], then: { tags: ["a"] } });
  });
  it("legacy text conditions get the rules.csv cleanup (commas become spaces)", () => {
    expect(cleanRule(R([{ field: "text", op: "contains", value: "a,b" }], { account: "x:y" }))).toMatchObject({ when: [{ value: "a b" }] });
  });
  it("drops a rule with no condition, a blank value, a missing number, or nothing to do", () => {
    expect(cleanRule(R([], { account: "x:y" }))).toBeUndefined();
    expect(cleanRule(R([{ field: "description", op: "contains", value: " " }], { account: "x:y" }))).toBeUndefined();
    expect(cleanRule(R([{ field: "amount", op: "between", value: 1, to: Number.NaN }], { account: "x:y" }))).toBeUndefined();
    expect(cleanRule(R([aws], { account: " ", tags: [] }))).toBeUndefined();
  });
});
