import { expect, test } from "vite-plus/test";
import { closedOn, movedBefore } from "./close.ts";

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
