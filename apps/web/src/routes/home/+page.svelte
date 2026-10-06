<script lang="ts">
  import { BASE } from "#lib/nav.ts";
  // Home (port of web/src/views/Home.svelte): greeting, review nudge, three headline cards (cash or money in · revenue ·
  // expenses or the Israeli tax estimate), the big monthly chart (earnings / spending / P&L, or business vs all money in) and
  // recent activity. Every number compares with the prior period of the same length; hovering a type anywhere spotlights it.
  import { group, isCard, pl, priorPeriod, TYPES } from "@openbooks/core";
  import { form1301 } from "@openbooks/country-il";
  import type { IlTable } from "@openbooks/country-il";
  import type { Txn } from "@openbooks/schema";
  import { S, ent, isUS, bizType, period, periodTxns, periodLabel, monthsIn, balances, catLabel, typeLabel, taxTable, yearTxns, fmt, mdy, mon, monthYear, SERIES } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Area, BarList, Bars, Button, Icon, Money, Segmented, Stat } from "#lib/ui/index.ts";
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
  const sumOf = (xs: readonly Txn[]) => xs.reduce((a, x) => a + x.amount, 0);

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
    for (const x of ts) m.set(group(x.category), (m.get(group(x.category)) ?? 0) + x.amount);
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
        if (ls.some((l) => l.key === k)) v[k] = (v[k] ?? 0) + sign * x.amount;
      }
      return { key: ym, label: ml(ym), sub: monthYear(ym), v };
    });

  // the big chart: each earning (or spending) type per month
  let mode = $state("revenue"),
    hl = $state<string | null>(null); // the ledger account / type hovered anywhere on the page
  const MODES = $derived(
    us
      ? [
          { key: "revenue", label: t("home.mode.revenue") },
          { key: "expenses", label: t("home.mode.expenses") },
          { key: "profit", label: t("home.mode.profit") },
        ]
      : [
          { key: "revenue", label: t("home.mode.business") },
          { key: "in", label: t("home.mode.in") },
        ],
  );
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
    const lines = mode === "revenue" ? revLines : mode === "expenses" ? expLines : inByType;
    return {
      series: series(lines),
      layout: "stack" as const,
      line: null,
      rows: perMonth(lines, mode === "in" ? (x) => group(x.category) : (x) => x.category, mode === "expenses" ? -1 : 1),
    };
  });

  // Israel: this tax year's return in brief (form1301 from the IL pack, with the user's typed form values)
  const zair = $derived(bizType() === "osek-zair");
  const tb = $derived.by(() => {
    if (us) return null;
    const T = taxTable(S.year) as unknown as IlTable & { zairCeiling?: number };
    const r = form1301({ y: S.year, txns: yearTxns(), type: bizType() ?? "", T, form: S.data!.form[S.year] ?? {}, profile: S.data!.profile });
    return { ...r, ceiling: T.zairCeiling ?? 0 };
  });
  const ceilPct = $derived(tb?.ceiling ? (tb.turnover / tb.ceiling) * 100 : 0);

  const recent = $derived(ts.filter((x) => group(x.category) !== "transfer").slice(-7).reverse());
  const ask = $derived(S.data!.txns.filter((x) => x.category === "ask").length);
  const first = $derived(String(S.data!.profile.owner ?? "").split(" ")[0] || String(S.data!.profile.first ?? ""));
  const hour = new Date().getHours();
  const thisMonth = new Date().toISOString().slice(0, 7);
</script>

<div class="px-4 pt-6 pb-10 sm:px-8">
  <div class="flex flex-wrap items-end gap-3">
    <div class="min-w-0 flex-1 basis-60">
      <div class="text-[13px] text-sub">{ent().flag} <bdi>{ent().name}</bdi></div>
      <h1 class="display mt-0.5 text-[28px] leading-9 text-ink [overflow-wrap:anywhere]">
        {t(hour < 12 ? "home.greet.morning" : hour < 18 ? "home.greet.afternoon" : "home.greet.evening")}{#if first}, <bdi>{first}</bdi>{/if}
      </h1>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <PeriodPicker />
      <Button icon="upload" href="/documents">{t("common.import")}</Button>
    </div>
  </div>

  {#if ask}
    <a
      href="{BASE}/review"
      class="rise mt-5 flex w-full items-center gap-3 rounded-2xl border border-warn/25 bg-warn/8 px-4 py-3 text-start outline-none transition hover:bg-warn/12 focus-visible:ring-2 focus-visible:ring-accent/50 sm:px-5">
      <span class="grid size-8 shrink-0 place-items-center rounded-full bg-warn/15 text-warn"><Icon name="sparkle" size={16} /></span>
      <span class="min-w-0 flex-1 text-[14px] text-ink">{t("home.ask", { n: ask })} <span class="text-sub max-sm:hidden">· {t("home.askHint")}</span></span>
      <span class="shrink-0 text-[14px] whitespace-nowrap text-accent-ink">{t("home.reviewGo")}</span>
    </a>
  {/if}

  <div class="mt-5 grid gap-4 lg:grid-cols-3">
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
        <div class="mt-5">
          <Bars bind:focus={hl} compact legend={false} height={80} label={t("home.chart.earnings")} currency={cur} series={series(revLines)} rows={perMonth(revLines, (x) => x.category)} />
        </div>
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
          <div class="mt-5">
            <Bars bind:focus={hl} compact legend={false} height={80} label={t("home.chart.spending")} currency={cur} series={series(expLines)} rows={perMonth(expLines, (x) => x.category, -1)} />
          </div>
          <h2 class="mt-5 text-[13px] text-sub">{t("home.byLedger")}</h2>
          <BarList bind:focus={hl} currency={cur} items={expLines} onselect={(k) => go("transactions", `cat:${k}`)} />
        {/if}
      {:else if tb}
        <Stat
          label={t(tb.balance < 0 ? "home.refund" : "home.taxToPay", { year: S.year })}
          value={Math.abs(tb.balance)}
          currency={cur}
          class={tb.balance <= 0 ? "[&_[data-ui=money]]:text-good" : "[&_[data-ui=money]]:text-bad"}
          hint={t("home.afterPoints", { points: tb.points.toFixed(2) })} />
        <dl class="mt-5 divide-y divide-line text-[14px]">
          {#each [[t("home.turnover"), tb.turnover], [t("home.taxable"), tb.taxable], [t("home.taxBefore"), tb.gross], [t("home.credits"), -tb.credits], [t("home.withheld"), -tb.withheld]] as const as [l, v] (l)}
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

  <section class="panel rise mt-4 min-w-0 p-5 sm:p-6" style="animation-delay:180ms">
    <div class="mb-5 flex flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1 basis-60">
        <h2 class="text-[16px] text-ink">{t(mode === "profit" ? "home.chart.pl" : mode === "expenses" ? "home.chart.spending" : mode === "in" ? "home.chart.in" : "home.chart.earnings")}</h2>
        <p class="text-[13px] text-sub">{periodLabel(p)} · {mode === "profit" ? t("home.chart.net", { amount: fmt(now.net) }) : t("home.chart.hint")}</p>
      </div>
      <Segmented bind:value={mode} items={MODES} label={t("home.chart.mode")} />
    </div>
    {#key mode}<Bars bind:focus={hl} {...chart} height={300} currency={cur} label={t("home.chart.mode")} onselect={(r) => go("transactions", `month:${r.key}`)} />{/key}
  </section>

  <section class="panel rise mt-4 min-w-0 overflow-hidden" style="animation-delay:240ms">
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
</div>
