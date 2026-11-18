import { expect, test } from "vite-plus/test";
import { bankFees, burn, cashAt, cashDelta, cashFlow, margins, pctLabel, spendVsNormal } from "./insights.ts";

const tx = (date: string, amount: number, category = "expense:software", account = "Checking") => ({ date, amount, category, account });

test("cash flow: cash accounts only (a card purchase is not cash out until the card is paid), movements between pockets are not in/out", () => {
  const ts = [
    tx("2026-01-05", 1000, "revenue:sales"),
    tx("2026-01-06", -300),
    tx("2026-01-07", -50, "expense:meals", "Visa Credit Card"),
    tx("2026-01-20", -200, "transfer:internal"),
    tx("2026-01-21", 5000, "equity:owner"),
    tx("2026-01-22", -400, "own:transfer"),
    tx("2026-01-23", 900, "personal:family"),
    tx("2026-01-24", 2000, "loan:bank"),
  ];
  expect(cashFlow(ts)).toEqual({ in: 1000, out: 300, net: 700 });
  expect(cashAt(ts, "2026-01-06")).toBe(700);
  expect(cashAt(ts, "2026-12-31")).toBe(8000);
});

test("delta: percent of the prior, the plain difference when the prior is 0", () => {
  expect(cashDelta(150, 100)).toEqual({ kind: "pct", value: 50 });
  expect(cashDelta(-50, -100)).toEqual({ kind: "pct", value: 50 }); // lost less: up 50%
  expect(cashDelta(80, 0)).toEqual({ kind: "abs", value: 80 });
  expect(cashDelta(0, 0)).toBeNull();
});

// 10k cash on 2025-12-31, then Jan..Apr 2026
const base = [tx("2025-12-31", 10000, "equity:owner")];
const month = (ym: string, net: number) => [tx(`${ym}-10`, net)];

test("burn: average of the last 3 complete months, runway = floor(cash at month end / burn)", () => {
  const ts = [...base, ...month("2026-01", -3000), ...month("2026-02", -1000), ...month("2026-03", -2000), ...month("2026-04", -9999)]; // April is in progress
  const b = burn(ts, "2026-04-15")!;
  expect(b).toMatchObject({ kind: "burn", avg: -2000, cash: 4000, runway: 2, coverage: null, months: ["2026-01", "2026-03"] });
  // floor, not round
  expect(burn([...base, ...month("2026-01", -3000), ...month("2026-02", -3000), ...month("2026-03", -3000)], "2026-04-02")!.runway).toBe(0); // cash 1000, burn 3000
  expect(burn([...base, ...month("2026-01", -1000), ...month("2026-02", -1000), ...month("2026-03", -1000)], "2026-04-02")!.runway).toBe(7); // 7000 / 1000
  expect(burn([...base, ...month("2026-01", -1000), ...month("2026-02", -1000), ...month("2026-03", -1500)], "2026-04-02")!.runway).toBe(5); // 6500 / 1166.67 = 5.57: floor, not round
});

test("burn: needs three months of history, a non-zero average, and treats negative cash as no runway", () => {
  const three = [...month("2026-01", -3000), ...month("2026-02", -1000), ...month("2026-03", -2000)];
  expect(burn(three, "2026-04-15")).toBeNull(); // first transaction is Jan 10, after the window opens on Jan 1
  expect(burn([tx("2026-01-01", 0), ...three], "2026-04-15")).not.toBeNull(); // history reaches the first day of the window
  expect(burn([tx("2025-12-01", 5), ...month("2026-01", 0), ...month("2026-02", 0), ...month("2026-03", 0)], "2026-04-15")).toBeNull(); // average exactly 0
  expect(burn([], "2026-04-15")).toBeNull();
  expect(burn([tx("2025-12-01", 1), ...three], "2026-04-15")!.cash).toBe(-5999); // overdrawn
  expect(burn([tx("2025-12-01", 1), ...three], "2026-04-15")!.runway).toBe(0);
  // January: the window is Oct-Dec of the year before
  expect(burn([tx("2025-09-01", 100), ...month("2025-10", -300), ...month("2025-11", -300), ...month("2025-12", -300)], "2026-01-05")).toMatchObject({
    avg: -300,
    months: ["2025-10", "2025-12"],
  });
});

test("build rate: positive average gives coverage = cash / average monthly expenses, no runway", () => {
  const ts = [
    tx("2025-12-01", 600, "equity:owner"),
    ...["2026-01", "2026-02", "2026-03"].flatMap((m) => [tx(`${m}-02`, 3000, "revenue:sales"), tx(`${m}-12`, -1000)]), // +2000 net, 1000 expenses a month
  ];
  const b = burn(ts, "2026-04-10")!;
  expect(b).toMatchObject({ kind: "build", avg: 2000, cash: 6600, runway: null, coverage: 6 });
  expect(burn([tx("2025-12-01", 1), ...["2026-01", "2026-02", "2026-03"].map((m) => tx(`${m}-02`, 500, "revenue:sales"))], "2026-04-10")!.coverage).toBeNull(); // no expenses
});

test("margins: only with revenue; net margin + expense ratio = 100; labels round, <1% for tiny", () => {
  expect(margins(0, 50)).toBeNull();
  expect(margins(-10, 0)).toBeNull();
  const m = margins(2000, 500)!;
  expect(m).toEqual({ net: 75, expenseRatio: 25 });
  expect(margins(1000, 1500)).toEqual({ net: -50, expenseRatio: 150 }); // loss
  expect(margins(1000, 0)).toEqual({ net: 100, expenseRatio: 0 });
  expect([pctLabel(75), pctLabel(0.4), pctLabel(0), pctLabel(-50), pctLabel(99.6), pctLabel(-0.2)]).toEqual(["75%", "<1%", "0%", "-50%", "100%", "0%"]);
});

test("spending against its own normal: average of the prior periods the books reach, null change without history", () => {
  const r = (date: string, amount: number, category = "expense:software") => ({ date, amount, category, account: "Bank" });
  const ts = [r("2026-01-10", -100), r("2026-02-10", -100), r("2026-03-10", -160), r("2026-03-11", -40, "expense:travel"), r("2026-03-12", -5, "transfer:x"), r("2026-03-13", 900, "revenue:x")];
  expect(spendVsNormal(ts, { from: "2026-03", to: "2026-03" }, 3)).toEqual([
    { key: "expense:software", value: 160, avg: 100, change: 0.6 },
    { key: "expense:travel", value: 40, avg: 0, change: null },
  ]);
  expect(bankFees([r("2026-03-01", -12, "expense:bank-fees"), r("2026-03-02", -3, "cogs:platform-fees"), r("2026-03-02", -50)])).toBe(15);
});
