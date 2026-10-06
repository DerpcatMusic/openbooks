<script lang="ts">
  // Underline tabs (WAI-ARIA tabs pattern). Bind `value`. Arrow keys / Home / End switch tabs (RTL-aware).
  // On a narrow screen the tab strip scrolls horizontally inside itself; labels never wrap or truncate.
  // Pass `children` to render the active panel: it receives the active key and is wired with role=tabpanel/aria-labelledby.
  import type { Snippet } from "svelte";
  import { nextIndex } from "./keys.ts";
  import { ring } from "./styles.ts";
  import type { TabItem } from "./types.ts";

  let {
    items,
    value = $bindable(),
    onchange,
    label,
    class: cls = "",
    children,
  }: { items: TabItem[]; value?: string; onchange?: (key: string) => void; label?: string; class?: string; children?: Snippet<[string]> } = $props();
  const id = $props.id();
  let list = $state<HTMLElement>();
  const pick = (k: string) => {
    value = k;
    onchange?.(k);
  };
  function key(e: KeyboardEvent) {
    const i = nextIndex(e, Math.max(0, items.findIndex(it => it.key === value)), items.length);
    if (i === null || e.key === "ArrowUp" || e.key === "ArrowDown") return;
    e.preventDefault();
    pick(items[i]!.key);
    list?.querySelectorAll<HTMLElement>("[role=tab]")[i]?.focus();
  }
</script>

<div data-ui="tabs" class={["overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]", cls]}>
  <div bind:this={list} role="tablist" aria-label={label} tabindex="-1" onkeydown={key} class="flex w-max min-w-full gap-6 px-0.5">
    {#each items as it (it.key)}
      {@const on = value === it.key}
      <button
        type="button"
        role="tab"
        id="{id}-t-{it.key}"
        aria-selected={on}
        aria-controls={children ? `${id}-p` : undefined}
        tabindex={on ? 0 : -1}
        onclick={() => pick(it.key)}
        class={[
          "relative -mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 text-[14px] whitespace-nowrap transition-colors",
          ring,
          on ? "border-accent text-ink" : "border-transparent text-sub hover:text-ink",
        ]}>
        {it.label}
        {#if it.count}<span class="num rounded-full bg-fill px-1.5 text-[11px] leading-[18px] text-ink-2">{it.count}</span>{/if}
      </button>
    {/each}
  </div>
</div>
{#if children && value !== undefined}
  <div role="tabpanel" id="{id}-p" aria-labelledby="{id}-t-{value}" tabindex="0" class="outline-none">{@render children(value)}</div>
{/if}
