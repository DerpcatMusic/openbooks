<script lang="ts">
  // A headline number that counts up: label, big value (Money unless `raw`), delta chip vs prior period, hint.
  // The value never wraps; at 375px a long amount shrinks via the clamp() font size rather than overflowing.
  import type { Snippet } from "svelte";
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import { t } from "../i18n.svelte.ts";
  import Money from "./Money.svelte";
  import Icon from "./Icon.svelte";
  let {
    label,
    value,
    currency = "ILS",
    raw = false,
    delta = null,
    invert = false,
    deltaLabel,
    hint = "",
    size = "lg",
    class: cls = "",
    children,
  }: {
    label: string;
    value: number;
    currency?: string;
    raw?: boolean;
    delta?: number | null;
    invert?: boolean;
    deltaLabel?: string;
    hint?: string;
    size?: "lg" | "md";
    class?: string;
    children?: Snippet;
  } = $props();
  const tw = Tween.of(() => value ?? 0, { duration: 700, easing: cubicOut });
  const good = $derived(delta != null && delta >= 0 !== invert);
</script>

<div data-ui="stat" class={["min-w-0", cls]}>
  <div class="text-[14px] text-ink-2">{label}</div>
  <div class={["display mt-1.5 text-ink", size === "lg" ? "text-[clamp(26px,8vw,34px)] leading-10" : "text-[24px] leading-8"]}>
    {#if raw}<span class="num whitespace-nowrap">{value}</span>{:else}<Money value={tw.current} {currency} cents={size !== "lg" || Math.abs(value) < 100} />{/if}
  </div>
  {#if (delta != null && isFinite(delta)) || hint}
    <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
      {#if delta != null && isFinite(delta)}
        <span dir="ltr" class={["num inline-flex h-[22px] shrink-0 items-center gap-0.5 rounded-full px-1.5 whitespace-nowrap", good ? "bg-good/12 text-good" : "bg-bad/12 text-bad"]}>
          <Icon name={delta >= 0 ? "arrow-up-right" : "arrow-down-left"} size={12} />{Math.abs(delta * 100).toFixed(1)}%
        </span><span class="text-sub">{deltaLabel ?? t("stat.vsPrior")}</span>
      {/if}
      {#if hint}<span class="text-sub">{hint}</span>{/if}
    </div>
  {/if}
  {@render children?.()}
</div>
