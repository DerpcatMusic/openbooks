import { expect, test } from "vite-plus/test";
import { cashFlow, cfaLines, spans, type Row } from "./cashflow.ts";

const tx = (date: string, amount: number, account: string, category: string): Row => ({ date, amount, account, category });
const banks = ["Checking", "Savings", "Card"];
const rows = [
  tx("2025-12-20", 1000, "Checking", "revenue:sales"),
  tx("2026-01-05", -200, "Checking", "expense:software"),
  tx("2026-01-10", -300, "Checking", "transfer:internal"),
  tx("2026-01-10", 300, "Savings", "transfer:internal"),
  tx("2026-01-15", -50, "Card", "expense:meals"),
  tx("2026-02-02", 500, "Checking", "revenue:sales"),
  tx("2026-02-09", -100, "Checking", "equity:owner"),
  tx("2026-04-03", -40, "Checking", "expense:software"),
  tx("2026-05-20", 70, "Checking", "revenue:sales"), // after "today" below
  tx("2026-02-20", 999, "Journal", "revenue:accrual"), // not a bank account: moves no cash
];
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

test("spans: months and quarters that have started, the current one cut at today", () => {
  const m = spans(2026, "monthly", "2026-10-15");
  expect(m.map((s) => s.key)).toEqual(Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`));
  expect(m.filter((s) => s.mtd).map((s) => [s.key, s.from, s.to])).toEqual([["2026-10", "2026-10-01", "2026-10-15"]]);
  expect(m[1]).toMatchObject({ from: "2026-02-01", to: "2026-02-28", mtd: false }); // not a leap year
  expect(spans(2024, "monthly", "2026-10-15")[1]!.to).toBe("2024-02-29");
  const q = spans(2026, "quarterly", "2026-05-10");
  expect(q.map((s) => [s.key, s.from, s.to, s.mtd, s.months])).toEqual([
    ["2026-Q1", "2026-01-01", "2026-03-31", false, [1, 2, 3]],
    ["2026-Q2", "2026-04-01", "2026-05-10", true, [4, 5, 6]], // QTD
  ]);
  expect(spans(2025, "quarterly", "2026-05-10").filter((s) => s.mtd)).toEqual([]);
  expect(spans(2027, "monthly", "2026-10-15")).toEqual([]);
});

test("start + movement = end per account, and each column starts where the last ended", () => {
  const cuts = spans(2026, "monthly", "2026-05-10");
  const cols = cashFlow(rows, banks, cuts);
  for (const c of cols)
    for (const a of banks) {
      const mine = rows.filter((r) => r.account === a && r.date >= c.span.from && r.date <= c.span.to);
      expect(c.end[a]).toBeCloseTo(c.start[a]! + sum(mine.map((r) => r.amount)), 9);
    }
  for (let i = 1; i < cols.length; i++) expect(cols[i]!.start).toEqual(cols[i - 1]!.end);
  expect(cols[0]!.start).toEqual({ Checking: 1000, Savings: 0, Card: 0 }); // December sits before January
  expect(cols[0]!.end).toEqual({ Checking: 500, Savings: 300, Card: -50 });
  for (const c of cols) expect(c.endTotal).toBeCloseTo(c.startTotal + c.net, 9);
  expect(cols.map((c) => c.endTotal)).toEqual([750, 1150, 1150, 1110, 1110]); // Journal's 999 never counts
});

test("transfers between accounts net to zero; the movement rows add up to the net", () => {
  const [jan] = cashFlow(rows, banks, spans(2026, "monthly", "2026-05-10"));
  expect(jan!.move).toEqual({ "expense:software": -200, "transfer:internal": 0, "expense:meals": -50 });
  expect(jan!.net).toBe(-250);
  expect(jan!.endTotal - jan!.startTotal).toBe(jan!.net);
});

test("quarters bucket three months; MTD cuts the open period at today", () => {
  const cuts = spans(2026, "quarterly", "2026-05-10");
  const [q1, q2] = cashFlow(rows, banks, cuts);
  expect(q1!.move["revenue:sales"]).toBe(500);
  expect(q1!.move["expense:software"]).toBe(-200);
  expect(q2!.start).toEqual(q1!.end);
  expect(q2!.span.mtd).toBe(true);
  expect(q2!.move).toEqual({ "expense:software": -40 }); // the May 20 sale is after today
  expect(q2!.end.Checking).toBe(860); // 900 at the end of Q1, less the April bill
});

test("statement rows: starting, movement, ending sections with totals", () => {
  const cols = cashFlow(rows, banks, spans(2026, "monthly", "2026-05-10")).slice(0, 2);
  const lines = cfaLines(
    cols,
    banks,
    (k) => k,
    (k) => k,
  );
  expect(lines.map((l) => l.kind)).toEqual([
    "head",
    "line",
    "line",
    "line",
    "sum",
    "head",
    "line",
    "line",
    "line",
    "line",
    "line",
    "sum",
    "head",
    "line",
    "line",
    "line",
    "total",
  ]);
  const by = (label: string) => lines.find((l) => l.label === label)!.v;
  expect(by("cfa.totalStarting")).toEqual([1000, 750]);
  expect(by("cfa.netMovement")).toEqual([-250, 400]);
  expect(by("cfa.totalEnding")).toEqual([750, 1150]);
  expect(lines.find((l) => l.key === "transfer:internal")!.v).toEqual([0, 0]); // present, nets to nothing
  expect(lines.find((l) => l.key === "account:Savings")!.v).toEqual([0, 300]);
});
