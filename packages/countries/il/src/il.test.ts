import { describe, expect, it } from "vite-plus/test";
import { checkDictionaries, type PlaybookItem } from "@openbooks/core";
import { us } from "@openbooks/country-us";
import ref from "../fixtures/old-js.json";
import {
  advise,
  bands,
  company,
  extraPoints,
  form1301,
  il,
  ilPlan,
  isComplete,
  mandatoryPension,
  reservistPoints,
  soldierPoints,
  taxximize,
  vatRegistered,
  zairExclusion,
  ZAIR_SOURCE,
  type IlRates,
} from "./index.ts";

const ok = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(0.01);
const T26 = il.table(2026) as IlRates;
const playbook = [...il.playbook, ...us.playbook];

// Hand-computed table from the planner.js self-check (2025-ish rates)
const T: IlRates = {
  brackets: [
    [84120, 0.1],
    [120720, 0.14],
    [193800, 0.2],
    [269280, 0.31],
    [560280, 0.35],
    [721560, 0.47],
    [null, 0.5],
  ],
  point: 2904,
  blRateReduced: 0.0447,
  blRateFull: 0.1283,
  healthRateReduced: 0.0323,
  healthRateFull: 0.0517,
  pensionRate1: 0.0445,
  pensionRate2: 0.1255,
  depositPct: 0.11,
  creditPct: 0.055,
  creditPctDisability: 0.05,
  creditRate: 0.35,
  lifeCreditRate: 0.25,
  khPct: 0.045,
  khIncomeCap: 293397,
  disabilityPct: 0.035,
  disabilityIncomeCap: 399480,
  blDeductPct: 0.52,
  donationMin: 207,
  avgWageMonthly: 12536,
  blReducedMonthly: 7522,
  blMaxMonthly: 50695,
  blMinMonthly: 3134,
  mezakaMonthly: 9700,
  zairCeiling: 122833,
  capitalRate: 0.15,
  vatRate: 0.18,
  costs: { patur: 0, murshe: 0, ltd: 0, llc: 0, ccorp: 0 },
  ltd: {
    corpRate: 0.23,
    divRate: 0.3,
    surtax: 0.03,
    surtaxCapital: 0.02,
    surtaxThreshold: 721560,
    eeReduced: 0.0425,
    eeFull: 0.1196,
    erReduced: 0.0446,
    erFull: 0.0738,
  },
};

describe("planner (ported self-check of web/src/lib/planner.js)", () => {
  it("brackets, reservist points, mandatory pension", () => {
    ok(bands(100000, T.brackets), 8412 + 15880 * 0.14);
    ok(reservistPoints(55, 2026), 1.25);
    ok(reservistPoints(200, 2026), 4);
    ok(reservistPoints(45, 2025), 0);
    ok(mandatoryPension(18200, T), 18200 * 0.0445);
  });
  it("osek zair: 70%, credits wipe tax, reduced BL/health, BL minimum income", () => {
    const p = ilPlan({ turnover: 26000, expenses: 0, zair: true, points: 2.25, pension: 0, donations: 0, selfEmployed: false }, T);
    ok(p.business, 18200);
    ok(p.tax, 0);
    ok(p.bl, 18200 * 0.0447);
    ok(p.health, 18200 * 0.0323);
    ok(ilPlan({ turnover: 26000, expenses: 0, zair: true, points: 0, pension: 0, donations: 0, selfEmployed: true }, T).blBase, 3134 * 12);
  });
  it("BL base is income after pension and 52% of the BL dues (btl.gov.il self-employed rates); solved in closed form here", () => {
    // 2026 table: base X > reduced band 92,436 ⇒ X = 100,000 − 0.52 × (0.1283 X − (0.1283 − 0.0447) × 92,436) ⇒ X = 104,018.38 / 1.066716
    const p = ilPlan({ turnover: 100000, expenses: 0, zair: false, points: 0, pension: 0, donations: 0, selfEmployed: true }, T26);
    ok(p.blBase, (100000 + 0.52 * (0.1283 - 0.0447) * 92436) / (1 + 0.52 * 0.1283));
    ok(p.blDed, 0.52 * p.bl);
    // osek zair: no §47א deduction, BL on 70% of turnover
    ok(ilPlan({ turnover: 100000, expenses: 0, zair: true, points: 0, pension: 0, donations: 0, selfEmployed: true }, T26).blBase, 70000);
  });
  it("pension credit: 35% on deposits up to 5.5% of qualifying income, 5% with a disability deduction (§45א(ו); 1301 guide 2025 row 76)", () => {
    const base = { turnover: 100000, expenses: 0, zair: false, points: 0, pension: 20000, donations: 0, selfEmployed: true };
    const p = ilPlan(base, T26);
    ok(p.pensionDed, 11000); // §47: 11% of 100,000
    ok(p.pensionCredit, 0.35 * 5500);
    ok(ilPlan({ ...base, disability: true }, T26).pensionCredit, 0.35 * 5000);
  });
  it("company: salary lever beats pure dividend in low brackets; never loses vs pure dividend", () => {
    ok(company(0, { points: 0 }, T).keep, 0);
    expect(company(100000, { points: 0 }, T, 0.23, false).salary).not.toBe(0);
    expect(company(2000000, { points: 0 }, T, 0.23, false).keep).toBeGreaterThan(2000000 * (1 - 0.23) * (1 - 0.3));
  });
  it("small foreign-client osek wins", () => {
    const r = taxximize({ revenue: 100000, expenses: 10000, clients: "foreign", points: 2.25, fx: 3.6 }, T, { costs: { llc: 0, ccorp: 0 }, corpRate: 0.21 });
    expect(["patur", "murshe"]).toContain(r.best?.key);
  });
  it("no USD rate: the US structures say so instead of using a default rate", () => {
    const r = taxximize({ revenue: 100000, expenses: 10000, clients: "foreign", points: 2.25 }, T, { costs: { llc: 500, ccorp: 900 }, corpRate: 0.21 });
    expect(r.rows.filter((x) => !x.ok && x.why.k === "noRate").map((x) => x.key)).toEqual(["llc", "ccorp"]);
  });
  it("released soldier points", () => {
    expect(soldierPoints("2024-06", 32, 2025)).toBe(2);
    expect(soldierPoints("2024-06", 12, 2024)).toBe(0.5);
    expect(soldierPoints(undefined, 32, 2025)).toBe(0);
  });
});

describe("numerically identical to the old JS on the real 2026 tables (fixtures/old-js.json)", () => {
  it("Taxximizer 100k / 450k × business / consumer / foreign clients", () => {
    for (const s of ref.taxximizer) {
      const r = taxximize(s.input as Parameters<typeof taxximize>[0], T26, us.table(2026));
      expect(JSON.parse(JSON.stringify(r.rows))).toEqual(s.rows); // JSON: NaN → null on both sides (patur above the ceiling has no keep)
      expect(r.best?.key).toBe(s.best);
    }
    const [k100, , , k450] = ref.taxximizer;
    expect(k100!.best).toBe("patur");
    expect(Math.round(k100!.rows[0]!.keep!)).toBe(83403);
    expect(k450!.best).toBe("murshe");
    expect(Math.round(k450!.rows[1]!.keep!)).toBe(279728); // was 276,126 before the 5.5% pension credit and the BL base after 52% of BL
  });
  it("ilPlan scenarios", () => {
    for (const s of ref.plans) expect(ilPlan(s.input, T26)).toEqual(s.plan);
  });
  it("advisor sample: children 20,328, pension 15,749, KH 3,627, W-8BEN 2,880, woman 1,452, disability 930, phone 551", () => {
    const { answers, ctx } = ref.advisor;
    const r = advise(playbook, answers, { ...ctx, T: T26 });
    expect(r.map((x) => ({ id: x.item.id, status: x.status, saving: x.saving, missing: x.missing.map((q) => q.key) }))).toEqual(ref.advisor.result);
    const save = Object.fromEntries(r.filter((x) => x.status === "save").map((x) => [x.item.id, x.saving]));
    expect(save).toEqual({
      "il-credit-children": 20328,
      "il-pension-self-employed-47": 15749, // old JS 15,517: credit on 5% instead of 5.5% (§45א(ו))
      "il-keren-hishtalmut-self": 3627,
      "us-w8ben-royalties-treaty": 2880,
      "il-credit-woman": 1452,
      "il-disability-insurance": 930,
      "il-phone": 551, // old JS 563: BL base now also net of 52% of BL, so the BL saved by the extra expense is smaller
    });
  });
});

describe("advisor (ported self-check of web/src/lib/advisor.js)", () => {
  it("credit points from answers", () => {
    expect(extraPoints({ childBirthYears: "2020, 2025", parentRole: "mother" }, 2025)["il-credit-children"]).toBe(5);
    expect(extraPoints({ degreeType: "BA", degreeEndYear: 2023, studyYears: 3 }, 2025)["il-credit-academic-degree"]).toBe(1);
    expect(extraPoints({ degreeType: "BA", degreeEndYear: 2019 }, 2021)["il-credit-academic-degree"]).toBe(0);
  });
  it("half a point = 1,452 when tax is high enough; pension saves", () => {
    const T2 = {
      ...T,
      brackets: [
        [84120, 0.1],
        [120720, 0.14],
        [228000, 0.2],
        [301200, 0.31],
        [560280, 0.35],
        [721560, 0.47],
        [null, 0.5],
      ] as IlRates["brackets"],
      avgWageMonthly: 13769,
      blReducedMonthly: 7703,
      blMaxMonthly: 51910,
      blMinMonthly: 3442,
    };
    const items = [
      { id: "il-credit-woman", applies_to: ["osek-zair"], ask: [{ key: "isWoman" }], kind: "credit" },
      { id: "il-pension-self-employed-47", applies_to: ["osek-zair"], ask: [], kind: "deduction" },
    ] as unknown as PlaybookItem[];
    const r = advise(items, { isWoman: true }, { y: 2026, type: "osek-zair", types: ["osek-zair"], turnover: 200000, expenses: 0, points: 2.25, T: T2 });
    expect(r.find((x) => x.item.id === "il-credit-woman")?.saving).toBe(1452);
    expect(r.find((x) => x.item.id === "il-pension-self-employed-47")?.status).toBe("save");
  });
});

describe("pack data", () => {
  it("every year decodes; 2025+ complete", () => {
    expect(isComplete(il.table(2024))).toBe(false);
    expect(isComplete(il.table(2026))).toBe(true);
    expect(il.table(2030).year).toBe(2026);
    expect(il.table(2000).year).toBe(2024);
  });
  it("playbook items are Israeli and sourced; strings have both languages", () => {
    expect(il.playbook.length).toBe(51);
    expect(il.playbook.every((x) => x.country === "il" && x.source)).toBe(true);
    expect(checkDictionaries(il.strings.en, il.strings.he)).toEqual([]);
    expect(il.manifest.businessTypes.map((b) => b.label.he)).toEqual(["עוסק פטור", "עוסק זעיר", "עוסק מורשה", "חברה בע״מ"]);
  });
});

describe("form 1301 hook", () => {
  it("zair closed (foreign transparent holding): no zair box, 150 on actual expenses (Circular 7/2025 §3.3)", () => {
    const txns = [txn(100000, "business:client"), txn(-5000, "expense:software")];
    const r = form1301({ y: 2026, type: "osek-zair", T: T26, txns, zairExcluded: true });
    expect([r.fields.zair, r.fields["150"]]).toEqual(["", "95000"]);
  });
  it("deductions 135/136/030 come off taxable income; 268/037 credits after the points (1301 guide 2025 rows 51, 53, 54, 76, 78א)", () => {
    const form = { "150": "200000", "135": "30000", "136": "10000", "030": "10000", "037": "1000" };
    const r = form1301({ y: 2026, type: "osek-murshe", T: T26, txns: [], form });
    // 135: 11% of 200,000 = 22,000; 136: 4.5% of 200,000 = 9,000; 030: 52% of 10,000 = 5,200
    expect(r.deductions).toEqual({ "135": 22000, "136": 9000, "112": 0, "030": 5200 });
    expect(r.taxable).toBe(200000 - 36200);
    // 268: 35% of min(30,000 − 22,000, 5.5% of 200,000); 037: 35% of 1,000
    ok(r.paymentCredits["268"], 2800);
    ok(r.paymentCredits["037"], 350);
    expect(r.due).toBe(Math.round(bands(163800, T26.brackets) - 2.25 * T26.point - 3150));
  });
  it("attributed foreign income is taxed with the business income, US tax credited up to the Israeli tax on it (appendix 1324)", () => {
    const r = form1301({ y: 2026, type: "osek-murshe", T: T26, txns: [], form: { "150": "100000" }, foreign: { income: 50000, taxPaid: 1e6 } });
    expect(r.taxable).toBe(150000);
    const net = bands(150000, T26.brackets) - 2.25 * T26.point;
    ok(r.f1324.credit, net / 3);
    expect(r.due).toBe(Math.round(net - net / 3));
    expect(form1301({ y: 2026, type: "osek-murshe", T: T26, txns: [], form: { "150": "100000" }, foreign: { income: 50000, taxPaid: 100 } }).f1324.credit).toBe(100);
  });
  const txn = (amount: number, category: string) => ({
    id: "x",
    date: "2026-03-01",
    amount,
    desc: "",
    source: "bank",
    account: "A",
    file: "",
    page: 0,
    category,
    why: "",
  });
  it("osek zair: 150 = 70% of turnover; 2.25 resident points credited; typed values override", () => {
    const r = form1301({ y: 2026, type: "osek-zair", T: T26, txns: [txn(100000, "business:client"), txn(-5000, "expense:software"), txn(-50, "ask")] });
    expect(r.fields["150"]).toBe("70000");
    expect(r.fields["238"]).toBe("100000");
    expect(r.ask.length).toBe(1);
    ok(r.gross, 7000);
    expect(r.due).toBe(Math.round(7000 - 2.25 * 2904));
    expect(form1301({ y: 2026, type: "osek-murshe", T: T26, txns: [txn(100000, "business:client"), txn(-5000, "expense:software")] }).fields["150"]).toBe(
      "95000",
    );
    expect(form1301({ y: 2026, type: "osek-zair", T: T26, txns: [], form: { "150": "200,000" } }).taxable).toBe(200000);
  });
  it("non-deductible expenses (deduction rules) come off the actual-expenses figure, not the zair 70%", () => {
    const txns = [txn(100000, "business:client"), txn(-5000, "expense:software"), txn(-1000, "expense:meals")];
    expect(form1301({ y: 2026, type: "osek-murshe", T: T26, txns, disallowed: 1000 }).fields["150"]).toBe("95000");
    expect(form1301({ y: 2026, type: "osek-murshe", T: T26, txns }).fields["150"]).toBe("94000");
    expect(form1301({ y: 2026, type: "osek-zair", T: T26, txns, disallowed: 1000 }).fields["150"]).toBe("70000");
  });
  it("real 2025 return matches the Tax Authority's assessment (08.10.2026): fund tax is final, nothing back", () => {
    const T25 = il.table(2025) as IlRates;
    const r = form1301({
      y: 2025,
      type: "osek-zair",
      T: T25,
      txns: [],
      today: "2026-10-12",
      profile: { discharge: "2025-02-17", serviceMonths: 32 },
      form: { "150": "18413", "157": "3015", "040": "754", "020": "X", "224": "2025" },
    });
    expect(r.gross).toBeCloseTo(2595.05, 2); // site: 2,595
    expect(r.soldier).toBeCloseTo(10 / 6, 4); // Mar–Dec 2025 at 1/6 a month (s.39א)
    expect(Math.round(r.creditsAvailable)).toBe(8375); // assessment: 8,375 = 2.25 points + soldier credit capped at the tax on business income
    expect(Math.round(r.credits)).toBe(1841); // they wipe the bracket tax only
    expect(r.due).toBe(754); // the 25% on the חיסכון לכל ילד gain stays
    expect(r.balance).toBe(0); // assessment: "יתרה אפס"; Altshuler: no refund on a lump-sum withdrawal
    expect(r.indexation).toBe(0);
  });
  it("child savings: 157 at 25%, 060 at 15%, withheld tax in 040 is final even when credits exceed the bracket tax", () => {
    const r = form1301({ y: 2026, type: "osek-zair", T: T26, txns: [], form: { "150": "18413", "157": "3015", "040": "754", "020": "X" } });
    expect(r.capTax).toBeCloseTo(753.75, 2); // Altshuler withheld 753.83 on a 3,015 real gain
    expect(r.due).toBe(754);
    expect(r.balance).toBe(0);
    expect(form1301({ y: 2026, type: "osek-zair", T: T26, txns: [], form: { "060": "1000" } }).capTax).toBeCloseTo(150, 2);
  });
});

describe("cross-border: IL resident + US disregarded LLC", () => {
  const home = [
    {
      entity: "il",
      country: "il",
      type: "osek-zair",
      treatment: "sole-proprietor" as const,
      year: 2026,
      currency: "ILS",
      revenue: 100000,
      expenses: 0,
      foreignTaxPaid: 0,
      lines: [],
    },
  ];
  const llc = {
    entity: "us",
    country: "us",
    type: "llc-disregarded",
    treatment: "transparent" as const,
    year: 2026,
    currency: "USD",
    revenue: 30000,
    expenses: 10000,
    foreignTaxPaid: 500,
    lines: [
      { date: "2026-03-01", amount: 30000 },
      { date: "2026-06-01", amount: -10000 },
    ],
  };
  // a rate per date, as the Bank of Israel publishes them: each transaction converts on its own day
  const fx = (c: string, d: string) => (c !== "USD" ? null : d < "2026-05-01" ? 3.7 : 3.5);
  const me = { residence: "il", facts: {} };
  it("profit attributed in ₪ at each transaction's rate, zair closed (Circular 7/2025 §3.3), US tax credited, forms 1301/1324/150", () => {
    const r = il.crossBorder!(me, 2026, home, [llc], fx);
    expect(r.attributedIncome).toBe(30000 * 3.7 - 10000 * 3.5);
    expect(r.foreignTaxCredit).toBe(500 * 3.5); // year-end rate
    expect(r.missingFx).toEqual([]);
    expect(r.blocked).toEqual([{ key: "zair", law: "§87ב–87ז", url: ZAIR_SOURCE }]);
    expect(r.obligations.map((o) => o.form)).toEqual(["1301", "1324", "150"]);
  });
  it("no rate is reported as missing, never priced at a default", () => {
    const r = il.crossBorder!(me, 2026, home, [llc], () => null);
    expect(r.attributedIncome).toBe(0);
    expect(r.missingFx).toEqual([
      { currency: "USD", date: "2026-03-01" },
      { currency: "USD", date: "2026-06-01" },
      { currency: "USD", date: "2026-12-31" },
    ]);
  });
  it("a C-corp is not attributed but still reported, and controlling it closes osek zair", () => {
    const r = il.crossBorder!(me, 2026, home, [{ ...llc, type: "llc-ccorp", treatment: "company" }], fx);
    expect([r.attributedIncome, r.foreignTaxCredit]).toEqual([0, 0]);
    expect(r.blocked.map((b) => b.key)).toEqual(["zairCompany"]);
    expect(r.obligations.map((o) => o.form)).toEqual(["1301", "150"]);
  });
  it("osek zair stays open with no foreign or company holdings", () => {
    expect(zairExclusion(home, [])).toEqual([]);
  });
  it("FTC is capped at the Israeli tax the income causes (on actual expenses: zair is closed)", () => {
    const r = il.crossBorder!(me, 2026, home, [{ ...llc, foreignTaxPaid: 1e6 }], fx);
    const base = { turnover: 100000, expenses: 0, zair: false, points: 2.25, pension: 0, donations: 0, selfEmployed: true };
    expect(r.foreignTaxCredit).toBe(ilPlan({ ...base, foreign: 76000 }, T26).tax - ilPlan(base, T26).tax);
  });
});

it("VAT-registered business types", () => {
  expect(vatRegistered("osek-murshe") && vatRegistered("ltd")).toBe(true);
  expect(vatRegistered("osek-zair") || vatRegistered("osek-patur") || vatRegistered(null)).toBe(false);
  expect(vatRegistered("osek-zair", "murshe")).toBe(true); // zair is an income-tax track; VAT status is separate (Kol Zchut עסק זעיר)
  expect(vatRegistered("osek-patur", "murshe")).toBe(false);
});
