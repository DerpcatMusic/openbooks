<script lang="ts">
  // A key number on the Home page: label, value (the children), an optional line under it (a change chip) and a one-sentence hint
  // that says what the number means. The hint is plain text, not a tooltip, so it reads on a phone too.
  import type { Snippet } from "svelte";
  let { label, hint = "", class: cls = "", children, foot }: { label: string; hint?: string; class?: string; children: Snippet; foot?: Snippet } = $props();
</script>

<div data-ui="metric" class={["panel rise min-w-0 p-4 sm:p-5", cls]}>
  <div class="text-[13px] text-ink-2">{label}</div>
  <div class="display mt-1 text-[22px] leading-8 text-ink sm:text-[24px]">{@render children()}</div>
  {#if foot}<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-sub">{@render foot()}</div>{/if}
  {#if hint}<p class="mt-1.5 text-[12px] leading-4 text-sub">{hint}</p>{/if}
</div>
