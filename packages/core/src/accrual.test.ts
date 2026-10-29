import { expect, test } from "vite-plus/test";
import {
  agingBuckets,
  agingReport,
  billSources,
  bucketOf,
  displayStatus,
  invoiceSources,
  invoiceTotal,
  migrateBill,
  openAt,
  outstanding,
  paidOf,
  percents,
  type AgingSource,
} from "./accrual.ts";

const src = (o: Partial<AgingSource>): AgingSource => ({
  id: "s",
  party: "p1",
  name: "Acme",
  ref: "1",
  date: "2026-01-01",
  due: "2026-02-01",
  gross: 100,
  payments: [],
  ...o,
});

test("display status: partial beats overdue, credit memos are never paid, draft/cancelled pass through", () => {
  const d = (stored: string, gross: number, paid: number, due: string | null = "2026-02-01") => displayStatus(stored, gross, paid, due, "2026-03-01");
  expect(d("draft", 100, 0)).toBe("draft");
  expect(d("cancelled", 100, 0)).toBe("cancelled");
  expect(d("void", 100, 0)).toBe("cancelled"); // legacy
  expect(d("open", 100, 0, "2026-03-01")).toBe("open"); // due today is not overdue
  expect(d("open", 100, 0)).toBe("overdue");
  expect(d("open", 100, 0, null)).toBe("open"); // no due date: never overdue
  expect(d("open", 100, 40)).toBe("partial"); // past due but partly paid: partial
  expect(d("open", 100, 100)).toBe("paid");
  expect(d("open", 100, 120)).toBe("paid"); // overpaid
  expect(d("open", 0, 0)).toBe("overdue"); // zero gross is not paid
  expect(d("open", -50, 0, "2026-04-01")).toBe("open"); // credit memo
  expect(d("open", 0.3, 0.1 + 0.2)).toBe("paid"); // cents, not floating point
});

test("payments: paid and outstanding by date", () => {
  const ps = [
    { amount: 30.1, date: "2026-02-01" },
    { amount: 20.2, date: "2026-03-01" },
  ];
  expect(paidOf(ps)).toBe(50.3);
  expect(paidOf(ps, "2026-02-15")).toBe(30.1);
  expect(outstanding(100, ps, "2026-02-15")).toBe(69.9);
  expect(outstanding(100, undefined)).toBe(100);
});

test("migration: paid becomes open with one payment, void cancelled, draft with a payment keeps it, new shape untouched", () => {
  const base = { id: "b1", date: "2026-01-10", lines: [{ amount: 40.1 }, { amount: 0.1 }] };
  expect(migrateBill({ ...base, status: "paid", paidTxn: "t1", paidDate: "2026-01-20" })).toEqual({
    ...base,
    status: "open",
    payments: [{ id: "b1-p1", txn: "t1", amount: 40.2, date: "2026-01-20" }],
  });
  expect(migrateBill({ ...base, status: "paid" }).payments).toEqual([{ id: "b1-p1", txn: null, amount: 40.2, date: "2026-01-10" }]); // paid by hand, no date
  expect(migrateBill({ ...base, status: "void" })).toMatchObject({ status: "cancelled", payments: [] });
  expect(migrateBill({ ...base, status: "open", paidTxn: null, paidDate: null })).toMatchObject({ status: "open", payments: [] });
  expect(migrateBill({ ...base, status: "draft", paidTxn: "t2" })).toMatchObject({ status: "draft", payments: [{ txn: "t2", amount: 40.2 }] });
  const fresh = { ...base, status: "open" as const, payments: [{ id: "x", txn: "t", amount: 10, date: "2026-02-01" }] };
  expect(migrateBill(fresh)).toEqual(fresh);
  expect("paidTxn" in migrateBill({ ...base, status: "paid", paidTxn: "t1" })).toBe(false);
});

test("aging buckets: labels and the boundary days", () => {
  expect(agingBuckets().map((b) => b.label)).toEqual(["current", "1-30", "31-60", "61-90", "91+"]);
  expect(agingBuckets(2, 15).map((b) => b.label)).toEqual(["current", "1-15", "16-30", "31+"]);
  const at = (n: number) => bucketOf(n);
  expect([-5, 0, 1, 30, 31, 60, 61, 90, 91, 400].map(at)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test("aging report: due-date buckets as of a date, per party, totals, percentages add to 100", () => {
  const sources = [
    src({ id: "a", due: "2026-03-01", gross: 100 }), // due today: current
    src({ id: "b", due: "2026-02-28", gross: 200 }), // 1 day: 1-30
    src({ id: "c", due: "2026-01-30", gross: 300 }), // 30 days: 1-30
    src({ id: "d", due: "2026-01-29", gross: 400 }), // 31 days: 31-60
    src({ id: "e", due: "2025-12-01", gross: 500, party: "p2", name: "Beta" }), // 90 days: 61-90
    src({ id: "f", due: "2025-11-30", gross: 600, party: "p2", name: "Beta" }), // 91 days: 91+
    src({ id: "g", due: null, date: "2026-02-01", gross: 50, party: null, name: "" }), // no due date: ages from the issue date, 28 days
    src({ id: "late", date: "2026-03-02", due: "2026-04-01" }), // issued after the as-of date
    src({ id: "paid", gross: 80, payments: [{ amount: 80, date: "2026-02-10" }] }),
    src({ id: "after", due: "2026-02-01", gross: 90, payments: [{ amount: 90, date: "2026-03-05" }] }), // paid after as-of: still owed then (28 days)
  ];
  const r = agingReport(sources, "2026-03-01");
  expect(r.parties.map((p) => p.name)).toEqual(["Acme", "Beta", ""]); // named alphabetically, nameless last
  expect(r.parties[0]).toMatchObject({ buckets: [100, 590, 400, 0, 0], overdue: 990, total: 1090, count: 5, oldest: 31 });
  expect(r.parties[1]).toMatchObject({ buckets: [0, 0, 0, 500, 600], total: 1100, count: 2, oldest: 91 });
  expect(r.parties[2]!.buckets[1]).toBe(50);
  expect(r.totals).toMatchObject({ buckets: [100, 640, 400, 500, 600], total: 2240, overdue: 2140, count: 8, parties: 3 });
  expect(r.totals.percents).toEqual([4.5, 28.5, 17.9, 22.3, 26.8]); // 28.6 gave up 0.1 so the set adds to 100.0
  expect(r.sources.map((s) => s.id)).toEqual(["d", "c", "after", "b", "a", "f", "e", "g"]); // party order, then most overdue first
  // as of a later date the "after" payment counts and the buckets shift
  const later = agingReport(sources, "2026-03-31");
  expect(later.sources.find((s) => s.id === "after")).toBeUndefined();
  expect(later.sources.find((s) => s.id === "a")).toMatchObject({ days: 30, bucket: 1 });
  // party filter and period setting
  expect(agingReport(sources, "2026-03-01", { parties: ["p2"] }).totals.total).toBe(1100);
  expect(agingReport(sources, "2026-03-01", { parties: [null] }).totals.total).toBe(50);
  const two = agingReport(sources, "2026-03-01", { periods: 2, days: 45 });
  expect(two.buckets.map((b) => b.label)).toEqual(["current", "1-45", "46-90", "91+"]);
  expect(two.totals.buckets).toEqual([100, 640 + 400, 500, 600]);
  expect(agingReport(sources, "2026-03-01", { periods: 99 }).periods).toBe(12); // capped
  expect(agingReport([], "2026-03-01").totals).toMatchObject({ total: 0, percents: null, count: 0 });
});

test("percentages: one decimal, add to 100.0, nothing to split gives null", () => {
  expect(percents([1, 1, 1])).toEqual([33.4, 33.3, 33.3]);
  expect(percents([0, 0])).toBeNull();
  expect(percents([50])).toBeNull();
  expect(percents([100, 0])).toEqual([100, 0]);
});

test("docs as sources: invoices (VAT, receipts, drafts, old paid) and bills (migrated, open only)", () => {
  const inv = (o: object) => ({
    id: "i",
    kind: "invoice",
    number: "INV-1",
    customer: "c1",
    items: [{ qty: 2, price: 50 }],
    vat: 0.18,
    issued: "2026-01-10",
    due: "2026-02-10",
    status: "open",
    ...o,
  });
  expect(invoiceTotal(inv({}))).toBe(118);
  const name = (id: string | null) => (id === "c1" ? "Client" : "");
  const s = invoiceSources(
    [
      inv({ id: "open" }),
      inv({ id: "draft", status: "draft" }),
      inv({ id: "rcpt", kind: "receipt", status: "paid" }),
      inv({ id: "paid", status: "paid", paidDate: "2026-02-01" }),
      inv({ id: "part", payments: [{ id: "p", txn: null, amount: 18, date: "2026-02-01" }] }),
    ],
    name,
  );
  expect(s.map((x) => x.id)).toEqual(["open", "paid", "part"]);
  expect(agingReport(s, "2026-02-15").totals.total).toBe(118 + 100); // open + part (118 - 18); paid is settled
  expect(agingReport(s, "2026-01-20").totals.total).toBe(118 * 3); // before the 02-01 payments everything was owed
  const bills = [
    { id: "b1", number: "BILL-1", vendor: "v1", date: "2026-01-01", due: "2026-01-31", lines: [{ amount: 100 }], status: "open" },
    { id: "b2", vendor: "v1", date: "2026-01-01", due: null, lines: [{ amount: 60 }], status: "paid", paidTxn: "t", paidDate: "2026-01-15" }, // old shape
    { id: "b3", vendor: "v1", date: "2026-01-01", lines: [{ amount: 10 }], status: "void" },
    { id: "b4", vendor: "v1", date: "2026-01-01", lines: [{ amount: 10 }], status: "draft" },
  ];
  const ap = billSources(bills, () => "Vendor");
  expect(ap.map((x) => x.id)).toEqual(["b1", "b2"]);
  expect(agingReport(ap, "2026-02-10").totals).toMatchObject({ total: 100, count: 1 }); // b2 settled by its migrated payment
  expect(agingReport(ap, "2026-01-10").totals.total).toBe(160); // b2 not yet paid then
});

test("open at a date for the balance sheet, split by issue year", () => {
  const s = [
    src({ id: "old", date: "2025-12-01", gross: 100 }),
    src({ id: "new", date: "2026-02-01", gross: 50 }),
    src({ id: "future", date: "2026-09-01", gross: 7 }),
  ];
  expect(openAt(s, "2026-06-30")).toEqual({ total: 150, prior: 100 });
  expect(openAt([...s, src({ id: "paid", date: "2026-01-05", gross: 40, payments: [{ amount: 40, date: "2026-03-01" }] })], "2026-06-30")).toEqual({
    total: 150,
    prior: 100,
  });
  expect(openAt(s, "2025-12-31")).toEqual({ total: 100, prior: 0 }); // issued in the same year as the date
});
