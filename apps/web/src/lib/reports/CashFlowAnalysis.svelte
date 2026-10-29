<script lang="ts">
  // Cash flow analysis (Mercury Books' report): charts of the ending balance and the net movement, a Monthly / Quarterly switch, the
  // year and month chips, then the table: starting balances, movement per ledger account, ending balances (the math: cashflow.ts).
  // The year is the app's tax year (S.year), so a click on a row drills into the same year's transactions.
  import { S, ent, banks, catLabel, mon } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Area, Bars, Button, EmptyState, Segmented, Select } from "#lib/ui/index.ts";
  import { cashFlow, cfaLines, spans, type Gran, type Span } from "./cashflow.ts";
  import { saveCsv } from "./download.ts";
  import { go } from "./go.ts";
  import Statement from "./Statement.svelte";
  import { toCsv, type Line } from "./statements.ts";

  const cur = $derived(ent().currency ?? "USD");
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  let gran = $state<Gran>("monthly"),
    off = $state<Record<number, boolean>>({}); // months switched off with the chips
  const year = $derived(S.year);
  const years = $derived([...new Set([...(S.data?.years ?? []), year])].sort((a, b) => b - a));
  const bk = $derived(banks());
  // a quarter stays while any of its months is on
  const cols = $derived(
    cashFlow(
      S.data!.txns,
      bk,
      spans(year, gran, today).filter((s) => s.months.some((m) => !off[m])),
    ),
  );
  const label = (s: Span) =>
    s.mtd
      ? t(gran === "monthly" ? "cfa.mtd" : "cfa.qtd")
      : gran === "monthly"
        ? `${mon(s.n - 1)} ${String(year).slice(2)}`
        : t("cfa.quarter", { n: s.n, yy: String(year).slice(2) });
  const head = $derived(cols.map((c) => label(c.span)));
  const lines = $derived(cfaLines(cols, bk, t, catLabel));
  const idle = $derived(!bk.length || !S.data!.txns.some((x) => x.date.startsWith(`${year}-`) && bk.includes(x.account)));

  const drill = (l: Line) => l.key && go("transactions", l.key === "ask" || l.key.startsWith("account:") ? l.key : `cat:${l.key}`);

  const exportCsv = () => saveCsv(`${ent().short ?? "books"} ${t("reports.tab.cfa")} ${year}`, toCsv([t("cfa.account"), ...head], lines));
  const chip = "num h-7 rounded-full px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40";
</script>

<div class="flex flex-wrap items-center gap-x-4 gap-y-3 print:hidden">
  <Segmented
    value={gran}
    onchange={(k) => (gran = k as Gran)}
    items={[
      { key: "monthly", label: t("reports.monthly") },
      { key: "quarterly", label: t("reports.quarterly") },
    ]}
    label={t("reports.tab.cfa")} />
  <Select
    variant="pill"
    label={t("cfa.year")}
    value={String(year)}
    options={years.map((y) => ({ value: String(y), label: String(y) }))}
    onchange={(v) => ((S.year = +v), (S.period = null))} />
  <span class="flex-1"></span>
  <Button icon="download" onclick={exportCsv} disabled={idle}>{t("reports.exportCsv")}</Button>
</div>
<div class="mt-3 flex flex-wrap gap-1.5 print:hidden" role="group" aria-label={t("cfa.months")}>
  {#each Array.from({ length: 12 }, (_, i) => i + 1) as m (m)}
    {@const future = `${year}-${pad(m)}-01` > today}
    {@const on = !future && !off[m]}
    <button type="button" disabled={future} aria-pressed={on} onclick={() => (off[m] = !off[m])} class="{chip} {on ? 'bg-ink text-panel' : 'bg-fill text-ink-2 hover:text-ink'}">{mon(m - 1)}</button>
  {/each}
</div>

{#if idle || !cols.length}
  <div class="panel mt-5"><EmptyState icon="report" title={t("cfa.empty", { year })} text={t("cfa.emptyHint")} /></div>
{:else}
  <div class="mt-5 grid gap-4 md:grid-cols-2">
    <section class="panel min-w-0 p-4 sm:p-5">
      <h2 class="mb-3 text-[14px] text-ink-2">{t("cfa.endingChart")}</h2>
      <Area points={cols.map((c) => ({ label: label(c.span), v: c.endTotal }))} label={t("cfa.endingChart")} currency={cur} height={200} />
    </section>
    <section class="panel min-w-0 p-4 sm:p-5">
      <h2 class="mb-3 text-[14px] text-ink-2">{t("cfa.netChart")}</h2>
      <Bars
        height={200}
        layout="group"
        legend={false}
        label={t("cfa.netChart")}
        currency={cur}
        rows={cols.map((c) => ({ key: c.span.key, label: label(c.span), v: { net: c.net } }))}
        series={[{ key: "net", label: t("cfa.netChart"), color: "var(--color-s1)" }]} />
    </section>
  </div>
  <div class="panel mt-4 overflow-hidden">
    <Statement {lines} cols={head} first={t("cfa.account")} caption={t("reports.tab.cfa")} currency={cur} userLabels onopen={drill} />
  </div>
  <p class="mt-3 text-[13px] text-sub">{t("cfa.note")}</p>
{/if}
