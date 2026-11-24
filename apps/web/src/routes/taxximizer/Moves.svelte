<script lang="ts">
  // "If you do this, you keep that": the wealth moves (@openbooks/country-il MOVES) as calculators on this year's plan. Each opens to its
  // inputs (prefilled with typical numbers), how to do it, the catch and the sources; the result re-runs on every keystroke.
  import { MOVES, runMove, type IlRates, type Move, type PlanInput } from "@openbooks/country-il";
  import { t, lang } from "#lib/i18n.svelte.ts";
  import { moneyText } from "#lib/ui/money.ts";
  import { Badge, Card, Input } from "#lib/ui/index.ts";

  let { base, T, fx }: { base: PlanInput; T: IlRates; fx: number | null } = $props();

  let vals = $state<Record<string, Record<string, number>>>({});
  let open = $state<string | null>(null);
  const ils = (n: number) => moneyText(n, "ILS", false);
  const res = (m: Move) => runMove(m, vals[m.id] ?? {}, { base, T, fx });
  const set = (m: Move, key: string, v: string) => (vals[m.id] = { ...vals[m.id], [key]: v === "" ? NaN : +v });
  const shown = (m: Move, key: string) => vals[m.id]?.[key] ?? m.inputs.find((x) => x.key === key)!.def;
  const unit = { ils: "₪", usd: "$", pct: "%", n: "" } as const;
</script>

<Card title={t("moves.title")} description={t("moves.sub")}>
  <ul class="divide-y divide-line">
    {#each MOVES as m (m.id)}
      {@const r = res(m)}
      <li class="py-3">
        <button type="button" class="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 text-start" aria-expanded={open === m.id} onclick={() => (open = open === m.id ? null : m.id)}>
          <span class="flex-1 text-[14px] text-ink" dir="auto">{m.title[lang()]}</span>
          {#if r && r.now > 0}<span class="num text-[14px] whitespace-nowrap text-good">{t(r.deferred ? "moves.nowDeferred" : "moves.now", { amount: ils(r.now) })}</span>{/if}
          {#if r?.later && r.later > 0}<span class="num text-[13px] whitespace-nowrap text-accent-ink">{t("moves.later", { amount: ils(r.later) })}</span>{/if}
          {#if !r}<span class="text-[12px] text-faint">{t("moves.needFx")}</span>{/if}
        </button>
        {#if open === m.id}
          <div class="mt-3 grid gap-3">
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {#each m.inputs as x (x.key)}
                <Input numeric type="number" step="any" label={`${x.label[lang()]}${unit[x.kind] ? ` (${unit[x.kind]})` : ""}`} value={shown(m, x.key)} oninput={(e) => set(m, x.key, e.currentTarget.value)} />
              {/each}
            </div>
            <p class="text-[13px] text-ink-2" dir="auto">{m.how[lang()]}</p>
            <p class="text-[12px] text-warn" dir="auto">{m.risk[lang()]}</p>
            <div class="flex flex-wrap items-center gap-2 text-[12px] text-sub">
              <Badge size="sm" tone={m.confidence === "high" ? "good" : m.confidence === "medium" ? "warn" : "bad"}>{t(`moves.conf.${m.confidence}`)}</Badge>
              {#each m.src as s, n (n)}<a class="text-accent-ink hover:underline" href={s} target="_blank" rel="noreferrer">{t("taxximizer.source")} {n + 1}</a>{/each}
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  <p class="mt-2 text-[12px] text-faint">{t("moves.guardrail")}</p>
</Card>
