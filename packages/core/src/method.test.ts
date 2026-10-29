import { describe, expect, it } from "vite-plus/test";
import type { Txn } from "@openbooks/schema";
import { methodOf, suggest, suggestedIds } from "./index.ts";

const t = (id: string, over: Partial<Txn> = {}): Txn => ({ id, date: "2026-01-02", amount: -10, desc: "Shop", source: "bank", account: "Main", file: "", page: 0, category: "ask", why: "", ...over });

describe("methodOf", () => {
  it("uncategorized beats everything; journal, split, manual and rule are read off why", () => {
    expect(methodOf(t("a"))).toBe("uncategorized");
    expect(methodOf(t("a", { category: "expense:x", why: "manual" }))).toBe("manual");
    expect(methodOf(t("a", { category: "expense:x", why: "aws" }))).toBe("rule");
    expect(methodOf(t("a", { category: "expense:x", why: "description contains aws · amount 1–5" }))).toBe("rule");
    expect(methodOf(t("a", { category: "expense:x", why: "split" }))).toBe("split");
    expect(methodOf(t("a", { category: "expense:x", why: "journal", source: "journal" }))).toBe("journal");
    expect(methodOf(t("a", { category: "ask", why: "manual" }))).toBe("uncategorized"); // an override back to "ask" is still uncategorized
  });
});

describe("suggestedIds is suggest()'s non-empty answer, in one pass", () => {
  it("agrees with suggest on a mixed set (same counterparty, shared words, Mercury category, wrong-direction accounts)", () => {
    const all: Txn[] = [
      t("c1", { desc: "Cloud Hosting Inc", category: "cogs:hosting", why: "x", amount: -50 }),
      t("c2", { desc: "Stripe payout invoice", category: "revenue:services", why: "x", amount: 90 }),
      t("c3", { desc: "Office coffee beans", category: "expense:meals", why: "manual", amount: -9 }),
      t("a1", { desc: "Cloud Hosting Inc", amount: -55 }), // same counterparty
      t("a2", { desc: "Hosting bill March", amount: -12 }), // shared word "hosting"
      t("a3", { desc: "Stripe payout invoice", amount: -4 }), // would suggest revenue, but money out: filtered
      t("a4", { desc: "Zzz Qqq", amount: -1 }), // nothing
      t("a5", { desc: "Zzz Qqq", amount: -1, mcat: "Software" }), // Mercury category hint
      t("a6", { desc: "Coffee machine", amount: 3 }), // shared word, but expense account for money in: filtered
      t("a7", { desc: "Invoice 5", amount: 70 }), // shared word "invoice" with a revenue row, money in
    ];
    const rows = all.filter((x) => x.category === "ask");
    const fast = suggestedIds(rows, all);
    for (const r of rows) expect(fast.has(r.id), r.id).toBe(suggest([r], all).length > 0);
    expect([...fast].sort()).toEqual(["a1", "a2", "a5", "a7"]);
  });
  it("only uncategorized rows can be suggested", () => {
    const all = [t("c1", { desc: "Hosting", category: "cogs:hosting", why: "x" })];
    expect(suggestedIds(all, all).size).toBe(0);
  });
});
