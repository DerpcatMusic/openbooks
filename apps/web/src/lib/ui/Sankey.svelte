<script lang="ts">
  // Cash-flow sankey: where money came from (sources) → total or bank/business hubs (middle) → where it went (targets),
  // plus surplus or deficit nodes so both sides balance. Supports expandable middle hubs (click to drill into child accounts).
  // Flow runs from the reading start: left → right in English, right → left in Hebrew.
  import { dir } from "../i18n.svelte.ts";
  import { t } from "../i18n.svelte.ts";
  import Money from "./Money.svelte";
  import { moneyText } from "./money.ts";
  import { scramble } from "../privacy.svelte.ts";
  import { bandPath, sankey, sankeyHubs, type FlowHubEdge, type FlowItem, type FlowNode } from "./sankey.ts";
  import { ring } from "./styles.ts";
  type Meta = Omit<FlowItem, "value">;
  let {
    sources,
    targets,
    hubs,
    edges,
    mid,
    surplus,
    deficit,
    label,
    currency = "ILS",
    height = 320,
    onselect,
    onhubclick,
  }: {
    sources: FlowItem[];
    targets: FlowItem[];
    /** Optional middle hubs (businesses or bank accounts) for multi-hub subtree flow. */
    hubs?: FlowItem[];
    /** Directed edges between source→hub and hub→target when `hubs` is provided. */
    edges?: FlowHubEdge[];
    mid: Meta;
    surplus: Meta;
    deficit: Meta;
    label: string;
    currency?: string;
    height?: number;
    onselect?: (node: FlowNode) => void;
    onhubclick?: (node: FlowNode) => void;
  } = $props();
  const uid = $props.id();
  const NW = 12,
    GAP = 8,
    SLOT = 36;
  let w = $state(640),
    hover = $state<string | null>(null);
  const rtl = $derived(dir() === "rtl");
  const multiHub = $derived(!!hubs?.length && !!edges?.length);
  const inset = $derived(Math.round(Math.min(176, Math.max(96, w * (multiHub ? 0.24 : 0.27)))));
  const rows = $derived(Math.max(sources.length + 1, targets.length + 1, multiHub ? (hubs?.length ?? 1) + 1 : 1));
  const H = $derived(Math.max(height, rows * (SLOT + GAP + (multiHub ? 4 : 0))));
  const lay = $derived(
    multiHub
      ? sankeyHubs(sources, hubs!, targets, edges!, { width: w, height: H, nodeW: NW, gap: GAP, minSlot: SLOT, inset, surplus, deficit })
      : sankey(sources, targets, { width: w, height: H, nodeW: NW, gap: GAP, minSlot: SLOT, inset, mid, surplus, deficit }),
  );
  /** Physical x (mirrored in RTL). */
  const X = (x: number, width = NW) => (rtl ? w - x - width : x);
  const share = (v: number) => {
    const p = lay.total ? (v / lay.total) * 100 : 0;
    return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
  };
  const lit = (from: string, to: string) => !hover || hover === from || hover === to;
  const midNodes = $derived(lay.nodes.filter((n) => n.col === 1));
  const outer = $derived(lay.nodes.filter((n) => n.col !== 1));
  const hn = $derived(lay.nodes.find((n) => n.key === hover));
  const click = (n: FlowNode) => {
    if (n.col === 1) {
      if (multiHub) onhubclick?.(n);
    } else {
      onselect?.(n);
    }
  };
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
          opacity={lit(l.from.key, l.to.key) ? (hover ? 0.58 : 0.34) : 0.08}
          onmouseenter={() => (hover = l.from.col === 0 ? l.from.key : l.to.key)}
          onmouseleave={() => (hover = null)}
          role="presentation" />
      {/each}
      {#each lay.nodes as n (n.key + n.col)}
        <rect
          x={X(n.x)}
          y={n.y}
          width={NW}
          height={Math.max(n.h, 2)}
          rx="3"
          fill={n.color}
          opacity={!hover || hover === n.key || (!multiHub && n.col === 1) ? 1 : 0.35}
          class="transition-opacity duration-150 {(onselect && n.col !== 1) || (multiHub && onhubclick && n.col === 1 && (n.expandable || n.isChild)) ? 'cursor-pointer' : ''}"
          onmouseenter={() => (multiHub || n.col !== 1) && (hover = n.key)}
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

    {#if !multiHub && midNodes[0]}
      {@const midNode = midNodes[0]}
      <div
        class="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-panel/95 px-2 py-1 text-center text-[11px] leading-tight shadow-[var(--shadow)]"
        style:left="{X(midNode.x) + NW / 2}px"
        style:top="{midNode.y + midNode.h / 2}px">
        <div class="text-sub">{midNode.label}</div>
        <Money value={midNode.value} {currency} cents={false} class="text-[13px] text-ink" />
      </div>
    {:else if multiHub}
      {#each midNodes as mn (mn.key)}
        {@const clickable = !!onhubclick && (mn.expandable || mn.isChild)}
        <button
          type="button"
          disabled={!clickable}
          class={[
            "absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border px-2.5 py-1 text-center text-[11px] leading-tight shadow-[var(--shadow)] backdrop-blur transition-all duration-150",
            mn.isChild ? "border-dashed border-accent/60 bg-panel/95" : "border-line-strong bg-panel/95",
            clickable ? "cursor-pointer hover:border-accent hover:bg-hover" : "cursor-default",
            ring,
            hover && hover !== mn.key && "opacity-45",
          ]}
          style:left="{X(mn.x) + NW / 2}px"
          style:top="{mn.cy}px"
          style:max-width="{Math.max(120, Math.min(200, w * 0.24))}px"
          aria-label="{mn.label}: {moneyText(scramble(mn.value), currency, false)}"
          onmouseenter={() => (hover = mn.key)}
          onmouseleave={() => (hover = null)}
          onfocus={() => (hover = mn.key)}
          onblur={() => (hover = null)}
          onclick={() => click(mn)}>
          <div class="flex items-center justify-center gap-1 truncate text-ink-2" dir="auto">
            {#if mn.isChild}<span class="text-accent-ink">↳</span>{/if}
            <span class="truncate font-medium"><bdi>{mn.label}</bdi></span>
            {#if mn.expandable}<span class="shrink-0 text-[10px] text-accent-ink">▸</span>{/if}
          </div>
          <div class="flex items-center justify-center gap-1 whitespace-nowrap">
            <Money value={mn.value} {currency} cents={false} class="text-[12px] text-ink" />
            {#if mn.sub}<span class="truncate text-[10px] text-sub">· {mn.sub}</span>{/if}
          </div>
        </button>
      {/each}
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
