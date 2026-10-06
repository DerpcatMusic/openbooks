<script lang="ts">
  // Everyone you've dealt with, every year (transfers left out). Setting a counterparty's ledger account writes a rule when the
  // rows share text, so future imports follow it. /counterparties/<name> or ?q=<name> opens with that search (the drawer links here).
  import { page } from "$app/state";
  import { payers, suggestRule } from "@openbooks/core";
  import type { Txn } from "@openbooks/schema";
  import { S, ent, catLabel, classify, toast, mdy } from "#lib/stores/books.svelte.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { PageHeader, Tabs, Search, Money, Table, EmptyState, type Column } from "#lib/ui/index.ts";
  import CategorySelect from "#lib/txns/CategorySelect.svelte";
  import More from "#lib/txns/More.svelte";

  type P = ReturnType<typeof payers>[number];
  const PAGE = 100;
  let tab = $state("all"),
    q = $state(""),
    limit = $state(PAGE);
  $effect(() => {
    q = page.params.q || page.url.searchParams.get("q") || "";
  });
  $effect(() => {
    void [tab, q];
    limit = PAGE;
  });

  const cur = $derived(ent().currency ?? "ILS");
  const all = $derived(payers(($state.snapshot(S.data?.txns ?? []) as Txn[]).filter((x) => !x.category.startsWith("transfer:") && x.source !== "journal")));
  const hasOut = $derived(all.some((p) => p.out));
  const list = $derived.by(() => {
    const s = q.trim().toLowerCase();
    return all.filter(
      (p) =>
        (tab === "all" || (tab === "in" && p.in > p.out) || (tab === "out" && p.out >= p.in) || (tab === "ask" && p.cats.includes("ask"))) &&
        (!s || p.key.toLowerCase().includes(s)),
    );
  });
  const TABS = $derived([
    { key: "all", label: t("counterparties.all"), count: all.length },
    ...(hasOut ? [{ key: "in", label: t("counterparties.customers") }, { key: "out", label: t("counterparties.vendors") }] : []),
    { key: "ask", label: t("common.uncategorized"), count: all.filter((p) => p.cats.includes("ask")).length },
  ]);

  async function set(p: P, category: string) {
    const rule = suggestRule(p.ts);
    await classify(
      p.ts.map((x) => x.id),
      category,
      rule || undefined,
    );
    toast(
      rule
        ? t("counterparties.ruleSet", { rule: bidi(rule), cat: bidi(catLabel(category)) })
        : t("counterparties.noRuleSet", { n: p.ts.length, cat: bidi(catLabel(category)) }),
    );
  }
  const columns = $derived<Column<P>[]>([
    { key: "who", label: t("counterparties.col"), wrap: true },
    { key: "cat", label: t("common.ledgerAccount") },
    { key: "n", label: t("counterparties.txns"), numeric: true },
    { key: "last", label: t("counterparties.last"), class: "text-sub" },
    { key: "in", label: t("common.moneyIn"), numeric: true },
    ...(hasOut ? [{ key: "out", label: t("common.moneyOut"), numeric: true }] : []),
  ]);
  const ruleBits = () => t("counterparties.rule").split("{rule}");
</script>

<PageHeader title={t("counterparties.title")} sub={t("counterparties.sub")}>
  <Tabs items={TABS} bind:value={tab} label={t("counterparties.title")} class="mt-2" />
  <div class="flex flex-wrap items-center gap-2 py-3">
    <span class="min-w-0 flex-1 text-[14px] whitespace-nowrap text-sub">{t("counterparties.count", { n: list.length })}</span>
    <Search bind:value={q} label={t("counterparties.search")} class="w-full sm:w-64" />
  </div>
</PageHeader>

{#if list.length}
  <div class="px-4 sm:px-8">
    <Table {columns} rows={list.slice(0, limit)} key={(p) => p.key} caption={t("counterparties.title")} class="panel">
      {#snippet cell(p, c)}
        {#if c.key === "who"}
          <div class="ui-align text-ink [overflow-wrap:anywhere]" dir="auto">{p.key}</div>
          <div class="text-[12px] text-sub">
            {#if p.cats.length > 1}{t("counterparties.mixedAccounts")}{:else if p.why === "manual"}{t("counterparties.manual")}{:else if p.why}{@const [a, b] = ruleBits()}{a}<bdi
                >{p.why}</bdi
              >{b}{:else}{t("counterparties.noRule")}{/if}
            · <span class="num">{p.years.join(", ")}</span>
          </div>
        {:else if c.key === "cat"}
          <CategorySelect value={p.cats.length === 1 ? p.cats[0] : ""} placeholder={p.cats.length > 1 ? t("counterparties.mixed") : undefined} onchange={(cat) => set(p, cat)} />
        {:else if c.key === "n"}
          <span class="text-sub">{p.ts.length}</span>
        {:else if c.key === "last"}
          <span class="num">{mdy(p.last)}</span>
        {:else if c.key === "in"}
          {#if p.in}<Money value={p.in} currency={cur} class="text-good" />{:else}<span class="text-faint">—</span>{/if}
        {:else if p.out}
          <Money value={p.out} currency={cur} />
        {:else}
          <span class="text-faint">—</span>
        {/if}
      {/snippet}
    </Table>
    <More shown={Math.min(limit, list.length)} total={list.length} onmore={() => (limit += PAGE)} />
  </div>
{:else}
  <EmptyState icon="users" title={t("counterparties.empty")} text={q ? t("counterparties.noMatch", { q: bidi(q) }) : ""} />
{/if}
