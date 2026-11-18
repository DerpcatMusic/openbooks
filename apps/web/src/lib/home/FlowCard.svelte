<script lang="ts">
  // "Where the money went": the period's cash-flow sankey, by ledger account or by counterparty. A node opens its transactions.
  import type { Txn } from "@openbooks/schema";
  import { catLabel } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Money, Sankey, Segmented } from "#lib/ui/index.ts";
  import { go } from "#lib/reports/go.ts";
  import { flowData, flowKey, type FlowMode } from "./flow.ts";
  let { ts, currency, sub = "", height = 320 }: { ts: readonly Txn[]; currency: string; sub?: string; height?: number } = $props();
  let mode = $state<FlowMode>("account");
  const f = $derived(flowData(ts, mode, catLabel, t("charts.flow.other")));
  const tin = $derived(f.sources.reduce((a, s) => a + s.value, 0)),
    tout = $derived(f.targets.reduce((a, s) => a + s.value, 0));
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
  <div class="min-w-0 flex-1 basis-60">
    <h2 class="text-[16px] text-ink">{t("charts.flow.title")}</h2>
    <p class="text-[13px] text-sub">
      {#if sub}{sub} ·{/if}
      {t("charts.flow.in")} <Money value={tin} {currency} cents={false} class="text-ink-2" /> · {t("charts.flow.out")} <Money value={tout} {currency} cents={false} class="text-ink-2" />
    </p>
  </div>
  <Segmented
    value={mode}
    onchange={(k) => (mode = k as FlowMode)}
    size="sm"
    label={t("charts.flow.by")}
    items={[
      { key: "account", label: t("charts.flow.byAccount") },
      { key: "payer", label: t("charts.flow.byPayer") },
    ]} />
</div>
<Sankey
  sources={f.sources}
  targets={f.targets}
  {currency}
  {height}
  label={t("charts.flow.title")}
  mid={{ key: "mid", label: t("charts.flow.total"), color: "var(--color-s6)" }}
  surplus={{ key: "~surplus", label: t("charts.flow.surplus"), color: "var(--color-good)" }}
  deficit={{ key: "~deficit", label: t("charts.flow.deficit"), color: "var(--color-bad)" }}
  onselect={(n) => {
    const k = flowKey(n.key);
    if (k) void go("transactions", mode === "account" ? `cat:${k}` : k);
  }} />
