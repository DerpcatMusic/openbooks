import { expect, test } from "vitest";
import { looksLikeQuestion, md, rank, registered, registerTools, score, type PaletteItem } from "./palette.ts";

const item = (id: string, en: string, he: string): PaletteItem => ({ id, label: { en, he }, icon: "home", run: () => {} });

test("score: substring > word prefix > in-order letters; every word must match", () => {
  expect(score("rep", "Reports")).toBeGreaterThan(score("rpt", "Reports"));
  expect(score("rpt", "Reports")).toBeGreaterThan(0);
  expect(score("xyz", "Reports")).toBe(0);
  expect(score("acme", "Import statements or documents")).toBe(0); // letters scattered over a long label
  expect(score("ספק", "הוספת עסק")).toBe(0);
  expect(score("tax plan", "Tax planner")).toBeGreaterThan(0);
  expect(score("tax zzz", "Tax planner")).toBe(0);
});

test("rank: matches either language, Hebrew final letters and niqqud normalised", () => {
  const items = [item("a", "Chart of accounts", "תוכנית חשבונות"), item("b", "Reports", "דוחות")];
  expect(rank("דוח", items, 5).map((x) => x.id)).toEqual(["b"]);
  expect(rank("reports", items, 5).map((x) => x.id)).toEqual(["b"]);
  expect(rank("חשבונ", items, 5).map((x) => x.id)).toEqual(["a"]); // typed mid-word: ן ≡ נ
  expect(rank("דּוֹחוֹת", items, 5).map((x) => x.id)).toEqual(["b"]);
});

test("questions and the tool registry", () => {
  expect(looksLikeQuestion("what did I earn")).toBe(true);
  expect(looksLikeQuestion("כמה הרווחתי")).toBe(true);
  expect(looksLikeQuestion("reports")).toBe(false);
  let ran = "";
  const off = registerTools(
    [
      { name: "bank_sync", kind: "write", palette: { label: { en: "Sync banks", he: "סנכרון בנקים" }, icon: "refresh" } },
      { name: "list_entities", kind: "read" },
    ],
    (n) => (ran = n),
  );
  expect(registered().map((x) => [x.id, x.kind])).toEqual([["tool:bank_sync", "write"]]);
  registered()[0]!.run();
  expect(ran).toBe("bank_sync");
  off();
  expect(registered()).toEqual([]);
});

test("md escapes, links app pages, marks transaction ids", () => {
  expect(md("<b>x</b>")).toBe("<p>&#60;b&#62;x&#60;/b&#62;</p>");
  expect(md("see [Reports](#/reports)")).toContain('<a href="/reports">Reports</a>');
  expect(md("[x](javascript:alert(1))")).not.toContain("<a");
  expect(md("`0123456789ab`", (id) => id === "0123456789ab")).toContain('data-txn="0123456789ab"');
  expect(md("- a\n- **b**")).toBe("<ul><li>a</li><li><strong>b</strong></li></ul>");
  expect(md("| a | b |\n|---|---|\n| x | 1,200 |")).toContain('<td class="r">1,200</td>');
});
