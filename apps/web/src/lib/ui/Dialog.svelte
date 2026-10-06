<script lang="ts">
  // Modal dialog on the native <dialog> + showModal(): the rest of the page is inert (focus can't leave), Esc closes, focus
  // returns to the opener on close — all by the browser. Bind `open`. Clicking the backdrop closes unless `dismissible={false}`
  // (then Esc is blocked too, for flows that need an explicit choice). `actions` render in the footer (wraps on phones).
  import type { Snippet } from "svelte";
  import { t } from "../i18n.svelte.ts";
  import IconButton from "./IconButton.svelte";
  let {
    open = $bindable(false),
    title,
    description,
    size = "md",
    dismissible = true,
    onclose,
    children,
    actions,
  }: { open?: boolean; title: string; description?: string; size?: "sm" | "md" | "lg"; dismissible?: boolean; onclose?: () => void; children?: Snippet; actions?: Snippet } = $props();
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
  const widths = { sm: "sm:w-[400px]", md: "sm:w-[520px]", lg: "sm:w-[720px]" };
</script>

<dialog
  bind:this={d}
  tabindex="-1"
  data-ui="dialog"
  aria-labelledby="{id}-t"
  aria-describedby={description ? `${id}-d` : undefined}
  onclose={() => {
    open = false;
    onclose?.();
  }}
  oncancel={e => !dismissible && e.preventDefault()}
  onclick={e => dismissible && e.target === d && (open = false)}
  class={[
    "outline-none m-auto max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel p-0 text-ink shadow-[var(--shadow)] open:flex",
    "backdrop:bg-black/40 transition-[opacity,translate] duration-200 starting:open:translate-y-2 starting:open:opacity-0 motion-reduce:transition-none",
    widths[size],
  ]}>
  {#if open}
    <div class="flex shrink-0 items-start gap-3 px-5 pt-4 pb-2">
      <div class="min-w-0 flex-1 pt-1">
        <h2 id="{id}-t" class="text-[16px] leading-6 [overflow-wrap:anywhere]">{title}</h2>
        {#if description}<p id="{id}-d" class="mt-1 text-[14px] text-sub">{description}</p>{/if}
      </div>
      {#if dismissible}<IconButton icon="x" label={t("common.close")} onclick={() => (open = false)} />{/if}
    </div>
    {#if children}<div class="min-h-0 flex-1 overflow-y-auto px-5 py-2 text-[14px] text-ink-2">{@render children()}</div>{/if}
    {#if actions}<div class="flex shrink-0 flex-wrap justify-end gap-2 px-5 pt-3 pb-5">{@render actions()}</div>{/if}
  {/if}
</dialog>
