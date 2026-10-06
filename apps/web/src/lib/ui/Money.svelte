<script lang="ts">
  // An amount: −₪1,234.⁵⁶ — whole units full size, cents raised (Mercury style). Goes through privacy scramble(), always LTR
  // (an isolated span, so it never reorders a Hebrew sentence) and never wraps. `plus` adds "+" to positives.
  // A span with unicode-bidi:isolate (.num) instead of <bdi>, because privacy mode blurs <bdi> (user text) — amounts are inflated, not blurred.
  import { scramble } from "../privacy.svelte.ts";
  import { moneyParts } from "./money.ts";
  let {
    value,
    currency = "ILS",
    cents = true,
    plus = false,
    tone,
    class: cls = "",
  }: { value: number; currency?: string; cents?: boolean; plus?: boolean; tone?: "auto"; class?: string } = $props();
  const p = $derived(moneyParts(scramble(value), currency));
</script>

<span data-ui="money" dir="ltr" class={["num whitespace-nowrap", tone === "auto" && (value < 0 ? "text-bad" : value > 0 ? "text-good" : ""), cls]}
  >{p.sign || (plus && value > 0 ? "+" : "")}{p.symbol}{p.whole}{#if cents}<span class="relative -top-[0.45em] ms-px text-[0.6em]">.{p.cents}</span>{/if}</span>
