<script lang="ts">
  // Accounts receivable / payable aging: what is still owed, by how long past its due date, on any date. By customer (or vendor) with one
  // column per age bucket, or document by document; a figure opens the documents behind it, each linking to its invoice or bill.
  // The report itself is core's agingReport (packages/core/src/accrual.ts); the page owns the controls' state and the CSV export.
  import { url } from "#lib/nav.ts";
  import { mdy } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Button, EmptyState, Icon, Input, Money, Segmented, Select, Stat } from "#lib/ui/index.ts";
  import type { AgingReport, AgingSourceRow } from "@openbooks/core";

  let {
    kind,
    report,
    currency,
    asOf = $bindable(),
    periods = $bindable(),
    view = $bindable(),
    party = $bindable(),
    partyOptions,
  }: {
    kind: "ar" | "ap";
    report: AgingReport;
    currency: string;
    asOf: string;
    periods: number | string;
    view: string;
    party: string;
    partyOptions: { value: string; label: string }[];
  } = $props();

  const pad = "px-3 first:ps-4 last:pe-4 sm:first:ps-5 sm:last:pe-5";
  const maxDate = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 10);
    return d.toLocaleDateString("sv");
  })();
  const bucket = (i: number) => (i === 0 ? t("aging.current") : t("aging.days", { range: report.buckets[i]!.label }));
  const tone = (i: number) => (i === 0 ? "bg-good" : i === 1 ? "bg-accent" : i === 2 ? "bg-warn" : "bg-bad");
  const ink = (i: number) => (i === 0 ? "text-good" : i === 1 ? "text-accent-ink" : i === 2 ? "text-warn" : "text-bad");
  const noParty = $derived(t(`aging.noParty.${kind}`));
  const VIEWS = $derived([
    { key: "party", label: t(`aging.view.party.${kind}`) },
    { key: "source", label: t(`aging.view.source.${kind}`) },
  ]);

  const positive = $derived(report.totals.buckets.reduce((a, v) => a + Math.max(0, v), 0));
  const currentTotal = $derived(report.totals.buckets[0] ?? 0);

  // the documents behind one figure: a party and bucket, a party's Overdue (bucket -1) or total (null)
  let drill = $state<{ party: string | null; name: string; bucket: number | null } | null>(null);
  $effect(() => {
    report; // a new report (another date, tab or filter) closes the panel
    drill = null;
  });
  const drillRows = $derived(
    drill ? report.sources.filter((s) => s.party === drill!.party && (drill!.bucket === null ? true : drill!.bucket < 0 ? s.bucket > 0 : s.bucket === drill!.bucket)) : [],
  );
  const drillTitle = $derived(
    drill
      ? drill.bucket === null
        ? t("aging.drillAll", { party: drill.name || noParty })
        : t("aging.drill", { party: drill.name || noParty, bucket: drill.bucket < 0 ? t("aging.overdue") : bucket(drill.bucket) })
      : "",
  );
  const open = (s: AgingSourceRow) => url(`/${kind === "ar" ? "invoices" : "bills"}?open=${encodeURIComponent(s.id)}`);
  const cell = "h-11 border-b border-line text-end whitespace-nowrap";
</script>

{#snippet figure(v: number, party: string | null, name: string, b: number | null, cls = "text-ink-2")}
  {#if Math.abs(v) < 0.005}<span class="text-faint">—</span>
  {:else}
    <button
      type="button"
      onclick={() => (drill = { party, name, bucket: b })}
      aria-label="{name || noParty} · {b === null ? t('common.total') : b < 0 ? t('aging.overdue') : bucket(b)}"
      class="-mx-1.5 rounded-md px-1.5 py-1 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50 print:hover:bg-transparent"><Money value={v} {currency} class={cls} /></button>
  {/if}
{/snippet}

<div class="flex flex-wrap items-end gap-x-3 gap-y-3 print:hidden">
  <Input label={t("aging.asOf")} type="date" bind:value={asOf} max={maxDate} class="w-44" />
  <Input label={t("aging.periods")} type="number" min="1" max="12" step="1" numeric bind:value={periods} class="w-24" />
  <Select label={t(`aging.party.${kind}`)} bind:value={party} options={partyOptions} class="w-52 max-w-full" />
  <span class="flex-1"></span>
  <Segmented bind:value={view} items={VIEWS} label={t("aging.view")} />
</div>
<p class="mt-2 text-[13px] text-sub">{t("aging.help")}</p>

{#if !report.totals.count}
  <div class="panel mt-4"><EmptyState icon="report" title={t(`aging.empty.${kind}`)} text={t("aging.emptyHint")} /></div>
{:else}
  <section class="panel mt-4 p-5 sm:p-6">
    <div class="flex flex-wrap items-end gap-x-10 gap-y-4">
      <Stat label={t("aging.outstanding")} value={report.totals.total} {currency} size="md" hint={t("aging.docs", { n: report.totals.count })} />
      <Stat label={t("aging.overdue")} value={report.totals.overdue} {currency} size="md" class={report.totals.overdue > 0 ? "[&_.display]:text-bad" : ""} />
      <Stat label={t("aging.current")} value={currentTotal} {currency} size="md" />
    </div>
    {#if positive > 0}
      <div class="mt-5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-fill" role="img" aria-label={t(`aging.title.${kind}`)}>
        {#each report.totals.buckets as v, i (i)}{#if v > 0}<div class="{tone(i)} min-w-1" style:width="{(v / positive) * 100}%" title="{bucket(i)}"></div>{/if}{/each}
      </div>
      <ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
        {#each report.totals.buckets as v, i (i)}
          <li class="flex items-center gap-1.5"><span class="size-2 shrink-0 rounded-full {tone(i)}"></span><span class="text-sub">{bucket(i)}</span><Money value={v} {currency} class="text-ink-2" /></li>
        {/each}
      </ul>
    {/if}
  </section>

  <div class="panel mt-4 overflow-hidden">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-focusable to scroll) -->
    <div data-ui="table" class="ag max-w-full overflow-x-auto overscroll-x-contain" role="region" aria-label={t(`aging.title.${kind}`)} tabindex="0">
      {#if view === "party"}
        <table class="w-full border-separate border-spacing-0 text-[14px]">
          <caption class="sr-only">{t(`aging.title.${kind}`)}</caption>
          <thead>
            <tr>
              <th scope="col" class="sticky start-0 z-[2] h-9 border-b border-line bg-panel text-start text-[13px] font-normal whitespace-nowrap text-sub {pad}">{t(`aging.party.${kind}`)}</th>
              {#each report.buckets as _, i (i)}<th scope="col" class="h-9 border-b border-line text-end text-[13px] font-normal whitespace-nowrap text-sub {pad}">{bucket(i)}</th>{/each}
              <th scope="col" class="h-9 border-b border-line text-end text-[13px] font-normal whitespace-nowrap text-sub {pad}">{t("aging.overdue")}</th>
              <th scope="col" class="h-9 border-b border-line text-end text-[13px] font-normal whitespace-nowrap text-sub {pad}">{t("common.total")}</th>
            </tr>
          </thead>
          <tbody>
            {#each report.parties as p (p.party ?? "")}
              <tr>
                <th scope="row" class="sticky start-0 z-[1] h-11 max-w-[min(18rem,50vw)] min-w-36 border-b border-line py-2 text-start font-normal text-ink [overflow-wrap:break-word] sm:min-w-52 {pad}">
                  <bdi>{p.name || noParty}</bdi>
                  <span class="block text-[12px] text-sub">{t("aging.docs", { n: p.count })}{#if p.oldest > 0}{" · "}{t("aging.oldest", { n: p.oldest })}{/if}</span>
                </th>
                {#each p.buckets as v, i (i)}<td class="{cell} {pad}">{@render figure(v, p.party, p.name, i, i === 0 ? "text-ink-2" : ink(i))}</td>{/each}
                <td class="{cell} {pad}">{@render figure(p.overdue, p.party, p.name, -1, p.overdue > 0 ? "text-bad" : "text-ink-2")}</td>
                <td class="{cell} {pad}">{@render figure(p.total, p.party, p.name, null, "font-medium text-ink")}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr class="total">
              <th scope="row" class="sticky start-0 z-[1] h-11 border-t border-line-strong bg-panel text-start font-medium text-ink {pad}">{t("common.total")}</th>
              {#each report.totals.buckets as v, i (i)}<td class="h-11 border-t border-line-strong text-end whitespace-nowrap {pad}"><Money value={v} {currency} class="font-medium text-ink" /></td>{/each}
              <td class="h-11 border-t border-line-strong text-end whitespace-nowrap {pad}"><Money value={report.totals.overdue} {currency} class="font-medium text-ink" /></td>
              <td class="h-11 border-t border-line-strong text-end whitespace-nowrap {pad}"><Money value={report.totals.total} {currency} class="font-medium text-ink" /></td>
            </tr>
            {#if report.totals.percents}
              <tr>
                <th scope="row" class="sticky start-0 z-[1] h-10 bg-panel text-start font-normal text-sub {pad}">{t("aging.pct")}</th>
                {#each report.totals.percents as v, i (i)}<td class="num h-10 text-end whitespace-nowrap text-sub {pad}" dir="ltr">{v.toFixed(1)}%</td>{/each}
                <td class="h-10 {pad}"></td>
                <td class="num h-10 text-end whitespace-nowrap text-sub {pad}" dir="ltr">100.0%</td>
              </tr>
            {/if}
          </tfoot>
        </table>
      {:else}
        {@render docs(report.sources, true)}
      {/if}
    </div>
  </div>

  {#if drill}
    <section class="panel mt-4 overflow-hidden" aria-live="polite">
      <div class="flex flex-wrap items-center gap-3 px-4 pt-4 pb-2 sm:px-5">
        <h2 class="min-w-0 flex-1 text-[15px] text-ink"><bdi>{drillTitle}</bdi></h2>
        <Button size="sm" variant="ghost" icon="x" onclick={() => (drill = null)}>{t("aging.hide")}</Button>
      </div>
      <div data-ui="table" class="ag max-w-full overflow-x-auto overscroll-x-contain">{@render docs(drillRows, false)}</div>
    </section>
  {/if}
{/if}

{#snippet docs(rows: readonly AgingSourceRow[], withParty: boolean)}
  <table class="w-full border-separate border-spacing-0 text-[14px]">
    <thead>
      <tr class="[&>th]:h-9 [&>th]:border-b [&>th]:border-line [&>th]:text-[13px] [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-sub">
        {#if withParty}<th scope="col" class="sticky start-0 z-[2] bg-panel text-start {pad}">{t(`aging.party.${kind}`)}</th>{/if}
        <th scope="col" class="text-start {pad}">{t(`aging.ref.${kind}`)}</th>
        <th scope="col" class="text-start {pad}">{t("common.date")}</th>
        <th scope="col" class="text-start {pad}">{t("bills.col.dueDate")}</th>
        <th scope="col" class="text-end {pad}">{t("aging.pastDue")}</th>
        <th scope="col" class="text-start {pad}">{t("aging.bucket")}</th>
        <th scope="col" class="text-end {pad}">{t("aging.outstanding")}</th>
        <th scope="col" class="relative w-10 {pad}"><span class="sr-only">{t("common.open")}</span></th>
      </tr>
    </thead>
    <tbody>
      {#each rows as s (s.id)}
        <tr>
          {#if withParty}<th scope="row" class="sticky start-0 z-[1] h-11 max-w-[min(16rem,45vw)] min-w-32 border-b border-line bg-panel py-2 text-start font-normal text-ink [overflow-wrap:break-word] {pad}"><bdi>{s.name || noParty}</bdi></th>{/if}
          <td class="num h-11 border-b border-line whitespace-nowrap text-ink-2 {pad}">{s.ref || "—"}</td>
          <td class="num h-11 border-b border-line whitespace-nowrap text-sub {pad}">{mdy(s.date)}</td>
          <td class="num h-11 border-b border-line whitespace-nowrap {s.days > 0 ? 'text-bad' : 'text-sub'} {pad}">{s.due ? mdy(s.due) : "—"}</td>
          <td class="num h-11 border-b border-line text-end whitespace-nowrap {s.days > 0 ? 'text-bad' : 'text-sub'} {pad}">{s.days > 0 ? s.days : "—"}</td>
          <td class="h-11 border-b border-line whitespace-nowrap {ink(s.bucket)} {pad}">{bucket(s.bucket)}</td>
          <td class="h-11 border-b border-line text-end whitespace-nowrap {pad}"><Money value={s.outstanding} {currency} class="text-ink" /></td>
          <td class="h-11 border-b border-line text-end {pad}"
            ><a href={open(s)} aria-label="{t('common.open')} {s.ref}" class="inline-grid size-7 place-items-center rounded-full text-sub outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 print:hidden"
              ><Icon name="chevron-right" size={14} class="rtl:-scale-x-100" /></a
            ></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<style>
  .ag :global(tbody tr:hover > :is(th, td)) {
    background: linear-gradient(var(--hover), var(--hover)), var(--panel);
  }
  .ag :global(tfoot :is(th, td)) {
    background: var(--panel);
  }
</style>
