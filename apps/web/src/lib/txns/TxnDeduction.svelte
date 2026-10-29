<script lang="ts">
  // The drawer's "Tax deduction" block: what this expense is worth for income tax ("₪40 · 80% deductible = ₪32 · VAT 0"), which rule and
  // tag decided it, why (caps, formulas), and what proof to keep ("receipt needed" when nothing is attached). An untagged expense or
  // uncategorised outflow that matches a rule offers "tag as this".
  import type { Txn } from "@openbooks/schema";
  import { Badge, Button } from "#lib/ui/index.ts";
  import { url } from "#lib/nav.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { fmt, tagsDoc, toast } from "#lib/stores/books.svelte.ts";
  import { applySuggestion, hasRules, result, ruleName, ruleOf, suggestions } from "#lib/taxtags.svelte.ts";
  import { shaky } from "#lib/taxtags/shaky.ts";
  import { whyText } from "#lib/taxtags/tripWhy.ts";

  let { x, onmanage }: { x: Txn; onmanage: () => void } = $props();
  const year = $derived(+x.date.slice(0, 4));
  const res = $derived(hasRules() ? result(year) : null);
  const d = $derived(res?.rows.find((r) => r.id === x.id));
  const rule = $derived(ruleOf(d?.rule));
  const tagName = $derived(d?.tag ? (tagsDoc().tags.find((g) => g.id === d.tag)?.name ?? d.tag) : "");
  const hint = $derived(hasRules() ? suggestions(year).find((s) => s.ids.includes(x.id)) : undefined);
  const why = (w: { k: string; v?: number; w?: string }) => whyText(w, fmt);
  const pctText = (n: number) => `${+n.toFixed(2)}%`;
</script>

{#if d || hint}
  <div class="border-t border-line px-4 py-4 sm:px-5" data-testid="txn-deduction">
    <div class="text-[13px] text-sub">{t("taxtags.drawer.title")}</div>
    {#if d}
      <p class="mt-2 text-[15px] text-ink">
        {#if d.bucket === "untreated"}
          {t("taxtags.drawer.untreated")}
        {:else}
          {t("taxtags.drawer.line", { gross: fmt(d.gross, 2), pct: pctText(d.pct), deductible: fmt(d.deductible, 2), vat: fmt(d.vatReclaimable, 2) })}
        {/if}
      </p>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone={d.bucket === "full" ? "good" : d.bucket === "partial" ? "accent" : d.bucket === "none" ? "bad" : "neutral"}>{t(`taxtags.bucket.${d.bucket}`)}</Badge>
        {#if rule}<Badge><span dir="auto">{ruleName(rule)}</span></Badge>{/if}
        {#if rule && shaky(rule)}<Badge tone="warn" icon="alert">{t("taxtags.verify")}</Badge>{/if}
        {#if d.from === "tag"}<span class="text-[12px] text-sub">{t("taxtags.drawer.via.tag", { tag: bidi(tagName) })}</span>
        {:else if d.from === "account"}<span class="text-[12px] text-sub">{t("taxtags.drawer.via.account")}</span>
        {:else if d.from === "trip"}<a class="text-[12px] text-accent-ink hover:underline" href={url("/trips")}>{t("trips.drawer.via")}</a>{/if}
      </div>
      {#if !res?.taxEffect}
        <p class="mt-2 rounded-lg bg-fill px-3 py-2 text-[13px] text-sub">{t(`taxtags.noEffect.${res?.effect}`)}</p>
      {/if}
      {#if d.why.length}
        <ul class="mt-2 list-disc space-y-0.5 ps-5 text-[12px] text-sub">{#each d.why as w, i (i)}<li>{why(w)}</li>{/each}</ul>
      {/if}
      {#if d.deductible > 0}
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={d.receipt ? "warn" : "good"} icon={d.receipt ? "alert" : "check"}>{d.receipt ? t("taxtags.drawer.receipt") : t("taxtags.drawer.receiptOk")}</Badge>
          {#if d.evidence[0]}<span class="min-w-0 flex-1 text-[12px] text-sub [overflow-wrap:anywhere]" dir="auto">{t("taxtags.drawer.keep")} {d.evidence[0]}</span>{/if}
        </div>
      {/if}
    {/if}
    {#if hint}
      <div class="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-accent/8 px-3 py-2">
        <span class="min-w-0 flex-1 text-[13px] text-ink-2" dir="auto">{t("taxtags.drawer.suggest", { rule: bidi(ruleName(hint.rule)) })}</span>
        <Button size="sm" onclick={() => toast(t("taxtags.tx.tagged", { n: 1, tag: bidi(applySuggestion({ ...hint, ids: [x.id] })) }))}>{t("taxtags.drawer.tagAs")}</Button>
      </div>
    {/if}
    <Button variant="ghost" size="sm" class="mt-2" onclick={onmanage}>{t("taxtags.drawer.manage")}</Button>
  </div>
{/if}
