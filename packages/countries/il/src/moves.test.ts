import { expect, test } from "vite-plus/test";
import { il, ilPlan, MOVES, runMove, usEstateTaxNra, type IlRates, type MoveCtx } from "./index.ts";

const T = il.table(2026) as IlRates;
const base = { turnover: 300_000, expenses: 60_000, zair: false, points: 2.25, pension: 0, donations: 0, selfEmployed: true };
const c: MoveCtx = { base, T, fx: 3.7 };
const move = (id: string) => MOVES.find((m) => m.id === id)!;

test("every move runs on its defaults and gives a sane number", () => {
  for (const m of MOVES) {
    const r = runMove(m, {}, c);
    expect(r, m.id).not.toBeNull();
    expect(Number.isFinite(r!.now), m.id).toBe(true);
  }
  expect(new Set(MOVES.map((m) => m.id)).size).toBe(MOVES.length);
});

test("expense moves equal the plan's own difference, and are zero on the zair track", () => {
  const gear = runMove(move("gear"), { cost: 12_000, rate: 100, months: 12 }, c)!;
  expect(gear.now).toBe(Math.round(ilPlan(base, T).total - ilPlan({ ...base, expenses: 72_000 }, T).total));
  expect(runMove(move("trip"), {}, { ...c, base: { ...base, zair: true } })!.now).toBe(0);
  expect(runMove(move("trip"), {}, { ...c, fx: null })).toBeNull(); // no dollar rate, no dollar maths
});

test("borrow vs sell, treaty, and the US estate table", () => {
  expect(runMove(move("borrow"), { amount: 100_000, gain: 40, rate: 0, years: 1, ret: 10 }, c)).toEqual({ now: 10_000, later: 1000, deferred: true });
  expect(runMove(move("treaty"), { royalties: 10_000, withheld: 30 }, c)!.now).toBe(7400); // 20% of $10k at 3.7
  expect(usEstateTaxNra(60_000)).toBe(0); // the exemption
  expect(usEstateTaxNra(100_000)).toBe(23_800 - 13_000);
});

test("rent: below the exemption ceiling the exempt track wins; nothing is saved when there is no rent", () => {
  expect(runMove(move("rent"), { rent: 0, costs: 0 }, c)!.now).toBe(0);
  expect(runMove(move("rent"), { rent: 5000, costs: 0 }, c)!.now).toBeGreaterThan(0);
});
