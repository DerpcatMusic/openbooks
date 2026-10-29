import { describe, expect, it } from "vite-plus/test";
import { daysOf, defaultsFor } from "./trips.ts";

describe("trip dates", () => {
  it("days are inclusive; a bad range is 0", () => {
    expect(daysOf("2026-03-01", "2026-03-10")).toBe(10);
    expect(daysOf("2026-03-01", "2026-03-01")).toBe(1);
    expect(daysOf("2026-03-02", "2026-03-01")).toBe(0);
    expect(daysOf("", "2026-03-01")).toBe(0);
  });
  it("a new trip is one business day with no night", () => {
    expect(defaultsFor("2026-03-01", "2026-03-04")).toEqual({ start: "2026-03-01", end: "2026-03-04", nights: 3, businessDays: 4 });
  });
});
