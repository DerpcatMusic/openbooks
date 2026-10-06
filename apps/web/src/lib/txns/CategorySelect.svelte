<script lang="ts">
  // Ledger-account picker (Mercury's category picker): a compact trigger that opens a searchable list. Arrow keys + Enter pick,
  // Esc closes and returns focus. Typing a name that doesn't exist offers to create it under the usual account types.
  // The list is a Popover-API element inside this component, so it sits in the top layer (never clipped by a table's scroll
  // container) yet stays inside an open drawer's subtree (a modal <dialog> makes everything outside it inert).
  // suggestions: an array or a function (computed when the list opens). `children` replaces the trigger's content (Review uses
  // it for its "Search all accounts" button); call open() on a bound instance to open it from a keyboard shortcut.
  import { tick, type Snippet } from "svelte";
  import { group } from "@openbooks/core";
  import { catGroups, catLabel, typeLabel, isUS } from "#lib/stores/books.svelte.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { Icon, place } from "#lib/ui/index.ts";
  import { slug } from "./txns.ts";

  let {
    value = "",
    onchange,
    suggestions = [],
    placeholder,
    label,
    variant = "inline",
    disabled = false,
    class: cls = "",
    children,
  }: {
    value?: string;
    onchange: (category: string) => void;
    suggestions?: readonly string[] | (() => readonly string[]);
    placeholder?: string;
    /** accessible name of the trigger (default: "Ledger account: <current>") */
    label?: string;
    variant?: "inline" | "pill";
    disabled?: boolean;
    class?: string;
    children?: Snippet;
  } = $props();

  const id = $props.id();
  type Opt = { value: string; label: string; hint?: string; create?: boolean };
  let trigger = $state<HTMLButtonElement>(),
    pop = $state<HTMLElement>(),
    input = $state<HTMLInputElement>(),
    shown = $state(false),
    q = $state(""),
    active = $state(0),
    sugg = $state<readonly string[]>([]),
    above = $state(false),
    /** the list's popover element is created on first open: a long table only pays for its trigger buttons */
    made = $state(false);
  const ask = $derived(!value || value === "ask");
  const text = $derived(ask ? (placeholder ?? t("common.uncategorized")) : catLabel(value));

  const groups = $derived.by(() => {
    if (!shown) return [];
    const s = q.trim().toLowerCase();
    const match = (o: { value: string; label: string }) => !s || o.label.toLowerCase().includes(s) || o.value.includes(s);
    const all = catGroups();
    const out: { label: string; options: Opt[] }[] = [];
    if (sugg.length && !s) out.push({ label: t("combo.suggested"), options: sugg.map((c) => ({ value: c, label: catLabel(c), hint: typeLabel(group(c)) })) });
    for (const g of all) {
      const options = g.options.filter(match);
      if (options.length) out.push({ label: g.label, options });
    }
    const name = q.trim();
    if (name && slug(name) && !all.some((g) => g.options.some((o) => o.label.toLowerCase() === s)))
      out.push({
        label: t("combo.create"),
        options: (isUS() ? ["expense", "cogs", "revenue", "other-income"] : ["business", "personal", "own", "capital"]).map((g) => ({
          value: `${g}:${slug(name)}`,
          label: t("combo.new", { name: bidi(name) }),
          hint: typeLabel(g),
          create: true,
        })),
      });
    return out;
  });
  const flat = $derived(groups.flatMap((g) => g.options));

  export async function open() {
    if (disabled) return;
    made = true;
    await tick();
    pop?.showPopover();
  }
  function close(refocus = true) {
    pop?.hidePopover();
    if (refocus) trigger?.focus();
  }
  function pick(c: string) {
    close();
    if (c && c !== value) onchange(c);
  }
  function toggled(e: ToggleEvent) {
    shown = e.newState === "open";
    if (!shown || !trigger || !pop) return;
    q = "";
    active = 0;
    sugg = typeof suggestions === "function" ? suggestions() : suggestions;
    const r = trigger.getBoundingClientRect();
    const p = place(r, { width: pop.offsetWidth, height: Math.min(372, innerHeight - 16) }, { width: innerWidth, height: innerHeight }, { rtl: getComputedStyle(trigger).direction === "rtl" });
    // opened above the trigger: keep a fixed height so the box doesn't jump away from it while the list filters down
    above = p.top < r.top;
    pop.style.top = `${p.top}px`;
    pop.style.left = `${p.left}px`;
    void tick().then(() => input?.focus());
  }
  function key(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(0, Math.min(flat.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
      document.getElementById(`${id}-o${active}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = flat[active];
      if (o) pick(o.value);
    } else if (e.key === "Escape") {
      // handled here so an open drawer doesn't also take the Esc
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") close(false);
  }
</script>

<button
  bind:this={trigger}
  type="button"
  {disabled}
  aria-haspopup="listbox"
  aria-expanded={shown}
  aria-label={children ? undefined : (label ?? `${t("common.ledgerAccount")}: ${text}`)}
  onclick={(e) => {
    e.stopPropagation();
    void open();
  }}
  class={children
    ? cls
    : [
        "inline-flex max-w-full items-center gap-1.5 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50",
        variant === "pill" ? "min-h-8 rounded-full bg-fill py-1 ps-3 pe-2.5 text-[14px] hover:bg-line-strong" : "-mx-1.5 h-7 rounded-md px-1.5 whitespace-nowrap hover:bg-fill",
        ask ? "text-warn" : "text-ink-2 hover:text-ink",
        cls,
      ]}>
  {#if children}
    {@render children()}
  {:else}
    {#if ask && variant === "inline"}<span class="size-1.5 shrink-0 rounded-full bg-warn"></span>{/if}
    <span class="min-w-0 [overflow-wrap:anywhere]">{text}</span>
    <Icon name="chevron-down" size={13} class="opacity-60" />
  {/if}
</button>

{#if made}
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (clicks inside must not reach a clickable table row) -->
<div
  bind:this={pop}
  popover="auto"
  role="dialog"
  tabindex="-1"
  aria-label={t("combo.placeholder")}
  ontoggle={toggled}
  onclick={(e) => e.stopPropagation()}
  class={[
    "fixed inset-auto m-0 max-h-[min(372px,calc(100dvh-16px))] w-[min(320px,calc(100vw-16px))] flex-col overflow-hidden rounded-xl border border-line-strong bg-panel p-0 text-ink shadow-[var(--shadow)] open:flex",
    above && "h-[min(372px,calc(100dvh-16px))]",
  ]}>
  {#if shown}
    <label class="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 text-sub">
      <Icon name="search" size={15} />
      <input
        bind:this={input}
        bind:value={q}
        oninput={() => (active = 0)}
        onkeydown={key}
        placeholder={t("combo.placeholder")}
        aria-label={t("combo.placeholder")}
        dir="auto"
        role="combobox"
        aria-expanded="true"
        aria-controls="{id}-list"
        aria-autocomplete="list"
        aria-activedescendant={flat[active] ? `${id}-o${active}` : undefined}
        class="ui-align h-full w-full min-w-0 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint" />
    </label>
    <div class="min-h-0 flex-1 overflow-y-auto p-1" role="listbox" id="{id}-list" aria-label={t("common.ledgerAccount")}>
      {#each groups as g, gi (gi)}
        <div role="presentation" class="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">{g.label}</div>
        {#each g.options as o (o.value + gi)}
          {@const i = flat.indexOf(o)}
          <button
            type="button"
            role="option"
            id="{id}-o{i}"
            tabindex="-1"
            aria-selected={i === active}
            onmouseenter={() => (active = i)}
            onclick={() => pick(o.value)}
            class="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[14px] {i === active ? 'bg-fill text-ink' : 'text-ink-2'}">
            {#if o.create}<Icon name="plus" size={14} class="text-accent-ink" />{/if}
            <span class="min-w-0 flex-1 [overflow-wrap:anywhere]">{o.label}</span>
            {#if o.hint}<span class="shrink-0 text-[12px] whitespace-nowrap text-faint">{o.hint}</span>{/if}
            {#if o.value === value}<Icon name="tick" size={14} class="text-accent-ink" />{/if}
          </button>
        {/each}
      {:else}
        <div class="px-3 py-6 text-center text-[13px] text-sub">{t("combo.none")}</div>
      {/each}
    </div>
  {/if}
</div>
{/if}
