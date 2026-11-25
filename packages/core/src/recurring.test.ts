import { expect, test } from "vite-plus/test";
import { nextDate, perMonth, recurring, recurringDismissed } from "./recurring.ts";

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
  const cad = (days: number) =>
    recurring(
      every(days, 4).map((d) => row(d, -10, "X")),
      "2025-01-06",
    )[0]?.cadence;
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

test("one charge, irregular, wildly different amounts, transfers and lapsed series are left out", () => {
  expect(recurring(monthly("A", [-10]))).toEqual([]);
  expect(recurring([row("2026-01-01", -10, "B"), row("2026-01-09", -10, "B"), row("2026-03-20", -10, "B"), row("2026-03-25", -10, "B")])).toEqual([]);
  expect(recurring(monthly("C", [-10, -80, -14, -12]))).toEqual([]);
  expect(recurring(monthly("D", [-500, -500, -500], 1, 1, "transfer:savings"))).toEqual([]);
  // lapsed: the account went on past the expected charge without it
  expect(recurring([...monthly("E", [-9, -9, -9]), row("2026-08-20", -3, "Coffee")], "2026-09-01")).toEqual([]);
});

test("income and spending from one payer are separate; the latest regular run counts", () => {
  const ts = [...monthly("Acme", [3000, 3000, 3000], 1, 10, "revenue:services"), row("2025-06-01", -5, "Acme"), row("2025-06-20", -5, "Acme")];
  const rs = recurring(ts, "2026-03-15");
  expect(rs.map((r) => [r.key, r.cadence])).toEqual([["Acme|in|3000.00", "monthly"]]);
  expect(perMonth(rs[0]!)).toBe(3000);
});

test("next date clamps month ends", () => {
  expect(nextDate("2026-01-31", "monthly")).toBe("2026-02-28");
  expect(nextDate("2026-11-30", "quarterly")).toBe("2027-02-28");
  expect(nextDate("2026-12-28", "weekly")).toBe("2027-01-04");
});

test("two charges at one price a month apart are a subscription; a payer's two plans are two series", () => {
  const rs = recurring([
    ...monthly("Anthropic", [-200, -200], 9, 3),
    ...monthly("Cloudflare", [-5, -5], 8, 30),
    ...monthly("Cloudflare", [-10.46, -10.46], 8, 20),
  ]);
  expect(rs.map((r) => [r.payer, r.amount, r.cadence])).toEqual([
    ["Anthropic", -200, "monthly"],
    ["Cloudflare", -10.46, "monthly"],
    ["Cloudflare", -5, "monthly"],
  ]);
  expect(new Set(rs.map((r) => r.key)).size).toBe(3);
});

test("a plan that changed price is one series with the change flagged", () => {
  const [r, ...rest] = recurring([
    row("2026-06-23", -9.11, "Tello"),
    row("2026-07-23", -5.95, "Tello"),
    row("2026-08-22", -5.95, "Tello"),
    row("2026-09-21", -5.95, "Tello"),
  ]);
  expect(rest).toEqual([]);
  expect(r).toMatchObject({ amount: -5.95, count: 4, priceChange: { from: -9.11, to: -5.95, date: "2026-07-23" } });
});

test("books that stopped syncing don't make a subscription look cancelled", () => {
  // the data ends 2026-10-05; today is 2026-11-25
  expect(recurring(monthly("OpenAI", [-200, -200, -200], 7, 12), "2026-11-25")).toHaveLength(1);
});

test("ad spend and one-off shopping are not subscriptions", () => {
  const fb = ["07-02", "07-03", "07-05", "07-06", "07-07", "07-09", "07-11", "07-13", "08-01"].map((d, i) =>
    row(`2026-${d}`, -[2, 4, 47, 12, 12, 25, 25, 25, 21.73][i]!, "Facebook"),
  );
  const ali = [
    row("2026-05-14", -13.16, "AliExpress"),
    row("2026-06-04", -13.3, "AliExpress"),
    row("2026-06-29", -26.12, "AliExpress"),
    row("2026-08-07", -54.76, "AliExpress"),
  ];
  expect(recurring([...fb, ...ali])).toEqual([]);
});

test("one charge at a new price continues the plan; equal charges on one day add up", () => {
  const [r, ...rest] = recurring(monthly("Notion", [-10, -10, -12]), "2026-03-10");
  expect(rest).toEqual([]);
  expect(r).toMatchObject({ amount: -12, last: "2026-03-05", next: "2026-04-05", count: 3, priceChange: { from: -10, to: -12, date: "2026-03-05" } });
  const two = recurring([...monthly("Seats", [-10, -10, -10]), ...monthly("Seats", [-10, -10, -10])], "2026-03-10");
  expect(two.map((x) => x.amount)).toEqual([-20]);
});

test("an old plan still charging is a second plan, not the new one's past; a price change counts every charge", () => {
  const rs = recurring(
    [...monthly("Cloudflare", [-10, -10, -10, -10, -10]), row("2026-04-04", -12, "Cloudflare"), row("2026-05-04", -12, "Cloudflare")],
    "2026-05-10",
  );
  expect(rs.map((r) => [r.amount, r.count, r.priceChange])).toEqual([
    [-12, 2, undefined],
    [-10, 5, undefined],
  ]);
  const [n] = recurring(monthly("Notion", [-10, -10, -10, -12, -12]), "2026-05-10");
  expect(n).toMatchObject({ count: 5, key: "Notion|out|10.00" });
});

test("a dismissal under the older payer-wide key still hides every plan of that payer", () => {
  expect(recurringDismissed("Cloudflare|out|5.00", { "Cloudflare|out": true })).toBe(true);
  expect(recurringDismissed("Cloudflare|out|5.00", { "Cloudflare|out|10.46": true })).toBe(false);
});
