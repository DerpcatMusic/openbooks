<script lang="ts">
  // Transactions of the selected period: tabs (all / in / out / needs review), month, bank account and ledger filters, search,
  // per-row ledger account, tags, bulk categorize, bulk add/remove tag and bulk reviewed (shift-click ranges, "select similar"), CSV export.
  // Account-kind tabs (bank / credit card), how-it-was-categorized and reviewed filters; a split transaction shows one row per line.
  // A row opens the drawer. /transactions/<arg> or /transactions?q=<arg> seeds the filters: ask | month:2026-04 |
  // cat:expense:software | type:own | account:Mercury Credit | tag:<id> | kind:card | method:split | review:no; any other ?q= text becomes the search.
  // Long lists render 100 rows at a time and grow as you scroll, so thousands of rows stay fast.
  import { page } from "$app/state";
  import { goto } from "#lib/nav.ts";
  import { tick } from "svelte";
  import { METHODS, TYPES, activeTags, baseId, group, inPeriod, isCard, methodOf, payerOf, setTag, suggestRule, suggestedIds, tagName } from "@openbooks/core";
  import type { TagsDoc, Txn } from "@openbooks/schema";
  import { S, ent, accounts, catLabel, catGroups, typeLabel, classify, closed, closeDate, toast, suggest, mdy, period, periodLabel, tagsDoc, saveTags, reviewedDoc, setReviewed } from "#lib/stores/books.svelte.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { PageHeader, Tabs, Select, Search, Button, Badge, Money, Icon, Table, EmptyState, type Column, type SelectGroup } from "#lib/ui/index.ts";
  import CategorySelect from "#lib/txns/CategorySelect.svelte";
  import TxnDrawer from "#lib/txns/TxnDrawer.svelte";
  import More from "#lib/txns/More.svelte";
  import TagChip from "#lib/txns/TagChip.svelte";
  import { parseArg, inTab, inCat, inTag, inKind, inMethod, inReview, searchText, toCsv, range, type Kind, type Tab } from "#lib/txns/txns.ts";
  import type { Method } from "@openbooks/core";

  const PAGE = 100;
  let tab = $state<Tab>("all"),
    cat = $state(""),
    acct = $state(""),
    month = $state(""),
    tagF = $state(""),
    kind = $state<Kind>(""),
    method = $state<Method | "">(""),
    review = $state<"" | "no" | "yes">(""),
    q = $state(""),
    limit = $state(PAGE),
    sel = $state(new Set<string>()),
    last: string | null = null;

  // filters from the URL (also when another screen links here while this page is open)
  $effect(() => {
    const a = page.params.arg || page.url.searchParams.get("q") || "",
      f = parseArg(a);
    // anything that isn't a filter (?q=coffee) is a search
    q = /^(ask|(month|cat|type|account|tag|kind|method|review):)/.test(a) ? "" : a;
    tab = f.tab;
    cat = f.cat;
    acct = f.acct;
    month = f.month;
    tagF = f.tag;
    kind = f.kind;
    method = f.method;
    review = f.review;
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
      a = 0,
      b = 0,
      c = 0;
    for (const x of scope) {
      if (x.source !== "journal") (isCard(x.account) ? c++ : b++);
      if (x.amount > 0) i++;
      else if (x.amount < 0) o++;
      if (x.category === "ask") a++;
    }
    return { all: scope.length, in: i, out: o, ask: a, bank: b, card: c };
  });
  const TABS = $derived([
    { key: "all", label: t("txns.tab.all"), count: counts.all },
    ...(counts.out ? [{ key: "in", label: t("common.moneyIn") }, { key: "out", label: t("common.moneyOut") }] : []),
    { key: "ask", label: t("txns.tab.ask"), count: counts.ask },
  ]);
  // account kinds: shown only when the books have both bank and card accounts
  const KINDS = $derived(counts.bank && counts.card ? [{ key: "", label: t("gaps2.kind.all") }, { key: "bank", label: t("gaps2.kind.bank"), count: counts.bank }, { key: "card", label: t("gaps2.kind.card"), count: counts.card }] : []);
  // search text per row, built once per state/language rather than per keystroke
  const hay = $derived(new Map(all.map((x) => [x.id, searchText(x, catLabel(x.category))])));
  const marks = $derived($state.snapshot(reviewedDoc()) as Record<string, boolean>);
  // uncategorized rows with a suggestion, worked out once for the "Suggested" method and only when it is chosen
  const suggested = $derived(method === "suggested" ? suggestedIds(scope, all) : new Set<string>());
  const pass = (x: Txn, s: string) =>
    inTab(x, tab) && inKind(x, kind) && inMethod(x, method, suggested) && inReview(x, review, marks) && inCat(x, cat) && inTag(x, tagF) && (!acct || x.account === acct) && (!s || hay.get(x.id)?.includes(s));
  const rows = $derived.by(() => {
    const s = q.trim().toLowerCase();
    return scope.filter((x) => pass(x, s)).toReversed();
  });
  const shown = $derived(rows.slice(0, limit));
  // nothing here: which other tax years have matches (Review's "table view" links here with every year's uncategorized rows)
  const elsewhere = $derived.by(() => {
    if (rows.length) return [];
    const s = q.trim().toLowerCase(),
      ys = new Set<number>();
    for (const x of all) if (pass(x, s)) ys.add(+x.date.slice(0, 4));
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
    void [tab, cat, acct, month, q, tagF, kind, method, review];
    limit = PAGE;
  });

  // ---------- selection ----------
  // rows in a closed period (on or before the close date) can't be selected or re-filed
  const pickable = $derived(rows.filter((x) => !closed(x.date)));
  const selected = $derived(pickable.filter((x) => sel.has(x.id)));
  // only stored transactions take a ledger account here: a split's lines are edited in the drawer, journal lines in the journal
  const classifiable = $derived(selected.filter((x) => x.why !== "split" && x.source !== "journal"));
  const allReviewed = $derived(selected.length > 0 && selected.every((x) => marks[baseId(x.id)]));
  const noneReviewed = $derived(selected.every((x) => !marks[baseId(x.id)]));
  const allOn = $derived(pickable.length > 0 && selected.length === pickable.length);
  // the same counterparty as anything selected, within the current filters
  const similar = $derived.by(() => {
    if (!selected.length) return [];
    const ks = new Set(selected.map(payerOf));
    return pickable.filter((x) => ks.has(payerOf(x)));
  });
  // ---------- tags: filter, column, bulk add/remove ----------
  const tg = $derived($state.snapshot(tagsDoc()) as TagsDoc);
  // deactivated tags leave the pickers (a filter that is already on one keeps it)
  const live = $derived(activeTags(tg).concat(tg.tags.filter((g) => g.inactive && g.id === tagF)));
  const TAG_FILTER = $derived([{ value: "", label: t("tags.allTags") }, ...live.map((g) => ({ value: g.id, label: g.name }))]);
  const tagOf = (id: string) => tg.tags.find((g) => g.id === id);
  // "remove" offers the tags the selection carries by hand (a tag a rule adds can't be removed here)
  const carried = $derived(new Set(selected.flatMap((x) => tg.on[baseId(x.id)] ?? [])));
  const ADD = $derived([{ value: "", label: t("tags.addTo") }, ...activeTags(tg).map((g) => ({ value: g.id, label: g.name }))]);
  const REMOVE = $derived([{ value: "", label: t("tags.removeFrom") }, ...tg.tags.filter((g) => carried.has(g.id)).map((g) => ({ value: g.id, label: g.name }))]);
  let addPick = $state(""),
    removePick = $state("");
  async function tagSelected(tag: string, on: boolean) {
    if (!tag) return;
    const ids = [...new Set(selected.map((x) => baseId(x.id)))];
    await saveTags(setTag(tg, ids, tag, on));
    addPick = removePick = "";
    toast(t(on ? "tags.toast.added" : "tags.toast.removed", { n: ids.length, tag: bidi(tagName(tg, tag)) }));
  }
  async function review_(on: boolean) {
    const ids = [...new Set(selected.map((x) => baseId(x.id)))];
    await setReviewed(ids, on);
    toast(t(on ? "gaps2.toast.reviewed" : "gaps2.toast.unreviewed", { n: ids.length }));
    clear();
  }
  // R / U mark the selection reviewed / not reviewed (not while typing)
  function keys(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    if (e.metaKey || e.ctrlKey || e.altKey || !selected.length || el?.closest("input, textarea, select, [contenteditable], dialog")) return;
    const k = e.code === "KeyR" ? true : e.code === "KeyU" ? false : null;
    if (k === null || (k ? allReviewed : noneReviewed)) return;
    e.preventDefault();
    void review_(k);
  }
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
      if (!pickable.some((r) => r.id === id)) continue;
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

  async function apply(picked: readonly Txn[], category: string) {
    const ts = picked.filter((x) => x.why !== "split" && x.source !== "journal");
    if (!ts.length) return;
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
  const METHOD_OPTIONS = $derived([{ value: "", label: t("gaps2.method.all") }, ...METHODS.map((m) => ({ value: m, label: t(`gaps2.method.${m}`) }))]);
  const REVIEW_OPTIONS = $derived([{ value: "", label: t("gaps2.review.all") }, { value: "no", label: t("gaps2.review.no") }, { value: "yes", label: t("gaps2.review.yes") }]);
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
    ...(tg.tags.length ? [{ key: "tags", label: t("tags.col"), class: "max-md:hidden" }] : []),
    { key: "amount", label: t("common.amount"), numeric: true },
  ]);
  const why = (x: Txn) => (x.why === "manual" ? t("txns.why.manual") : x.why === "split" ? t("gaps2.why.split") : x.why ? t("txns.why.rule", { rule: bidi(x.why) }) : t("txns.why.none"));
</script>

<PageHeader title={t("nav.transactions")}>
  {#snippet actions()}
    {#if counts.ask}<Button variant="primary" icon="sparkle" href="/review">{t("txns.review", { n: counts.ask })}</Button>{/if}
    <Button icon="download" onclick={exportCsv} disabled={!rows.length}>{t("common.export")}</Button>
  {/snippet}
  <Tabs items={TABS} bind:value={tab} label={t("nav.transactions")} class="mt-2" onchange={clear} />
  {#if KINDS.length}<Tabs items={KINDS} bind:value={kind} label={t("gaps2.kind.label")} class="[&_[role=tab]]:h-9 [&_[role=tab]]:text-[13px]" onchange={clear} />{/if}
  <div class="flex flex-wrap items-center gap-2 py-3">
    <Select variant="pill" icon="calendar" label={t("txns.filter.month")} value={periodValue} groups={PERIODS} onchange={setPeriod} />
    {#if multi}<Select variant="pill" icon="bank" label={t("txns.filter.account")} bind:value={acct} options={ACCTS} />{/if}
    <Select variant="pill" icon="filter" label={t("txns.filter.ledger")} bind:value={cat} groups={LEDGER} />
    {#if live.length}<Select variant="pill" icon="tag" label={t("tags.filter")} bind:value={tagF} options={TAG_FILTER} />{/if}
    <Select variant="pill" icon="sparkle" label={t("gaps2.method.label")} bind:value={method} options={METHOD_OPTIONS} />
    <Select variant="pill" icon="check" label={t("gaps2.review.label")} bind:value={review} options={REVIEW_OPTIONS} />
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
        onchange={() => (allOn ? clear() : (sel = new Set(pickable.map((x) => x.id))))}
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
            disabled={closed(x.date)}
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
            <span title={why(x)} class="shrink-0 text-faint"><Icon name={x.why === "manual" ? "user" : x.why === "split" ? "list" : x.why ? "rules" : "alert"} size={13} /></span>
            {#if x.source === "journal"}
              <span class="text-ink-2">{catLabel(x.category)}</span>
            {:else if x.why === "split"}
              <span class="flex flex-wrap items-center gap-1.5 text-ink-2">{catLabel(x.category)}<Badge size="sm" tone="accent">{t("gaps2.split.part", { i: +x.id.split("~")[1]! + 1 })}</Badge></span>
            {:else if closed(x.date)}
              <span class="flex items-center gap-1.5 text-ink-2" title={t("close.locked", { date: mdy(closeDate() ?? "") })}><Icon name="lock" size={13} class="shrink-0 text-faint" />{catLabel(x.category)}</span>
            {:else}
              <CategorySelect value={x.category} onchange={(c) => apply([x], c)} suggestions={() => suggest([x])} />
            {/if}
          </span>
        {:else if c.key === "desc"}
          <div class="ui-align text-ink [overflow-wrap:anywhere]" dir="auto">
            {#if marks[baseId(x.id)]}<span title={t("gaps2.reviewed")} class="me-1 inline-block align-middle text-good"><Icon name="check" size={13} /><span class="sr-only">{t("gaps2.reviewed")}</span></span>{/if}{x.memo && x.why === "split" ? `${x.who ?? x.desc} · ${x.memo}` : (x.who ?? x.desc)}
          </div>
        {:else if c.key === "tags"}
          <span class="flex flex-wrap gap-1">
            {#each x.tags ?? [] as id (id)}{@const g = tagOf(id)}{#if g}<TagChip name={g.name} color={g.color} />{/if}{/each}
          </span>
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
    {#if tab !== "all" || cat || acct || month || q || tagF || kind || method || review}
      <Button
        onclick={() => {
          q = "";
          void goto("/transactions");
          tab = "all";
          cat = acct = month = tagF = kind = method = review = "";
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
    {#if classifiable.length}<CategorySelect value="" variant="pill" placeholder={t("txns.setLedger")} label={t("txns.setLedger")} onchange={(c) => apply(classifiable, c)} suggestions={() => suggest(classifiable)} />{/if}
    {#if !allReviewed}<Button size="sm" icon="check" onclick={() => review_(true)}>{t("gaps2.markReviewed")}</Button>{/if}
    {#if !noneReviewed}<Button size="sm" onclick={() => review_(false)}>{t("gaps2.markUnreviewed")}</Button>{/if}
    {#if live.length}
      <Select variant="pill" icon="tag" label={t("tags.addTo")} bind:value={addPick} options={ADD} onchange={(v) => tagSelected(v, true)} />
      {#if carried.size}<Select variant="pill" icon="tag" label={t("tags.removeFrom")} bind:value={removePick} options={REMOVE} onchange={(v) => tagSelected(v, false)} />{/if}
    {/if}
    {#if similar.length > selected.length}
      <Button size="sm" onclick={() => (sel = new Set(similar.map((x) => x.id)))}>{t("txns.selectSimilar", { n: similar.length })}</Button>
    {/if}
    <Button variant="ghost" size="sm" onclick={clear}>{t("txns.clear")}</Button>
  </div>
{/if}

<svelte:window onkeydown={keys} />
<TxnDrawer />
