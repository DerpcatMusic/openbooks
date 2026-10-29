// Cash vs accrual: the same books on both bases reconcile.
import { describe, expect, it } from "vite-plus/test";
import type { Txn } from "@openbooks/schema";
import { accrualRows, AP_ACCOUNT, AR_ACCOUNT, basisBridge, billSources, invoiceSources, openBalances, pl, balances, type Basis } from "./index.ts";

const tx = (id: string, date: string, amount: number, category: string, over: Partial<Txn> = {}): Txn => ({
  id,
  date,
  amount,
  desc: id,
  source: "bank",
  account: "Checking",
  file: "",
  page: 0,
  category,
  why: "",
  ...over,
});
// Jan: invoice i1 (1,000) issued, paid Feb 10 by t-in. Mar: bill b1 (400 rent) approved, paid Apr 5 by t-out. Plus ordinary cash rows.
const cash: Txn[] = [
  tx("t-sale", "2026-01-20", 500, "revenue:sales"), // an ordinary cash sale
  tx("t-in", "2026-02-10", 1000, "revenue:services"), // pays i1
  tx("t-software", "2026-02-15", -50, "expense:software"),
  tx("t-out", "2026-04-05", -400, "expense:rent"), // pays b1
  tx("t-draw", "2026-04-10", -300, "equity:owner"),
];
const invoices = [{ id: "i1", kind: "invoice", number: "INV-1", customer: "c1", items: [{ qty: 1, price: 1000 }], vat: 0, issued: "2026-01-05", due: "2026-02-05", status: "open", payments: [{ id: "p1", txn: "t-in", amount: 1000, date: "2026-02-10" }] }];
const bills = [{ id: "b1", number: "B-1", vendor: "v1", date: "2026-03-01", due: "2026-04-01", lines: [{ amount: 400, account: "expense:rent" }], status: "open", payments: [{ id: "q1", txn: "t-out", amount: 400, date: "2026-04-05" }] }];
const ar = invoiceSources(invoices, () => "Client"),
  ap = billSources(bills, () => "Landlord");
const OPT = { revenue: "revenue:sales", expense: "expense:other" };
const acc = accrualRows(cash, ar, ap, OPT);
const span = (rows: Txn[], from: string, to: string) => rows.filter((r) => r.date >= from && r.date <= to);

describe("accrual rows", () => {
  it("revenue on the issue date, the matched payment clears receivable and leaves the P&L", () => {
    expect(pl(span(acc, "2026-01-01", "2026-01-31")).revenue).toBe(1500); // sale 500 + invoice 1,000
    expect(pl(span(acc, "2026-02-01", "2026-02-28")).revenue).toBe(0); // the 1,000 received is not revenue again
    expect(acc.find((r) => r.id === "t-in^ar")).toMatchObject({ amount: 1000, category: AR_ACCOUNT, date: "2026-02-10", why: "invoice" });
    expect(acc.find((r) => r.id === "t-in")).toBeUndefined(); // fully applied
    expect(acc.find((r) => r.id === "inv:i1:rev")).toMatchObject({ category: "revenue:services", amount: 1000, source: "invoice", account: "Invoices" }); // filed where the payment was
  });
  it("expense on the bill date at its line accounts; the payment clears payable", () => {
    expect(pl(span(acc, "2026-03-01", "2026-03-31")).opex).toBe(400);
    expect(pl(span(acc, "2026-04-01", "2026-04-30")).opex).toBeCloseTo(0);
    expect(acc.find((r) => r.id === "t-out^ap")).toMatchObject({ amount: -400, category: AP_ACCOUNT });
  });
  it("receivable and payable balances follow the dates (aging agrees)", () => {
    expect(openBalances(acc, "2026-01-31")).toEqual({ ar: 1000, ap: 0 });
    expect(openBalances(acc, "2026-02-10")).toEqual({ ar: 0, ap: 0 });
    expect(openBalances(acc, "2026-03-15")).toEqual({ ar: 0, ap: 400 });
    expect(openBalances(acc, "2026-04-05")).toEqual({ ar: 0, ap: 0 });
  });
  it("net income, cash vs accrual, reconciles through the change in receivables and payables (by month and for the year)", () => {
    for (const [from, to] of [["2026-01-01", "2026-01-31"], ["2026-02-01", "2026-02-28"], ["2026-03-01", "2026-03-31"], ["2026-04-01", "2026-04-30"], ["2026-01-01", "2026-12-31"]] as const) {
      const b = basisBridge(cash, acc, from, to);
      expect(b.rest, `${from}..${to}`).toBe(0);
      expect(b.accrualNet).toBe(b.cashNet + b.dAr - b.dAp + b.outside);
    }
    const year = basisBridge(cash, acc, "2026-01-01", "2026-12-31");
    expect(year).toMatchObject({ cashNet: 500 + 1000 - 50 - 400, accrualNet: 500 + 1000 - 50 - 400, dAr: 0, dAp: 0 }); // both settled inside the year: the same
    expect(basisBridge(cash, acc, "2026-01-01", "2026-03-31")).toMatchObject({ cashNet: 1450, accrualNet: 500 + 1000 - 400 - 50, dAr: 0, dAp: 400 });
  });
  it("the ledger rows add up the same: bank balances are untouched by the basis", () => {
    const bank = acc.filter((r) => r.source === "bank");
    expect(bank.reduce((a, r) => a + r.amount, 0)).toBe(cash.reduce((a, r) => a + r.amount, 0));
    expect(balances(acc.filter((r) => r.source !== "invoice" && r.source !== "bill"), [], "2026-12-31")).toEqual({ Checking: 750 });
  });
  it("a part payment splits the bank row; an unpaid invoice stays receivable; a payment elsewhere (no bank row) clears it with a gap", () => {
    const rows = [tx("big", "2026-02-01", 700, "revenue:sales")];
    const inv = [{ id: "i2", kind: "invoice", number: "2", customer: null, items: [{ qty: 1, price: 1000 }], vat: 0, issued: "2026-01-10", status: "open", payments: [{ id: "x", txn: "big", amount: 400, date: "2026-02-01" }, { id: "y", txn: null, amount: 100, date: "2026-02-03" }] }];
    const r = accrualRows(rows, invoiceSources(inv, () => ""), [], OPT);
    expect(r.find((x) => x.id === "big")).toMatchObject({ amount: 300, category: "revenue:sales" }); // 700 - 400 applied
    expect(r.find((x) => x.id === "big^ar")!.amount).toBe(400);
    expect(openBalances(r, "2026-02-28").ar).toBe(500); // 1,000 - 400 - 100
    const b = basisBridge(rows, r, "2026-01-01", "2026-12-31");
    expect(b.outside).toBe(100);
    expect(b.rest).toBe(0);
  });
  it("drafts, cancelled and receipts are not receivables; bills not approved are not payables; documents before the start date are left out", () => {
    const inv = [
      { id: "d", kind: "invoice", items: [{ qty: 1, price: 50 }], issued: "2026-01-01", status: "draft" },
      { id: "r", kind: "receipt", items: [{ qty: 1, price: 50 }], issued: "2026-01-01", status: "open" },
      { id: "old", kind: "invoice", items: [{ qty: 1, price: 70 }], issued: "2025-06-01", status: "open" },
    ];
    expect(accrualRows([], invoiceSources(inv, () => ""), billSources([{ id: "x", date: "2026-01-01", lines: [{ amount: 9 }], status: "draft" }], () => ""), { ...OPT, from: "2026-01-01" })).toEqual([]);
  });
  it("without invoices or bills the accrual books are the cash books", () => {
    expect(accrualRows(cash, [], [], OPT)).toEqual(cash);
  });
  it("a basis name is one of two", () => {
    const b: Basis[] = ["cash", "accrual"];
    expect(b).toHaveLength(2);
  });
});
