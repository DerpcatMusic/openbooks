import { describe, expect, it } from "vite-plus/test";
import {
  createGroup,
  createTag,
  deleteGroup,
  deleteTag,
  emptyTags,
  renameGroup,
  renameTag,
  setTag,
  setTagColor,
  setTagGroup,
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
  it("groups: create, rename, delete leaves the tags ungrouped", () => {
    let d = createGroup(createGroup(emptyTags(), "Clients"), "clients");
    expect(d.groups).toEqual([{ id: "clients", name: "Clients" }, { id: "clients-2", name: "clients" }]);
    d = renameGroup(d, "clients", "Customers");
    d = createTag(createTag(d, "A", "clients"), "B", "clients-2");
    d = deleteGroup(d, "clients");
    expect(d.groups).toEqual([{ id: "clients-2", name: "clients" }]);
    expect(d.tags).toEqual([{ id: "a", name: "A" }, { id: "b", name: "B", group: "clients-2" }]);
  });
  it("withTag keeps the rows that carry the tag", () => {
    const ts = [{ id: 1, tags: ["a", "b"] }, { id: 2 }, { id: 3, tags: ["b"] }];
    expect(withTag(ts, "b").map((t) => t.id)).toEqual([1, 3]);
    expect(withTag(ts, "zzz")).toEqual([]);
  });
});
