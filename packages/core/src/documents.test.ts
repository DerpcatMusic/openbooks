import { expect, test } from "vite-plus/test";
import { billProblem, issueDocs, nextDocNumber, type IssuedDoc } from "./documents.ts";

const doc = (id: string, o: Partial<IssuedDoc> = {}): IssuedDoc => ({
  id,
  kind: "bill",
  number: null,
  status: "draft",
  issued: "2026-03-01",
  items: [{ desc: "work", qty: 1, price: 100 }],
  ...o,
});
const ok = (r: ReturnType<typeof issueDocs>) => {
  if ("problem" in r) throw new Error(JSON.stringify(r.problem));
  return r.docs;
};

test("issueDocs: numbers are assigned on issue per kind, gapless, and the client's guess is ignored", () => {
  const before = [doc("a", { status: "open", number: "0001" }), doc("t", { kind: "tax", status: "open", number: "0007" })];
  const out = ok(
    issueDocs(before, [
      ...before,
      doc("b", { status: "open", number: "0042" }),
      doc("c", { status: "open", issued: "2026-03-02" }),
      doc("d", { number: "0099" }),
    ]),
  );
  expect(out.map((d) => d.number)).toEqual(["0001", "0007", "0002", "0003", null]);
  // two documents issued at once go in date order
  const two = ok(issueDocs([], [doc("late", { status: "open", issued: "2026-04-01" }), doc("early", { status: "open", issued: "2026-03-01" })]));
  expect(two.map((d) => [d.id, d.number])).toEqual([
    ["late", "0002"],
    ["early", "0001"],
  ]);
  expect(nextDocNumber([doc("x", { kind: "invoice", status: "open", number: "INV-0009" })], "invoice")).toBe("INV-0010");
});

test("issueDocs: an issued document can't be deleted, edited, renumbered or un-issued; payments still move", () => {
  const before = [doc("a", { status: "open", number: "0001", prints: 2 })];
  const a = before[0]!;
  expect(issueDocs(before, [])).toEqual({ problem: { code: "deleteIssued", number: "0001" } });
  expect(issueDocs(before, [{ ...a, items: [{ desc: "work", qty: 1, price: 90 }] }])).toEqual({ problem: { code: "editIssued", number: "0001" } });
  expect(issueDocs(before, [{ ...a, number: "0005" }])).toEqual({ problem: { code: "editIssued", number: "0001" } });
  expect(issueDocs(before, [{ ...a, issued: "2026-01-01" }])).toEqual({ problem: { code: "editIssued", number: "0001" } });
  expect(issueDocs(before, [{ ...a, status: "draft" }])).toEqual({ problem: { code: "editIssued", number: "0001" } });
  expect(issueDocs(before, [{ ...a, status: "cancelled" }])).toEqual({ problem: { code: "editIssued", number: "0001" } });
  // paying it is fine, and a stale client can't reset the print count
  const paid = ok(
    issueDocs(before, [{ ...a, status: "paid", paidDate: "2026-03-05", payments: [{ id: "p", txn: null, amount: 100, date: "2026-03-05" }], prints: 0 }]),
  );
  expect(paid[0]).toMatchObject({ status: "paid", number: "0001", prints: 2 });
});

test("issueDocs: no backdating within a kind, nothing on or before the close date, real dates only", () => {
  const before = [doc("a", { status: "open", number: "0001", issued: "2026-03-10" })];
  expect(issueDocs(before, [...before, doc("b", { status: "open", issued: "2026-03-09" })])).toEqual({
    problem: { code: "backdate", id: "b", last: "2026-03-10" },
  });
  expect(ok(issueDocs(before, [...before, doc("b", { status: "open", issued: "2026-03-10" })]))[1]!.number).toBe("0002");
  expect(ok(issueDocs(before, [...before, doc("r", { kind: "receipt", status: "paid", issued: "2026-01-01" })]))[1]!.number).toBe("0001"); // another kind
  expect(issueDocs([], [doc("b", { status: "open", issued: "2026-01-31" })], "2026-01-31")).toEqual({
    problem: { code: "closed", id: "b", close: "2026-01-31" },
  });
  expect(issueDocs([], [doc("b", { status: "open", issued: "2026-02-30" })])).toEqual({ problem: { code: "date", id: "b" } });
  // a draft dated anywhere is fine: it isn't in the books yet
  expect(ok(issueDocs([], [doc("b", { issued: "2020-01-01" })], "2026-01-31"))).toHaveLength(1);
});

test("issueDocs: a credit cancels an issued document, copies it negated, numbers in its own series and freezes both", () => {
  const before = [doc("a", { kind: "tax", status: "paid", number: "0003", customer: "c1", vat: 0.18, items: [{ desc: "work", qty: 2, price: 50 }] })];
  const credit = doc("cr", { kind: "credit", status: "open", cancels: "a", issued: "2026-03-05", items: [], customer: "someone else" });
  const out = ok(issueDocs(before, [...before, credit]));
  expect(out[0]).toMatchObject({ status: "cancelled", cancelledBy: "cr", number: "0003" });
  expect(out[1]).toMatchObject({
    kind: "credit",
    number: "0001",
    ref: "0003",
    refKind: "tax",
    customer: "c1",
    vat: 0.18,
    items: [{ desc: "work", qty: 2, price: -50 }],
  });
  // the cancelled original is frozen, payments included; it can't be cancelled twice
  expect(issueDocs(out, [{ ...out[0]!, status: "open" }, out[1]!])).toEqual({ problem: { code: "cancelled", number: "0003" } });
  expect(issueDocs(out, [...out, doc("cr2", { kind: "credit", status: "open", cancels: "a", issued: "2026-03-06" })])).toEqual({
    problem: { code: "cancelTarget", id: "cr2" },
  });
  // only an issued document can be cancelled
  expect(issueDocs([doc("d")], [doc("d"), doc("cr", { kind: "credit", status: "open", cancels: "d" })])).toEqual({
    problem: { code: "cancelTarget", id: "cr" },
  });
  // the client can't mark a document cancelled by itself
  expect(issueDocs(before, [{ ...before[0]!, status: "cancelled" }])).toEqual({ problem: { code: "editIssued", number: "0003" } });
});

test("billProblem: approved bills are cancelled, not deleted; closed-period bills don't change except their payments", () => {
  const b = { id: "b", status: "open", number: "BILL-0001", date: "2026-01-10", lines: [{ amount: 10 }] };
  expect(billProblem([b], [])).toEqual({ code: "deleteIssued", number: "BILL-0001" });
  expect(billProblem([{ ...b, status: "draft" }], [])).toBeNull();
  expect(billProblem([b], [{ ...b, lines: [{ amount: 11 }] }], "2026-01-31")).toEqual({ code: "closed", number: "BILL-0001" });
  expect(billProblem([b], [{ ...b, payments: [{ id: "p", txn: null, amount: 10, date: "2026-03-01" }] }], "2026-01-31")).toBeNull();
  expect(billProblem([], [{ ...b, id: "n" }], "2026-01-31")).toEqual({ code: "closed", number: "BILL-0001" });
  expect(billProblem([b], [{ ...b, lines: [{ amount: 11 }] }], "2025-12-31")).toBeNull();
});
