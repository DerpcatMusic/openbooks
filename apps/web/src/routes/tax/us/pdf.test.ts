// The writer refuses a form it cannot fill completely; every field the 5472 / 1120 maps write exists in the blanks next to this file.
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vite-plus/test";
import { form1120, form1120ProForma, form5472, type IrsInput } from "@openbooks/country-us";
import { fill1120, NoBlank, writeFields } from "./pdf.ts";

const blank = (f: string) => PDFDocument.load(readFileSync(new URL(`./${f}`, import.meta.url)));
// every profile field and every kind of owner transaction, so each line the maps can write is written
const full: IrsInput = {
  year: 2025,
  legalName: "Acme Sound LLC",
  ein: "12-3456789",
  state: "WY",
  formed: "2025-03-07",
  address: "30 N Gould St Ste R",
  cityStateZip: "Sheridan, WY 82801",
  naics: "512230",
  business: "Music publishing",
  owner: "Dana Levi",
  ownerAddress: "12 Herzl St, Tel Aviv, Israel",
  ownerCountry: "Israel",
  ownerTin: "123456782",
  businessCountries: "Israel",
  taxReturnCountry: "Israel",
  totalAssets: 12345.67,
  partVII: { q37: false, q39: false, q40a: false, q41a: false, q42a: false, q42b: false, q43a: false },
  transactions: [
    { date: "2025-04-02", desc: "Owner capital", amount: 5000, treatment: "contribution" },
    { date: "2025-04-15", desc: "Owner services fee", amount: -1200, treatment: "services" },
    { date: "2025-05-02", desc: "Hosting the owner paid", amount: 90, treatment: "reimbursement" },
    { date: "2025-11-20", desc: "Draw", amount: -1250.5, treatment: "distribution" },
  ],
};
const corp = { ...full, revenue: 100000, cogs: 10000, advertising: 5000, otherDeductions: 25000, otherIncome: 100, corpRate: 0.21 };

describe("every field the IRS maps write exists in the blank", () => {
  it("5472 as a foreign-owned DE and as a corporation", async () => {
    expect(writeFields(await blank("f5472.pdf"), form5472(full))).toEqual([]);
    expect(writeFields(await blank("f5472.pdf"), form5472({ ...full, de: false }))).toEqual([]);
  });
  it("1120 pro forma and the C-corp page 1", async () => {
    expect(writeFields(await blank("f1120.pdf"), form1120ProForma(full))).toEqual([]);
    expect(writeFields(await blank("f1120.pdf"), form1120(corp))).toEqual([]);
  });
  it("a field the blank lacks is reported, not skipped", async () => {
    expect(writeFields(await blank("f5472.pdf"), { "Page9[0].nope[0]": "x" })).toEqual([expect.stringContaining("Page9[0].nope[0]")]);
  });
});

it("the 1120 is refused for a year without its blank (only the 2025 form is bundled)", async () => {
  await expect(fill1120({ year: 2026 })).rejects.toBeInstanceOf(NoBlank);
});
