<script lang="ts">
  // Segmented control (radio group of pills in a track). Bind `value`. Arrow keys / Home / End move the choice (RTL-aware).
  // Labels never truncate: on a narrow screen the segments wrap inside the track instead of overflowing.
  // Icon-only items must have `title` (used as aria-label).
  import Icon from "./Icon.svelte";
  import { nextIndex } from "./keys.ts";
  import { ring } from "./styles.ts";
  import type { SegmentedItem } from "./types.ts";

  let {
    items,
    value = $bindable(),
    onchange,
    label,
    size = "md",
    class: cls = "",
  }: { items: SegmentedItem[]; value?: string; onchange?: (key: string) => void; label: string; size?: "sm" | "md"; class?: string } = $props();
  let el = $state<HTMLElement>();
  const pick = (k: string) => {
    value = k;
    onchange?.(k);
  };
  function key(e: KeyboardEvent) {
    const i = nextIndex(e, Math.max(0, items.findIndex(it => it.key === value)), items.length);
    if (i === null) return;
    e.preventDefault();
    pick(items[i]!.key);
    el?.querySelectorAll<HTMLElement>("[role=radio]")[i]?.focus();
  }
</script>

<div
  bind:this={el}
  data-ui="segmented"
  role="radiogroup"
  aria-label={label}
  tabindex="-1"
  onkeydown={key}
  class={["inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-[18px] bg-fill p-0.5", cls]}>
  {#each items as it (it.key)}
    {@const on = value === it.key}
    <button
      type="button"
      role="radio"
      aria-checked={on}
      tabindex={on ? 0 : -1}
      title={it.title}
      aria-label={it.label ? undefined : it.title}
      lang={it.lang}
      onclick={() => pick(it.key)}
      class={[
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full whitespace-nowrap transition-colors",
        ring,
        size === "sm" ? "h-6 text-[12px]" : "h-7 text-[13px]",
        it.label ? "px-3" : size === "sm" ? "w-6" : "w-7",
        on ? "bg-panel text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]" : "text-sub hover:text-ink",
      ]}>
      {#if it.icon}<Icon name={it.icon} size={14} />{/if}{it.label ?? ""}
    </button>
  {/each}
</div>
