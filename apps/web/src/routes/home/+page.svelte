<script lang="ts">
  import { BASE } from "#lib/nav.ts";
  // Home (port of web/src/views/Home.svelte): greeting, review nudge, three headline cards (cash or money in · revenue ·
  // expenses or the Israeli tax estimate), the big monthly chart (earnings / spending / P&L, or business vs all money in) and
  // recent activity. Every number compares with the prior period of the same length; hovering a type anywhere spotlights it.
  import { baseOf, burn as burnRate, cashDelta, cashFlow, cashIn, cashOut, group, isCard, isFlow, margins, pctLabel, pl, priorPeriod, TYPES } from "@openbooks/core";
  import type { Txn } from "@openbooks/schema";
  import { api, type CombinedFlow, type CombinedFlowTxn, type TransferJourney } from "#lib/api.ts";
  import { S, ent, isUS, period, periodTxns, periodLabel, monthsIn, balances, catLabel, typeLabel, fmt, mdy, mon, monthYear, SERIES, doc, saveDoc, setEntity, decideTransfer } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Area, Badge, BarList, Bars, Button, Dialog, Icon, IconButton, Money, Segmented, Skeleton, Stat, Switch } from "#lib/ui/index.ts";
  import { moneyText } from "#lib/ui/money.ts";
  import { ilYear } from "../tax/il/il.ts";
  import FlowCard from "#lib/home/FlowCard.svelte";
  import InOutCard from "#lib/home/InOutCard.svelte";
  import Insights from "#lib/home/Insights.svelte";
  import NetWorthCard from "#lib/home/NetWorthCard.svelte";
  import RecurringList from "#lib/home/RecurringList.svelte";
  import { arrange, move, type CardId, type HomeLayout } from "#lib/home/layout.ts";
  import Metric from "#lib/reports/Metric.svelte";
  import PeriodPicker from "#lib/reports/PeriodPicker.svelte";
  import { go } from "#lib/reports/go.ts";
  import { change as delta } from "#lib/reports/statements.ts";

  const us = $derived(isUS());
  const cur = $derived(ent().currency ?? "USD");
  const p = $derived(period()),
    prior = $derived(priorPeriod(p));
  const ts = $derived(periodTxns(p)),
    prevTs = $derived(periodTxns(prior));
  const now = $derived(pl(ts)),
    prev = $derived(pl(prevTs));
  const months = $derived(monthsIn(p));
  const monthTs = (ym: string) => S.data!.txns.filter((x) => x.date.startsWith(ym));
  const ml = (ym: string) => mon(+ym.slice(5) - 1);
  const endOf = (ym: string) => `${ym}-${String(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate()).padStart(2, "0")}`;
  // money in (Israel): what came in from outside, not transfers, own money, owner equity, personal movements or loans
  const sumOf = (xs: readonly Txn[]) => xs.reduce((a, x) => (isFlow(x.category) ? a + baseOf(x) : a), 0);

  // cash (US) / money in (Israel)
  const nonCard = (b: Record<string, number>) => Object.entries(b).reduce((s, [a, v]) => (isCard(a) ? s : s + v), 0);
  const bal = $derived(us ? balances(endOf(p.to)) : {});
  const cash = $derived(nonCard(bal)),
    prevCash = $derived(us ? nonCard(balances(endOf(prior.to))) : 0);
  const cashPts = $derived(months.map((ym) => ({ label: monthYear(ym), v: us ? nonCard(balances(endOf(ym))) : sumOf(monthTs(ym)) })));
  const moneyIn = $derived(sumOf(ts));
  type Item = { key: string; label: string; value: number; color: string };
  const inByType = $derived.by(() => {
    const m = new Map<string, number>();
    for (const x of ts) if (isFlow(x.category)) m.set(group(x.category), (m.get(group(x.category)) ?? 0) + baseOf(x));
    return [...m]
      .map(([key, value]) => ({ key, label: key in TYPES ? typeLabel(key) : key, value }))
      .sort((a, b) => b.value - a.value)
      .map((x, i): Item => ({ ...x, color: SERIES[i % 6]! }));
  });

  // revenue / expenses (Israel: fund profits aren't business income)
  const revenue = $derived(now.revenue + (us ? now.other : 0)),
    prevRevenue = $derived(prev.revenue + (us ? prev.other : 0));
  const expenses = $derived(now.cogs + now.opex),
    prevExpenses = $derived(prev.cogs + prev.opex);
  const revLines = $derived([...now.lines.revenue, ...(us ? now.lines.other : [])].map((l, i): Item => ({ key: l.key, label: catLabel(l.key), value: l.value, color: SERIES[i % 6]! })));
  const expLines = $derived(
    [...now.lines.cogs, ...now.lines.expense].sort((a, b) => a.value - b.value).map((l, i): Item => ({ key: l.key, label: catLabel(l.key), value: -l.value, color: SERIES[(i + 1) % 6]! })),
  );
  const series = (ls: Item[]) => ls.map(({ key, label, color }) => ({ key, label, color }));
  const perMonth = (ls: Item[], keyOf: (x: Txn) => string, sign = 1) =>
    months.map((ym) => {
      const v: Record<string, number> = {};
      for (const x of monthTs(ym)) {
        const k = keyOf(x);
        if (ls.some((l) => l.key === k)) v[k] = (v[k] ?? 0) + sign * baseOf(x);
      }
      return { key: ym, label: ml(ym), sub: monthYear(ym), v };
    });

  // key numbers (docs/mercury-books-spec.md section 11): net cash flow of the period, monthly burn and runway from the last 3 complete months,
  // net margin and expense ratio when there is revenue (US books: Israeli books are taxed on turnover, expenses aren't the story)
  const cf = $derived(cashFlow(ts)),
    cfDelta = $derived(cashDelta(cf.net, cashFlow(prevTs).net));
  const bn = $derived(burnRate(S.data!.txns, new Date().toLocaleDateString("sv")));
  const mg = $derived(us ? margins(revenue, expenses) : null);
  const mo = (n: number | null | undefined) => (n == null ? "—" : n < 1 ? t("home.m.lt1") : t("home.m.mo", { n }));
  const signed = (n: number) => (n > 0 ? "+" : "") + fmt(n);

  // Unified monthly chart (consolidates P&L, cash in/out, and revenue/expense breakdowns without repeating graphs)
  let mode = $state("profit"),
    hl = $state<string | null>(null); // the ledger account / type hovered anywhere on the page
  const MODES = $derived(
    us
      ? [
          { key: "profit", label: t("home.mode.profit") },
          { key: "inout", label: t("home.mode.inout") },
          { key: "revenue", label: t("home.mode.revenue") },
          { key: "expenses", label: t("home.mode.expenses") },
        ]
      : [
          { key: "revenue", label: t("home.mode.business") },
          { key: "in", label: t("home.mode.in") },
          { key: "inout", label: t("home.mode.inout") },
        ],
  );
  $effect(() => {
    if (!MODES.some((m) => m.key === mode)) mode = MODES[0]!.key;
  });
  const chart = $derived.by(() => {
    if (mode === "profit")
      return {
        series: [
          { key: "rev", label: t("home.mode.revenue"), color: "var(--color-s3)" },
          { key: "exp", label: t("home.mode.expenses"), color: "var(--color-s2)" },
        ],
        layout: "group" as const,
        line: { key: "net", label: t("home.netIncome"), color: "var(--color-s1)" },
        rows: months.map((ym) => {
          const x = pl(monthTs(ym));
          return { key: ym, label: ml(ym), sub: monthYear(ym), v: { rev: x.revenue + x.other, exp: x.cogs + x.opex }, net: x.net };
        }),
      };
    if (mode === "inout")
      return {
        series: [
          { key: "in", label: t("charts.flow.in"), color: "var(--color-s3)" },
          { key: "out", label: t("charts.flow.out"), color: "var(--color-s2)" },
        ],
        layout: "group" as const,
        line: { key: "net", label: t("charts.inout.net"), color: "var(--color-s1)" },
        rows: months.map((ym) => {
          const mt = monthTs(ym),
            inn = cashIn(mt),
            out = cashOut(mt);
          return { key: ym, label: ml(ym), sub: monthYear(ym), v: { in: inn, out }, net: inn - out };
        }),
      };
    const lines = mode === "revenue" ? revLines : mode === "expenses" ? expLines : inByType;
    return {
      series: series(lines),
      layout: "stack" as const,
      line: null,
      rows: perMonth(lines, mode === "in" ? (x) => group(x.category) : (x) => x.category, mode === "expenses" ? -1 : 1),
    };
  });

  // Israel: uses the exact same unified ilYear() calculation as Form 1301, Print, Checks, and MCP
  const tb = $derived.by(() => {
    if (us || !S.data) return null;
    const r = ilYear(S.year);
    return { ...r, ceiling: (r.T as { zairCeiling?: number }).zairCeiling ?? 0 };
  });
  const zair = $derived(!!tb?.zair);
  const ceilPct = $derived(tb?.ceiling ? (tb.turnover / tb.ceiling) * 100 : 0);

  const recent = $derived(ts.filter((x) => group(x.category) !== "transfer").slice(-7).reverse());
  const ask = $derived(S.data!.txns.filter((x) => x.category === "ask").length);
  const first = $derived(String(S.data!.profile.owner ?? "").split(" ")[0] || String(S.data!.profile.first ?? ""));
  const hour = new Date().getHours();
  const todayIso = new Date().toLocaleDateString("sv");
  const curYear = Number(todayIso.slice(0, 4));
  const thisMonth = todayIso.slice(0, 7);
  const multiEntity = $derived((S.data?.entities.length ?? 0) > 1);
  let homeScopePref = $state<"merged" | "single" | null>(
    typeof localStorage !== "undefined" ? ((localStorage.getItem("ob-home-scope") as "merged" | "single" | null) ?? null) : null,
  );
  const homeScope = $derived<"merged" | "single">(multiEntity ? (homeScopePref ?? "merged") : "single");
  const setHomeScope = (v: "merged" | "single") => {
    homeScopePref = v;
    try {
      localStorage.setItem("ob-home-scope", v);
    } catch {}
  };
  const mergedCurrencies = $derived([...new Set(["USD", "ILS", ...(S.data?.entities ?? []).map((e) => e.currency ?? "USD")])]);
  let mergedCurPref = $state<string | null>(
    typeof localStorage !== "undefined" ? localStorage.getItem("ob-merged-cur") : null,
  );
  const mergedCur = $derived(mergedCurPref && mergedCurrencies.includes(mergedCurPref) ? mergedCurPref : cur);
  const setMergedCur = (c: string) => {
    mergedCurPref = c;
    try {
      localStorage.setItem("ob-merged-cur", c);
    } catch {}
  };

  // Live span: defaults to YTD through TODAY when viewing the current year (constantly updating via SSE);
  // switches automatically to the full tax year or custom range whenever the user explicitly picks one.
  const isLiveYtd = $derived(!S.period && S.year === curYear);
  const liveSpan = $derived.by(() => {
    if (isLiveYtd) return { from: `${curYear}-01-01`, to: todayIso };
    const from = `${p.from}-01`;
    const toEnd = endOf(p.to);
    return { from, to: toEnd > todayIso && p.to === thisMonth ? todayIso : toEnd };
  });

  let mergedFlow = $state<CombinedFlow | null>(null);
  let mergedBusy = $state(false);
  $effect(() => {
    if (homeScope !== "merged" || !multiEntity) return;
    void S.v;
    void S.rev;
    const { from, to } = liveSpan;
    const c = mergedCur;
    let stale = false;
    mergedBusy = !mergedFlow;
    api
      .flow(c, from, to)
      .then((d) => {
        if (!stale) {
          mergedFlow = d;
          mergedBusy = false;
        }
      })
      .catch(() => {
        if (!stale) mergedBusy = false;
      });
    return () => {
      stale = true;
    };
  });
  const mergedEntityNames = $derived((S.data?.entities ?? []).map((e) => `${e.flag ?? ""} ${e.short || e.name || e.id}`.trim()).join(" + "));
  // Highlight: one slice of the merged money stays lit (a business's money in, spending, fees, moves between banks), the rest dims.
  let focus = $state<string | null>(null);
  const mergedEnts = $derived(mergedFlow?.entities ?? []);
  const entTag = (id: string) => {
    const e = mergedEnts.find((x) => x.id === id);
    return `${e?.flag ?? ""} ${e?.name ?? id}`.trim();
  };
  const entFlag = (id: string) => mergedEnts.find((x) => x.id === id)?.flag || entTag(id);
  const sliceOf = (x: CombinedFlowTxn) => (x.category === "expense:bank-fees" ? "fees" : x.amount > 0 ? `in:${x.entity}` : "out");
  const IN_COLORS = ["var(--color-s3)", "var(--color-s1)", "var(--color-s5)", "var(--color-s6)"];
  const slices = $derived([
    ...mergedEnts.map((e, i) => ({ key: `in:${e.id}`, label: t("charts.merged.hl.in", { name: entTag(e.id) }), color: IN_COLORS[i % IN_COLORS.length]! })),
    { key: "out", label: t("charts.merged.hl.out"), color: "var(--color-s2)" },
    { key: "fees", label: t("charts.merged.hl.fees"), color: "var(--color-bad)" },
    { key: "moved", label: t("charts.merged.hl.moved"), color: "var(--color-s4)" },
  ]);
  const lit = (k: string) => !focus || focus === k;
  // a business card stays lit for its own money in and for spending or fees (every business has some)
  const entLit = (id: string) => !focus || focus === `in:${id}` || focus === "out" || focus === "fees";
  const mergedChart = $derived.by(() => {
    const m = new Map<string, Record<string, number>>();
    for (const r of mergedFlow?.monthly ?? []) m.set(r.month, { moved: r.moved });
    for (const x of mergedFlow?.txns ?? []) {
      const ym = x.date.slice(0, 7),
        v = m.get(ym) ?? {},
        k = sliceOf(x);
      v[k] = (v[k] ?? 0) + Math.abs(x.amount);
      m.set(ym, v);
    }
    const net = new Map((mergedFlow?.monthly ?? []).map((r) => [r.month, r.net]));
    return {
      series: slices,
      layout: "group" as const,
      line: { key: "net", label: t("charts.inout.net"), color: "var(--color-ink)" },
      rows: [...m].sort(([a], [b]) => a.localeCompare(b)).map(([ym, v]) => ({ key: ym, label: ml(ym), sub: monthYear(ym), v, net: net.get(ym) ?? 0 })),
    };
  });
  const activity = $derived(
    [...(mergedFlow?.txns ?? [])]
      .filter((x) => !focus || focus === "moved" || sliceOf(x) === focus)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 12),
  );

  // Transfer lifecycle: detected → confirmed (both sides filed as transfers) or rejected (both sides count again as money in / out).
  let settling = $state(false);
  async function settle(js: readonly TransferJourney[], as: "confirmed" | "rejected") {
    settling = true;
    try {
      for (const j of js) for (const l of j.legs) if (!l.confirmed) await decideTransfer(l.out.ref, l.in.ref, as);
    } finally {
      settling = false;
    }
  }

  const CARD = { metrics, overview, flow, inout, insights, networth, recurring, chart: chartCard, recent: recentCard };

  // the cards: order and visibility per entity (doc "home-layout"); wide cards span the row, the rest share it two to one
  const L = $derived(arrange(doc<HomeLayout | null>("home-layout", null)));
  const SPAN: Record<CardId, string> = { metrics: "lg:col-span-3", overview: "lg:col-span-3", flow: "lg:col-span-3", inout: "lg:col-span-2", insights: "", networth: "lg:col-span-2", recurring: "", chart: "lg:col-span-3", recent: "lg:col-span-3" };
  let customize = $state(false);
  const saveLayout = (order: CardId[], hidden: Set<CardId>) => saveDoc("home-layout", { order, hidden: [...hidden] });
  const toggle = (id: CardId, on: boolean) => {
    const h = new Set(L.hidden);
    if (on) h.delete(id);
    else h.add(id);
    return saveLayout(L.order, h);
  };
</script>

<svelte:head><title>{t("nav.home")} · OpenBooks</title></svelte:head>

<div class="px-4 pt-6 pb-10 sm:px-8">
  <div class="flex flex-wrap items-end gap-3">
    <div class="min-w-0 flex-1 basis-60">
      <div class="flex flex-wrap items-center gap-2 text-[13px] text-sub">
        {#if homeScope === "merged"}
          <span>{mergedEntityNames}</span>
        {:else}
          <span>{ent().flag} <bdi>{ent().name}</bdi></span>
        {/if}
        {#if isLiveYtd}
          <Badge size="sm" tone="good"><span class="me-1 inline-block size-1.5 rounded-full bg-good"></span>{t("charts.merged.live")}</Badge>
        {:else if !S.period}
          <Badge size="sm">{t("charts.merged.taxYear", { y: S.year })}</Badge>
        {/if}
      </div>
      <h1 class="display mt-0.5 text-[28px] leading-9 text-ink [overflow-wrap:anywhere]">
        {t(hour < 12 ? "home.greet.morning" : hour < 18 ? "home.greet.afternoon" : "home.greet.evening")}{#if first}, <bdi>{first}</bdi>{/if}
      </h1>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      {#if multiEntity}
        <Segmented
          value={homeScope}
          onchange={(k) => setHomeScope(k as "merged" | "single")}
          size="sm"
          label={t("charts.merged.scope")}
          items={[
            { key: "merged", label: t("charts.merged.all") },
            { key: "single", label: t("charts.merged.one") },
          ]} />
        {#if homeScope === "merged"}
          <Segmented
            value={mergedCur}
            onchange={setMergedCur}
            size="sm"
            label={t("charts.nw.currency")}
            items={mergedCurrencies.map((c) => ({ key: c, label: c }))} />
        {/if}
      {/if}
      <PeriodPicker />
      <Button icon="upload" href="/documents">{t("common.import")}</Button>
      {#if homeScope === "single"}
        <IconButton icon="settings" data-customize label={t("charts.card.customize")} variant="secondary" onclick={() => (customize = true)} />
      {/if}
    </div>
  </div>

  {#if homeScope === "merged" && multiEntity}
    {#if mergedFlow?.transfers?.journeys.length}
      {@const tr = mergedFlow.transfers}
      <div class="rise mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent/25 bg-accent/8 px-4 py-2.5 text-[13px] text-ink-2 sm:px-5">
        <span class="min-w-0 flex-1">
          {t("charts.merged.moved", { n: tr.journeys.length, amount: moneyText(tr.moved, mergedCur, false), fees: moneyText(tr.fees, mergedCur, false) })}
          {#if tr.pending}<span class="text-warn"> {t("charts.merged.pending", { n: tr.pending })}</span>{/if}
        </span>
        {#if tr.pending}
          <Button size="sm" disabled={settling} onclick={() => settle(tr.journeys, "confirmed")}>{t("charts.merged.confirmAll")}</Button>
        {/if}
      </div>
    {/if}
    {#if (mergedFlow?.totals?.uncatCount ?? 0) > 0}
      <a
        href="{BASE}/review"
        class="rise mt-4 flex w-full items-center gap-3 rounded-2xl border border-warn/25 bg-warn/8 px-4 py-3 text-start outline-none transition hover:bg-warn/12 focus-visible:ring-2 focus-visible:ring-accent/50 sm:px-5">
        <span class="grid size-8 shrink-0 place-items-center rounded-full bg-warn/15 text-warn"><Icon name="sparkle" size={16} /></span>
        <span class="min-w-0 flex-1 text-[14px] text-ink">{t("charts.merged.uncatAll", { n: mergedFlow!.totals!.uncatCount })}</span>
        <span class="shrink-0 text-[14px] whitespace-nowrap text-accent-ink">{t("home.reviewGo")}</span>
      </a>
    {/if}

    {#if mergedBusy && !mergedFlow}
      <div class="mt-5 grid gap-4 lg:grid-cols-3"><Skeleton class="h-36" /><Skeleton class="h-36" /><Skeleton class="h-36" /></div>
    {:else if mergedFlow}
      <div class="mt-5 grid gap-4 lg:grid-cols-3">
        <div class="lg:col-span-3">
          <Segmented value={focus ?? "all"} onchange={(k) => (focus = k === "all" ? null : k)} size="sm" label={t("charts.merged.hl.label")} items={[{ key: "all", label: t("charts.merged.hl.all") }, ...slices]} />
        </div>
        <section class="panel glow rise min-w-0 p-5 sm:p-6">
          <Stat label={t("charts.merged.net")} value={mergedFlow.totals?.net ?? 0} currency={mergedCur} hint={isLiveYtd ? t("charts.merged.live") : periodLabel(p)} />
          <div class="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-sub">
            <span>{t("charts.flow.in")}: <Money value={mergedFlow.totals?.in ?? 0} currency={mergedCur} cents={false} class="text-good" /></span>
            <span>{t("charts.flow.out")}: <Money value={mergedFlow.totals?.out ?? 0} currency={mergedCur} cents={false} class="text-ink" /></span>
          </div>
        </section>

        <section class="panel rise min-w-0 p-5 sm:p-6 lg:col-span-2" style="animation-delay:60ms">
          <h2 class="text-[13px] text-sub">{t("charts.merged.byEntity")}</h2>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            {#each mergedFlow.totals?.byEntity ?? [] as be (be.id)}
              <button
                type="button"
                style:opacity={entLit(be.id) ? 1 : 0.35}
                onclick={() => {
                  setHomeScope("single");
                  void setEntity(be.id);
                }}
                class="flex flex-col gap-1.5 rounded-xl border border-line bg-bg/50 p-3.5 text-start transition hover:border-line-strong hover:bg-hover">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-[14px] font-medium text-ink">{be.flag} <bdi>{be.name}</bdi></span>
                  <Money value={be.net} currency={mergedCur} cents={false} plus class="text-[14px] {be.net >= 0 ? 'text-good' : 'text-bad'}" />
                </div>
                <div class="flex flex-wrap gap-x-4 text-[12px] text-sub">
                  <span>{t("charts.flow.in")} <Money value={be.in} currency={mergedCur} cents={false} class="text-ink-2" /></span>
                  <span>{t("charts.flow.out")} <Money value={be.out} currency={mergedCur} cents={false} class="text-ink-2" /></span>
                  {#if be.uncatCount > 0}<span class="text-warn">{be.uncatCount} ?</span>{/if}
                </div>
              </button>
            {/each}
          </div>
        </section>

        <section class="panel rise min-w-0 p-5 sm:p-6 lg:col-span-3">
          <NetWorthCard currency={mergedCur} />
        </section>

        {#if mergedChart.rows.length > 0}
          <section class="panel rise min-w-0 p-5 sm:p-6 lg:col-span-3">
            <div class="mb-4">
              <h2 class="text-[16px] text-ink">{t("charts.merged.monthly")}</h2>
              <p class="text-[13px] text-sub">{t("charts.merged.sub", { entities: mergedEntityNames, cur: mergedCur })}</p>
            </div>
            <Bars bind:focus {...mergedChart} height={260} currency={mergedCur} label={t("charts.merged.monthly")} />
          </section>
        {/if}

        <section class="panel rise min-w-0 p-5 transition-opacity sm:p-6 lg:col-span-2" style:opacity={lit("moved") ? 1 : 0.35}>
          <h2 class="text-[16px] text-ink">{t("charts.merged.journeys")}</h2>
          <p class="text-[13px] text-sub">{t("charts.merged.journeysSub")}</p>
          {#if mergedFlow.transfers?.journeys.length}
            <ul class="mt-3 max-h-[28rem] divide-y divide-line overflow-y-auto">
              {#each mergedFlow.transfers.journeys as j (j.legs[0]!.out.ref)}
                {@const open = j.legs.some((l) => !l.confirmed)}
                <li class="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-2.5 text-[13px]">
                  <span class="text-sub tabular-nums">{mdy(j.legs[0]!.out.date)}</span>
                  <span class="text-ink">{entFlag(j.legs[0]!.out.entity)} <bdi>{j.legs[0]!.out.account}</bdi></span>
                  <Money value={j.legs[0]!.out.native} currency={j.legs[0]!.out.currency} cents={false} class="text-ink-2" />
                  {#each j.legs as l (l.in.ref)}
                    <Icon name="arrow" size={12} class="text-faint rtl:-scale-x-100" />
                    <span class="text-ink">{entFlag(l.in.entity)} <bdi>{l.in.account}</bdi></span>
                    <Money value={l.in.native} currency={l.in.currency} cents={false} plus class="text-good" />
                  {/each}
                  <span class="ms-auto flex flex-wrap items-center gap-2">
                    {#if j.fee > 0}<span class="text-bad" style:opacity={lit("fees") || lit("moved") ? 1 : 0.35}>{t("charts.merged.fee", { amount: moneyText(j.fee, mergedCur, false) })}</span>{/if}
                    {#if open}
                      <Badge size="sm" tone="warn">{t("charts.merged.detected")}</Badge>
                      <Button size="sm" disabled={settling} onclick={() => settle([j], "confirmed")}>{t("charts.merged.confirm")}</Button>
                      <Button size="sm" variant="ghost" disabled={settling} onclick={() => settle([j], "rejected")}>{t("charts.merged.reject")}</Button>
                    {:else}
                      <Badge size="sm" tone="good">{t("charts.merged.confirmed")}</Badge>
                    {/if}
                  </span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="py-6 text-[14px] text-sub">{t("charts.merged.noJourneys")}</p>
          {/if}
        </section>

        <section class="panel rise min-w-0 overflow-hidden transition-opacity" style:opacity={focus === "moved" ? 0.35 : 1}>
          <h2 class="px-4 pt-5 pb-2 text-[16px] text-ink sm:px-5">{t("charts.merged.activity")}</h2>
          <ul>
            {#each activity as x (`${x.entity}/${x.id}`)}
              <li class="flex items-center gap-3 border-t border-line px-4 py-2.5 first:border-t-0 sm:px-5">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[14px] text-ink" dir="auto">{x.who ? `${x.who} · bit` : x.desc}</span>
                  <span class="block truncate text-[12px] text-sub">{mdy(x.date)} · {entFlag(x.entity)} <bdi>{x.account}</bdi> · {catLabel(x.category)}</span>
                </span>
                <Money value={x.amount} currency={mergedCur} plus cents={false} class="text-[14px] {x.amount > 0 ? 'text-good' : 'text-ink'}" />
              </li>
            {/each}
          </ul>
        </section>

        <section class="panel rise min-w-0 p-5 sm:p-6 lg:col-span-3">
          <FlowCard {ts} currency={mergedCur} sub={isLiveYtd ? t("charts.merged.live") : periodLabel(p)} from={liveSpan.from} to={liveSpan.to} height={360} />
        </section>
      </div>
    {/if}
  {:else}
    {#if S.data && !S.data.txns.length}
      <div class="rise mt-5 rounded-2xl border border-line bg-panel p-5">
        <h2 class="text-[16px] text-ink">{t("home.start.title")}</h2>
        <p class="mt-1 max-w-[60ch] text-[14px] text-sub">{t("home.start.text")}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" icon="upload" href="/documents">{t("home.start.import")}</Button>
          <Button href="/connections">{t("home.start.connect")}</Button>
        </div>
      </div>
    {/if}

    {#if ask}
      <a
        href="{BASE}/review"
        class="rise mt-5 flex w-full items-center gap-3 rounded-2xl border border-warn/25 bg-warn/8 px-4 py-3 text-start outline-none transition hover:bg-warn/12 focus-visible:ring-2 focus-visible:ring-accent/50 sm:px-5">
        <span class="grid size-8 shrink-0 place-items-center rounded-full bg-warn/15 text-warn"><Icon name="sparkle" size={16} /></span>
        <span class="min-w-0 flex-1 text-[14px] text-ink">{t("home.ask", { n: ask })} <span class="text-sub max-sm:hidden">· {t("home.askHint")}</span></span>
        <span class="shrink-0 text-[14px] whitespace-nowrap text-accent-ink">{t("home.reviewGo")}</span>
      </a>
    {/if}

    <div class="mt-5 grid grid-flow-dense gap-4 lg:grid-cols-3">
      {#each L.order.filter((id) => !L.hidden.has(id)) as id (id)}
        <div class="min-w-0 {SPAN[id]}">{@render CARD[id]()}</div>
      {/each}
    </div>
  {/if}
</div>

{#snippet metrics()}
  <section class="grid grid-cols-2 gap-3 sm:grid-cols-3 {us ? 'lg:grid-cols-5' : ''}" aria-label={t("home.m.title")}>
    <Metric label={t("home.m.netCash")} hint={t("home.m.netCashHint")} class="max-sm:col-span-2">
      <Money value={cf.net} currency={cur} cents={false} plus class={cf.net < 0 ? "text-bad" : ""} />
      {#snippet foot()}
        {#if cfDelta?.kind === "pct"}
          {@const good = cfDelta.value >= 0}
          <span dir="ltr" class="num inline-flex h-[22px] shrink-0 items-center gap-0.5 rounded-full px-1.5 whitespace-nowrap {good ? 'bg-good/12 text-good' : 'bg-bad/12 text-bad'}">
            <Icon name={good ? "arrow-up-right" : "arrow-down-left"} size={12} />{Math.abs(cfDelta.value).toFixed(1)}%
          </span><span>{t("stat.vsPrior")}</span>
        {:else if cfDelta}
          <span>{t("home.m.vsAbs", { amount: signed(cfDelta.value) })}</span>
        {/if}
      {/snippet}
    </Metric>
    <Metric label={t(bn?.kind === "build" ? "home.m.build" : "home.m.burn")} hint={bn ? t("home.m.burnHint") : t("home.m.needHistory")}>
      {#if bn}<Money value={Math.abs(bn.avg)} currency={cur} cents={false} class={bn.kind === "build" ? "text-good" : ""} />{:else}<span class="text-faint">—</span>{/if}
    </Metric>
    <Metric label={t(bn?.kind === "build" ? "home.m.coverage" : "home.m.runway")} hint={bn?.kind === "build" ? t("home.m.coverageHint") : t("home.m.runwayHint")}>
      {#if bn}<span class="num">{mo(bn.kind === "build" ? bn.coverage : bn.runway)}</span>{:else}<span class="text-faint">—</span>{/if}
    </Metric>
    {#if us}
      <Metric label={t("home.m.netMargin")} hint={mg ? t("home.m.netMarginHint") : t("home.m.needRevenue")}>
        {#if mg}<span class="num {mg.net < 0 ? 'text-bad' : ''}">{pctLabel(mg.net)}</span>{:else}<span class="text-faint">—%</span>{/if}
      </Metric>
      <Metric label={t("home.m.expenseRatio")} hint={mg ? t("home.m.expenseRatioHint") : t("home.m.needRevenue")}>
        {#if mg}<span class="num">{pctLabel(mg.expenseRatio)}</span>{:else}<span class="text-faint">—%</span>{/if}
      </Metric>
    {/if}
  </section>
{/snippet}

{#snippet overview()}
  <div class="grid gap-4 lg:grid-cols-3">
    <section class="panel glow rise min-w-0 p-5 sm:p-6">
      {#if us}
        <Stat
          label={t("home.cash")}
          value={cash}
          currency={cur}
          delta={delta(cash, prevCash)}
          hint={p.to >= thisMonth ? t("home.today") : t("home.endOf", { month: monthYear(p.to) })} />
        <div class="mt-5"><Area points={cashPts} label={t("home.cash")} valueLabel={t("home.cashShort")} currency={cur} /></div>
        <h2 class="mt-5 text-[13px] text-sub">{t("home.byAccount")}</h2>
        <BarList
          bind:focus={hl}
          currency={cur}
          items={Object.entries(bal).map(([a, v]) => ({ key: a, label: a, value: v, color: isCard(a) ? "var(--color-s2)" : "var(--color-s1)" }))}
          onselect={(k) => go("transactions", `account:${k}`)} />
      {:else}
        <Stat label={t("common.moneyIn")} value={moneyIn} currency={cur} delta={delta(moneyIn, sumOf(prevTs))} hint={t("home.payments", { n: ts.length })} />
        <div class="mt-5"><Area points={cashPts} label={t("common.moneyIn")} valueLabel={t("home.inShort")} currency={cur} /></div>
        <h2 class="mt-5 text-[13px] text-sub">{t("home.byKind")}</h2>
        <BarList bind:focus={hl} currency={cur} items={inByType} onselect={(k) => go("transactions", `type:${k}`)} />
      {/if}
    </section>

    <section class="panel rise min-w-0 p-5 sm:p-6" style="animation-delay:60ms">
      <Stat label={us ? t("home.mode.revenue") : t("home.mode.business")} value={revenue} currency={cur} delta={delta(revenue, prevRevenue)} hint={!us && zair ? t("home.taxedAt70") : ""} />
      {#if revLines.length}
        <h2 class="mt-5 text-[13px] text-sub">{t("home.byLedger")}</h2>
        <BarList bind:focus={hl} currency={cur} items={revLines} onselect={(k) => go("transactions", `cat:${k}`)} />
      {:else}
        <p class="py-6 text-[14px] text-sub">{t("home.noRevenue")}</p>
      {/if}
    </section>

    <section class="panel rise min-w-0 p-5 sm:p-6" style="animation-delay:120ms">
      {#if us}
        <Stat label={t("home.mode.expenses")} value={expenses} currency={cur} delta={delta(expenses, prevExpenses)} invert />
        {#if expLines.length}
          <h2 class="mt-5 text-[13px] text-sub">{t("home.byLedger")}</h2>
          <BarList bind:focus={hl} currency={cur} items={expLines} onselect={(k) => go("transactions", `cat:${k}`)} />
        {/if}
      {:else if tb}
        <div class="flex flex-wrap items-start justify-between gap-2">
          <Stat
            label={t(tb.balance < 0 ? "home.refund" : "home.taxToPay", { year: S.year })}
            value={Math.abs(tb.balance)}
            currency={cur}
            class={tb.balance <= 0 ? "[&_[data-ui=money]]:text-good" : "[&_[data-ui=money]]:text-bad"}
            hint={t("home.afterPoints", { points: tb.points.toFixed(2) })} />
          {#if tb.unresolvedHoldings.length || tb.missingFx.length}
            <Badge size="sm" tone="warn">{t("legal.1301.incomplete")}</Badge>
          {/if}
        </div>
        <dl class="mt-5 divide-y divide-line text-[14px]">
          {#each [[t("home.turnover"), tb.turnover], [t("home.taxable"), tb.taxable], [t("home.taxBefore"), tb.gross], [t("home.credits"), -(tb.credits + tb.otherCredits + tb.f1324.credit)], [t("home.withheld"), -(tb.withheld + tb.advances)]] as const as [l, v] (l)}
            <div class="flex items-baseline justify-between gap-3 py-2.5"><dt class="min-w-0 text-ink-2">{l}</dt><dd><Money value={v} currency={cur} cents={false} /></dd></div>
          {/each}
        </dl>
        {#if zair && tb.ceiling}
          <div class="mt-4">
            <div class="flex flex-wrap justify-between gap-x-3 text-[12px] text-sub">
              <span>{t("home.zairCeiling")}</span><span>{t("home.pctOf", { pct: Math.round(ceilPct), total: fmt(tb.ceiling) })}</span>
            </div>
            <div
              class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill"
              role="progressbar"
              aria-label={t("home.zairCeiling")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.round(ceilPct))}>
              <div class="h-full rounded-full bg-linear-to-r from-s1 to-s3 rtl:bg-linear-to-l" style:width="{Math.min(100, ceilPct)}%"></div>
            </div>
          </div>
        {/if}
        <div class="mt-5"><Button iconEnd="arrow" href="/tax/il">{t("home.open1301")}</Button></div>
      {/if}
    </section>
  </div>
{/snippet}

{#snippet chartCard()}
  <section class="panel rise min-w-0 p-5 sm:p-6" style="animation-delay:180ms">
    <div class="mb-5 flex flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1 basis-60">
        <h2 class="text-[16px] text-ink">{t(mode === "profit" ? "home.chart.pl" : mode === "inout" ? "home.chart.inout" : mode === "expenses" ? "home.chart.spending" : mode === "in" ? "home.chart.in" : "home.chart.earnings")}</h2>
        <p class="text-[13px] text-sub">
          {periodLabel(p)} · {mode === "profit" ? t("home.chart.net", { amount: fmt(now.net) }) : mode === "inout" ? t("home.chart.net", { amount: fmt(cf.net) }) : t("home.chart.hint")}
        </p>
      </div>
      <Segmented bind:value={mode} items={MODES} label={t("home.chart.mode")} />
    </div>
    {#key mode}<Bars bind:focus={hl} {...chart} height={300} currency={cur} label={t("home.chart.mode")} onselect={(r) => go("transactions", `month:${r.key}`)} />{/key}
  </section>
{/snippet}

{#snippet recentCard()}
  <section class="panel rise min-w-0 overflow-hidden" style="animation-delay:240ms">
    <div class="flex items-baseline gap-3 px-4 pt-5 pb-2 sm:px-5">
      <h2 class="flex-1 text-[16px] text-ink">{t("home.recent")}</h2>
      <a href="{BASE}/transactions" class="rounded text-[14px] whitespace-nowrap text-accent-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50">{t("home.viewAll")}</a>
    </div>
    <ul>
      {#each recent as x (x.id)}
        <li class="border-t border-line first:border-t-0">
          <button
            type="button"
            onclick={() => (S.drawer = x.id)}
            class="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 text-start outline-none hover:bg-hover focus-visible:bg-hover sm:grid-cols-[7.5rem_1fr_minmax(0,14rem)_auto] sm:px-5">
            <span class="text-[13px] whitespace-nowrap text-sub tabular-nums max-sm:order-3">{mdy(x.date)}</span>
            <span class="ui-align min-w-0 truncate text-[14px] text-ink max-sm:order-1" dir="auto">{x.who ? `${x.who} · bit` : x.desc}</span>
            <span class="min-w-0 truncate text-[13px] max-sm:order-4 max-sm:text-end {x.category === 'ask' ? 'text-warn' : 'text-ink-2'}">{catLabel(x.category)}</span>
            <Money value={x.amount} currency={cur} plus class="text-[14px] max-sm:order-2 {x.amount > 0 ? 'text-good' : 'text-ink'}" />
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

{#snippet flow()}
  <section class="panel rise min-w-0 p-5 sm:p-6"><FlowCard {ts} currency={cur} sub={periodLabel(p)} from={p.from} to={p.to} /></section>
{/snippet}
{#snippet inout()}
  <section class="panel rise h-full min-w-0 p-5 sm:p-6"><InOutCard to={p.to} currency={cur} /></section>
{/snippet}
{#snippet insights()}
  <section class="panel rise h-full min-w-0 p-5 sm:p-6"><Insights {p} /></section>
{/snippet}
{#snippet networth()}
  <section class="panel rise h-full min-w-0 p-5 sm:p-6"><NetWorthCard currency={cur} /></section>
{/snippet}
{#snippet recurring()}
  <section class="panel rise h-full min-w-0 p-5 sm:p-6">
    <div class="mb-3 flex items-baseline gap-3">
      <h2 class="flex-1 text-[16px] text-ink">{t("charts.rec.title")}</h2>
      <a href="{BASE}/reports/flow" class="rounded text-[14px] whitespace-nowrap text-accent-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50">{t("home.viewAll")}</a>
    </div>
    <RecurringList currency={cur} limit={4} />
  </section>
{/snippet}

<Dialog bind:open={customize} title={t("charts.card.customize")} description={t("charts.card.customizeHint")} size="sm">
  <ul class="divide-y divide-line">
    {#each L.order as id, i (id)}
      <li class="flex items-center gap-1 py-1.5">
        <Switch class="flex-1" label={t(`charts.card.${id}`)} checked={!L.hidden.has(id)} onchange={(on) => toggle(id, on)} />
        <IconButton size="sm" icon="chevron-up" label={t("charts.card.up", { name: t(`charts.card.${id}`) })} disabled={i === 0} onclick={() => saveLayout(move(L.order, id, -1), L.hidden)} />
        <IconButton size="sm" icon="chevron-down" label={t("charts.card.down", { name: t(`charts.card.${id}`) })} disabled={i === L.order.length - 1} onclick={() => saveLayout(move(L.order, id, 1), L.hidden)} />
      </li>
    {/each}
  </ul>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => saveDoc("home-layout", null)}>{t("charts.card.reset")}</Button>
    <Button variant="primary" onclick={() => (customize = false)}>{t("common.done")}</Button>
  {/snippet}
</Dialog>
