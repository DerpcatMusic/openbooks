<script lang="ts">
  // Native <select> (keyboard and screen readers for free). variant "field": labelled, full width, with hint/error.
  // variant "pill": compact toolbar dropdown; the label is visually hidden but still announced. Bind `value`.
  // The select sizes to its options and never truncates them inside the page; it's capped at the container width.
  import Field from "./Field.svelte";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons.ts";
  import type { SelectGroup, SelectOption } from "./types.ts";
  let {
    label,
    value = $bindable(),
    options = [],
    groups,
    onchange,
    hint,
    error,
    variant = "field",
    icon,
    disabled = false,
    class: cls = "",
  }: {
    label: string;
    value?: string;
    options?: SelectOption[];
    groups?: SelectGroup[];
    onchange?: (value: string) => void;
    hint?: string;
    error?: string | null;
    variant?: "field" | "pill";
    icon?: IconName;
    disabled?: boolean;
    class?: string;
  } = $props();
  const pill = $derived(variant === "pill");
</script>

{#snippet opts()}
  {#if groups}
    {#each groups as g (g.label)}<optgroup label={g.label}>{#each g.options as o (o.value)}<option value={o.value} disabled={o.disabled}>{o.label}</option>{/each}</optgroup>{/each}
  {:else}
    {#each options as o (o.value)}<option value={o.value} disabled={o.disabled}>{o.label}</option>{/each}
  {/if}
{/snippet}

<Field {label} {hint} {error} hideLabel={pill} class={[pill ? "inline-flex max-w-full shrink-0" : "", cls].join(" ")}>
  {#snippet children(a)}
    <div class={["relative flex max-w-full items-center text-ink-2", pill ? "w-fit" : "w-full"]}>
      {#if icon}<Icon name={icon} size={15} class="pointer-events-none absolute start-3" />{/if}
      <select
        id={a.id}
        aria-describedby={a.describedby}
        aria-invalid={a.invalid}
        {disabled}
        bind:value
        onchange={e => onchange?.(e.currentTarget.value)}
        class={[
          "max-w-full min-w-0 cursor-pointer appearance-none bg-transparent pe-8 text-[14px] text-ink outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-default disabled:opacity-50",
          pill ? "h-8 rounded-full bg-fill hover:bg-line-strong" : "h-9 w-full rounded-lg border bg-panel",
          !pill && (a.invalid ? "border-bad" : "border-line-strong hover:border-ink/30"),
          icon ? "ps-9" : "ps-3",
        ]}>
        {@render opts()}
      </select>
      <Icon name="chevron-down" size={14} class="pointer-events-none absolute end-3 opacity-70" />
    </div>
  {/snippet}
</Field>
