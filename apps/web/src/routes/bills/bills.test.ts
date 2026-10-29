import { expect, test } from "vite-plus/test";
import { checkDictionaries } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import en from "#lib/locales/parts/bills.en.ts";
import he from "#lib/locales/parts/bills.he.ts";
import gapsEn from "#lib/locales/parts/gaps.en.ts";
import gapsHe from "#lib/locales/parts/gaps.he.ts";
import { amountDue, apply, applied, byVendor, candidates, dueOf, inWindow, isOverdue, nextNumber, outgoing, readBills, remaining, status, suggestBills, total, unapply, unmatched, type Bill, type Vendor } from "./bills.ts";

const bill = (o: Partial<Bill>): Bill => ({
  id: "b",
  number: "BILL-0001",
  vendor: "v1",
  date: "2026-01-10",
  due: null,
  lines: [{ desc: "hosting", amount: 100, account: "expense:hosting" }],
  status: "open",
  payments: [],
  memo: "",
  ...o,
});
const pay = (amount: number, txn: string | null = null, date = "2026-01-20") => ({ id: `p${amount}${txn}`, txn, amount, date });
const tx = (o: Partial<Txn>) =>
  ({ id: "t", date: "2026-01-12", amount: -100, desc: "", category: "expense:software", account: "bank", source: "mercury", ...o }) as Txn;

test("bills: total, numbering, due date", () => {
  expect(
    total({
      lines: [
        { desc: "a", amount: "40.10", account: "" },
        { desc: "b", amount: 0.1, account: "" },
      ],
    }),
  ).toBe(40.2);
  expect(nextNumber([])).toBe("BILL-0001");
  expect(nextNumber([bill({ number: "BILL-0007" }), bill({ number: "BILL-0003" })])).toBe("BILL-0008");
  expect(dueOf("2026-01-10")).toBe("2026-02-09"); // net 30 by default
  expect(dueOf("2026-01-10", { terms: 15 })).toBe("2026-01-25");
  expect(dueOf("2026-01-10", { terms: 0 })).toBe("2026-01-10");
});

test("bills: status is derived from the payments, stored status is draft/open/cancelled only", () => {
  const now = "2026-02-01";
  expect(status(bill({ status: "draft", due: "2026-01-01" }), now)).toBe("draft");
  expect(status(bill({ due: "2026-01-01" }), now)).toBe("overdue");
  expect(status(bill({ due: "2026-03-01" }), now)).toBe("open");
  expect(status(bill({ due: null }), now)).toBe("open");
  expect(status(bill({ status: "cancelled", due: "2026-01-01" }), now)).toBe("cancelled");
  // partial payment
  const part = bill({ due: "2026-03-01", payments: [pay(40, "t1")] });
  expect(status(part, now)).toBe("partial");
  expect(amountDue(part)).toBe(60);
  expect(status({ ...part, payments: [...part.payments, pay(60, "t2")] }, now)).toBe("paid"); // two payments settle it
  expect(amountDue({ ...part, payments: [pay(40, "t1"), pay(60, "t2")] })).toBe(0);
  // partly paid and past due: Mercury shows partial, we still count it overdue for the totals
  const late = bill({ due: "2026-01-15", payments: [pay(25)] });
  expect(status(late, now)).toBe("partial");
  expect(isOverdue(late, now)).toBe(true);
  expect(isOverdue(bill({ due: "2026-01-15", payments: [pay(100)] }), now)).toBe(false); // settled
  expect(isOverdue(bill({ due: "2026-02-01" }), now)).toBe(false); // due today
  expect(isOverdue(bill({ due: "2026-01-15", status: "cancelled" }), now)).toBe(false);
  // nothing is owed on a draft or a cancelled bill
  expect([amountDue(bill({ status: "draft" })), amountDue(bill({ status: "cancelled" }))]).toEqual([0, 0]);
  // cents add up exactly
  expect(status(bill({ lines: [{ desc: "", amount: 0.3, account: "" }], payments: [pay(0.1), pay(0.2)] }), now)).toBe("paid");
});

test("bills: old docs migrate on read (paid -> open + one payment, void -> cancelled), new ones pass through", () => {
  const { payments: _none, ...stub } = bill({}); // the old shape has no payments
  const old = [
    { ...stub, id: "1", status: "paid", paidTxn: "t9", paidDate: "2026-01-30" },
    { ...stub, id: "2", status: "paid", paidTxn: null, paidDate: null }, // paid by hand
    { ...stub, id: "3", status: "void" },
    { ...stub, id: "4", status: "open", paidTxn: null, paidDate: null },
    bill({ id: "5", payments: [pay(10, "t1")] }),
  ];
  const [a, b, c, d, e] = readBills(old);
  expect(a).toMatchObject({ status: "open", payments: [{ txn: "t9", amount: 100, date: "2026-01-30" }] });
  expect(status(a!, "2026-06-01")).toBe("paid");
  expect(b!.payments).toMatchObject([{ txn: null, amount: 100, date: "2026-01-10" }]);
  expect(c).toMatchObject({ status: "cancelled", payments: [] });
  expect(d).toMatchObject({ status: "open", payments: [] });
  expect(e!.payments).toHaveLength(1);
  expect(a).not.toHaveProperty("paidTxn");
  expect(readBills(readBills(old))).toEqual(readBills(old)); // idempotent
});

test("bills: payment applications cap at what is owed and at what is left of the transaction, and unapply", () => {
  const b = bill({ lines: [{ desc: "", amount: 200, account: "" }] });
  const t1 = tx({ id: "t1", amount: -150, date: "2026-01-20" });
  const taken = applied([b]);
  expect(taken.size).toBe(0);
  let ps = apply(b, t1, 80, "x", taken, "p1");
  expect(ps).toEqual([{ id: "p1", txn: "t1", amount: 80, date: "2026-01-20" }]);
  const b2 = { ...b, payments: ps };
  expect(applied([b2]).get("t1")).toBe(80);
  expect(remaining(t1, applied([b2]))).toBe(70);
  // the second bill takes only what is left of t1 (70) even though 120 was asked
  const other = bill({ id: "o", lines: [{ desc: "", amount: 500, account: "" }] });
  expect(apply(other, t1, 120, "x", applied([b2]), "p2")[0]!.amount).toBe(70);
  // a transaction that is used up applies nothing
  expect(apply(other, t1, 10, "x", new Map([["t1", 150]]), "p3")).toEqual([]);
  // cannot overpay the bill: 120 owed, 500 offered
  const t2 = tx({ id: "t2", amount: -900 });
  expect(apply(b2, t2, 500, "x", new Map(), "p4").at(-1)!.amount).toBe(120);
  // paid outside the books: no transaction, own date
  expect(apply(b, null, 50, "2026-02-02", taken, "p5")).toEqual([{ id: "p5", txn: null, amount: 50, date: "2026-02-02" }]);
  // fully paid: nothing more applies
  expect(apply({ ...b, payments: [pay(200)] }, null, 5, "2026-02-02", taken, "p6")).toHaveLength(1);
  // unapply removes one payment and the bill is open again
  const two = { ...b, payments: [pay(80, "t1"), pay(120, "t2")] };
  expect(status(two, "2026-02-01")).toBe("paid");
  const back = { ...two, payments: unapply(two, pay(120, "t2").id) };
  expect(status(back, "2026-02-01")).toBe("partial");
  expect(amountDue(back)).toBe(120);
  expect(unapply(back, "nope")).toHaveLength(1);
});

test("bills: suggestions rank the exact fit first (outstanding = payment, dated bill date .. due + 14 days), then the fuzzy ranking", () => {
  const b = bill({ date: "2026-01-10", due: "2026-01-31", lines: [{ desc: "x", amount: 200, account: "" }] });
  expect(inWindow(b, "2026-01-10")).toBe(true);
  expect(inWindow(b, "2026-02-14")).toBe(true); // due + 14
  expect(inWindow(b, "2026-02-15")).toBe(false);
  expect(inWindow(b, "2026-01-09")).toBe(false);
  expect(inWindow(bill({ due: null, date: "2026-01-10" }), "2026-01-24")).toBe(true); // no due date: bill date + 14
  const txns = [
    tx({ id: "far", date: "2026-01-20", amount: -150, desc: "Apple Inc" }), // wrong amount, wrong payee
    tx({ id: "name", date: "2026-01-18", amount: -200, desc: "ACME" }), // exact amount, half the vendor's name
    tx({ id: "both", date: "2026-01-25", amount: -199.5, desc: "ACME LTD payment" }), // within 1%, whole name
    tx({ id: "late", date: "2026-03-01", amount: -200, desc: "ACME LTD" }), // exact amount but after the window: fuzzy only
    tx({ id: "income", date: "2026-01-19", amount: 200, desc: "ACME LTD" }), // money in is never a bill payment
    tx({ id: "early", date: "2026-01-02", amount: -200, desc: "ACME LTD" }), // before the bill
    tx({ id: "moved", date: "2026-01-21", amount: -200, desc: "ACME LTD", category: "transfer:internal" }), // own transfer
  ];
  expect(outgoing(txns[4]!)).toBe(false);
  const c = candidates(b, txns, new Map(), "Acme Ltd");
  expect(c.map((x) => x.t.id)).toEqual(["name", "both", "late", "far"]); // both and late fit the amount and the name: the earlier date first
  expect(c.map((x) => x.exact)).toEqual([true, false, false, false]);
  // a used-up payment is gone; a partly used one is offered for what is left
  expect(candidates(b, txns, new Map([["name", 200]]), "Acme Ltd").map((x) => x.t.id)).toEqual(["both", "late", "far"]);
  const half = candidates(bill({ ...b, payments: [pay(100, "x")] }), [tx({ id: "p", date: "2026-01-20", amount: -150, desc: "ACME" })], new Map([["p", 50]]), "Acme");
  expect(half[0]).toMatchObject({ left: 100, exact: true }); // 100 left of the payment, 100 still owed
  // the other direction: which bills does one payment fit?
  const pay1 = tx({ id: "pp", date: "2026-02-10", amount: -200 });
  const bills = [
    bill({ id: "z", date: "2026-01-12", due: "2026-02-12", lines: [{ desc: "", amount: 200, account: "" }] }), // due 2 days away
    bill({ id: "y", date: "2026-01-05", due: "2026-02-10", lines: [{ desc: "", amount: 200, account: "" }] }), // due the day itself
    bill({ id: "x", date: "2026-01-04", due: "2026-02-12", lines: [{ desc: "", amount: 200, account: "" }] }), // ties with z; earlier bill date wins
    bill({ id: "w", date: "2026-01-04", due: "2026-02-10", lines: [{ desc: "", amount: 199, account: "" }] }), // other amount
    bill({ id: "v", date: "2026-03-01", due: "2026-03-31", lines: [{ desc: "", amount: 200, account: "" }] }), // payment predates the bill
    bill({ id: "u", date: "2026-01-04", due: "2026-02-10", status: "draft", lines: [{ desc: "", amount: 200, account: "" }] }), // not approved
  ];
  expect(suggestBills(pay1, bills, new Map(), "2026-02-11").map((x) => x.id)).toEqual(["y", "x", "z"]);
  expect(suggestBills(pay1, bills, new Map([["pp", 50]]), "2026-02-11")).toEqual([]); // 150 left fits no bill exactly
  expect(suggestBills(tx({ amount: 200 }), bills, new Map())).toEqual([]);
});

test("bills: business spending no bill points at, vendor look-alikes first; a partly applied payment still shows", () => {
  const vendors: Vendor[] = [{ id: "v1", name: "Hetzner Online" }];
  const txns = [
    tx({ id: "a", date: "2026-02-01", amount: -40, desc: "Hetzner Online GmbH", category: "cogs:hosting" }),
    tx({ id: "b", date: "2026-02-05", amount: -12, desc: "Corner Cafe", category: "expense:meals" }),
    tx({ id: "c", date: "2026-02-06", amount: -9, desc: "Hetzner Online", category: "expense:software" }), // a bill takes all of it
    tx({ id: "d", date: "2026-02-07", amount: -5, desc: "Mystery", category: "ask" }), // not categorized yet: Review's job
    tx({ id: "e", date: "2026-02-08", amount: 500, desc: "Client", category: "business:client" }), // money in
    tx({ id: "f", date: "2026-02-09", amount: -30, desc: "Corner Cafe", category: "expense:meals" }), // a bill takes 10 of it
  ];
  const taken = [bill({ payments: [pay(9, "c"), pay(10, "f")] })];
  expect(unmatched(txns, taken, vendors).map((u) => [u.t.id, u.vendor?.id ?? null])).toEqual([
    ["a", "v1"],
    ["f", null],
    ["b", null],
  ]);
});

test("bills: owed and paid per vendor, partial payments counted, old shape accepted", () => {
  const m = byVendor([
    bill({ id: "1", due: "2026-01-01" }), // owes 100
    bill({ id: "2", payments: [pay(50)], lines: [{ desc: "", amount: 50, account: "" }] }), // paid in full
    bill({ id: "3", status: "draft" }),
    bill({ id: "4", status: "cancelled" }),
    bill({ id: "5", vendor: null }),
    bill({ id: "6", payments: [pay(30)] }), // owes 70, paid 30
    { ...bill({ id: "7" }), status: "paid", paidTxn: "t", paidDate: "2026-01-12", payments: undefined }, // old shape, paid 100
  ]);
  expect(m.get("v1")).toEqual({ owed: 170, paid: 50 + 30 + 100 });
  expect(m.size).toBe(1);
});

test("bills locale parts: Hebrew matches English", () => {
  expect(checkDictionaries(en, he)).toEqual([]);
  expect(checkDictionaries(gapsEn, gapsHe)).toEqual([]);
});
