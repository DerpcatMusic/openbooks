<script lang="ts">
  // "Tax treatment" of one tag: search the country's deduction rules, read what a rule says (percentage, cap, conditions, proof, sources,
  // how firm it is), add a business-use share and a note. Saved on the tag as tag.tax = { rule, pct, note } (core tags.ts setTagTax).
  import { untrack } from "svelte";
  import { hasFormula, searchRules } from "@openbooks/core";
  import type { TagsDoc, TagTax } from "@openbooks/schema";
  import { Badge, Button, Dialog, Input, Search } from "#lib/ui/index.ts";
  import { t, lang, bidi } from "#lib/i18n.svelte.ts";
  import RuleDetail from "#lib/taxtags/RuleDetail.svelte";
  import { shaky } from "#lib/taxtags/shaky.ts";
  import { pctText, ruleOf, ruleName, rulesFor } from "#lib/taxtags.svelte.ts";

  let { open = $bindable(false), tag, onsave }: { open?: boolean; tag: TagsDoc["tags"][number] | null; onsave: (tax: TagTax | undefined) => void } = $props();
  const formId = $props.id();
  let q = $state(""),
    rule = $state(""),
    pct = $state(""),
    note = $state("");
  $effect(() => {
    if (!open) return;
    untrack(() => {
      q = "";
      rule = tag?.tax?.rule ?? "";
      pct = tag?.tax?.pct === undefined ? "" : String(tag.tax.pct);
      note = tag?.tax?.note ?? "";
    });
  });
  let listEl = $state<HTMLElement>();
  // bring the already-chosen rule into view when the dialog opens (the list is long)
  $effect(() => {
    if (open && listEl) untrack(() => requestAnimationFrame(() => listEl?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ block: "nearest" })));
  });
  const chosen = $derived(ruleOf(rule));
  const list = $derived(searchRules(rulesFor(), q, lang()));
  const n = $derived(pct.trim() === "" ? undefined : Number(pct));
  const pctErr = $derived(n !== undefined && !(n >= 0 && n <= 100) ? t("taxtags.pctRange") : null);
  const needs = $derived(chosen?.incomeTaxPct === null && n === undefined);
  function save() {
    if (pctErr) return;
    onsave({ ...(rule ? { rule } : {}), ...(n !== undefined ? { pct: n } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    open = false;
  }
</script>

<Dialog bind:open title={t("taxtags.pickerTitle", { tag: bidi(tag?.name ?? "") })} description={t("taxtags.pickerHelp")} size="lg">
  <form
    id={formId}
    class="grid gap-4"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}>
    <Search bind:value={q} label={t("taxtags.search")} />
    <div bind:this={listEl} class="max-h-56 overflow-y-auto rounded-lg border border-line" role="radiogroup" aria-label={t("taxtags.rules")}>
      <button
        type="button"
        role="radio"
        aria-checked={rule === ""}
        onclick={() => (rule = "")}
        class="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-start text-[14px] outline-none hover:bg-hover focus-visible:bg-hover {rule === '' ? 'bg-accent/10' : ''}">
        <span class="min-w-0 flex-1 text-ink-2">{t("taxtags.noRule")}</span>
      </button>
      {#each list as r (r.id)}
        <button
          type="button"
          role="radio"
          aria-checked={rule === r.id}
          onclick={() => (rule = r.id)}
          class="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-start text-[14px] outline-none last:border-0 hover:bg-hover focus-visible:bg-hover {rule === r.id ? 'bg-accent/10' : ''}">
          <span class="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]" dir="auto">{r.label[lang()]}</span>
          {#if shaky(r)}<Badge size="sm" tone="warn">{t("taxtags.verify")}</Badge>{/if}
          <Badge size="sm" tone={r.incomeTaxPct === null ? "warn" : r.incomeTaxPct >= 100 ? "good" : r.incomeTaxPct > 0 ? "accent" : "bad"}>{pctText(r) ?? t("taxtags.byUseShort")}</Badge>
        </button>
      {:else}
        <p class="px-3 py-4 text-[13px] text-sub">{t("taxtags.noMatch", { q: bidi(q) })}</p>
      {/each}
    </div>
    {#if chosen}
      <div class="rounded-lg bg-fill/60 p-3">
        <div class="mb-2 text-[14px] text-ink" dir="auto">{ruleName(chosen)}</div>
        <RuleDetail rule={chosen} />
      </div>
    {/if}
    <Input
      label={t("taxtags.pct")}
      bind:value={pct}
      numeric
      type="number"
      step="any"
      min="0"
      max="100"
      error={pctErr}
      hint={chosen && hasFormula(chosen.id) ? t("taxtags.pctIgnored") : needs ? t("taxtags.pctNeeded") : t("taxtags.pctHint")} />
    <Input label={t("taxtags.note")} bind:value={note} />
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (onsave(undefined), (open = false))}>{t("taxtags.clear")}</Button>
    <Button variant="ghost" onclick={() => (open = false)}>{t("common.cancel")}</Button>
    <Button variant="primary" type="submit" form={formId} disabled={!!pctErr}>{t("common.save")}</Button>
  {/snippet}
</Dialog>
