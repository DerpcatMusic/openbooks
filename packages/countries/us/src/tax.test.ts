import { describe, expect, it } from "vite-plus/test";
import {
  corpEstimates,
  esWorksheet,
  estimatedTaxes,
  estimateDates,
  incomeTax,
  mileageDeduction,
  nextBusinessDay,
  personalTax,
  qbiDeduction,
  seTax,
  us,
  usDeadlines,
} from "./index.ts";

const T25 = us.table(2025).fed,
  T26 = us.table(2026).fed;

describe("federal brackets match the IRS rate tables (Rev. Proc. 2025-32 / 2024-40, 'plus' amounts)", () => {
  it("2026 single, at each bracket top", () => {
    for (const [income, tax] of [
      [12400, 1240],
      [50400, 5800],
      [105700, 17966],
      [201775, 41024],
      [256225, 58448],
      [640600, 192979],
    ] as const)
      expect(incomeTax(T26, "single", income)).toBe(tax);
    expect(incomeTax(T26, "single", 100000)).toBe(16712);
  });
  it("2026 joint, head of household and separate", () => {
    expect(incomeTax(T26, "mfj", 211400)).toBe(35932);
    expect(incomeTax(T26, "mfj", 768700)).toBe(206584); // 206,583.50
    expect(incomeTax(T26, "hoh", 105700)).toBe(16155);
    expect(incomeTax(T26, "mfs", 384350)).toBe(103292); // 103,291.75
  });
  it("2025", () => {
    for (const [income, tax] of [
      [11925, 1193],
      [48475, 5579],
      [103350, 17651],
      [197300, 40199],
      [250525, 57231],
      [626350, 188770],
    ] as const)
      expect(incomeTax(T25, "single", income)).toBe(tax); // 1,192.50 / 5,578.50 / 188,769.75 round
    expect(incomeTax(T25, "mfj", 96950)).toBe(11157);
    expect(incomeTax(T25, "hoh", 64850)).toBe(7442);
  });
  it("zero and negative income", () => {
    expect(incomeTax(T26, "single", 0)).toBe(0);
    expect(incomeTax(T26, "single", -5)).toBe(0);
  });
  it("standard deduction and wage base per year (Rev. Proc. 2025-32 sec. 3.01 / 3.14, SSA)", () => {
    expect([T25.standardDeduction.single, T25.standardDeduction.mfj, T25.standardDeduction.hoh, T25.ssWageBase]).toEqual([15750, 31500, 23625, 176100]);
    expect([T26.standardDeduction.single, T26.standardDeduction.mfj, T26.standardDeduction.hoh, T26.ssWageBase]).toEqual([16100, 32200, 24150, 184500]);
  });
});

describe("self-employment tax (Schedule SE)", () => {
  it("$100,000 profit: 92.35% × (12.4% + 2.9%), half deductible", () => {
    const s = seTax(T26, "single", { netProfit: 100000 });
    expect([s.line4a, s.line10, s.line11, s.line12, s.line13]).toEqual([92350, 11451, 2678, 14129, 7065]);
    expect(s.additionalMedicare).toBe(0);
  });
  it("above the social security wage base only Medicare keeps growing; wages use up the base", () => {
    const s = seTax(T26, "single", { netProfit: 300000 });
    expect(s.line10).toBe(22878); // 184,500 × 12.4%
    expect(s.line11).toBe(8034); // 277,050 × 2.9%
    expect(s.additionalMedicare).toBe(693); // (277,050 - 200,000) × 0.9%
    const w = seTax(T26, "single", { netProfit: 50000, w2SsWages: 150000 });
    expect(w.line9).toBe(34500);
    expect(w.line10).toBe(rd(Math.min(46175, 34500) * 0.124));
  });
  it("under $400 of SE earnings: no SE tax; a loss: none", () => {
    expect(seTax(T26, "single", { netProfit: 400 }).owes).toBe(false); // 369 < 400
    expect(seTax(T26, "single", { netProfit: 434 }).owes).toBe(true); // 401
    const l = seTax(T26, "single", { netProfit: -2000 });
    expect([l.owes, l.line12, l.line4a]).toEqual([false, 0, -2000]);
  });
});
const rd = (n: number) => Math.round(n);

describe("QBI deduction (Form 8995)", () => {
  it("20% of QBI, limited to 20% of taxable income", () => {
    expect(qbiDeduction(T26, "single", { qbi: 80000, taxableBefore: 70000 }).deduction).toBe(14000);
    expect(qbiDeduction(T26, "single", { qbi: 50000, taxableBefore: 90000 }).deduction).toBe(10000);
  });
  it("above the threshold: flagged, the simple form no longer applies", () => {
    const q = qbiDeduction(T26, "single", { qbi: 300000, taxableBefore: 250000 });
    expect([q.above, q.fullyPhasedIn]).toEqual([true, false]);
    expect(qbiDeduction(T26, "single", { qbi: 300000, taxableBefore: 280000 }).fullyPhasedIn).toBe(true); // over 201,750 + 75,000
    expect(qbiDeduction(T25, "mfj", { qbi: 100000, taxableBefore: 394600 }).above).toBe(false);
    expect(qbiDeduction(T25, "mfj", { qbi: 100000, taxableBefore: 394601 }).above).toBe(true);
  });
  it("2026: $400 minimum at $1,000 of QBI; 2025 has none", () => {
    expect(qbiDeduction(T26, "single", { qbi: 1200, taxableBefore: 30000 })).toMatchObject({ deduction: 400, minimumApplied: true });
    expect(qbiDeduction(T26, "single", { qbi: 999, taxableBefore: 30000 }).deduction).toBe(200);
    expect(qbiDeduction(T25, "single", { qbi: 1200, taxableBefore: 30000 }).deduction).toBe(240);
    expect(qbiDeduction(T26, "single", { qbi: 1200, taxableBefore: 100 }).deduction).toBe(100); // the minimum is still capped by taxable income
  });
});

describe("whole return estimate", () => {
  it("$100,000 of Schedule C profit, single, 2026", () => {
    const r = personalTax(T26, { year: 2026, status: "single", netProfit: 100000, stateRate: 5 });
    expect(r.se.line12).toBe(14129);
    expect(r.agi).toBe(100000 - 7065);
    expect(r.deduction).toBe(16100);
    expect(r.taxableBeforeQbi).toBe(76835);
    // QBI = 100,000 - 7,065 = 92,935 → 18,587; income limit 20% × 76,835 = 15,367
    expect(r.qbi.deduction).toBe(15367);
    expect(r.taxable).toBe(61468);
    expect(r.incomeTax).toBe(incomeTaxOf(61468));
    expect(r.totalTax).toBe(r.incomeTax + 14129);
    expect(r.state.tax).toBe(rd(0.05 * (100000 - 7065)));
  });
  it("health insurance and retirement reduce AGI and QBI; itemizing only when larger", () => {
    const r = personalTax(T26, { year: 2026, status: "single", netProfit: 100000, seHealthInsurance: 6000, retirement: 10000, itemized: 20000 });
    expect(r.adjustments).toBe(7065 + 16000);
    expect(r.usedItemized).toBe(true);
    expect(r.qbi.line2).toBe(100000 - 7065 - 16000);
  });
  it("a loss pays no SE tax and no income tax", () => {
    const r = personalTax(T26, { year: 2026, status: "single", netProfit: -3000 });
    expect([r.totalTax, r.taxable]).toEqual([0, 0]);
  });
});
const incomeTaxOf = (x: number) => incomeTax(T26, "single", x);

describe("estimated tax (1040-ES)", () => {
  it("quarter dates, moved off weekends and holidays", () => {
    expect(estimateDates(2026)).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
    expect(estimateDates(2027)).toEqual(["2027-04-15", "2027-06-15", "2027-09-15", "2028-01-18"]); // Jan 15, 2028 is a Saturday, Jan 17 is MLK Day
    expect(estimateDates(2025)).toEqual(["2025-04-15", "2025-06-16", "2025-09-15", "2026-01-15"]); // June 15, 2025 is a Sunday
  });
  it("business days: weekend, DC Emancipation Day, holidays", () => {
    expect(nextBusinessDay("2027-01-31")).toBe("2027-02-01"); // 1040-ES says "February 1, 2027"
    expect(nextBusinessDay("2026-01-31")).toBe("2026-02-02"); // Instructions for Forms 1099-MISC/NEC: "February 2, 2026"
    expect(nextBusinessDay("2022-04-15")).toBe("2022-04-18"); // Emancipation Day observed Friday
    expect(nextBusinessDay("2023-04-15")).toBe("2023-04-18"); // Saturday, then Monday Emancipation Day observed
    expect(nextBusinessDay("2029-04-15")).toBe("2029-04-17");
    expect(nextBusinessDay("2026-04-15")).toBe("2026-04-15");
    expect(nextBusinessDay("2027-12-31")).toBe("2028-01-03"); // New Year's Day 2028 is a Saturday, observed on Friday Dec 31
  });
  it("safe harbor: the smaller of 90% of this year and 100% of last year; 110% when last year's AGI was over $150,000", () => {
    const a = estimatedTaxes(T26, { year: 2026, status: "single", expectedTax: 20000, priorTax: 15000, priorAgi: 100000 });
    expect([a.basis, a.required, a.total]).toEqual(["prior", 15000, 15000]);
    expect(a.installments.map((x) => x.amount)).toEqual([3750, 3750, 3750, 3750]);
    const b = estimatedTaxes(T26, { year: 2026, status: "single", expectedTax: 20000, priorTax: 15000, priorAgi: 160000 });
    expect([b.required, b.highIncome]).toEqual([16500, true]);
    const c = estimatedTaxes(T26, { year: 2026, status: "single", expectedTax: 20000, priorTax: 30000, priorAgi: 100000 });
    expect([c.basis, c.required]).toEqual(["current", 18000]);
    const d = estimatedTaxes(T26, { year: 2026, status: "single", expectedTax: 20000 });
    expect([d.basis, d.required, d.priorSafeHarbor]).toEqual(["current", 18000, null]);
    expect(estimatedTaxes(T26, { year: 2026, status: "mfs", expectedTax: 20000, priorTax: 15000, priorAgi: 80000 }).highIncome).toBe(true); // $75,000 for married filing separately
  });
  it("withholding counts; under $1,000 owed or a zero prior year needs nothing; the last payment takes the rounding", () => {
    const w = estimatedTaxes(T26, { year: 2026, status: "single", expectedTax: 10000, withholding: 4000 });
    expect(w.total).toBe(5000);
    expect(estimatedTaxes(T26, { year: 2026, status: "single", expectedTax: 4999, withholding: 4000 })).toMatchObject({
      exempt: true,
      total: 0,
      basis: "none",
    });
    expect(estimatedTaxes(T26, { year: 2026, status: "single", expectedTax: 9000, priorTax: 0 }).exempt).toBe(true);
    const odd = estimatedTaxes(T26, { year: 2026, status: "single", expectedTax: 11112 });
    expect(odd.installments.reduce((s, x) => s + x.amount, 0)).toBe(odd.total);
  });
  it("C-corporation 1120-W: 15th of the 4th, 6th, 9th and 12th months; none under $500", () => {
    const c = corpEstimates(T26, 2026, 12000, null);
    expect(c.installments.map((x) => [x.due, x.amount])).toEqual([
      ["2026-04-15", 3000],
      ["2026-06-15", 3000],
      ["2026-09-15", 3000],
      ["2026-12-15", 3000],
    ]);
    expect(corpEstimates(T26, 2026, 499, null).exempt).toBe(true);
    expect(corpEstimates(T26, 2026, 12000, 8000).required).toBe(8000);
  });
});

describe("standard mileage uses the rate of each trip's date", () => {
  it("2026: 72.5 cents to June 30, 76 cents from July 1", () => {
    const m = mileageDeduction(T26, [
      { date: "2026-06-30", miles: 1000 },
      { date: "2026-07-01", miles: 1000 },
      { date: "2026-12-31", miles: 100 },
    ]);
    expect(m.miles).toBe(2100);
    expect(m.amount).toBe(725 + 760 + 76);
    expect(m.bands).toEqual([
      { cents: 72.5, miles: 1000, amount: 725 },
      { cents: 76, miles: 1100, amount: 836 },
    ]);
  });
  it("2025: 70 cents; bad trips are ignored", () => {
    expect(
      mileageDeduction(T25, [
        { date: "2025-03-01", miles: 500 },
        { date: "2025-03-02", miles: -5 },
      ]).amount,
    ).toBe(350);
  });
});

describe("deadlines in a calendar year", () => {
  const ids = (y: number, f: Parameters<typeof usDeadlines>[1]) => usDeadlines(y, f).map((d) => [d.date, d.id]);
  it("US individual, 2027", () => {
    expect(ids(2027, { businessType: "sole-prop" })).toEqual([
      ["2027-01-15", "us.es.2026.q4"],
      ["2027-02-01", "us.1099nec.2026"],
      ["2027-04-15", "us.1040.2026"],
      ["2027-04-15", "us.es.2027.q1"],
      ["2027-06-15", "us.es.2027.q2"],
      ["2027-09-15", "us.es.2027.q3"],
      ["2027-10-15", "us.1040.2026.ext"],
    ]);
  });
  it("foreign-owned LLC, with Delaware and Wyoming dates when the state is known, FBAR when asked", () => {
    expect(ids(2027, { businessType: "llc-disregarded" })).toEqual([
      ["2027-04-15", "us.5472.2026"],
      ["2027-10-15", "us.5472.2026.ext"],
    ]);
    expect(ids(2027, { businessType: "llc-disregarded", state: "DE" }).map((x) => x[1])).toContain("us.de.llc");
    expect(usDeadlines(2027, { businessType: "llc-disregarded", state: "WY", formed: "2024-08-19" }).find((d) => d.id === "us.wy.annual")?.date).toBe(
      "2027-08-01",
    );
    expect(usDeadlines(2027, { businessType: "llc-disregarded" }).some((d) => d.id === "us.wy.annual")).toBe(false);
    expect(usDeadlines(2027, { businessType: "sole-prop", foreignAccountsOver10k: true }).find((d) => d.id === "us.fbar.2026")?.date).toBe("2027-04-15");
  });
  it("C-corp: 1120 and the four 1120-W installments; partnership and S-corp on March 15", () => {
    const c = usDeadlines(2026, { businessType: "llc-ccorp" });
    expect(c.filter((d) => d.form === "1120-W").map((d) => d.date)).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2026-12-15"]);
    expect(c.find((d) => d.form === "1120" && !d.id.endsWith("ext"))?.date).toBe("2026-04-15");
    expect(usDeadlines(2026, { businessType: "llc-partnership" }).find((d) => d.form === "1065")?.date).toBe("2026-03-16"); // March 15, 2026 is a Sunday
    expect(usDeadlines(2027, { businessType: "s-corp" }).find((d) => d.form === "1120-S")?.date).toBe("2027-03-15");
  });
  it("every deadline has English and Hebrew text and a source; ids are unique", () => {
    for (const t of ["sole-prop", "llc-us-owner", "llc-disregarded", "llc-ccorp", "llc-partnership", "s-corp"]) {
      const ds = usDeadlines(2027, { businessType: t, state: "DE", formed: "2024-01-02", foreignAccountsOver10k: true });
      expect(new Set(ds.map((d) => d.id)).size).toBe(ds.length);
      for (const d of ds) expect([d.title.en, d.title.he, d.source].every(Boolean)).toBe(true);
    }
  });
});

describe("1040-ES worksheet", () => {
  it("lines follow the printed worksheet and agree with the estimate", () => {
    const pt = personalTax(T26, { year: 2026, status: "single", netProfit: 80000, withholding: 1000, credits: 500 }),
      est = estimatedTaxes(T26, { year: 2026, status: "single", expectedTax: pt.totalTax, withholding: 1000, priorTax: 9000, priorAgi: 70000 }),
      w = esWorksheet(pt, est, 500);
    expect(w["2d"]).toBe(w["2a"]! + w["2b"]!);
    expect(w["1"]! - w["2d"]!).toBe(w["3"]);
    expect(w["8"]).toBe(w["4"]! - 500);
    expect(w["11c"]).toBe(w["8"]! + w["9"]! + w["10"]!);
    expect(w["12c"]).toBe(Math.min(w["12a"]!, w["12b"]!));
    expect(w["14a"]).toBe(w["12c"]! - 1000);
    expect(w["15"]).toBe(est.installments[0]!.amount);
    expect(esWorksheet(pt, estimatedTaxes(T26, { year: 2026, status: "single", expectedTax: pt.totalTax }), 0)["12b"]).toBeUndefined(); // no prior-year figure given
  });
});
