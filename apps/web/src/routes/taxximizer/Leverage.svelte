<script lang="ts">
  // "Your money as leverage": what the merged books (every business, in ₪) say you could keep from how your money sits and moves:
  // idle cash, what each transfer route costs, room left under the zair ceiling. The maths is @openbooks/core levers(); this card fetches
  // the merged flow and net worth and shows them, plus the two moves the wealthy use that apply here (borrow against, defer in a wrapper).
  import { levers, type Lever } from "@openbooks/core";
  import { api } from "#lib/api.ts";
  import { S } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { moneyText } from "#lib/ui/money.ts";
  import { Badge, Card, Skeleton } from "#lib/ui/index.ts";

  let { y, zair }: { y: number; zair?: { turnover: number; ceiling: number } | undefined } = $props();

  const CUR = "ILS";
  const day = (d: Date) => d.toLocaleDateString("sv");
  let got = $state<Lever[] | null>(null),
    failed = $state(false);
  $effect(() => {
    void S.rev;
    const today = new Date(),
      end = String(y) === day(today).slice(0, 4) ? day(today) : `${y}-12-31`,
      start = day(new Date(Date.parse(`${end}T00:00:00Z`) - 89 * 86400000));
    const z = zair;
    let stale = false;
    failed = false;
    Promise.all([api.flow(CUR, `${y}-01-01`, end), api.netWorth(CUR, start, end)])
      .then(([f, nw]) => {
        if (stale) return;
        const cash = nw.dates.map((_, i) => nw.series.reduce((a, s) => (s.liability ? a : a + (s.values[i] ?? 0)), 0));
        const months = Math.max(1, f.monthly?.length ?? 1);
        got = levers({
          cashDaily: cash,
          monthlyOut: (f.totals?.out ?? 0) / months,
          journeys: f.transfers?.journeys ?? [],
          ...(z ? { zair: z } : {}),
        });
      })
      .catch(() => {
        if (!stale) failed = true;
      });
    return () => {
      stale = true;
    };
  });
  const m = (n: number) => moneyText(n, CUR, false);
</script>

<Card>
  <div class="flex flex-wrap items-baseline gap-2">
    <h2 class="flex-1 text-[16px] text-ink">{t("lev.title")}</h2>
    {#if got?.length}<Badge size="sm" tone="good">{t("lev.total", { amount: m(got.reduce((a, l) => a + l.yearly, 0)) })}</Badge>{/if}
  </div>
  <p class="mt-1 max-w-[70ch] text-[13px] text-sub">{t("lev.sub")}</p>

  {#if failed}
    <p class="mt-4 text-[14px] text-sub">{t("lev.failed")}</p>
  {:else if !got}
    <Skeleton class="mt-4 h-24" />
  {:else}
    <ul class="mt-4 divide-y divide-line">
      {#each got as l (l.id)}
        <li class="py-3">
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="flex-1 text-[14px] text-ink">{t(`lev.${l.id}.title`)}</span>
            {#if l.yearly > 0}<span class="text-[14px] text-good">{t("lev.perYear", { amount: m(l.yearly) })}</span>{/if}
          </div>
          <p class="mt-1 text-[13px] text-ink-2">
            {#if l.id === "idle-cash"}
              {t("lev.idle-cash.body", { idle: m(l.idle), buffer: m(l.buffer), pct: Math.round(l.rate * 100) })}
            {:else if l.id === "transfer-routes"}
              {t("lev.transfer-routes.body", { fees: m(l.fees), best: l.best.route, pct: (l.best.pct * 100).toFixed(1) })}
            {:else}
              {t("lev.year-end.body", { headroom: m(l.headroom), pct: Math.round(l.used * 100) })}
            {/if}
          </p>
          {#if l.id === "transfer-routes"}
            <ul class="mt-2 grid gap-1 text-[12px] text-sub">
              {#each l.routes as r (r.route)}
                <li class="flex flex-wrap gap-x-3"><bdi class="text-ink-2">{r.route}</bdi><span>{t("lev.route", { n: r.count, sent: m(r.sent), fee: m(r.fee), pct: (r.pct * 100).toFixed(1) })}</span></li>
              {/each}
            </ul>
          {/if}
        </li>
      {:else}
        <li class="py-3 text-[14px] text-sub">{t("lev.none")}</li>
      {/each}
      <li class="py-3">
        <div class="text-[14px] text-ink">{t("lev.borrow.title")}</div>
        <p class="mt-1 text-[13px] text-ink-2">{t("lev.borrow.body")}</p>
      </li>
      <li class="py-3">
        <div class="text-[14px] text-ink">{t("lev.defer.title")}</div>
        <p class="mt-1 text-[13px] text-ink-2">{t("lev.defer.body")}</p>
      </li>
    </ul>
    <p class="mt-2 text-[12px] text-faint">{t("lev.guardrail")}</p>
  {/if}
</Card>
