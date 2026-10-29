// aging_report, list_bills and list_invoices over real docs: bills in the old shape (status paid | void, one paidTxn) and the new one
// (payments applied in part), invoices with VAT, a receipt, a draft and a partial payment. Run through /api/tools/run, the same registry
// MCP and the in-app AI use. Dates are fixed, so nothing here depends on today.
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { http, type Running, startTs, testBooks } from "./testing.ts";

type J = Record<string, any>;
let s: Running, clean: () => void;
beforeAll(async () => {
  let home: string;
  [home, clean] = testBooks();
  s = await startTs(home);
  const doc = (name: string, value: unknown) => http(s.port, "POST", "/api/doc?e=acme", { name, value });
  await doc("vendors", [
    { id: "v1", name: "Cloud Host" },
    { id: "v2", name: "Acme Supplies" },
  ]);
  await doc("customers", [{ id: "c1", name: "Example Customer" }]);
  const line = (amount: number) => [{ desc: "x", amount, account: "" }];
  await doc("bills", [
    {
      id: "b1",
      number: "BILL-0001",
      vendor: "v1",
      date: "2026-01-01",
      due: "2026-01-31",
      lines: line(100),
      status: "open",
      payments: [{ id: "p1", txn: null, amount: 40, date: "2026-02-01" }],
      memo: "",
    },
    { id: "b2", number: "BILL-0002", vendor: "v2", date: "2026-01-05", due: "2026-02-04", lines: line(300), status: "open", payments: [], memo: "" },
    {
      id: "b3",
      number: "BILL-0003",
      vendor: "v2",
      date: "2026-01-05",
      due: "2026-02-04",
      lines: line(60),
      status: "paid",
      paidTxn: "t1",
      paidDate: "2026-01-20",
      memo: "",
    }, // old shape, paid
    {
      id: "b4",
      number: "BILL-0004",
      vendor: "v1",
      date: "2026-01-05",
      due: "2026-02-04",
      lines: line(10),
      status: "void",
      paidTxn: null,
      paidDate: null,
      memo: "",
    }, // old shape, void
    { id: "b5", number: "BILL-0005", vendor: "v1", date: "2026-01-05", due: null, lines: line(5), status: "draft", payments: [], memo: "" },
  ]);
  await doc("invoices", [
    {
      id: "i1",
      kind: "invoice",
      number: "INV-0001",
      customer: "c1",
      items: [{ desc: "a", qty: 2, price: 50 }],
      vat: 0.18,
      issued: "2026-01-10",
      due: "2026-02-10",
      status: "open",
      paidTxn: null,
      paidDate: null,
      ref: null,
    }, // 118
    {
      id: "i2",
      kind: "invoice",
      number: "INV-0002",
      customer: "c1",
      items: [{ desc: "a", qty: 1, price: 1000 }],
      issued: "2026-01-20",
      due: "2026-02-20",
      status: "open",
      payments: [{ id: "q", txn: null, amount: 250, date: "2026-02-10" }],
      paidTxn: null,
      paidDate: null,
      ref: null,
    },
    {
      id: "i3",
      kind: "invoice",
      number: "INV-0003",
      customer: "c1",
      items: [{ desc: "a", qty: 1, price: 70 }],
      issued: "2026-01-21",
      due: "2026-02-21",
      status: "paid",
      paidTxn: "t2",
      paidDate: "2026-02-01",
      ref: null,
    },
    {
      id: "i4",
      kind: "receipt",
      number: "0001",
      customer: "c1",
      items: [{ desc: "a", qty: 1, price: 70 }],
      issued: "2026-02-01",
      due: null,
      status: "paid",
      paidTxn: "t2",
      paidDate: "2026-02-01",
      ref: "INV-0003",
    },
    {
      id: "i5",
      kind: "invoice",
      number: null,
      customer: "c1",
      items: [{ desc: "a", qty: 1, price: 999 }],
      issued: "2026-01-22",
      due: "2026-02-22",
      status: "draft",
      paidTxn: null,
      paidDate: null,
      ref: null,
    },
  ]);
}, 30_000);
afterAll(() => {
  s?.stop();
  clean?.();
});

const run = async (name: string, args: J = {}) => {
  const r = await http(s.port, "POST", "/api/tools/run", { name, entity: "acme", args });
  expect(r.status).toBe(200);
  const j = r.json() as J;
  expect(j.error, `${name}: ${j.error}`).toBeUndefined();
  return j.result as J;
};

test("list_bills: old docs migrate on read; partial, paid, cancelled and draft states with what is paid and due", async () => {
  const bills = Object.fromEntries(((await run("list_bills")).bills as J[]).map((b) => [b.number, b]));
  expect(bills["BILL-0001"]).toMatchObject({ state: expect.stringMatching(/partial|overdue/), total: 100, amountPaid: 40, amountDue: 60 });
  expect(bills["BILL-0002"]).toMatchObject({ amountPaid: 0, amountDue: 300 });
  expect(bills["BILL-0003"]).toMatchObject({ state: "paid", total: 60, amountPaid: 60, amountDue: 0 });
  expect(bills["BILL-0004"]).toMatchObject({ state: "cancelled", amountDue: 0 });
  expect(bills["BILL-0005"]).toMatchObject({ state: "draft", amountDue: 0 });
  expect(bills["BILL-0001"].state).toBe("partial"); // partly paid wins over overdue
});

test("list_invoices: VAT in the total, partial and paid states, amount due; receipts and drafts owe nothing", async () => {
  const inv = Object.fromEntries(((await run("list_invoices")).invoices as J[]).filter((i) => i.number).map((i) => [i.number, i]));
  expect(inv["INV-0001"]).toMatchObject({ total: 118, amountDue: 118, state: "overdue" });
  expect(inv["INV-0002"]).toMatchObject({ total: 1000, amountDue: 750, state: "partial" });
  expect(inv["INV-0003"]).toMatchObject({ state: "paid", amountDue: 0 });
  expect(inv["0001"]).toMatchObject({ state: "paid", amountDue: 0 });
});

test("aging_report payable: buckets by due date as of a day, per vendor, payments after the day do not count, cancelled and drafts left out", async () => {
  const r = await run("aging_report", { type: "payable", as_of: "2026-03-01" });
  expect(r.buckets.map((b: J) => b.label)).toEqual(["current", "1-30", "31-60", "61-90", "91+"]);
  // b1: 60 left, due 01-31 = 29 days; b2: 300, due 02-04 = 25 days; b3 paid 01-20
  expect(r.totals).toMatchObject({ buckets: [0, 360, 0, 0, 0], overdue: 360, total: 360, documents: 2, parties: 2 });
  expect(r.parties.map((p: J) => [p.name, p.total, p.oldestDaysPastDue])).toEqual([
    ["Acme Supplies", 300, 25],
    ["Cloud Host", 60, 29],
  ]);
  expect(r.documents.map((d: J) => [d.number, d.bucket, d.daysPastDue])).toEqual([
    ["BILL-0002", "1-30", 25],
    ["BILL-0001", "1-30", 29],
  ]);
  // before b1's partial payment (02-01) and b3's payment (01-20) all three were owed in full, none past due
  const early = await run("aging_report", { type: "payable", as_of: "2026-01-15" });
  expect(early.totals.total).toBe(100 + 300 + 60);
  expect(early.totals.buckets[0]).toBe(100 + 300 + 60);
  expect((await run("aging_report", { type: "payable", as_of: "2026-01-25" })).totals.total).toBe(100 + 300); // b3 was paid on 01-20
  expect((await run("aging_report", { type: "payable", as_of: "2026-03-01", periods: 1, days: 10 })).buckets.map((b: J) => b.label)).toEqual([
    "current",
    "1-10",
    "11+",
  ]);
});

test("aging_report receivable: VAT total, partial payment, receipts and drafts excluded, paid invoice settled", async () => {
  const r = await run("aging_report", { type: "receivable", as_of: "2026-03-01" });
  expect(r.totals).toMatchObject({ total: 118 + 750, documents: 2, parties: 1 });
  expect(r.parties[0]).toMatchObject({ name: "Example Customer", total: 868 });
  expect(r.totals.percents.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(100, 5);
  expect(r.documents.map((d: J) => d.number)).toEqual(["INV-0001", "INV-0002"]); // most overdue first
  // as of Jan 25 nothing is due yet, and the invoice paid on 02-01 and the 250 received on 02-10 were still owed
  const feb = await run("aging_report", { type: "receivable", as_of: "2026-01-25" });
  expect(feb.totals.total).toBe(118 + 1000 + 70);
  expect(feb.totals.buckets[0]).toBe(feb.totals.total);
  const bad = await http(s.port, "POST", "/api/tools/run", { name: "aging_report", entity: "acme", args: { type: "payable", as_of: "2026-02-30" } });
  expect((bad.json() as J).error).toContain("as_of");
});
