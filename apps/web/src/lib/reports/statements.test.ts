import { checkDictionaries } from "@openbooks/core";
import { expect, test } from "vitest";
import en from "../locales/parts/3-3.en.ts";
import he from "../locales/parts/3-3.he.ts";
import { activeMonths, bsStatement, cfStatement, ledgerGroups, plStatement, toCsv } from "./statements.ts";

const t = (k: string) => k,
  cat = (k: string) => k;
const tx = (date: string, amount: number, category: string) => ({ date, amount, category });
const jan = [tx("2026-01-05", 1000, "revenue:sales"), tx("2026-01-09", -200, "expense:software"), tx("2026-01-20", -50, "ask")];
const feb = [tx("2026-02-03", 500, "revenue:sales"), tx("2026-02-11", -100, "cogs:parts"), tx("2026-02-12", 300, "equity:contribution")];

test("P&L per column: sections, signs, subtotals, net", () => {
  const rows = plStatement([jan, feb, [...jan, ...feb]], true, t, cat);
  const by = (label: string) => rows.find((r) => r.label === label)!.v;
  expect(rows.find((r) => r.key === "revenue:sales")!.v).toEqual([1000, 500, 1500]);
  expect(rows.find((r) => r.key === "expense:software")!.v).toEqual([200, 0, 200]); // expenses read positive
  expect(by("reports.totalCogs")).toEqual([0, 100, 100]);
  expect(rows.find((r) => r.key === "ask")!.v).toEqual([-50, 0, -50]);
  expect(by("reports.netIncome")).toEqual([750, 400, 1150]);
  expect(rows.at(-1)!.kind).toBe("total");
});

test("cash flow: equity is financing, every section nets, total = all cash", () => {
  const rows = cfStatement([[...jan, ...feb]], t, cat);
  expect(rows.find((r) => r.label === "reports.cfNet.financing")!.v).toEqual([300]);
  expect(rows.find((r) => r.label === "reports.cfNet.operating")!.v).toEqual([1150]);
  expect(rows.at(-1)!.v).toEqual([1450]);
});

test("balance sheet balances (transit closes the gap) and compares two dates", () => {
  const all = [...jan, ...feb];
  const { lines, totals } = bsStatement(
    [
      { balances: { "Mercury Checking": 1500, "Mercury Credit": -50 }, upto: all },
      { balances: { "Mercury Checking": 750 }, upto: jan },
    ],
    t,
  );
  expect(totals[0]).toEqual({ assets: 1500, liab: 50, equity: 1450 });
  expect(lines.at(-1)!.v).toEqual([1500, 750]); // liabilities + equity = assets
  expect(lines.find((l) => l.label === "Mercury Credit")!.v).toEqual([50, 0]);
});

test("ledger groups run a balance; months trim to activity; CSV quotes", () => {
  const g = ledgerGroups([...jan, ...feb], cat).find((x) => x.key === "revenue:sales")!;
  expect(g.rows.map((r) => r.run)).toEqual([1000, 1500]);
  expect(activeMonths(["2026-01", "2026-02", "2026-03"], feb)).toEqual(["2026-02"]);
  expect(activeMonths(["2026-01"], [])).toEqual(["2026-01"]);
  expect(
    toCsv(
      ["Account", "Total"],
      [
        { kind: "head", label: "A, B", v: [] },
        { kind: "line", label: 'x"y', v: [-0.001, 12.5] },
      ],
    ),
  ).toBe('Account,Total\r\n"A, B"\r\n"x""y",0.00,12.50\r\n');
});

test("3.3 locale parts: Hebrew has every English key", () => {
  expect(checkDictionaries(en, he)).toEqual([]);
});
