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
const invoices = [
  {
    id: "i1",
    kind: "invoice",
    number: "INV-1",
    customer: "c1",
    items: [{ qty: 1, price: 1000 }],
    vat: 0,
    issued: "2026-01-05",
    due: "2026-02-05",
    status: "open",
    payments: [{ id: "p1", txn: "t-in", amount: 1000, date: "2026-02-10" }],
  },
];
const bills = [
  {
    id: "b1",
    number: "B-1",
    vendor: "v1",
    date: "2026-03-01",
    due: "2026-04-01",
    lines: [{ amount: 400, account: "expense:rent" }],
    status: "open",
    payments: [{ id: "q1", txn: "t-out", amount: 400, date: "2026-04-05" }],
  },
];
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
    for (const [from, to] of [
      ["2026-01-01", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-31"],
      ["2026-04-01", "2026-04-30"],
      ["2026-01-01", "2026-12-31"],
    ] as const) {
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
    expect(
      balances(
        acc.filter((r) => r.source !== "invoice" && r.source !== "bill"),
        [],
        "2026-12-31",
      ),
    ).toEqual({ Checking: 750 });
  });
  it("a part payment splits the bank row; an unpaid invoice stays receivable; a payment elsewhere (no bank row) clears it with a gap", () => {
    const rows = [tx("big", "2026-02-01", 700, "revenue:sales")];
    const inv = [
      {
        id: "i2",
        kind: "invoice",
        number: "2",
        customer: null,
        items: [{ qty: 1, price: 1000 }],
        vat: 0,
        issued: "2026-01-10",
        status: "open",
        payments: [
          { id: "x", txn: "big", amount: 400, date: "2026-02-01" },
          { id: "y", txn: null, amount: 100, date: "2026-02-03" },
        ],
      },
    ];
    const r = accrualRows(
      rows,
      invoiceSources(inv, () => ""),
      [],
      OPT,
    );
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
    expect(
      accrualRows(
        [],
        invoiceSources(inv, () => ""),
        billSources([{ id: "x", date: "2026-01-01", lines: [{ amount: 9 }], status: "draft" }], () => ""),
        { ...OPT, from: "2026-01-01" },
      ),
    ).toEqual([]);
  });
  it("without invoices or bills the accrual books are the cash books", () => {
    expect(accrualRows(cash, [], [], OPT)).toEqual(cash);
  });
  it("a basis name is one of two", () => {
    const b: Basis[] = ["cash", "accrual"];
    expect(b).toHaveLength(2);
  });
});

// ---------- documents marked paid with no bank row (the showcase books: status paid, paidTxn null, the deposit named after the customer) ----------
import { autoLink, linkPayment, unlinkedPayments } from "./index.ts";

describe("payments without a bank row link to the deposit on read, so the bases agree", () => {
  const dep = (id: string, date: string, amount: number, desc: string, category = "revenue:services") => tx(id, date, amount, category, { desc, source: "mercury" });
  const paidInv = (id: string, number: string, customer: string, price: number, issued: string, paidDate: string | null, extra: object = {}) => ({
    id,
    kind: "invoice",
    number,
    customer,
    items: [{ qty: 1, price }],
    vat: 0,
    issued,
    due: issued,
    currency: "USD",
    status: paidDate ? "paid" : "open",
    paidTxn: null,
    paidDate,
    ...extra,
  });
  const name = (id: string | null) => ({ c1: "Northbound Records", c2: "Lumen Studios" })[id ?? ""] ?? "";
  const books = {
    txns: [
      dep("d1", "2026-02-10", 1000, "ACH CREDIT NORTHBOUND RECORDS INV-0001"),
      dep("d2", "2026-03-20", 700, "ACH CREDIT LUMEN STUDIOS"),
      tx("rent", "2026-03-01", -400, "expense:rent"),
    ],
    invoices: [paidInv("i1", "INV-0001", "c1", 1000, "2026-01-05", "2026-02-10"), paidInv("i2", "INV-0002", "c2", 700, "2026-03-02", "2026-03-20"), paidInv("i3", "INV-0003", "c1", 250, "2026-12-20", null)],
  };
  const ar = invoiceSources(books.invoices, name);
  const OPTC = { ...OPT, currency: "USD" };

  it("the P&L counts each sale once: accrual revenue equals cash revenue when everything is settled in the year", () => {
    const acc = accrualRows(books.txns, ar, [], OPTC);
    const cashRev = pl(books.txns).revenue,
      accRev = pl(acc.filter((r) => r.date <= "2026-11-30")).revenue;
    expect(cashRev).toBe(1700);
    expect(accRev).toBe(1700); // without the link: 3,400
    expect(acc.find((r) => r.id === "d1^ar")).toMatchObject({ amount: 1000, category: AR_ACCOUNT });
    expect(acc.find((r) => r.id === "d1")).toBeUndefined();
    const b = basisBridge(books.txns, acc, "2026-01-01", "2026-11-30");
    expect(b).toMatchObject({ cashNet: 1300, accrualNet: 1300, outside: 0, rest: 0, dAr: 0 });
    // the open December invoice is the only difference, and the bridge explains it
    const dec = basisBridge(books.txns, acc, "2026-01-01", "2026-12-31");
    expect(dec).toMatchObject({ cashNet: 1300, accrualNet: 1550, dAr: 250, outside: 0, rest: 0 });
    expect(dec.cashNet + dec.dAr).toBe(dec.accrualNet);
  });
  it("a payment still outside the books stays outside, and is listed with the deposit that would fit", () => {
    const lone = [paidInv("i9", "INV-0009", "c2", 321, "2026-01-02", "2026-01-30")];
    const rows = [dep("x", "2026-02-20", 321, "WIRE FROM SOMEONE ELSE")]; // right amount, 3 weeks later, a different payer
    const src = invoiceSources(lone, name);
    expect(accrualRows(rows, src, [], OPTC).find((r) => r.why === "outside")).toMatchObject({ amount: 321 });
    const [u] = unlinkedPayments(src, [], rows, { currency: "USD" });
    expect(u).toMatchObject({ kind: "ar", doc: "i9", payment: "i9-p1", amount: 321, suggest: { id: "x" } });
    expect(unlinkedPayments(ar, [], books.txns, { currency: "USD" })).toEqual([]); // the demo-like case leaves nothing behind
  });
  it("needs the exact amount, the window, the customer, the same currency; never reuses a bank row", () => {
    const one = (inv: object, rows: Txn[], o = { currency: "USD" }) => autoLink(invoiceSources([{ ...paidInv("a", "INV-7", "c1", 500, "2026-01-01", "2026-01-10"), ...inv }], name), rows, 1, o)[0]!.payments[0]!.txn;
    const good = dep("g", "2026-01-12", 500, "NORTHBOUND RECORDS");
    expect(one({}, [good])).toBe("g");
    expect(one({}, [dep("g", "2026-01-12", 500.01, "NORTHBOUND RECORDS")])).toBeNull(); // a cent off
    expect(one({}, [dep("g", "2026-01-25", 500, "NORTHBOUND RECORDS")])).toBeNull(); // 15 days from the payment
    expect(one({}, [dep("g", "2026-01-12", 500, "LUMEN STUDIOS")])).toBeNull(); // someone else
    expect(one({ currency: "EUR" }, [good])).toBeNull(); // another currency than the books
    expect(one({}, [dep("g", "2026-01-12", 500, "NORTHBOUND RECORDS", "transfer:own")])).toBeNull(); // not income
    expect(one({}, [dep("g", "2026-01-12", -500, "NORTHBOUND RECORDS")])).toBeNull(); // wrong direction
    expect(one({}, [dep("g", "2026-01-12", 500, "WIRE INV-7")])).toBe("g"); // the document number is enough
    // two invoices of 500 for one customer and one deposit: only one links
    const two = autoLink(invoiceSources([paidInv("a", "INV-7", "c1", 500, "2026-01-01", "2026-01-10"), paidInv("b", "INV-8", "c1", 500, "2026-01-02", "2026-01-10")], name), [good], 1, { currency: "USD" });
    expect(two.map((s) => s.payments[0]!.txn)).toEqual(["g", null]);
    // a row an explicit payment already took is not offered again
    const taken = autoLink(invoiceSources([paidInv("a", "INV-7", "c1", 500, "2026-01-01", "2026-01-10", { paidTxn: "g" }), paidInv("b", "INV-8", "c1", 500, "2026-01-02", "2026-01-10")], name), [good], 1, { currency: "USD" });
    expect(taken.map((s) => s.payments[0]!.txn)).toEqual(["g", null]);
  });
  it("is deterministic: the order of the books does not change who gets which deposit", () => {
    const rows = [dep("e1", "2026-01-12", 500, "NORTHBOUND RECORDS"), dep("e2", "2026-01-13", 500, "NORTHBOUND RECORDS")];
    const docs = [paidInv("a", "INV-7", "c1", 500, "2026-01-01", "2026-01-13"), paidInv("b", "INV-8", "c1", 500, "2026-01-02", "2026-01-12")];
    const run = (d: typeof docs, r: Txn[]) => Object.fromEntries(autoLink(invoiceSources(d, name), r, 1, {}).map((s) => [s.id, s.payments[0]!.txn]));
    const first = run(docs, rows);
    expect(first).toEqual({ a: "e2", b: "e1" }); // each closest to its own payment date
    expect(run([...docs].reverse(), [...rows].reverse())).toEqual(first);
  });
  it("bills link the same way, outgoing", () => {
    const bill = { id: "b1", number: "BILL-1", vendor: "v1", date: "2026-03-01", due: "2026-03-31", lines: [{ amount: 300, account: "expense:professional" }], status: "open", payments: [{ id: "p", txn: null, amount: 300, date: "2026-03-14" }] };
    const out = tx("h", "2026-03-15", -300, "expense:professional", { desc: "HARBOR COMPLIANCE", source: "mercury" });
    const ap = billSources([bill], () => "Harbor Compliance");
    const acc = accrualRows([out], [], ap, OPTC);
    expect(acc.find((r) => r.id === "h^ap")).toMatchObject({ amount: -300, category: AP_ACCOUNT });
    expect(pl(acc).opex).toBe(300); // the bill, not the bill and the payment
    expect(basisBridge([out], acc, "2026-01-01", "2026-12-31")).toMatchObject({ cashNet: -300, accrualNet: -300, outside: 0, rest: 0 });
  });
  it("linkPayment points a legacy paid document or a listed payment at the row", () => {
    expect(linkPayment({ id: "i", paidTxn: null, paidDate: "2026-01-01" }, "i-p1", { id: "t", date: "2026-01-03" })).toEqual({ id: "i", paidTxn: "t", paidDate: "2026-01-03" });
    const d = { id: "i", payments: [{ id: "p1", txn: null, amount: 5, date: "2026-01-01" }, { id: "p2", txn: null, amount: 6, date: "2026-01-02" }] };
    expect(linkPayment(d, "p2", { id: "t", date: "2026-01-04" }).payments).toEqual([d.payments[0], { id: "p2", txn: "t", amount: 6, date: "2026-01-04" }]);
    expect(linkPayment(d, "nope", { id: "t", date: "x" })).toBe(d);
  });
});
