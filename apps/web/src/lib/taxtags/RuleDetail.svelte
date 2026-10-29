<script lang="ts">
  // One deduction rule laid out for a person deciding whether to rely on it: the percentage, the VAT, the cap, how firm the source is
  // (confidence badge, "not confirmed" warning), the conditions, what to keep as proof, and links to the sources.
  import type { DeductionRule } from "@openbooks/schema";
  import { Badge } from "#lib/ui/index.ts";
  import type { Tone } from "#lib/ui/index.ts";
  import { t, lang, has } from "#lib/i18n.svelte.ts";
  import { shaky } from "./shaky.ts";

  let { rule, open = false }: { rule: DeductionRule; open?: boolean } = $props();
  const CONF: Record<string, Tone> = { statute: "good", regulation: "good", "irs-guidance": "accent", circular: "accent", practice: "warn" };
  const sym = (c: string) => ({ ILS: "₪", USD: "$", EUR: "€" })[c] ?? c;
  const cap = $derived(rule.cap?.amount != null ? rule.cap : null);
  const perKey = (p: string) => (has(`taxtags.per.${p}`) ? t(`taxtags.per.${p}`) : p);
  const pct = (n: number) => `${+n.toFixed(2)}%`;
</script>

<div class="space-y-3 text-[13px]">
  <div class="flex flex-wrap items-center gap-1.5">
    {#if rule.incomeTaxPct === null}
      <Badge tone="warn">{t("taxtags.rule.byUse")}</Badge>
    {:else}
      <Badge tone={rule.incomeTaxPct >= 100 ? "good" : rule.incomeTaxPct > 0 ? "accent" : "bad"}>{t("taxtags.rule.deductible", { pct: pct(rule.incomeTaxPct) })}</Badge>
    {/if}
    <Badge>{rule.vatPct === null ? t("taxtags.rule.vatUnknown") : t("taxtags.rule.vat", { pct: pct(rule.vatPct) })}</Badge>
    {#if cap}<Badge>{t("taxtags.rule.cap", { amount: sym(cap.currency) + cap.amount!.toLocaleString("en-US"), per: perKey(cap.per) })}</Badge>{/if}
    <Badge tone={CONF[rule.confidence] ?? "neutral"}>{has(`taxtags.conf.${rule.confidence}`) ? t(`taxtags.conf.${rule.confidence}`) : rule.confidence}</Badge>
    {#if shaky(rule)}<Badge tone="warn" icon="alert">{t("taxtags.verify")}</Badge>{/if}
  </div>
  {#if rule.unverified?.length}
    <p class="rounded-lg bg-warn/10 px-3 py-2 text-warn">{t("taxtags.unverified", { fields: rule.unverified.join(", ") })}</p>
  {/if}
  {#if rule.notes}<p class="text-ink-2" dir="auto" lang="en">{rule.notes}</p>{/if}
  <details {open} class="group">
    <summary class="cursor-pointer text-sub hover:text-ink">{t("taxtags.rule.details")}</summary>
    <div class="mt-2 space-y-3">
      {#if rule.conditions.length}
        <div>
          <div class="text-sub">{t("taxtags.rule.conditions")}</div>
          <ul class="mt-1 list-disc space-y-1 ps-5 text-ink-2" dir="auto">{#each rule.conditions as c (c)}<li>{c}</li>{/each}</ul>
        </div>
      {/if}
      {#if rule.evidence.length}
        <div>
          <div class="text-sub">{t("taxtags.rule.evidence")}</div>
          <ul class="mt-1 list-disc space-y-1 ps-5 text-ink-2" dir="auto">{#each rule.evidence as c (c)}<li>{c}</li>{/each}</ul>
        </div>
      {/if}
    </div>
  </details>
  {#if rule.sources.length}
    <div>
      <div class="text-sub">{t("taxtags.rule.sources")}</div>
      <ul class="mt-1 space-y-1">
        {#each rule.sources as s (s.url)}
          <li>
            <a class="text-accent-ink [overflow-wrap:anywhere] hover:underline" href={s.url} target="_blank" rel="noreferrer" dir="auto" lang={lang() === "he" ? undefined : "en"}>{s.title}</a>
            {#if s.section}<span class="text-faint" dir="auto"> · {s.section}</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
