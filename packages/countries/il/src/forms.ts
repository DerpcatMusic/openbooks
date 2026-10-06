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
    "040": "",
  };
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
    cap = n("060");
  const resident = v("020") ? 2.25 : 0,
    soldier = v("224") ? soldierPoints(p.discharge, p.serviceMonths, i.y) : 0,
    points = resident + soldier;
  const ordTax = bands(ord, T.brackets),
    capTax = cap * (T.capitalRate ?? 0.15),
    gross = ordTax + capTax;
  const credits = Math.min(gross, points * T.point),
    due = Math.round(gross - credits),
    withheld = n("040");
  return {
    fields: { ...auto, ...Object.fromEntries(Object.entries(f).filter(([, x]) => x != null)) } as Record<string, string>,
    turnover,
    capital,
    taxable: ord,
    rows: bracketRows(ord, T.brackets),
    cap,
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
    ask: i.txns.filter((t) => t.category === "ask"),
  };
}
