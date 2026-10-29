// Payroll runs: validation, the ledger lines on the accrual basis, matching bank rows, and the provider's register as CSV.
import { describe, expect, it } from "vite-plus/test";
import type { Txn } from "@openbooks/schema";
import {
  accrualRows,
  autoMatch,
  basisBridge,
  guessRegister,
  importRegister,
  openBalances,
  parseRegister,
  payrollLines,
  payrollLiability,
  payrollMatches,
  payrollOwed,
  payrollProblem,
  payrollSources,
  payrollStatus,
  payrollTotals,
  pl,
  registerMoney,
  PAYROLL_ACCOUNT,
  TAXES_ACCOUNT,
  WAGES_ACCOUNT,
  type PayrollRun,
} from "./index.ts";

const tx = (id: string, date: string, amount: number, category: string, desc = id): Txn => ({
  id,
  date,
  amount,
  desc,
  source: "bank",
  account: "Checking",
  file: "",
  page: 0,
  category,
  why: "",
});
const run = (over: Partial<PayrollRun> = {}): PayrollRun => ({
  id: "r1",
  period: "2026-03",
  payDate: "2026-03-31",
  gross: 10000,
  employerTaxes: 900,
  employeeWithholding: 2000,
  benefits: 500,
  net: 7500,
  provider: "Gusto",
  payments: [],
  ...over,
});
const OPT = { revenue: "revenue:sales", expense: "expense:other" };

describe("payroll run", () => {
  it("net pay must be gross less withholding and benefits; amounts and dates are checked", () => {
    expect(payrollProblem(run())).toBeUndefined();
    expect(payrollProblem(run({ net: 7400 }))).toBe("net");
    expect(payrollProblem(run({ gross: 0, net: 0, employeeWithholding: 0, benefits: 0 }))).toBe("amount");
    expect(payrollProblem(run({ employerTaxes: -1 }))).toBe("amount");
    expect(payrollProblem(run({ employerTaxes: NaN }))).toBe("amount");
    expect(payrollProblem(run({ payDate: "2026-02-30" }))).toBe("payDate");
    expect(payrollProblem(run({ period: " " }))).toBe("period");
    expect(payrollProblem(run({ provider: "" }))).toBe("provider");
    expect(payrollProblem(run({ payments: [{ id: "p", txn: null, amount: 12_000, date: "2026-04-01" }] }))).toBe("over");
  });

  it("ledger lines balance: wages and employer taxes debited, payroll liabilities credited", () => {
    const l = payrollLines(run());
    expect(l).toEqual([
      { account: WAGES_ACCOUNT, debit: 10000, credit: 0 },
      { account: TAXES_ACCOUNT, debit: 900, credit: 0 },
      { account: PAYROLL_ACCOUNT, debit: 0, credit: 10900 },
    ]);
    expect(l.reduce((a, x) => a + x.debit - x.credit, 0)).toBe(0);
    expect(payrollLines(run({ employerTaxes: 0 })).map((x) => x.account)).toEqual([WAGES_ACCOUNT, PAYROLL_ACCOUNT]); // no empty line
    expect(payrollLines(run({ wages: "expense:salaries" }))[0]!.account).toBe("expense:salaries");
  });

  it("status follows the payments: open, partial, paid", () => {
    expect(payrollStatus(run())).toBe("open");
    expect(payrollOwed(run())).toBe(10900);
    const p1 = run({ payments: [{ id: "a", txn: "x", amount: 7500, date: "2026-03-31" }] });
    expect(payrollStatus(p1)).toBe("partial");
    expect(payrollOwed(p1)).toBe(3400);
    expect(payrollStatus(run({ payments: [{ id: "a", txn: "x", amount: 10900, date: "2026-03-31" }] }))).toBe("paid");
  });
});

// March: a sale, then the run (pay date 31 Mar). Net pay leaves on 31 Mar, the provider remits 3,400 on 15 Apr; a second run is unpaid.
const cash: Txn[] = [
  tx("sale", "2026-03-02", 30000, "revenue:sales"),
  tx("net", "2026-03-31", -7500, "expense:payroll-wages", "GUSTO NET PAY"), // the user filed the bank rows as plain expenses
  tx("tax", "2026-04-15", -3400, "expense:payroll-taxes", "GUSTO TAX 0415"),
  tx("rent", "2026-04-01", -1000, "expense:rent"),
];
const paidRun = run({
  payments: [
    { id: "r1-m1", txn: "net", amount: 7500, date: "2026-03-31" },
    { id: "r1-m2", txn: "tax", amount: 3400, date: "2026-04-15" },
  ],
});
const unpaid = run({ id: "r2", period: "2026-04", payDate: "2026-04-30", payments: [] });

describe("payroll on the accrual basis", () => {
  const rows = accrualRows(cash, [], payrollSources([paidRun, unpaid]), OPT);
  const march = rows.filter((r) => r.date >= "2026-03-01" && r.date <= "2026-03-31");
  it("books the wages and employer taxes on the pay date; the bank rows that paid it leave the P&L", () => {
    expect(pl(march).opex).toBe(10900); // 10,000 wages + 900 employer taxes, not 7,500
    expect(pl(rows.filter((r) => r.date >= "2026-04-01" && r.date <= "2026-04-14")).opex).toBe(1000); // April 15 remittance is not an expense again
    expect(rows.find((r) => r.id === "net^pr")).toMatchObject({ amount: -7500, category: PAYROLL_ACCOUNT, why: "payroll" });
    expect(rows.find((r) => r.id === "net")).toBeUndefined();
    expect(rows.find((r) => r.id === "payroll:r1:0")).toMatchObject({ amount: -10000, category: WAGES_ACCOUNT, source: "payroll", account: "Payroll" });
    expect(rows.find((r) => r.id === "payroll:r1:1")).toMatchObject({ amount: -900, category: TAXES_ACCOUNT });
    expect(rows.find((r) => r.id === "payroll:r1:ap")).toMatchObject({ amount: 10900, category: PAYROLL_ACCOUNT });
  });
  it("the document rows balance, and what is left in the payroll liability account is what is unpaid", () => {
    expect(rows.filter((r) => r.source === "payroll").reduce((a, r) => a + r.amount, 0)).toBeCloseTo(0, 6);
    expect(openBalances(rows, "2026-03-31").ap).toBe(3400); // net paid on the 31st, the remittance still to come
    expect(openBalances(rows, "2026-04-15").ap).toBe(0);
    expect(openBalances(rows, "2026-04-30").ap).toBe(10900); // the unpaid April run
  });
  it("cash and accrual net income reconcile: the difference is the change in the liability", () => {
    const b = basisBridge(cash, rows, "2026-03-01", "2026-03-31");
    expect(b.cashNet).toBe(30000 - 7500); // March cash: sale less net pay
    expect(b.accrualNet).toBe(30000 - 10900);
    expect(b.dAp).toBe(3400);
    expect(b.rest).toBe(0);
    const y = basisBridge(cash, rows, "2026-01-01", "2026-12-31");
    expect(y.rest).toBe(0);
    expect(y.dAp).toBe(10900); // only the unpaid April run is left
  });
  it("a row that paid both a bill and a payroll run is split between their accounts", () => {
    const lump = [tx("lump", "2026-04-01", -1400, "expense:other")];
    const bill = {
      id: "b",
      party: null,
      name: "Landlord",
      ref: "B-1",
      date: "2026-03-01",
      due: null,
      gross: 400,
      payments: [{ amount: 400, date: "2026-04-01", txn: "lump" }],
      lines: [{ account: "expense:rent", amount: 400 }],
    };
    const r = accrualRows(lump, [], [bill, ...payrollSources([run({ payments: [{ id: "p", txn: "lump", amount: 1000, date: "2026-04-01" }] })])], OPT);
    expect(r.find((x) => x.id === "lump^ap")).toMatchObject({ amount: -400, category: "ap:accounts-payable" });
    expect(r.find((x) => x.id === "lump^pr")).toMatchObject({ amount: -1000, category: PAYROLL_ACCOUNT });
    expect(r.find((x) => x.id === "lump")).toBeUndefined();
  });
  it("money paid outside the books clears the liability with no bank row", () => {
    const r = accrualRows([], [], payrollSources([run({ payments: [{ id: "o", txn: null, amount: 500, date: "2026-04-02" }] })]), OPT);
    expect(r.find((x) => x.why === "outside")).toMatchObject({ amount: -500, category: PAYROLL_ACCOUNT, source: "payroll" });
    expect(openBalances(r, "2026-04-30").ap).toBe(10400);
  });
  it("totals of the runs", () => {
    expect(payrollTotals([paidRun, unpaid])).toEqual({ gross: 20000, employerTaxes: 1800, cost: 21800, owed: 10900 });
  });
});

describe("matching bank rows to a run", () => {
  const bank: Txn[] = [
    tx("n", "2026-03-31", -7500, "ask", "GUSTO NET 7500"),
    tx("t", "2026-04-15", -3400, "ask", "IRS USATAXPYMT"),
    tx("all", "2026-04-01", -10900, "ask", "ADP"),
    tx("other", "2026-04-02", -1234.56, "ask", "Amazon"),
    tx("old", "2026-01-15", -7500, "ask", "Gusto"),
    tx("in", "2026-04-02", 7500, "ask", "refund"),
  ];
  it("finds net pay, the remittance and a lump sum; rows that don't fit in time, size or direction are left out", () => {
    const m = payrollMatches(run(), bank);
    expect(m.map((x) => [x.txn.id, x.kind])).toEqual([
      ["n", "net"],
      ["all", "all"],
      ["t", "remittance"],
    ]);
    expect(m.every((x) => x.exact)).toBe(true);
  });
  it("what other payments took of a row is not offered twice", () => {
    expect(payrollMatches(run(), bank, new Map([["n", 7500]])).some((x) => x.txn.id === "n")).toBe(false);
  });
  it("a partial remittance named after the provider is offered, an unrelated odd amount is not", () => {
    const m = payrollMatches(run(), [tx("p", "2026-04-10", -1000, "ask", "GUSTO TAX PART"), tx("q", "2026-04-10", -1000, "ask", "Hardware store")]);
    expect(m.map((x) => x.txn.id)).toEqual(["p"]);
    expect(m[0]).toMatchObject({ kind: "part", exact: false, amount: 1000 });
  });
  it("auto-match pairs net pay and the remittance once, never a row twice", () => {
    const two = [run(), run({ id: "r2", period: "2026-04", payDate: "2026-04-30" })];
    const a = autoMatch(two, bank);
    expect(a.get("r1")?.map((p) => [p.txn, p.amount])).toEqual([
      ["all", 10900], // one row paid the whole run: nothing else is added
    ]);
    expect(a.has("r2")).toBe(false);
    const b = autoMatch(
      [run()],
      bank.filter((x) => x.id !== "all"),
    );
    expect(b.get("r1")?.map((p) => [p.txn, p.amount])).toEqual([
      ["n", 7500],
      ["t", 3400],
    ]);
  });
  it("a paid run matches nothing", () => {
    expect(payrollMatches(run({ payments: [{ id: "a", txn: "x", amount: 10900, date: "2026-03-31" }] }), bank)).toEqual([]);
  });
});

describe("the provider's register", () => {
  const csv = [
    "Check Date,Pay Period,Employee,Gross Pay,Employee Taxes,Employer Taxes,Deductions,Net Pay",
    '2026-03-31,"Mar 2026",Ann,"5,000.00",1000.00,450.00,250.00,"3,750.00"',
    '2026-03-31,"Mar 2026",Bo,"5,000.00",1000.00,450.00,250.00,"3,750.00"',
    '2026-04-30,"Apr 2026",Ann,"5,000.00",1000.00,450.00,250.00,"3,750.00"',
  ].join("\r\n");
  it("parses quotes, commas inside quotes and the BOM", () => {
    const rows = parseRegister("﻿" + csv);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual(["2026-03-31", "Mar 2026", "Ann", "5,000.00", "1000.00", "450.00", "250.00", "3,750.00"]);
    expect(parseRegister('a;b\n"x;y";2\n')).toEqual([
      ["a", "b"],
      ["x;y", "2"],
    ]);
    expect(parseRegister('q\n"say ""hi"""\n')).toEqual([["q"], ['say "hi"']]);
  });
  it("guesses the columns from the header names", () => {
    const m = guessRegister(parseRegister(csv));
    expect(m).toMatchObject({ payDate: 0, period: 1, gross: 3, employeeWithholding: [4], employerTaxes: [5], benefits: [6], net: 7, dateFormat: "YYYY-MM-DD" });
  });
  it("guesses a Hebrew payroll summary", () => {
    const m = guessRegister(parseRegister("תאריך תשלום,חודש,ברוטו,מס הכנסה,הפרשות מעסיק,פנסיה עובד,נטו\n31/03/2026,03/2026,10000,1500,900,600,7900\n"));
    expect(m).toMatchObject({ payDate: 0, period: 1, gross: 2, employeeWithholding: [3], employerTaxes: [4], benefits: [5], net: 6, dateFormat: "DD/MM/YYYY" });
  });
  it("sums the columns a register splits taxes over (federal, state, social security; income tax, national insurance, health tax)", () => {
    const us = parseRegister(
      'Pay Date,Gross Pay,Federal Income Tax,State Income Tax,Social Security,Medicare,Employer Social Security,Employer Medicare,Health Insurance,Net Pay\n2026-03-31,"5,000.00",600,150,310,72.50,310,72.50,200,3667.50\n',
    );
    const m = guessRegister(us);
    expect(m).toMatchObject({ payDate: 0, gross: 1, employeeWithholding: [2, 3, 4, 5], employerTaxes: [6, 7], benefits: [8], net: 9 });
    expect(importRegister(us, m, "ADP").runs[0]).toMatchObject({ gross: 5000, employeeWithholding: 1132.5, employerTaxes: 382.5, benefits: 200, net: 3667.5 });
    const il = parseRegister("תאריך תשלום,ברוטו,מס הכנסה,ביטוח לאומי עובד,מס בריאות,נטו\n31/03/2026,10000,1500,400,310,7790\n");
    const mi = guessRegister(il);
    expect(mi.employeeWithholding).toEqual([2, 3, 4]);
    expect(importRegister(il, mi, "Bureau").runs[0]).toMatchObject({ employeeWithholding: 2210, net: 7790 });
  });
  it("adds per-employee rows into one run per pay date and period; ids repeat on re-import", () => {
    const rows = parseRegister(csv);
    const a = importRegister(rows, guessRegister(rows), "Gusto");
    expect(a.errors).toEqual([]);
    expect(a.runs).toHaveLength(2);
    expect(a.runs[0]).toMatchObject({
      payDate: "2026-03-31",
      period: "Mar 2026",
      gross: 10000,
      employerTaxes: 900,
      employeeWithholding: 2000,
      benefits: 500,
      net: 7500,
      provider: "Gusto",
      payments: [],
    });
    expect(a.runs.every((r) => payrollProblem(r) === undefined)).toBe(true);
    expect(importRegister(rows, guessRegister(rows), "Gusto").runs.map((r) => r.id)).toEqual(a.runs.map((r) => r.id));
    expect(new Set(a.runs.map((r) => r.id)).size).toBe(2);
    expect(payrollLiability(a.runs[0]!)).toBe(10900);
  });
  it("without a net column the net is derived; a blank period reads as the pay month", () => {
    const rows = parseRegister("Pay Date,Gross,Taxes Withheld\n2026-05-15,3000,600\n");
    const m = guessRegister(rows);
    expect(m.net).toBeNull();
    const r = importRegister(rows, m, "Payroll bureau").runs[0]!;
    expect(r).toMatchObject({ net: 2400, period: "2026-05", employerTaxes: 0 });
  });
  it("reports rows it can't read and runs whose figures don't tie, by line", () => {
    const rows = parseRegister(
      "Pay Date,Gross,Employee Tax,Net\n2026-05-15,3000,600,2400\nnot a date,3000,600,2400\n2026-06-15,0,0,0\n2026-07-15,3000,600,2000\n",
    );
    const out = importRegister(rows, guessRegister(rows), "X");
    expect(out.runs.map((r) => r.payDate)).toEqual(["2026-05-15"]);
    expect(out.errors).toEqual([
      { line: 3, reason: "date" },
      { line: 4, reason: "gross" },
      { line: 5, reason: "net" },
    ]);
  });
  it("reads money the way providers write it", () => {
    expect(registerMoney("$1,234.50")).toBe(1234.5);
    expect(registerMoney("1.234,50")).toBe(1234.5);
    expect(registerMoney("(120.00)")).toBe(-120);
    expect(registerMoney("₪ 2,000")).toBe(2000);
    expect(registerMoney("12,5")).toBe(12.5);
    expect(registerMoney("abc")).toBeNaN();
    expect(registerMoney("")).toBeNaN();
  });
  it("reads US dates month first", () => {
    const rows = parseRegister("Pay Date,Gross,Net\n03/31/2026,1000,1000\n");
    expect(importRegister(rows, { ...guessRegister(rows), dateFormat: "MM/DD/YYYY" }, "X").runs[0]!.payDate).toBe("2026-03-31");
  });
});
