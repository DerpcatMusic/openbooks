<script lang="ts">
  // Page header: title (+ badge and subtitle) at the start, actions at the end; wraps on phones instead of truncating.
  // children render below (tabs, toolbars).
  import type { Snippet } from "svelte";
  import Badge from "./Badge.svelte";
  let { title, badge = "", sub = "", actions, children }: { title: string; badge?: string; sub?: string; actions?: Snippet; children?: Snippet } = $props();
</script>

<header data-ui="page-header" class="px-4 pt-5 sm:px-8">
  <div class="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2">
    <div class="min-w-0 flex-1 basis-56">
      <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h1 class="display min-w-0 text-[20px] leading-7 text-ink [overflow-wrap:anywhere]">{title}</h1>
        {#if badge}<Badge shape="tag" size="sm">{badge}</Badge>{/if}
      </div>
      {#if sub}<p class="text-[13px] text-sub">{sub}</p>{/if}
    </div>
    {#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
  </div>
  {@render children?.()}
</header>
