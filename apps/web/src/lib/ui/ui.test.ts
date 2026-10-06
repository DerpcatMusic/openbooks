import { expect, test } from "vitest";
import { moneyParts, moneyText } from "./money.ts";
import { place } from "./position.ts";

test("moneyParts: sign, symbol, grouping, cents", () => {
  expect(moneyParts(-1234.5, "ILS")).toEqual({ sign: "−", symbol: "₪", whole: "1,234", cents: "50" });
  expect(moneyParts(0.004, "USD")).toEqual({ sign: "", symbol: "$", whole: "0", cents: "00" });
  expect(moneyParts(-0.001, "USD").sign).toBe("");
  expect(moneyText(1e6, "USD", false)).toBe("$1,000,000");
});

test("place: below, flips above, clamps, RTL alignment", () => {
  const vp = { width: 375, height: 800 };
  const a = { top: 100, left: 300, width: 32, height: 32 };
  expect(place(a, { width: 200, height: 100 }, vp)).toEqual({ top: 138, left: 167 }); // start in LTR would overflow → clamped
  expect(place(a, { width: 200, height: 100 }, vp, { rtl: true })).toEqual({ top: 138, left: 132 }); // start = right edge in RTL
  expect(place({ ...a, top: 750 }, { width: 100, height: 100 }, vp).top).toBe(644); // no room below → above
  expect(place({ ...a, left: 0 }, { width: 100, height: 20 }, vp, { align: "end" }).left).toBe(8);
});
