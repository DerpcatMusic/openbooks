<script lang="ts">
  // US tax: what the IRS needs for the tax year, from the books, and the official forms filled from them. The business type picks the page:
  // a person's sole proprietorship / single-member LLC (Schedule C + SE + QBI + 1040-ES), a foreign-owned LLC or a C-corp (5472 + 1120),
  // a partnership (1065 + K-1s) or an S corporation (1120-S + K-1s). Maths: the US pack (packages/countries/us); this page gathers and shows.
  import { S } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { PageHeader, Select } from "#lib/ui/index.ts";
  import { navKey, track } from "#lib/ustax/books.ts";
  import Foreign from "./Foreign.svelte";
  import Individual from "./Individual.svelte";
  import PassThrough from "./PassThrough.svelte";

  const y = $derived(S.year);
  const tr = $derived(track(y));
  const yearOpts = $derived(
    (S.data?.years ?? [])
      .map((v) => ({ value: String(v), label: String(v) }))
      .reverse(),
  );
  const SUB = { individual: "fus.sub.individual", "foreign-owned": "taxUS.sub", "c-corp": "taxUS.cc.sub", partnership: "fus.sub.partnership", "s-corp": "fus.sub.scorp" } as const;
</script>

<PageHeader title={t(navKey(y))} badge={String(y)} sub={t(SUB[tr])}>
  {#snippet actions()}
    <Select variant="pill" icon="calendar" label={t("taxUS.year")} value={String(y)} options={yearOpts} onchange={(v) => (S.year = +v)} />
  {/snippet}
</PageHeader>

<div class="px-4 pb-12 pt-4 sm:px-8">
  {#if tr === "individual"}<Individual {y} />
  {:else if tr === "partnership" || tr === "s-corp"}<PassThrough {y} type={tr} />
  {:else}<Foreign {y} />{/if}
</div>
