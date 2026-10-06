<script lang="ts">
  // Stroke icon. Decorative (aria-hidden) unless `label` is given. Always shrink-0, so a flex row can never squash it.
  import { FLIP, ICONS, type IconName } from "./icons.ts";
  let { name, size = 16, label, class: cls = "" }: { name: IconName; size?: number; label?: string; class?: string } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={["block shrink-0", FLIP.has(name) && "rtl:-scale-x-100", cls]}
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}><path d={ICONS[name]} /></svg>
