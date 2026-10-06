<script lang="ts">
  // Israeli tax return (old web/src/views/Tax.svelte): /tax/il = Form 1301, /tax/il/review = pre-filing checks
  // (legacy #/tax/review maps here). Year picker with "+ Add <next year>".
  import { page } from "$app/state";
  import { goto } from "#lib/nav.ts";
  import { S, addYear, bizLabel, isUS } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { PageHeader, Select, Tabs } from "#lib/ui/index.ts";
  import { ilYear } from "../il.ts";
  import Return from "../Return.svelte";
  import Checks from "../Checks.svelte";

  const tab = $derived(page.params.tab === "review" ? "review" : "return");
  const show = (k: string) => goto(k === "review" ? `/tax/il/review${page.url.search}` : `/tax/il${page.url.search}`, { replace: true, reset: false });
  const years = $derived(S.data!.years.map((y) => ({ value: String(y), label: t("tax.yearOption", { y }) })).reverse());
  const next = $derived(Math.max(...S.data!.years) + 1);
  const ask = $derived(ilYear(S.year).ask.length);
  // US books have their own filings page
  $effect(() => {
    if (isUS()) void goto("/tax/us", { replace: true });
  });
  async function pickYear(v: string) {
    if (v === "add") {
      await addYear(next);
      S.year = next;
    } else S.year = +v;
  }
</script>

<svelte:head><title>{t("tax.titleIL")} · OpenBooks</title></svelte:head>

<PageHeader title={t("tax.titleIL")} sub={t("tax.subIL", { biz: bizLabel() })}>
  {#snippet actions()}
    <Select
      variant="pill"
      icon="calendar"
      label={t("period.taxYear")}
      value={String(S.year)}
      options={[...years, { value: "add", label: t("tax.addYear", { y: next }) }]}
      onchange={pickYear} />
  {/snippet}
  <Tabs
    class="mt-2"
    label={t("tax.titleIL")}
    items={[
      { key: "return", label: t("tax.tabReturn") },
      { key: "review", label: t("tax.tabReview"), count: ask },
    ]}
    value={tab}
    onchange={show} />
</PageHeader>

{#if tab === "review"}<Checks onreturn={() => show("return")} />{:else}<Return />{/if}
