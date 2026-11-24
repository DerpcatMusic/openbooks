<script lang="ts">
  // Net worth across every business and account (GET /api/networth?currency=&from=&to=). A server without the endpoint, or with no
  // balances yet, gets a quiet empty state instead of an error.
  import { request } from "#lib/api.ts";
  import { S, mdy } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { EmptyState, NetWorth, Skeleton, type NetWorthData, type NetWorthRange } from "#lib/ui/index.ts";
  import { rangeStart } from "#lib/ui/networth.ts";
  let { currency: initial }: { currency: string } = $props();
  // svelte-ignore state_referenced_locally (the entity's currency is only the starting choice)
  let currency = $state(initial === "USD" ? "USD" : "ILS"),
    range = $state<NetWorthRange>("1y"),
    data = $state<NetWorthData | null>(null),
    failed = $state(false);
  const today = new Date().toLocaleDateString("sv");
  $effect(() => {
    void S.v;
    void S.rev;
    const q = new URLSearchParams({ currency, from: rangeStart(range, today), to: today });
    let stale = false;
    request<NetWorthData>(`/api/networth?${q}`)
      .then((d) => {
        if (stale) return;
        data = d && Array.isArray(d.dates) && Array.isArray(d.series) ? { ...d, missing: d.missing ?? [] } : null;
        failed = !data;
      })
      .catch(() => !stale && (failed = true));
    return () => (stale = true);
  });
  const name = (id: string) => S.data?.entities.find((e) => e.id === id)?.name ?? id;
</script>

<h2 class="mb-4 text-[16px] text-ink">{t("charts.nw.title")}</h2>
{#if data && data.dates.length && data.series.length}
  <NetWorth {data} bind:currency bind:range label={t("charts.nw.title")} entityLabel={name} dateLabel={mdy} />
{:else if failed || data}
  <EmptyState icon="wallet" title={t("charts.nw.emptyTitle")} text={t("charts.nw.emptyText")} compact />
{:else}
  <Skeleton height="220px" />
{/if}
