// Field maps of the official IRS blanks added for US persons' filings (the 5472 / 1120 maps are irs.ts). Same contract: each hook returns
// { pdf field name without IRS_PREFIX → value }, text as printed (WinAnsi-safe), a checked box "X"; blanks are left out. The blanks are the
// ones in pdfs.ts; which field is which line was read off the printed forms (the IRS PDFs carry no tooltips) and is pinned, with each
// field's position and label, in fixtures/irs-fields.json by forms.test.ts, so a new revision of a blank cannot slide numbers onto other lines.
//
// Schedule C (Form 1040) 2025       Page1[0]: f1_1 name, f1_2 SSN, f1_3 A principal business, BComb.f1_4 B code, f1_5 C business name,
//   DComb.f1_6 D EIN, f1_7/f1_8 E address; c1_1[0..2] F cash/accrual/other; c1_2 G material participation (0 yes, 1 no); c1_3 H started
//   this year; c1_4/c1_5 I/J 1099s; f1_10..f1_16 lines 1-7; Lines8-17 f1_17..f1_27 lines 8-17 (9 car, 13 depreciation, 16a/b); Lines18-27
//   f1_28..f1_38 lines 18-26, f1_40 27a, f1_39 27b; f1_41 28, f1_42 29, f1_43/44 30 sq ft, f1_45 30, f1_46 31; c1_7[0] 32a.
//   Page2[0]: Part III f2_1..f2_8 lines 35-42, c2_1..c2_3 line 33; Part IV f2_9-11 line 43, f2_12/13/14 44a/b/c, c2_7/c2_8 47a/b;
//   Part V PartVTable Item1..9 (f2_15/16 .. f2_31/32), f2_33 line 48.
// Schedule SE 2025   Page1[0]: f1_1 name, f1_2 SSN, f1_5 line 2, f1_6 3, f1_7 4a, f1_9 4c, f1_12 6, f1_14 8a, f1_17 8d, f1_18 9, f1_19 10,
//   f1_20 11, f1_21 12, f1_22 13.
// Form 8995 2025     Page1[0]: f1_01 name, f1_02 TIN, Table.Row1i f1_03 business, f1_04 TIN, f1_05 QBI; f1_18 line 2, f1_20 4, f1_21 5,
//   f1_26 10, f1_27 11, f1_28 12, f1_29 13, f1_30 14, f1_31 15.
// 1040-ES 2026       Page12 worksheet f12_1..f12_23 (lines 1..15), vouchers: 1 = Page15 f15_29.., 2 = f15_15.., 3 = f15_1.., 4 = Page14 f14_1..
// 1099-NEC           Copy B: 2026 revision CopyB.LeftCol f2_2.. / RightCol f2_20 (box 1a); 2025 revision payer in one field f2_2, box 1 f2_9.
import type { SchedCResult } from "./schedc.ts";
import type { SeResult, QbiResult, Installment, PersonalResult, EstimateResult } from "./tax.ts";
import type { UsProfile } from "./forms.ts";
import { fields, usd, irsPeriod } from "./irs.ts";
import { splitCityStateZip, type Nec } from "./contractors.ts";

const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "");
/** A TIN as printed: 9 bare digits get the separators of their kind (SSN/ITIN 123-45-6789, EIN 12-3456789); anything already formatted stays as typed. */
export function fmtTin(s: string | undefined, kind: "ssn" | "ein" = "ssn") {
  const raw = (s ?? "").trim(),
    d = digits(raw);
  if (d.length !== 9 || /[-\s]/.test(raw)) return raw;
  return kind === "ein" ? `${d.slice(0, 2)}-${d.slice(2)}` : `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}
export const taxpayer = (p: UsProfile) => p.taxpayerName || "";

// ---------- Schedule C ----------
const C = "Page1[0].";
export const SCHED_C_LINES: Readonly<Record<string, string>> = {
  "1": `${C}f1_10[0]`,
  "2": `${C}f1_11[0]`,
  "3": `${C}f1_12[0]`,
  "4": `${C}f1_13[0]`,
  "5": `${C}f1_14[0]`,
  "6": `${C}f1_15[0]`,
  "7": `${C}f1_16[0]`,
  "8": `${C}Lines8-17[0].f1_17[0]`,
  "9": `${C}Lines8-17[0].f1_18[0]`,
  "10": `${C}Lines8-17[0].f1_19[0]`,
  "11": `${C}Lines8-17[0].f1_20[0]`,
  "12": `${C}Lines8-17[0].f1_21[0]`,
  "13": `${C}Lines8-17[0].f1_22[0]`,
  "14": `${C}Lines8-17[0].f1_23[0]`,
  "15": `${C}Lines8-17[0].f1_24[0]`,
  "16a": `${C}Lines8-17[0].f1_25[0]`,
  "16b": `${C}Lines8-17[0].f1_26[0]`,
  "17": `${C}Lines8-17[0].f1_27[0]`,
  "18": `${C}Lines18-27[0].f1_28[0]`,
  "19": `${C}Lines18-27[0].f1_29[0]`,
  "20a": `${C}Lines18-27[0].f1_30[0]`,
  "20b": `${C}Lines18-27[0].f1_31[0]`,
  "21": `${C}Lines18-27[0].f1_32[0]`,
  "22": `${C}Lines18-27[0].f1_33[0]`,
  "23": `${C}Lines18-27[0].f1_34[0]`,
  "24a": `${C}Lines18-27[0].f1_35[0]`,
  "24b": `${C}Lines18-27[0].f1_36[0]`,
  "25": `${C}Lines18-27[0].f1_37[0]`,
  "26": `${C}Lines18-27[0].f1_38[0]`,
  "27a": `${C}Lines18-27[0].f1_40[0]`,
  "27b": `${C}Lines18-27[0].f1_39[0]`,
  "28": `${C}f1_41[0]`,
  "29": `${C}f1_42[0]`,
  "30": `${C}f1_45[0]`,
  "31": `${C}f1_46[0]`,
};
export const SCHED_C_PART3: Readonly<Record<string, string>> = {
  "35": "Page2[0].f2_1[0]",
  "36": "Page2[0].f2_2[0]",
  "37": "Page2[0].f2_3[0]",
  "38": "Page2[0].f2_4[0]",
  "39": "Page2[0].f2_5[0]",
  "40": "Page2[0].f2_6[0]",
  "41": "Page2[0].f2_7[0]",
  "42": "Page2[0].f2_8[0]",
};
const PART5 = [15, 17, 19, 21, 23, 25, 27, 29, 31].map(
  (n, k) => [`Page2[0].PartVTable[0].Item${k + 1}[0].f2_${n}[0]`, `Page2[0].PartVTable[0].Item${k + 1}[0].f2_${n + 1}[0]`] as const,
);

export interface SchedCCtx extends UsProfile {
  year: number;
  result: SchedCResult;
  /** The books show payments that need a Form 1099-NEC (Part I, lines I and J). */
  needs1099?: boolean;
  /** Square feet of the whole home, for line 30. */
  homeTotalSqft?: number;
}
export function formScheduleC(d: SchedCCtx): Readonly<Record<string, string>> {
  const { out, text, check } = fields(),
    r = d.result;
  text(`${C}f1_1[0]`, taxpayer(d));
  text(`${C}f1_2[0]`, fmtTin(d.ssn));
  text(`${C}f1_3[0]`, d.business);
  text(`${C}BComb[0].f1_4[0]`, digits(d.naics).slice(0, 6));
  if (d.legalName && d.legalName !== d.taxpayerName) text(`${C}f1_5[0]`, d.legalName);
  text(`${C}DComb[0].f1_6[0]`, digits(d.ein).slice(0, 9));
  text(`${C}f1_7[0]`, d.address);
  text(`${C}f1_8[0]`, d.cityStateZip);
  check(`${C}c1_1[0]`); // F: cash method, the books are cash basis
  check(`${C}c1_2[0]`); // G: materially participated
  check(`${C}c1_3[0]`, irsPeriod(d).initial && !!d.formed && d.formed.startsWith(String(d.year))); // H: started this year
  check(`${C}c1_4[${d.needs1099 ? 0 : 1}]`);
  if (d.needs1099) check(`${C}c1_5[0]`);
  for (const [line, name] of Object.entries(SCHED_C_LINES)) {
    const v = r.lines[line];
    if (v !== undefined && (v !== 0 || ["1", "3", "5", "7", "28", "29", "31"].includes(line))) text(name, usd(v));
  }
  if (r.homeOffice) {
    text(`${C}Line30_ReadOrder[0].f1_43[0]`, d.homeTotalSqft ? usd(d.homeTotalSqft) : "");
    text(`${C}Line30_ReadOrder[0].f1_44[0]`, usd(r.homeOffice.sqft));
  }
  if (r.netProfit < 0) check(`${C}c1_7[0]`); // 32a: all investment is at risk
  if (r.partIII) {
    for (const [line, name] of Object.entries(SCHED_C_PART3)) text(name, usd(r.partIII[line] ?? 0));
    check("Page2[0].c2_1[0]"); // 33a: cost
    check("Page2[0].c2_4[1]"); // 34: no change in how inventory is figured
  }
  if (r.vehicle) {
    const v = r.vehicle;
    if (v.placedInService) {
      text("Page2[0].f2_9[0]", v.placedInService.slice(5, 7));
      text("Page2[0].f2_10[0]", v.placedInService.slice(8, 10));
      text("Page2[0].f2_11[0]", v.placedInService.slice(0, 4));
    }
    text("Page2[0].f2_12[0]", usd(v.businessMiles));
    if (v.commutingMiles) text("Page2[0].f2_13[0]", usd(v.commutingMiles));
    if (v.otherMiles) text("Page2[0].f2_14[0]", usd(v.otherMiles));
    if (v.method === "standard" && v.businessMiles) {
      check("Page2[0].c2_7[0]"); // 47a: evidence: the trip log
      check("Page2[0].c2_8[0]"); // 47b: written
    }
  }
  r.partV.slice(0, 9).forEach((p, k) => {
    text(PART5[k]![0], p.label);
    text(PART5[k]![1], usd(p.amount));
  });
  if (r.partV.length) text("Page2[0].f2_33[0]", usd(r.partV.reduce((s, x) => s + x.amount, 0)));
  return out;
}

// ---------- Schedule SE ----------
const E = "Page1[0].";
export const SCHED_SE_LINES: Readonly<Record<string, string>> = {
  "2": `${E}f1_5[0]`,
  "3": `${E}f1_6[0]`,
  "4a": `${E}f1_7[0]`,
  "4c": `${E}f1_9[0]`,
  "6": `${E}f1_12[0]`,
  "8a": `${E}Line8a_ReadOrder[0].f1_14[0]`,
  "8d": `${E}f1_17[0]`,
  "9": `${E}f1_18[0]`,
  "10": `${E}f1_19[0]`,
  "11": `${E}f1_20[0]`,
  "12": `${E}f1_21[0]`,
  "13": `${E}f1_22[0]`,
};
export function formScheduleSE(d: UsProfile & { se: SeResult }): Readonly<Record<string, string>> {
  const { out, text } = fields(),
    s = d.se;
  text(`${E}f1_1[0]`, taxpayer(d));
  text(`${E}f1_2[0]`, fmtTin(d.ssn));
  const L = SCHED_SE_LINES;
  text(L["2"]!, usd(s.line2));
  text(L["3"]!, usd(s.line3));
  text(L["4a"]!, usd(s.line4a));
  text(L["4c"]!, usd(s.line4c));
  if (!s.owes) return out; // under $400: "stop; you don't owe self-employment tax"
  text(L["6"]!, usd(s.line6));
  if (s.line8d) {
    text(L["8a"]!, usd(s.line8d));
    text(L["8d"]!, usd(s.line8d));
  }
  text(L["9"]!, usd(s.line9));
  text(L["10"]!, usd(s.line10));
  text(L["11"]!, usd(s.line11));
  text(L["12"]!, usd(s.line12));
  text(L["13"]!, usd(s.line13));
  return out;
}

// ---------- Form 8995 ----------
export const F8995_LINES: Readonly<Record<string, string>> = {
  "2": `${E}Line2_ReadOrder[0].f1_18[0]`,
  "4": `${E}f1_20[0]`,
  "5": `${E}f1_21[0]`,
  "10": `${E}f1_26[0]`,
  "11": `${E}f1_27[0]`,
  "12": `${E}f1_28[0]`,
  "13": `${E}f1_29[0]`,
  "14": `${E}f1_30[0]`,
  "15": `${E}f1_31[0]`,
};
export function form8995(d: UsProfile & { qbi: QbiResult }): Readonly<Record<string, string>> {
  const { out, text } = fields(),
    q = d.qbi;
  text(`${E}f1_01[0]`, taxpayer(d));
  text(`${E}f1_02[0]`, fmtTin(d.ssn));
  text(`${E}Table[0].Row1i[0].f1_03[0]`, d.legalName || d.business);
  text(`${E}Table[0].Row1i[0].f1_04[0]`, d.ein ? fmtTin(d.ein, "ein") : fmtTin(d.ssn));
  text(`${E}Table[0].Row1i[0].f1_05[0]`, usd(q.line2));
  const v: Record<string, number> = {
    "2": q.line2,
    "4": q.line4,
    "5": q.line5,
    "10": q.line10,
    "11": q.line11,
    "12": q.line12,
    "13": q.line13,
    "14": q.line14,
    "15": q.deduction,
  };
  for (const [l, n] of Object.entries(v)) text(F8995_LINES[l]!, usd(n));
  return out;
}

// ---------- Form 1040-ES (2026): the estimated tax worksheet and the payment vouchers ----------
/** Voucher k (1-4) → its field names. Voucher 4 is at the foot of page 14, 3 / 2 / 1 stack on page 15 (top to bottom). */
export const VOUCHER: Readonly<
  Record<number, { amount: string; first: string; last: string; ssn: string; address: string; city: string; state: string; zip: string }>
> = {
  1: {
    amount: "Page15[0].f15_29[0]",
    first: "Page15[0].f15_30[0]",
    last: "Page15[0].f15_31[0]",
    ssn: "Page15[0].f15_32[0]",
    address: "Page15[0].f15_36[0]",
    city: "Page15[0].f15_37[0]",
    state: "Page15[0].f15_38[0]",
    zip: "Page15[0].f15_39[0]",
  },
  2: {
    amount: "Page15[0].f15_15[0]",
    first: "Page15[0].f15_16[0]",
    last: "Page15[0].f15_17[0]",
    ssn: "Page15[0].f15_18[0]",
    address: "Page15[0].f15_22[0]",
    city: "Page15[0].f15_23[0]",
    state: "Page15[0].f15_24[0]",
    zip: "Page15[0].f15_25[0]",
  },
  3: {
    amount: "Page15[0].f15_1[0]",
    first: "Page15[0].f15_2[0]",
    last: "Page15[0].f15_3[0]",
    ssn: "Page15[0].f15_4[0]",
    address: "Page15[0].f15_8[0]",
    city: "Page15[0].f15_9[0]",
    state: "Page15[0].f15_10[0]",
    zip: "Page15[0].f15_11[0]",
  },
  4: {
    amount: "Page14[0].f14_1[0]",
    first: "Page14[0].f14_2[0]",
    last: "Page14[0].f14_3[0]",
    ssn: "Page14[0].f14_4[0]",
    address: "Page14[0].f14_8[0]",
    city: "Page14[0].f14_9[0]",
    state: "Page14[0].f14_10[0]",
    zip: "Page14[0].f14_11[0]",
  },
};
export const ES_WORKSHEET: Readonly<Record<string, string>> = Object.fromEntries(
  ["1", "2a", "2b", "2c", "2d", "3", "4", "5", "6", "7", "8", "9", "10", "11a", "11b", "11c", "12a", "12b", "12c", "13", "14a", "14b", "15"].map((l, k) => [
    l,
    `Page12[0].f12_${k + 1}[0]`,
  ]),
);
/** The 2026 Estimated Tax Worksheet (page 12) from a personal-tax result and the estimate for it: line number → whole dollars. Lines 2c, 5 and 11b (Schedule 1-A, AMT, refundable credits) are not modelled and stay blank. */
export function esWorksheet(pt: PersonalResult, est: EstimateResult, credits = 0): Record<string, number> {
  const afterCredits = Math.max(0, pt.incomeTax - Math.max(0, credits));
  const w: Record<string, number> = {
    "1": pt.agi,
    "2a": pt.deduction,
    "2b": pt.qbi.deduction,
    "2d": pt.deduction + pt.qbi.deduction,
    "3": pt.taxable,
    "4": pt.incomeTax,
    "6": pt.incomeTax,
    "7": Math.max(0, credits),
    "8": afterCredits,
    "9": pt.se.line12,
    "10": pt.se.additionalMedicare,
    "11a": pt.totalTax,
    "11c": pt.totalTax,
    "12a": est.currentSafeHarbor,
    "12c": est.required,
    "13": pt.withholding,
    "14a": Math.max(0, est.required - pt.withholding),
    "14b": Math.max(0, pt.totalTax - pt.withholding),
    "15": est.installments[0]?.amount ?? 0,
  };
  if (est.priorSafeHarbor !== null) w["12b"] = est.priorSafeHarbor;
  return w;
}
export interface Es1040Ctx extends UsProfile {
  /** Worksheet lines: line number → whole dollars (1 expected AGI … 15 first payment). */
  worksheet?: Readonly<Record<string, number>>;
  installments: readonly Installment[];
  /** Installments due before this date (ISO) are not put on a voucher: they are past. */
  from?: string;
}
export function form1040ES(d: Es1040Ctx): Readonly<Record<string, string>> {
  const { out, text } = fields();
  for (const [l, n] of Object.entries(d.worksheet ?? {})) if (ES_WORKSHEET[l]) text(ES_WORKSHEET[l]!, usd(n));
  const words = taxpayer(d).trim().split(/\s+/),
    last = words.length > 1 ? words.pop()! : "",
    first = words.join(" "),
    csz = splitCityStateZip(d.cityStateZip);
  for (const i of d.installments) {
    if (i.amount <= 0 || (d.from && i.due < d.from)) continue;
    const v = VOUCHER[i.n]!;
    text(v.amount, usd(i.amount));
    text(v.first, first || last);
    if (first) text(v.last, last);
    text(v.ssn, fmtTin(d.ssn));
    text(v.address, d.address);
    text(v.city, csz.city);
    text(v.state, csz.state);
    text(v.zip, csz.zip);
  }
  return out;
}

// ---------- Form 1099-NEC, Copy B ----------
const B = "CopyB[0].";
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Rev. December 2026 (reporting year 2026): box 1a is nonemployee compensation. */
export function form1099NEC2026(d: Nec): Readonly<Record<string, string>> {
  const { out, text } = fields(),
    p = d.payer,
    r = d.recipient;
  text(`${B}PgHeader[0].CalendarYear[0].f2_1[0]`, String(d.year));
  text(`${B}LeftCol[0].f2_2[0]`, p.name);
  text(`${B}LeftCol[0].f2_3[0]`, p.address);
  text(`${B}LeftCol[0].f2_5[0]`, p.city);
  text(`${B}LeftCol[0].f2_6[0]`, p.phone);
  text(`${B}LeftCol[0].f2_7[0]`, p.state);
  text(`${B}LeftCol[0].f2_9[0]`, p.zip);
  text(`${B}LeftCol[0].f2_10[0]`, fmtTin(p.tin, p.tinType));
  text(`${B}LeftCol[0].f2_11[0]`, fmtTin(r.tin, r.tinType));
  text(`${B}LeftCol[0].f2_12[0]`, r.name);
  text(`${B}LeftCol[0].f2_13[0]`, r.street);
  text(`${B}LeftCol[0].f2_15[0]`, r.city);
  text(`${B}LeftCol[0].f2_16[0]`, r.state);
  text(`${B}LeftCol[0].f2_18[0]`, r.zip);
  text(`${B}RightCol[0].f2_20[0]`, money(d.box1a));
  return out;
}
/** Rev. April 2025 (reporting year 2025): box 1 is nonemployee compensation; the payer's whole block is one multi-line field (lines joined with \n: the writer turns multiline on). */
export function form1099NEC2025(d: Nec): Readonly<Record<string, string>> {
  const { out, text } = fields(),
    p = d.payer,
    r = d.recipient;
  text(`${B}PgHeader[0].CalendarYear[0].f2_1[0]`, String(d.year));
  text(
    `${B}LeftCol[0].f2_2[0]`,
    [p.name, [p.address, p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "), p.phone].filter(Boolean).join("\n"),
    true,
  );
  text(`${B}LeftCol[0].f2_3[0]`, fmtTin(p.tin, p.tinType));
  text(`${B}LeftCol[0].f2_4[0]`, fmtTin(r.tin, r.tinType));
  text(`${B}LeftCol[0].f2_5[0]`, r.name);
  text(`${B}LeftCol[0].f2_6[0]`, r.street);
  text(`${B}LeftCol[0].f2_7[0]`, [r.city, [r.state, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "));
  text(`${B}RightCol[0].f2_9[0]`, money(d.box1a));
  return out;
}
/** The page of the blank that holds Copy B (0-based). */
export const NEC_COPY_B_PAGE = 3;
