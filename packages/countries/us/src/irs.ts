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
import type { PartVIIAnswers, UsProfile } from "./forms.ts";
import type { UsTable } from "./schema.ts";

/** Every field name in the IRS PDFs starts with this. */
export const IRS_PREFIX = "topmostSubform[0].";

/**
 * Form 5472 Part IV vs Part V classification for a reportable transaction (i5472 instructions).
 * Part IV covers monetary transactions with a foreign related party in specified categories (lines 9–36).
 * Part V covers other reportable transactions of a foreign-owned U.S. DE not already entered in Part IV
 * (contributions, distributions, formation/dissolution, reimbursements, and other Reg. §1.482-1(i)(7) events).
 */
export type Part5472Treatment =
  | "contribution"
  | "distribution"
  | "formation"
  | "reimbursement"
  | "other-part5"
  | "services"
  | "rent"
  | "royalty"
  | "intangible"
  | "commission"
  | "loan"
  | "interest"
  | "other-part4";

export const PART_IV_TREATMENTS = new Set<Part5472Treatment>(["services", "rent", "royalty", "intangible", "commission", "loan", "interest", "other-part4"]);

/** A foreign or U.S. related party for Form 5472 Part III (one Form 5472 is filed per reportable related party). */
export interface RelatedParty5472 {
  id: string;
  name: string;
  address?: string;
  tin?: string;
  /** Default true (Part III foreign person checkbox c2_1[0]); false checks U.S. person c2_1[1]. */
  foreign?: boolean;
  businessCountry?: string;
  residenceCountry?: string;
  businessActivity?: string;
  naics?: string;
  /** Line 8e relationship flags. */
  relatedToReportingCorp?: boolean;
  relatedTo25Shareholder?: boolean;
  is25Shareholder?: boolean;
}

export interface IrsTxn {
  id?: string;
  date: string;
  desc: string;
  /** > 0 money from the related party to the LLC, < 0 money from the LLC to the related party. */
  amount: number;
  /** Another reportable transaction (legacy flag for non-equity tagged rows). */
  related?: boolean;
  /** Explicit Form 5472 Part IV / Part V treatment (e.g. "services" → Part IV line 29/15; "contribution" → Part V). */
  treatment?: Part5472Treatment;
  /** Counterparty id from `relatedParties`; omitted = primary foreign owner (Part II). */
  partyId?: string;
  /** Optional link to an earlier event (e.g., a reimbursement linking back to a personal formation-cost payment). */
  linkedEventId?: string;
  /** Original currency if non-USD, and supporting document reference for the preparer schedule. */
  currency?: string;
  evidence?: string;
}

export interface IrsInput extends UsProfile {
  year: number;
  /** Bank balances at year end (Form 5472 line 1c; C-corp 1120 item D). Never written to pro forma 1120 item D. */
  totalAssets?: number | string | null;
  /** Owner & related-party transactions of the year (Part IV / Part V, lines 1f / 1h). */
  transactions?: readonly IrsTxn[];
  /** Additional reportable related parties besides the direct 25% foreign owner (each gets its own Form 5472). */
  relatedParties?: readonly RelatedParty5472[];
  /** Override for line 1g (number of 5472s attached) and line 1h (gross payments across all 5472s), used by form5472Set. */
  formCount?: number;
  allFormsTotal?: number;
  /** Specific Part III related party for this single Form 5472 (defaults to the Part II foreign owner). */
  partIII?: RelatedParty5472;
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
export const usd = (n: number) => Math.round(n).toLocaleString("en-US");
const monthDay = (iso: string) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const has = (v: unknown) => v != null && v !== "";

/** First tax year starts at formation; a DE uses its owner's year, else calendar year. */
export function irsPeriod(d: Pick<IrsInput, "year" | "formed">) {
  const y = String(d.year);
  const begin = d.formed?.startsWith(y) ? d.formed : `${y}-01-01`;
  return { begin, end: `${y}-12-31`, initial: !!d.formed && d.formed.slice(0, 4) >= y };
}

/** Resolve the effective treatment of an IrsTxn (respects explicit `treatment`, falls back to legacy equity / related flag). */
export function treatmentOf(t: IrsTxn): Part5472Treatment {
  if (t.treatment) return t.treatment;
  const a = +t.amount || 0;
  if (t.related) return "other-part5";
  return a >= 0 ? "contribution" : "distribution";
}

/** Part IV PDF field map: [receivedField, paidField, receivedLine, paidLine] (f5472.pdf Rev. 12-2023). */
export const PART_IV_MAP: Readonly<
  Record<
    Exclude<Part5472Treatment, "contribution" | "distribution" | "formation" | "reimbursement" | "other-part5">,
    { recvField: string; paidField: string; recvLine: string; paidLine: string }
  >
> = {
  rent: { recvField: "Page2[0].f2_13[0]", paidField: "Page2[0].f2_29[0]", recvLine: "13a", paidLine: "27a" },
  royalty: { recvField: "Page2[0].f2_14[0]", paidField: "Page2[0].f2_30[0]", recvLine: "13b", paidLine: "27b" },
  intangible: { recvField: "Page2[0].f2_15[0]", paidField: "Page2[0].f2_31[0]", recvLine: "14", paidLine: "28" },
  services: { recvField: "Page2[0].f2_16[0]", paidField: "Page2[0].f2_32[0]", recvLine: "15", paidLine: "29" },
  commission: { recvField: "Page2[0].f2_17[0]", paidField: "Page2[0].f2_33[0]", recvLine: "16", paidLine: "30" },
  loan: { recvField: "Page2[0].f2_19[0]", paidField: "Page2[0].f2_35[0]", recvLine: "17b", paidLine: "31b" },
  interest: { recvField: "Page2[0].f2_20[0]", paidField: "Page2[0].f2_36[0]", recvLine: "18", paidLine: "32" },
  "other-part4": { recvField: "Page2[0].f2_23[0]", paidField: "Page2[0].f2_39[0]", recvLine: "21", paidLine: "35" },
};

/** Part IV monetary transactions summary (lines 9–22 received, lines 23–36 paid). */
export function partIV(d: Pick<IrsInput, "transactions">) {
  const byField: Record<string, number> = {};
  const byLine: Record<string, number> = {};
  const rows: (IrsTxn & { amount: number; treatment: Part5472Treatment; line: string; direction: "received" | "paid" })[] = [];
  let totalReceived = 0,
    totalPaid = 0;
  for (const t of [...(d.transactions ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const tr = treatmentOf(t);
    if (!PART_IV_TREATMENTS.has(tr)) continue;
    const amount = +t.amount || 0;
    if (!amount) continue;
    const spec = PART_IV_MAP[tr as keyof typeof PART_IV_MAP];
    const received = amount > 0;
    const abs = Math.abs(amount);
    const field = received ? spec.recvField : spec.paidField;
    const line = received ? spec.recvLine : spec.paidLine;
    byField[field] = (byField[field] ?? 0) + abs;
    byLine[line] = (byLine[line] ?? 0) + abs;
    if (received) totalReceived += abs;
    else totalPaid += abs;
    rows.push({ ...t, amount, treatment: tr, line, direction: received ? "received" : "paid" });
  }
  return { rows, byField, byLine, totalReceived, totalPaid, total: totalReceived + totalPaid };
}

/** Part V statement: DE reportable transactions NOT already entered in Part IV (contributions, distributions, formation, reimbursements, other). */
export function partV(d: Pick<IrsInput, "transactions">) {
  const kindOf = (t: IrsTxn, a: number) => {
    const tr = treatmentOf(t);
    if (tr === "contribution") return "Contribution" as const;
    if (tr === "distribution") return "Distribution" as const;
    if (tr === "formation") return "Formation / org cost" as const;
    if (tr === "reimbursement") return "Reimbursement" as const;
    return a >= 0 ? ("Received from owner" as const) : ("Paid to owner" as const);
  };
  const rows = [...(d.transactions ?? [])]
    .filter((t) => !PART_IV_TREATMENTS.has(treatmentOf(t)))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((t) => ({ ...t, amount: +t.amount || 0, treatment: treatmentOf(t), kind: kindOf(t, +t.amount || 0) }));
  const contributions = rows.reduce((s, t) => s + (t.treatment === "contribution" ? Math.abs(t.amount) : 0), 0),
    distributions = rows.reduce((s, t) => s + (t.treatment === "distribution" ? Math.abs(t.amount) : 0), 0),
    other = rows.reduce((s, t) => s + (t.treatment !== "contribution" && t.treatment !== "distribution" ? Math.abs(t.amount) : 0), 0);
  return { rows, contributions, distributions, other, total: contributions + distributions + other };
}

/** Validation issue for Form 5472 / pro forma 1120 readiness (checks actual rendered WinAnsi/ASCII values and explicit Part VII answers). */
export interface Validation5472Issue {
  field: string;
  code: "missing" | "nonAscii" | "unansweredPartVII" | "relatedPartyIncomplete";
  detail?: string;
}

/** Required Part VII questions (43a applies only to corporations, never to a foreign-owned U.S. DE). */
export function requiredPartVII(de: boolean, answers?: PartVIIAnswers): (keyof PartVIIAnswers)[] {
  const qs: (keyof PartVIIAnswers)[] = ["q37", "q39", "q40a", "q41a", "q42a", "q42b"];
  if (answers?.q37 === true) qs.splice(1, 0, "q38a", "q38c");
  if (!de) qs.push("q43a");
  return qs;
}

/** Validate Form 5472 inputs against what actually renders onto the WinAnsi IRS PDFs. */
export function validate5472(d: IrsInput & { de?: boolean }): Validation5472Issue[] {
  const issues: Validation5472Issue[] = [];
  const de = d.de ?? true;
  const checkAsciiField = (field: string, raw: string | undefined) => {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) {
      issues.push({ field, code: "missing" });
      return;
    }
    if (!ascii(trimmed).trim()) issues.push({ field, code: "nonAscii", detail: trimmed });
  };
  checkAsciiField("legalName", d.legalName);
  checkAsciiField("ein", d.ein);
  checkAsciiField("state", d.state);
  checkAsciiField("formed", d.formed);
  checkAsciiField("address", d.address);
  checkAsciiField("cityStateZip", d.cityStateZip);
  checkAsciiField("naics", d.naics);
  checkAsciiField("business", d.business);
  checkAsciiField("businessCountries", d.businessCountries);
  checkAsciiField("owner", d.ownerLegalName?.trim() ? d.ownerLegalName : d.owner);
  checkAsciiField("ownerAddress", d.ownerAddress);
  checkAsciiField("ownerBusinessCountry", d.ownerBusinessCountry || d.ownerCountry);
  checkAsciiField("ownerCitizenship", d.ownerCitizenship || d.ownerCountry);
  checkAsciiField("ownerResidence", d.ownerResidence || d.ownerCountry);
  checkAsciiField("ownerTin", d.ownerTin);

  for (const q of requiredPartVII(de, d.partVII)) {
    if (typeof d.partVII?.[q] !== "boolean") issues.push({ field: `partVII.${q}`, code: "unansweredPartVII" });
  }
  const usedParties = new Set((d.transactions ?? []).map((t) => t.partyId).filter((x): x is string => !!x));
  for (const pid of usedParties) {
    const rp = (d.relatedParties ?? []).find((p) => p.id === pid);
    if (!rp || !ascii(rp.name).trim() || !ascii(rp.residenceCountry || rp.businessCountry).trim()) {
      issues.push({ field: `relatedParty.${pid}`, code: "relatedPartyIncomplete", detail: rp?.name || pid });
    }
  }
  return issues;
}

/** Collects fields like the old setter: blanks skipped, text made WinAnsi-safe, checkboxes "X". */
export function fields() {
  const out: Record<string, string> = {};
  return {
    out,
    /** `lines`: keep line breaks (a multi-line field; the writer turns multiline on for values that contain one). */
    text: (name: string, v: string | number | null | undefined, lines = false) => {
      if (has(v)) {
        const rendered = lines ? String(v).split("\n").map(ascii).join("\n") : ascii(v);
        if (rendered.trim() || rendered === "0" || rendered === "-0") out[name] = rendered;
      }
    },
    check: (name: string, on = true) => {
      if (on) out[name] = "X";
    },
  };
}

/** Map Part VII question keys to their PDF checkbox index (c3_N[0] = Yes, c3_N[1] = No). */
const PART_VII_BOX: Readonly<Record<keyof PartVIIAnswers, number>> = {
  q37: 1,
  q38a: 2,
  q38c: 3,
  q39: 4,
  q40a: 5,
  q41a: 6,
  q42a: 7,
  q42b: 8,
  q43a: 9,
};

/**
 * Form 5472 for a foreign-owned US company (one related party). `de` (default true): a disregarded entity (line 3 checked;
 * Part IV populated for monetary Part IV categories like services/rent/royalties/loans, Part V checked only for non-Part-IV DE events).
 * Part VII checkboxes are set strictly from explicit answers in `partVII` (never silently hardcoded "No").
 */
export const form5472: FormHook<IrsInput & { de?: boolean }> = (d) => {
  const { out, text, check } = fields();
  const { begin, end, initial } = irsPeriod(d);
  const de = d.de ?? true;
  const p4 = partIV(d);
  const p5 = partV(d);
  const formTotal = p4.total + (de ? p5.total : 0);
  const formCount = d.formCount ?? 1;
  const allTotal = d.allFormsTotal ?? formTotal;

  const ownerName = d.ownerLegalName?.trim() || d.owner;
  const owner = [ownerName, d.ownerAddress].filter(Boolean).join(", ");
  const ownerBizCountry = d.ownerBusinessCountry?.trim() || d.ownerCountry;
  const ownerCit = d.ownerCitizenship?.trim() || d.ownerCountry;
  const ownerRes = d.ownerResidence?.trim() || d.ownerCountry;

  const rp = d.partIII;
  const rpForeign = rp ? (rp.foreign ?? true) : true;
  const rpNameAddr = rp ? [rp.name, rp.address].filter(Boolean).join(", ") : owner;
  const rpTin = rp ? rp.tin : d.ownerTin;
  const rpBizCountry = rp ? rp.businessCountry || rp.residenceCountry : ownerBizCountry;
  const rpResCountry = rp ? rp.residenceCountry || rp.businessCountry : ownerRes;

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
  if (formTotal > 0) text("Page1[0].Line1f_ReadOrder[0].f1_12[0]", usd(formTotal));
  text("Page1[0].f1_13[0]", String(formCount));
  if (allTotal > 0) text("Page1[0].f1_14[0]", usd(allTotal));
  check("Page1[0].Line1j_ReadOrder[0].c1_2[0]", initial);
  text("Page1[0].f1_16[0]", "United States");
  if (d.formed) text("Page1[0].f1_17[0]", mdy(d.formed));
  text("Page1[0].f1_18[0]", d.taxReturnCountry); // 1n: blank unless the profile names one
  text("Page1[0].f1_19[0]", d.businessCountries); // 1o: principal country(ies) where business is conducted
  check("Page1[0].c1_3[0]"); // line 2: foreign person owns >= 50%
  check("Page1[0].c1_4[0]", de); // line 3: foreign-owned U.S. DE
  // Part II: the direct 25% foreign shareholder / owner
  text("Page1[0].f1_20[0]", owner);
  text("Page1[0].f1_23[0]", d.ownerTin);
  text("Page1[0].f1_24[0]", ownerBizCountry);
  text("Page1[0].f1_25[0]", ownerCit);
  text("Page1[0].f1_26[0]", ownerRes);
  // Part III: related party for this Form 5472
  check(rpForeign ? "Page2[0].c2_1[0]" : "Page2[0].c2_1[1]");
  text("Page2[0].f2_1[0]", rpNameAddr);
  text("Page2[0].f2_4[0]", rpTin);
  if (rp?.businessActivity) text("Page2[0].f2_5[0]", rp.businessActivity);
  if (rp?.naics) text("Page2[0].f2_6[0]", rp.naics);
  check("Page2[0].c2_2[0]", rp ? (rp.relatedToReportingCorp ?? true) : true);
  check("Page2[0].c2_3[0]", rp ? !!rp.relatedTo25Shareholder : false);
  check("Page2[0].c2_4[0]", rp ? !!rp.is25Shareholder : true);
  text("Page2[0].f2_7[0]", rpBizCountry);
  text("Page2[0].f2_8[0]", rpResCountry);
  // Part IV: monetary transactions with a foreign related party (lines 9–36)
  if (rpForeign && p4.rows.length) {
    for (const [field, amount] of Object.entries(p4.byField)) text(field, usd(amount));
    if (p4.totalReceived > 0) text("Page2[0].f2_24[0]", usd(p4.totalReceived)); // line 22
    if (p4.totalPaid > 0) text("Page2[0].f2_40[0]", usd(p4.totalPaid)); // line 36
  }
  // Part V: ONLY for foreign-owned U.S. DE reportable transactions not already reported in Part IV
  check("Page2[0].PartV[0].c2_6[0]", de && p5.rows.length > 0);
  // Part VII: written strictly from explicit answers (never silently hardcoded "No"). 43a/43b left blank for a DE.
  if (d.partVII) {
    for (const [k, n] of Object.entries(PART_VII_BOX) as [keyof PartVIIAnswers, number][]) {
      if (k === "q43a" && de) continue;
      if ((k === "q38a" || k === "q38c") && d.partVII.q37 !== true) continue;
      const ans = d.partVII[k];
      if (typeof ans === "boolean") check(`Page3[0].c3_${n}[${ans ? 0 : 1}]`);
    }
  }
  return out;
};

/**
 * Build one Form 5472 per reportable related party (owner + any additional related parties with transactions).
 * Sets line 1g to the total form count and line 1h to the combined gross payments across all forms.
 */
export function form5472Set(d: IrsInput & { de?: boolean }) {
  const de = d.de ?? true;
  const txns = d.transactions ?? [];
  const byParty = new Map<string, IrsTxn[]>();
  byParty.set("__owner__", []);
  for (const t of txns) {
    const key = t.partyId && (d.relatedParties ?? []).some((p) => p.id === t.partyId) ? t.partyId : "__owner__";
    const list = byParty.get(key) ?? [];
    list.push(t);
    byParty.set(key, list);
  }
  // Keep owner form always (even with 0 txns) + every extra related party that has at least one transaction
  const entries = [...byParty.entries()].filter(([k, list]) => k === "__owner__" || list.length > 0);
  const stats = entries.map(([key, list]) => {
    const party = key === "__owner__" ? undefined : (d.relatedParties ?? []).find((p) => p.id === key);
    const p4 = partIV({ transactions: list });
    const p5 = partV({ transactions: list });
    const total = p4.total + (de ? p5.total : 0);
    return { key, party, list, p4, p5, total };
  });
  const formCount = stats.length;
  const allFormsTotal = stats.reduce((s, x) => s + x.total, 0);
  return stats.map((x) => ({
    partyId: x.key,
    partyName: x.party?.name ?? (d.ownerLegalName?.trim() || d.owner || "Owner"),
    party: x.party,
    partIV: x.p4,
    partV: x.p5,
    total: x.total,
    fields: form5472({
      ...d,
      de,
      transactions: x.list,
      partIII: x.party,
      formCount,
      allFormsTotal,
    }),
  }));
}

/** Header, name/address, B (EIN), optional D (total assets), E(1) initial. */
function head1120(d: IrsInput, includeAssets: boolean) {
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
  if (includeAssets && has(d.totalAssets)) f.text("Page1[0].f1_13[0]", usd(+d.totalAssets!));
  f.check("Page1[0].c1_6[0]", initial);
  return f;
}

/**
 * Pro forma 1120 of a foreign-owned U.S. DE: per IRS Form 5472 instructions, enter ONLY Name, Address,
 * item B (EIN), and item E (initial/final/name/address change). Do NOT enter item D (total assets goes on 5472 line 1c).
 * The writer also stamps "Foreign-owned U.S. DE" across the top.
 */
export const form1120ProForma: FormHook<IrsInput> = (d) => head1120(d, false).out;
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
  const { out, text } = head1120(d, true);
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
