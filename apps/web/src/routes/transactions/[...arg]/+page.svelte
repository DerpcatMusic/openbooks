<script lang="ts">
  // Transactions of the selected period: tabs (all / in / out / needs review), month, bank account and ledger filters, search,
  // per-row ledger account, bulk categorize (shift-click ranges, "select similar"), CSV export. A row opens the drawer.
  // /transactions/<arg> or /transactions?q=<arg> seeds the filters: ask | month:2026-04 | cat:expense:software | type:own |
  // account:Mercury Credit; any other ?q= text becomes the search.
  // Long lists render 100 rows at a time and grow as you scroll, so thousands of rows stay fast.
  import { page } from "$app/state";
  import { goto } from "#lib/nav.ts";
  import { tick } from "svelte";
  import { TYPES, group, inPeriod, payerOf, suggestRule } from "@openbooks/core";
  import type { Txn } from "@openbooks/schema";
  import { S, ent, accounts, catLabel, catGroups, typeLabel, classify, toast, suggest, mdy, period, periodLabel } from "#lib/stores/books.svelte.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { PageHeader, Tabs, Select, Search, Button, Money, Icon, Table, EmptyState, type Column, type SelectGroup } from "#lib/ui/index.ts";
  import CategorySelect from "#lib/txns/CategorySelect.svelte";
  import TxnDrawer from "#lib/txns/TxnDrawer.svelte";
  import More from "#lib/txns/More.svelte";
  import { parseArg, inTab, inCat, searchText, toCsv, range, type Tab } from "#lib/txns/txns.ts";

  const PAGE = 100;
  let tab = $state<Tab>("all"),
    cat = $state(""),
    acct = $state(""),
    month = $state(""),
    q = $state(""),
    limit = $state(PAGE),
    sel = $state(new Set<string>()),
    last: string | null = null;

  // filters from the URL (also when another screen links here while this page is open)
  $effect(() => {
    const a = page.params.arg || page.url.searchParams.get("q") || "",
      f = parseArg(a);
    // anything that isn't a filter (?q=coffee) is a search
    q = /^(ask|(month|cat|type|account):)/.test(a) ? "" : a;
    tab = f.tab;
    cat = f.cat;
    acct = f.acct;
    month = f.month;
  });

  const cur = $derived(ent().currency ?? "ILS");
  // plain copies, not the store's deep-reactive proxies: filtering thousands of rows per keystroke stays cheap
  const all = $derived($state.snapshot(S.data?.txns ?? []) as Txn[]);
  const yearTx = $derived.by(() => {
    const p = period();
    return all.filter((x) => inPeriod(x, p));
  });
  const scope = $derived(month ? yearTx.filter((x) => x.date.startsWith(month)) : yearTx);
  const counts = $derived.by(() => {
    let i = 0,
      o = 0,
      a = 0;
    for (const x of scope) {
      if (x.amount > 0) i++;
      else if (x.amount < 0) o++;
      if (x.category === "ask") a++;
    }
    return { all: scope.length, in: i, out: o, ask: a };
  });
  const TABS = $derived([
    { key: "all", label: t("txns.tab.all"), count: counts.all },
    ...(counts.out ? [{ key: "in", label: t("common.moneyIn") }, { key: "out", label: t("common.moneyOut") }] : []),
    { key: "ask", label: t("txns.tab.ask"), count: counts.ask },
  ]);
  // search text per row, built once per state/language rather than per keystroke
  const hay = $derived(new Map(all.map((x) => [x.id, searchText(x, catLabel(x.category))])));
  const rows = $derived.by(() => {
    const s = q.trim().toLowerCase();
    return scope.filter((x) => inTab(x, tab) && inCat(x, cat) && (!acct || x.account === acct) && (!s || hay.get(x.id)?.includes(s))).toReversed();
  });
  const shown = $derived(rows.slice(0, limit));
  // nothing here: which other tax years have matches (Review's "table view" links here with every year's uncategorized rows)
  const elsewhere = $derived.by(() => {
    if (rows.length) return [];
    const s = q.trim().toLowerCase(),
      ys = new Set<number>();
    for (const x of all) if (inTab(x, tab) && inCat(x, cat) && (!acct || x.account === acct) && (!s || hay.get(x.id)?.includes(s))) ys.add(+x.date.slice(0, 4));
    ys.delete(S.year);
    return [...ys].sort((a, b) => b - a).slice(0, 3);
  });
  const total = $derived(rows.reduce((a, x) => a + x.amount, 0));
  const multi = $derived(accounts().length > 1);

  // a narrow tab strip scrolls: keep the active tab in view (e.g. "Needs review" from /transactions/ask on a phone)
  $effect(() => {
    void [tab, TABS.length];
    void tick().then(() => document.querySelector('[data-ui="tabs"] [role="tab"][aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  });
  // back to the first page whenever the filters change
  $effect(() => {
    void [tab, cat, acct, month, q];
    limit = PAGE;
  });

  // ---------- selection ----------
  const selected = $derived(rows.filter((x) => sel.has(x.id)));
  const allOn = $derived(rows.length > 0 && selected.length === rows.length);
  // the same counterparty as anything selected, within the current filters
  const similar = $derived.by(() => {
    if (!selected.length) return [];
    const ks = new Set(selected.map(payerOf));
    return rows.filter((x) => ks.has(payerOf(x)));
  });
  function toggle(x: Txn, e: MouseEvent) {
    const s = new Set(sel),
      on = !s.has(x.id),
      ids = e.shiftKey
        ? range(
            rows.map((r) => r.id),
            last,
            x.id,
          )
        : [x.id];
    for (const id of ids) {
      if (on) s.add(id);
      else s.delete(id);
    }
    last = x.id;
    sel = s;
  }
  const clear = () => {
    sel = new Set();
    last = null;
  };

  async function apply(ts: readonly Txn[], category: string) {
    const ids = ts.map((x) => x.id);
    await classify(ids, category);
    clear();
    toast(t("txns.toast.applied", { n: ts.length, cat: bidi(catLabel(category)) }), {
      label: t("txns.createRule"),
      value: suggestRule(ts),
      run: (m) => void (m.trim() && classify(ids, category, m.trim())),
    });
  }

  // ---------- filters ----------
  // one picker for the tax year (the store's S.year, shared with every screen) and a month inside the period
  const PERIODS = $derived.by((): SelectGroup[] => [
    {
      label: t("txn34.year"),
      options: [...(S.period ? [{ value: "", label: periodLabel() }] : []), ...(S.data?.years ?? []).toReversed().map((y) => ({ value: `y:${y}`, label: String(y) }))],
    },
    {
      label: t("txns.filter.month"),
      options: [...new Set(yearTx.map((x) => x.date.slice(0, 7)))].reverse().map((m) => ({ value: m, label: periodLabel({ from: m, to: m }) })),
    },
  ]);
  const periodValue = $derived(month || (S.period ? "" : `y:${S.year}`));
  function setPeriod(v: string) {
    if (v.startsWith("y:")) {
      S.year = +v.slice(2);
      S.period = null;
      month = "";
    } else month = v;
  }
  const ACCTS = $derived([{ value: "", label: t("txns.allAccounts") }, ...accounts().map((a) => ({ value: a, label: a }))]);
  const LEDGER = $derived.by((): SelectGroup[] => {
    const used = new Set(all.map((x) => group(x.category)));
    return [
      {
        label: t("txns.accountTypes"),
        options: [{ value: "", label: t("txns.allLedger") }, ...Object.keys(TYPES).filter((g) => used.has(g)).map((g) => ({ value: `type:${g}`, label: typeLabel(g) }))],
      },
      ...catGroups(),
    ];
  });

  function exportCsv() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toCsv(rows, catLabel)], { type: "text/csv;charset=utf-8" }));
    a.download = "transactions.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const columns = $derived<Column<Txn>[]>([
    { key: "sel", label: t("txn34.selectCol"), hideLabel: true, class: "w-10" },
    { key: "date", label: t("common.date"), class: "text-sub" },
    ...(multi ? [{ key: "account", label: t("common.account"), class: "text-sub max-sm:hidden" }] : []),
    { key: "cat", label: t("common.ledgerAccount") },
    { key: "desc", label: t("common.description"), wrap: true },
    { key: "amount", label: t("common.amount"), numeric: true },
  ]);
  const why = (x: Txn) => (x.why === "manual" ? t("txns.why.manual") : x.why ? t("txns.why.rule", { rule: bidi(x.why) }) : t("txns.why.none"));
</script>

<PageHeader title={t("nav.transactions")}>
  {#snippet actions()}
    {#if counts.ask}<Button variant="primary" icon="sparkle" href="/review">{t("txns.review", { n: counts.ask })}</Button>{/if}
    <Button icon="download" onclick={exportCsv} disabled={!rows.length}>{t("common.export")}</Button>
  {/snippet}
  <Tabs items={TABS} bind:value={tab} label={t("nav.transactions")} class="mt-2" onchange={clear} />
  <div class="flex flex-wrap items-center gap-2 py-3">
    <Select variant="pill" icon="calendar" label={t("txns.filter.month")} value={periodValue} groups={PERIODS} onchange={setPeriod} />
    {#if multi}<Select variant="pill" icon="bank" label={t("txns.filter.account")} bind:value={acct} options={ACCTS} />{/if}
    <Select variant="pill" icon="filter" label={t("txns.filter.ledger")} bind:value={cat} groups={LEDGER} />
    <Search bind:value={q} label={t("common.search")} class="ms-auto w-full sm:w-64" />
  </div>
</PageHeader>

{#if rows.length}
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2 text-[14px] text-sub sm:px-8">
    <label class="flex min-h-8 cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={allOn}
        indeterminate={!!selected.length && !allOn}
        onchange={() => (allOn ? clear() : (sel = new Set(rows.map((x) => x.id))))}
        class="size-4 shrink-0 cursor-pointer accent-accent" />
      {t("txns.selectAll")}
    </label>
    <span class="ms-auto num">{t("common.transactions", { n: rows.length })} · <Money value={total} currency={cur} /></span>
  </div>
  <div class="px-4 sm:px-8">
    <Table {columns} rows={shown} key={(x) => x.id} caption={t("nav.transactions")} onrowclick={(x) => (S.drawer = x.id)} selected={(x) => sel.has(x.id)} class="panel">
      {#snippet cell(x, c)}
        {#if c.key === "sel"}
          <input
            type="checkbox"
            checked={sel.has(x.id)}
            onclick={(e) => {
              e.stopPropagation();
              toggle(x, e);
            }}
            onkeydown={(e) => e.stopPropagation()}
            aria-label={t("txns.select", { desc: x.who ?? x.desc })}
            class="size-4 cursor-pointer align-middle accent-accent" />
        {:else if c.key === "date"}
          <span class="num">{mdy(x.date)}</span>
        {:else if c.key === "account"}
          <span dir="auto">{x.account}</span>
        {:else if c.key === "cat"}
          <span class="flex items-center gap-1.5">
            <span title={why(x)} class="shrink-0 text-faint"><Icon name={x.why === "manual" ? "user" : x.why ? "rules" : "alert"} size={13} /></span>
            {#if x.source === "journal"}
              <span class="text-ink-2">{catLabel(x.category)}</span>
            {:else}
              <CategorySelect value={x.category} onchange={(c) => apply([x], c)} suggestions={() => suggest([x])} />
            {/if}
          </span>
        {:else if c.key === "desc"}
          <div class="ui-align text-ink [overflow-wrap:anywhere]" dir="auto">{x.who ?? x.desc}</div>
        {:else}
          <Money value={x.amount} currency={cur} plus class={x.amount > 0 ? "text-good" : "text-ink"} />
        {/if}
      {/snippet}
    </Table>
    <More shown={shown.length} total={rows.length} onmore={() => (limit += PAGE)} />
  </div>
{:else}
  <EmptyState icon="search" title={t("txns.empty")} text={t("txns.emptyText", { period: periodLabel(month ? { from: month, to: month } : period()) })}>
    {#each elsewhere as y (y)}<Button variant="primary" onclick={() => setPeriod(`y:${y}`)}>{t("txn34.showYear", { year: y })}</Button>{/each}
    {#if tab !== "all" || cat || acct || month || q}
      <Button
        onclick={() => {
          q = "";
          void goto("/transactions");
          tab = "all";
          cat = acct = month = "";
        }}>{t("txn34.clearFilters")}</Button>
    {/if}
  </EmptyState>
{/if}

{#if selected.length}
  <div
    role="region"
    aria-label={t("txns.bulk")}
    class="fixed inset-x-4 bottom-4 z-30 mx-auto flex w-fit max-w-[calc(100vw-32px)] flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-3xl border border-line bg-panel py-2 ps-5 pe-2 text-[14px] shadow-[var(--shadow)] md:start-[256px]">
    <span class="whitespace-nowrap text-ink">{t("txns.selected", { n: selected.length })}</span>
    <span class="text-sub"><Money value={selected.reduce((a, x) => a + x.amount, 0)} currency={cur} /></span>
    <span class="h-5 w-px bg-line max-sm:hidden"></span>
    <CategorySelect value="" variant="pill" placeholder={t("txns.setLedger")} label={t("txns.setLedger")} onchange={(c) => apply(selected, c)} suggestions={() => suggest(selected)} />
    {#if similar.length > selected.length}
      <Button size="sm" onclick={() => (sel = new Set(similar.map((x) => x.id)))}>{t("txns.selectSimilar", { n: similar.length })}</Button>
    {/if}
    <Button variant="ghost" size="sm" onclick={clear}>{t("txns.clear")}</Button>
  </div>
{/if}

<TxnDrawer />
