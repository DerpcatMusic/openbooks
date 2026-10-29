import { describe, expect, it } from "vite-plus/test";
import { blAdvances, blMonthly, paidTotal, taxAdvances, withPaid, type PaidAdvance } from "./advances.ts";
import t2026 from "../tables/2026.json";

const T = t2026 as unknown as Parameters<typeof blMonthly>[0];
// 10,000 in January, 20,000 in February, 5,000 in every other month
const turn = (from: string, to: string) => {
  let s = 0;
  for (let m = +from.slice(5, 7); m <= +to.slice(5, 7); m++) s += m === 1 ? 10000 : m === 2 ? 20000 : 5000;
  return s;
};
describe("advances", () => {
  it("monthly tax advances: the 15th of the following month, rate times last month's turnover", () => {
    const r = taxAdvances(2026, "monthly", 5, turn);
    expect(r).toHaveLength(12);
    expect(r[0]).toMatchObject({ id: "tax:2026-02", from: "2026-01-01", to: "2026-01-31", base: 10000, amount: 500 });
    expect(r[0]!.due).toBe("2026-02-15"); // Sunday
    expect(r[1]).toMatchObject({ id: "tax:2026-03", base: 20000, amount: 1000 });
    expect(r[11]).toMatchObject({ id: "tax:2027-01", from: "2026-12-01", to: "2026-12-31", amount: 250 });
    expect(r[11]!.due >= "2027-01-15").toBe(true);
  });
  it("bimonthly: six advances from 15 March on two months' turnover", () => {
    const r = taxAdvances(2026, "bimonthly", 5, turn);
    expect(r.map((x) => x.id)).toEqual(["tax:2026-03", "tax:2026-05", "tax:2026-07", "tax:2026-09", "tax:2026-11", "tax:2027-01"]);
    expect(r[0]).toMatchObject({ from: "2026-01-01", to: "2026-02-28", base: 30000, amount: 1500 });
  });
  it("Bituach Leumi: reduced rate up to the ceiling, full above, base clamped to the table", () => {
    const low = blMonthly(T, 1000);
    expect(low.base).toBe(T.blMinMonthly);
    const mid = blMonthly(T, 10000);
    // 7703 at reduced (4.47% + 3.23%), 2297 at full (12.83% + 5.17%)
    expect(mid.total).toBe(Math.round(7703 * (0.0447 + 0.0323) + 2297 * (0.1283 + 0.0517)));
    expect(blMonthly(T, 1e6).base).toBe(T.blMaxMonthly);
    const r = blAdvances(2026, T, 10000);
    expect(r).toHaveLength(12);
    expect(r[0]).toMatchObject({ id: "bl:2026-01", due: "2026-02-15" });
    expect(r[11]!.due).toBe("2027-01-15");
  });
  it("tracks what was paid", () => {
    const rows = taxAdvances(2026, "monthly", 5, turn);
    const paid: PaidAdvance[] = [
      { id: "p1", kind: "tax", row: "tax:2026-02", year: 2026, date: "2026-02-15", amount: 500, txn: "t1" },
      { id: "p2", kind: "tax", row: "tax:2026-03", year: 2026, date: "2026-03-16", amount: 400 },
      { id: "p3", kind: "bl", row: "", year: 2026, date: "2026-02-15", amount: 800 },
    ];
    const w = withPaid(rows, paid);
    expect(w[0]).toMatchObject({ paid: 500, open: 0 });
    expect(w[1]).toMatchObject({ paid: 400, open: 600 });
    expect(paidTotal(paid, 2026, "tax")).toBe(900);
    expect(paidTotal(paid, 2026, "bl")).toBe(800);
    expect(paidTotal(paid, 2025, "tax")).toBe(0);
  });
});
