import { checkDictionaries } from "@openbooks/core";
import { expect, test } from "vite-plus/test";
import en from "../locales/parts/3-3.en.ts";
import he from "../locales/parts/3-3.he.ts";
import { agingReport, billSources, invoiceSources, openAt } from "@openbooks/core";
import { activeMonths, agingCsv, bsStatement, cfStatement, ledgerGroups, plStatement, toCsv } from "./statements.ts";

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
      { iso: "2026-02-28", balances: { "Mercury Checking": 1500, "Mercury Credit": -50 }, upto: all },
      { iso: "2026-01-31", balances: { "Mercury Checking": 750 }, upto: jan },
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

test("P&L order: revenue, total, cost of goods, gross profit, operating expenses, operating profit, other income + total, net (US shows both profit rows always)", () => {
  const withOther = [...jan, ...feb, tx("2026-02-20", 25, "other-income:cashback")];
  const labels = plStatement([withOther], true, t, cat).map((r) => r.label);
  expect(labels.filter((l) => l.startsWith("reports.")).join(" ")).toBe(
    "reports.revenue reports.totalRevenue reports.cogs reports.totalCogs reports.grossProfit reports.opex reports.totalOpex reports.operatingIncome reports.otherIncome reports.totalOtherIncome reports.netIncome",
  );
  const other = plStatement([withOther], true, t, cat).find((r) => r.label === "reports.totalOtherIncome")!;
  expect(other.v).toEqual([25]);
  // a US book with revenue only still shows gross and operating profit (= revenue)
  const bare = plStatement([[tx("2026-01-05", 1000, "revenue:sales")]], true, t, cat);
  expect(bare.find((r) => r.label === "reports.grossProfit")!.v).toEqual([1000]);
  expect(bare.find((r) => r.label === "reports.operatingIncome")!.v).toEqual([1000]);
  expect(bare.at(-1)!.v).toEqual([1000]);
  // an Israeli book keeps its short shape: no cost or expense sections, no empty profit rows
  const il = plStatement([[tx("2026-01-05", 1000, "business:client")]], false, t, cat).map((r) => r.label);
  expect(il).not.toContain("reports.grossProfit");
  expect(il).not.toContain("reports.operatingIncome");
});

// the books of a small LLC: two years, an invoice from last year still open, a bill from this year still open, a part-paid invoice
const books = [
  tx("2025-03-01", 5000, "equity:owner"),
  tx("2025-03-10", 2000, "revenue:sales"),
  tx("2025-04-01", -500, "expense:software"),
  tx("2026-01-10", 3000, "revenue:sales"),
  tx("2026-02-01", -700, "expense:software"),
  tx("2026-02-02", -100, "ask"),
];
const cashBal = (iso: string) => ({ "Mercury Checking": books.filter((x) => x.date <= iso).reduce((a, x) => a + x.amount, 0) });
const invoices = [
  { id: "i1", kind: "invoice", customer: "c1", items: [{ qty: 1, price: 400 }], issued: "2025-12-01", due: "2025-12-31", status: "open" }, // last year, open
  { id: "i2", kind: "invoice", customer: "c1", items: [{ qty: 1, price: 1000 }], issued: "2026-01-20", due: "2026-02-20", status: "open", payments: [{ id: "p", txn: null, amount: 250, date: "2026-02-10" }] },
  { id: "i3", kind: "invoice", customer: "c1", items: [{ qty: 1, price: 999 }], issued: "2026-01-21", status: "draft" },
];
const bills = [{ id: "b1", vendor: "v1", date: "2026-02-05", due: "2026-03-05", lines: [{ amount: 300 }], status: "open", payments: [] }];
const ar = invoiceSources(invoices, () => "Client"),
  ap = billSources(bills, () => "Vendor");
const point = (iso: string) => ({ iso, balances: cashBal(iso), upto: books.filter((x) => x.date <= iso), open: { ar: openAt(ar, iso), ap: openAt(ap, iso) } });
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.005);

test("balance sheet: retained earnings are earlier years, current-year earnings this year, and it balances", () => {
  const { lines, totals } = bsStatement([point("2026-03-31")], t);
  const by = (label: string) => lines.find((l) => l.label === label)!.v[0]!;
  expect(by("reports.retained")).toBe(1500); // 2025: 2000 - 500
  expect(by("reports.currentYear")).toBe(2200); // 2026: 3000 - 700 - 100 uncategorized
  expect(by("reports.ownerNet")).toBe(5000);
  near(totals[0]!.assets, totals[0]!.liab + totals[0]!.equity);
  expect(lines.find((l) => l.label === "reports.liabEquity")!.v[0]).toBe(totals[0]!.assets); // liabilities + equity row = total assets
  // earlier date: no current-year earnings yet in 2025, everything is that year's
  const y25 = bsStatement([point("2025-12-31")], t).lines;
  expect(y25.find((l) => l.label === "reports.retained")!.v).toEqual([0]);
  expect(y25.find((l) => l.label === "reports.currentYear")!.v).toEqual([1500]);
});

test("balance sheet, cash basis: open invoices and bills are a memo outside the totals, still balanced", () => {
  const { lines, totals } = bsStatement([point("2026-03-31")], t);
  const labels = lines.map((l) => l.label);
  expect(labels).not.toContain("reports.ar");
  expect(labels.slice(-3)).toEqual(["reports.memo", "reports.arOpen", "reports.apOpen"]);
  expect(lines.find((l) => l.label === "reports.arOpen")!.v).toEqual([400 + 750]); // i1 + what is left of i2; the draft is not owed
  expect(lines.find((l) => l.label === "reports.apOpen")!.v).toEqual([300]);
  near(totals[0]!.assets, totals[0]!.liab + totals[0]!.equity);
  // before anything is open there is no memo
  expect(bsStatement([point("2025-02-01")], t).lines.map((l) => l.label)).not.toContain("reports.memo");
});

test("balance sheet, accrual: AR and AP join assets and liabilities, the earnings they imply split by issue year, and it still balances at every date", () => {
  for (const iso of ["2025-12-31", "2026-01-31", "2026-02-15", "2026-03-31", "2026-12-31"]) {
    const { totals } = bsStatement([point(iso)], t, true);
    near(totals[0]!.assets, totals[0]!.liab + totals[0]!.equity);
  }
  const { lines, totals } = bsStatement([point("2026-03-31")], t, true);
  const by = (label: string) => lines.find((l) => l.label === label)!.v[0]!;
  expect(by("reports.ar")).toBe(1150);
  expect(by("reports.ap")).toBe(300);
  expect(by("reports.retained")).toBe(1500 + 400); // i1 was issued last year
  expect(by("reports.currentYear")).toBe(2200 + 750 - 300);
  expect(by("reports.totalAssets")).toBe(totals[0]!.assets);
  expect(totals[0]!.assets).toBe(8700 + 1150); // cash 5000 + 2000 - 500 + 3000 - 700 - 100, plus receivables
  expect(totals[0]!.equity).toBe(9850 - 300);
});

test("balance sheet compares two dates and balances in each column", () => {
  const { totals, lines } = bsStatement([point("2026-03-31"), point("2025-12-31")], t, true);
  totals.forEach((x) => near(x.assets, x.liab + x.equity));
  expect(lines.find((l) => l.label === "reports.ar")!.v).toEqual([1150, 400]);
});

test("aging CSV: bucket columns, overdue, totals and percent rows; by document", () => {
  const r = agingReport(ar, "2026-03-01");
  const bucket = (i: number) => (i === 0 ? "Current" : r.buckets[i]!.label + " days");
  const label = { party: "Customer", ref: "Invoice", none: "No customer" };
  const rows = agingCsv(r, "party", t, bucket, label).trimEnd().split("\r\n");
  expect(rows[0]).toBe("Customer,Current,1-30 days,31-60 days,61-90 days,91+ days,aging.overdue,common.total");
  expect(rows[1]).toBe("Client,0.00,750.00,400.00,0.00,0.00,1150.00,1150.00"); // i2 is 9 days past due, i1 60
  expect(rows[2]).toBe("common.total,0.00,750.00,400.00,0.00,0.00,1150.00,1150.00");
  expect(rows[3]).toBe("aging.pct,0.0,65.2,34.8,0.0,0.0,,100.0");
  const docs = agingCsv(r, "source", t, bucket, label).trimEnd().split("\r\n");
  expect(docs[0]).toBe("Customer,Invoice,common.date,bills.col.dueDate,aging.pastDue,aging.bucket,aging.outstanding");
  expect(docs.slice(1)).toEqual(["Client,,2025-12-01,2025-12-31,60,31-60 days,400.00", "Client,,2026-01-20,2026-02-20,9,1-30 days,750.00"]); // most overdue first
  expect(agingCsv(agingReport([], "2026-03-01"), "party", t, bucket, label).trimEnd().split("\r\n")).toHaveLength(2); // header + zero totals
});
