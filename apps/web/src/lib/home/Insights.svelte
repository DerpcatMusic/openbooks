<script lang="ts">
  // Rule-based insights for the period (no AI): bank fees, subscription price rises, spending well above its normal, short runway.
  // Each is one sentence and opens the transactions behind it.
  import { bankFees, burn, priorPeriod, spendVsNormal, type Period } from "@openbooks/core";
  import { S, catLabel, fmt, periodTxns } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Icon, type IconName } from "#lib/ui/index.ts";
  import { go } from "#lib/reports/go.ts";
  import { activeRecurring } from "./recurring.ts";
  let { p }: { p: Period } = $props();
  type Item = { key: string; tone: "warn" | "bad" | "accent"; icon: IconName; text: string; go: () => unknown };
  const today = new Date().toLocaleDateString("sv");
  const items = $derived.by(() => {
    if (!S.data) return [];
    const out: Item[] = [];
    const fees = bankFees(periodTxns(p)),
      prevFees = bankFees(periodTxns(priorPeriod(p)));
    if (fees > 0)
      out.push({
        key: "fees",
        tone: "accent",
        icon: "bank",
        text: prevFees > 0 ? t("charts.ins.feesVs", { amount: fmt(fees), prior: fmt(prevFees) }) : t("charts.ins.fees", { amount: fmt(fees) }),
        go: () => go("transactions", "cat:expense:bank-fees"),
      });
    const since = new Date(Date.now() - 120 * 864e5).toLocaleDateString("sv");
    for (const r of activeRecurring())
      if (r.amount < 0 && r.priceChange && r.priceChange.date >= since && Math.abs(r.priceChange.to) > Math.abs(r.priceChange.from))
        out.push({
          key: `price:${r.key}`,
          tone: "warn",
          icon: "arrow-up-right",
          text: t("charts.ins.price", { name: r.payer, from: fmt(Math.abs(r.priceChange.from), 2), to: fmt(Math.abs(r.priceChange.to), 2) }),
          go: () => go("transactions", r.payer),
        });
    const sp = spendVsNormal(S.data.txns, p, 3);
    const spent = sp.reduce((a, x) => a + x.value, 0);
    for (const x of sp.filter((x) => x.change != null && x.change >= 0.4 && x.value - x.avg >= Math.max(50, spent * 0.05)).slice(0, 2))
      out.push({
        key: `spend:${x.key}`,
        tone: "warn",
        icon: "alert",
        text: t("charts.ins.spend", { name: catLabel(x.key), amount: fmt(x.value), pct: Math.round(x.change! * 100), avg: fmt(x.avg) }),
        go: () => go("transactions", `cat:${x.key}`),
      });
    const b = burn(S.data.txns, today);
    if (b?.kind === "burn" && b.runway != null && b.runway < 6)
      out.push({ key: "runway", tone: "bad", icon: "alert", text: t("charts.ins.runway", { n: b.runway }), go: () => go("reports", "cfa") });
    return out;
  });
  const tones = { warn: "bg-warn/12 text-warn", bad: "bg-bad/12 text-bad", accent: "bg-accent/12 text-accent-ink" };
</script>

<h2 class="mb-3 text-[16px] text-ink">{t("charts.ins.title")}</h2>
{#if items.length}
  <ul class="grid gap-2">
    {#each items as it (it.key)}
      <li>
        <button type="button" onclick={it.go} class="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-start outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50">
          <span class="grid size-7 shrink-0 place-items-center rounded-full {tones[it.tone]}"><Icon name={it.icon} size={14} /></span>
          <span class="min-w-0 flex-1 pt-0.5 text-[14px] text-ink-2 [overflow-wrap:anywhere]">{it.text}</span>
        </button>
      </li>
    {/each}
  </ul>
{:else}
  <p class="flex items-center gap-2 py-2 text-[14px] text-sub"><Icon name="check" size={15} class="text-good" />{t("charts.ins.none")}</p>
{/if}
