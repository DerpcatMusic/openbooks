<script lang="ts">
  // Tags: labels for transactions (set in the list, the drawer, in bulk, or by a rule's "Then add tag") that reports can filter by.
  // A tag may belong to a tag group (Projects, Clients…) and carry a colour. Everything is the doc "tags"; the edits are the pure
  // functions of @openbooks/core tags.ts, saved as a whole.
  import { createGroup, createTag, deleteGroup, deleteTag, renameGroup, renameTag, setTagColor, setTagGroup } from "@openbooks/core";
  import type { TagsDoc } from "@openbooks/schema";
  import { url } from "#lib/nav.ts";
  import { S, tagsDoc, saveTags } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Button, Card, EmptyState, IconButton, PageHeader, Select, Table, type Column } from "#lib/ui/index.ts";

  const d = $derived($state.snapshot(tagsDoc()) as TagsDoc);
  const save = (next: TagsDoc) => void saveTags(next);
  const counts = $derived.by(() => {
    const n = new Map<string, number>();
    for (const x of S.data?.txns ?? []) for (const g of x.tags ?? []) n.set(g, (n.get(g) ?? 0) + 1);
    return n;
  });
  let newTag = $state(""),
    newTagGroup = $state(""),
    newGroup = $state("");
  // names are how people pick tags (filters, rules), so two tags or groups can't share one
  const taken = (names: readonly { name: string }[], n: string) => names.some((x) => x.name.trim().toLowerCase() === n.trim().toLowerCase());
  const tagTaken = $derived(taken(d.tags, newTag));
  const groupTaken = $derived(taken(d.groups, newGroup));
  const GROUPS = $derived([{ value: "", label: t("tags.noGroup") }, ...d.groups.map((g) => ({ value: g.id, label: g.name }))]);
  const COLORS = $derived([{ value: "", label: t("tags.noColor") }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: `s${n}`, label: t("tags.colorN", { n }) }))]);
  const columns = $derived<Column<TagsDoc["tags"][number]>[]>([
    { key: "name", label: t("tags.tagName"), class: "min-w-40" },
    { key: "group", label: t("tags.group") },
    { key: "color", label: t("tags.color") },
    { key: "n", label: t("tags.used"), numeric: true },
    { key: "act", label: t("tags.actions"), hideLabel: true },
  ]);
  const input =
    "ui-align -mx-2 h-8 w-full min-w-32 rounded-md bg-transparent px-2 text-ink outline-none placeholder:text-faint hover:bg-fill focus:bg-fill focus:ring-2 focus:ring-accent/50";
  const field = "ui-align h-9 min-w-40 flex-1 rounded-lg border border-line-strong bg-panel px-3 text-[14px] text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/50";
  function addTag() {
    save(createTag(d, newTag, newTagGroup));
    newTag = "";
  }
  function addGroup() {
    save(createGroup(d, newGroup));
    newGroup = "";
  }
</script>

<svelte:head><title>{t("tags.title")} · OpenBooks</title></svelte:head>

<PageHeader title={t("tags.title")} sub={t("tags.sub")} />

<div class="max-w-3xl space-y-8 px-4 pt-5 pb-16 sm:px-8">
  <Card title={t("tags.tags")} flush>
    <div class="flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-5">
      <input
        bind:value={newTag}
        dir="auto"
        placeholder={t("tags.newTag")}
        aria-label={t("tags.newTag")}
        onkeydown={(e) => e.key === "Enter" && addTag()}
        class={field} />
      {#if d.groups.length}<Select variant="pill" label={t("tags.group")} bind:value={newTagGroup} options={GROUPS} />{/if}
      <Button variant="primary" icon="plus" onclick={addTag} disabled={!newTag.trim() || tagTaken}>{t("tags.add")}</Button>
    </div>
    {#if d.tags.length}
      <Table {columns} rows={d.tags} key={(g) => g.id} caption={t("tags.tags")} class="border-t border-line">
        {#snippet cell(g, c)}
          {#if c.key === "name"}
            <input
              dir="auto"
              value={g.name}
              aria-label={t("tags.tagName")}
              onchange={(e) => (e.currentTarget.value.trim() ? save(renameTag(d, g.id, e.currentTarget.value)) : (e.currentTarget.value = g.name))}
              class={input} />
          {:else if c.key === "group"}
            <Select variant="pill" label={t("tags.group")} value={g.group ?? ""} options={GROUPS} onchange={(v) => save(setTagGroup(d, g.id, v))} />
          {:else if c.key === "color"}
            <span class="inline-flex items-center gap-2">
              {#if g.color}<span class="size-2.5 rounded-full" style:background="var(--color-{g.color})"></span>{/if}
              <Select variant="pill" label={t("tags.color")} value={g.color ?? ""} options={COLORS} onchange={(v) => save(setTagColor(d, g.id, v))} />
            </span>
          {:else if c.key === "n"}
            {#if counts.get(g.id)}
              <a
                href={url(`/transactions/tag:${encodeURIComponent(g.id)}`)}
                class="num rounded px-1 text-ink-2 underline decoration-line-strong underline-offset-2 outline-none hover:text-ink hover:decoration-current focus-visible:ring-2 focus-visible:ring-accent/50"
                >{counts.get(g.id)}</a>
            {:else}
              <span class="text-faint">0</span>
            {/if}
          {:else}
            <IconButton icon="x" size="sm" label={t("tags.delete")} onclick={() => save(deleteTag(d, g.id))} />
          {/if}
        {/snippet}
      </Table>
    {:else}
      <EmptyState icon="tag" title={t("tags.empty")} text={t("tags.emptyText")} />
    {/if}
  </Card>

  <Card title={t("tags.groups")} description={t("tags.groupsHint")}>
    <div class="flex flex-wrap items-center gap-2">
      <input
        bind:value={newGroup}
        dir="auto"
        placeholder={t("tags.newGroup")}
        aria-label={t("tags.newGroup")}
        onkeydown={(e) => e.key === "Enter" && addGroup()}
        class={field} />
      <Button icon="plus" onclick={addGroup} disabled={!newGroup.trim() || groupTaken}>{t("tags.addGroup")}</Button>
    </div>
    <ul class="mt-3 divide-y divide-line">
      {#each d.groups as g (g.id)}
        <li class="flex items-center gap-2 py-1.5">
          <input
            dir="auto"
            value={g.name}
            aria-label={t("tags.groupName")}
            onchange={(e) => (e.currentTarget.value.trim() ? save(renameGroup(d, g.id, e.currentTarget.value)) : (e.currentTarget.value = g.name))}
            class="{input} flex-1" />
          <span class="text-[13px] text-sub">{t("tags.inGroup", { n: d.tags.filter((o) => o.group === g.id).length })}</span>
          <IconButton icon="x" size="sm" label={t("tags.deleteGroup")} onclick={() => save(deleteGroup(d, g.id))} />
        </li>
      {/each}
    </ul>
  </Card>
</div>
