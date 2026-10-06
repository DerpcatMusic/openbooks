<script lang="ts">
  // "Show more" for long lists: lists render a page of rows and grow when this comes into view (or on click).
  import { t } from "#lib/i18n.svelte.ts";
  import { Button } from "#lib/ui/index.ts";
  let { shown, total, onmore }: { shown: number; total: number; onmore: () => void } = $props();
  let el = $state<HTMLElement>();
  $effect(() => {
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && onmore(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  });
</script>

{#if shown < total}
  <div bind:this={el} class="flex justify-center py-4">
    <Button variant="ghost" onclick={onmore}>{t("txn34.more", { n: shown, total })}</Button>
  </div>
{/if}
