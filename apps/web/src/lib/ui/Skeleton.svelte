<script lang="ts">
  // Loading placeholder. `lines` > 1 draws a paragraph (last line shorter). Announces "Loading…" once to screen readers;
  // the shapes are hidden from them. Pulse stops under prefers-reduced-motion.
  import { t } from "../i18n.svelte.ts";
  let { lines = 1, width = "100%", height = "14px", round = false, class: cls = "" }: { lines?: number; width?: string; height?: string; round?: boolean; class?: string } = $props();
</script>

<div data-ui="skeleton" role="status" class={["flex min-w-0 flex-col gap-2", cls]} style:width>
  <span class="sr-only">{t("common.loading")}</span>
  {#each { length: lines }, i (i)}
    <div aria-hidden="true" class={["animate-pulse bg-fill motion-reduce:animate-none", round ? "rounded-full" : "rounded-md"]} style:height style:width={lines > 1 && i === lines - 1 ? "60%" : "100%"}></div>
  {/each}
</div>
