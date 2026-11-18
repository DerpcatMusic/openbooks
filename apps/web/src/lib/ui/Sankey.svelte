<script lang="ts">
  // Cash-flow sankey: where money came from (sources) → total in → where it went (targets), plus a surplus or deficit node so both sides
  // balance. Layout math in sankey.ts. Flow runs from the reading start: left → right in English, right → left in Hebrew.
  // Labels are HTML (wrap-free, bidi-safe, privacy-aware through Money); every outer node is a button (hover / focus shows its links,
  // click calls onselect). Bands blend the colours of their two ends.
  import { dir } from "../i18n.svelte.ts";
  import { t } from "../i18n.svelte.ts";
  import Money from "./Money.svelte";
  import { moneyText } from "./money.ts";
  import { scramble } from "../privacy.svelte.ts";
  import { bandPath, sankey, type FlowItem, type FlowNode } from "./sankey.ts";
  import { ring } from "./styles.ts";
  type Meta = Omit<FlowItem, "value">;
  let {
    sources,
    targets,
    mid,
    surplus,
    deficit,
    label,
    currency = "ILS",
    height = 320,
    onselect,
  }: {
    sources: FlowItem[];
    targets: FlowItem[];
    mid: Meta;
    surplus: Meta;
    deficit: Meta;
    label: string;
    currency?: string;
    height?: number;
    onselect?: (node: FlowNode) => void;
  } = $props();
  const uid = $props.id();
  const NW = 12,
    GAP = 8,
    SLOT = 36;
  let w = $state(640),
    hover = $state<string | null>(null);
  const rtl = $derived(dir() === "rtl");
  const inset = $derived(Math.round(Math.min(176, Math.max(100, w * 0.27))));
  const rows = $derived(Math.max(sources.length + 1, targets.length + 1));
  const H = $derived(Math.max(height, rows * (SLOT + GAP)));
  const lay = $derived(sankey(sources, targets, { width: w, height: H, nodeW: NW, gap: GAP, minSlot: SLOT, inset, mid, surplus, deficit }));
  /** Physical x (mirrored in RTL). */
  const X = (x: number, width = NW) => (rtl ? w - x - width : x);
  const share = (v: number) => {
    const p = lay.total ? (v / lay.total) * 100 : 0;
    return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
  };
  const lit = (from: string, to: string) => !hover || hover === from || hover === to;
  const midNode = $derived(lay.nodes.find((n) => n.col === 1));
  const outer = $derived(lay.nodes.filter((n) => n.col !== 1));
  const hn = $derived(lay.nodes.find((n) => n.key === hover && n.col !== 1));
  const click = (n: FlowNode) => n.col !== 1 && onselect?.(n);
</script>

<div data-ui="sankey" class="relative min-w-0" bind:clientWidth={w} role="figure" aria-label={label}>
  {#if lay.total}
    <svg width={w} height={H} class="block" aria-hidden="true">
      <defs>
        {#each lay.links as l, i (i)}
          {@const a = X(l.from.x + NW, 0)}{@const b = X(l.to.x, 0)}
          <linearGradient id="s{uid}-{i}" gradientUnits="userSpaceOnUse" x1={a} x2={b} y1="0" y2="0">
            <stop offset="0" stop-color={l.from.color} /><stop offset="1" stop-color={l.to.color} />
          </linearGradient>
        {/each}
      </defs>
      {#each lay.links as l, i (i)}
        <path
          d={bandPath(X(l.from.x + NW, 0), l.y0, X(l.to.x, 0), l.y1, Math.max(l.w, 0.75))}
          fill="url(#s{uid}-{i})"
          class="flow transition-opacity duration-150"
          opacity={lit(l.from.key, l.to.key) ? (hover ? 0.55 : 0.32) : 0.08}
          onmouseenter={() => (hover = l.from.col === 0 ? l.from.key : l.to.key)}
          onmouseleave={() => (hover = null)}
          role="presentation" />
      {/each}
      {#each lay.nodes as n (n.key + n.col)}
        <rect
          x={X(n.x)}
          y={n.y}
          width={NW}
          height={Math.max(n.h, 1.5)}
          rx="3"
          fill={n.color}
          opacity={!hover || hover === n.key || n.col === 1 ? 1 : 0.35}
          class="transition-opacity duration-150 {onselect && n.col !== 1 ? 'cursor-pointer' : ''}"
          onmouseenter={() => n.col !== 1 && (hover = n.key)}
          onmouseleave={() => (hover = null)}
          onclick={() => click(n)}
          role="presentation" />
      {/each}
    </svg>

    {#each outer as n (n.key + n.col)}
      {@const start = n.col === 0}
      {@const left = start !== rtl}
      <button
        type="button"
        class={[
          "absolute flex flex-col justify-center rounded-md px-1 leading-tight transition-opacity duration-150 hover:bg-hover",
          ring,
          hover && hover !== n.key && "opacity-45",
        ]}
        style:top="{n.cy - SLOT / 2}px"
        style:height="{SLOT}px"
        style:left={left ? "0" : `${w - inset + 6}px`}
        style:width="{inset - 8}px"
        style:text-align={left ? "right" : "left"}
        aria-label="{n.label}: {moneyText(scramble(n.value), currency, false)}, {share(n.value)}"
        onmouseenter={() => (hover = n.key)}
        onmouseleave={() => (hover = null)}
        onfocus={() => (hover = n.key)}
        onblur={() => (hover = null)}
        onclick={() => click(n)}>
        <span class="block max-w-full truncate text-[12px] text-ink-2" dir="auto"><bdi>{n.label}</bdi></span>
        <span class="block text-[12px] whitespace-nowrap"
          ><Money value={n.value} {currency} cents={false} class="text-ink" /> <span class="num text-[11px] text-sub">{share(n.value)}</span></span>
      </button>
    {/each}

    {#if midNode}
      <div
        class="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-panel/95 px-2 py-1 text-center text-[11px] leading-tight shadow-[var(--shadow)]"
        style:left="{X(midNode.x) + NW / 2}px"
        style:top="{midNode.y + midNode.h / 2}px">
        <div class="text-sub">{midNode.label}</div>
        <Money value={midNode.value} {currency} cents={false} class="text-[13px] text-ink" />
      </div>
    {/if}

    {#if hn}
      <div class="sr-only" aria-live="polite">{hn.label}: {moneyText(scramble(hn.value), currency, false)} · {t("charts.ofTotal", { pct: share(hn.value) })}</div>
    {/if}
  {:else}
    <p class="py-10 text-center text-[14px] text-sub">{t("chart.nothing")}</p>
  {/if}
</div>

<style>
  .flow {
    animation: fade 0.5s ease-out both;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .flow {
      animation: none;
    }
  }
</style>
