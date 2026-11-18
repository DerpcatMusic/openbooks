import { describe, expect, it } from "vite-plus/test";
import { ilDeadlines } from "./deadlines.ts";

describe("IL deadlines", () => {
  it("osek murshe: 12 VAT reports, 12 advances each, the return", () => {
    const d = ilDeadlines(2026, { businessType: "osek-murshe" });
    expect(d.filter((x) => x.id.startsWith("il.vat."))).toHaveLength(12);
    expect(d.filter((x) => x.id.startsWith("il.adv.tax."))).toHaveLength(12);
    expect(d.filter((x) => x.id.startsWith("il.adv.bl."))).toHaveLength(12);
    expect(d.find((x) => x.id === "il.1301.2026")).toMatchObject({ date: "2027-04-30", form: "1301" });
    expect(new Set(d.map((x) => x.id)).size).toBe(d.length);
    expect([...d].sort((a, b) => a.date.localeCompare(b.date))).toEqual(d);
  });
  it("bimonthly VAT filers get 6 reports", () => {
    expect(ilDeadlines(2026, { businessType: "ltd", vatFrequency: "bimonthly" }).filter((x) => x.id.startsWith("il.vat."))).toHaveLength(6);
  });
  it("osek patur has no VAT report; zair has the short report; Ltd no personal advances", () => {
    expect(ilDeadlines(2026, { businessType: "osek-patur" }).some((x) => x.id.startsWith("il.vat."))).toBe(false);
    expect(ilDeadlines(2026, { businessType: "osek-zair" }).some((x) => x.id.startsWith("il.short."))).toBe(true);
    const l = ilDeadlines(2026, { businessType: "ltd" });
    expect(l.some((x) => x.id.startsWith("il.adv.bl."))).toBe(false);
    expect(l.some((x) => x.id === "il.1214.2026")).toBe(true);
  });
  it("advance settings are respected", () => {
    const d = ilDeadlines(2026, { businessType: "osek-murshe", taxAdvances: "none", blAdvances: false } as never);
    expect(d.some((x) => x.id.startsWith("il.adv."))).toBe(false);
  });
  it("osek zair registered as osek murshe for VAT gets VAT reports (zair is an income-tax track only, Kol Zchut עסק זעיר)", () => {
    expect(ilDeadlines(2026, { businessType: "osek-zair", vatStatus: "murshe" }).filter((x) => x.id.startsWith("il.vat."))).toHaveLength(12);
    expect(ilDeadlines(2026, { businessType: "osek-zair" }).some((x) => x.id.startsWith("il.vat."))).toBe(false);
  });
  it("zair closed by a foreign transparent holding: the 1301 instead of the short report, plus Form 150 (Circular 7/2025 §3.3, §3.11)", () => {
    const d = ilDeadlines(2026, { businessType: "osek-zair", zairExcluded: true, foreignHoldings: 1 });
    expect(d.find((x) => x.id === "il.1301.2026")).toMatchObject({ date: "2027-04-30", form: "1301" });
    expect(d.find((x) => x.id === "il.150.2026")).toMatchObject({ date: "2027-04-30", form: "150" });
    expect(d.some((x) => x.id.startsWith("il.short."))).toBe(false);
  });
});
