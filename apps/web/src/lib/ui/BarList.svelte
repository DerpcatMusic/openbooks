<script lang="ts">
  // Ranked rows with a thin share bar (Mercury "By ledger account"). Labels wrap rather than truncate.
  // `focus` (bindable) pairs with Bars to spotlight a series.
  import Money from "./Money.svelte";
  let {
    items,
    onselect,
    currency = "ILS",
    color = "var(--color-s1)",
    focus = $bindable(null),
  }: { items: { key: string; label: string; value: number; color?: string }[]; onselect?: (key: string) => void; currency?: string; color?: string; focus?: string | null } = $props();
  const total = $derived(items.reduce((a, i) => a + Math.abs(i.value), 0) || 1);
  const pct = (v: number) => {
    const p = (Math.abs(v) / total) * 100;
    return p < 1 ? "<1%" : `${Math.round(p)}%`;
  };
</script>

<div data-ui="barlist">
  {#each items as it (it.key)}
    <svelte:element
      this={onselect ? "button" : "div"}
      type={onselect ? "button" : undefined}
      role={onselect ? undefined : "group"}
      onclick={() => onselect?.(it.key)}
      onmouseenter={() => (focus = it.key)}
      onmouseleave={() => (focus = null)}
      class="group block w-full border-b border-line py-2.5 text-start outline-none transition-opacity last:border-0 focus-visible:bg-hover"
      style:opacity={focus && focus !== it.key ? 0.4 : 1}>
      <div class="flex items-baseline gap-2 text-[14px]">
        <span class="min-w-0 flex-1 text-ink-2 [overflow-wrap:anywhere] group-hover:text-ink" dir="auto">{it.label}</span>
        <Money value={it.value} {currency} cents={false} class="text-ink" />
        <span class="num w-9 shrink-0 text-end text-[12px] text-sub">{pct(it.value)}</span>
      </div>
      <div class="mt-2 h-[3px] rounded-full bg-fill">
        <div class="h-full rounded-full transition-[width]" style:width="{(Math.abs(it.value) / total) * 100}%" style:background={it.color ?? color}></div>
      </div>
    </svelte:element>
  {/each}
</div>
