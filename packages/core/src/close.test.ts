import { expect, test } from "vite-plus/test";
import { checkBooks, closedOn, movedBefore } from "./close.ts";

test("closedOn: on or before the close date, never without one", () => {
  expect(closedOn("2026-09-30", "2026-09-30")).toBe(true);
  expect(closedOn("2026-10-01", "2026-09-30")).toBe(false);
  expect(closedOn("2020-01-01", null)).toBe(false);
  expect(closedOn("2020-01-01", undefined)).toBe(false);
  expect(closedOn("2020-01-01", "")).toBe(false);
  expect(closedOn("", "2026-09-30")).toBe(false); // no date: not provably closed
  expect(closedOn(undefined, "2026-09-30")).toBe(false);
});

test("movedBefore: closed items that changed, added or removed; key order and open items don't count", () => {
  const e = (id: string, date: string, memo = "x") => ({ id, date, memo, lines: [{ account: "a", debit: 1 }] });
  const before = [e("old", "2026-01-10"), e("new", "2026-05-01")];
  // same content with the keys written in another order is not a change
  const reordered = { lines: [{ debit: 1, account: "a" }], memo: "x", date: "2026-01-10", id: "old" };
  expect(movedBefore(before, [reordered, e("new", "2026-05-01", "edited")], "2026-03-31")).toEqual([]);
  expect(movedBefore(before, [e("old", "2026-01-10", "edited"), before[1]!], "2026-03-31")).toEqual(["old"]);
  expect(movedBefore(before, [before[1]!], "2026-03-31")).toEqual(["old"]); // deleted
  expect(movedBefore(before, [...before, e("late", "2026-02-02")], "2026-03-31")).toEqual(["late"]); // added in the closed period
  expect(movedBefore(before, [...before, e("fresh", "2026-06-01")], "2026-03-31")).toEqual([]); // added after it
  expect(movedBefore(before, [before[0]!], "2026-03-31")).toEqual([]); // deleted after it
  expect(movedBefore(before, [e("old", "2026-06-01"), before[1]!], "2026-03-31")).toEqual(["old"]); // moved out of it
  expect(movedBefore(before, [before[0]!, e("new", "2026-02-01")], "2026-03-31")).toEqual(["new"]); // moved into it
});

test("checkBooks: close date not in the future or before the start date; the start date only moves earlier", () => {
  const today = "2026-10-29";
  expect(checkBooks({}, { closeDate: "2026-10-29" }, today)).toBeNull();
  expect(checkBooks({}, { closeDate: "2026-10-30" }, today)).toBe("closeFuture");
  expect(checkBooks({}, { closeDate: "2026-02-30" }, today)).toBe("date");
  expect(checkBooks({}, { closeDate: "nope" }, today)).toBe("date");
  expect(checkBooks({}, { startDate: "2025-01-01", closeDate: "2024-12-31" }, today)).toBe("closeBeforeStart");
  expect(checkBooks({}, { startDate: "2025-01-01", closeDate: "2025-01-01" }, today)).toBeNull();
  // the start date, once set, can only move earlier (or be cleared)
  expect(checkBooks({ startDate: "2025-01-01" }, { startDate: "2025-01-02" }, today)).toBe("startLater");
  expect(checkBooks({ startDate: "2025-01-01" }, { startDate: "2025-01-01" }, today)).toBeNull();
  expect(checkBooks({ startDate: "2025-01-01" }, { startDate: "2024-06-01" }, today)).toBeNull();
  expect(checkBooks({ startDate: "2025-01-01" }, { startDate: null }, today)).toBeNull();
  expect(checkBooks({ startDate: "2025-01-01" }, null, today)).toBeNull();
  expect(checkBooks({}, { startDate: "2030-01-01" }, today)).toBeNull(); // nothing says the first start date can't be set freely
  // a value saved before these checks existed doesn't block unrelated edits
  expect(checkBooks({ closeDate: "2027-01-01" }, { closeDate: "2027-01-01", startDate: "2025-01-01" }, today)).toBeNull();
  expect(checkBooks({ closeDate: "2027-01-01" }, { closeDate: "2027-01-02" }, today)).toBe("closeFuture");
  // moving the close date back stays allowed (it unlocks the period)
  expect(checkBooks({ closeDate: "2026-09-30" }, { closeDate: "2026-01-31" }, today)).toBeNull();
});

test("checkBooks: the basis is cash or accrual, and either can be switched at any time", () => {
  expect(checkBooks({}, { basis: "accrual" }, "2026-10-29")).toBeNull();
  expect(checkBooks({ basis: "accrual" }, { basis: null }, "2026-10-29")).toBeNull();
  expect(checkBooks({}, { basis: "cash" }, "2026-10-29")).toBeNull();
  expect(checkBooks({}, { basis: "hybrid" as never }, "2026-10-29")).toBe("basis");
});
