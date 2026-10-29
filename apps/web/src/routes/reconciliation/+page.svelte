<script lang="ts">
  // Monthly reconciliation per bank or card account: pick the account, year and month, enter the statement's ending balance and
  // tick what cleared; at a zero difference the month can be marked reconciled. Saved as books doc "reconciliations"; the math is
  // in ./recon.ts. A month the close date has reached is locked (the server refuses its changes too).
  import type { StatementCheck, Txn } from "@openbooks/schema";
  import { S, ent, accounts, catLabel, closeDate, closed, doc, mdy, monthYear, saveDoc, toast } from "#lib/stores/books.svelte.ts";
  import { t, locale } from "#lib/i18n.svelte.ts";
  import { Badge, Button, EmptyState, Icon, Input, Money, PageHeader, Select, Table, type Column } from "#lib/ui/index.ts";
  import { canMark, edit, monthCsv, monthOf, type Rec, type Recs, type Row } from "./recon.ts";

  let acct = $state(""),
    picked = $state(""),
    show = $state("all");
  const cur = $derived(ent().currency ?? "ILS");
  // plain copies, not the store's deep-reactive proxies: every month chip sums the whole ledger
  const all = $derived($state.snapshot(S.data?.txns ?? []) as Txn[]);
  const checks = $derived($state.snapshot(S.data?.checks ?? []) as StatementCheck[]);
  const recs = $derived($state.snapshot(doc<Recs>("reconciliations", {})) as Recs);

  const accts = $derived(accounts());
  const account = $derived(accts.includes(acct) ? acct : (accts[0] ?? ""));
  const years = $derived((S.data?.years ?? [S.year]).toReversed().map((y) => ({ value: String(y), label: String(y) })));
  const now = new Date(),
    nowYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const yms = $derived(Array.from({ length: 12 }, (_, i) => `${S.year}-${String(i + 1).padStart(2, "0")}`).filter((m) => m <= nowYm));
  const ym = $derived(yms.includes(picked) ? picked : (yms.at(-1) ?? ""));
  const sums = $derived(new Map(account ? yms.map((m) => [m, monthOf(all, checks, recs, account, m)] as const) : []));
  const month = $derived(sums.get(ym));

  const locked = $derived(!!ym && closed(`${ym}-01`)); // the close date has reached this month
  const auto = $derived(!!month?.auto);
  const noEnding = $derived(month?.ending == null);
  const rows = $derived(month ? month.rows.filter((r) => show === "all" || (show === "cleared") === r.cleared) : []);
  const monthName = (m: string, style: "long" | "short") => new Intl.DateTimeFormat(locale(), { month: style }).format(new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 15));

  const put = (fn: (r: Rec) => Partial<Rec>) => month && !locked && saveDoc("reconciliations", edit(recs, account, ym, month.ending, fn));
  const tick = (id: string, on: boolean) => put((r) => ({ cleared: on ? [...r.cleared.filter((x) => x !== id), id] : r.cleared.filter((x) => x !== id) }));
  const setEnding = (v: string) => put(() => ({ ending: v.trim() === "" || !Number.isFinite(+v) ? null : +v }));
  async function mark(on: boolean) {
    await put(() => (on ? { done: true, at: new Date().toISOString() } : {}));
    toast(t(on ? "recon.marked" : "recon.reopened", { month: monthYear(ym) }));
  }
  function exportCsv() {
    if (!month) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([monthCsv(account, month, catLabel)], { type: "text/csv;charset=utf-8" }));
    a.download = `reconciliation-${account}-${ym}.csv`.replace(/[^\p{L}\p{N}.-]+/gu, "-");
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const SHOWS = $derived([
    { value: "all", label: t("recon.show.all") },
    { value: "cleared", label: t("recon.show.cleared") },
    { value: "open", label: t("recon.show.open") },
  ]);
  const columns = $derived<Column<Row>[]>([
    { key: "sel", label: t("recon.tickCol"), hideLabel: true, class: "w-10" },
    { key: "date", label: t("common.date"), class: "text-sub" },
    { key: "desc", label: t("common.description"), wrap: true },
    { key: "cat", label: t("common.ledgerAccount") },
    { key: "amount", label: t("common.amount"), numeric: true },
    { key: "bal", label: t("recon.balance"), numeric: true },
  ]);
</script>

<svelte:head><title>{t("recon.title")} · OpenBooks</title></svelte:head>

<PageHeader title={t("recon.title")} sub={t("recon.sub")}>
  {#snippet actions()}
    <Button icon="download" onclick={exportCsv} disabled={!month}>{t("recon.csv")}</Button>
  {/snippet}
  {#if accts.length}
    <div class="flex flex-wrap items-center gap-2 py-3">
      <Select variant="pill" icon="bank" label={t("recon.account")} value={account} options={accts.map((a) => ({ value: a, label: a }))} onchange={(v) => (acct = v)} />
      <Select
        variant="pill"
        icon="calendar"
        label={t("recon.year")}
        value={String(S.year)}
        options={years}
        onchange={(v) => {
          S.year = +v;
          S.period = null;
          picked = "";
        }} />
    </div>
  {/if}
</PageHeader>

{#if !accts.length}
  <div class="px-4 pt-5 sm:px-8"><div class="panel"><EmptyState icon="bank" title={t("recon.noAccounts")} text={t("recon.noAccountsText")} /></div></div>
{:else if month}
  <div class="flex gap-2 overflow-x-auto px-4 pt-1 pb-3 sm:px-8" role="group" aria-label={t("recon.months")}>
    {#each yms as m (m)}
      {@const s = sums.get(m)}
      <button
        type="button"
        aria-pressed={m === ym}
        onclick={() => (picked = m)}
        class="flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[14px] whitespace-nowrap outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50 {m === ym ? 'border-accent bg-accent/8 text-ink' : 'border-line text-ink-2 hover:border-line-strong'}">
        {m === nowYm ? t("recon.now", { month: monthName(m, "long") }) : monthName(m, "short")}
        {#if s && s.status !== "open"}
          <Icon name="check" size={14} class={s.status === "auto" ? "text-accent-ink" : "text-good"} />
          <span class="sr-only">{t(`recon.status.${s.status}`)}</span>
        {/if}
        {#if closed(`${m}-01`)}<Icon name="lock" size={12} class="text-faint" />{/if}
      </button>
    {/each}
  </div>

  <div class="px-4 sm:px-8">
    <div class="panel flex flex-wrap items-end gap-x-8 gap-y-3 px-4 py-4 sm:px-5">
      <div>
        <div class="text-[13px] text-sub">{t("recon.reconciledBalance")}</div>
        <Money value={month.reconciled} currency={cur} class="text-[20px] text-ink" />
      </div>
      <Input
        label={t("recon.endingBalance")}
        numeric
        type="number"
        step="0.01"
        value={month.ending ?? ""}
        disabled={locked || auto}
        onchange={(e) => void setEnding(e.currentTarget.value)}
        class="w-44" />
      <div>
        <div class="text-[13px] text-sub">{t("recon.difference")}</div>
        {#if month.difference === null}
          <span class="text-[20px] text-sub">—</span>
        {:else}
          <Money value={month.difference} currency={cur} class="text-[20px] {month.difference ? 'text-bad' : 'text-good'}" />
        {/if}
      </div>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <Badge tone={month.status === "open" ? "neutral" : month.status === "auto" ? "accent" : "good"} icon={month.status === "open" ? "info" : "check"}>{t(`recon.status.${month.status}`)}</Badge>
        {#if month.status === "reconciled"}
          <Button disabled={locked} onclick={() => mark(false)}>{t("recon.reopen")}</Button>
        {:else if !auto}
          <Button variant="primary" icon="check" disabled={locked || !canMark(month)} onclick={() => mark(true)}>{t("recon.mark")}</Button>
        {/if}
      </div>
    </div>
    {#if locked}
      <p class="mt-2 flex items-center gap-1.5 text-[13px] text-sub" role="status"><Icon name="lock" size={14} />{t("close.locked", { date: mdy(closeDate() ?? "") })}</p>
    {:else if auto}
      <p class="mt-2 flex items-center gap-1.5 text-[13px] text-sub" role="status"><Icon name="info" size={14} />{t("recon.autoNote")}</p>
    {:else if noEnding}
      <p class="mt-2 flex items-center gap-1.5 text-[13px] text-sub" role="status"><Icon name="info" size={14} />{t("recon.needEnding")}</p>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-2 px-4 pt-4 pb-2 sm:px-8">
    <Select variant="pill" icon="filter" label={t("recon.show")} bind:value={show} options={SHOWS} />
    <span class="ms-auto text-[13px] text-sub num">{t("recon.opening")}: <Money value={month.opening} currency={cur} /></span>
  </div>
  <div class="px-4 pb-10 sm:px-8">
    {#if rows.length}
      <Table {columns} {rows} key={(r) => r.txn.id} caption={t("recon.title")} class="panel">
        {#snippet cell(r, c)}
          {#if c.key === "sel"}
            <input
              type="checkbox"
              checked={r.cleared}
              disabled={locked || auto || noEnding}
              onchange={(e) => void tick(r.txn.id, e.currentTarget.checked)}
              aria-label={t("recon.tick", { desc: r.txn.who ?? r.txn.desc })}
              class="size-4 cursor-pointer align-middle accent-accent disabled:cursor-not-allowed" />
          {:else if c.key === "date"}
            <span class="num">{mdy(r.txn.date)}</span>
          {:else if c.key === "desc"}
            <div class="ui-align text-ink [overflow-wrap:anywhere]" dir="auto">{r.txn.who ?? r.txn.desc}</div>
          {:else if c.key === "cat"}
            <span class="text-ink-2">{catLabel(r.txn.category)}</span>
          {:else if c.key === "amount"}
            <Money value={r.txn.amount} currency={cur} plus class={r.txn.amount > 0 ? "text-good" : "text-ink"} />
          {:else}
            <Money value={r.balance} currency={cur} class="text-sub" />
          {/if}
        {/snippet}
      </Table>
    {:else}
      <div class="panel"><EmptyState icon="list" title={t("recon.empty")} text={t("recon.emptyText", { account, month: monthYear(ym) })} /></div>
    {/if}
  </div>
{/if}
