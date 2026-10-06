<script lang="ts">
  // Monthly bar chart (ported from web/): stacked or grouped series, optional line (e.g. net), toggleable legend, hover card.
  // Time runs left → right in both languages (the SVG is dir=ltr); the hover card and legend follow the page direction.
  // Axis ticks go through privacy axis() (one factor per session) so bars keep their shape; amounts in the card through Money.
  // `focus` (bindable) spotlights one series, e.g. from a BarList bound to the same value.
  import { axis } from "../privacy.svelte.ts";
  import { t } from "../i18n.svelte.ts";
  import Money from "./Money.svelte";
  import { ring } from "./styles.ts";
  import type { BarRow, BarSeries } from "./types.ts";
  let {
    rows,
    series,
    label,
    currency = "ILS",
    layout = "stack",
    height = 260,
    line = null,
    legend = true,
    onselect,
    compact = false,
    focus = $bindable(null),
  }: {
    rows: BarRow[];
    series: BarSeries[];
    label: string;
    currency?: string;
    layout?: "stack" | "group";
    height?: number;
    line?: { key: string; label: string; color: string } | null;
    legend?: boolean;
    onselect?: (row: BarRow) => void;
    compact?: boolean;
    focus?: string | null;
  } = $props();
  const uid = $props.id();
  const gid = (k: string) => `g${uid}${k.replace(/\W/g, "")}`;
  const dim = (k: string) => (focus && focus !== k ? 0.18 : 1);
  let w = $state(600),
    hover = $state(-1),
    hidden = $state(new Set<string>());
  const on = $derived(series.filter(s => !hidden.has(s.key)));
  const lv = (r: BarRow) => (line ? Number(r[line.key] ?? 0) : 0);
  const padL = $derived(compact ? 0 : 48),
    padB = $derived(compact ? 0 : 28),
    padT = 10,
    H = $derived(height - padB - padT);
  const tot = (r: BarRow) => on.reduce((a, s) => a + Math.max(0, r.v[s.key] ?? 0), 0);
  const peak = $derived(Math.max(1, ...rows.map(r => (layout === "stack" ? tot(r) : Math.max(0, ...on.map(s => r.v[s.key] ?? 0)))), ...(line ? rows.map(lv) : [])));
  const lo = $derived(line ? Math.min(0, ...rows.map(lv)) : 0);
  const step = $derived.by(() => {
    const raw = (peak - lo) / 4,
      p = 10 ** Math.floor(Math.log10(raw || 1));
    return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) ?? raw;
  });
  const top = $derived(Math.ceil(peak / step) * step),
    bottom = $derived(Math.floor(lo / step) * step);
  const y = (v: number) => padT + H - ((v - bottom) / (top - bottom || 1)) * H;
  const ticks = $derived(Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, i) => bottom + i * step));
  const band = $derived((w - padL) / Math.max(1, rows.length)),
    bw = $derived(Math.min(56, band * 0.62));
  const x0 = (i: number) => padL + i * band + (band - bw) / 2;
  const short = (v: number) => ((v = axis(v)), Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
  const toggle = (k: string) => {
    const s = new Set(hidden);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    if (s.size < series.length) hidden = s;
  };
  const hr = $derived(rows[hover]);
  const cardW = $derived(Math.min(240, w));
  function stack(r: BarRow) {
    const out: { s: BarSeries; start: number; end: number }[] = [];
    for (const s of on) {
      const v = Math.max(0, r.v[s.key] ?? 0),
        base = out.at(-1)?.end ?? 0;
      if (v) out.push({ s, start: base, end: base + v });
    }
    return out;
  }
</script>

<div data-ui="bars" class="relative min-w-0" bind:clientWidth={w} onmouseleave={() => (hover = -1)} role="figure" aria-label={label}>
  <svg width={w} {height} class="block overflow-visible" direction="ltr" aria-hidden="true">
    <defs>
      {#each series as s (s.key)}
        <linearGradient id={gid(s.key)} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color={s.color} stop-opacity="1" /><stop offset="1" stop-color={s.color} stop-opacity="0.55" />
        </linearGradient>
      {/each}
    </defs>
    {#if !compact}
      {#each ticks as tk (tk)}
        <line x1={padL} x2={w} y1={y(tk)} y2={y(tk)} stroke="var(--color-line)" stroke-dasharray={tk === 0 ? "" : "2 3"} />
        <text x={padL - 10} y={y(tk) + 4} text-anchor="end" class="num fill-faint text-[11px]">{short(tk)}</text>
      {/each}
    {/if}
    {#each rows as r, i (r.key)}
      <rect
        x={padL + i * band}
        y={padT}
        width={band}
        height={H}
        rx="6"
        fill={hover === i ? "var(--color-hover)" : "transparent"}
        onmouseenter={() => (hover = i)}
        onclick={() => onselect?.(r)}
        class={onselect ? "cursor-pointer" : ""}
        role="presentation" />
      <g class="pointer-events-none transition-opacity duration-150" opacity={hover < 0 || hover === i ? 1 : 0.45}>
        {#if layout === "stack"}
          {@const segs = stack(r)}
          {#each segs as seg, j (seg.s.key)}
            <path
              class="bar"
              style:--d="{i * 25}ms"
              opacity={dim(seg.s.key)}
              fill="url(#{gid(seg.s.key)})"
              d={j === segs.length - 1
                ? `M${x0(i)},${y(seg.start)} V${y(seg.end) + Math.min(4, y(seg.start) - y(seg.end))} q0,-4 4,-4 H${x0(i) + bw - 4} q4,0 4,4 V${y(seg.start)} Z`
                : `M${x0(i)},${y(seg.start)} V${y(seg.end) + 0.75} H${x0(i) + bw} V${y(seg.start)} Z`} />
          {/each}
        {:else}
          {#each on as s, j (s.key)}
            {@const gw = bw / on.length}{@const v = Math.max(0, r.v[s.key] ?? 0)}
            {#if v}<rect class="bar" style:--d="{i * 25}ms" opacity={dim(s.key)} x={x0(i) + j * gw + 1} y={y(v)} width={gw - 2} height={y(0) - y(v)} rx="3" fill="url(#{gid(s.key)})" />{/if}
          {/each}
        {/if}
      </g>
      {#if !compact && (band >= 32 || i % 2 === 0)}<text x={padL + i * band + band / 2} y={height - 8} text-anchor="middle" class={["pointer-events-none text-[11px]", hover === i ? "fill-ink" : "fill-faint"]}>{r.label}</text>{/if}
    {/each}
    {#if line}
      <path d={rows.map((r, i) => `${i ? "L" : "M"}${padL + i * band + band / 2},${y(lv(r))}`).join(" ")} fill="none" stroke={line.color} stroke-width="2" stroke-linejoin="round" class="pointer-events-none" />
      {#each rows as r, i (r.key)}<circle cx={padL + i * band + band / 2} cy={y(lv(r))} r={hover === i ? 4.5 : 3} fill="var(--color-panel)" stroke={line.color} stroke-width="2" class="pointer-events-none" />{/each}
    {/if}
  </svg>

  {#if hr && !compact}
    {@const left = padL + hover * band + band / 2}
    <div
      class="pointer-events-none absolute top-0 z-20 rounded-xl border border-line-strong bg-panel/95 p-3 text-[13px] shadow-[var(--shadow)] backdrop-blur"
      style:width="{cardW}px"
      style:left="{Math.min(Math.max(left - cardW / 2, 0), w - cardW)}px"
      style:transform="translateY(-8px)">
      <div class="mb-2 text-ink">{hr.sub ?? hr.label}</div>
      {#each on.filter(s => hr.v[s.key]) as s (s.key)}
        <div class="flex items-start gap-2 py-0.5 transition-opacity" style:opacity={dim(s.key) < 1 ? 0.45 : 1}>
          <span class="mt-1.5 size-2 shrink-0 rounded-full" style:background={s.color}></span><span class="min-w-0 flex-1 text-ink-2 [overflow-wrap:anywhere]">{s.label}</span><Money
            value={hr.v[s.key] ?? 0}
            {currency}
            class="text-ink" />
        </div>
      {:else}<div class="text-sub">{t("chart.nothing")}</div>{/each}
      {#if layout === "stack" && on.filter(s => hr.v[s.key]).length > 1}<div class="mt-1.5 flex border-t border-line pt-1.5">
          <span class="flex-1 text-sub">{t("common.total")}</span><Money value={tot(hr)} {currency} class="text-ink" />
        </div>{/if}
      {#if line}<div class="mt-1.5 flex border-t border-line pt-1.5">
          <span class="flex-1 text-sub">{line.label}</span><Money value={lv(hr)} {currency} class={lv(hr) < 0 ? "text-bad" : "text-ink"} />
        </div>{/if}
    </div>
  {/if}

  {#if legend && series.length > 1}
    <div class={["mt-3 flex flex-wrap gap-1.5", !compact && "ltr:ps-12"]}>
      {#each series as s (s.key)}
        <button
          type="button"
          onclick={() => toggle(s.key)}
          aria-pressed={!hidden.has(s.key)}
          onmouseenter={() => (focus = s.key)}
          onmouseleave={() => (focus = null)}
          onfocus={() => (focus = s.key)}
          onblur={() => (focus = null)}
          class={[
            "flex min-h-7 max-w-full shrink-0 items-center gap-1.5 rounded-[14px] border px-2.5 py-1 text-start text-[12px] leading-tight transition [overflow-wrap:anywhere]",
            ring,
            hidden.has(s.key) ? "border-line text-faint" : focus === s.key ? "border-ink/40 bg-panel text-ink" : "border-line-strong bg-panel text-ink-2 hover:text-ink",
          ]}>
          <span class="size-2 shrink-0 rounded-full transition" style:background={hidden.has(s.key) ? "var(--color-line-strong)" : s.color}></span>{s.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .bar {
    transition: opacity 150ms;
    transform-box: fill-box;
    transform-origin: bottom;
    animation: grow 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    animation-delay: var(--d);
  }
  @keyframes grow {
    from {
      transform: scaleY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar {
      animation: none;
    }
  }
</style>
