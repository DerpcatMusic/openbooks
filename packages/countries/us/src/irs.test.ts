import { describe, expect, it } from "vite-plus/test";
import ref from "../fixtures/irs-old-js.json";
import { ccorpObligations, corpTax, form1120, form1120ProForma, form5472, irsPeriod, partV, us, type IrsInput } from "./index.ts";

// fixtures/irs-old-js.json: web/src/lib/irs.js fill5472/fill1120 run on the real blanks (app/irs/*.pdf) for these inputs, every filled
// field read back (text → value, checked box → "X"). The hooks must give exactly the same map.
describe("IRS field maps identical to the old irs.js", () => {
  for (const [i, c] of ref.cases.entries()) {
    const d = c.input as unknown as IrsInput;
    it(`case ${i}: 5472`, () => expect(form5472(d)).toEqual(c.f5472));
    it(`case ${i}: pro forma 1120`, () => expect(form1120ProForma(d)).toEqual(c.f1120));
  }
});

describe("IRS helpers", () => {
  it("period and Part V totals", () => {
    expect(irsPeriod({ year: 2025, formed: "2025-03-07" })).toEqual({ begin: "2025-03-07", end: "2025-12-31", initial: true });
    expect(irsPeriod({ year: 2026, formed: "2025-03-07" })).toEqual({ begin: "2026-01-01", end: "2026-12-31", initial: false });
    const v = partV({
      transactions: [
        { date: "2025-05-01", desc: "b", amount: -200 },
        { date: "2025-01-01", desc: "a", amount: 500 },
      ],
    });
    expect(v.rows.map((r) => [r.desc, r.kind])).toEqual([
      ["a", "Contribution"],
      ["b", "Distribution"],
    ]);
    expect([v.contributions, v.distributions, v.total]).toEqual([500, 200, 700]);
  });
  it("C-corp 5472: line 3 and Part V off", () => {
    const f = form5472({ year: 2025, legalName: "X", transactions: [{ date: "2025-01-01", desc: "a", amount: 1 }], de: false });
    expect(f["Page1[0].c1_4[0]"]).toBeUndefined();
    expect(f["Page2[0].PartV[0].c2_6[0]"]).toBeUndefined();
    expect(f["Page1[0].Line1f_ReadOrder[0].f1_12[0]"]).toBeUndefined();
    expect(f["Page1[0].c1_3[0]"]).toBe("X");
  });
  it("C-corp 1120: income, deductions, 21% tax", () => {
    const d = { year: 2026, legalName: "Corp LLC", revenue: 100000, cogs: 10000, advertising: 5000, otherDeductions: 25000, otherIncome: 100, corpRate: 0.21 };
    expect(corpTax(d)).toEqual({ gross: 90000, income: 90100, deductions: 30000, taxable: 60100, tax: 12621 });
    const f = form1120(d);
    expect(f["Page1[0].f1_14[0]"]).toBe("100,000");
    expect(f["Page1[0].f1_18[0]"]).toBe("90,000");
    expect(f["Page1[0].f1_26[0]"]).toBe("90,100");
    expect(f["Page1[0].f1_42[0]"]).toBe("30,000");
    expect(f["Page1[0].f1_47[0]"]).toBe("60,100");
    expect(f["Page1[0].f1_48[0]"]).toBe("12,621");
    expect(form1120({ ...d, revenue: 0, cogs: 0, advertising: 0, otherDeductions: 500, otherIncome: 0 })["Page1[0].f1_48[0]"]).toBe("0");
  });
  it("C-corp obligations", () => {
    expect(ccorpObligations(2025, us.table(2025)).map((o) => [o.form, o.due])).toEqual([
      ["1120", "2026-04-15"],
      ["5472", "2026-04-15"],
      ["1042 / 1042-S", "2026-03-15"],
      ["State annual report", undefined],
    ]);
  });
});
