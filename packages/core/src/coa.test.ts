import { expect, test } from "vite-plus/test";
import { chartOfAccounts, nextCode } from "./coa.ts";

const ledger = ["revenue:sales", "revenue:royalties", "cogs:hosting", "expense:software", "expense:travel", "equity:owner", "transfer:internal", "other-income:cashback"];
const banks = ["Mercury Checking", "Mercury Credit"];
const code = (rows: ReturnType<typeof chartOfAccounts>, id: string) => rows.find((r) => r.id === id)!.code;

test("default codes: a block per type, numbered in order, banks are assets and cards liabilities", () => {
  const rows = chartOfAccounts(ledger, banks, {});
  expect(rows.map((r) => [r.id, r.code])).toEqual([
    ["Mercury Checking", 10001],
    ["Mercury Credit", 20001],
    ["equity:owner", 30001],
    ["revenue:sales", 40001],
    ["revenue:royalties", 40002],
    ["cogs:hosting", 50001],
    ["expense:software", 60001],
    ["expense:travel", 60002],
    ["other-income:cashback", 70001],
    ["transfer:internal", 80001],
  ]);
  const by = (id: string) => rows.find((r) => r.id === id)!;
  expect([by("Mercury Checking").klass, by("Mercury Checking").side]).toEqual(["asset", "debit"]);
  expect([by("Mercury Credit").klass, by("Mercury Credit").side]).toEqual(["liability", "credit"]);
  expect([by("expense:travel").klass, by("expense:travel").side]).toEqual(["expense", "debit"]);
  expect([by("revenue:sales").klass, by("revenue:sales").side]).toEqual(["revenue", "credit"]);
  expect([by("transfer:internal").klass, by("transfer:internal").side]).toEqual(["other", null]);
});

test("a stored code wins and is never reused by a default; names, subtypes and archive pass through", () => {
  const rows = chartOfAccounts(ledger, banks, {
    "revenue:royalties": { code: 40001, name: "Royalties", subtype: "Music" },
    "expense:travel": { archived: true },
    "Mercury Checking": { code: 10000 },
  });
  expect(code(rows, "revenue:royalties")).toBe(40001);
  expect(code(rows, "revenue:sales")).toBe(40002); // 40001 is taken
  expect(code(rows, "Mercury Checking")).toBe(10000);
  expect(rows.find((r) => r.id === "revenue:royalties")).toMatchObject({ name: "Royalties", subtype: "Music", archived: false });
  expect(rows.find((r) => r.id === "expense:travel")!.archived).toBe(true); // archived stays in the chart (history is kept)
  expect(chartOfAccounts(ledger, banks, { "cogs:hosting": { code: 1.5 } }).find((r) => r.id === "cogs:hosting")!.code).toBe(50001); // junk ignored
});

test("existing defaults don't move when an account is added; nextCode is what the new one would get", () => {
  const before = chartOfAccounts(ledger, banks, {});
  const after = chartOfAccounts([...ledger, "expense:meals"], banks, {});
  for (const r of before) expect(code(after, r.id)).toBe(r.code);
  expect(code(after, "expense:meals")).toBe(60003);
  expect(nextCode(ledger, banks, {}, "expense")).toBe(60003);
  expect(nextCode(ledger, banks, {}, "business")).toBe(40003);
});
