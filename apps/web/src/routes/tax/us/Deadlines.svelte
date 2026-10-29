<script lang="ts">
  // The federal (and state fee) deadlines of this business that are still ahead, from the US pack's deadlines(): each moved to the next
  // business day by the rules in the pack, with the form and the IRS page it comes from.
  import { usOwned, usDeadlines } from "@openbooks/country-us";
  import { S, bizType, mdy } from "#lib/stores/books.svelte.ts";
  import { lang, t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Card } from "#lib/ui/index.ts";
  import { track } from "#lib/ustax/books.ts";

  let { y }: { y: number } = $props();
  const p = $derived((S.data?.profile ?? {}) as Record<string, string | boolean | undefined>);
  const type = $derived(bizType(y) ?? "");
  const now = new Date().toLocaleDateString("sv");
  let all = $state(false);
  const list = $derived(
    [y, y + 1]
      .flatMap((cal) =>
        usDeadlines(cal, {
          businessType: type,
          state: String(p.state ?? ""),
          formed: String(p.formed ?? ""),
          foreignAccountsOver10k: p.foreignAccounts === true,
          entityForm: type === "llc-ccorp" ? "llc" : "corporation",
          foreignOwned: track(y) === "c-corp" && !usOwned(String(p.ownerCountry ?? "")),
        }),
      )
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
  );
  const shown = $derived(all ? list : list.filter((d) => d.date >= now).slice(0, 8));
</script>

<Card title={t("fus.dl.title")} description={t("fus.dl.sub")} flush>
  <ul class="divide-y divide-line">
    {#each shown as d (d.id)}
      <li class="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
        <span class="w-28 shrink-0 text-[13px] text-sub num">{mdy(d.date)}</span>
        <span class="min-w-0 flex-1 basis-48 text-[14px] text-ink" dir="auto">{d.title[lang()]}</span>
        {#if d.form}<Badge size="sm">{d.form}</Badge>{/if}
        {#if d.source}<a class="text-[12px] text-accent-ink underline" href={d.source} target="_blank" rel="noreferrer">{t("fus.dl.source")}</a>{/if}
      </li>
    {:else}
      <li class="px-4 py-3 text-[14px] text-sub sm:px-5">{t("fus.dl.none")}</li>
    {/each}
  </ul>
  {#if list.length > shown.length || all}
    <div class="border-t border-line px-4 py-2 sm:px-5"><Button size="sm" variant="ghost" onclick={() => (all = !all)}>{t(all ? "fus.dl.less" : "fus.dl.all", { n: list.length })}</Button></div>
  {/if}
</Card>
