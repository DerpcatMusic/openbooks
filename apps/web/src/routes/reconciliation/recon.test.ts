import type { StatementCheck, Txn } from "@openbooks/schema";
import { expect, test } from "vite-plus/test";
import { agrees, canMark, edit, monthCsv, monthEnd, monthOf, prefill, type Recs } from "./recon.ts";

const A = "Bank";
const tx = (id: string, date: string, amount: number, account = A): Txn => ({
  id,
  date,
  amount,
  account,
  desc: id,
  source: "bank",
  file: "",
  page: 0,
  category: "expense:x",
  why: "",
});
const bank = (date: string, total: number, label = A): StatementCheck => ({ file: "f", label, period: ["2026-01-01", date], parsed: 0, total, balance: true });
// Jan: +1000, −200.10 (ends 799.90). Feb: −50, +0.20 (ends 750.10).
const txns = [
  tx("a", "2026-01-05", 1000),
  tx("b", "2026-01-20", -200.1),
  tx("c", "2026-02-02", -50),
  tx("d", "2026-02-10", 0.2),
  tx("z", "2026-01-06", 7, "Other"),
].sort((x, y) => (x.date < y.date ? -1 : 1));

test("monthEnd and the half-cent tolerance", () => {
  expect([monthEnd("2026-02"), monthEnd("2028-02"), monthEnd("2026-12"), monthEnd("2026-04")]).toEqual([
    "2026-02-28",
    "2028-02-29",
    "2026-12-31",
    "2026-04-30",
  ]);
  expect(agrees(0.1 + 0.2, 0.3)).toBe(true); // float noise
  expect(agrees(0.3, 0.304)).toBe(true);
  expect(agrees(0.3, 0.306)).toBe(false);
});

test("a month: cleared sums, running balance, difference", () => {
  const recs: Recs = { [A]: { "2026-01": { ending: 799.9, cleared: ["a"], done: false } } };
  let m = monthOf(txns, [], recs, A, "2026-01");
  expect(m.rows.map((r) => [r.txn.id, r.balance, r.cleared])).toEqual([
    ["a", 1000, true],
    ["b", 799.9, false],
  ]); // the other account's row isn't here
  expect([m.opening, m.cleared, m.reconciled, m.ending, m.difference, m.status]).toEqual([0, 1000, 1000, 799.9, -200.1, "open"]);
  expect(canMark(m)).toBe(false);
  m = monthOf(
    txns,
    [],
    edit(recs, A, "2026-01", 799.9, (r) => ({ cleared: [...r.cleared, "b"] })),
    A,
    "2026-01",
  );
  expect([m.cleared, m.reconciled, m.difference]).toEqual([799.9, 799.9, 0]);
  expect(canMark(m)).toBe(true);
  // a hundredth of a cent off still counts as zero; a cent off doesn't
  expect(canMark({ ...m, difference: 0.004 })).toBe(true);
  expect(canMark({ ...m, difference: 0.01 })).toBe(false);
  expect(monthOf(txns, [], {}, A, "2026-01").difference).toBeNull(); // no ending balance yet
});

test("the next month starts from the last reconciled one, skipping months that aren't", () => {
  const jan = { ending: 799.9, cleared: ["a", "b"], done: true };
  const recs: Recs = { [A]: { "2026-01": jan, "2026-02": { ending: 750.1, cleared: ["c"], done: false } } };
  let m = monthOf(txns, [], recs, A, "2026-02");
  expect([m.opening, m.cleared, m.reconciled, m.difference]).toEqual([799.9, -50, 749.9, 0.2]);
  m = monthOf(
    txns,
    [],
    edit(recs, A, "2026-02", null, (r) => ({ cleared: [...r.cleared, "d"] })),
    A,
    "2026-02",
  );
  expect([m.reconciled, m.difference, canMark(m)]).toEqual([750.1, 0, true]);
  // nothing reconciled before March: it starts from the books' balance at the end of February
  expect(monthOf(txns, [], { [A]: { ...recs[A], "2026-01": { ...jan, done: false } } }, A, "2026-03").opening).toBe(750.1);
  expect(monthOf(txns, [], recs, A, "2026-03").opening).toBe(799.9); // Feb isn't done: Jan is the last reconciled
  // marked done at zero difference → status reconciled; an edit un-marks it
  const done = edit(recs, A, "2026-02", null, () => ({ cleared: ["c", "d"], done: true, at: "2026-03-01T00:00:00Z" }));
  expect(monthOf(txns, [], done, A, "2026-02").status).toBe("reconciled");
  expect(edit(done, A, "2026-02", null, () => ({ ending: 1 }))[A]!["2026-02"]!.done).toBe(false);
  expect(done[A]!["2026-02"]!.ending).toBe(750.1); // edit() didn't touch the input
});

test("before any reconciled month the opening is the books' balance at the end of the month before", () => {
  let m = monthOf(txns, [], {}, A, "2026-02");
  expect([m.opening, m.reconciled, m.difference]).toEqual([799.9, 799.9, null]);
  m = monthOf(txns, [], { [A]: { "2026-02": { ending: 750.1, cleared: ["c"], done: false } } }, A, "2026-02");
  expect(m.difference).toBe(0.2); // d (+0.20) isn't ticked yet
  m = monthOf(txns, [], { [A]: { "2026-02": { ending: 750.1, cleared: ["c", "d"], done: false } } }, A, "2026-02");
  expect([m.reconciled, m.difference, canMark(m)]).toEqual([750.1, 0, true]);
});

test("auto-reconciled: the books equal the bank's own balance on the month's last day", () => {
  let m = monthOf(txns, [bank("2026-01-31", 799.9)], {}, A, "2026-01");
  expect([m.auto, m.status, m.ending, m.cleared, m.difference]).toEqual([true, "auto", 799.9, 799.9, 0]);
  expect(m.rows.every((r) => r.cleared)).toBe(true);
  expect(canMark(m)).toBe(false); // nothing to mark
  expect(monthOf(txns, [bank("2026-01-31", 800)], {}, A, "2026-01").auto).toBe(false); // the bank says 800.00, the books 799.90
  expect(monthOf(txns, [bank("2026-01-31", 799.9, "Other bank")], {}, A, "2026-01").auto).toBe(false); // another account's balance
  expect(monthOf(txns, [bank("2026-01-30", 799.9)], {}, A, "2026-01").auto).toBe(false); // not the last day
  // the next month carries in the bank's balance without anyone marking January
  m = monthOf(txns, [bank("2026-01-31", 799.9)], {}, A, "2026-02");
  expect([m.opening, m.auto]).toEqual([799.9, false]);
});

test("the ending balance is prefilled from a bank balance dated in that month", () => {
  const checks = [bank("2026-01-31", 799.9), bank("2026-02-10", 750.1), bank("2026-02-28", 700)];
  expect(prefill(checks, A, "2026-02")).toBe(700); // the latest one in February
  expect(prefill(checks, A, "2026-03")).toBeNull();
  expect(monthOf(txns, checks, {}, A, "2026-02").ending).toBe(700);
  const typed: Recs = { [A]: { "2026-02": { ending: 750.1, cleared: [], done: false } } };
  expect(monthOf(txns, checks, typed, A, "2026-02").ending).toBe(750.1); // what was typed wins
  expect(edit({}, A, "2026-02", 700, () => ({ cleared: ["c"] }))[A]!["2026-02"]).toEqual({ ending: 700, cleared: ["c"], done: false });
});

test("CSV: balances, then one line per transaction", () => {
  const csv = monthCsv(A, monthOf(txns, [], { [A]: { "2026-01": { ending: 799.9, cleared: ["a"], done: false } } }, A, "2026-01"), () => 'Say "hi"').split(
    "\n",
  );
  expect(csv.slice(0, 7)).toEqual([
    '"Account","Bank"',
    '"Month","2026-01"',
    '"Carried in","0"',
    '"Cleared","1000"',
    '"Reconciled balance","1000"',
    '"Ending balance","799.9"',
    '"Difference","-200.1"',
  ]);
  expect(csv.slice(8)).toEqual([
    "Date,Description,Ledger account,Amount,Balance,Cleared",
    '"2026-01-05","a","Say ""hi""","1000","1000","yes"',
    '"2026-01-20","b","Say ""hi""","-200.1","799.9","no"',
  ]);
});
