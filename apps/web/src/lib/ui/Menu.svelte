<script lang="ts">
  // Action menu (WAI-ARIA menu button) on the Popover API: top layer (never clipped by a scroll container, never widens the
  // page), light dismiss, Esc closes and returns focus. Arrow keys / Home / End move between items; Tab closes.
  // Trigger: icon-only (default "more" icon, `label` is its aria-label) or a pill with visible `text`.
  import Icon from "./Icon.svelte";
  import { nextIndex } from "./keys.ts";
  import type { IconName } from "./icons.ts";
  import { place } from "./position.ts";
  import { ring, variants, type Variant } from "./styles.ts";
  import type { MenuItem } from "./types.ts";
  let {
    label,
    text,
    icon = text ? undefined : "more",
    items,
    align = "end",
    variant = text ? "secondary" : "ghost",
    class: cls = "",
  }: { label: string; text?: string; icon?: IconName; items: MenuItem[]; align?: "start" | "end"; variant?: Variant; class?: string } = $props();
  const id = $props.id();
  let trigger = $state<HTMLButtonElement>(),
    pop = $state<HTMLElement>(),
    expanded = $state(false);
  const els = () => [...(pop?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];

  function toggled(e: ToggleEvent) {
    expanded = e.newState === "open";
    if (!expanded || !trigger || !pop) return;
    const r = trigger.getBoundingClientRect();
    const rtl = getComputedStyle(trigger).direction === "rtl";
    const p = place(r, { width: pop.offsetWidth, height: pop.offsetHeight }, { width: innerWidth, height: innerHeight }, { align, rtl });
    pop.style.top = `${p.top}px`;
    pop.style.left = `${p.left}px`;
    els()[0]?.focus();
  }
  function key(e: KeyboardEvent) {
    const list = els();
    if (e.key === "Tab") return pop?.hidePopover();
    const i = nextIndex(e, list.indexOf(document.activeElement as HTMLElement), list.length);
    if (i === null || e.key === "ArrowLeft" || e.key === "ArrowRight") return;
    e.preventDefault();
    list[i]?.focus();
  }
  function choose(it: MenuItem) {
    pop?.hidePopover();
    trigger?.focus();
    it.onselect();
  }
</script>

<button
  bind:this={trigger}
  type="button"
  data-ui="menu-trigger"
  popovertarget="{id}-m"
  aria-haspopup="menu"
  aria-expanded={expanded}
  aria-controls="{id}-m"
  aria-label={text ? undefined : label}
  title={text ? undefined : label}
  class={[
    "inline-flex shrink-0 items-center justify-center rounded-full transition-colors",
    ring,
    text ? "min-h-8 max-w-full gap-1.5 px-4 py-1 text-[14px] text-balance [overflow-wrap:anywhere]" : "size-8",
    text && icon && "ps-3",
    variants[variant],
    expanded && !text && "bg-hover text-ink",
    cls,
  ]}>
  {#if icon}<Icon name={icon} size={text ? 15 : 16} />{/if}
  {#if text}<span class="min-w-0">{text}</span><Icon name="chevron-down" size={14} class="opacity-70" />{/if}
</button>

<div
  bind:this={pop}
  id="{id}-m"
  popover="auto"
  role="menu"
  aria-label={label}
  tabindex="-1"
  ontoggle={toggled}
  onkeydown={key}
  data-ui="menu"
  class="fixed inset-auto m-0 text-start whitespace-normal max-h-[min(60vh,420px)] w-max max-w-[min(320px,calc(100vw-16px))] min-w-44 overflow-y-auto rounded-xl border border-line-strong bg-panel p-1 text-ink shadow-[var(--shadow)]">
  {#each items as it, i (i)}
    <button
      type="button"
      role="menuitem"
      tabindex="-1"
      disabled={it.disabled}
      onclick={() => choose(it)}
      class={[
        "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start text-[14px] outline-none [overflow-wrap:anywhere]",
        "hover:bg-fill focus-visible:bg-fill disabled:opacity-40",
        it.danger ? "text-bad" : "text-ink-2 hover:text-ink focus-visible:text-ink",
      ]}>
      {#if it.icon}<Icon name={it.icon} size={15} />{/if}<span class="min-w-0 flex-1">{it.label}</span>
    </button>
  {/each}
</div>
