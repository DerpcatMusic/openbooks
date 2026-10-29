// The deductions engine against the real research tables (packages/countries/*/tables/deductions.json).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import type { DeductionRule, TagsDoc, Txn } from "@openbooks/schema";
import { deductions, relevantMoves, searchRules, suggestTags, taggableRules, withOverrides, type DeductionInput } from "./index.ts";

const load = (c: string) => JSON.parse(readFileSync(new URL(`../../countries/${c}/tables/deductions.json`, import.meta.url), "utf8")) as { rules: DeductionRule[]; moves: never[] };
const IL = load("il"),
  US = load("us");

let n = 0;
const tx = (amount: number, over: Partial<Txn> = {}): Txn => ({
  id: `t${++n}`,
  date: "2026-03-10",
  amount: -amount,
  desc: "Shop",
  source: "bank",
  account: "main",
  file: "",
  page: 0,
  category: "expense:other",
  why: "",
  ...over,
});
const tags = (...ts: { id: string; rule?: string; pct?: number }[]): TagsDoc => ({
  groups: [],
  tags: ts.map(({ id, ...tax }) => ({ id, name: id, ...(Object.keys(tax).length ? { tax } : {}) })),
  on: {},
});
const il = (txns: Txn[], t: TagsDoc, over: Partial<DeductionInput> = {}): DeductionInput => ({ txns, tags: t, rules: IL.rules, type: "osek-murshe", year: 2026, currency: "ILS", vatRate: 0.18, ...over });
const us = (txns: Txn[], t: TagsDoc, over: Partial<DeductionInput> = {}): DeductionInput => ({ txns, tags: t, rules: US.rules, type: "llc-ccorp", year: 2026, currency: "USD", ...over });
const one = (inp: DeductionInput) => deductions(inp).rows[0]!;

describe("per transaction", () => {
  it("IL office refreshments: ₪40 · 80% deductible = ₪32, VAT not determined → 0", () => {
    const r = one(il([tx(40, { tags: ["office"] })], tags({ id: "office", rule: "il.refreshments" })));
    expect(r).toMatchObject({ gross: 40, deductible: 32, pct: 80, vatReclaimable: 0, bucket: "partial", rule: "il.refreshments", from: "tag" });
    expect(r.why.map((w) => w.k)).toContain("vatUnknown");
  });
  it("café coffee is 0% in IL; own meals too", () => {
    expect(one(il([tx(18, { tags: ["cafe"] })], tags({ id: "cafe", rule: "il.cafe-work" })))).toMatchObject({ deductible: 0, bucket: "none" });
    expect(one(il([tx(60, { tags: ["m"] })], tags({ id: "m", rule: "il.meals-own" })))).toMatchObject({ deductible: 0, bucket: "none" });
  });
  it("full bucket at 100%, with the VAT share of the invoice for a murshe; none for a patur", () => {
    const t = tags({ id: "acct", rule: "il.professional-fees" });
    const m = one(il([tx(118, { tags: ["acct"] })], t));
    expect(m).toMatchObject({ deductible: 118, bucket: "full", vatReclaimable: 18 });
    expect(one(il([tx(118, { tags: ["acct"] })], t, { type: "osek-patur" })).vatReclaimable).toBe(0);
  });
  it("a trip with a companion: the lowest-share rule wins; own costs stay deductible", () => {
    const t = tags({ id: "trip", rule: "il.travel.flights" }, { id: "her", rule: "il.travel.companion" });
    const rows = deductions(il([tx(1000, { tags: ["trip"] }), tx(1000, { tags: ["trip", "her"] })], t)).rows;
    expect(rows.map((r) => [r.deductible, r.bucket])).toEqual([
      [1000, "full"],
      [0, "none"],
    ]);
    expect(rows[1]!.tag).toBe("her");
  });
  it("tag pct multiplies a rule's share; a rule that needs a share and has none claims nothing", () => {
    expect(one(us([tx(100, { tags: ["p"] })], tags({ id: "p", rule: "us.phone", pct: 80 })))).toMatchObject({ deductible: 80, pct: 80 });
    expect(one(us([tx(100, { tags: ["m"] })], tags({ id: "m", rule: "us.meals", pct: 50 })))).toMatchObject({ deductible: 25 });
    const none = one(il([tx(100, { tags: ["i"] })], tags({ id: "i", rule: "il.internet" })));
    expect(none).toMatchObject({ deductible: 0, bucket: "none" });
    expect(none.why.map((w) => w.k)).toContain("needsPct");
    expect(one(il([tx(100, { tags: ["i"] })], tags({ id: "i", rule: "il.internet", pct: 40 }))).deductible).toBe(40);
  });
  it("a tag with only a % applies it to a plain expense; untreated expenses count in full", () => {
    expect(one(il([tx(200, { tags: ["half"] })], tags({ id: "half", pct: 25 })))).toMatchObject({ deductible: 50, bucket: "partial", from: "tag" });
    expect(one(il([tx(200)], tags()))).toMatchObject({ deductible: 200, bucket: "untreated", from: "none" });
  });
  it("US meals are 50%; solo coffee 0%; entertainment 0%", () => {
    const t = tags({ id: "client", rule: "us.meals" }, { id: "solo", rule: "us.meals.solo" }, { id: "show", rule: "us.entertainment" });
    expect(deductions(us([tx(80, { tags: ["client"] }), tx(5, { tags: ["solo"] }), tx(300, { tags: ["show"] })], t)).rows.map((r) => r.deductible)).toEqual([40, 0, 0]);
  });
  it("the account's default rule applies without a tag; a tag's rule wins over it", () => {
    const t = tags({ id: "x", rule: "us.entertainment" });
    const accountRules = { "expense:meals": "us.meals" };
    expect(deductions(us([tx(100, { category: "expense:meals" }), tx(100, { category: "expense:meals", tags: ["x"] })], t, { accountRules })).rows.map((r) => [r.from, r.deductible])).toEqual([
      ["account", 50],
      ["tag", 0],
    ]);
  });
  it("only outflows on expense / cost accounts of the year count", () => {
    const ts = [tx(10), tx(10, { category: "cogs:hosting" }), tx(10, { category: "personal:family" }), tx(10, { date: "2025-12-31" }), { ...tx(10), amount: 10 }, tx(10, { category: "ask" })];
    expect(deductions(il(ts, tags())).totals).toMatchObject({ n: 2, gross: 20, deductible: 20, nonDeductible: 0 });
  });
});

describe("rules with their own formula", () => {
  const mobile = (costs: number[], pct?: number) => {
    const t = tags({ id: "ph", rule: "il.phone.mobile", ...(pct === undefined ? {} : { pct }) });
    return deductions(il(costs.map((c) => tx(c, { tags: ["ph"] })), t));
  };
  it("IL mobile: not deductible = the lower of 50% and ₪1,380 a year, and a use-% doesn't stack", () => {
    expect(mobile([2000]).totals.deductible).toBe(1000);
    expect(mobile([1500, 1500]).totals.deductible).toBe(1620);
    expect(mobile([3000], 10).totals.deductible).toBe(1620);
    expect(mobile([3000], 10).rows[0]!.why.map((w) => w.k)).toContain("pctIgnored");
  });
  it("IL private car: max(45%, costs − the year's shovi); 45% when the car's price is unknown", () => {
    const t = tags({ id: "car", rule: "il.vehicle.running" }, { id: "pk", rule: "il.parking-tolls" });
    const run = (facts?: DeductionInput["facts"]) => deductions(il([tx(15000, { tags: ["car"] }), tx(5000, { tags: ["pk"] })], t, { facts })).totals.deductible;
    expect(run()).toBe(9000);
    expect(run({ carPrice: 30000 })).toBe(11072); // shovi 12 × 2.48% × 30,000 = 8,928
    expect(run({ carPrice: 200000 })).toBe(9000); // shovi above the costs: the 45% floor
  });
  it("IL home landline: the lower of 80% and cost − ₪2,700; cost − ₪5,300 above ₪26,600", () => {
    const t = tags({ id: "l", rule: "il.phone.landline-home" });
    const d = (c: number) => deductions(il([tx(c, { tags: ["l"] })], t)).totals.deductible;
    expect([d(1000), d(5000), d(30000)]).toEqual([0, 2300, 24700]);
  });
  it("per-recipient and yearly ceilings (first come first served), only in the cap's currency", () => {
    const t = tags({ id: "gift", rule: "il.gifts" }, { id: "kh", rule: "il.keren-hishtalmut" });
    const g = deductions(il([tx(200, { desc: "Dana", tags: ["gift"] }), tx(100, { desc: "Dana", tags: ["gift"] }), tx(100, { desc: "Ron", tags: ["gift"] })], t));
    expect(g.rows.map((r) => r.deductible)).toEqual([200, 40, 100]);
    expect(g.rows[1]).toMatchObject({ capped: true, bucket: "partial" });
    expect(g.caps).toEqual([{ rule: "il.gifts", per: "recipient", amount: 240, used: 240, over: 1 }]);
    const k = deductions(il([tx(10000, { tags: ["kh"] }), tx(5000, { tags: ["kh"] })], t));
    expect(k.rows.map((r) => r.deductible)).toEqual([10000, 3202]);
    expect(deductions(il([tx(300, { tags: ["gift"] })], t, { currency: "USD" })).rows[0]!.deductible).toBe(300); // a ₪ cap isn't applied to dollars
    const u = deductions(us([tx(20, { desc: "Ann", tags: ["gift"] }), tx(20, { desc: "Ann", tags: ["gift"] })], tags({ id: "gift", rule: "us.gifts" })));
    expect(u.rows.map((r) => r.deductible)).toEqual([20, 5]);
  });
  it("trip-day caps are shown but not enforced", () => {
    const r = one(il([tx(5000, { tags: ["h"] })], tags({ id: "h", rule: "il.travel.lodging" })));
    expect(r.deductible).toBe(5000);
    expect(r.why).toContainEqual({ k: "capUnchecked", w: "day" });
  });
});

describe("totals, buckets, tax effect, evidence", () => {
  const t = tags({ id: "cafe", rule: "il.cafe-work" }, { id: "office", rule: "il.refreshments" }, { id: "sw", rule: "il.software" });
  const ts = [tx(100, { tags: ["cafe"] }), tx(100, { tags: ["office"] }), tx(100, { tags: ["sw"] }), tx(100)];
  it("buckets and totals; the deductible total is what the calculators take instead of the raw sum", () => {
    const r = deductions(il(ts, t));
    expect(r.byBucket).toEqual({
      full: { n: 1, gross: 100, deductible: 100 },
      partial: { n: 1, gross: 100, deductible: 80 },
      none: { n: 1, gross: 100, deductible: 0 },
      untreated: { n: 1, gross: 100, deductible: 100 },
    });
    expect(r.totals).toMatchObject({ gross: 400, deductible: 280, nonDeductible: 120 });
    expect(r.byRule.map((x) => x.rule).sort()).toEqual(["il.cafe-work", "il.refreshments", "il.software"]);
  });
  it("tax effect: not on the zair track, not for a foreign-owned US LLC without a US trade, unless attested", () => {
    expect(deductions(il(ts, t, { type: "osek-zair" }))).toMatchObject({ taxEffect: false, effect: "zair" });
    expect(deductions(il(ts, t)).taxEffect).toBe(true);
    expect(deductions(us([], tags(), { type: "llc-disregarded" }))).toMatchObject({ taxEffect: false, effect: "noEci" });
    expect(deductions(us([], tags(), { type: "llc-disregarded", facts: { usTrade: true } })).taxEffect).toBe(true);
    expect(deductions(us([], tags(), { type: "llc-ccorp" })).taxEffect).toBe(true);
  });
  it("every US business type gets the US rules: the same meals cut, whatever the entity", () => {
    const meal = [tx(100, { desc: "Client dinner", category: "expense:meals", tags: ["m"] })];
    for (const type of ["llc-disregarded", "llc-ccorp", "llc-partnership"]) {
      expect(taggableRules(US.rules, type).length, type).toBeGreaterThan(20);
      const r = deductions(us(meal, tags({ id: "m", rule: "us.meals" }), { type, facts: { usTrade: true } }));
      expect(r.totals.deductible, type).toBe(50);
      expect(r.totals.nonDeductible, type).toBe(50);
    }
  });
  it("receipt needed: deductible money with no attachment; the rule's evidence travels with the row", () => {
    const x = tx(100, { tags: ["sw"] }),
      y = tx(100, { tags: ["sw"] });
    const r = deductions(il([x, y], t, { attachments: { [y.id]: ["inv.pdf"] } })).rows;
    expect(r.map((z) => z.receipt)).toEqual([true, false]);
    expect(r[0]!.evidence.length).toBeGreaterThan(0);
    expect(deductions(il([tx(50, { tags: ["cafe"] })], t)).rows[0]!.receipt).toBe(false); // nothing deductible, nothing to prove
  });
  it("a rule that doesn't apply to the business type, or a deleted tag, is ignored", () => {
    expect(one(il([tx(100, { tags: ["z"] })], tags({ id: "z", rule: "us.meals" }))).bucket).toBe("untreated");
    expect(one(il([tx(100, { tags: ["z"] })], tags({ id: "z", rule: "il.bl-deduction" }))).bucket).toBe("untreated");
    expect(one(il([tx(100, { tags: ["gone"] })], tags())).bucket).toBe("untreated");
  });
  it("per-books overrides replace a rule's numbers", () => {
    const rules = withOverrides(IL.rules, { "il.refreshments": { incomeTaxPct: 50 } });
    expect(one(il([tx(100, { tags: ["office"] })], t, { rules })).deductible).toBe(50);
  });
});

describe("suggestions and moves", () => {
  it("untagged outflows whose text matches a rule, grouped, with the money at stake", () => {
    const ts = [
      tx(30, { desc: "ARIA CAFE TLV" }),
      tx(20, { desc: "Starbucks" }),
      tx(500, { desc: "Steam purchase" }), // "tea" inside a word is not tea
      tx(90, { desc: "Hotel Booking.com Rome", category: "ask" }),
      tx(40, { desc: "Aroma קפה", tags: ["done"] }),
    ];
    const s = suggestTags(il(ts, tags({ id: "done", rule: "il.cafe-work" })));
    expect(s).toEqual([
      { rule: "il.travel.lodging", kind: "uncategorized", ids: [ts[3]!.id], gross: 90, deductible: 90 },
      { rule: "il.cafe-work", kind: "expense", ids: [ts[0]!.id, ts[1]!.id], gross: 50, deductible: 0 },
    ]);
  });
  it("a tie goes to the lowest share; a rule that needs your % gives no amount", () => {
    expect(suggestTags(us([tx(5, { desc: "Cafe Nero" })], tags()))[0]).toMatchObject({ rule: "us.meals.solo", deductible: 0 });
    expect(suggestTags(il([tx(120, { desc: "HOT fiber internet" })], tags()))[0]).toMatchObject({ rule: "il.internet", deductible: null, gross: 120 });
  });
  it("moves split into those that fit the type and expenses, and the rest", () => {
    const m = relevantMoves(IL.moves, "osek-zair", ["il.cafe-work"]);
    const ids = m.relevant.map((x) => x.id);
    expect(ids).toContain("il.move.refreshments-office");
    expect(ids).toContain("il.move.keep-receipts-when-zair");
    expect(ids).not.toContain("il.move.gifts-cap");
    expect(ids).not.toContain("il.move.allocation-number"); // murshe / ltd only
    expect(m.relevant.length + m.other.length).toBe(IL.moves.length);
    expect(relevantMoves(US.moves, "llc-disregarded", []).relevant.map((x) => x.id)).toEqual(["us.move.eci-election"]);
  });
  it("rule search by label, id or keyword, in either language", () => {
    expect(searchRules(IL.rules, "refresh", "en")[0]!.id).toBe("il.refreshments");
    expect(searchRules(IL.rules, "כיבוד", "he").map((r) => r.id)).toContain("il.refreshments");
    expect(searchRules(IL.rules, "nespresso", "en").map((r) => r.id)).toEqual(["il.refreshments"]);
    expect(taggableRules(IL.rules, "ltd").some((r) => r.id === "il.bl-deduction")).toBe(false);
  });
});
