import { expect, test } from "vite-plus/test";
import { levers } from "./leverage.ts";

const leg = (a: string, b: string) => ({ out: { entity: "x", account: a }, in: { entity: "y", account: b } });

test("idle cash: the lowest balance of the window above 3 months of spending, at the yield rate", () => {
  const cashDaily = Array.from({ length: 90 }, (_, i) => 100_000 + (i % 7) * 1000); // never below 100k
  const [l] = levers({ cashDaily, monthlyOut: 10_000, journeys: [] });
  expect(l).toEqual({ id: "idle-cash", yearly: 2800, idle: 70_000, buffer: 30_000, rate: 0.04 });
  expect(levers({ cashDaily: cashDaily.slice(0, 10), monthlyOut: 10_000, journeys: [] })).toEqual([]); // too short to tell
});

test("transfer routes: each route's cost, and what sending all of it the cheapest way you use would save", () => {
  const ls = levers({
    cashDaily: [],
    monthlyOut: 0,
    journeys: [
      { legs: [leg("Mercury", "Hapoalim")], sent: 10_000, fee: 300 }, // 3%
      { legs: [leg("Mercury", "Wise USD"), leg("Wise USD", "One Zero")], sent: 10_000, fee: 80 }, // 0.8%
    ],
  });
  expect(ls).toHaveLength(1);
  const l = ls[0]!;
  if (l.id !== "transfer-routes") throw new Error(l.id);
  expect(l.fees).toBe(380);
  expect(l.best.route).toBe("Mercury → Wise USD → One Zero");
  expect(l.yearly).toBe(220); // the direct wire would have cost 80 the cheap way
});

test("year-end: headroom shows only from 80% of the zair ceiling", () => {
  expect(levers({ cashDaily: [], monthlyOut: 0, journeys: [], zair: { turnover: 50_000, ceiling: 122_833 } })).toEqual([]);
  expect(levers({ cashDaily: [], monthlyOut: 0, journeys: [], zair: { turnover: 110_000, ceiling: 122_833 } })[0]).toMatchObject({
    id: "year-end",
    headroom: 12_833,
  });
});
