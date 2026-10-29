<script lang="ts">
  // Tags: labels for transactions (set in the list, the drawer, in bulk, or by a rule's "Then add tag") that reports can filter by.
  // A tag may belong to a tag group (Projects, Clients…) and carry a colour. Everything is the doc "tags"; the edits are the pure
  // functions of @openbooks/core tags.ts, saved as a whole. A transaction holds one tag per group; a tag can be deactivated (kept on
  // what already carries it, hidden from pickers) and reactivated; deleting a group deletes its tags, after a confirmation.
  import { createGroup, createTag, deleteGroup, deleteTag, renameGroup, renameTag, setTagActive, setTagColor, setTagGroup, setTagTax } from "@openbooks/core";
  import type { TagsDoc } from "@openbooks/schema";
  import { url } from "#lib/nav.ts";
  import { S, tagsDoc, saveTags, toast } from "#lib/stores/books.svelte.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { addPreset, hasRules, presets, ruleName, ruleOf } from "#lib/taxtags.svelte.ts";
  import { Badge, Button, Card, Dialog, EmptyState, IconButton, PageHeader, Select, Table, type Column } from "#lib/ui/index.ts";
  import TaxPicker from "./TaxPicker.svelte";

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
    ...(hasRules() ? [{ key: "tax", label: t("taxtags.col"), class: "min-w-48" }] : []),
    { key: "status", label: t("gaps2.tag.status") },
    { key: "n", label: t("tags.used"), numeric: true },
    { key: "act", label: t("tags.actions"), hideLabel: true },
  ]);
  // confirmations: deleting a group takes its tags with it, deleting a tag takes it off every transaction
  let dropGroup = $state<TagsDoc["groups"][number] | null>(null),
    dropTag = $state<TagsDoc["tags"][number] | null>(null),
    groupOpen = $state(false),
    tagOpen = $state(false);
  const inGroup = (id: string) => d.tags.filter((o) => o.group === id);
  const usedBy = (ids: readonly string[]) => (S.data?.txns ?? []).filter((x) => x.tags?.some((g) => ids.includes(g))).length;
  function confirmGroup() {
    if (dropGroup) save(deleteGroup(d, dropGroup.id));
    groupOpen = false;
  }
  function confirmTag() {
    if (dropTag) save(deleteTag(d, dropTag.id));
    tagOpen = false;
  }
  function toggleActive(g: TagsDoc["tags"][number]) {
    save(setTagActive(d, g.id, !!g.inactive));
    toast(t(g.inactive ? "gaps2.tag.reactivated" : "gaps2.tag.deactivated", { tag: bidi(g.name) }));
  }
  const input =
    "ui-align -mx-2 h-8 w-full min-w-32 rounded-md bg-transparent px-2 text-ink outline-none placeholder:text-faint hover:bg-fill focus:bg-fill focus:ring-2 focus:ring-accent/50";
  const field = "ui-align h-9 min-w-40 flex-1 rounded-lg border border-line-strong bg-panel px-3 text-[14px] text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/50";
  // tax treatment: the picker edits one tag's tax = { rule, pct, note }
  let picking = $state<TagsDoc["tags"][number] | null>(null),
    pickerOpen = $state(false);
  const effect = (tax: NonNullable<TagsDoc["tags"][number]["tax"]>) => {
    const r = ruleOf(tax.rule),
      p = r?.incomeTaxPct === null ? tax.pct : r ? (r.incomeTaxPct * (tax.pct ?? 100)) / 100 : tax.pct;
    return p === undefined ? null : +p.toFixed(2);
  };
  function addPresetTag(p: ReturnType<typeof presets>[number]) {
    const name = t(`taxtags.preset.${p.key}`);
    if (addPreset(p, name)) toast(t("taxtags.presetAdded", { name: bidi(name) }));
  }
  function addTag() {
    save(createTag(d, newTag, newTagGroup));
    newTag = "";
  }
  function addGroup() {
    save(createGroup(d, newGroup));
    newGroup = "";
  }
</script>

{#snippet cellOf(g: TagsDoc["tags"][number], k: string)}
  {#if k === "name"}
    <input
      dir="auto"
      value={g.name}
      aria-label={t("tags.tagName")}
      onchange={(e) => (e.currentTarget.value.trim() ? save(renameTag(d, g.id, e.currentTarget.value)) : (e.currentTarget.value = g.name))}
      class="{input} {g.inactive ? 'text-sub' : ''}" />
  {:else if k === "group"}
    <Select variant="pill" label={t("tags.group")} value={g.group ?? ""} options={GROUPS} onchange={(v) => save(setTagGroup(d, g.id, v))} />
  {:else if k === "color"}
    <span class="inline-flex items-center gap-2">
      {#if g.color}<span class="size-2.5 rounded-full" style:background="var(--color-{g.color})"></span>{/if}
      <Select variant="pill" label={t("tags.color")} value={g.color ?? ""} options={COLORS} onchange={(v) => save(setTagColor(d, g.id, v))} />
    </span>
  {:else if k === "tax"}
    <button
      type="button"
      onclick={() => ((picking = g), (pickerOpen = true))}
      class="-mx-2 flex w-full min-w-0 flex-col items-start gap-1 rounded-md px-2 py-1 text-start outline-none hover:bg-fill focus-visible:ring-2 focus-visible:ring-accent/50"
      aria-label={t("taxtags.editFor", { tag: g.name })}>
      {#if g.tax}
        {@const e = effect(g.tax)}
        <span class="text-[13px] text-ink-2 [overflow-wrap:anywhere]" dir="auto">{g.tax.rule ? ruleName(g.tax.rule) : t("taxtags.noRule")}</span>
        <span class="flex flex-wrap items-center gap-1">
          {#if e !== null}<Badge size="sm" tone={e >= 100 ? "good" : e > 0 ? "accent" : "bad"}>{t("taxtags.effective", { pct: `${e}%` })}</Badge>{:else}<Badge size="sm" tone="warn">{t("taxtags.pctNeededShort")}</Badge>{/if}
          {#if g.tax.rule && g.tax.pct !== undefined}<Badge size="sm">{t("taxtags.useBadge", { pct: `${g.tax.pct}%` })}</Badge>{/if}
        </span>
      {:else}
        <span class="text-[13px] text-faint">{t("taxtags.none")}</span>
      {/if}
    </button>
  {:else if k === "status"}
    <Badge size="sm" tone={g.inactive ? "neutral" : "good"}>{g.inactive ? t("gaps2.tag.inactive") : t("gaps2.tag.active")}</Badge>
  {:else if k === "n"}
    {#if counts.get(g.id)}
      <a
        href={url(`/transactions/tag:${encodeURIComponent(g.id)}`)}
        class="num rounded px-1 text-ink-2 underline decoration-line-strong underline-offset-2 outline-none hover:text-ink hover:decoration-current focus-visible:ring-2 focus-visible:ring-accent/50"
        >{counts.get(g.id)}</a>
    {:else}
      <span class="text-faint">0</span>
    {/if}
  {:else}
    <span class="inline-flex items-center gap-1">
      <Button size="sm" variant="ghost" onclick={() => toggleActive(g)} title={t(g.inactive ? "gaps2.tag.reactivateHint" : "gaps2.tag.deactivateHint")}>{g.inactive ? t("gaps2.tag.reactivate") : t("gaps2.tag.deactivate")}</Button>
      <IconButton icon="x" size="sm" label={t("tags.delete")} onclick={() => (counts.get(g.id) ? ((dropTag = g), (tagOpen = true)) : save(deleteTag(d, g.id)))} />
    </span>
  {/if}
{/snippet}

<PageHeader title={t("tags.title")} sub={t("tags.sub")} />

<div class="{hasRules() ? 'max-w-5xl' : 'max-w-3xl'} space-y-8 px-4 pt-5 pb-16 sm:px-8">
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
      <Table {columns} rows={d.tags} key={(g) => g.id} caption={t("tags.tags")} class="border-t border-line max-sm:hidden">
        {#snippet cell(g, c)}{@render cellOf(g, c.key)}{/snippet}
      </Table>
      <!-- phones: one card per tag (a 7-column table would scroll sideways and hide Status and Deactivate) -->
      <ul class="divide-y divide-line border-t border-line sm:hidden" aria-label={t("tags.tags")}>
        {#each d.tags as g (g.id)}
          <li class="space-y-2 px-4 py-3">
            <div class="flex items-center gap-2">
              <div class="min-w-0 flex-1">{@render cellOf(g, "name")}</div>
              {@render cellOf(g, "status")}
            </div>
            <div class="flex flex-wrap items-center gap-2">{@render cellOf(g, "group")}{@render cellOf(g, "color")}</div>
            {#if hasRules()}<div><div class="text-[12px] text-sub">{t("taxtags.col")}</div>{@render cellOf(g, "tax")}</div>{/if}
            <div class="flex items-center justify-between gap-2">
              <span class="text-[13px] text-sub">{t("tags.used")} {@render cellOf(g, "n")}</span>
              {@render cellOf(g, "act")}
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <EmptyState icon="tag" title={t("tags.empty")} text={t("tags.emptyText")} />
    {/if}
  </Card>

  {#if hasRules() && presets().length}
    <Card title={t("taxtags.presets")} description={t("taxtags.presetsHint")}>
      <div class="flex flex-wrap gap-2">
        {#each presets() as p (p.key)}
          {@const name = t(`taxtags.preset.${p.key}`)}
          <Button size="sm" icon="plus" onclick={() => addPresetTag(p)} disabled={taken(d.tags, name)} title={taken(d.tags, name) ? t("taxtags.presetHave") : (p.rule ? ruleName(p.rule) : "")}>
            {name}
            {#if p.rule}
              {@const r = ruleOf(p.rule)}
              {#if r && r.incomeTaxPct !== null}<span class="num text-sub">{r.incomeTaxPct}%</span>{/if}
            {:else}<span class="num text-sub">0%</span>{/if}
          </Button>
        {/each}
      </div>
      <p class="mt-3 text-[12px] text-faint">{t("taxtags.presetsNote")}</p>
    </Card>
  {/if}

  <Card title={t("tags.groups")} description={`${t("tags.groupsHint")} ${t("gaps2.tag.onePerGroup")}`}>
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
          <IconButton icon="x" size="sm" label={t("tags.deleteGroup")} onclick={() => ((dropGroup = g), (groupOpen = true))} />
        </li>
      {/each}
    </ul>
  </Card>
</div>

<Dialog bind:open={groupOpen} title={t("gaps2.group.deleteTitle", { name: dropGroup?.name ?? "" })} description={t("gaps2.group.deleteHelp")} size="sm">
  {#if dropGroup}
    {@const ts = inGroup(dropGroup.id)}
    <p>{ts.length ? t("gaps2.group.deleteTags", { n: ts.length, uses: usedBy(ts.map((o) => o.id)) }) : t("gaps2.group.deleteEmpty")}</p>
    {#if ts.length}<p class="mt-2 flex flex-wrap gap-1.5">{#each ts as o (o.id)}<Badge>{o.name}</Badge>{/each}</p>{/if}
  {/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (groupOpen = false)}>{t("common.cancel")}</Button>
    <Button variant="primary" class="!bg-bad" onclick={confirmGroup}>{t("gaps2.group.deleteConfirm")}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={tagOpen} title={t("gaps2.tag.deleteTitle", { name: dropTag?.name ?? "" })} description={t("gaps2.tag.deleteHelp")} size="sm">
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (tagOpen = false)}>{t("common.cancel")}</Button>
    <Button variant="primary" class="!bg-bad" onclick={confirmTag}>{t("gaps2.tag.deleteConfirm")}</Button>
  {/snippet}
</Dialog>

<TaxPicker bind:open={pickerOpen} tag={picking} onsave={(tax) => picking && save(setTagTax(d, picking.id, tax))} />
