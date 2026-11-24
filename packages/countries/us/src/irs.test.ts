import { describe, expect, it } from "vite-plus/test";
import ref from "../fixtures/irs-old-js.json";
import {
  ccorpObligations,
  corpTax,
  form1120,
  form1120ProForma,
  form5472,
  form5472Set,
  irsPeriod,
  partIV,
  partV,
  us,
  validate5472,
  type IrsInput,
  type PartVIIAnswers,
} from "./index.ts";

const ALL_NO: PartVIIAnswers = { q37: false, q39: false, q40a: false, q41a: false, q42a: false, q42b: false };

// fixtures/irs-old-js.json: web/src/lib/irs.js fill5472/fill1120 baseline. Two intentional compliance corrections vs old JS:
// (1) pro forma 1120 omits item D (f1_13, total assets) per IRS Form 5472 instructions (only name, address, items B and E);
// (2) Part VII is filled only from explicit answers (never silently hardcoded No).
describe("IRS field maps compatible with old irs.js (with i5472 compliance fixes)", () => {
  for (const [i, c] of ref.cases.entries()) {
    const d = c.input as unknown as IrsInput;
    it(`case ${i}: 5472 with explicit Part VII answers matches baseline`, () => expect(form5472({ ...d, partVII: ALL_NO })).toEqual(c.f5472));
    it(`case ${i}: pro forma 1120 matches baseline without item D (total assets)`, () => {
      const expected = { ...c.f1120 } as Record<string, string>;
      delete expected["Page1[0].f1_13[0]"];
      expect(form1120ProForma(d)).toEqual(expected);
    });
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

  it("Part IV vs Part V: owner service payment lands on Part IV line 29 (not Part V), while contribution stays in Part V", () => {
    const txns = [
      { date: "2026-02-01", desc: "Initial capital", amount: 500, treatment: "contribution" as const },
      { date: "2026-04-15", desc: "April services agreement", amount: -1200, treatment: "services" as const },
    ];
    const p4 = partIV({ transactions: txns });
    const p5 = partV({ transactions: txns });
    expect(p4.byLine).toEqual({ "29": 1200 });
    expect(p4.totalPaid).toBe(1200);
    expect(p5.contributions).toBe(500);
    expect(p5.total).toBe(500);
    const f = form5472({ year: 2026, legalName: "Dolmen Gate LLC", transactions: txns, partVII: ALL_NO });
    expect(f["Page2[0].f2_32[0]"]).toBe("1,200"); // Part IV line 29
    expect(f["Page2[0].f2_40[0]"]).toBe("1,200"); // Part IV line 36 total paid
    expect(f["Page2[0].PartV[0].c2_6[0]"]).toBe("X"); // Part V checked because of the $500 contribution
    expect(f["Page1[0].Line1f_ReadOrder[0].f1_12[0]"]).toBe("1,700"); // 1f = 1,200 + 500
    // Only Part IV transactions -> Part V checkbox stays OFF
    const onlyServices = form5472({ year: 2026, legalName: "Dolmen Gate LLC", transactions: [txns[1]!], partVII: ALL_NO });
    expect(onlyServices["Page2[0].f2_32[0]"]).toBe("1,200");
    expect(onlyServices["Page2[0].PartV[0].c2_6[0]"]).toBeUndefined();
    expect(onlyServices["Page1[0].Line1f_ReadOrder[0].f1_12[0]"]).toBe("1,200");
  });

  it("multiple related parties produce separate Form 5472s with accurate line 1g count and line 1h combined total", () => {
    const forms = form5472Set({
      year: 2026,
      legalName: "Dolmen Gate LLC",
      owner: "Alex Cohen",
      ownerCountry: "Israel",
      partVII: ALL_NO,
      relatedParties: [
        {
          id: "rp-2",
          name: "Partner Studio Ltd",
          address: "5 Rothchild Blvd, Tel Aviv",
          tin: "515000001",
          businessCountry: "Israel",
          residenceCountry: "Israel",
          relatedToReportingCorp: true,
          relatedTo25Shareholder: true,
        },
      ],
      transactions: [
        { date: "2026-01-10", desc: "Owner contribution", amount: 500, treatment: "contribution" },
        { date: "2026-04-15", desc: "Owner services", amount: -1200, treatment: "services" },
        { date: "2026-05-01", desc: "Related studio royalty", amount: -800, treatment: "royalty", partyId: "rp-2" },
      ],
    });
    expect(forms).toHaveLength(2);
    expect(forms[0]!.fields["Page1[0].f1_13[0]"]).toBe("2"); // 1g = 2 forms
    expect(forms[0]!.fields["Page1[0].Line1f_ReadOrder[0].f1_12[0]"]).toBe("1,700");
    expect(forms[0]!.fields["Page1[0].f1_14[0]"]).toBe("2,500"); // 1h = 1,700 + 800
    expect(forms[1]!.fields["Page1[0].f1_13[0]"]).toBe("2");
    expect(forms[1]!.fields["Page1[0].Line1f_ReadOrder[0].f1_12[0]"]).toBe("800");
    expect(forms[1]!.fields["Page1[0].f1_14[0]"]).toBe("2,500");
    expect(forms[1]!.fields["Page2[0].f2_1[0]"]).toBe("Partner Studio Ltd, 5 Rothchild Blvd, Tel Aviv");
    expect(forms[1]!.fields["Page2[0].f2_30[0]"]).toBe("800"); // Part IV line 27b royalties paid
    expect(forms[1]!.fields["Page2[0].c2_3[0]"]).toBe("X");
    expect(forms[1]!.fields["Page2[0].c2_4[0]"]).toBeUndefined();
  });

  it("validate5472 catches Hebrew-only owner name, missing fields, and unanswered Part VII questions", () => {
    const issues = validate5472({
      year: 2026,
      legalName: "Dolmen Gate LLC",
      ein: "12-3456789",
      state: "DE",
      formed: "2026-01-15",
      address: "8 The Green",
      cityStateZip: "Dover, DE 19901",
      naics: "512230",
      business: "Music & Software",
      businessCountries: "United States, Israel",
      owner: "דנה לוי",
      ownerAddress: "12 Herzl St, Tel Aviv",
      ownerCountry: "Israel",
      ownerTin: "123456782",
    });
    expect(issues.find((i) => i.field === "owner")).toEqual({ field: "owner", code: "nonAscii", detail: "דנה לוי" });
    expect(issues.filter((i) => i.code === "unansweredPartVII").length).toBe(6);

    // Supplying English legal spelling + explicit Part VII answers clears all issues
    const ok = validate5472({
      year: 2026,
      legalName: "Dolmen Gate LLC",
      ein: "12-3456789",
      state: "DE",
      formed: "2026-01-15",
      address: "8 The Green",
      cityStateZip: "Dover, DE 19901",
      naics: "512230",
      business: "Music & Software",
      businessCountries: "United States, Israel",
      owner: "דנה לוי",
      ownerLegalName: "Dana Levi",
      ownerAddress: "12 Herzl St, Tel Aviv",
      ownerCountry: "Israel",
      ownerTin: "123456782",
      partVII: ALL_NO,
    });
    expect(ok).toEqual([]);
  });

  it("Part II distinct business, citizenship, and residence countries", () => {
    const f = form5472({
      year: 2026,
      ownerCountry: "Israel",
      ownerBusinessCountry: "United States",
      ownerCitizenship: "Israel",
      ownerResidence: "Israel",
    });
    expect(f["Page1[0].f1_24[0]"]).toBe("United States");
    expect(f["Page1[0].f1_25[0]"]).toBe("Israel");
    expect(f["Page1[0].f1_26[0]"]).toBe("Israel");
  });

  it("5472 line 1n/1o from the profile, never a hard-coded country (i5472: 1o = principal country(ies) where business is conducted)", () => {
    const f = form5472({ year: 2025, legalName: "X", businessCountries: "Israel" });
    expect(f["Page1[0].f1_19[0]"]).toBe("Israel");
    expect(f["Page1[0].f1_18[0]"]).toBeUndefined();
    expect(form5472({ year: 2025, taxReturnCountry: "Israel" })["Page1[0].f1_18[0]"]).toBe("Israel");
  });
  it("Part VII is never silently hardcoded No; 43a/43b left blank for a DE even if answered", () => {
    expect(form5472({ year: 2025 })["Page3[0].c3_1[1]"]).toBeUndefined();
    expect(form5472({ year: 2025, partVII: { ...ALL_NO, q43a: false } })["Page3[0].c3_9[1]"]).toBeUndefined();
    expect(form5472({ year: 2025, de: false, partVII: { ...ALL_NO, q43a: false } })["Page3[0].c3_9[1]"]).toBe("X");
  });
  it("Part V includes related-party transactions with the owner besides contributions and distributions (Reg. 1.482-1(i)(7))", () => {
    const v = partV({
      transactions: [
        { date: "2025-01-01", desc: "capital", amount: 1000 },
        { date: "2025-02-01", desc: "hosting the owner paid", amount: 120, related: true },
        { date: "2025-03-01", desc: "rent to owner", amount: -300, related: true },
      ],
    });
    expect(v.rows.map((r) => r.kind)).toEqual(["Contribution", "Received from owner", "Paid to owner"]);
    expect([v.contributions, v.distributions, v.other, v.total]).toEqual([1000, 0, 420, 1420]);
    const f = form5472({ year: 2025, transactions: v.rows });
    expect(f["Page1[0].Line1f_ReadOrder[0].f1_12[0]"]).toBe("1,420");
  });
  it("C-corp 5472: line 3 and Part V off; Part IV still populated when Part IV transactions exist", () => {
    const f = form5472({ year: 2025, legalName: "X", transactions: [{ date: "2025-01-01", desc: "a", amount: 1 }], de: false });
    expect(f["Page1[0].c1_4[0]"]).toBeUndefined();
    expect(f["Page2[0].PartV[0].c2_6[0]"]).toBeUndefined();
    expect(f["Page1[0].Line1f_ReadOrder[0].f1_12[0]"]).toBeUndefined();
    expect(f["Page1[0].c1_3[0]"]).toBe("X");
  });
  it("pro forma 1120 omits item D (total assets) while C-corp 1120 includes it", () => {
    expect(form1120ProForma({ year: 2025, legalName: "DE LLC", ein: "12-3456789", totalAssets: 500 })["Page1[0].f1_13[0]"]).toBeUndefined();
    const d = {
      year: 2026,
      legalName: "Corp LLC",
      totalAssets: 500,
      revenue: 100000,
      cogs: 10000,
      advertising: 5000,
      otherDeductions: 25000,
      otherIncome: 100,
      corpRate: 0.21,
    };
    expect(form1120(d)["Page1[0].f1_13[0]"]).toBe("500");
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
