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
  creditPct: 0.05,
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
  it("company: salary lever beats pure dividend in low brackets; never loses vs pure dividend", () => {
    ok(company(0, { points: 0 }, T).keep, 0);
    expect(company(100000, { points: 0 }, T, 0.23, false).salary).not.toBe(0);
    expect(company(2000000, { points: 0 }, T, 0.23, false).keep).toBeGreaterThan(2000000 * (1 - 0.23) * (1 - 0.3));
  });
  it("small foreign-client osek wins", () => {
    const r = taxximize({ revenue: 100000, expenses: 10000, clients: "foreign", points: 2.25, fx: 3.6 }, T, { costs: { llc: 0, ccorp: 0 }, corpRate: 0.21 });
    expect(["patur", "murshe"]).toContain(r.best?.key);
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
    expect(Math.round(k450!.rows[1]!.keep!)).toBe(276126);
  });
  it("ilPlan scenarios", () => {
    for (const s of ref.plans) expect(ilPlan(s.input, T26)).toEqual(s.plan);
  });
  it("advisor sample: children 20,328, pension 15,517, KH 3,627, W-8BEN 2,880, woman 1,452, disability 930, phone 563", () => {
    const { answers, ctx } = ref.advisor;
    const r = advise(playbook, answers, { ...ctx, T: T26 });
    expect(r.map((x) => ({ id: x.item.id, status: x.status, saving: x.saving, missing: x.missing.map((q) => q.key) }))).toEqual(ref.advisor.result);
    const save = Object.fromEntries(r.filter((x) => x.status === "save").map((x) => [x.item.id, x.saving]));
    expect(save).toEqual({
      "il-credit-children": 20328,
      "il-pension-self-employed-47": 15517,
      "il-keren-hishtalmut-self": 3627,
      "us-w8ben-royalties-treaty": 2880,
      "il-credit-woman": 1452,
      "il-disability-insurance": 930,
      "il-phone": 563,
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
  };
  it("profit attributed in ₪, zair 30% blocked, US tax credited up to the Israeli tax, forms 1301/1324/150", () => {
    const r = il.crossBorder!({ residence: "il", facts: {} }, 2026, home, [llc], { USD: 3.6 });
    expect(r.attributedIncome).toBe(72000);
    expect(r.foreignTaxCredit).toBe(1800);
    expect(r.blocked).toEqual([{ key: "zair", law: "§87ה" }]);
    expect(r.obligations.map((o) => o.form)).toEqual(["1301", "1324", "150"]);
  });
  it("a C-corp is not attributed, but still reported", () => {
    const r = il.crossBorder!({ residence: "il", facts: {} }, 2026, home, [{ ...llc, type: "llc-ccorp", treatment: "company" }], { USD: 3.6 });
    expect([r.attributedIncome, r.foreignTaxCredit, r.blocked.length]).toEqual([0, 0, 0]);
    expect(r.obligations.map((o) => o.form)).toEqual(["1301", "150"]);
  });
  it("FTC is capped at the Israeli tax the income causes", () => {
    const r = il.crossBorder!({ residence: "il", facts: {} }, 2026, home, [{ ...llc, foreignTaxPaid: 1e6 }], { USD: 3.6 });
    const T = T26,
      base = { turnover: 100000, expenses: 0, zair: true, points: 2.25, pension: 0, donations: 0, selfEmployed: true };
    expect(r.foreignTaxCredit).toBe(ilPlan({ ...base, foreign: 72000 }, T).tax - ilPlan(base, T).tax);
  });
});

it("VAT-registered business types", () => {
  expect(vatRegistered("osek-murshe") && vatRegistered("ltd")).toBe(true);
  expect(vatRegistered("osek-zair") || vatRegistered("osek-patur") || vatRegistered(null)).toBe(false);
});
