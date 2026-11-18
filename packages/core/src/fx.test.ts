import { expect, test } from "vite-plus/test";
import { convert, currencyOf, fxOf, needed, rateOn } from "./fx.ts";

// Thu 2025-01-02, Fri 2025-01-03 published; the weekend isn't; Mon 2025-01-06 is.
const T = { USD: { "2025-01-02": 3.65, "2025-01-03": 3.656, "2025-01-06": 3.636 }, EUR: { "2025-01-03": 3.7605 } };

test("rate: the latest published on or before the date (weekend → Friday's)", () => {
  expect(rateOn(T, "USD", "2025-01-03")).toBe(3.656);
  expect(rateOn(T, "USD", "2025-01-04")).toBe(3.656); // Saturday
  expect(rateOn(T, "USD", "2025-01-05")).toBe(3.656); // Sunday
  expect(rateOn(T, "USD", "2025-01-06")).toBe(3.636);
  expect(rateOn(T, "ILS", "1999-01-01")).toBe(1);
});

test("missing: before the first rate, an unknown currency, or a cache stale past the gap is null, never 1", () => {
  expect(rateOn(T, "USD", "2025-01-01")).toBeNull();
  expect(rateOn(T, "GBP", "2025-01-03")).toBeNull();
  expect(rateOn(T, "USD", "2025-01-13")).not.toBeNull(); // 7 days after the last
  expect(rateOn(T, "USD", "2025-01-14")).toBeNull();
  expect(convert(T, 100, "USD", "GBP", "2025-01-03")).toBeNull();
  expect(fxOf(T)("GBP", "2025-01-03")).toBeNull();
});

test("cross rate through ILS", () => {
  expect(convert(T, 100, "USD", "ILS", "2025-01-03")).toBeCloseTo(365.6);
  expect(convert(T, 100, "ILS", "USD", "2025-01-03")).toBeCloseTo(100 / 3.656);
  expect(convert(T, 100, "EUR", "USD", "2025-01-04")).toBeCloseTo((100 * 3.7605) / 3.656);
  expect(convert(T, 5, "GBP", "GBP", "2025-01-03")).toBe(5); // same currency needs no rate
  expect(fxOf(T, "USD")("EUR", "2025-01-03")).toBeCloseTo(3.7605 / 3.656);
});

test("books currency and the ranges a table must cover", () => {
  expect([currencyOf({ currency: "EUR" }), currencyOf({ kind: "us-llc" }), currencyOf({})]).toEqual(["EUR", "USD", "ILS"]);
  expect(
    needed([
      { currency: "USD", date: "2025-03-01" },
      { currency: "ILS", date: "2025-01-01" },
      { currency: "USD", date: "2025-01-09" },
    ]),
  ).toEqual({ USD: ["2025-01-09", "2025-03-01"] });
});
