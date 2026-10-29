import { checkDictionaries } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import { expect, test } from "vite-plus/test";
import en from "../locales/parts/3-4.en.ts";
import he from "../locales/parts/3-4.he.ts";
import { inCat, inTag, parseArg, range, ruleHits, slug, toCsv } from "./txns.ts";

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
  expect(parseArg("")).toEqual({ tab: "all", cat: "", acct: "", month: "", tag: "" });
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
