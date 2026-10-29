import { expect, test } from "vite-plus/test";
import { checkDictionaries } from "@openbooks/core";
import en from "#lib/locales/parts/3-6.en.ts";
import he from "#lib/locales/parts/3-6.he.ts";
import type { Txn } from "@openbooks/schema";
import {
  apply,
  applied,
  candidates,
  isLate,
  kindsFor,
  net,
  nextNumber,
  owedOf,
  paidAmount,
  remaining,
  status,
  total,
  unmatched,
  vatOf,
  type Invoice,
} from "./invoices.ts";

const inv = (o: Partial<Invoice>): Invoice => ({
  id: "i",
  kind: "bill",
  number: null,
  customer: null,
  items: [],
  issued: "2026-01-10",
  due: null,
  status: "open",
  paidTxn: null,
  paidDate: null,
  ref: null,
  ...o,
});

test("invoices: VAT, totals, numbering, status", () => {
  const items = [
    { desc: "a", qty: 2, price: "100" },
    { desc: "b", qty: "1", price: 0.5 },
  ];
  expect(net({ items })).toBe(200.5);
  expect(total({ items })).toBe(200.5); // no VAT field: exempt / old documents unchanged
  expect(vatOf({ items, vat: 0.18 })).toBe(36.09);
  expect(total({ items, vat: 0.18 })).toBe(236.59);
  expect(kindsFor(true, false)).toEqual(["invoice"]);
  expect(kindsFor(false, false)).toEqual(["bill", "receipt"]);
  expect(kindsFor(false, true)).toEqual(["tax", "bill", "receipt"]);
  const docs = [inv({ kind: "tax", number: "0007" }), inv({ kind: "bill", number: "0002" }), inv({ kind: "invoice", number: "INV-0009" })];
  expect(nextNumber(docs, "tax")).toBe("0008");
  expect(nextNumber(docs, "receipt")).toBe("0001");
  expect(nextNumber(docs, "invoice")).toBe("INV-0010");
  expect(status(inv({ status: "draft" }))).toBe("draft");
  expect(status(inv({ kind: "receipt" }))).toBe("paid");
  expect(status(inv({ due: "2026-01-01" }), "2026-02-01")).toBe("overdue");
  expect(status(inv({ due: "2026-03-01" }), "2026-02-01")).toBe("unpaid");
});

const tx = (o: Partial<Txn>) =>
  ({ id: "t", date: "2026-01-20", amount: 100, desc: "", category: "business:client", account: "bank", source: "mercury", ...o }) as Txn;
const one = (price: number, o: Partial<Invoice> = {}) =>
  inv({ kind: "invoice", number: "INV-1", items: [{ desc: "x", qty: 1, price }], due: "2026-02-10", ...o });

test("invoices: partial payments derive the status and what is still owed; the old paid shape still reads as paid in full", () => {
  const now = "2026-03-01";
  const part = one(100, { payments: [{ id: "p", txn: "t1", amount: 40, date: "2026-02-01" }] });
  expect(status(part, now)).toBe("partial"); // past due and partly paid: partial, like Mercury
  expect(isLate(part, now)).toBe(true);
  expect([paidAmount(part), owedOf(part)]).toEqual([40, 60]);
  const full = one(100, {
    payments: [
      { id: "p", txn: "t1", amount: 40, date: "2026-02-01" },
      { id: "q", txn: null, amount: 60, date: "2026-02-02" },
    ],
  });
  expect([status(full, now), owedOf(full), isLate(full, now)]).toEqual(["paid", 0, false]); // open but covered
  expect([status(one(100, { status: "paid", paidTxn: "t1" }), now), owedOf(one(100, { status: "paid" }))]).toEqual(["paid", 0]);
  expect([status(one(100), now), owedOf(one(100))]).toEqual(["overdue", 100]);
  expect(owedOf(one(100, { status: "draft" }))).toBe(0);
  expect(owedOf(one(100, { kind: "receipt" }))).toBe(0); // a receipt documents money already received
  expect(status(one(100, { due: "2026-03-01" }), now)).toBe("unpaid");
  expect(status(one(0), now)).toBe("overdue"); // zero is never paid
});

test("invoices: applications are capped at what is owed and at what is left of the transaction; a legacy paidTxn takes the whole transaction", () => {
  const a = one(100);
  const t1 = tx({ id: "t1", amount: 70 });
  const ps = apply(a, 100, t1, Infinity, "x", new Map(), "p1");
  expect(ps).toEqual([{ id: "p1", txn: "t1", amount: 70, date: "2026-01-20" }]);
  const taken = applied([{ ...a, payments: ps }, one(5, { id: "old", status: "paid", paidTxn: "t9" })]);
  expect(taken.get("t1")).toBe(70);
  expect(taken.get("t9")).toBe(Infinity);
  expect([remaining(t1, taken), remaining(tx({ id: "t9", amount: 500 }), taken), remaining(tx({ id: "new", amount: 5 }), taken)]).toEqual([0, 0, 5]);
  expect(apply({ ...a, payments: ps }, 30, tx({ id: "t2", amount: 900 }), Infinity, "x", taken, "p2").at(-1)!.amount).toBe(30); // never more than owed
  expect(apply(a, 100, t1, 10, "x", taken, "p3")).toEqual([]); // t1 is used up
  expect(apply(a, 100, null, 25, "2026-02-02", taken, "p4")).toEqual([{ id: "p4", txn: null, amount: 25, date: "2026-02-02" }]);
  // skip leaves a document out (the receipt that shares its bill's payment)
  expect(applied([one(5, { status: "paid", paidTxn: "t9" })], () => true).size).toBe(0);
});

test("invoices: the exact fit (what is left of the payment = what is owed, issue .. due + 14 days) ranks first", () => {
  const a = one(200, { issued: "2026-01-10", due: "2026-01-31" });
  const txns = [
    tx({ id: "x", date: "2026-01-15", amount: 150, desc: "ACME" }),
    tx({ id: "exact", date: "2026-02-14", amount: 200, desc: "Other" }), // due + 14 days: still in
    tx({ id: "late", date: "2026-02-15", amount: 200, desc: "ACME LTD" }), // a day too late: amount match only
    tx({ id: "near", date: "2026-01-20", amount: 199, desc: "ACME LTD" }),
    tx({ id: "before", date: "2026-01-02", amount: 200 }),
    tx({ id: "out", date: "2026-01-20", amount: -200 }),
  ];
  const c = candidates(a, 200, txns, new Map(), "Acme Ltd");
  expect(c.map((x) => x.t.id)).toEqual(["exact", "near", "late", "x"]);
  expect(c[0]).toMatchObject({ exact: true, left: 200 });
  // a partly used payment is offered for what is left
  expect(candidates(a, 100, [tx({ id: "p", date: "2026-01-20", amount: 150 })], new Map([["p", 50]]), "")[0]).toMatchObject({ left: 100, exact: true });
  expect(candidates(a, 100, [tx({ id: "p", amount: 150 })], new Map([["p", 150]]), "")).toEqual([]);
});

test("invoices: income with money not yet applied still shows as loose", () => {
  const docs = [
    one(100, { payments: [{ id: "p", txn: "t1", amount: 100, date: "2026-01-20" }] }),
    one(100, { id: "j", payments: [{ id: "q", txn: "t2", amount: 40, date: "2026-01-20" }] }),
  ];
  expect(unmatched([tx({ id: "t1" }), tx({ id: "t2", amount: 100 }), tx({ id: "t3", amount: 7 })], docs, []).map((u) => u.t.id)).toEqual(["t2", "t3"]); // t1 is fully applied; t2 only 40 of 100
});

test("3.6 locale parts: Hebrew matches English", () => {
  expect(checkDictionaries(en, he)).toEqual([]);
});
