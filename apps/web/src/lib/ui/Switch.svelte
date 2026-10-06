<script lang="ts">
  // On/off switch (role=switch, Space/Enter toggle). Bind `checked`. The label sits at the start, the track at the end.
  import { ring } from "./styles.ts";
  let {
    label,
    checked = $bindable(false),
    description,
    disabled = false,
    onchange,
    class: cls = "",
  }: { label: string; checked?: boolean; description?: string; disabled?: boolean; onchange?: (checked: boolean) => void; class?: string } = $props();
  const id = $props.id();
  const flip = () => {
    checked = !checked;
    onchange?.(checked);
  };
</script>

<div data-ui="switch" class={["flex min-w-0 items-center gap-3", disabled && "opacity-50", cls]}>
  <div class="min-w-0 flex-1">
    <span id="{id}-l" class="text-[14px] text-ink">{label}</span>
    {#if description}<p id="{id}-d" class="text-[12px] text-sub">{description}</p>{/if}
  </div>
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-labelledby="{id}-l"
    aria-describedby={description ? `${id}-d` : undefined}
    {disabled}
    onclick={flip}
    class={["relative inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors", ring, checked ? "bg-accent" : "bg-line-strong"]}>
    <span class={["block size-5 rounded-full bg-white shadow transition-transform", checked && "translate-x-4 rtl:-translate-x-4"]}></span>
  </button>
</div>
