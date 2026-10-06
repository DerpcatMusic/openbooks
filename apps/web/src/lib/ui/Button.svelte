<script lang="ts">
  // Pill button (or link with `href`). The label never truncates: the button sizes to its content and, only if that is wider
  // than its container, wraps onto a second line instead of overflowing. Icons are shrink-0 and sized per `size`.
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon from "./Icon.svelte";
  import { url } from "#lib/nav.ts";
  import type { IconName } from "./icons.ts";
  import { ring, variants, type Variant } from "./styles.ts";

  type Props = HTMLButtonAttributes & {
    variant?: Variant;
    size?: "sm" | "md" | "lg";
    icon?: IconName;
    iconEnd?: IconName;
    href?: string;
    target?: string;
    loading?: boolean;
    children?: Snippet;
  };
  let { variant = "secondary", size = "md", icon, iconEnd, href, target, loading = false, disabled = false, type = "button", class: cls = "", children, ...rest }: Props = $props();

  const sizes = { sm: "min-h-7 gap-1.5 px-3 text-[13px]", md: "min-h-8 gap-1.5 px-4 text-[14px]", lg: "min-h-10 gap-2 px-5 text-[15px]" };
  const pad = { sm: "ps-2.5", md: "ps-3", lg: "ps-4" };
  const iconSize = { sm: 14, md: 15, lg: 17 };
  const c = $derived([
    "inline-flex max-w-full shrink-0 items-center justify-center rounded-full py-1 text-center leading-tight text-balance transition-colors [overflow-wrap:anywhere]",
    "disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40",
    ring,
    sizes[size],
    (icon || loading) && pad[size],
    variants[variant],
    cls,
  ]);
</script>

{#snippet inner()}
  {#if loading}
    <svg class="size-[1em] shrink-0 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      ><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity=".25" stroke-width="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg
    >
  {:else if icon}<Icon name={icon} size={iconSize[size]} />{/if}
  {#if children}<span class="min-w-0">{@render children()}</span>{/if}
  {#if iconEnd}<Icon name={iconEnd} size={iconSize[size] - 1} class="opacity-70" />{/if}
{/snippet}

{#if href}
  <a data-ui="button" href={url(href)} {target} class={c} aria-disabled={disabled || undefined} {...rest as Record<string, unknown>}>{@render inner()}</a>
{:else}
  <button data-ui="button" {type} disabled={disabled || loading} aria-busy={loading || undefined} class={c} {...rest}>{@render inner()}</button>
{/if}
