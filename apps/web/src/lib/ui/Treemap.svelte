<script lang="ts">
  // Spending against normal: box size = spend in the period, colour = change against the account's own average of the periods before
  // (diverging: green below normal, red above, grey without history). Squarified layout in treemap.ts. Largest box at the reading start
  // (mirrored in Hebrew). Every box is a button: hover / focus shows the numbers, click calls onselect.
  import { dir, t } from "../i18n.svelte.ts";
  import Money from "./Money.svelte";
  import { moneyText } from "./money.ts";
  import { scramble } from "../privacy.svelte.ts";
  import { ring } from "./styles.ts";
  import { squarify, type TreeItem } from "./treemap.ts";
  let {
    items,
    label,
    currency = "ILS",
    height = 340,
    onselect,
  }: { items: TreeItem[]; label: string; currency?: string; height?: number; onselect?: (key: string) => void } = $props();
  let w = $state(640),
    hover = $state<string | null>(null);
  const rtl = $derived(dir() === "rtl");
  const H = $derived(w < 480 ? Math.round(height * 1.25) : height);
  const tiles = $derived(squarify(items, { x: 0, y: 0, w, h: H }));
  const total = $derived(items.reduce((a, i) => a + i.value, 0));
  /** Diverging fill: ±100% and beyond saturate. */
  const fill = (c: number | null) => {
    if (c == null) return "var(--color-fill)";
    const p = Math.round(14 + Math.min(1, Math.abs(c)) * 62);
    return Math.abs(c) < 0.05 ? "color-mix(in oklab, var(--color-s6) 22%, var(--color-panel))" : `color-mix(in oklab, var(--color-${c > 0 ? "bad" : "good"}) ${p}%, var(--color-panel))`;
  };
  const pct = (c: number | null) => (c == null ? t("charts.tree.new") : `${c > 0 ? "+" : c < 0 ? "−" : ""}${Math.round(Math.abs(c) * 100)}%`);
  const hi = $derived(tiles.find((x) => x.item.key === hover));
</script>

<div data-ui="treemap" class="min-w-0">
  <div class="relative overflow-hidden rounded-xl" style:height="{H}px" bind:clientWidth={w} role="figure" aria-label={label}>
    {#each tiles as tl (tl.item.key)}
      {@const it = tl.item}{@const roomy = tl.w > 74 && tl.h > 44}
      <button
        type="button"
        class={["tile absolute overflow-hidden rounded-[6px] p-2 text-start transition-[opacity,filter] duration-150 hover:brightness-95", ring, hover && hover !== it.key && "opacity-60"]}
        style:left="{(rtl ? w - tl.x - tl.w : tl.x) + 1.5}px"
        style:top="{tl.y + 1.5}px"
        style:width="{Math.max(0, tl.w - 3)}px"
        style:height="{Math.max(0, tl.h - 3)}px"
        style:background={fill(it.change)}
        aria-label="{it.label}: {moneyText(scramble(it.value), currency, false)}, {pct(it.change)} {t('charts.tree.vsNormal')}"
        onmouseenter={() => (hover = it.key)}
        onmouseleave={() => (hover = null)}
        onfocus={() => (hover = it.key)}
        onblur={() => (hover = null)}
        onclick={() => onselect?.(it.key)}>
        {#if roomy}
          <span class="block truncate text-[12px] leading-4 text-ink" dir="auto">{it.label}</span>
          <Money value={it.value} {currency} cents={false} class="block text-[13px] text-ink" />
          <span class="num mt-0.5 block text-[11px] {it.change == null ? 'text-sub' : 'text-ink-2'}">{pct(it.change)}</span>
        {/if}
      </button>
    {/each}
  </div>

  <div class="mt-3 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-sub">
    {#if hi}
      <span class="min-w-0 text-ink [overflow-wrap:anywhere]" dir="auto">{hi.item.label}</span>
      <span><Money value={hi.item.value} {currency} cents={false} class="text-ink" /> · {Math.round((hi.item.value / (total || 1)) * 100)}%</span>
      {#if hi.item.avg}<span>{t("charts.tree.normal")} <Money value={hi.item.avg} {currency} cents={false} /></span>{/if}
      <span class={hi.item.change == null ? "" : hi.item.change > 0 ? "text-bad" : "text-good"}>{pct(hi.item.change)}</span>
    {:else}
      <span class="flex items-center gap-2">
        <span>{t("charts.tree.less")}</span>
        <span
          class="h-2 w-28 rounded-full rtl:rotate-180"
          style:background="linear-gradient(90deg, color-mix(in oklab, var(--color-good) 76%, var(--color-panel)), color-mix(in oklab, var(--color-s6) 22%, var(--color-panel)), color-mix(in oklab, var(--color-bad) 76%, var(--color-panel)))"
        ></span>
        <span>{t("charts.tree.more")}</span>
      </span>
      <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm bg-fill"></span>{t("charts.tree.noHistory")}</span>
    {/if}
  </div>
</div>

<style>
  .tile {
    animation: pop 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tile {
      animation: none;
    }
  }
</style>
