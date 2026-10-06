<script lang="ts">
  // Short hint on hover (after 300 ms) and keyboard focus; Esc hides it. Rendered in the top layer (popover="manual") so it
  // never causes page overflow; the text wraps at 18rem. Wired to the trigger's first focusable element via aria-describedby.
  // Not for essential information: touch devices don't hover.
  import type { Snippet } from "svelte";
  import { place } from "./position.ts";
  let { text, align = "center", children }: { text: string; align?: "start" | "center" | "end"; children: Snippet } = $props();
  const id = $props.id();
  let wrap = $state<HTMLElement>(),
    tip = $state<HTMLElement>(),
    timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const target = wrap?.querySelector<HTMLElement>("button, a, input, select, textarea, [tabindex]");
    target?.setAttribute("aria-describedby", `${id}-tip`);
  });
  function show(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!wrap || !tip) return;
      tip.showPopover();
      const rtl = getComputedStyle(wrap).direction === "rtl";
      const p = place(wrap.getBoundingClientRect(), { width: tip.offsetWidth, height: tip.offsetHeight }, { width: innerWidth, height: innerHeight }, { align, rtl });
      tip.style.top = `${p.top}px`;
      tip.style.left = `${p.left}px`;
    }, delay);
  }
  function hide() {
    clearTimeout(timer);
    if (tip?.matches(":popover-open")) tip.hidePopover();
  }
</script>

<span
  bind:this={wrap}
  data-ui="tooltip"
  class="inline-flex max-w-full"
  role="presentation"
  onpointerenter={() => show(300)}
  onpointerleave={hide}
  onfocusin={() => show(0)}
  onfocusout={hide}
  onkeydown={e => e.key === "Escape" && hide()}>
  {@render children()}
</span>
<div
  bind:this={tip}
  id="{id}-tip"
  popover="manual"
  role="tooltip"
  class="pointer-events-none fixed inset-auto m-0 text-start whitespace-normal w-max max-w-[min(18rem,calc(100vw-16px))] rounded-lg bg-ink px-2.5 py-1.5 text-[12px] leading-snug text-bg shadow-[var(--shadow)]">
  {text}
</div>
