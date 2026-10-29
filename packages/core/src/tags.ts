// Tags (doc "tags"): tags with an optional tag group and colour, and the tags each transaction carries by hand. Pure: every function
// returns the new doc. Rules add tags on top at read time (ledger.ts), so editing a rule retags at once; ids of deleted tags are ignored there.
// A transaction holds at most one tag per tag group: tagging with a second one from the same group replaces the first (setTag), and when
// hand-made, rule and split-line tags meet on read (pickByGroup) the nearest to the user wins: line, then hand, then the earliest rule.
import type { TagsDoc, TagTax } from "@openbooks/schema";
import { baseId } from "./splits.ts";

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

export const createTag = (d: TagsDoc, name: string, group?: string, tax?: TagTax): TagsDoc =>
  name.trim() ? { ...d, tags: [...d.tags, { id: freshId(name, d.tags), name: name.trim(), ...(group ? { group } : {}), ...(tax && Object.keys(tax).length ? { tax } : {}) }] } : d;
export const renameTag = (d: TagsDoc, id: string, name: string): TagsDoc => (name.trim() ? setTagField(d, id, (t) => ({ ...t, name: name.trim() })) : d);
/** group "" or undefined = no group. */
export const setTagGroup = (d: TagsDoc, id: string, group?: string): TagsDoc => setTagField(d, id, (t) => (group ? { ...t, group } : without(t, "group")));
/** color: a token such as "s1".."s6" (the chart series colours); "" or undefined = none. */
export const setTagColor = (d: TagsDoc, id: string, color?: string): TagsDoc => setTagField(d, id, (t) => (color ? { ...t, color } : without(t, "color")));
/** The tag's tax meaning (Taxximizer): { rule, pct, note }; empty or undefined clears it. */
export const setTagTax = (d: TagsDoc, id: string, tax?: TagTax): TagsDoc =>
  setTagField(d, id, (t) => {
    const clean = Object.fromEntries(Object.entries(tax ?? {}).filter(([, v]) => v !== undefined && v !== "")) as TagTax;
    return Object.keys(clean).length ? { ...t, tax: clean } : without(t, "tax");
  });
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
/** Removes the group and its tags (taken off every transaction too). */
export const deleteGroup = (d: TagsDoc, id: string): TagsDoc =>
  d.tags.filter((t) => t.group === id).reduce<TagsDoc>((acc, t) => deleteTag(acc, t.id), { ...d, groups: d.groups.filter((g) => g.id !== id) });

/** Deactivate (false) or reactivate (true) a tag. An inactive tag can't be added to anything new but stays where it already is. */
export const setTagActive = (d: TagsDoc, id: string, active: boolean): TagsDoc =>
  setTagField(d, id, (t) => (active ? without(t, "inactive") : { ...t, inactive: true }));
/** Tags that pickers offer. */
export const activeTags = (d: TagsDoc) => d.tags.filter((t) => !t.inactive);

/** tag id → its group id (undefined = no group). */
export const groupMap = (d: TagsDoc | undefined): ReadonlyMap<string, string | undefined> => new Map(d?.tags.map((t) => [t.id, t.group]) ?? []);
/**
 * Of tag ids in priority order (best first), the ones that survive "one tag per group": the first of each group; tags without a group
 * (or whose tag is unknown) all stay.
 */
export function pickByGroup(groups: ReadonlyMap<string, string | undefined>, best: readonly string[]): Set<string> {
  const seen = new Set<string>(),
    keep = new Set<string>();
  for (const id of best) {
    const g = groups.get(id);
    if (g) {
      if (seen.has(g)) continue;
      seen.add(g);
    }
    keep.add(id);
  }
  return keep;
}

/**
 * Put the tag on (on = true) or take it off these transactions by hand. Putting it on drops any other tag of its group from the
 * transaction (the newest pick wins); an inactive or unknown tag is not added. Ids of split rows (`id~1`) mean their transaction.
 */
export function setTag(d: TagsDoc, ids: readonly string[], tag: string, on: boolean): TagsDoc {
  const t = d.tags.find((x) => x.id === tag);
  if (on && (!t || t.inactive)) return d;
  const sameGroup = new Set(t?.group ? d.tags.filter((x) => x.group === t.group).map((x) => x.id) : [tag]);
  const next = { ...d.on };
  for (const raw of ids) {
    const id = baseId(raw);
    const cur = next[id] ?? [],
      mine = on ? (cur.includes(tag) ? cur.filter((x) => x === tag || !sameGroup.has(x)) : [...cur.filter((x) => !sameGroup.has(x)), tag]) : cur.filter((x) => x !== tag);
    if (mine.length) next[id] = mine;
    else delete next[id];
  }
  return { ...d, on: next };
}

/** Ledger rows that carry the tag (by hand or from a rule). */
export const withTag = <T extends { tags?: readonly string[] | undefined }>(ts: readonly T[], tag: string): T[] => ts.filter((t) => t.tags?.includes(tag));
/** Tag name for an id ("" once the tag is deleted). */
export const tagName = (d: TagsDoc, id: string) => d.tags.find((t) => t.id === id)?.name ?? "";
