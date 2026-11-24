<script lang="ts">
  // "Where the money went": cash-flow sankey for this business or ALL businesses combined, with interactive bank/business
  // middle hubs that expand into child bank/card subtrees on click. Outer nodes open their transactions.
  import type { Txn } from "@openbooks/schema";
  import { api, type CombinedFlow } from "#lib/api.ts";
  import { S, catLabel, ent } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Money, Sankey, Segmented } from "#lib/ui/index.ts";
  import type { FlowNode } from "#lib/ui/sankey.ts";
  import { go } from "#lib/reports/go.ts";
  import { counts, flowData, flowKey, hubFlowData, type FlowMode, type HubFlowTxn } from "./flow.ts";

  let {
    ts,
    currency,
    sub = "",
    from = "",
    to = "",
    height = 320,
  }: {
    ts: readonly Txn[];
    currency: string;
    sub?: string;
    from?: string;
    to?: string;
    height?: number;
  } = $props();

  const multiEntity = $derived((S.data?.entities.length ?? 0) > 1);
  let mode = $state<FlowMode>("account");
  let scopePref = $state<"this" | "all" | null>(null);
  const scope = $derived<"this" | "all">(scopePref ?? (multiEntity ? "all" : "this"));
  let viaBanks = $state(true);
  let expanded = $state<string[]>([]);
  const expandedSet = $derived(new Set(expanded));

  // Derive date range from props or fallback to transactions' bounds
  const span = $derived.by(() => {
    if (from && to) return { from, to };
    const ds = ts.map((x) => x.date).filter(Boolean).sort();
    const y = S.year || new Date().getFullYear();
    return { from: ds[0] ?? `${y}-01-01`, to: ds.at(-1) ?? `${y}-12-31` };
  });

  // Fetch combined multi-entity flow at daily BoI FX rates when scope === "all"
  let combined = $state<CombinedFlow | null>(null);
  let combinedFailed = $state(false);
  $effect(() => {
    if (scope !== "all" || !multiEntity) return;
    void S.v;
    void S.rev;
    const { from: f, to: u } = span;
    const cur = currency;
    let stale = false;
    combinedFailed = false;
    api
      .flow(cur, f, u)
      .then((d) => {
        if (!stale) combined = d;
      })
      .catch(() => {
        if (!stale) combinedFailed = true;
      });
    return () => {
      stale = true;
    };
  });

  const localHubRows = $derived<HubFlowTxn[]>(
    ts
      .filter((x) => x.source !== "journal" && counts(x))
      .map((x) => ({
        entity: ent().id ?? "",
        entityName: ent().short || ent().name || ent().id || "",
        flag: ent().flag ?? "",
        account: x.account,
        category: x.category,
        desc: x.desc,
        who: x.who,
        amount: x.amount,
      })),
  );

  const activeRows = $derived<HubFlowTxn[]>(scope === "all" && multiEntity && combined && !combinedFailed ? combined.txns : localHubRows);
  const distinctAccounts = $derived(new Set(activeRows.map((r) => `${r.entity}:${r.account}`)).size);
  const useHubs = $derived(viaBanks && (scope === "all" || distinctAccounts > 1));

  const flat = $derived(flowData(ts, mode, catLabel, t("charts.flow.other")));
  const multi = $derived(
    useHubs
      ? hubFlowData(activeRows, {
          scope: scope === "all" && multiEntity && combined && !combinedFailed ? "all" : "this",
          mode,
          label: catLabel,
          other: t("charts.flow.other"),
          expandedEntities: expandedSet,
        })
      : null,
  );

  const tin = $derived(multi ? multi.totalIn : flat.sources.reduce((a, s) => a + s.value, 0));
  const tout = $derived(multi ? multi.totalOut : flat.targets.reduce((a, s) => a + s.value, 0));

  function handleHubClick(n: FlowNode) {
    if (n.key.startsWith("ent:") && n.expandable) {
      const id = n.key.slice(4);
      expanded = expandedSet.has(id) ? expanded.filter((x) => x !== id) : [...expanded, id];
    } else if (n.isChild && n.parentKey?.startsWith("ent:")) {
      const id = n.parentKey.slice(4);
      expanded = expanded.filter((x) => x !== id);
    }
  }

  const expandedNames = $derived(
    expanded
      .map((id) => combined?.entities.find((e) => e.id === id)?.name ?? S.data?.entities.find((e) => e.id === id)?.name ?? id)
      .join(", "),
  );
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
  <div class="min-w-0 flex-1 basis-60">
    <h2 class="text-[16px] text-ink">{t("charts.flow.title")}</h2>
    <p class="text-[13px] text-sub">
      {#if sub}{sub} ·{/if}
      {t("charts.flow.in")} <Money value={tin} {currency} cents={false} class="text-ink-2" /> · {t("charts.flow.out")} <Money value={tout} {currency} cents={false} class="text-ink-2" />
    </p>
  </div>
  <div class="flex flex-wrap items-center gap-2">
    {#if multiEntity}
      <Segmented
        value={scope}
        onchange={(k) => {
          scopePref = k as "this" | "all";
          expanded = [];
        }}
        size="sm"
        label={t("charts.flow.scope")}
        items={[
          { key: "this", label: t("charts.flow.scopeThis") },
          { key: "all", label: t("charts.flow.scopeAll") },
        ]} />
    {/if}
    {#if multiEntity || distinctAccounts > 1}
      <Button variant={viaBanks ? "primary" : "ghost"} size="sm" onclick={() => (viaBanks = !viaBanks)}>{t("charts.flow.viaBanks")}</Button>
    {/if}
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
</div>

{#if useHubs && scope === "all" && multiEntity}
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-sub">
    <span>{t("charts.flow.expandHint")}</span>
    {#if expanded.length}
      <div class="flex items-center gap-2">
        <Badge size="sm" tone="accent">{t("charts.flow.showingSubtree", { name: expandedNames })}</Badge>
        <Button variant="ghost" size="sm" onclick={() => (expanded = [])}>{t("charts.flow.collapseSubtree")}</Button>
      </div>
    {/if}
  </div>
{/if}

<Sankey
  sources={multi ? multi.sources : flat.sources}
  targets={multi ? multi.targets : flat.targets}
  hubs={multi ? multi.hubs : undefined}
  edges={multi ? multi.edges : undefined}
  {currency}
  height={useHubs ? Math.max(height, 360) : height}
  label={t("charts.flow.title")}
  mid={{ key: "mid", label: t("charts.flow.total"), color: "var(--color-s6)" }}
  surplus={{ key: "~surplus", label: t("charts.flow.surplus"), color: "var(--color-good)" }}
  deficit={{ key: "~deficit", label: t("charts.flow.deficit"), color: "var(--color-bad)" }}
  onhubclick={handleHubClick}
  onselect={(n) => {
    const k = flowKey(n.key);
    if (k) void go("transactions", mode === "account" ? `cat:${k}` : k);
  }} />

{#if scope === "all" && multiEntity && combined && !combinedFailed}
  <p class="mt-2.5 text-[11px] text-faint">{t("charts.flow.fxNote", { cur: currency })}</p>
{/if}
