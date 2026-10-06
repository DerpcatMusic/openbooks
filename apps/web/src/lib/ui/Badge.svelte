<script lang="ts">
  // Pill / badge / tag. Never wraps and never shrinks (whitespace-nowrap shrink-0): it sizes to its text, so a short label like
  // "הכי משתלם" can't break onto two lines. Keep the text short; the surrounding row should flex-wrap.
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons.ts";
  import { tones, type Tone } from "./styles.ts";
  let {
    tone = "neutral",
    shape = "pill",
    size = "md",
    icon,
    class: cls = "",
    children,
  }: { tone?: Tone; shape?: "pill" | "tag"; size?: "sm" | "md"; icon?: IconName; class?: string; children: Snippet } = $props();
</script>

<span
  data-ui="badge"
  class={[
    "inline-flex shrink-0 items-center gap-1 whitespace-nowrap leading-none",
    size === "sm" ? "h-[18px] px-1.5 text-[11px]" : "h-[22px] px-2 text-[12px]",
    shape === "pill" ? "rounded-full" : "rounded-md",
    tones[tone],
    cls,
  ]}>
  {#if icon}<Icon name={icon} size={size === "sm" ? 10 : 12} />{/if}{@render children()}
</span>
