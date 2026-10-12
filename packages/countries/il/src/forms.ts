import cpi from "../tables/cpi.json";
// Form 1301 (annual return) from the books: port of books(y) in web/src/lib/books.svelte.js. Field keys are the form's box numbers
// (layout in packages/countries/il/form/, from layout.py). Values the user typed on the Tax page (doc "form"[year]) override the automatic ones.
import { group, isBiz, plOf } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import { bands, soldierPoints } from "./calc.ts";
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
  /** ISO date to price the refund's linkage and interest at (the site uses the day it calculates). */
  today?: string;
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
export function form1301Auto({ txns, type, profile: p = {} }: Pick<Form1301Input, "txns" | "type" | "profile">): Record<string, string> {
  const turnover = txns.filter((t) => isBiz(t.category)).reduce((a, t) => a + t.amount, 0);
  const zair = type === "osek-zair",
    expenses = -txns.filter((t) => ["cogs", "expense"].includes(plOf(t.category) ?? "")).reduce((a, t) => a + t.amount, 0);
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

/** Section 15 of the 1301 (field 157): real gain on provident-fund deposits from 2006 is taxed at 25%. */
export const FUND_RATE_2006 = 0.25;

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

/** Everything the return needs for a year (the Tax page and tax_summary). */
export function form1301(i: Form1301Input) {
  const auto = form1301Auto(i),
    f = i.form ?? {},
    p = i.profile ?? {},
    T = i.T;
  const v = (k: string) => f[k] ?? auto[k] ?? "";
  const n = (k: string) => +String(v(k)).replace(/,/g, "") || 0;
  const turnover = i.txns.filter((t) => isBiz(t.category)).reduce((a, t) => a + t.amount, 0);
  const capital = i.txns.filter((t) => group(t.category) === "capital");
  const ord = n("150"),
    cap15 = n("060"), // provident-fund gains on deposits from 2003–2005 (15%)
    cap25 = n("157"), // provident-fund / child-savings gains on deposits from 2006 (25%), e.g. חיסכון לכל ילד
    cap = cap15 + cap25;
  const resident = v("020") ? 2.25 : 0,
    soldier = v("224") ? soldierPoints(p.discharge, p.serviceMonths, i.y) : 0,
    points = resident + soldier;
  const ordTax = bands(ord, T.brackets),
    capTax = cap15 * (T.capitalRate ?? 0.15) + cap25 * FUND_RATE_2006,
    gross = ordTax + capTax;
  // resident points offset any tax; the discharged-soldier credit (s.39א) only tax on personal exertion (ordTax)
  const credits = resident * T.point + Math.min(soldier * T.point, ordTax),
    due = Math.max(0, Math.round(gross - credits)),
    withheld = n("040");
  return {
    fields: { ...auto, ...Object.fromEntries(Object.entries(f).filter(([, x]) => x != null)) } as Record<string, string>,
    turnover,
    capital,
    taxable: ord,
    rows: bracketRows(ord, T.brackets),
    cap,
    cap15,
    cap25,
    ordTax,
    capTax,
    gross,
    resident,
    soldier,
    points,
    credits,
    due,
    withheld,
    balance: due - withheld, // > 0 pay, < 0 refund
    /** What the site adds to a refund for linkage and interest as of `today` (0 when there's tax to pay). */
    indexation: i.today && due < withheld ? refundIndexation(withheld - due, i.y, i.today) : 0,
    ask: i.txns.filter((t) => t.category === "ask"),
  };
}
