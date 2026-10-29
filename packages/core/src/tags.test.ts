import { describe, expect, it } from "vite-plus/test";
import type { StoredTxn } from "@openbooks/schema";
import {
  activeTags,
  createGroup,
  createTag,
  deleteGroup,
  deleteTag,
  emptyTags,
  groupMap,
  ledger,
  pickByGroup,
  renameGroup,
  renameTag,
  setTag,
  setTagActive,
  setTagColor,
  setTagGroup,
  setTagTax,
  tagName,
  withTag,
} from "./index.ts";

describe("tags", () => {
  it("createTag: slug ids (any script), numbered when taken, blank ignored, optional group", () => {
    let d = createTag(emptyTags(), "Client work");
    d = createTag(d, " client  work ");
    d = createTag(d, "שכירות", "g1");
    d = createTag(d, "***");
    expect(createTag(d, "   ")).toBe(d);
    expect(d.tags).toEqual([
      { id: "client-work", name: "Client work" },
      { id: "client-work-2", name: "client  work" },
      { id: "שכירות", name: "שכירות", group: "g1" },
      { id: "tag", name: "***" },
    ]);
  });
  it("rename, group and color; clearing removes the key; a blank name changes nothing", () => {
    let d = createTag(emptyTags(), "A");
    d = setTagColor(setTagGroup(renameTag(d, "a", " B "), "a", "g"), "a", "s2");
    expect(d.tags).toEqual([{ id: "a", name: "B", group: "g", color: "s2" }]);
    expect(renameTag(d, "a", "  ").tags[0]!.name).toBe("B");
    d = setTagColor(setTagGroup(d, "a", ""), "a");
    expect(d.tags).toEqual([{ id: "a", name: "B" }]);
    expect(tagName(d, "a")).toBe("B");
    expect(tagName(d, "nope")).toBe("");
  });
  it("setTag adds and removes by hand without duplicates or empty lists", () => {
    let d = createTag(createTag(emptyTags(), "A"), "B");
    d = setTag(setTag(d, ["x", "y"], "a", true), ["x"], "b", true);
    d = setTag(d, ["x"], "a", true);
    expect(d.on).toEqual({ x: ["a", "b"], y: ["a"] });
    d = setTag(d, ["x", "y", "never"], "a", false);
    expect(d.on).toEqual({ x: ["b"] });
  });
  it("deleteTag takes the tag off every transaction, so a new tag with the same id starts empty", () => {
    let d = setTag(setTag(createTag(createTag(emptyTags(), "A"), "B"), ["x", "y"], "a", true), ["y"], "b", true);
    d = deleteTag(d, "a");
    expect(d.tags.map((t) => t.id)).toEqual(["b"]);
    expect(d.on).toEqual({ y: ["b"] });
    expect(createTag(d, "A").on).toEqual({ y: ["b"] });
  });
  it("groups: create, rename; deleting a group deletes its tags and takes them off every transaction", () => {
    let d = createGroup(createGroup(emptyTags(), "Clients"), "clients");
    expect(d.groups).toEqual([{ id: "clients", name: "Clients" }, { id: "clients-2", name: "clients" }]);
    d = renameGroup(d, "clients", "Customers");
    d = createTag(createTag(d, "A", "clients"), "B", "clients-2");
    d = setTag(setTag(d, ["x", "y"], "a", true), ["y"], "b", true);
    d = deleteGroup(d, "clients");
    expect(d.groups).toEqual([{ id: "clients-2", name: "clients" }]);
    expect(d.tags).toEqual([{ id: "b", name: "B", group: "clients-2" }]);
    expect(d.on).toEqual({ y: ["b"] });
    expect(deleteGroup(d, "nope")).toEqual(d);
  });
  it("setTag keeps one tag per group: a second pick replaces the first, other groups and ungrouped tags stay", () => {
    let d = createGroup(createGroup(emptyTags(), "Department"), "Location");
    d = createTag(createTag(createTag(createTag(createTag(d, "Sales", "department"), "Ops", "department"), "NYC", "location"), "Chi", "location"), "Free");
    d = setTag(d, ["x"], "sales", true);
    d = setTag(d, ["x"], "nyc", true);
    d = setTag(d, ["x"], "free", true);
    expect(d.on.x).toEqual(["sales", "nyc", "free"]);
    d = setTag(d, ["x"], "ops", true); // replaces sales
    expect(d.on.x).toEqual(["nyc", "free", "ops"]);
    d = setTag(d, ["x", "y"], "chi", true); // replaces nyc on x, adds on y
    expect(d.on).toEqual({ x: ["free", "ops", "chi"], y: ["chi"] });
    expect(setTag(d, ["x"], "chi", true).on.x).toEqual(["free", "ops", "chi"]); // same tag again: no change
    d = setTag(d, ["x"], "ops", false);
    expect(d.on.x).toEqual(["free", "chi"]);
  });
  it("setTag cleans a transaction that already holds two tags of one group when the same tag is picked again, and reads split ids as their transaction", () => {
    let d = createTag(createTag(createGroup(emptyTags(), "G"), "A", "g"), "B", "g");
    d = { ...d, on: { x: ["a", "b"] } }; // written before groups were exclusive
    expect(setTag(d, ["x"], "a", true).on.x).toEqual(["a"]);
    expect(setTag(d, ["x~1"], "b", true).on).toEqual({ x: ["b"] });
  });
  it("deactivated tags can't be added to anything new but stay where they are; reactivating restores them; unknown tags are not added", () => {
    let d = setTag(createTag(emptyTags(), "Old"), ["x"], "old", true);
    d = setTagActive(d, "old", false);
    expect(d.tags[0]).toEqual({ id: "old", name: "Old", inactive: true });
    expect(d.on).toEqual({ x: ["old"] });
    expect(setTag(d, ["y"], "old", true)).toBe(d);
    expect(setTag(d, ["y"], "nope", true)).toBe(d);
    expect(setTag(d, ["x"], "old", false).on).toEqual({}); // removing is always allowed
    expect(activeTags(d)).toEqual([]);
    d = setTagActive(d, "old", true);
    expect(d.tags[0]).toEqual({ id: "old", name: "Old" });
    expect(setTag(d, ["y"], "old", true).on.y).toEqual(["old"]);
  });
  it("pickByGroup: the best of each group survives, ungrouped and unknown tags always do", () => {
    const d = createTag(createTag(createTag(createGroup(emptyTags(), "G"), "A", "g"), "B", "g"), "C");
    expect([...pickByGroup(groupMap(d), ["b", "a", "c", "ghost"])]).toEqual(["b", "c", "ghost"]);
  });
  it("withTag keeps the rows that carry the tag", () => {
    const ts = [{ id: 1, tags: ["a", "b"] }, { id: 2 }, { id: 3, tags: ["b"] }];
    expect(withTag(ts, "b").map((t) => t.id)).toEqual([1, 3]);
    expect(withTag(ts, "zzz")).toEqual([]);
  });
  it("setTagTax: sets the tax meaning, drops empty fields, clears when nothing is left; createTag can start with one", () => {
    let d = createTag(emptyTags(), "Office coffee", undefined, { rule: "il.refreshments" });
    expect(d.tags[0]).toEqual({ id: "office-coffee", name: "Office coffee", tax: { rule: "il.refreshments" } });
    d = setTagTax(d, "office-coffee", { rule: "il.refreshments", pct: 50, note: "" });
    expect(d.tags[0]!.tax).toEqual({ rule: "il.refreshments", pct: 50 });
    expect(setTagTax(d, "office-coffee", {}).tags[0]).toEqual({ id: "office-coffee", name: "Office coffee" });
    expect(setTagTax(d, "office-coffee").tags[0]!.tax).toBeUndefined();
  });
});

describe("tags on ledger rows: one per group, by hand over rules", () => {
  const row = (id: string): StoredTxn => ({ id, date: "2026-01-02", amount: -5, desc: "AWS", source: "bank", account: "Main", file: "", page: 0 });
  let d = createGroup(emptyTags(), "Dept");
  for (const [n, g] of [["Sales", "dept"], ["Ops", "dept"], ["Eng", "dept"], ["Solo", undefined]] as const) d = createTag(d, n, g);
  const rule = (tags: string[]) => ({ when: [{ field: "description", op: "contains", value: "aws" } as const], then: { tags } });
  it("two rules adding tags of one group: the earlier rule wins", () => {
    const L = ledger([row("a")], {}, [rule(["sales", "solo"]), rule(["ops"])], [], d);
    expect(L[0]!.tags).toEqual(["sales", "solo"]);
  });
  it("a tag by hand beats the rules' tag of its group, and the last hand pick wins over an older one", () => {
    expect(ledger([row("a")], {}, [rule(["sales"])], [], { ...d, on: { a: ["eng"] } })[0]!.tags).toEqual(["eng"]);
    expect(ledger([row("a")], {}, [], [], { ...d, on: { a: ["sales", "ops"] } })[0]!.tags).toEqual(["ops"]); // data written before groups were exclusive
  });
  it("ungrouped tags are all kept; deleted tags fall away", () => {
    expect(ledger([row("a")], {}, [rule(["solo", "ghost"])], [], { ...d, on: { a: ["sales"] } })[0]!.tags).toEqual(["sales", "solo"]);
  });
});
