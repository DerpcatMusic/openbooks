<script lang="ts">
  // Money in against money out for the six months up to the end of the period, with the net as a line. In / out are core's
  // cashIn / cashOut: transfers, owner and own money are not income or spending.
  import { cashIn, cashOut, monthsIn } from "@openbooks/core";
  import { S, mon, monthYear } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Bars, Money } from "#lib/ui/index.ts";
  import { go } from "#lib/reports/go.ts";
  let { to, currency }: { to: string; currency: string } = $props();
  const back = (ym: string, n: number) => {
    const i = +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1 - n;
    return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  };
  const rows = $derived(
    monthsIn({ from: back(to, 5), to }).map((ym) => {
      const ts = S.data?.txns.filter((x) => x.date.startsWith(ym)) ?? [];
      const i = cashIn(ts),
        o = cashOut(ts);
      return { key: ym, label: mon(+ym.slice(5) - 1), sub: monthYear(ym), v: { in: i, out: o }, net: i - o };
    }),
  );
  const net = $derived(rows.reduce((a, r) => a + r.net, 0));
</script>

<div class="mb-4 flex flex-wrap items-baseline gap-x-3">
  <h2 class="min-w-0 flex-1 text-[16px] text-ink">{t("charts.inout.title")}</h2>
  <span class="text-[13px] text-sub">{t("charts.inout.net6")} <Money value={net} {currency} cents={false} plus class={net < 0 ? "text-bad" : "text-good"} /></span>
</div>
<Bars
  layout="group"
  height={240}
  {rows}
  {currency}
  label={t("charts.inout.title")}
  series={[
    { key: "in", label: t("charts.flow.in"), color: "var(--color-s3)" },
    { key: "out", label: t("charts.flow.out"), color: "var(--color-s2)" },
  ]}
  line={{ key: "net", label: t("charts.inout.net"), color: "var(--color-s1)" }}
  onselect={(r) => go("transactions", `month:${r.key}`)} />
