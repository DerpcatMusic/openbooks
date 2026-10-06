<script lang="ts">
  // Label + control + hint/error, wired for screen readers: the control gets `id`, `aria-describedby` (hint and error) and
  // `aria-invalid`. Input/Select use it; wrap any custom control the same way:
  //   <Field label="Name" error={err}>{#snippet children(a)}<input id={a.id} aria-describedby={a.describedby} aria-invalid={a.invalid} />{/snippet}</Field>
  import type { Snippet } from "svelte";
  import type { FieldA11y } from "./types.ts";
  let {
    label,
    hint,
    error,
    required = false,
    hideLabel = false,
    class: cls = "",
    children,
  }: { label: string; hint?: string; error?: string | null; required?: boolean; hideLabel?: boolean; class?: string; children: Snippet<[FieldA11y]> } = $props();
  const id = $props.id();
  const describedby = $derived([hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(" ") || undefined);
</script>

<div data-ui="field" class={["flex min-w-0 flex-col gap-1.5", cls]}>
  <label for="{id}-c" class={hideLabel ? "sr-only" : "text-[13px] text-ink-2"}>
    {label}{#if required}<span class="text-bad" aria-hidden="true"> *</span>{/if}
  </label>
  {@render children({ id: `${id}-c`, describedby, invalid: error ? true : undefined })}
  {#if hint}<p id="{id}-h" class="text-[12px] text-sub">{hint}</p>{/if}
  {#if error}<p id="{id}-e" class="flex items-start gap-1 text-[12px] text-bad" role="alert">{error}</p>{/if}
</div>
