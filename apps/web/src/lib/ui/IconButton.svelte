<script lang="ts">
  // Icon-only button: a fixed square (sm 28, md 32, lg 40 px) with the icon sized to fit inside it, so it can't overflow.
  // `label` is required: it becomes aria-label and the hover title. `pressed` makes it a toggle (aria-pressed).
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons.ts";
  import { ring, variants, type Variant } from "./styles.ts";

  type Props = Omit<HTMLButtonAttributes, "children"> & {
    icon: IconName;
    label: string;
    variant?: Variant;
    size?: "sm" | "md" | "lg";
    pressed?: boolean;
    href?: string;
  };
  let { icon, label, variant = "ghost", size = "md", pressed, href, type = "button", class: cls = "", ...rest }: Props = $props();
  const box = { sm: "size-7", md: "size-8", lg: "size-10" };
  const glyph = { sm: 14, md: 16, lg: 18 };
  const c = $derived([
    "inline-grid shrink-0 place-items-center overflow-hidden rounded-full transition-colors disabled:pointer-events-none disabled:opacity-40",
    ring,
    box[size],
    pressed ? "bg-accent/15 text-accent-ink" : variants[variant],
    cls,
  ]);
</script>

{#if href}
  <a data-ui="icon-button" {href} class={c} aria-label={label} title={label} {...rest as Record<string, unknown>}><Icon name={icon} size={glyph[size]} /></a>
{:else}
  <button data-ui="icon-button" {type} class={c} aria-label={label} title={label} aria-pressed={pressed} {...rest}><Icon name={icon} size={glyph[size]} /></button>
{/if}
