<script lang="ts">
  // What the server kept out or had to drop, so it is never silent: a bank import that tried to change the closed period (the closed
  // rows stayed as they were) and splits a re-import broke (the transaction shows unsplit until the split is fixed).
  import { S, mdy } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Button, Icon } from "#lib/ui/index.ts";

  let { onsplit }: { onsplit?: (ids: string[]) => void } = $props();
  const ci = $derived(S.data?.integrity?.closedImport ?? null);
  const broken = $derived(S.data?.integrity?.brokenSplits ?? []);
</script>

{#if ci || broken.length}
  <div class="space-y-2 px-4 pt-4 sm:px-8">
    {#if ci}
      <div class="panel flex flex-wrap items-center gap-3 px-4 py-3 text-[14px]" role="status">
        <Icon name="lock" size={15} class="shrink-0 text-warn" />
        <span class="min-w-0 flex-1 basis-60 text-ink-2">{t("integrity.closedImport", { date: mdy(ci.close), added: ci.added, removed: ci.removed, changed: ci.changed })}</span>
        <Button size="sm" variant="ghost" href="/history">{t("integrity.seeHistory")}</Button>
      </div>
    {/if}
    {#if broken.length}
      <div class="panel flex flex-wrap items-center gap-3 px-4 py-3 text-[14px]" role="status">
        <Icon name="alert" size={15} class="shrink-0 text-warn" />
        <span class="min-w-0 flex-1 basis-60 text-ink-2">{t("integrity.brokenSplits", { n: broken.length })}</span>
        {#if onsplit}<Button size="sm" onclick={() => onsplit(broken)}>{t("common.open")}</Button>{/if}
      </div>
    {/if}
  </div>
{/if}
