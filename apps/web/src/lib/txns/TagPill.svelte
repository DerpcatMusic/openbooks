<script lang="ts">
  // A tag as a toggle pill (aria-pressed): the drawer's tag picker and the rule editor's "add tags" row. Colour = a chart series token.
  let { name, color, on, onclick }: { name: string; color?: string | undefined; on: boolean; onclick: () => void } = $props();
</script>

<button
  type="button"
  aria-pressed={on}
  {onclick}
  class="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-accent/50 {on
    ? 'border-accent bg-accent/8 text-ink'
    : 'border-line text-ink-2 hover:border-line-strong'}">
  {#if color}<span class="size-2 rounded-full" style:background="var(--color-{color})"></span>{/if}<span dir="auto">{name}</span>
</button>
