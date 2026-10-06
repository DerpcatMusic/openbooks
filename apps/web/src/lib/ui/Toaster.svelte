<script lang="ts">
  // Renders toast() messages at the bottom centre. The live region is always mounted so screen readers announce new toasts.
  // Messages wrap (never truncate); hovering or focusing a toast pauses its timer.
  import { t } from "../i18n.svelte.ts";
  import IconButton from "./IconButton.svelte";
  import { dismiss, toasts, type ToastItem } from "./toast.svelte.ts";

  function timed(node: HTMLElement, item: ToastItem) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => (timer = setTimeout(() => dismiss(item.id), item.ms));
    const stop = () => clearTimeout(timer);
    start();
    const evs = [["pointerenter", stop], ["pointerleave", start], ["focusin", stop], ["focusout", start]] as const;
    for (const [ev, fn] of evs) node.addEventListener(ev, fn);
    return { destroy: stop };
  }
  const values: Record<number, string> = $state({});
  const run = (it: ToastItem) => {
    it.action?.run(values[it.id] ?? it.action.value ?? "");
    dismiss(it.id);
  };
</script>

<div data-ui="toaster" role="status" aria-live="polite" class="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
  {#each toasts as it (it.id)}
    <div
      use:timed={it}
      class={[
        "rise pointer-events-auto flex max-w-[min(560px,100%)] flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl py-1.5 ps-4 pe-1.5 text-[14px] shadow-[var(--shadow)]",
        it.tone === "bad" ? "bg-bad text-white" : "bg-ink text-bg",
      ]}>
      <span class="min-w-0 flex-1 basis-40 py-1 [overflow-wrap:anywhere]" dir="auto">{it.msg}</span>
      <div class="flex shrink-0 items-center gap-1.5">
        {#if it.action}
          {#if it.action.value !== undefined}
            <input
              dir="auto"
              value={values[it.id] ?? it.action.value}
              oninput={e => (values[it.id] = e.currentTarget.value)}
              onkeydown={e => e.key === "Enter" && run(it)}
              aria-label={it.action.label}
              class="h-7 w-40 min-w-0 rounded-full border border-bg/25 bg-transparent px-3 text-bg outline-none focus:border-bg/60" />
          {/if}
          <button type="button" class="h-7 shrink-0 rounded-full bg-bg px-3.5 whitespace-nowrap text-ink outline-none focus-visible:ring-2 focus-visible:ring-bg/60" onclick={() => run(it)}
            >{it.action.label}</button>
        {/if}
        <IconButton icon="x" size="sm" label={t("common.dismiss")} class="text-current opacity-70 hover:bg-white/10 hover:opacity-100" onclick={() => dismiss(it.id)} />
      </div>
    </div>
  {/each}
</div>
