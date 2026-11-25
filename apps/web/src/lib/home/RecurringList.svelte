<script lang="ts">
  // Subscriptions and recurring income: payer, cadence, next date, amount, a price-change badge and a dismiss button.
  // `limit` shortens each side (Home); `restore` lists the dismissed ones too, with a button to bring each back (Reports).
  import { perMonth, type Recurring } from "@openbooks/core";
  import { catLabel, fmt, mdy } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Badge, IconButton, Money } from "#lib/ui/index.ts";
  import { go } from "#lib/reports/go.ts";
  import { allRecurring, dismissedDoc, isDismissed, setDismissed } from "./recurring.ts";
  let { currency, limit = 0, restore = false }: { currency: string; limit?: number; restore?: boolean } = $props();
  const all = $derived(allRecurring());
  const hidden = $derived(dismissedDoc());
  const live = $derived(all.filter((r) => !isDismissed(r, hidden)));
  const sides = $derived(
    (["out", "in"] as const)
      .map((side) => {
        const rs = live.filter((r) => (side === "out" ? r.amount < 0 : r.amount > 0));
        return { side, rs: limit ? rs.slice(0, limit) : rs, more: limit ? Math.max(0, rs.length - limit) : 0, monthly: rs.reduce((a, r) => a + perMonth(r), 0) };
      })
      .filter((s) => s.rs.length),
  );
  const gone = $derived(restore ? all.filter((r) => isDismissed(r, hidden)) : []);
  // a price change after a 1% step: up = paying more (out) or getting more (in)
  const up = (r: Recurring) => Math.abs(r.priceChange!.to) > Math.abs(r.priceChange!.from);
</script>

{#snippet row(r: Recurring, dismissed: boolean)}
  <li class="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
    <button type="button" class="min-w-0 flex-1 rounded text-start outline-none focus-visible:ring-2 focus-visible:ring-accent/50" onclick={() => go("transactions", r.payer)}>
      <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="min-w-0 truncate text-[14px] text-ink [overflow-wrap:anywhere]" dir="auto"><bdi>{r.payer}</bdi></span>
        {#if r.priceChange}
          <Badge size="sm" tone={up(r) === r.amount < 0 ? "bad" : "good"} icon={up(r) ? "arrow-up-right" : "arrow-down-left"}
            >{t("charts.rec.price", { from: fmt(Math.abs(r.priceChange.from), 2), to: fmt(Math.abs(r.priceChange.to), 2) })}</Badge>
        {/if}
      </span>
      <span class="block text-[12px] text-sub">{t(`charts.cad.${r.cadence}`)} · {catLabel(r.account)} · {t("charts.rec.next", { date: mdy(r.next) })}</span>
    </button>
    <Money value={r.amount} {currency} class="text-[14px] {r.amount > 0 ? 'text-good' : 'text-ink'}" />
    <IconButton
      size="sm"
      icon={dismissed ? "refresh" : "x"}
      label={dismissed ? t("charts.rec.restore", { name: r.payer }) : t("charts.rec.dismiss", { name: r.payer })}
      onclick={() => setDismissed(r.key, !dismissed)} />
  </li>
{/snippet}

{#if !sides.length && !gone.length}
  <p class="py-4 text-[14px] text-sub">{t("charts.rec.none")}</p>
{/if}
{#each sides as s (s.side)}
  <div class="not-first:mt-5">
    <div class="mb-1 flex flex-wrap items-baseline gap-x-3 text-[13px]">
      <h3 class="flex-1 text-sub">{t(s.side === "out" ? "charts.rec.subs" : "charts.rec.income")}</h3>
      <span class="text-sub">{t("charts.rec.perMonth")} <Money value={Math.abs(s.monthly)} {currency} cents={false} class="text-ink" /></span>
    </div>
    <ul>{#each s.rs as r (r.key)}{@render row(r, false)}{/each}</ul>
    {#if s.more}<p class="pt-1 text-[12px] text-sub">{t("charts.nw.more", { n: s.more })}</p>{/if}
  </div>
{/each}
{#if gone.length}
  <details class="mt-5">
    <summary class="cursor-pointer text-[13px] text-sub">{t("charts.rec.dismissed", { n: gone.length })}</summary>
    <ul class="mt-1 opacity-75">{#each gone as r (r.key)}{@render row(r, true)}{/each}</ul>
  </details>
{/if}
