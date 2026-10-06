<script lang="ts">
  // Raised surface (.panel). Optional header: title (h2 by default), description, actions at the end; the header row wraps
  // on narrow screens so actions drop under the title instead of squeezing it. `flush` removes body padding (tables, lists).
  import type { Snippet } from "svelte";
  let {
    title,
    description,
    level = 2,
    flush = false,
    class: cls = "",
    actions,
    children,
  }: { title?: string; description?: string; level?: 2 | 3; flush?: boolean; class?: string; actions?: Snippet; children: Snippet } = $props();
</script>

<section data-ui="card" class={["panel min-w-0", cls]}>
  {#if title || actions}
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 sm:px-5 {flush ? 'pb-3' : ''}">
      <div class="min-w-0 flex-1 basis-48">
        {#if title}<svelte:element this={`h${level}`} class="text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">{title}</svelte:element>{/if}
        {#if description}<p class="text-[13px] text-sub">{description}</p>{/if}
      </div>
      {#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
    </div>
  {/if}
  <div class={flush ? "" : "p-4 sm:p-5"}>{@render children()}</div>
</section>
