import { checkDictionaries } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import { expect, test } from "vite-plus/test";
import en from "../locales/parts/3-4.en.ts";
import he from "../locales/parts/3-4.he.ts";
import { inCat, inKind, inMethod, inReview, inTag, parseArg, range, ruleHits, slug, toCsv } from "./txns.ts";

const tx = (id: string, desc: string, amount: number, category = "ask", why = ""): Txn =>
  ({ id, date: "2026-01-02", amount, desc, source: "bank", account: "Bank", file: "s.pdf", page: 1, category, why }) as Txn;

test("3.4 Hebrew strings match the English ones", () => expect(checkDictionaries(en, he)).toEqual([]));

test("old #/transactions/<arg> links seed the filters", () => {
  expect(parseArg("ask").tab).toBe("ask");
  expect(parseArg("month:2026-04").month).toBe("2026-04");
  expect(parseArg("cat:expense:software").cat).toBe("expense:software");
  expect(parseArg("type:own").cat).toBe("type:own");
  expect(parseArg("account:Mercury Credit").acct).toBe("Mercury Credit");
  expect(parseArg("tag:client-work").tag).toBe("client-work");
  expect(parseArg("")).toEqual({ tab: "all", cat: "", acct: "", month: "", tag: "", kind: "", method: "", review: "" });
  expect(parseArg("kind:card").kind).toBe("card");
  expect(parseArg("kind:bank").kind).toBe("bank");
  expect(parseArg("kind:nope").kind).toBe("");
  expect(parseArg("method:split").method).toBe("split");
  expect(parseArg("method:suggested").method).toBe("suggested");
  expect(parseArg("method:nope").method).toBe("");
  expect(parseArg("review:no").review).toBe("no");
  expect(parseArg("review:yes").review).toBe("yes");
  expect(parseArg("review:maybe").review).toBe("");
  expect(inTag({ tags: ["a", "b"] }, "b")).toBe(true);
  expect(inTag({}, "b")).toBe(false);
  expect(inTag({}, "")).toBe(true);
  expect(inCat({ category: "own:x" }, "type:own")).toBe(true);
  expect(inCat({ category: "" }, "type:ask")).toBe(true);
});

test("rule preview: first match wins, manual rows skipped, match text cleaned like the server", () => {
  const ts = [tx("a", "PATREON payout", 10), tx("b", "Patreon, fee", -1), tx("c", "AWS", -5, "expense:x", "manual"), tx("d", "coffee", -3)];
  const { h, none } = ruleHits(
    [
      ["PATREON", "revenue:x"],
      ["payout", "revenue:x"],
      [" ", "revenue:x"],
      ["Patreon,", "revenue:x"],
    ],
    ts,
  );
  expect(h.map((x) => x.ids)).toEqual([["a"], [], [], ["b"]]);
  expect(h[0]!.sum).toBe(10);
  expect(none).toEqual(["d"]);
});

test("rule preview with conditions: tag-only rules count every match, manual rows only for tags", () => {
  const ts = [tx("a", "AWS", -50), tx("b", "AWS", -5), tx("c", "AWS", -80, "expense:x", "manual")];
  const big = { field: "amount", op: "gte", value: 20 } as const;
  const { h, none } = ruleHits(
    [
      { when: [{ field: "description", op: "contains", value: "aws" }, big], then: { account: "cogs:hosting" } },
      { when: [{ field: "description", op: "contains", value: "aws" }], then: { account: "expense:x" } },
      { when: [{ field: "direction", op: "out" }], then: { tags: ["infra"] } },
    ],
    ts,
  );
  expect(h.map((x) => x.ids)).toEqual([["a"], ["b"], ["a", "b", "c"]]);
  expect(none).toEqual([]);
});

test("shift-click range, slugs, CSV quoting", () => {
  expect(range(["a", "b", "c", "d"], "d", "b")).toEqual(["b", "c", "d"]);
  expect(range(["a", "b"], null, "b")).toEqual(["b"]);
  expect(slug("  Studio rent / שכירות ")).toBe("studio-rent-שכירות");
  expect(toCsv([tx("a", 'say "hi"', 1.5)], (c) => c).split("\n")[1]).toBe('"2026-01-02","Bank","ask","say ""hi""","1.5"');
});

test("account kind tabs: cards by account name, journal lines in neither", () => {
  const b = { account: "Mercury Checking", source: "mercury" },
    c = { account: "Mercury Credit", source: "mercury" },
    j = { account: "Journal", source: "journal" };
  expect([b, c, j].map((x) => inKind(x, ""))).toEqual([true, true, true]);
  expect([b, c, j].map((x) => inKind(x, "bank"))).toEqual([true, false, false]);
  expect([b, c, j].map((x) => inKind(x, "card"))).toEqual([false, true, false]);
});

test("categorization method filter, from why and the category; suggested is its own set", () => {
  const rows = [
    tx("ask1", "x", -1),
    tx("ask2", "x", -1),
    tx("m", "x", -1, "expense:a", "manual"),
    tx("r", "x", -1, "expense:a", "aws"),
    tx("s", "x", -1, "expense:a", "split"),
    { ...tx("j", "x", -1, "expense:a", "journal"), source: "journal" } as Txn,
  ];
  const ids = (method: Parameters<typeof inMethod>[1]) => rows.filter((r) => inMethod(r, method, new Set(["ask2"]))).map((r) => r.id);
  expect(ids("")).toHaveLength(6);
  expect(ids("uncategorized")).toEqual(["ask1", "ask2"]);
  expect(ids("suggested")).toEqual(["ask2"]);
  expect(ids("manual")).toEqual(["m"]);
  expect(ids("rule")).toEqual(["r"]);
  expect(ids("split")).toEqual(["s"]);
  expect(ids("journal")).toEqual(["j"]);
});

test("reviewed filter is independent of categorizing; a split's lines share the transaction's mark", () => {
  const marks = { a: true };
  expect(inReview({ id: "a" }, "yes", marks)).toBe(true);
  expect(inReview({ id: "a~1" }, "yes", marks)).toBe(true);
  expect(inReview({ id: "b" }, "yes", marks)).toBe(false);
  expect(inReview({ id: "b" }, "no", marks)).toBe(true);
  expect(inReview({ id: "a~0" }, "no", marks)).toBe(false);
  expect(inReview({ id: "b" }, "", marks)).toBe(true);
});

test("rule preview skips rules on archived accounts and leaves split lines alone", () => {
  const ts = [tx("a", "AWS", -5), tx("b", "AWS", -5, "expense:x", "split")];
  const rules = [["AWS", "expense:old"] as const, ["AWS", "expense:new"] as const];
  const { h } = ruleHits(rules, ts, { "expense:old": { archived: true } });
  expect(h.map((x) => x.ids)).toEqual([[], ["a"]]);
  expect(ruleHits(rules, ts, {}).h.map((x) => x.ids)).toEqual([["a"], []]);
});
