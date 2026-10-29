// Payroll runs (doc "payroll" = PayrollRun[]): the books record what a payroll provider (Gusto, ADP, Rippling, an Israeli payroll bureau) ran.
// OpenBooks does NOT calculate payroll tax: no withholding, no employer contribution, no filing amounts. The figures come from the provider's
// register (typed or imported from its CSV) and are only checked against each other: net = gross - employee withholding - benefits.
// The same model serves Israel and the United States; a country's own names (national insurance, FICA, Form 941) are the user's labels.
//
// Ledger lines (accrual basis, on the pay date; the cash basis counts wages when the bank rows are filed, so nothing is posted there):
//   Dr wages expense                gross
//   Dr employer tax expense         employer taxes (employer contributions, employer-paid benefits)
//     Cr payroll liabilities        gross + employer taxes
// The bank rows that pay it clear the liability: net pay to the employees, then the remittances of withholding, employee benefits and
// employer taxes to the authorities (or all at once when the provider debits one lump sum). Each such row is a payment on the run, exactly
// like a bill payment (accrual.ts), so the amount leaves the P&L and the liability that is still open is the balance sheet's payroll liabilities.
// Pure.
import type { Txn } from "@openbooks/schema";
import type { AgingSource, Payment } from "./accrual.ts";
import { daysBetween, paidOf } from "./accrual.ts";
import { isIsoDate } from "./journal.ts";

export const WAGES_ACCOUNT = "expense:payroll-wages";
export const TAXES_ACCOUNT = "expense:payroll-taxes";
/** The payroll liability account: an "ap:" account, so the accrual machinery treats it as payable (basis.ts). */
export const PAYROLL_ACCOUNT = "ap:payroll-liabilities";

export interface PayrollRun {
  id: string;
  /** What the run covers, as the provider writes it ("2026-10", "Oct 1-15"). Free text; the pay date is what the books use. */
  period: string;
  payDate: string;
  gross: number;
  /** Employer-side taxes and contributions on top of gross (employer national insurance / FICA match / unemployment, employer-paid benefits). */
  employerTaxes: number;
  /** Taken from the employees' gross for the authorities (income tax, employee national insurance / FICA). */
  employeeWithholding: number;
  /** Other deductions from gross that the employer remits (employee pension and health contributions). */
  benefits: number;
  /** Paid to the employees. */
  net: number;
  provider: string;
  memo?: string;
  /** Ledger accounts; WAGES_ACCOUNT and TAXES_ACCOUNT when missing. */
  wages?: string;
  taxes?: string;
  /** Bank rows (or money outside the books) that paid the run. */
  payments: Payment[];
}

const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const num = (x: unknown) => (typeof x === "number" ? x : NaN);

/** The cost of a run still to be paid out: net pay plus everything remitted (gross + employer taxes). */
export const payrollLiability = (r: Pick<PayrollRun, "gross" | "employerTaxes">) => r2(r.gross + r.employerTaxes);
/** What goes to the authorities and benefit providers: withholding, benefits and employer taxes (the liability less net pay). */
export const payrollRemittance = (r: Pick<PayrollRun, "employeeWithholding" | "benefits" | "employerTaxes">) =>
  r2(r.employeeWithholding + r.benefits + r.employerTaxes);
export const payrollPaid = (r: Pick<PayrollRun, "payments">) => paidOf(r.payments);
export const payrollOwed = (r: Pick<PayrollRun, "gross" | "employerTaxes" | "payments">) => r2(payrollLiability(r) - payrollPaid(r));
export type PayrollStatus = "open" | "partial" | "paid";
export const payrollStatus = (r: Pick<PayrollRun, "gross" | "employerTaxes" | "payments">): PayrollStatus =>
  payrollOwed(r) <= 0.005 ? "paid" : payrollPaid(r) > 0 ? "partial" : "open";

export type PayrollProblem = "period" | "payDate" | "provider" | "amount" | "net" | "over";
/** What is wrong with a run, or undefined. `amount`: a figure that isn't a number >= 0 (gross > 0). `net`: net pay isn't gross less withholding and benefits. */
export function payrollProblem(r: PayrollRun): PayrollProblem | undefined {
  if (!String(r.period ?? "").trim()) return "period";
  if (!isIsoDate(r.payDate)) return "payDate";
  if (!String(r.provider ?? "").trim()) return "provider";
  const f = [r.gross, r.employerTaxes, r.employeeWithholding, r.benefits, r.net].map(num);
  if (f.some((x) => !Number.isFinite(x) || x < 0) || !(r.gross > 0)) return "amount";
  if (Math.abs(r.gross - r.employeeWithholding - r.benefits - r.net) > 0.005) return "net";
  if (payrollPaid(r) > payrollLiability(r) + 0.005) return "over";
  return undefined;
}

/** The ledger lines of a run: debits and credits that balance (empty lines are left out). */
export function payrollLines(r: PayrollRun): { account: string; debit: number; credit: number }[] {
  return [
    { account: r.wages || WAGES_ACCOUNT, debit: r2(r.gross), credit: 0 },
    { account: r.taxes || TAXES_ACCOUNT, debit: r2(r.employerTaxes), credit: 0 },
    { account: PAYROLL_ACCOUNT, debit: 0, credit: payrollLiability(r) },
  ].filter((l) => l.debit || l.credit);
}

/** The runs as accrual sources (basis.ts): a bill-shaped document on the pay date whose payable account is PAYROLL_ACCOUNT. */
export function payrollSources(runs: readonly PayrollRun[]): AgingSource[] {
  return runs.map((r) => ({
    id: r.id,
    party: null,
    name: r.provider,
    ref: r.period,
    date: r.payDate,
    due: null,
    gross: payrollLiability(r),
    payments: r.payments ?? [],
    lines: [
      { account: r.wages || WAGES_ACCOUNT, amount: r2(r.gross) },
      { account: r.taxes || TAXES_ACCOUNT, amount: r2(r.employerTaxes) },
    ],
    payable: PAYROLL_ACCOUNT,
  }));
}

// ---------- matching bank rows ----------
export type MatchKind = "net" | "remittance" | "all" | "part";
export interface PayrollMatch {
  txn: Txn;
  /** How much of the row the run takes: the row's money, less what other payments already took, never more than the run still owes. */
  amount: number;
  kind: MatchKind;
  /** The figure matches exactly (to the cent) one of net pay, the remittance, or both together. */
  exact: boolean;
  /** Higher is likelier: exact figure, the provider named in the description, closeness to the pay date. */
  score: number;
}

/** Money of each bank row already applied to a run (`taken` = ledger row id -> amount), from the payments of all runs. */
export function appliedTo(runs: readonly Pick<PayrollRun, "payments">[]) {
  const m = new Map<string, number>();
  for (const r of runs) for (const p of r.payments ?? []) if (p.txn) m.set(p.txn, r2((m.get(p.txn) ?? 0) + p.amount));
  return m;
}

/**
 * Outgoing bank rows that may have paid a run: net pay (a day or two before to a week after the pay date), the remittances (up to 45 days after:
 * quarterly deposits aside, providers debit them within days) or everything at once. `taken` is what other payments already took of each row
 * (bills too: pass the combined map). Best first; rows that are not close in time or in size are left out.
 */
export function payrollMatches(run: PayrollRun, txns: readonly Txn[], taken: ReadonlyMap<string, number> = new Map()): PayrollMatch[] {
  const left = payrollOwed(run);
  if (left <= 0.005) return [];
  const net = r2(run.net),
    rem = payrollRemittance(run),
    all = payrollLiability(run),
    name = run.provider.trim().toLowerCase();
  const out: PayrollMatch[] = [];
  for (const t of txns) {
    if (t.amount >= 0 || !isIsoDate(t.date)) continue;
    const days = daysBetween(run.payDate, t.date);
    if (days < -3 || days > 45) continue;
    const have = r2(Math.abs(t.amount) - (taken.get(t.id) ?? 0));
    if (have <= 0.005) continue;
    const same = (x: number) => x > 0 && Math.abs(have - x) <= 0.005;
    // a row already part-applied can still settle what the run has left
    const kind: MatchKind = same(all) ? "all" : same(net) && days <= 7 ? "net" : same(rem) ? "remittance" : "part";
    const exact = kind !== "part" || same(left);
    if (kind === "part" && !exact && (have > left + 0.005 || !name || !(t.desc ?? "").toLowerCase().includes(name))) continue;
    const named = !!name && (t.desc ?? "").toLowerCase().includes(name);
    out.push({ txn: t, amount: r2(Math.min(have, left)), kind, exact, score: (exact ? 4 : 0) + (named ? 2 : 0) + 1 / (1 + Math.abs(days)) });
  }
  return out.sort((a, b) => b.score - a.score || (a.txn.date < b.txn.date ? -1 : 1));
}

/**
 * Payments to add for the unambiguous matches: per run, the best exact match for net pay and for the remittance (or one row for the whole
 * run), each row used once. Does not touch the runs; returns `runId -> new payments`.
 */
export function autoMatch(runs: readonly PayrollRun[], txns: readonly Txn[], taken: ReadonlyMap<string, number> = new Map()): Map<string, Payment[]> {
  const used = new Map(taken);
  const out = new Map<string, Payment[]>();
  for (const run of [...runs].sort((a, b) => (a.payDate < b.payDate ? -1 : 1))) {
    const added: Payment[] = [];
    let cur = run;
    for (const kind of ["all", "net", "remittance"] as const) {
      const hit = payrollMatches(cur, txns, used).find((m) => m.exact && m.kind === kind && m.score >= 4);
      if (!hit) continue;
      const p: Payment = { id: `${run.id}-m${added.length + 1}`, txn: hit.txn.id, amount: hit.amount, date: hit.txn.date };
      added.push(p);
      used.set(hit.txn.id, r2((used.get(hit.txn.id) ?? 0) + hit.amount));
      cur = { ...cur, payments: [...cur.payments, p] };
    }
    if (added.length) out.set(run.id, added);
  }
  return out;
}

// ---------- the provider's register as CSV ----------
/** Rows of a CSV text (RFC 4180 quoting; the delimiter is the commonest of , ; tab in the first line). */
export function parseRegister(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const first = s.split(/\r?\n/, 1)[0] ?? "";
  const d = [",", ";", "\t"].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [],
    f = "",
    q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c !== '"') f += c;
      else if (s[i + 1] === '"') {
        f += '"';
        i++;
      } else q = false;
    } else if (c === '"' && !f) q = true;
    else if (c === d) {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(f);
      f = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else f += c;
  }
  row.push(f);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

/**
 * Which column holds what (0-based; null = none). `net` may be null: it is then gross less withholding and benefits. Registers often split
 * taxes over several columns (federal, state, social security; income tax, national insurance, health tax): the three summed fields take a
 * list of columns and add them up.
 */
export interface RegisterMapping {
  headerRow: number;
  payDate: number | null;
  period: number | null;
  gross: number | null;
  net: number | null;
  employerTaxes: number[];
  employeeWithholding: number[];
  benefits: number[];
  dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
}
export const REGISTER_FIELDS = ["payDate", "period", "gross", "net"] as const;
/** The fields that take several columns, added up. */
export const REGISTER_SUMMED = ["employerTaxes", "employeeWithholding", "benefits"] as const;
type Field = (typeof REGISTER_FIELDS)[number] | (typeof REGISTER_SUMMED)[number];
// header words of the common providers and of an Israeli payroll slip summary (English and Hebrew)
const HEADERS: Record<Field, RegExp[]> = {
  payDate: [/pay\s*date|check\s*date|paid\s*on|payment\s*date|תאריך\s*(תשלום|משכורת)/i, /date|תאריך/i],
  period: [/period|pay\s*cycle|תקופה|חודש/i],
  gross: [/gross|total\s*(pay|earnings|wages)|ברוטו|שכר\s*כולל/i],
  employerTaxes: [/employer|company\s*(tax|contrib)|\ber\b|מעסיק|מעביד/i],
  employeeWithholding: [
    /withh|employee.*tax|ee\s*tax|income\s*tax|fica|national\s*insurance|social\s*security|medicare|federal|state\s*(income\s*)?tax|local\s*tax|health\s*tax|ניכוי|מס\s*הכנסה|ביטוח\s*לאומי|מס\s*בריאות/i,
  ],
  benefits: [/benefit|pension|401|health|insurance|deduction|פנסי|בריאות|הפרשות|קרן/i],
  net: [/\bnet\b|take.?home|נטו|לתשלום/i],
};
/** A first guess at the mapping from a header row: a column is used once; the summed fields take every column whose title fits. Employer-side words beat the generic ones. */
export function guessRegister(rows: readonly (readonly string[])[], headerRow = 0): RegisterMapping {
  const head = rows[headerRow] ?? [];
  const taken = new Set<number>();
  const all = (k: Field) => {
    const out: number[] = [];
    for (const re of HEADERS[k])
      head.forEach((h, j) => {
        if (!taken.has(j) && re.test(h)) (out.push(j), taken.add(j));
      });
    return out;
  };
  const one = (k: Field) => {
    for (const re of HEADERS[k]) {
      const i = head.findIndex((h, j) => !taken.has(j) && re.test(h));
      if (i >= 0) return (taken.add(i), i);
    }
    return null;
  };
  // order matters: the specific words claim their columns before the general ones (employer tax before withholding, net before gross)
  const employerTaxes = all("employerTaxes"),
    net = one("net"),
    gross = one("gross"),
    period = one("period"),
    employeeWithholding = all("employeeWithholding"),
    benefits = all("benefits"),
    payDate = one("payDate");
  const sample = rows[headerRow + 1]?.[payDate ?? -1] ?? "";
  return {
    headerRow,
    payDate,
    period,
    gross,
    net,
    employerTaxes,
    employeeWithholding,
    benefits,
    dateFormat: /^\d{4}-/.test(sample) ? "YYYY-MM-DD" : /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(sample) && +sample.split("/")[0]! > 12 ? "DD/MM/YYYY" : "MM/DD/YYYY",
  };
}

/** "1,234.50", "(120.00)", "$1 234,50", "₪ 2,000" -> number; NaN when it isn't one. */
export function registerMoney(s: string): number {
  let t = s.trim();
  if (!t) return NaN;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-") || t.endsWith("-");
  t = t.replace(/[^\d.,]/g, "");
  const dot = t.lastIndexOf("."),
    com = t.lastIndexOf(",");
  if (dot >= 0 && com >= 0) t = dot > com ? t.replaceAll(",", "") : t.replaceAll(".", "").replace(",", ".");
  else if (com >= 0) t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replaceAll(",", "") : t.replace(",", ".");
  const n = Number(t);
  return t && Number.isFinite(n) ? (neg ? -n : n) : NaN;
}
const isoOf = (s: string, f: RegisterMapping["dateFormat"]): string => {
  const p = s.trim().split(/[/.\-\s]/);
  if (p.length !== 3 || p.some((x) => !/^\d+$/.test(x))) return "";
  const [a, b, c] = p as [string, string, string];
  const [y, mo, d] = f === "YYYY-MM-DD" ? [a, b, c] : f === "DD/MM/YYYY" ? [c, b, a] : [c, a, b];
  const iso = `${y.length === 2 ? "20" + y : y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : "";
};

export interface RegisterImport {
  runs: PayrollRun[];
  errors: { line: number; reason: "date" | "gross" | "amount" | "net" }[];
}
/**
 * The runs in a register. Rows with the same pay date and period are one run (a register with one row per employee adds up to the run). A
 * blank period reads as the pay date's month. Ids are made from provider, pay date and period, so importing a file twice gives the same
 * runs. A run whose figures don't tie (net != gross - withholding - benefits) is reported in `errors`, with the line of its first row.
 */
export function importRegister(rows: readonly (readonly string[])[], m: RegisterMapping, provider: string): RegisterImport {
  const col = (r: readonly string[], i: number | null) => (i == null ? "" : (r[i] ?? ""));
  const groups = new Map<string, { line: number; run: PayrollRun }>();
  const errors: RegisterImport["errors"] = [];
  rows.slice(m.headerRow + 1).forEach((r, k) => {
    if (!r.some((x) => x.trim())) return;
    const line = m.headerRow + k + 2;
    const payDate = isoOf(col(r, m.payDate), m.dateFormat);
    if (!payDate) return void errors.push({ line, reason: "date" });
    const f = (i: number | null) => (i == null || !col(r, i).trim() ? 0 : registerMoney(col(r, i)));
    const fs = (is: readonly number[]) => is.reduce((a, i) => a + f(i), 0);
    const gross = f(m.gross),
      employerTaxes = fs(m.employerTaxes),
      employeeWithholding = fs(m.employeeWithholding),
      benefits = fs(m.benefits);
    const net = m.net == null ? gross - employeeWithholding - benefits : f(m.net);
    if (!(gross > 0)) return void errors.push({ line, reason: "gross" });
    if ([employerTaxes, employeeWithholding, benefits, net].some((x) => !Number.isFinite(x) || x < 0)) return void errors.push({ line, reason: "amount" });
    const period = col(r, m.period).trim() || payDate.slice(0, 7),
      key = `${payDate}|${period}`;
    const g = groups.get(key) ?? {
      line,
      run: {
        id: `pr-${provider
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")}-${payDate}-${period.replace(/[^\p{L}\p{N}]+/gu, "-")}`,
        period,
        payDate,
        gross: 0,
        employerTaxes: 0,
        employeeWithholding: 0,
        benefits: 0,
        net: 0,
        provider: provider.trim(),
        payments: [],
      },
    };
    const x = g.run;
    x.gross = r2(x.gross + gross);
    x.employerTaxes = r2(x.employerTaxes + employerTaxes);
    x.employeeWithholding = r2(x.employeeWithholding + employeeWithholding);
    x.benefits = r2(x.benefits + benefits);
    x.net = r2(x.net + net);
    groups.set(key, g);
  });
  const runs: PayrollRun[] = [];
  for (const g of groups.values()) {
    if (Math.abs(g.run.gross - g.run.employeeWithholding - g.run.benefits - g.run.net) > 0.005) errors.push({ line: g.line, reason: "net" });
    else runs.push(g.run);
  }
  return { runs: runs.sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0)), errors: errors.sort((a, b) => a.line - b.line) };
}

/** Totals of runs, for the page's summary: gross, employer taxes, the cost (gross + employer taxes) and what is still to be paid out. */
export function payrollTotals(runs: readonly PayrollRun[]) {
  return {
    gross: r2(sum(runs.map((r) => r.gross))),
    employerTaxes: r2(sum(runs.map((r) => r.employerTaxes))),
    cost: r2(sum(runs.map(payrollLiability))),
    owed: r2(sum(runs.map(payrollOwed))),
  };
}
