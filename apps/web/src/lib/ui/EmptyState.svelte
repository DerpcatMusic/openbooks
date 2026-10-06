<script lang="ts">
  // Centered empty state: icon, title, text, optional action (children).
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons.ts";
  let { icon = "sparkle", title, text = "", compact = false, children }: { icon?: IconName; title: string; text?: string; compact?: boolean; children?: Snippet } = $props();
</script>

<div data-ui="empty" class={["flex flex-col items-center px-4 text-center sm:px-8", compact ? "py-8" : "py-16 sm:py-20"]}>
  <div class="grid size-10 shrink-0 place-items-center rounded-full bg-fill text-sub"><Icon name={icon} size={18} /></div>
  <h3 class="mt-4 text-[15px] text-ink [overflow-wrap:anywhere]">{title}</h3>
  {#if text}<p class="mt-1 max-w-[380px] text-[14px] text-sub">{text}</p>{/if}
  {#if children}<div class="mt-5 flex flex-wrap justify-center gap-2">{@render children()}</div>{/if}
</div>
