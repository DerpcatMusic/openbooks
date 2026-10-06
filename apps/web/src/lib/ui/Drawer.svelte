<script lang="ts">
  // Side sheet at the inline end (right in English, left in Hebrew), full width on phones. Native modal <dialog>: page inert,
  // Esc / backdrop click / close button close it, focus returns to the opener. Bind `open`. `actions` sit next to the close
  // button; `footer` is a sticky bottom bar.
  import type { Snippet } from "svelte";
  import { t } from "../i18n.svelte.ts";
  import IconButton from "./IconButton.svelte";
  let {
    open = $bindable(false),
    title,
    width = 440,
    onclose,
    children,
    actions,
    footer,
  }: { open?: boolean; title: string; width?: number; onclose?: () => void; children?: Snippet; actions?: Snippet; footer?: Snippet } = $props();
  const id = $props.id();
  let d = $state<HTMLDialogElement>();
  $effect(() => {
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // start on the dialog itself (no focus ring on the close button) unless the content asks for [autofocus]
      if (!d.querySelector("[autofocus]")) d.focus();
    }
    else if (!open && d.open) d.close();
  });
</script>

<dialog
  bind:this={d}
  tabindex="-1"
  data-ui="drawer"
  aria-labelledby="{id}-t"
  onclose={() => {
    open = false;
    onclose?.();
  }}
  onclick={e => e.target === d && (open = false)}
  style:width="min(100vw, {width}px)"
  class={[
    "outline-none fixed inset-y-0 start-auto end-0 m-0 h-dvh max-h-none max-w-full flex-col border-0 border-s border-line bg-panel p-0 text-ink shadow-[var(--shadow)] open:flex",
    "backdrop:bg-black/25 transition-[opacity,translate] duration-200 starting:open:translate-x-6 starting:open:opacity-0 rtl:starting:open:-translate-x-6 motion-reduce:transition-none",
  ]}>
  {#if open}
    <div class="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-4 py-2 sm:px-5">
      <h2 id="{id}-t" class="min-w-0 flex-1 text-[15px] leading-6 [overflow-wrap:anywhere]">{title}</h2>
      {#if actions}<div class="flex shrink-0 items-center gap-1">{@render actions()}</div>{/if}
      <IconButton icon="x" label={t("common.close")} onclick={() => (open = false)} />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">{@render children?.()}</div>
    {#if footer}<div class="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">{@render footer()}</div>{/if}
  {/if}
</dialog>
