<script lang="ts">
  // Reports (port of web/src/views/Reports.svelte): profit and loss, balance sheet (US-style books), cash flow, cash flow analysis, general ledger,
  // and AR / AP aging. /reports/<tab>. Every statement shows monthly columns, the period total, or this period against the prior one of the same
  // length (at most 5 years); lines drill into the transactions; CSV export and print. The aging tabs have their own as-of date and no period.
  import { page } from "$app/state";
  import { goto } from "#lib/nav.ts";
  import { agingReport, basisBridge, inPeriod, openAt, pl, priorPeriod, withTag } from "@openbooks/core";
  import { S, ent, isUS, period, periodLabel, monthsIn, balances, catLabel, mon, mdy, tagsDoc } from "#lib/stores/books.svelte.ts";
  import { apSources, arSources, basis, ledgerRows } from "#lib/stores/basis.svelte.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { Bars, Button, EmptyState, Icon, Money, PageHeader, Segmented, Select, Stat, Tabs } from "#lib/ui/index.ts";
  import PeriodPicker from "#lib/reports/PeriodPicker.svelte";
  import Statement from "#lib/reports/Statement.svelte";
  import CashFlowAnalysis from "#lib/reports/CashFlowAnalysis.svelte";
  import Aging from "#lib/reports/Aging.svelte";
  import { go } from "#lib/reports/go.ts";
  import { activeMonths, agingCsv, bsStatement, cfIndirect, cfStatement, change, ledgerGroups, plStatement, toCsv, csv as toCsvRows, type Line } from "#lib/reports/statements.ts";

  const us = $derived(isUS());
  const cur = $derived(ent().currency ?? "USD");
  const TABS = $derived(["pl", ...(us ? ["bs"] : []), "cf", "cfa", "gl", "ar", "ap"].map((key) => ({ key, label: t(`reports.tab.${key}`) })));
  const tab = $derived(TABS.some((x) => x.key === page.params.tab) ? page.params.tab! : "pl");
  const pickTab = (k: string) => goto(`/reports/${k}`, { replace: true, reset: false });

  type View = "monthly" | "total" | "compare";
  let view = $state<View>("monthly");
  const VIEWS = $derived([
    ...(tab === "bs" ? [] : [{ key: "monthly", label: t("reports.monthly") }]),
    { key: "total", label: tab === "bs" ? t("reports.balance") : t("common.total") },
    { key: "compare", label: t("reports.view.compare") },
  ]);
  const v = $derived<View>(tab === "bs" && view === "monthly" ? "total" : view);

  const p = $derived(period()),
    prior = $derived(priorPeriod(p));
  const aging = $derived(tab === "ar" || tab === "ap");
  // a range over 5 years isn't reported (the monthly columns alone would be 60+): say so instead
  const tooLong = $derived(!aging && tab !== "cfa" && monthsIn(p).length > 60);
  // report on the activity of one tag: P&L, cash flow and the ledger use only its transactions (the balance sheet is of the whole books)
  let tagPick = $state("");
  const tags = $derived(tagsDoc().tags);
  const tag = $derived(tags.some((g) => g.id === tagPick) ? tagPick : "");
  const scoped = <T extends { tags?: readonly string[] | undefined }>(xs: T[]) => (tag ? withTag(xs, tag) : xs);
  // the books' basis: cash rows as they are, or the accrual rows (invoices and bills by their dates, payments clearing receivable / payable)
  const accrual = $derived(basis() === "accrual");
  const rows = $derived(ledgerRows());
  const ts = $derived(scoped(rows.filter((x) => inPeriod(x, p)))),
    priorTs = $derived(scoped(rows.filter((x) => inPeriod(x, prior))));
  const months = $derived(activeMonths(monthsIn(p), ts));
  const ml = (m: string) => `${mon(+m.slice(5) - 1)} ${m.slice(2, 4)}`;
  const byMonth = $derived(months.map((m) => ts.filter((x) => x.date.startsWith(m))));

  // columns: [header labels, the transactions of each]
  const cols = $derived(
    v === "monthly"
      ? { head: [...months.map(ml), t("common.total")], ts: [...byMonth, ts] }
      : v === "compare"
        ? { head: [periodLabel(p), periodLabel(prior)], ts: [ts, priorTs] }
        : { head: [t("common.total")], ts: [ts] },
  );
  const plLines = $derived(plStatement(cols.ts, us, t, catLabel));
  const cfLines = $derived(accrual ? cfIndirect(cols.ts, t, catLabel) : cfStatement(cols.ts, t, catLabel));
  // headline numbers, this period vs the prior one (revenue includes other income, as the old view did)
  const P = $derived([ts, priorTs].map(pl));
  const plStats = $derived([
    { label: t("reports.netIncome"), v: P.map((x) => x.net), invert: false },
    { label: t(us ? "reports.revenue" : "reports.businessIncome"), v: P.map((x) => x.revenue + x.other), invert: false },
    ...(us ? [{ label: t("reports.expenses"), v: P.map((x) => x.cogs + x.opex), invert: true }] : []),
  ]);
  const cfNet = $derived([ts, priorTs].map((xs) => xs.filter((x) => x.source !== "invoice" && x.source !== "bill").reduce((a, x) => a + x.amount, 0)));
  // cash net income to accrual net income, for the period shown
  const bridge = $derived(accrual && !tag ? basisBridge(S.data?.txns ?? [], rows, `${p.from}-01`, `${p.to}-31`) : null);

  // P&L chart: revenue / expenses per month (+ net line for US books)
  const chartRows = $derived(
    months.map((m, i) => {
      const x = pl(byMonth[i]!);
      return { key: m, label: ml(m), v: { rev: x.revenue + (us ? x.other : 0), exp: x.cogs + x.opex }, net: x.net };
    }),
  );

  // Balance sheet at the end of the period (and of the prior one)
  const endOf = (ym: string) => `${ym}-${String(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate()).padStart(2, "0")}`;
  const asOf = $derived(v === "compare" ? [endOf(p.to), endOf(prior.to)] : [endOf(p.to)]);
  // open invoices (AR) and bills (AP): a memo under the cash-basis sheet, or part of it on the accrual basis
  const arSrc = $derived(arSources()),
    apSrc = $derived(apSources());
  const bs = $derived(
    us && tab === "bs" && !tooLong
      ? bsStatement(asOf.map((iso) => ({ iso, balances: balances(iso), upto: S.data!.txns.filter((x) => x.date <= iso), open: { ar: openAt(arSrc, iso), ap: openAt(apSrc, iso) } })), t, accrual)
      : null,
  );

  // AR / AP aging: own as-of date (default today), periods, view, party filter
  const todayIso = new Date().toLocaleDateString("sv");
  let agAsOf = $state(todayIso),
    agPeriods = $state<number | string>(3),
    agView = $state("party"),
    agParty = $state("");
  const kind = $derived(tab === "ap" ? "ap" : "ar");
  const agSrc = $derived(kind === "ap" ? apSrc : arSrc);
  const agDate = $derived(/^\d{4}-\d{2}-\d{2}$/.test(agAsOf) ? agAsOf : todayIso);
  const agFull = $derived(aging ? agingReport(agSrc, agDate, { periods: +agPeriods }) : null);
  const ag = $derived(aging ? agingReport(agSrc, agDate, { periods: +agPeriods, ...(agParty ? { parties: [agParty === "~" ? null : agParty] } : {}) }) : null);
  const agOptions = $derived([
    { value: "", label: t(`aging.all.${kind}`) },
    ...(agFull?.parties ?? []).map((x) => ({ value: x.party ?? "~", label: x.name || t(`aging.noParty.${kind}`) })),
  ]);
  $effect(() => {
    if (agParty && !agOptions.some((o) => o.value === agParty)) agParty = ""; // the party no longer has anything open on this date
  });

  // General ledger
  let open = $state<Record<string, boolean>>({});
  const gl = $derived(ledgerGroups(ts, catLabel));
  const allOpen = $derived(gl.length > 0 && gl.every((g) => open[g.key]));

  /** A ledger row opens its transaction; an invoice or bill row opens its page; the payment part of a row (id^ar) opens its transaction. */
  const openRow = (tx: { id: string; source: string }) => (tx.source === "invoice" ? void goto("/invoices") : tx.source === "bill" ? void goto("/bills") : (S.drawer = tx.id.split("^")[0]!));
  const drill = (l: Line) => l.key && go("transactions", l.key === "ask" ? "ask" : l.key.startsWith("type:") ? l.key : `cat:${l.key}`);

  function exportCsv() {
    const file = (tabLabel: string) => `${ent().short ?? "books"} ${tabLabel} ${periodLabel(p)}`;
    let csv: string;
    if (aging && ag) {
      const bucket = (i: number) => (i === 0 ? t("aging.current") : t("aging.days", { range: ag.buckets[i]!.label }));
      csv = agingCsv(ag, agView === "source" ? "source" : "party", t, bucket, { party: t(`aging.party.${kind}`), ref: t(`aging.ref.${kind}`), none: t(`aging.noParty.${kind}`) });
      return download(`${ent().short ?? "books"} ${t(`reports.tab.${kind}`)} ${agDate}`, csv);
    }
    if (tab === "gl")
      csv = toCsvRows([
        [t("common.date"), t("common.description"), t("common.account"), t("common.ledgerAccount"), t("common.amount"), t("reports.balance")],
        ...gl.flatMap((g) => g.rows.map(({ tx, run }) => [tx.date, tx.who ? `${tx.who} · bit` : tx.desc, tx.account, g.label, tx.amount.toFixed(2), run.toFixed(2)])),
      ]);
    else {
      const [first, lines, head] =
        tab === "bs" ? [t("common.account"), bs!.lines, asOf.map(mdy)] : tab === "cf" ? [t("reports.activity"), cfLines, cols.head] : [t("common.ledgerAccount"), plLines, cols.head];
      csv = toCsv([first, ...head], lines);
    }
    download(file(TABS.find((x) => x.key === tab)!.label), csv);
  }
  function download(base: string, csv: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${base.replace(/[\\/:*?"<>|]+/g, "-")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const pad = "px-3 first:ps-4 last:pe-4 sm:first:ps-5 sm:last:pe-5";
</script>

<PageHeader title={t("reports.title")} sub={aging ? t(`aging.title.${kind}`) : t(accrual ? "reports.subAccrual" : "reports.sub", { entity: bidi(ent().short ?? ""), period: periodLabel(p) })}>
  {#snippet actions()}
    <div class="contents print:hidden">
      {#if tab !== "cfa"}
        {#if !aging}<PeriodPicker />{/if}
        {#if tags.length && tab !== "bs" && !aging}
          <Select variant="pill" icon="tag" label={t("tags.filter")} value={tag} onchange={(v) => (tagPick = v)} options={[{ value: "", label: t("tags.allTags") }, ...tags.map((g) => ({ value: g.id, label: g.name }))]} />
        {/if}
        {#if !tooLong}<Button icon="download" onclick={exportCsv}>{t("reports.exportCsv")}</Button>{/if}
      {/if}
      <Button icon="printer" onclick={() => print()}>{t("common.print")}</Button>
    </div>
  {/snippet}
  <Tabs items={TABS} value={tab} onchange={pickTab} label={t("reports.title")} class="mt-3 print:hidden" />
</PageHeader>

<div class="px-4 pt-5 sm:px-8">
  {#if aging && ag}
    <Aging {kind} report={ag} currency={cur} bind:asOf={agAsOf} bind:periods={agPeriods} bind:view={agView} bind:party={agParty} partyOptions={agOptions} />
  {:else if tooLong}
    <div class="panel"><EmptyState icon="calendar" title={t("reports.tooLong")} text={t("reports.tooLongHint")} /></div>
  {:else if tab === "cfa"}
    <CashFlowAnalysis />
  {:else if tab !== "bs" && !ts.length && !priorTs.length}
    <div class="panel"><EmptyState icon="report" title={t("reports.empty")} text={t("reports.emptyHint")} /></div>
  {:else if tab === "pl"}
    <section class="flex flex-wrap items-end gap-x-10 gap-y-4">
      {#each plStats as s (s.label)}
        <Stat label={s.label} value={s.v[0]!} delta={change(s.v[0]!, s.v[1]!)} invert={s.invert} currency={cur} size="md" deltaLabel={t("stat.vsPrior")} />
      {/each}
      <span class="flex-1"></span>
      <Segmented value={v} onchange={(k) => (view = k as View)} items={VIEWS} label={t("reports.title")} class="print:hidden" />
    </section>
    {#if months.length > 1}
      <div class="panel mt-5 p-4 sm:p-5">
        <Bars
          height={240}
          layout="group"
          label={t("reports.tab.pl")}
          currency={cur}
          rows={chartRows}
          series={us
            ? [
                { key: "rev", label: t("reports.revenue"), color: "var(--color-s3)" },
                { key: "exp", label: t("reports.expenses"), color: "var(--color-s2)" },
              ]
            : [{ key: "rev", label: t("reports.businessIncome"), color: "var(--color-s1)" }]}
          line={us ? { key: "net", label: t("reports.netIncome"), color: "var(--color-s1)" } : null}
          onselect={(r) => go("transactions", `month:${r.key}`)} />
      </div>
    {/if}
    <div class="panel mt-4 overflow-hidden">
      <Statement lines={plLines} cols={cols.head} first={t("common.ledgerAccount")} caption={t("reports.tab.pl")} currency={cur} change={v === "compare"} onopen={drill} />
    </div>
    {#if bridge}
      <div class="panel mt-4 p-4 sm:p-5" data-testid="basis-bridge">
        <h3 class="text-[14px] text-ink">{t("reports.bridge.title")}</h3>
        <p class="text-[13px] text-sub">{t("reports.bridge.sub", { period: periodLabel(p) })}</p>
        <dl class="mt-3 space-y-1.5 text-[14px]">
          {#each [["cash", bridge.cashNet], ["ar", bridge.dAr], ["ap", -bridge.dAp], ...(Math.abs(bridge.outside) > 0.004 ? [["outside", bridge.outside]] : []), ...(Math.abs(bridge.rest) > 0.004 ? [["rest", bridge.rest]] : [])] as [string, number][] as [k, n] (k)}
            <div class="flex flex-wrap justify-between gap-x-3"><dt class="text-ink-2">{t(`reports.bridge.${k}`)}</dt><dd><Money value={n} currency={cur} /></dd></div>
          {/each}
          <div class="flex flex-wrap justify-between gap-x-3 border-t border-line pt-2"><dt class="text-ink">{t("reports.bridge.accrual")}</dt><dd><Money value={bridge.accrualNet} currency={cur} class="text-ink" /></dd></div>
        </dl>
      </div>
    {/if}
  {:else if tab === "bs" && bs}
    <section class="flex flex-wrap items-end gap-x-10 gap-y-4">
      <div class="w-full text-[14px] text-ink-2">{t("reports.asOf", { date: mdy(asOf[0]!) })}</div>
      {#each [[t("reports.assets"), "assets"], [t("reports.liabilities"), "liab"], [t("reports.equity"), "equity"]] as const as [label, k] (k)}
        <Stat {label} value={bs.totals[0]![k]} delta={v === "compare" ? change(bs.totals[0]![k], bs.totals[1]![k]) : null} invert={k === "liab"} currency={cur} size="md" />
      {/each}
      <span class="flex-1"></span>
      <Segmented value={v} onchange={(k) => (view = k as View)} items={VIEWS} label={t("reports.tab.bs")} class="print:hidden" />
    </section>
    <div class="panel mt-5 overflow-hidden">
      <Statement lines={bs.lines} cols={v === "compare" ? asOf.map(mdy) : [t("reports.balance")]} first={t("common.account")} caption={t("reports.tab.bs")} currency={cur} change={v === "compare"} userLabels onopen={drill} />
    </div>
  {:else if tab === "cf"}
    <section class="flex flex-wrap items-end gap-x-10 gap-y-4">
      <Stat label={t("reports.netCashFlow")} value={cfNet[0]!} delta={change(cfNet[0]!, cfNet[1]!)} currency={cur} size="md" />
      <span class="flex-1"></span>
      <Segmented value={v} onchange={(k) => (view = k as View)} items={VIEWS} label={t("reports.tab.cf")} class="print:hidden" />
    </section>
    <div class="panel mt-5 overflow-hidden">
      <Statement lines={cfLines} cols={cols.head} first={t("reports.activity")} caption={t("reports.tab.cf")} currency={cur} change={v === "compare"} userLabels onopen={drill} />
    </div>
  {:else if tab === "gl"}
    {#if !ts.length}
      <div class="panel"><EmptyState icon="report" title={t("reports.empty")} text={t("reports.emptyHint")} /></div>
    {:else}
      <div class="flex justify-end print:hidden">
        <Button variant="ghost" size="sm" icon={allOpen ? "chevron-up" : "chevron-down"} onclick={() => (open = Object.fromEntries(gl.map((g) => [g.key, !allOpen])))}
          >{allOpen ? t("reports.collapseAll") : t("reports.expandAll")}</Button>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-focusable to scroll) -->
      <div class="gl panel mt-2 max-w-full overflow-x-auto overscroll-x-contain" data-ui="table" role="region" aria-label={t("reports.tab.gl")} tabindex="0">
        <table class="w-full border-separate border-spacing-0 text-[14px]">
          <caption class="sr-only">{t("reports.tab.gl")}</caption>
          <thead>
            <tr class="[&>th]:h-9 [&>th]:border-b [&>th]:border-line [&>th]:text-[13px] [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-sub">
              <th scope="col" class="w-36 text-start {pad}">{t("common.date")}</th>
              <th scope="col" class="text-start {pad}">{t("common.description")}</th>
              {#if us}<th scope="col" class="text-start {pad}">{t("common.account")}</th>{/if}
              <th scope="col" class="text-end {pad}">{t("common.amount")}</th>
              <th scope="col" class="text-end {pad}">{t("reports.balance")}</th>
            </tr>
          </thead>
          <tbody>
            {#each gl as g (g.key)}
              <tr
                class="head cursor-pointer outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent/60"
                tabindex="0"
                aria-expanded={!!open[g.key]}
                onclick={() => (open[g.key] = !open[g.key])}
                onkeydown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), (open[g.key] = !open[g.key]))}>
                <th scope="rowgroup" colspan={us ? 3 : 2} class="h-10 border-b border-line text-start font-medium text-ink {pad}">
                  <span class="inline-flex flex-wrap items-center gap-x-2">
                    <Icon name="chevron-right" size={13} class="transition-transform {open[g.key] ? 'rotate-90 rtl:-rotate-90' : ''}" />
                    <bdi>{g.label}</bdi>
                    <span class="text-[12px] font-normal whitespace-nowrap text-sub">{t("reports.glCount", { n: g.rows.length })}</span>
                  </span>
                </th>
                <td colspan="2" class="h-10 border-b border-line text-end whitespace-nowrap {pad}"><Money value={g.value} currency={cur} class="font-medium text-ink" /></td>
              </tr>
              {#if open[g.key]}
                {#each g.rows as { tx, run } (tx.id)}
                  <tr
                    class="cursor-pointer outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent/60"
                    tabindex="0"
                    onclick={() => openRow(tx)}
                    onkeydown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), openRow(tx))}>
                    <td class="h-11 border-b border-line whitespace-nowrap text-sub tabular-nums {pad} ps-8! sm:ps-10!">{mdy(tx.date)}</td>
                    <td class="ui-align h-11 max-w-0 min-w-48 truncate border-b border-line text-ink-2 {pad}" dir="auto" title={tx.desc}>{tx.who ? `${tx.who} · bit` : tx.desc}</td>
                    {#if us}<td class="ui-align h-11 border-b border-line whitespace-nowrap text-sub {pad}" dir="auto">{tx.account}</td>{/if}
                    <td class="h-11 border-b border-line text-end whitespace-nowrap {pad}"><Money value={tx.amount} currency={cur} /></td>
                    <td class="h-11 border-b border-line text-end whitespace-nowrap text-sub {pad}"><Money value={run} currency={cur} /></td>
                  </tr>
                {/each}
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .gl :global(tr.head > :is(th, td)) {
    background: var(--side);
  }
  .gl :global(tbody tr:hover > :is(th, td)) {
    background: linear-gradient(var(--hover), var(--hover)), var(--panel);
  }
  .gl :global(tbody tr.head:hover > :is(th, td)) {
    background: linear-gradient(var(--hover), var(--hover)), var(--side);
  }
  /* Print: the statement alone, full width, every column (no sidebar, no scroll containers). */
  @media print {
    :global(aside) {
      display: none !important;
    }
    :global(main) {
      margin: 0 !important;
      padding: 0 !important;
    }
    :global([data-ui="table"]) {
      overflow: visible !important;
    }
    :global(.panel) {
      box-shadow: none !important;
    }
  }
</style>
