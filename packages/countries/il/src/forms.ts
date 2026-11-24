import cpi from "../tables/cpi.json";
import { ORDINARY, PERSONAL, RATED, WITHHELD, proofsNeeded } from "./catalog.ts";
// Form 1301 (annual return) from the books: port of books(y) in web/src/lib/books.svelte.js. Field keys are the form's box numbers
// (layout in packages/countries/il/form/, from layout.py). Values the user typed on the Tax page (doc "form"[year]) override the automatic ones.
import { group, isBiz, plOf } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import { bands, soldierPoints } from "./calc.ts";
import { foreignTaxCreditCap } from "./crossborder.ts";
import type { IlTable } from "./schema.ts";

export interface Profile {
  first?: string;
  last?: string;
  id?: string;
  discharge?: string;
  serviceMonths?: number;
  bitName?: string;
}
export interface Form1301Input {
  y: number;
  txns: readonly Txn[];
  type: string;
  T: IlTable;
  form?: Readonly<Record<string, string | null | undefined>>;
  profile?: Profile;
  /** Expenses the deduction rules disallow (core deductions().totals.nonDeductible): taken off the raw expense sum on the actual-expenses track. */
  disallowed?: number;
  /** ISO date to price the refund's linkage and interest at (the site uses the day it calculates). */
  today?: string;
  /**
   * VAT-registered books (osek murshe, Ltd): the return takes turnover and expenses WITHOUT VAT. `turnover`: the year's sales before VAT (the
   * VAT reports' taxable + zero-rated sales); `reclaimed`: all input VAT reclaimed in the year, taken off the expenses.
   */
  vat?: { turnover: number; reclaimed: number };
  /** Equipment: its cost (before reclaimed VAT) was in the expenses when paid; it is deducted as depreciation instead (appendix 1342). */
  capital?: { cost: number; depreciation: number };
  /** Income-tax advances paid for the year (they come off the balance; the site takes them from the Tax Authority's records). */
  advances?: number;
  /** Osek zair is closed to the person (crossborder.ts zairExclusion): no zair box, actual expenses instead of the 30% deemed. */
  zairExcluded?: boolean;
  /**
   * Foreign business income attributed to the person (a transparent foreign entity's profit, ₪ at each transaction's Bank of Israel rate)
   * and the foreign tax paid on it in ₪: reported on appendix 1324, taxed with the personal-exertion income, credited up to the Israeli tax.
   */
  foreign?: { income: number; taxPaid: number };
  /**
   * Automatic boxes derived from tagged expenses (form1301FromBooks: donations 037, study fund 136, life 036, disability 112).
   * Merged BEFORE calculating tax so displayed boxes and calculated tax always agree 100%; user overrides in `form` still win.
   */
  bookBoxes?: Readonly<Record<string, string>>;
}

/** Per-bracket breakdown for the Tax page: [{ rate, part, tax }] for brackets that hold income. */
export function bracketRows(income: number, brackets: IlTable["brackets"]) {
  const rows: { rate: number; part: number; tax: number }[] = [];
  let lo = 0;
  for (const [hi, rate] of brackets) {
    const part = Math.max(0, Math.min(income, hi ?? Infinity) - lo);
    if (part > 0) rows.push({ rate, part, tax: part * rate });
    lo = hi ?? Infinity;
  }
  return rows;
}

/** The automatic 1301 field values (strings, as printed). */
export function form1301Auto({
  txns,
  type,
  profile: p = {},
  disallowed = 0,
  vat,
  capital,
  zairExcluded,
}: Pick<Form1301Input, "txns" | "type" | "profile" | "disallowed" | "vat" | "capital" | "zairExcluded">): Record<string, string> {
  const turnover = vat ? vat.turnover : txns.filter((t) => isBiz(t.category)).reduce((a, t) => a + t.amount, 0);
  const zair = type === "osek-zair" && !zairExcluded,
    expenses =
      -txns.filter((t) => ["cogs", "expense"].includes(plOf(t.category) ?? "")).reduce((a, t) => a + t.amount, 0) -
      disallowed -
      (vat?.reclaimed ?? 0) -
      (capital ? capital.cost - capital.depreciation : 0);
  return {
    last: p.last ?? "",
    first: p.first ?? "",
    id: p.id ?? "",
    file: p.id ?? "",
    mine: "X",
    zair: zair ? "X" : "",
    "238": String(Math.round(turnover)),
    "150": String(Math.round(zair ? turnover * 0.7 : Math.max(0, turnover - expenses))),
    "186": "0",
    "294": String(Math.round(turnover)),
    "020": "X",
    "224": p.discharge?.slice(0, 4) ?? "",
    "224m": p.discharge ? String(+p.discharge.slice(5, 7)) : "",
    "024": String(p.serviceMonths ?? ""),
    "060": "",
    "157": "",
    "040": "",
  };
}

/** Index known on `date` (מדד ידוע): month M's index is published on the 15th of M+1. */
function knownCpi(date: string): number | undefined {
  const d = new Date(date + "T00:00:00Z");
  const pub = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return Date.UTC(y!, m!, 15); // month index m (0-based) = the month after ym
  };
  const known = Object.keys(cpi.index)
    .filter((ym) => pub(ym) <= +d)
    .sort();
  return known.length ? cpi.index[known.at(-1) as keyof typeof cpi.index] : undefined;
}

/**
 * Linkage and interest the Tax Authority adds to a refund (Ordinance s.159א): the CPI rise plus 4% a year on the linked amount,
 * from the later of the end of the tax year and the payment date, until `today`. Tax withheld during the year counts from 31.12.
 * ponytail: without both CPI points it assumes 2.5%/yr inflation; add months to tables/cpi.json to make it exact.
 */
export function refundIndexation(amount: number, y: number, today: string, paid = `${y}-12-31`): number {
  const start = paid > `${y}-12-31` ? paid : `${y}-12-31`;
  const days = (Date.parse(today) - Date.parse(start)) / 864e5;
  if (amount <= 0 || days <= 0) return 0;
  const a = knownCpi(start),
    b = knownCpi(today);
  const linked = amount * Math.max(1, a && b ? b / a : 1 + (0.025 * days) / 365);
  return Math.round(linked - amount + (linked * 0.04 * days) / 365);
}

/** Everything the return needs for a year (the Tax page, Home, Documents, Print, and MCP tax_summary). */
export function form1301(i: Form1301Input) {
  const auto = { ...form1301Auto(i), ...i.bookBoxes },
    f = i.form ?? {},
    p = i.profile ?? {},
    T = i.T;
  const v = (k: string) => f[k] ?? auto[k] ?? "";
  const n = (k: string) => +String(v(k)).replace(/,/g, "") || 0;
  const turnover = i.vat ? i.vat.turnover : i.txns.filter((t) => isBiz(t.category)).reduce((a, t) => a + t.amount, 0);
  const capital = i.txns.filter((t) => group(t.category) === "capital");
  const sum = (ks: readonly string[]) => ks.reduce((a, k) => a + n(k), 0);
  const foreign = Math.max(0, i.foreign?.income ?? 0);
  const ord = sum(ORDINARY) + foreign,
    personal = sum(PERSONAL) + foreign,
    // every special-rate box with a value; 060's rate stays editable in Settings (capitalRate)
    special = RATED.filter((d) => n(d.no!)).map((d) => {
      const rate = d.no === "060" ? (T.capitalRate ?? d.rate!) : d.rate!;
      return { no: d.no!, he: d.he, en: d.en, amount: n(d.no!), rate, tax: n(d.no!) * rate };
    }),
    cap15 = n("060"), // provident-fund gains on deposits from 2003–2005 (15%)
    cap25 = n("157"), // provident-fund / child-savings gains on deposits from 2006 (25%), e.g. חיסכון לכל ילד
    cap = special.reduce((a, x) => a + x.amount, 0);
  // Personal deductions the site computes from the amounts paid (1301 guide 2025 rows 49, 51, 53, 54), on business income (150 + attributed):
  // 135 pension §47 up to depositPct of qualifying income (the rest moves to the 268 credit), 136 study fund §17(5א), 112 loss of work capacity,
  // 030 52% of BL paid. A year table without these rates (2024) deducts nothing.
  const business = n("150") + foreign,
    qualifying = Math.min(business, (T.mezakaMonthly ?? 0) * 24),
    pensionDed = Math.min(n("135"), (T.depositPct ?? 0) * qualifying),
    disability = Math.min(n("112"), (T.disabilityPct ?? 0) * Math.min(business, T.disabilityIncomeCap ?? 0)),
    deductions = {
      "135": pensionDed,
      "136": Math.min(n("136"), (T.khPct ?? 0) * Math.min(business, T.khIncomeCap ?? 0)),
      "112": disability,
      "030": Math.min((T.blDeductPct ?? 0) * n("030"), Math.max(0, business - pensionDed)),
    },
    deducted = Object.values(deductions).reduce((a, x) => a + x, 0),
    taxable = Math.max(0, ord - deducted);
  const resident = v("020") ? 2.25 : 0,
    soldier = v("224") ? soldierPoints(p.discharge, p.serviceMonths, i.y) : 0,
    points = resident + soldier;
  const ordTax = bands(taxable, T.brackets),
    capTax = special.reduce((a, x) => a + x.tax, 0),
    gross = ordTax + capTax,
    // ponytail: personal exertion's share of the bracket tax, pro rata; exact would tax it first (it sits at the bottom brackets)
    personalTax = ord ? (ordTax * personal) / ord : 0;
  // the discharged-soldier credit (s.39א) only offsets tax on personal exertion. Credit points come off the bracket tax only:
  // special-rate tax a fund withholds (e.g. a lump-sum child-savings or provident-fund withdrawal at 25% of the real gain) is final,
  // so box 040 withholding settles it and is not refunded against unused credit points.
  const creditsAvailable = resident * T.point + Math.min(soldier * T.point, personalTax),
    credits = Math.min(creditsAvailable, ordTax);
  // Credits for payments, after the points (1301 guide 2025 rows 73, 76, 78א): 268 pension 35% of deposits up to 5.5% of qualifying income
  // (5% when 112 is claimed, §45א(ו)) plus what 135 could not deduct; 037 donations 35% above the minimum, up to 30% of taxable income;
  // 036 life insurance 25%, base up to 5% of qualifying income.
  const rate = T.creditRate ?? 0,
    paymentCredits = {
      "268": rate * Math.min(n("268") + n("135") - pensionDed, (disability ? (T.creditPctDisability ?? 0) : (T.creditPct ?? 0)) * qualifying),
      "037": n("037") >= (T.donationMin ?? Infinity) ? rate * Math.min(n("037"), 0.3 * taxable) : 0,
      "036": (T.lifeCreditRate ?? 0) * Math.min(n("036"), 0.05 * qualifying),
    },
    otherCredits = Math.min(
      Object.values(paymentCredits).reduce((a, x) => a + x, 0),
      ordTax - credits,
    );
  // Foreign tax credit (appendix 1324): uses the exact same shared Ordinance §204 cap formula as ilCrossBorder().
  const foreignTaxCredit = foreignTaxCreditCap({
    netOrdinaryTax: ordTax - credits - otherCredits,
    ordinaryIncome: ord,
    foreignIncome: foreign,
    foreignTaxPaid: i.foreign?.taxPaid ?? 0,
  });
  const due = Math.round(ordTax - credits - otherCredits - foreignTaxCredit) + Math.round(capTax),
    withheld = sum(WITHHELD),
    advances = Math.round(i.advances ?? 0);
  return {
    fields: { ...auto, ...Object.fromEntries(Object.entries(f).filter(([, x]) => x != null)) } as Record<string, string>,
    turnover,
    capital,
    taxable,
    rows: bracketRows(taxable, T.brackets),
    cap,
    cap15,
    cap25,
    special,
    /** Personal deductions applied (by box) and the credits for payments (by box), in ₪. */
    deductions,
    paymentCredits,
    otherCredits,
    /** Appendix 1324: attributed foreign income, the foreign tax paid on it and the credit allowed. */
    f1324: { income: foreign, taxPaid: i.foreign?.taxPaid ?? 0, credit: foreignTaxCredit },
    /** Documents the guide asks for, per box with a value. */
    proofs: proofsNeeded(n),
    ordTax,
    capTax,
    gross,
    resident,
    soldier,
    points,
    /** Credits used (at most the bracket tax); creditsAvailable is what the points are worth. */
    credits,
    creditsAvailable,
    due,
    withheld,
    /** Income-tax advances paid for the year (Filings > Advances). */
    advances,
    balance: due - withheld - advances, // > 0 pay, < 0 refund
    /** What the site adds to a refund for linkage and interest as of `today` (0 when there's tax to pay). */
    indexation: i.today && due < withheld + advances ? refundIndexation(withheld + advances - due, i.y, i.today) : 0,
    ask: i.txns.filter((t) => t.category === "ask"),
  };
}

/**
 * Return boxes the books can fill from their tagged expenses (deduction engine byRule rows): donations (037), study fund (136, after its cap),
 * life insurance (036) and loss-of-work-capacity insurance (112). The site applies the credit / deduction rules; these are the amounts to type.
 * Boxes without tagged spending are left out so they stay editable.
 */
export function form1301FromBooks(byRule: readonly { rule: string; gross: number; deductible: number }[]): Record<string, string> {
  const BOX: Readonly<Record<string, { no: string; use: "gross" | "deductible" }>> = {
    "il.donations": { no: "037", use: "gross" },
    "il.keren-hishtalmut": { no: "136", use: "deductible" },
    "il.insurance.life-credit": { no: "036", use: "gross" },
    "il.insurance.disability": { no: "112", use: "gross" },
  };
  const out: Record<string, string> = {};
  for (const r of byRule) {
    const b = BOX[r.rule];
    const v = b ? Math.round(r[b.use]) : 0;
    if (b && v > 0) out[b.no] = String((+out[b.no]! || 0) + v);
  }
  return out;
}
