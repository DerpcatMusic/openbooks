// IRS Form 5472 (Rev. 12-2023) and Form 1120 (2025) field maps, moved from web/src/lib/irs.js. Each hook returns
// { pdf field name (without IRS_PREFIX) → value }: text as printed (WinAnsi-safe), checkboxes "X" when checked (absent = unchecked).
// The web app writes these onto the blank PDFs with pdf-lib; fixtures/irs-old-js.json holds the old JS output for the same inputs.
//
// Form 5472
//   Page1[0].Pg1Header[0].f1_1/f1_2   tax year beginning (month day / year)
//   Page1[0].Pg1Header[0].f1_3/f1_4   tax year ending (month day / year)
//   Page1[0].Line1a[0].f1_5/6/7       1a name / street / city-state-zip
//   Page1[0].f1_8                     1b EIN
//   Page1[0].f1_9                     1c total assets
//   Page1[0].f1_10 / f1_11            1d principal business activity / 1e code
//   Page1[0].Line1f_ReadOrder[0].f1_12  1f gross payments on this form
//   Page1[0].f1_13 / f1_14            1g number of 5472s / 1h gross payments all forms
//   Page1[0].Line1i_ReadOrder[0].c1_1 1i consolidated  (not used)
//   Page1[0].Line1j_ReadOrder[0].c1_2 1j initial year filing 5472
//   Page1[0].f1_15 / f1_16            1k # Parts VIII (blank) / 1l country of incorporation
//   Page1[0].f1_17 / f1_18 / f1_19    1m date of incorporation / 1n tax-resident country / 1o country of business
//   Page1[0].c1_3 / c1_4              line 2 (>=50% foreign owned) / line 3 (foreign-owned U.S. DE)
//   Page1[0].f1_20                    4a name and address of direct 25% foreign shareholder
//   Page1[0].f1_21 / f1_22 / f1_23    4b(1) US id no. / 4b(2) reference ID / 4b(3) FTIN
//   Page1[0].f1_24 / f1_25 / f1_26    4c country of business / 4d citizenship / 4e tax residence
//   Page2[0].c2_1[0] / c2_1[1]        Part III related party is foreign person / U.S. person
//   Page2[0].f2_1                     8a name and address of related party
//   Page2[0].f2_2 / f2_3 / f2_4       8b(1) US id no. / 8b(2) reference ID / 8b(3) FTIN
//   Page2[0].f2_5 / f2_6              8c principal business activity / 8d code
//   Page2[0].c2_2 / c2_3 / c2_4       8e related to reporting corp / related to 25% FS / is 25% FS
//   Page2[0].f2_7 / f2_8              8f country of business / 8g tax residence
//   Page2[0].f2_9..f2_40              Part IV lines 9-36 (left blank for a DE; see Part V)
//   Page2[0].PartV[0].c2_6            Part V checkbox (statement attached)
//   Page3[0].c3_N[0]=Yes / c3_N[1]=No Part VII: c3_1=37, c3_2=38a, c3_3=38c, c3_4=39,
//                                      c3_5=40a, c3_6=41a, c3_7=42a, c3_8=42b, c3_9=43a
//
// Form 1120 page 1
//   Page1[0].PgHeader[0].f1_1/f1_2/f1_3  tax year beginning / ending / ending yy (only if not a full calendar year)
//   Page1[0].NameFieldsReadOrder[0].f1_4  name
//     f1_5 street, f1_6 room/suite, f1_7 city, f1_8 state, f1_9 country, f1_10 ZIP
//   Page1[0].f1_11  B EIN      Page1[0].f1_12  C date incorporated     Page1[0].f1_13  D total assets
//   Page1[0].c1_6..c1_9  E (1) initial (2) final (3) name change (4) address change
//   Page1[0].f1_14 1a gross receipts, f1_16 1c, f1_17 2 COGS, f1_18 3 gross profit, f1_19..f1_25 lines 4-10, f1_26 11 total income,
//   f1_27..f1_41 lines 12-26 (f1_37 22 advertising, f1_41 26 other deductions), f1_42 27 total deductions,
//   f1_43 28 taxable income before NOL, f1_47 30 taxable income, f1_48 31 total tax
import type { FormHook, Obligation } from "@openbooks/core";
import type { UsProfile } from "./forms.ts";
import type { UsTable } from "./schema.ts";

/** Every field name in the IRS PDFs starts with this. */
export const IRS_PREFIX = "topmostSubform[0].";

export interface IrsTxn {
  date: string;
  desc: string;
  /** > 0 contribution to the LLC, < 0 distribution to the owner. */
  amount: number;
}
export interface IrsInput extends UsProfile {
  year: number;
  /** Bank balances at year end (1c / D); blank when unknown. */
  totalAssets?: number | string | null;
  /** Owner transactions of the year (Part V statement, 1f/1h). */
  transactions?: readonly IrsTxn[];
}
/** The C-corp's year from the P&L (positive amounts; `other` is net other income). */
export interface CorpInput extends IrsInput {
  revenue: number;
  cogs: number;
  advertising: number;
  /** All other deductions (line 26, statement attached). */
  otherDeductions: number;
  otherIncome: number;
  corpRate: number;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** PDF standard fonts are WinAnsi-only; strip anything else so the writer never throws. */
export const ascii = (s: string | number | null | undefined) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[‐-―]/g, "-")
    .replace(/[^\x20-\x7E]/g, "");
const usd = (n: number) => Math.round(n).toLocaleString("en-US");
const monthDay = (iso: string) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const has = (v: unknown) => v != null && v !== "";

/** First tax year starts at formation; a DE uses its owner's year, else calendar year. */
export function irsPeriod(d: Pick<IrsInput, "year" | "formed">) {
  const y = String(d.year);
  const begin = d.formed?.startsWith(y) ? d.formed : `${y}-01-01`;
  return { begin, end: `${y}-12-31`, initial: !!d.formed && d.formed.slice(0, 4) >= y };
}

/** Part V statement: owner transactions by date with totals (1f = contributions + distributions). */
export function partV(d: Pick<IrsInput, "transactions">) {
  const rows = [...(d.transactions ?? [])]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((t) => ({ ...t, amount: +t.amount || 0, kind: (+t.amount || 0) >= 0 ? ("Contribution" as const) : ("Distribution" as const) }));
  const contributions = rows.reduce((s, t) => s + Math.max(0, t.amount), 0),
    distributions = rows.reduce((s, t) => s + Math.max(0, -t.amount), 0);
  return { rows, contributions, distributions, total: contributions + distributions };
}

/** Collects fields like the old setter: blanks skipped, text made WinAnsi-safe, checkboxes "X". */
function fields() {
  const out: Record<string, string> = {};
  return {
    out,
    text: (name: string, v: string | number | null | undefined) => {
      if (has(v)) out[name] = ascii(v);
    },
    check: (name: string, on = true) => {
      if (on) out[name] = "X";
    },
  };
}

/**
 * Form 5472 for a foreign-owned US company. `de` (default true): a disregarded entity (line 3 checked, Part V statement);
 * a C-corp files it with its 1120 (line 3 unchecked, Part IV left to the preparer).
 */
export const form5472: FormHook<IrsInput & { de?: boolean }> = (d) => {
  const { out, text, check } = fields();
  const { begin, end, initial } = irsPeriod(d);
  const de = d.de ?? true;
  const total = partV(d).total;
  const owner = [d.owner, d.ownerAddress].filter(Boolean).join(", ");

  text("Page1[0].Pg1Header[0].f1_1[0]", monthDay(begin));
  text("Page1[0].Pg1Header[0].f1_2[0]", begin.slice(0, 4));
  text("Page1[0].Pg1Header[0].f1_3[0]", monthDay(end));
  text("Page1[0].Pg1Header[0].f1_4[0]", end.slice(0, 4));
  // Part I
  text("Page1[0].Line1a[0].f1_5[0]", d.legalName);
  text("Page1[0].Line1a[0].f1_6[0]", d.address);
  text("Page1[0].Line1a[0].f1_7[0]", d.cityStateZip);
  text("Page1[0].f1_8[0]", d.ein);
  if (has(d.totalAssets)) text("Page1[0].f1_9[0]", usd(+d.totalAssets!));
  text("Page1[0].f1_10[0]", d.business);
  text("Page1[0].f1_11[0]", d.naics);
  if (de && d.transactions?.length) {
    text("Page1[0].Line1f_ReadOrder[0].f1_12[0]", usd(total));
    text("Page1[0].f1_14[0]", usd(total));
  }
  text("Page1[0].f1_13[0]", "1");
  check("Page1[0].Line1j_ReadOrder[0].c1_2[0]", initial);
  text("Page1[0].f1_16[0]", "United States");
  if (d.formed) text("Page1[0].f1_17[0]", mdy(d.formed));
  text("Page1[0].f1_18[0]", "United States"); // ponytail: DE files only the pro forma 1120 here; adjust if owner says otherwise
  text("Page1[0].f1_19[0]", "United States");
  check("Page1[0].c1_3[0]"); // line 2: foreign person owns >= 50%
  check("Page1[0].c1_4[0]", de); // line 3: foreign-owned U.S. DE
  // Part II: the foreign owner
  text("Page1[0].f1_20[0]", owner);
  text("Page1[0].f1_23[0]", d.ownerTin);
  text("Page1[0].f1_24[0]", d.ownerCountry);
  text("Page1[0].f1_25[0]", d.ownerCountry);
  text("Page1[0].f1_26[0]", d.ownerCountry);
  // Part III: related party = same owner, a foreign person
  check("Page2[0].c2_1[0]");
  text("Page2[0].f2_1[0]", owner);
  text("Page2[0].f2_4[0]", d.ownerTin);
  check("Page2[0].c2_2[0]"); // related to reporting corporation
  check("Page2[0].c2_4[0]"); // 25% foreign shareholder
  text("Page2[0].f2_7[0]", d.ownerCountry);
  text("Page2[0].f2_8[0]", d.ownerCountry);
  // Part V: contributions/distributions described on the attached statement
  check("Page2[0].PartV[0].c2_6[0]", de && !!d.transactions?.length);
  // Part VII: all "No" (37, 39, 40a, 41a, 42a, 42b, 43a; 38a/38c only apply if 37 is Yes)
  for (const n of [1, 4, 5, 6, 7, 8, 9]) check(`Page3[0].c3_${n}[1]`);
  return out;
};

/** Header, name/address, B (EIN), D (total assets), E(1) initial: shared by the pro forma and the real 1120. */
function head1120(d: IrsInput) {
  const f = fields();
  const { begin, end, initial } = irsPeriod(d);
  if (!begin.endsWith("-01-01")) {
    f.text("Page1[0].PgHeader[0].f1_1[0]", monthDay(begin));
    f.text("Page1[0].PgHeader[0].f1_2[0]", monthDay(end));
    f.text("Page1[0].PgHeader[0].f1_3[0]", end.slice(2, 4));
  }
  f.text("Page1[0].NameFieldsReadOrder[0].f1_4[0]", d.legalName);
  f.text("Page1[0].NameFieldsReadOrder[0].f1_5[0]", d.address);
  // "City, ST 12345" -> city / state / ZIP; anything else goes whole into city.
  const m = /^\s*(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/.exec(d.cityStateZip || "");
  f.text("Page1[0].NameFieldsReadOrder[0].f1_7[0]", m ? m[1] : d.cityStateZip);
  if (m) {
    f.text("Page1[0].NameFieldsReadOrder[0].f1_8[0]", m[2]!.toUpperCase());
    f.text("Page1[0].NameFieldsReadOrder[0].f1_10[0]", m[3]);
  }
  f.text("Page1[0].f1_11[0]", d.ein);
  if (has(d.totalAssets)) f.text("Page1[0].f1_13[0]", usd(+d.totalAssets!));
  f.check("Page1[0].c1_6[0]", initial);
  return f;
}

/** Pro forma 1120 of a foreign-owned DE: name, address, items B, D, E only. The writer also stamps "Foreign-owned U.S. DE" across the top. */
export const form1120ProForma: FormHook<IrsInput> = (d) => head1120(d).out;
export const PRO_FORMA_STAMP = "Foreign-owned U.S. DE";

/** The C-corp's 1120 page 1 from its P&L: income lines 1–11, deductions 22/26/27, taxable income 28/30, tax 31 (flat rate, no NOL). */
export function corpTax(d: Pick<CorpInput, "revenue" | "cogs" | "advertising" | "otherDeductions" | "otherIncome" | "corpRate">) {
  const gross = d.revenue - d.cogs,
    income = gross + d.otherIncome,
    deductions = d.advertising + d.otherDeductions,
    taxable = income - deductions;
  return { gross, income, deductions, taxable, tax: Math.max(0, taxable) * d.corpRate };
}
export const form1120: FormHook<CorpInput> = (d) => {
  const { out, text } = head1120(d);
  const c = corpTax(d);
  const n = (name: string, v: number) => {
    if (v) text(name, usd(v));
  };
  n("Page1[0].f1_14[0]", d.revenue);
  n("Page1[0].f1_16[0]", d.revenue);
  n("Page1[0].f1_17[0]", d.cogs);
  n("Page1[0].f1_18[0]", c.gross);
  n("Page1[0].f1_25[0]", d.otherIncome);
  text("Page1[0].f1_26[0]", usd(c.income));
  n("Page1[0].f1_37[0]", d.advertising);
  n("Page1[0].f1_41[0]", d.otherDeductions);
  text("Page1[0].f1_42[0]", usd(c.deductions));
  text("Page1[0].f1_43[0]", usd(c.taxable));
  text("Page1[0].f1_47[0]", usd(c.taxable));
  text("Page1[0].f1_48[0]", usd(c.tax));
  return out;
};

/** An LLC taxed as a C-corp, tax year y: its own 1120 (+ 5472 for the foreign owner), extension, dividend withholding. */
export function ccorpObligations(y: number, T: UsTable, p: UsProfile = {}): (Obligation & { extendedDue?: string })[] {
  const due = `${y + 1}-${T.dueMonthDay}`,
    extendedDue = `${y + 1}-${T.extendedMonthDay}`;
  return [
    { form: "1120", country: "us", why: `corporate income tax at ${Math.round(T.corpRate * 100)}% on taxable income`, due, extendedDue },
    { form: "5472", country: "us", why: "attached to the 1120: the foreign owner and reportable transactions with them", due, extendedDue },
    {
      form: "1042 / 1042-S",
      country: "us",
      why: `dividends to the foreign owner: ${Math.round(T.treatyDividend * 100)}% treaty withholding`,
      due: `${y + 1}-03-15`,
    },
    { form: "State annual report", country: "us", why: `depends on the state of formation (${p.state || "not set"})` },
  ];
}
