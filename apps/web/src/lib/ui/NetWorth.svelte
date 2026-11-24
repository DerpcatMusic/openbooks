<script lang="ts">
  // Net worth over time (GET /api/networth's shape, see networth.ts): a gradient line with y ticks, a currency switch, range presets,
  // a hover / arrow-key crosshair whose card breaks the day down by entity and account, and a notice for days without an exchange rate.
  // Time runs left → right in both languages, like Bars and Area. Axis ticks through privacy axis(); amounts through Money.
  import { axis, scramble } from "../privacy.svelte.ts";
  import { moneyText } from "./money.ts";
  import { t } from "../i18n.svelte.ts";
  import Icon from "./Icon.svelte";
  import Money from "./Money.svelte";
  import Segmented from "./Segmented.svelte";
  import { ring } from "./styles.ts";
  import { breakdown, netSeries, rangeStart, type NetWorthData, type Range } from "./networth.ts";
  let {
    data,
    currency = $bindable("ILS"),
    range = $bindable<Range>("1y"),
    currencies = ["ILS", "USD"],
    entityLabel = (id: string) => id,
    dateLabel = (iso: string) => iso,
    label,
    height = 220,
  }: {
    data: NetWorthData;
    currency?: string;
    range?: Range;
    currencies?: string[];
    entityLabel?: (id: string) => string;
    dateLabel?: (iso: string) => string;
    label: string;
    height?: number;
  } = $props();
  const uid = $props.id();
  let w = $state(600),
    hover = $state(-1);
  const all = $derived(netSeries(data));
  const from = $derived(data.dates.length ? rangeStart(range, data.dates.at(-1)!) : "");
  const i0 = $derived(Math.max(0, data.dates.findIndex((d) => d >= from)));
  const idx = $derived(data.dates.map((_, i) => i).slice(i0));
  const pts = $derived(idx.map((i) => all[i]!));
  const padL = 48,
    padB = 24,
    padT = 8,
    H = $derived(height - padB - padT);
  const lo = $derived(Math.min(0, ...pts)),
    hi = $derived(Math.max(1, ...pts));
  const step = $derived.by(() => {
    const raw = (hi - lo) / 4,
      p = 10 ** Math.floor(Math.log10(raw || 1));
    return Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw);
  });
  const top = $derived(Math.ceil(hi / step) * step),
    bottom = $derived(Math.floor(lo / step) * step);
  const ticks = $derived(Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, i) => bottom + i * step));
  const X = (j: number) => padL + (pts.length < 2 ? (w - padL) / 2 : (j / (pts.length - 1)) * (w - padL));
  const Y = (v: number) => padT + H - ((v - bottom) / (top - bottom || 1)) * H;
  const d = $derived(pts.map((v, j) => `${j ? "L" : "M"}${X(j).toFixed(1)},${Y(v).toFixed(1)}`).join(""));
  const short = (v: number) => ((v = axis(v)), Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
  // about five date labels along the bottom
  const xl = $derived(pts.length ? [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (pts.length - 1))))] : []);
  const move = (e: PointerEvent) => {
    const r = (e.currentTarget as Element).getBoundingClientRect();
    hover = Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - r.left - padL) / (r.width - padL)) * (pts.length - 1))));
  };
  const key = (e: KeyboardEvent) => {
    const k = { ArrowLeft: -1, ArrowRight: 1, Home: -1e9, End: 1e9 }[e.key];
    if (k === undefined) return;
    e.preventDefault();
    hover = Math.max(0, Math.min(pts.length - 1, (hover < 0 ? pts.length - 1 : hover) + k));
  };
  const first = $derived(pts[0] ?? 0),
    last = $derived(pts.at(-1) ?? 0),
    diff = $derived(last - first);
  const bd = $derived(hover >= 0 ? breakdown(data, idx[hover]!) : []);
  const missing = $derived(data.missing.filter((m) => m.date >= from));
  const missingCur = $derived([...new Set(missing.map((m) => m.currency))].join(", "));
  const excludedNames = $derived((data.excluded ?? []).map((x) => x.account).join(", "));
  const RANGES = $derived((["3m", "6m", "1y", "ytd", "all"] as const).map((key) => ({ key, label: t(`charts.nw.range.${key}`) })));
  const cardW = $derived(Math.min(280, w));
</script>

<div data-ui="networth" class="min-w-0">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0 flex-1 basis-48">
      <div class="display text-[26px] leading-8 text-ink"><Money value={hover >= 0 ? pts[hover]! : last} {currency} cents={false} /></div>
      <div class="mt-0.5 text-[13px] text-sub">
        {#if hover >= 0}{dateLabel(data.dates[idx[hover]!]!)}{:else if pts.length > 1}
          <Money value={diff} {currency} cents={false} plus class={diff < 0 ? "text-bad" : "text-good"} /> · {t(`charts.nw.range.${range}`)}
        {/if}
      </div>
    </div>
    <div class="flex max-w-full flex-wrap items-center gap-2">
      <Segmented bind:value={currency} items={currencies.map((c) => ({ key: c, label: c }))} label={t("charts.nw.currency")} size="sm" />
      <Segmented value={range} onchange={(k) => (range = k as Range)} items={RANGES} label={t("charts.nw.range")} size="sm" class="max-w-full overflow-x-auto" />
    </div>
  </div>

  {#if excludedNames}
    <p class="mt-3 flex items-start gap-2 rounded-xl border border-line bg-tint px-3 py-2 text-[12px] text-sub" role="status">
      <Icon name="info" size={14} class="mt-0.5 shrink-0 text-faint" />
      <span>{t("charts.nw.excluded", { accounts: excludedNames })}</span>
    </p>
  {/if}

  {#if missing.length}
    <p class="mt-3 flex items-start gap-2 rounded-xl border border-warn/25 bg-warn/8 px-3 py-2 text-[13px] text-ink-2" role="status">
      <Icon name="info" size={15} class="mt-0.5 shrink-0 text-warn" />
      <span>{t("charts.nw.missing", { n: missing.length, cur: missingCur, date: dateLabel(missing[0]!.date) })}</span>
    </p>
  {/if}

  {#if pts.length}
    <!-- a slider over the days: arrows / Home / End move the crosshair and its breakdown card -->
    <div
      class={["relative mt-4 rounded-lg", ring]}
      dir="ltr"
      bind:clientWidth={w}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, pts.length - 1)}
      aria-valuenow={hover < 0 ? pts.length - 1 : hover}
      aria-valuetext="{dateLabel(data.dates[idx[hover < 0 ? pts.length - 1 : hover]!]!)}: {moneyText(scramble(hover < 0 ? last : pts[hover]!), currency, false)}"
      tabindex="0"
      onkeydown={key}
      onblur={() => (hover = -1)}>
      <svg width={w} {height} class="block touch-pan-y overflow-visible" onpointermove={move} onpointerleave={() => (hover = -1)} aria-hidden="true">
        <defs
          ><linearGradient id="nw{uid}" x1="0" x2="0" y1="0" y2="1"
            ><stop offset="0" stop-color="var(--color-s1)" stop-opacity="0.26" /><stop offset="1" stop-color="var(--color-s1)" stop-opacity="0" /></linearGradient
          ></defs>
        {#each ticks as tk (tk)}
          <line x1={padL} x2={w} y1={Y(tk)} y2={Y(tk)} stroke="var(--color-line)" stroke-dasharray={tk === 0 ? "" : "2 3"} />
          <text x={padL - 10} y={Y(tk) + 4} text-anchor="end" class="num fill-faint text-[11px]">{short(tk)}</text>
        {/each}
        <path d="{d}L{X(pts.length - 1)},{Y(bottom)}L{X(0)},{Y(bottom)}Z" fill="url(#nw{uid})" />
        <path {d} fill="none" stroke="var(--color-s1)" stroke-width="2" stroke-linejoin="round" />
        {#each xl as j (j)}
          <text x={X(j)} y={height - 6} text-anchor={j === 0 ? "start" : j === pts.length - 1 ? "end" : "middle"} class="fill-faint text-[11px]">{dateLabel(data.dates[idx[j]!]!)}</text>
        {/each}
        {#if hover >= 0}
          <line x1={X(hover)} x2={X(hover)} y1={padT} y2={padT + H} stroke="var(--color-line-strong)" />
          <circle cx={X(hover)} cy={Y(pts[hover]!)} r="4.5" fill="var(--color-panel)" stroke="var(--color-s1)" stroke-width="2" />
        {/if}
      </svg>
      {#if hover >= 0 && bd.length}
        <div
          class="pointer-events-none absolute z-20 max-h-[260px] overflow-hidden rounded-xl border border-line-strong bg-panel/95 p-3 text-[12px] shadow-[var(--shadow)] backdrop-blur"
          dir="auto"
          style:width="{cardW}px"
          style:top="{padT}px"
          style:left="{X(hover) + 14 + cardW > w ? Math.max(0, X(hover) - 14 - cardW) : X(hover) + 14}px">
          {#each bd as e (e.entity)}
            <div class="flex items-baseline gap-2 border-b border-line pb-1 not-first:mt-2">
              <span class="min-w-0 flex-1 truncate text-ink">{entityLabel(e.entity)}</span><Money value={e.total} {currency} cents={false} class="text-ink" />
            </div>
            {#each e.accounts.slice(0, 6) as a (a.account)}
              <div class="flex items-baseline gap-2 py-0.5">
                <span class="min-w-0 flex-1 truncate text-ink-2"><bdi>{a.account}</bdi></span><Money value={a.value} {currency} cents={false} class={a.liability ? "text-bad" : "text-ink-2"} />
              </div>
            {/each}
            {#if e.accounts.length > 6}<div class="text-sub">{t("charts.nw.more", { n: e.accounts.length - 6 })}</div>{/if}
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <p class="py-10 text-center text-[14px] text-sub">{t("chart.nothing")}</p>
  {/if}
</div>
