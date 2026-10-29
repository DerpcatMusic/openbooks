// Tags (doc "tags"): tags with an optional tag group and colour, and the tags each transaction carries by hand. Pure: every function
// returns the new doc. Rules add tags on top at read time (ledger.ts), so editing a rule retags at once; ids of deleted tags are ignored there.
import type { TagsDoc } from "@openbooks/schema";

export const emptyTags = (): TagsDoc => ({ groups: [], tags: [], on: {} });

/** "Client work" → "client-work" (letters in any script kept); a taken id gets -2, -3… */
function freshId(name: string, taken: readonly { id: string }[]) {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "") || "tag";
  let id = base,
    n = 2;
  while (taken.some((x) => x.id === id)) id = `${base}-${n++}`;
  return id;
}

type Tag = TagsDoc["tags"][number];
const setTagField = (d: TagsDoc, id: string, f: (t: Tag) => Tag): TagsDoc => ({ ...d, tags: d.tags.map((t) => (t.id === id ? f(t) : t)) });
const without = <K extends keyof Tag>(t: Tag, k: K): Tag => {
  const { [k]: _gone, ...rest } = t;
  return rest as Tag;
};

export const createTag = (d: TagsDoc, name: string, group?: string): TagsDoc =>
  name.trim() ? { ...d, tags: [...d.tags, { id: freshId(name, d.tags), name: name.trim(), ...(group ? { group } : {}) }] } : d;
export const renameTag = (d: TagsDoc, id: string, name: string): TagsDoc => (name.trim() ? setTagField(d, id, (t) => ({ ...t, name: name.trim() })) : d);
/** group "" or undefined = no group. */
export const setTagGroup = (d: TagsDoc, id: string, group?: string): TagsDoc => setTagField(d, id, (t) => (group ? { ...t, group } : without(t, "group")));
/** color: a token such as "s1".."s6" (the chart series colours); "" or undefined = none. */
export const setTagColor = (d: TagsDoc, id: string, color?: string): TagsDoc => setTagField(d, id, (t) => (color ? { ...t, color } : without(t, "color")));
/** Removes the tag and takes it off every transaction, so a new tag with the same id starts empty. */
export const deleteTag = (d: TagsDoc, id: string): TagsDoc => ({
  ...d,
  tags: d.tags.filter((t) => t.id !== id),
  on: Object.fromEntries(
    Object.entries(d.on)
      .map(([k, v]) => [k, v.filter((x) => x !== id)] as const)
      .filter(([, v]) => v.length),
  ),
});

export const createGroup = (d: TagsDoc, name: string): TagsDoc => (name.trim() ? { ...d, groups: [...d.groups, { id: freshId(name, d.groups), name: name.trim() }] } : d);
export const renameGroup = (d: TagsDoc, id: string, name: string): TagsDoc =>
  name.trim() ? { ...d, groups: d.groups.map((g) => (g.id === id ? { ...g, name: name.trim() } : g)) } : d;
/** Removes the group; its tags stay, ungrouped. */
export const deleteGroup = (d: TagsDoc, id: string): TagsDoc => ({
  ...d,
  groups: d.groups.filter((g) => g.id !== id),
  tags: d.tags.map((t) => (t.group === id ? without(t, "group") : t)),
});

/** Put the tag on (on = true) or take it off these transactions by hand. */
export function setTag(d: TagsDoc, ids: readonly string[], tag: string, on: boolean): TagsDoc {
  const next = { ...d.on };
  for (const id of ids) {
    const mine = on ? [...new Set([...(next[id] ?? []), tag])] : (next[id] ?? []).filter((x) => x !== tag);
    if (mine.length) next[id] = mine;
    else delete next[id];
  }
  return { ...d, on: next };
}

/** Ledger rows that carry the tag (by hand or from a rule). */
export const withTag = <T extends { tags?: readonly string[] | undefined }>(ts: readonly T[], tag: string): T[] => ts.filter((t) => t.tags?.includes(tag));
/** Tag name for an id ("" once the tag is deleted). */
export const tagName = (d: TagsDoc, id: string) => d.tags.find((t) => t.id === id)?.name ?? "";
