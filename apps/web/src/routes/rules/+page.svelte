<script lang="ts">
  // Rules editor: a draft of rules.csv, saved explicitly. Top to bottom, first match wins. Match counts and totals are live
  // against the draft; a count opens a preview of exactly which transactions that rule would catch (and "match nothing" lists
  // the rest), each one opening the transaction drawer.
  import { plOf } from "@openbooks/core";
  import type { Txn } from "@openbooks/schema";
  import { S, ent, catLabel, saveRules, mdy } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { PageHeader, Button, IconButton, Money, Search, Table, Drawer, EmptyState, type Column } from "#lib/ui/index.ts";
  import CategorySelect from "#lib/txns/CategorySelect.svelte";
  import TxnDrawer from "#lib/txns/TxnDrawer.svelte";
  import { ruleHits } from "#lib/txns/txns.ts";

  type R = { k: number; m: string; c: string };
  let seq = 0;
  let rules = $state<R[]>([]),
    dirty = $state(false),
    q = $state(""),
    /** preview: a rule's key, "none" for the unmatched rows, null = closed */
    peek = $state<number | "none" | null>(null);
  $effect(() => {
    if (!dirty) rules = (S.data?.rules ?? []).map(([m, c]) => ({ k: seq++, m, c: c.trim() }));
  });
  // a plain copy of the rows (not the store's deep proxies): the counts re-run on every keystroke in a rule
  const txns = $derived($state.snapshot(S.data?.txns ?? []) as Txn[]);
  const hits = $derived(ruleHits(rules, txns));
  const cur = $derived(ent().currency ?? "ILS");
  const shown = $derived.by(() => {
    const s = q.trim().toLowerCase();
    return s ? rules.filter((r) => `${r.m} ${catLabel(r.c)}`.toLowerCase().includes(s)) : rules;
  });
  const edit = (fn: () => void) => {
    fn();
    dirty = true;
  };
  const move = (i: number, d: number) =>
    edit(() => {
      const [r] = rules.splice(i, 1);
      if (r) rules.splice(i + d, 0, r);
    });
  async function save() {
    await saveRules(rules.map((r) => [r.m, r.c] as const));
    dirty = false;
  }

  const peekRule = $derived(typeof peek === "number" ? rules.find((r) => r.k === peek) : undefined);
  const peekIds = $derived.by(() => {
    if (peek === "none") return hits.none;
    const i = rules.findIndex((r) => r.k === peek);
    return i >= 0 ? (hits.h[i]?.ids ?? []) : [];
  });
  const peekRows = $derived.by(() => {
    const ids = new Set(peekIds);
    return txns.filter((x) => ids.has(x.id)).toReversed();
  });
  const PEEK_MAX = 300;

  const columns = $derived<Column<R>[]>([
    { key: "i", label: "#", class: "w-10 text-faint" },
    { key: "m", label: t("rules.contains"), class: "min-w-48" },
    { key: "c", label: t("common.ledgerAccount") },
    { key: "n", label: t("rules.matches"), numeric: true },
    { key: "sum", label: t("common.total"), numeric: true },
    { key: "act", label: t("rules34.actions"), hideLabel: true },
  ]);
</script>

<PageHeader title={t("rules.title")} sub={t("rules.sub")}>
  {#snippet actions()}
    {#if dirty}<Button variant="ghost" onclick={() => (dirty = false)}>{t("rules.discard")}</Button>{/if}
    <Button icon="plus" onclick={() => edit(() => rules.unshift({ k: seq++, m: "", c: "ask" }))}>{t("rules.new")}</Button>
    <Button variant="primary" onclick={save} disabled={!dirty}>{t("rules.save")}</Button>
  {/snippet}
  <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-line py-3">
    <span class="min-w-0 flex-1 basis-56 text-[14px] text-sub">
      {t("rules.count", { n: rules.length })} ·
      <button
        type="button"
        onclick={() => (peek = "none")}
        disabled={!hits.none.length}
        class="rounded underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50 disabled:no-underline {hits.none.length ? 'text-warn' : ''}"
        >{t(dirty ? "rules.unmatchedDirty" : "rules.unmatched", { n: hits.none.length })}</button>
    </span>
    <Search bind:value={q} label={t("rules.search")} class="w-full sm:w-64" />
  </div>
</PageHeader>

<div class="px-4 sm:px-8">
  {#if rules.length}
    <Table {columns} rows={shown} key={(r) => r.k} caption={t("rules.title")} class="panel">
      {#snippet cell(r, c)}
        {@const i = rules.indexOf(r)}
        {@const h = hits.h[i]}
        {#if c.key === "i"}
          <span class="num">{i + 1}</span>
        {:else if c.key === "m"}
          <input
            dir="auto"
            value={r.m}
            oninput={(e) => edit(() => (r.m = e.currentTarget.value))}
            placeholder={t("rules.placeholder")}
            aria-label="{t('rules.contains')} {i + 1}"
            class="ui-align -mx-2 h-8 w-full min-w-40 rounded-md bg-transparent px-2 text-ink outline-none placeholder:text-faint hover:bg-fill focus:bg-fill focus:ring-2 focus:ring-accent/50" />
        {:else if c.key === "c"}
          <CategorySelect value={r.c} onchange={(v) => edit(() => (r.c = v))} />
        {:else if c.key === "n"}
          {#if h?.n}
            <button
              type="button"
              onclick={() => (peek = r.k)}
              title={t("rules34.preview")}
              class="num rounded px-1 text-ink-2 underline decoration-line-strong underline-offset-2 outline-none hover:text-ink hover:decoration-current focus-visible:ring-2 focus-visible:ring-accent/50"
              >{h.n}</button>
          {:else}
            <span class="text-faint">0</span>
          {/if}
        {:else if c.key === "sum"}
          {#if h?.n}<Money value={h.sum} currency={cur} cents={false} class={plOf(r.c) === "revenue" ? "text-good" : ""} />{/if}
        {:else}
          <span class="inline-flex">
            <IconButton icon="chevron-up" size="sm" label={t("rules.moveUp")} disabled={i === 0} onclick={() => move(i, -1)} />
            <IconButton icon="chevron-down" size="sm" label={t("rules.moveDown")} disabled={i === rules.length - 1} onclick={() => move(i, 1)} />
            <IconButton icon="x" size="sm" label={t("common.remove")} onclick={() => edit(() => rules.splice(i, 1))} />
          </span>
        {/if}
      {/snippet}
    </Table>
  {:else}
    <EmptyState icon="rules" title={t("rules34.empty")} text={t("rules34.emptyText")} />
  {/if}
</div>

<Drawer
  open={peek !== null}
  width={480}
  title={peek === "none" ? t("rules34.unmatchedTitle") : t("rules34.previewTitle", { rule: peekRule?.m ?? "" })}
  onclose={() => (peek = null)}>
  <p class="px-4 pt-4 text-[13px] text-sub sm:px-5">
    {peek === "none" ? t("rules34.unmatchedHelp") : t("rules34.previewHelp", { cat: catLabel(peekRule?.c ?? "ask") })}
    {dirty ? t("rules34.draft") : ""}
  </p>
  <ul class="px-2 py-2 sm:px-3">
    {#each peekRows.slice(0, PEEK_MAX) as x (x.id)}
      <li>
        <button
          type="button"
          onclick={() => (S.drawer = x.id)}
          class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start text-[14px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50">
          <span class="min-w-0 flex-1">
            <span class="ui-align block text-ink [overflow-wrap:anywhere]" dir="auto">{x.who ?? x.desc}</span>
            <span class="block text-[12px] text-sub"><span class="num">{mdy(x.date)}</span> · {catLabel(x.category)}</span>
          </span>
          <Money value={x.amount} currency={cur} class={x.amount > 0 ? "text-good" : "text-ink"} />
        </button>
      </li>
    {/each}
  </ul>
  {#if peekRows.length > PEEK_MAX}<p class="px-4 pb-4 text-[13px] text-sub sm:px-5">{t("rules34.andMore", { n: peekRows.length - PEEK_MAX })}</p>{/if}
</Drawer>

<TxnDrawer />
