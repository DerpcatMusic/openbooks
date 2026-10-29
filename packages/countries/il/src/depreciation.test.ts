import { describe, expect, it } from "vite-plus/test";
import { depreciation, guessClass } from "./depreciation.ts";
import ded from "../tables/deductions.json";

const rates = (ded.rules.find((r) => r.id === "il.depreciation")!.values as Record<string, number>) ?? {};
describe("depreciation (1342)", () => {
  it("guesses the class from the description", () => {
    expect(guessClass("MacBook Pro 14")).toBe("computersPersonal");
    expect(guessClass("Dell server")).toBe("computersOther");
    expect(guessClass("IKEA desk")).toBe("furnitureGeneral");
    expect(guessClass("Dell monitor")).toBe("electronicEquipment");
    expect(guessClass("Hyundai Ioniq", "il.vehicle.purchase")).toBe("privateCar");
    expect(guessClass("Gizmo")).toBe("electronicEquipment");
  });
  it("prorates the first year by months and keeps going until the cost is used up", () => {
    const a = [{ id: "a", date: "2025-07-10", desc: "laptop", cost: 10000 }];
    // 33%: 6 months in 2025 = 1650, 3300 in 2026 and 2027, the rest (1750) in 2028
    const y = (n: number) => depreciation(a, rates, n);
    expect(y(2024).rows).toEqual([]);
    expect(y(2025).rows[0]).toMatchObject({ months: 6, amount: 1650, accumulated: 1650, remaining: 8350 });
    expect(y(2026).rows[0]).toMatchObject({ months: 12, amount: 3300, accumulated: 4950 });
    expect(y(2027).rows[0]).toMatchObject({ amount: 3300, accumulated: 8250 });
    expect(y(2028).rows[0]).toMatchObject({ amount: 1750, accumulated: 10000, remaining: 0 });
    expect(y(2029).rows[0]).toMatchObject({ amount: 0, months: 0 });
  });
  it("totals the year and what was bought in it", () => {
    const a = [
      { id: "a", date: "2025-01-02", desc: "desk", cost: 1200 },
      { id: "b", date: "2026-03-05", desc: "monitor", cost: 2400 },
    ];
    const t = depreciation(a, rates, 2026).totals;
    expect(t).toEqual({ cost: 3600, amount: 72 + 2400 * 0.15 * (10 / 12), accumulated: 72 * 2 + 300, remaining: 3600 - 144 - 300, bought: 2400 });
  });
  it("lets the user pick the class", () => {
    const r = depreciation([{ id: "a", date: "2026-01-01", desc: "thing", cost: 1000, cls: "furnitureGeneral" }], rates, 2026).rows[0]!;
    expect(r).toMatchObject({ rate: 0.06, guessed: false, amount: 60 });
  });
});
