<script lang="ts">
  // Live markets strip at the bottom of Home (GET /api/markets).
  // Shown across merged, Israeli-only, and US-only home views, ordered by business context.
  // Public market values are never passed through privacy scramble() or <Money>, nor tagged with dir="auto"/<bdi>.
  import { api, type MarketQuote, type MarketsResponse } from "#lib/api.ts";
  import { has, locale, t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Icon, IconButton, Skeleton } from "#lib/ui/index.ts";
  import { moneyParts } from "#lib/ui/money.ts";

  let { context = "merged" }: { context?: "merged" | "il" | "us" } = $props();

  const uid = $props.id();
  let data = $state<MarketsResponse | null>(null);
  let loading = $state(true);
  let refreshing = $state(false);
  let failed = $state(false);

  const INDEX_FMT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const FX_FMT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const YIELD_FMT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

  function formatLast(q: MarketQuote): string {
    if (q.format === "price") {
      const m = moneyParts(q.last, q.currency ?? "USD");
      const showCents = Math.abs(q.last) < 10_000;
      return `${m.sign}${m.symbol}${m.whole}${showCents ? `.${m.cents}` : ""}`;
    }
    if (q.format === "fx") return FX_FMT.format(q.last);
    if (q.format === "yield") return `${YIELD_FMT.format(q.last)}%`;
    return INDEX_FMT.format(q.last);
  }

  function formatPct(pct: number): string {
    const abs = Math.abs(pct);
    return `${abs.toFixed(abs >= 10 ? 1 : 2)}%`;
  }

  function formatAsOf(iso: string | null | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return new Intl.DateTimeFormat(locale(), sameDay ? { timeStyle: "short" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  }

  function quoteLabel(q: MarketQuote): string {
    const key = `markets.inst.${q.id}`;
    return has(key) ? t(key) : q.label;
  }

  function sparkGeometry(series: readonly number[], w = 72, h = 26) {
    if (series.length < 2) return null;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    const pad = 2;
    const pts = series.map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = pad + (1 - (v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = `M${pts.join(" L")}`;
    const area = `${line} L${w},${h} L0,${h} Z`;
    return { line, area };
  }

  function toneColor(q: MarketQuote): string {
    if (q.changePct == null || q.changePct === 0) return "var(--color-sub)";
    return q.changePct > 0 ? "var(--color-good)" : "var(--color-bad)";
  }

  let inflight = false;
  async function load(manual = false) {
    if (inflight) return;
    inflight = true;
    if (manual || data) refreshing = true;
    try {
      const res = await api.markets();
      data = res;
      failed = false;
    } catch {
      failed = !data;
    } finally {
      loading = false;
      refreshing = false;
      inflight = false;
    }
  }

  $effect(() => {
    let alive = true;
    const tick = () => {
      if (!alive || document.visibilityState !== "visible") return;
      void load();
    };
    void load();
    const timer = setInterval(tick, 60_000); // poll-ok: market quotes have no push source
    const onVis = () => {
      if (alive && document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  });

  const groups = $derived.by(() => {
    if (!data) return [];
    const order: readonly ("world" | "il")[] = context === "il" ? ["il", "world"] : ["world", "il"];
    return order
      .map((key) => ({
        key,
        title: t(key === "il" ? "markets.group.il" : "markets.group.world"),
        items: key === "il" ? data!.il : data!.world,
      }))
      .filter((g) => g.items.length > 0);
  });

  const anyStale = $derived(!!data && (data.stale || data.world.some((q) => q.stale) || data.il.some((q) => q.stale)));
  const asOfText = $derived(formatAsOf(data?.asOf));
</script>

<section class="panel rise mt-5 min-w-0 p-5 sm:p-6" aria-label={t("markets.title")}>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-[16px] text-ink">{t("markets.title")}</h2>
      {#if data?.delayed}
        <Badge size="sm">{t("markets.delayed")}</Badge>
      {/if}
      {#if anyStale}
        <Badge size="sm" tone="warn">{t("markets.stale")}</Badge>
      {/if}
    </div>
    <div class="flex items-center gap-2 text-[12px] text-sub">
      {#if asOfText}
        <span class="num">{t("markets.asOf", { time: asOfText })}</span>
      {/if}
      <IconButton
        size="sm"
        icon="refresh"
        label={t("markets.refresh")}
        disabled={refreshing}
        class={refreshing ? "[&_svg]:animate-spin" : ""}
        onclick={() => void load(true)} />
    </div>
  </div>

  {#if loading && !data}
    <div class="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {#each Array(8) as _, i (i)}
        <Skeleton class="h-[82px]" />
      {/each}
    </div>
  {:else if groups.length > 0}
    <div class="mt-4 space-y-4">
      {#each groups as group (group.key)}
        <div>
          <h3 class="mb-2 text-[12px] font-medium tracking-wide text-sub uppercase">{group.title}</h3>
          <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {#each group.items as q (q.id)}
              {@const name = quoteLabel(q)}
              {@const spark = sparkGeometry(q.series)}
              {@const color = toneColor(q)}
              {@const up = q.changePct != null && q.changePct > 0}
              {@const down = q.changePct != null && q.changePct < 0}
              <div
                class={[
                  "flex min-w-0 flex-col justify-between gap-1.5 rounded-xl border border-line bg-bg/50 px-3 py-2.5 transition-colors hover:border-line-strong",
                  q.stale && "opacity-75",
                ]}>
                <div class="flex items-baseline justify-between gap-2">
                  <span class="truncate text-[13px] font-medium text-ink">{name}</span>
                  <span class="shrink-0 text-[11px] text-faint" dir="ltr">{q.symbol}</span>
                </div>
                <div class="flex items-end justify-between gap-2">
                  <div class="min-w-0">
                    <div dir="ltr" class="num truncate text-[16px] leading-6 font-medium text-ink">{formatLast(q)}</div>
                    {#if q.changePct != null}
                      <span
                        dir="ltr"
                        class={[
                          "num mt-1 inline-flex h-[18px] items-center gap-0.5 rounded-full px-1.5 text-[11px] whitespace-nowrap",
                          up ? "bg-good/12 text-good" : down ? "bg-bad/12 text-bad" : "bg-fill text-sub",
                        ]}>
                        {#if up || down}<Icon name={up ? "arrow-up-right" : "arrow-down-left"} size={10} />{/if}{formatPct(q.changePct)}
                      </span>
                    {/if}
                  </div>
                  {#if spark}
                    <svg
                      viewBox="0 0 72 26"
                      class="h-[26px] w-[72px] shrink-0 overflow-visible"
                      role="img"
                      aria-label={t("markets.sparkline", { name })}>
                      <defs>
                        <linearGradient id="mk-{uid}-{q.id}" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0" stop-color={color} stop-opacity="0.24" />
                          <stop offset="1" stop-color={color} stop-opacity="0" />
                        </linearGradient>
                      </defs>
                      <path d={spark.area} fill="url(#mk-{uid}-{q.id})" />
                      <path d={spark.line} fill="none" stroke={color} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
                    </svg>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {:else if failed || data}
    <div class="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-bg/40 px-4 py-3 text-[13px] text-sub">
      <span>{t("markets.unavailable")}</span>
      <Button size="sm" variant="secondary" onclick={() => void load(true)}>{t("markets.retry")}</Button>
    </div>
  {/if}
</section>
