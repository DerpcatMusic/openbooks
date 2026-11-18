import { expect, test } from "vite-plus/test";
import { nextDate, perMonth, recurring } from "./recurring.ts";

const row = (date: string, amount: number, desc: string, category = "expense:software") => ({ date, amount, desc, category, source: "mercury" });
const monthly = (desc: string, amounts: number[], from = 1, day = 5, category?: string) =>
  amounts.map((a, i) => row(`2026-${String(from + i).padStart(2, "0")}-${String(day).padStart(2, "0")}`, a, desc, category));

test("monthly subscription with a few days of drift is found, with the next date", () => {
  const ts = [row("2026-01-03", -20, "Figma"), row("2026-02-05", -20, "Figma"), row("2026-03-02", -20, "Figma"), row("2026-04-04", -20, "Figma")];
  const [r] = recurring(ts, "2026-04-20");
  expect(r).toMatchObject({ payer: "Figma", account: "expense:software", cadence: "monthly", amount: -20, last: "2026-04-04", next: "2026-05-04", count: 4 });
  expect(r!.priceChange).toBeUndefined();
});

test("each cadence", () => {
  const every = (days: number, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2025, 0, 6 + i * days)).toISOString().slice(0, 10));
  const cad = (days: number) => recurring(every(days, 4).map((d) => row(d, -10, "X")), "2025-01-06")[0]?.cadence;
  expect(cad(7)).toBe("weekly");
  expect(cad(14)).toBe("biweekly");
  expect(cad(91)).toBe("quarterly");
  expect(cad(365)).toBe("yearly");
  expect(cad(45)).toBeUndefined();
});

test("price change is flagged after two payments at the old price", () => {
  const [r] = recurring(monthly("Notion", [-10, -10, -10, -12, -12]), "2026-05-10");
  expect(r!.priceChange).toEqual({ from: -10, to: -12, date: "2026-04-05" });
  expect(r!.amount).toBe(-12);
});

test("noisy amounts (a utility bill) are recurring but not a price change", () => {
  const [r] = recurring(monthly("Electric Co", [-100, -112, -95, -104]), "2026-04-10");
  expect(r!.cadence).toBe("monthly");
  expect(r!.priceChange).toBeUndefined();
});

test("fewer than 3, irregular, wildly different amounts, transfers and lapsed series are left out", () => {
  expect(recurring(monthly("A", [-10, -10]))).toEqual([]);
  expect(recurring([row("2026-01-01", -10, "B"), row("2026-01-09", -10, "B"), row("2026-03-20", -10, "B"), row("2026-03-25", -10, "B")])).toEqual([]);
  expect(recurring(monthly("C", [-10, -80, -10, -10]))).toEqual([]);
  expect(recurring(monthly("D", [-500, -500, -500], 1, 1, "transfer:savings"))).toEqual([]);
  expect(recurring(monthly("E", [-9, -9, -9]), "2026-09-01")).toEqual([]);
});

test("income and spending from one payer are separate; the latest regular run counts", () => {
  const ts = [...monthly("Acme", [3000, 3000, 3000], 1, 10, "revenue:services"), row("2025-06-01", -5, "Acme"), row("2025-06-20", -5, "Acme")];
  const rs = recurring(ts, "2026-03-15");
  expect(rs.map((r) => [r.key, r.cadence])).toEqual([["Acme|in", "monthly"]]);
  expect(perMonth(rs[0]!)).toBe(3000);
});

test("next date clamps month ends", () => {
  expect(nextDate("2026-01-31", "monthly")).toBe("2026-02-28");
  expect(nextDate("2026-11-30", "quarterly")).toBe("2027-02-28");
  expect(nextDate("2026-12-28", "weekly")).toBe("2027-01-04");
});
