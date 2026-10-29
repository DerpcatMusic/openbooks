import { expect, test } from "vite-plus/test";
import { checkDictionaries } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import en from "#lib/locales/parts/bills.en.ts";
import he from "#lib/locales/parts/bills.he.ts";
import { amountDue, byVendor, candidates, dueOf, nextNumber, outgoing, status, total, unmatched, type Bill, type Vendor } from "./bills.ts";

const bill = (o: Partial<Bill>): Bill => ({
  id: "b",
  number: "BILL-0001",
  vendor: "v1",
  date: "2026-01-10",
  due: null,
  lines: [{ desc: "hosting", amount: 100, account: "expense:hosting" }],
  status: "open",
  paidTxn: null,
  paidDate: null,
  memo: "",
  ...o,
});
const tx = (o: Partial<Txn>) =>
  ({ id: "t", date: "2026-01-12", amount: -100, desc: "", category: "expense:software", account: "bank", source: "mercury", ...o }) as Txn;

test("bills: total, status, overdue, amount due, numbering, due date", () => {
  expect(
    total({
      lines: [
        { desc: "a", amount: "40.10", account: "" },
        { desc: "b", amount: 0.1, account: "" },
      ],
    }),
  ).toBe(40.2);
  expect(status(bill({ status: "draft", due: "2026-01-01" }), "2026-02-01")).toBe("draft");
  expect(status(bill({ due: "2026-01-01" }), "2026-02-01")).toBe("overdue");
  expect(status(bill({ due: "2026-03-01" }), "2026-02-01")).toBe("open");
  expect(status(bill({ due: null }), "2026-02-01")).toBe("open");
  expect(status(bill({ status: "paid", due: "2026-01-01" }), "2026-02-01")).toBe("paid");
  expect(status(bill({ status: "void", due: "2026-01-01" }), "2026-02-01")).toBe("void");
  expect(amountDue(bill({ due: "2026-01-01" }), "2026-02-01")).toBe(100); // overdue still owes the whole bill
  expect([amountDue(bill({ status: "paid" })), amountDue(bill({ status: "draft" })), amountDue(bill({ status: "void" }))]).toEqual([0, 0, 0]);
  expect(nextNumber([])).toBe("BILL-0001");
  expect(nextNumber([bill({ number: "BILL-0007" }), bill({ number: "BILL-0003" })])).toBe("BILL-0008");
  expect(dueOf("2026-01-10")).toBe("2026-02-09"); // net 30 by default
  expect(dueOf("2026-01-10", { terms: 15 })).toBe("2026-01-25");
  expect(dueOf("2026-01-10", { terms: 0 })).toBe("2026-01-10");
});

test("bills: payments that could close a bill rank by amount, then payee name, then date", () => {
  const b = bill({ date: "2026-01-10", lines: [{ desc: "x", amount: 200, account: "" }] });
  const txns = [
    tx({ id: "far", date: "2026-01-20", amount: -150, desc: "Apple Inc" }), // wrong amount, wrong payee
    tx({ id: "name", date: "2026-01-18", amount: -200, desc: "ACME" }), // exact amount, half the vendor's name
    tx({ id: "both", date: "2026-01-25", amount: -199.5, desc: "ACME LTD payment" }), // within 1%, whole name
    tx({ id: "income", date: "2026-01-19", amount: 200, desc: "ACME LTD" }), // money in is never a bill payment
    tx({ id: "early", date: "2026-01-02", amount: -200, desc: "ACME LTD" }), // before the bill
    tx({ id: "moved", date: "2026-01-21", amount: -200, desc: "ACME LTD", category: "transfer:internal" }), // own transfer
  ];
  expect(outgoing(txns[3]!)).toBe(false);
  expect(candidates(b, txns, new Set(), "Acme Ltd").map((c) => c.t.id)).toEqual(["both", "name", "far"]);
  expect(candidates(b, txns, new Set(["both"]), "Acme Ltd").map((c) => c.t.id)).toEqual(["name", "far"]); // already pays another bill
  expect(candidates(bill({ ...b, paidTxn: "both" }), txns, new Set(["both"]), "Acme Ltd")[0]!.t.id).toBe("both"); // its own payment stays
  expect(candidates(b, txns, new Set(), "Acme Ltd")[0]).toMatchObject({ amountMatch: true, sim: 1 });
});

test("bills: business spending no bill points at, vendor look-alikes first", () => {
  const vendors: Vendor[] = [{ id: "v1", name: "Hetzner Online" }];
  const txns = [
    tx({ id: "a", date: "2026-02-01", amount: -40, desc: "Hetzner Online GmbH", category: "cogs:hosting" }),
    tx({ id: "b", date: "2026-02-05", amount: -12, desc: "Corner Cafe", category: "expense:meals" }),
    tx({ id: "c", date: "2026-02-06", amount: -9, desc: "Hetzner Online", category: "expense:software" }), // a bill already points at it
    tx({ id: "d", date: "2026-02-07", amount: -5, desc: "Mystery", category: "ask" }), // not categorized yet: Review's job
    tx({ id: "e", date: "2026-02-08", amount: 500, desc: "Client", category: "business:client" }), // money in
  ];
  expect(unmatched(txns, [bill({ paidTxn: "c" })], vendors).map((u) => [u.t.id, u.vendor?.id ?? null])).toEqual([
    ["a", "v1"],
    ["b", null],
  ]);
});

test("bills: owed and paid per vendor", () => {
  const m = byVendor(
    [
      bill({ id: "1", due: "2026-01-01" }),
      bill({ id: "2", status: "paid", lines: [{ desc: "", amount: 50, account: "" }] }),
      bill({ id: "3", status: "draft" }),
      bill({ id: "4", status: "void" }),
      bill({ id: "5", vendor: null }),
    ],
    "2026-02-01",
  );
  expect(m.get("v1")).toEqual({ owed: 100, paid: 50 });
  expect(m.size).toBe(1);
});

test("bills locale part: Hebrew matches English", () => {
  expect(checkDictionaries(en, he)).toEqual([]);
});
