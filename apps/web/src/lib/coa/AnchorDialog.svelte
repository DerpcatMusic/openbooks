<script lang="ts">
  // An account's known balances (doc "anchors": { account: [{ date, balance }] }): the opening balance and any the bank stated since.
  // Each fixes the end-of-day balance on its date; daily balances (core dailyBalances) are worked out forward and back from them.
  // Balances the bank reports itself (Mercury's current balance) are listed as "From the bank" and can be overridden on the same date.
  import { checkAnchors, type Anchors } from "@openbooks/core";
  import { S, doc, mdy, saveDoc } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Button, Dialog, IconButton, Input, Money } from "#lib/ui/index.ts";

  let { open = $bindable(false), account, currency }: { open?: boolean; account: string | null; currency: string } = $props();
  const stored = $derived(doc<Anchors>("anchors", {}));
  const mine = $derived(account ? [...(stored[account] ?? [])].sort((a, b) => a.date.localeCompare(b.date)) : []);
  const bank = $derived(account && S.data ? (checkAnchors(S.data.checks)[account] ?? []).filter((x) => !mine.some((y) => y.date === x.date)) : []);
  // a new opening balance defaults to the day before the account's first transaction
  const first = $derived(S.data?.txns.find((x) => x.account === account)?.date);
  const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  let date = $state(""),
    balance = $state<string | number>("");
  $effect(() => {
    if (open) {
      date = first ? dayBefore(first) : new Date().toLocaleDateString("sv");
      balance = "";
    }
  });
  const ok = $derived(/^\d{4}-\d{2}-\d{2}$/.test(date) && balance !== "" && Number.isFinite(Number(balance)));
  const save = (list: { date: string; balance: number }[]) => {
    const next = { ...stored, [account!]: list };
    if (!list.length) delete next[account!];
    return saveDoc("anchors", Object.keys(next).length ? next : null);
  };
  async function add() {
    if (!ok || !account) return;
    await save([...mine.filter((x) => x.date !== date), { date, balance: Math.round(Number(balance) * 100) / 100 }]);
    balance = "";
  }
</script>

<Dialog bind:open title={t("money.anchor.title", { account: account ?? "" })} description={t("money.anchor.desc")} size="sm">
  {#if mine.length || bank.length}
    <h3 class="text-[13px] text-sub">{t("money.anchor.known")}</h3>
    <ul class="mt-1 mb-4 divide-y divide-line">
      {#each mine as x (x.date)}
        <li class="flex items-center gap-3 py-1.5 text-[14px]">
          <span class="num flex-1 text-ink-2">{mdy(x.date)}</span>
          <Money value={x.balance} {currency} />
          <IconButton icon="trash" size="sm" variant="ghost" label={t("money.anchor.remove", { date: mdy(x.date) })} onclick={() => save(mine.filter((y) => y.date !== x.date))} />
        </li>
      {/each}
      {#each bank as x (x.date)}
        <li class="flex items-center gap-3 py-1.5 text-[14px]">
          <span class="num flex-1 text-ink-2">{mdy(x.date)} <span class="text-[12px] text-sub">· {t("money.anchor.fromBank")}</span></span>
          <Money value={x.balance} {currency} />
          <span class="size-7"></span>
        </li>
      {/each}
    </ul>
  {/if}
  <form class="grid gap-3 sm:grid-cols-2" onsubmit={(e) => (e.preventDefault(), add())}>
    <Input label={t("money.anchor.date")} type="date" bind:value={date} required />
    <Input label={t("money.anchor.balance")} numeric inputmode="decimal" bind:value={balance} required />
  </form>
  {#snippet actions()}
    <Button onclick={() => (open = false)}>{t("common.close")}</Button>
    <Button variant="primary" icon="plus" disabled={!ok} onclick={add}>{t("money.anchor.add")}</Button>
  {/snippet}
</Dialog>
