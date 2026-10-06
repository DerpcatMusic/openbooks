<script lang="ts">
  // Native checkbox with a clickable label and optional description. Bind `checked`. `indeterminate` for "some selected".
  let {
    label,
    checked = $bindable(false),
    indeterminate = false,
    description,
    disabled = false,
    onchange,
    class: cls = "",
  }: { label: string; checked?: boolean; indeterminate?: boolean; description?: string; disabled?: boolean; onchange?: (checked: boolean) => void; class?: string } = $props();
  const id = $props.id();
</script>

<div data-ui="checkbox" class={["flex min-w-0 items-start gap-2.5", disabled && "opacity-50", cls]}>
  <input
    id="{id}-c"
    type="checkbox"
    bind:checked
    {indeterminate}
    {disabled}
    aria-describedby={description ? `${id}-d` : undefined}
    onchange={e => onchange?.(e.currentTarget.checked)}
    class="mt-0.5 size-4 shrink-0 cursor-pointer rounded accent-accent outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-default" />
  <div class="min-w-0">
    <label for="{id}-c" class="cursor-pointer text-[14px] text-ink">{label}</label>
    {#if description}<p id="{id}-d" class="text-[12px] text-sub">{description}</p>{/if}
  </div>
</div>
