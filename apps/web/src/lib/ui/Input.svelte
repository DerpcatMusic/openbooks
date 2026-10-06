<script lang="ts">
  // Labelled text input. `numeric` = amounts/IDs: LTR, tabular figures, decimal keypad, end-aligned in RTL too (dir=ltr).
  // Free text gets dir="auto" so Hebrew and English values each read in their own direction. Extra attributes go to <input>.
  import type { HTMLInputAttributes } from "svelte/elements";
  import Field from "./Field.svelte";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons.ts";
  type Props = Omit<HTMLInputAttributes, "value"> & {
    label: string;
    value?: string | number | null;
    hint?: string;
    error?: string | null;
    hideLabel?: boolean;
    numeric?: boolean;
    icon?: IconName;
  };
  let { label, value = $bindable(), hint, error, hideLabel = false, numeric = false, icon, required, class: cls = "", ...rest }: Props = $props();
</script>

<Field {label} {hint} {error} {hideLabel} required={!!required} class={cls as string}>
  {#snippet children(a)}
    <div
      class={[
        "flex h-9 min-w-0 items-center gap-2 rounded-lg border bg-panel px-3 transition-colors focus-within:ring-2 focus-within:ring-accent/50",
        a.invalid ? "border-bad" : "border-line-strong hover:border-ink/30",
        rest.disabled && "opacity-50",
      ]}>
      {#if icon}<Icon name={icon} size={15} class="text-sub" />{/if}
      <input
        id={a.id}
        aria-describedby={a.describedby}
        aria-invalid={a.invalid}
        {required}
        bind:value
        dir={numeric ? "ltr" : "auto"}
        inputmode={numeric ? "decimal" : undefined}
        class={["h-full w-full min-w-0 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint", numeric ? "num pii" : "ui-align"]}
        {...rest} />
    </div>
  {/snippet}
</Field>
