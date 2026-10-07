import { expect, test } from "vite-plus/test";
import { checkDictionaries } from "@openbooks/core";
import en from "#lib/locales/parts/3-6.en.ts";
import he from "#lib/locales/parts/3-6.he.ts";
import { kindsFor, net, nextNumber, status, total, vatOf, type Invoice } from "./invoices.ts";

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

test("3.6 locale parts: Hebrew matches English", () => {
  expect(checkDictionaries(en, he)).toEqual([]);
});
