<script lang="ts">
  // Suggested transfers touching the open business: money that left one of your accounts and arrived in another (here or in another
  // business, in any currency). Each pair shows both sides and what confirming files them as; Confirm or "Not a transfer" (never
  // suggested again). The matching is core transfers.ts, served by GET /api/transfers; renders nothing when there is nothing to decide.
  import { transferAccounts } from "@openbooks/core";
  import { api, type TransferSide, type TransferSuggestion } from "#lib/api.ts";
  import { S, catLabel, decideTransfer, mdy } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Button, Card, Icon, Money } from "#lib/ui/index.ts";

  let list = $state<TransferSuggestion[]>([]),
    busy = $state<string | null>(null);
  $effect(() => {
    const e = S.e;
    void S.v;
    void S.rev;
    void S.data?.txns; // any write on this or a sibling entity: ask again
    let live = true;
    api
      .transfers(e)
      .then((r) => live && (list = r.suggestions))
      .catch(() => live && (list = []));
    return () => (live = false);
  });
  const ref = (x: TransferSide) => `${x.entity}/${x.id}`;
  const entity = (id: string) => S.data?.entities.find((x) => x.id === id);
  const name = (id: string) => entity(id)?.short ?? entity(id)?.name ?? id;
  const filedAs = (m: TransferSuggestion) => transferAccounts({ id: m.out.entity, ...entity(m.out.entity) }, { id: m.in.entity, ...entity(m.in.entity) });
  async function decide(m: TransferSuggestion, as: "confirmed" | "rejected") {
    busy = ref(m.out);
    await decideTransfer(ref(m.out), ref(m.in), as);
    list = list.filter((x) => ref(x.out) !== ref(m.out));
    busy = null;
  }
</script>

{#snippet side(label: string, x: TransferSide)}
  <div class="min-w-0 flex-1">
    <div class="text-[12px] text-sub">{label} <bdi class="text-ink-2">{x.account}</bdi>{#if x.entity !== S.e} · <bdi>{name(x.entity)}</bdi>{/if}</div>
    <div class="flex flex-wrap items-baseline gap-x-2">
      <Money value={x.amount} currency={x.currency} plus class={x.amount > 0 ? "text-good" : "text-ink"} />
      <span class="text-[12px] text-sub num">{mdy(x.date)}</span>
    </div>
    <bdi class="block truncate text-[12px] text-faint" title={x.desc}>{x.desc}</bdi>
  </div>
{/snippet}

{#if list.length}
  <Card title={t("money.transfers.title")} description={t("money.transfers.sub")} flush class="mb-6">
    <ul class="divide-y divide-line">
      {#each list as m (ref(m.out))}
        {@const acc = filedAs(m)}
        <li class="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-5">
          <div class="flex min-w-0 flex-[1_1_22rem] items-center gap-3">
            {@render side(t("money.transfers.out"), m.out)}
            <Icon name="chevron-right" size={16} class="shrink-0 text-faint rtl:rotate-180" />
            {@render side(t("money.transfers.in"), m.in)}
          </div>
          <div class="flex min-w-0 flex-col gap-1 text-[12px] text-sub">
            {#if m.out.currency !== m.in.currency}<span>{t("money.transfers.diff", { pct: `${(m.diff * 100).toFixed(1)}%` })}</span>{/if}
            <span>{t("money.transfers.as", { out: catLabel(acc.out), in: catLabel(acc.in) })}</span>
          </div>
          <div class="ms-auto flex gap-2">
            <Button size="sm" variant="ghost" disabled={busy === ref(m.out)} onclick={() => decide(m, "rejected")}>{t("money.transfers.reject")}</Button>
            <Button size="sm" variant="primary" icon="check" disabled={busy === ref(m.out)} onclick={() => decide(m, "confirmed")}>{t("money.transfers.confirm")}</Button>
          </div>
        </li>
      {/each}
    </ul>
  </Card>
{/if}
