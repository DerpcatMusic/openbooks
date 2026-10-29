// Trips against the real research tables: every cap rule of docs/tax-research-{il,us}.md.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import type { DeductionRule, TagsDoc, Txn } from "@openbooks/schema";
import {
  allocates274c,
  deductions,
  roleOf,
  tripDeduction,
  tripMembers,
  tripProblem,
  type DeductionInput,
  type Trip,
  type TripCost,
  type TripRole,
} from "./index.ts";

const load = (c: string) =>
  (JSON.parse(readFileSync(new URL(`../../countries/${c}/tables/deductions.json`, import.meta.url), "utf8")) as { rules: DeductionRule[] }).rules;
const IL = load("il"),
  US = load("us");
const trip = (over: Partial<Trip> = {}): Trip => ({
  id: "tr",
  name: "Trip",
  start: "2026-03-01",
  end: "2026-03-10",
  country: "TH",
  nights: 9,
  businessDays: 10,
  purpose: "Conference",
  ...over,
});
const cost = (role: TripRole, gross: number, id = `${role}-${gross}`): TripCost => ({ id, role, gross });
const ilx = (currency = "ILS", year = 2026) => ({ country: "il" as const, year, currency, rule: (id: string) => IL.find((r) => r.id === id) });
const usx = (currency = "USD", year = 2026) => ({ country: "us" as const, year, currency, rule: (id: string) => US.find((r) => r.id === id) });
const part = (r: ReturnType<typeof tripDeduction>, role: TripRole) => r.parts.find((p) => p.role === role && p.gross > 0)!;

describe("Israel: travel abroad (reg. 2(2))", () => {
  it("lodging: $365 a night for the first 7 nights, then 75% (max $273.75) of a night dearer than $160", () => {
    // 9 nights at $400 = ₪1,400 at 3.5
    const r = tripDeduction(trip({ fx: 3.5 }), [cost("lodging", 12600)], ilx());
    expect(part(r, "lodging").deductible).toBe(10858.75); // 7 x 365 x 3.5 + 2 x 273.75 x 3.5
    expect(part(r, "lodging").cap).toBe(10858.75);
    expect(r.deductible).toBe(10858.75);
  });
  it("a night under the cap is deductible in full", () => {
    const r = tripDeduction(trip({ fx: 3.5, nights: 5, end: "2026-03-06", businessDays: 6 }), [cost("lodging", 5 * 100 * 3.5)], ilx());
    expect(part(r, "lodging").deductible).toBe(1750);
  });
  it("nights 8-90: a night up to $160 is whole; over 90 nights every night is capped at $160", () => {
    expect(part(tripDeduction(trip({ fx: 1, nights: 9, end: "2026-03-10" }), [cost("lodging", 9 * 150)], ilx("USD")), "lodging").deductible).toBe(1350);
    const long = tripDeduction(
      trip({ fx: 1, start: "2026-01-01", end: "2026-04-10", nights: 100, businessDays: 101 }),
      [cost("lodging", 100 * 200)],
      ilx("USD"),
    );
    expect(part(long, "lodging").deductible).toBe(16000);
  });
  it("25% higher caps in the listed countries (France): $456.25 first 7 nights, nights 8+ at 75% up to $342.19", () => {
    const r = tripDeduction(trip({ country: "FR", fx: 3.5 }), [cost("lodging", 12600)], ilx());
    expect(r.uplift).toBe(true);
    expect(part(r, "lodging").deductible).toBe(11900); // 7 x 400 + 2 x 300 (below the raised cap), at 3.5
    const dear = tripDeduction(trip({ country: "FR", fx: 1 }), [cost("lodging", 9 * 700)], ilx("USD"));
    expect(part(dear, "lodging").deductible).toBe(7 * 456.25 + 2 * 342.19); // rounded to the cent
  });
  it("other expenses: $102 a day of stay with lodging, $171 on days without; the books' currency at the trip's rate", () => {
    // 10 days away, 9 nights: 9 days with lodging, 1 without = (918 + 171) x 3.5 = 3811.50
    const r = tripDeduction(trip({ fx: 3.5 }), [cost("meals", 5000)], ilx());
    expect(part(r, "meals")).toMatchObject({ deductible: 3811.5, cap: 3811.5 });
    expect(part(tripDeduction(trip({ fx: 3.5 }), [cost("meals", 1000)], ilx()), "meals").deductible).toBe(1000); // under the cap
  });
  it("car rental: $80 a day for the days with a car", () => {
    const r = tripDeduction(trip({ fx: 3.5, carDays: 5 }), [cost("carRental", 2000)], ilx());
    expect(part(r, "carRental")).toMatchObject({ deductible: 1400, cap: 1400 });
    expect(part(tripDeduction(trip({ fx: 3.5 }), [cost("carRental", 2000)], ilx()), "carRental").cap).toBe(2800); // default: the business days
  });
  it("a mixed trip: lodging, daily allowance and the car only for the business days", () => {
    const r = tripDeduction(trip({ fx: 3.5, businessDays: 4 }), [cost("lodging", 12600), cost("meals", 5000), cost("carRental", 2000)], ilx());
    expect(r.mixed).toBe(true);
    expect(part(r, "lodging").deductible).toBe(5110); // 4 nights at ₪1,277.50 (the $365 cap)
    expect(part(r, "meals").cap).toBe(1428); // 4 days with lodging x $102 x 3.5
    expect(part(r, "carRental").cap).toBe(1120); // 4 days x $80 x 3.5
  });
  it("flights: whole when business is the main purpose, else by business days; a companion's flight is nothing", () => {
    expect(part(tripDeduction(trip({ businessDays: 6 }), [cost("transport", 1000)], ilx()), "transport").deductible).toBe(1000);
    expect(part(tripDeduction(trip({ businessDays: 3 }), [cost("transport", 1000)], ilx()), "transport").deductible).toBe(300);
    const c = tripDeduction(trip({ companion: true }), [cost("transport", 1000, "mine"), cost("companion", 1000, "hers")], ilx());
    expect(c.lines).toMatchObject({ mine: { deductible: 1000 }, hers: { deductible: 0 } });
  });
  it("a companion: a shared room costs no more than the single price (₪1,000 a night here)", () => {
    const r = tripDeduction(trip({ fx: 3.5, companion: true, singleRoom: 1000 }), [cost("lodging", 12600)], ilx());
    // 7 nights at 1,000 + 2 nights where $285.71 becomes 75% = $214.29 (₪750)
    expect(part(r, "lodging").deductible).toBe(8500);
    expect(part(r, "lodging").why.map((w) => w.k)).toContain("singleRoom");
    expect(part(tripDeduction(trip({ fx: 3.5, companion: true }), [cost("lodging", 12600)], ilx()), "lodging").why.map((w) => w.k)).toContain(
      "singleRoomUnknown",
    );
  });
  it("without a rate for the dollar caps nothing is capped, and the result says so", () => {
    const r = tripDeduction(trip(), [cost("lodging", 12600), cost("meals", 5000)], ilx());
    expect(r.fxMissing).toBe(true);
    expect(part(r, "lodging").deductible).toBe(12600);
    expect(part(r, "lodging").why[0]!.k).toBe("fxMissing");
    expect(tripDeduction(trip(), [cost("lodging", 100)], ilx("USD")).fxMissing).toBe(false); // dollar books need no rate
  });
  it("a trip inside Israel is not 'abroad': no dollar caps, meals are private (s.32(1))", () => {
    const r = tripDeduction(trip({ country: "IL" }), [cost("lodging", 9000), cost("meals", 800)], ilx());
    expect(r.deductible).toBe(9000);
    expect(part(r, "meals").deductible).toBe(0);
    expect(r.fxMissing).toBe(false);
  });
  it("uses the year's column of the table (2025: $355 for the first nights)", () => {
    const r = tripDeduction(trip({ fx: 1, nights: 1, end: "2025-03-02", start: "2025-03-01", businessDays: 2 }), [cost("lodging", 500)], ilx("USD", 2025));
    expect(part(r, "lodging").deductible).toBe(355);
  });
});

describe("United States: §162(a)(2), §274(c), §274(n)", () => {
  const us = (over: Partial<Trip> = {}) => trip({ country: "US", start: "2026-05-01", end: "2026-05-06", nights: 5, businessDays: 6, ...over });
  it("a domestic business trip: lodging actual, travel meals 50%, fare in full", () => {
    const r = tripDeduction(us(), [cost("lodging", 1000), cost("meals", 300), cost("transport", 400)], usx());
    expect(r.deductible).toBe(1550);
    expect(part(r, "meals").deductible).toBe(150);
  });
  it("a domestic mixed trip: lodging and meals for the business days; fare only when business is the main purpose", () => {
    const personal = tripDeduction(us({ businessDays: 2 }), [cost("lodging", 1000), cost("meals", 300), cost("transport", 400)], usx());
    expect(part(personal, "lodging").deductible).toBe(400);
    expect(part(personal, "meals").deductible).toBe(50);
    expect(part(personal, "transport").deductible).toBe(0);
    const main = tripDeduction(us({ businessDays: 4 }), [cost("lodging", 1000), cost("transport", 400)], usx());
    expect(part(main, "lodging").deductible).toBe(800);
    expect(part(main, "transport").deductible).toBe(400);
  });
  it("§274(c): a foreign trip over 7 consecutive days with 25% or more personal is allocated by business days", () => {
    expect(allocates274c(10, 6)).toBe(true);
    expect(allocates274c(10, 9)).toBe(false); // 10% personal
    expect(allocates274c(8, 2)).toBe(false); // 7 days not counting the day you leave
    expect(allocates274c(9, 6)).toBe(true); // 8 days counted, 33% personal
    expect(allocates274c(10, 8)).toBe(false); // 20% personal
    expect(allocates274c(10, 7.5)).toBe(true); // exactly 25% personal is not "under 25%"
    const fares = (over: Partial<Trip>) =>
      part(tripDeduction(us({ country: "GB", start: "2026-05-01", end: "2026-05-10", nights: 9, ...over }), [cost("transport", 1000)], usx()), "transport");
    expect(fares({ businessDays: 6 }).deductible).toBe(600);
    expect(fares({ businessDays: 9 }).deductible).toBe(1000);
    expect(fares({ end: "2026-05-08", businessDays: 3 }).deductible).toBe(1000); // 8 days: the 7-day exception
  });
  it("a companion who isn't an employee: nothing for them, a shared room at the single rate", () => {
    const r = tripDeduction(us({ companion: true, singleRoom: 150 }), [cost("lodging", 1000), cost("companion", 500, "her")], usx());
    expect(part(r, "lodging").deductible).toBe(750); // 5 nights x $150
    expect(r.lines.her!.deductible).toBe(0);
  });
  it("M&IE per diem instead of actual meals: 50% of $68, 75% of the rate on the first and last day", () => {
    const eff = (68 * 4.5 * 0.5).toFixed(2); // 5 business days
    const none = tripDeduction(us({ businessDays: 5, perDiem: true }), [], usx());
    expect(none.unlinked).toBe(+eff);
    expect(none.deductible).toBe(+eff);
    const some = tripDeduction(us({ businessDays: 5, perDiem: true }), [cost("meals", 100)], usx());
    expect(some.parts.find((p) => p.gross > 0)!.deductible).toBe(100);
    expect(some.unlinked).toBe(53);
    expect(some.deductible).toBe(+eff);
    expect(tripDeduction(us({ businessDays: 5, perDiem: true, mie: 92 }), [], usx()).unlinked).toBe(207);
  });
});

describe("rows, roles and validation", () => {
  it("each linked row gets its share of the part; the cents add up", () => {
    const r = tripDeduction(trip({ fx: 3.5 }), [cost("meals", 3000, "a"), cost("meals", 2000, "b")], ilx());
    expect(r.lines.a!.deductible + r.lines.b!.deductible).toBe(3811.5);
    expect(r.lines.a!.deductible).toBe(2286.9);
  });
  it("role: the trip's choice, then the tax rule, then the text", () => {
    const t = trip({ roles: { x: "carRental" } });
    expect(roleOf(t, "x", "il.travel.lodging", "Hotel")).toBe("carRental");
    expect(roleOf(t, "y", "il.travel.lodging", "Whatever")).toBe("lodging");
    expect(roleOf(t, "y", undefined, "Hertz Rent a Car Munich")).toBe("carRental");
    expect(roleOf(t, "y", undefined, "Hotel Adlon Berlin")).toBe("lodging");
    expect(roleOf(t, "y", undefined, "Lufthansa LH 1234")).toBe("transport");
    expect(roleOf(t, "y", undefined, "Zweite Gaststatte restaurant")).toBe("meals");
    expect(roleOf(t, "y", undefined, "Conference fee")).toBe("other");
  });
  it("members: listed ids or a tag; the first trip wins", () => {
    const a = trip({ id: "a", txns: ["t1"] }),
      b = trip({ id: "b", tags: ["g"], txns: ["t1"] });
    const m = tripMembers([a, b], [{ id: "t1" }, { id: "t2", tags: ["g"] }, { id: "t3" }]);
    expect([...m].map(([k, v]) => `${k}:${v.id}`)).toEqual(["t1:a", "t2:b"]);
  });
  it("tripProblem", () => {
    expect(tripProblem(trip())).toBeNull();
    expect(tripProblem(trip({ name: " " }))).toBe("name");
    expect(tripProblem(trip({ end: "2026-02-28" }))).toBe("dates");
    expect(tripProblem(trip({ country: "Germany" }))).toBe("country");
    expect(tripProblem(trip({ nights: 11 }))).toBe("nights");
    expect(tripProblem(trip({ businessDays: 11 }))).toBe("businessDays");
    expect(tripProblem(trip({ fx: 0 }))).toBe("fx");
    expect(tripProblem(trip({ carDays: 11 }))).toBe("carDays");
  });
});

describe("in the deductions engine", () => {
  let n = 0;
  const tx = (amount: number, desc: string, over: Partial<Txn> = {}): Txn => ({
    id: `x${++n}`,
    date: "2026-03-05",
    amount: -amount,
    desc,
    source: "bank",
    account: "main",
    file: "",
    page: 0,
    category: "expense:travel",
    why: "",
    ...over,
  });
  const tags: TagsDoc = {
    groups: [],
    tags: [
      { id: "trip-de", name: "Berlin" },
      { id: "life", name: "Not a trip", tax: { pct: 50 } },
    ],
    on: {},
  };
  const input = (txns: Txn[], trips: Trip[], over: Partial<DeductionInput> = {}): DeductionInput => ({
    txns,
    tags,
    rules: IL,
    type: "osek-murshe",
    year: 2026,
    currency: "ILS",
    vatRate: 0.18,
    trips,
    ...over,
  });
  it("linked costs take the trip's caps instead of the 'unchecked' note; roles come from the text", () => {
    const ts = [tx(12600, "Hotel Adlon Berlin", { tags: ["trip-de"] }), tx(5000, "Restaurants Berlin", { tags: ["trip-de"] }), tx(800, "Office chair")];
    const res = deductions(input(ts, [trip({ id: "b", name: "Berlin", country: "DE", fx: 3.5, tags: ["trip-de"] })]));
    const [hotel, food, chair] = res.rows;
    expect(hotel).toMatchObject({ trip: "b", from: "trip", rule: "il.travel.lodging" });
    expect(hotel!.deductible).toBeCloseTo(11900, 2); // Germany: caps x1.25, so 7 x $400 + 2 x $300
    expect(food!.deductible).toBe(4764.38); // 3,811.50 x 1.25
    expect(food!.why.map((w) => w.k)).toContain("trip.ilPerDiem");
    expect(food!.why.map((w) => w.k)).not.toContain("capUnchecked");
    expect(chair).toMatchObject({ deductible: 800 });
    expect(res.trips).toHaveLength(1);
    expect(res.trips[0]!.country).toBe("il");
    expect(res.totals.deductible).toBe(17464.38);
  });
  it("linked by id, a US trip; a trip that started in another year is not applied", () => {
    const ts = [tx(1000, "Marriott hotel", { id: "h1", date: "2026-05-02" }), tx(400, "Delta flight", { id: "f1", date: "2026-05-01" })];
    const t = trip({ id: "u", country: "US", start: "2026-05-01", end: "2026-05-06", nights: 5, businessDays: 2, txns: ["h1", "f1"] });
    const res = deductions(input(ts, [t], { rules: US, type: "llc-ccorp", currency: "USD" }));
    expect(res.rows.map((r) => r.deductible)).toEqual([400, 0]);
    expect(res.rows.map((r) => r.id)).toEqual(["h1", "f1"]);
    expect(deductions(input(ts, [{ ...t, start: "2025-05-01", end: "2025-05-06" }], { rules: US, type: "llc-ccorp", currency: "USD" })).trips).toEqual([]);
  });
  it("a companion tag still wins on its own (tag rule 0%) when the cost is on a trip", () => {
    const t2: TagsDoc = { ...tags, tags: [...tags.tags, { id: "her", name: "Companion", tax: { rule: "il.travel.companion" } }] };
    const ts = [tx(2000, "El Al flight", { tags: ["trip-de", "her"] }), tx(2000, "El Al flight", { tags: ["trip-de"] })];
    const res = deductions(input(ts, [trip({ id: "b", country: "DE", fx: 3.5, tags: ["trip-de"] })], { tags: t2 }));
    expect(res.rows.map((r) => r.deductible)).toEqual([0, 2000]);
  });
});
