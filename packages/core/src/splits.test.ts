// Split transactions: validation to the cent, even rounding, the ledger's one-row-per-line output, and that totals / P&L / tags /
// deductions come out the same as the unsplit transaction (no money appears or vanishes).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import type { DeductionRule, SplitLine, StoredTxn, TagsDoc } from "@openbooks/schema";
import { baseId, balances, cleanSplit, deductions, evenAmounts, isSplitRow, ledger, pl, remaining, splitId, splitOf, splitProblem } from "./index.ts";

const row = (id: string, amount: number, extra: Partial<StoredTxn> = {}): StoredTxn => ({
  id,
  date: "2026-03-10",
  amount,
  desc: "Staples supplies",
  source: "bank",
  account: "Main",
  file: "a.pdf",
  page: 1,
  ...extra,
});
const L = (account: string, amount: number, extra: Partial<SplitLine> = {}): SplitLine => ({ account, amount, ...extra });
const sum = (xs: readonly { amount: number }[]) => Math.round(xs.reduce((a, x) => a + x.amount, 0) * 100) / 100;

describe("splitProblem", () => {
  const ok = [L("expense:equipment", -60), L("expense:meals", -40)];
  it("accepts lines that add up to the cent, in the transaction's own direction", () => {
    expect(splitProblem(-100, ok)).toBeNull();
    expect(splitProblem(100, [L("revenue:a", 70.01), L("revenue:b", 29.99)])).toBeNull();
    expect(splitProblem(-100, [L("expense:a", -120), L("revenue:refund", 20)])).toBeNull(); // a refund line inside the payment
  });
  it("is exact in cents: 0.1 + 0.2 style float noise is fine, a missing cent is not", () => {
    expect(splitProblem(-0.3, [L("expense:a", -0.1), L("expense:b", -0.2)])).toBeNull();
    expect(splitProblem(-100, [L("expense:a", -60), L("expense:b", -39.99)])).toBe("sum");
    expect(splitProblem(-100, [L("expense:a", -60), L("expense:b", -40.01)])).toBe("sum");
    expect(splitProblem(-100, [L("expense:a", 60), L("expense:b", 40)])).toBe("sum"); // wrong direction
    expect(remaining(-100, [L("a", -60)])).toBe(-40);
    expect(remaining(-100, ok)).toBe(0);
    expect(remaining(19.99, [L("a", 19.99)])).toBe(0);
  });
  it("needs two lines, an amount on each, and a usable ledger account", () => {
    expect(splitProblem(-100, [L("expense:a", -100)])).toBe("lines");
    expect(splitProblem(-100, [])).toBe("lines");
    expect(splitProblem(-100, [L("expense:a", -100), L("expense:b", 0)])).toBe("amount");
    expect(splitProblem(-100, [L("expense:a", -100), L("expense:b", 0.004)])).toBe("amount"); // rounds to zero cents
    expect(splitProblem(-100, [L("expense:a", -100), L("expense:b", Number.NaN)])).toBe("amount");
    expect(splitProblem(-100, [L("expense:a", -50), L("ask", -50)])).toBe("account");
    expect(splitProblem(-100, [L("expense:a", -50), L(" ", -50)])).toBe("account");
    expect(splitProblem(-100, ok, (a) => a !== "expense:meals")).toBe("account"); // e.g. archived
  });
});

describe("evenAmounts", () => {
  it("shares the cents that don't divide out, one each from the first line, and always adds up", () => {
    expect(evenAmounts(100, 3)).toEqual([33.34, 33.33, 33.33]);
    expect(evenAmounts(-100, 3)).toEqual([-33.34, -33.33, -33.33]);
    expect(evenAmounts(0.05, 3)).toEqual([0.02, 0.02, 0.01]);
    expect(evenAmounts(10, 2)).toEqual([5, 5]);
    for (const [a, n] of [[19.99, 7], [-1234.57, 6], [0.01, 2], [1e6 + 0.03, 9]] as const) expect(remaining(a, evenAmounts(a, n).map((amount) => ({ amount })))).toBe(0);
  });
});

describe("ids and cleaning", () => {
  it("split row ids carry the stored id", () => {
    expect(splitId("abc", 2)).toBe("abc~2");
    expect(baseId("abc~2")).toBe("abc");
    expect(baseId("abc")).toBe("abc");
    expect(isSplitRow("abc~0")).toBe(true);
    expect(isSplitRow("abc")).toBe(false);
  });
  it("cleanSplit trims, rounds to the cent, drops empty memo and tag lists", () => {
    expect(cleanSplit([{ account: " expense:a ", amount: -33.333, memo: "  ", tags: [] }, { account: "expense:b", amount: -66.667, memo: " x ", tags: ["t", "t", ""] }])).toEqual([
      { account: "expense:a", amount: -33.33 },
      { account: "expense:b", amount: -66.67, memo: "x", tags: ["t"] },
    ]);
  });
  it("splitOf ignores a stored split that no longer adds up (the statement was re-imported with another amount)", () => {
    const doc = { a: [L("expense:a", -60), L("expense:b", -40)] };
    expect(splitOf(doc, "a", -100)).toBe(doc.a);
    expect(splitOf(doc, "a", -101)).toBeUndefined();
    expect(splitOf(doc, "b", -100)).toBeUndefined();
    expect(splitOf(undefined, "a", -100)).toBeUndefined();
  });
});

describe("the ledger with splits", () => {
  const stored = [row("a", -100.01), row("b", 500, { desc: "Client", date: "2026-03-11" }), row("c", -20, { date: "2026-02-01" })];
  const rules = [["Staples", "expense:equipment"] as const, ["Client", "revenue:services"] as const];
  const splits = { a: [L("expense:equipment", -60.01), L("expense:meals", -40, { memo: "lunch" })] };

  it("emits one row per line (id `${txnId}~${i}`, why split) and keeps every other field of the transaction", () => {
    const rows = ledger(stored, {}, rules, [], undefined, { splits });
    const parts = rows.filter((r) => baseId(r.id) === "a");
    expect(parts.map((r) => [r.id, r.amount, r.category, r.why])).toEqual([
      ["a~0", -60.01, "expense:equipment", "split"],
      ["a~1", -40, "expense:meals", "split"],
    ]);
    expect(parts[0]).toMatchObject({ date: "2026-03-10", account: "Main", desc: "Staples supplies", source: "bank", file: "a.pdf" });
    expect(parts[1]!.memo).toBe("lunch");
    expect(rows.find((r) => r.id === "b")).toMatchObject({ category: "revenue:services", why: "Client" }); // others untouched
    expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort());
  });
  it("a split ignores the transaction's override and rule; unsplitting brings both back", () => {
    const withOverride = ledger(stored, { a: "expense:games" }, rules, [], undefined, { splits });
    expect(withOverride.filter((r) => baseId(r.id) === "a").map((r) => r.category)).toEqual(["expense:equipment", "expense:meals"]);
    expect(ledger(stored, { a: "expense:games" }, rules).find((r) => r.id === "a")).toMatchObject({ category: "expense:games", why: "manual" });
  });
  it("rounding: the lines always add up to the transaction, balances and totals do not change", () => {
    const three = { a: evenAmounts(-100.01, 3).map((amount, i) => L(["expense:a", "expense:b", "expense:c"][i]!, amount)) };
    const plain = ledger(stored, {}, rules),
      split = ledger(stored, {}, rules, [], undefined, { splits: three });
    expect(split.length).toBe(plain.length + 2);
    expect(sum(split.filter((r) => baseId(r.id) === "a"))).toBe(-100.01);
    expect(sum(split)).toBe(sum(plain));
    const checks: never[] = [];
    expect(balances(split, checks, "2026-12-31")).toEqual(balances(plain, checks, "2026-12-31"));
  });
  it("P&L: lines on expense accounts leave expenses and net as they were (up to float dust), and each account gets its share", () => {
    const plain = pl(ledger(stored, {}, rules)),
      split = pl(ledger(stored, {}, rules, [], undefined, { splits: { a: [L("expense:equipment", -60.01), L("expense:meals", -40)] } }));
    expect(split.opex).toBeCloseTo(plain.opex, 9);
    expect(split.net).toBeCloseTo(plain.net, 9);
    expect(split.revenue).toBe(plain.revenue);
    const by = Object.fromEntries(split.lines.expense.map((l) => [l.key, l.value]));
    expect(by["expense:equipment"]).toBeCloseTo(-80.01, 9); // plus row c (-20), which the rule files there
    expect(by["expense:meals"]).toBeCloseTo(-40, 9);
  });
  it("lines into different P&L sections move the sections, but the total of all rows is the transaction", () => {
    const rows = ledger(stored, {}, rules, [], undefined, { splits: { a: [L("expense:a", -120), L("personal:refund", 19.99)] } });
    expect(sum(rows.filter((r) => baseId(r.id) === "a"))).toBe(-100.01);
  });
  it("a stored split that no longer adds up is ignored", () => {
    const rows = ledger([row("a", -101)], {}, rules, [], undefined, { splits });
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });
  it("entries start date leaves out earlier transactions and journal entries", () => {
    const je = [{ id: "j1", date: "2026-01-05", lines: [{ account: "expense:x", debit: 5 }, { account: "equity:owner", credit: 5 }] }];
    expect(ledger(stored, {}, rules, je, undefined, { from: "2026-03-01" }).map((r) => r.id)).toEqual(["a", "b"]);
    expect(ledger(stored, {}, rules, je, undefined, { from: "2026-01-01" }).length).toBe(3 + 2);
    expect(ledger(stored, {}, rules, je, undefined, { from: null }).length).toBe(3 + 2);
  });
});

describe("tags on split lines", () => {
  const stored = [row("a", -100)];
  const doc: TagsDoc = {
    groups: [{ id: "proj", name: "Project" }],
    tags: [{ id: "x", name: "X", group: "proj" }, { id: "y", name: "Y", group: "proj" }, { id: "biz", name: "Biz" }],
    on: { a: ["biz", "x"] },
  };
  const splits = { a: [L("expense:a", -60, { tags: ["y"] }), L("expense:b", -40)] };
  it("the transaction's tags go on every line; a line's own tag replaces the transaction's tag of the same group", () => {
    const rows = ledger(stored, {}, [], [], doc, { splits });
    expect(rows[0]!.tags).toEqual(["biz", "y"]); // y replaced x (same group)
    expect(rows[1]!.tags).toEqual(["biz", "x"]);
  });
  it("tags of deleted tags fall away on lines too", () => {
    const rows = ledger(stored, {}, [], [], { ...doc, tags: doc.tags.filter((t) => t.id !== "y") }, { splits });
    expect(rows[0]!.tags).toEqual(["biz", "x"]);
  });
});

describe("deductions follow the lines", () => {
  const rules = (JSON.parse(readFileSync(new URL("../../countries/us/tables/deductions.json", import.meta.url), "utf8")) as { rules: DeductionRule[] }).rules;
  it("a $100 supplies run split into software (tagged, deductible) and personal (not): only the tagged line counts, with the transaction's receipt", () => {
    const doc: TagsDoc = { groups: [], tags: [{ id: "sw", name: "SW", tax: { rule: "us.software" } }], on: {} };
    const splits = { a: [L("expense:software", -60, { tags: ["sw"] }), L("expense:other", -40)] };
    const rows = ledger([row("a", -100)], {}, [], [], doc, { splits });
    const r = deductions({ txns: rows, tags: doc, rules, type: "llc-ccorp", year: 2026, currency: "USD", attachments: { a: ["receipt.pdf"] } });
    const line = r.rows.find((x) => x.id === "a~0")!;
    expect(line).toMatchObject({ gross: 60, deductible: 60, receipt: false }); // receipt found under the stored id
    expect(r.rows.find((x) => x.id === "a~1")).toMatchObject({ gross: 40, bucket: "untreated" });
  });
});
