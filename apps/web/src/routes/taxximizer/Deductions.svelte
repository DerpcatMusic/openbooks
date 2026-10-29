<script lang="ts">
  // The Taxximizer's Deductions section: what the receipts are worth for tax, from the tags and account defaults (core deductions.ts on the
  // country pack's sourced rule table). Totals by bucket, receipts with a partial or zero deduction, money left on the table with one-click
  // "tag these", missing receipts, ceilings, and the table's tax moves that fit these books. Every figure is in the books' currency.
  import { ilPlan, type IlRates } from "@openbooks/country-il";
  import type { TxnDeduction } from "@openbooks/core";
  import { Badge, BarList, Button, Card, Checkbox, Icon, Table, type Column } from "#lib/ui/index.ts";
  import { t, bidi, lang } from "#lib/i18n.svelte.ts";
  import { url } from "#lib/nav.ts";
  import { S, bizType, ent, family, fmt, mdy, setProfile, toast } from "#lib/stores/books.svelte.ts";
  import { applySuggestion, hasRules, movesFor, result, ruleName, ruleOf, suggestions, table } from "#lib/taxtags.svelte.ts";
  import { shaky } from "#lib/taxtags/shaky.ts";

  let { y, revenue, points, T }: { y: number; revenue: number; points: number; T: IlRates | null } = $props();
  const res = $derived(hasRules() ? result(y) : null);
  const sg = $derived(suggestions(y));
  const mv = $derived(movesFor(y));
  const type = $derived(bizType(y) ?? "");
  const cur = $derived(ent().currency ?? "ILS");
  const txnById = $derived(new Map((S.data?.txns ?? []).map((x) => [x.id, x])));
  const pct = (n: number) => `${+n.toFixed(1)}%`;

  // osek zair: the deemed 30% against the receipts, through the same calculator the rest of the page uses
  const zair = $derived.by(() => {
    if (!res || !T || family() !== "il" || !["osek-zair", "osek-patur", "osek-murshe"].includes(type) || !(revenue > 0)) return null;
    const base = { turnover: revenue, expenses: res.totals.deductible, points, pension: 0, donations: 0, selfEmployed: true };
    return { deemed: revenue * 0.3, actual: res.totals.deductible, zairTax: ilPlan({ ...base, zair: true }, T).total, actualTax: ilPlan({ ...base, zair: false }, T).total, over: revenue > (T.zairCeiling ?? Infinity) };
  });

  // buckets: a stacked bar by gross, then the legend with counts
  const BUCKETS = [
    { key: "full", color: "var(--color-good)" },
    { key: "partial", color: "var(--color-accent)" },
    { key: "none", color: "var(--color-bad)" },
    { key: "untreated", color: "var(--color-line-strong)" },
  ] as const;
  const grossAll = $derived(Math.max(1, res?.totals.gross ?? 1));

  // receipts with a partial or zero deduction, sortable
  let sort = $state<{ key: string; dir: "asc" | "desc" }>({ key: "lost", dir: "desc" }),
    all = $state(false);
  const lost = (r: TxnDeduction) => r.gross - r.deductible;
  const losses = $derived.by(() => {
    const k: Record<string, (r: TxnDeduction) => number | string> = { date: (r) => r.date, desc: (r) => r.desc.toLowerCase(), rule: (r) => ruleName(r.rule), gross: (r) => r.gross, pct: (r) => r.pct, deductible: (r) => r.deductible, lost };
    const f = k[sort.key] ?? lost,
      s = sort.dir === "asc" ? 1 : -1;
    return (res?.rows ?? []).filter((r) => r.bucket === "partial" || r.bucket === "none").sort((a, b) => (f(a) < f(b) ? -s : f(a) > f(b) ? s : 0));
  });
  const columns = $derived<Column<TxnDeduction>[]>([
    { key: "date", label: t("common.date"), sortable: true },
    { key: "desc", label: t("common.description"), sortable: true, wrap: true },
    { key: "rule", label: t("taxtags.tx.rule"), sortable: true, wrap: true },
    { key: "gross", label: t("common.amount"), numeric: true, sortable: true },
    { key: "pct", label: t("taxtags.tx.pct"), numeric: true, sortable: true },
    { key: "deductible", label: t("taxtags.tx.deductible"), numeric: true, sortable: true },
    { key: "lost", label: t("taxtags.tx.lost"), numeric: true, sortable: true },
  ]);
  const onsort = (key: string) => (sort = { key, dir: sort.key === key && sort.dir === "desc" ? "asc" : "desc" });

  const gaps = $derived((res?.rows ?? []).filter((r) => r.receipt).sort((a, b) => b.deductible - a.deductible));
  const gapSum = $derived(gaps.reduce((a, r) => a + r.deductible, 0));
  const claimable = $derived(sg.filter((s) => s.kind === "uncategorized").reduce((a, s) => a + (s.deductible ?? 0), 0));
  const used = $derived(res?.byRule.map((x) => ruleOf(x.rule)).filter((r) => !!r) ?? []);
  const sources = $derived([...new Map(used.flatMap((r) => r!.sources).map((s) => [s.url, s])).values()]);
  const open = (id: string) => (S.drawer = id);
  const tagAs = (s: (typeof sg)[number]) => toast(t("taxtags.tx.tagged", { n: s.ids.length, tag: bidi(applySuggestion(s)) }));
  const sample = (s: (typeof sg)[number]) =>
    s.ids
      .slice(0, 3)
      .map((id) => txnById.get(id)?.desc)
      .filter(Boolean)
      .join(" · ");
  const attest = $derived(S.data?.profile?.usTrade === true);
</script>

<Card title={t("taxtags.tx.title")} description={t("taxtags.tx.sub", { y })}>
  <div id="deductions" class="space-y-6">
    {#if !res}
      <p class="text-[14px] text-sub">{t("taxtags.tx.noRules")}</p>
    {:else}
      {#if res.effect === "zair"}
        <div class="flex items-start gap-2.5 rounded-lg bg-accent/8 p-3 text-[13px] text-ink-2">
          <Icon name="info" size={16} class="mt-0.5 shrink-0 text-accent-ink" />
          <div class="min-w-0 space-y-1">
            <p>{t("taxtags.tx.zairNote")}</p>
            {#if zair && !zair.over}
              <p class="text-ink">
                {t("taxtags.tx.zairCompare", { deemed: fmt(zair.deemed), actual: fmt(zair.actual), zair: fmt(zair.zairTax), actualTax: fmt(zair.actualTax) })}
                <strong class="font-normal text-good">{zair.zairTax <= zair.actualTax ? t("taxtags.tx.zairWins", { amount: fmt(zair.actualTax - zair.zairTax) }) : t("taxtags.tx.actualWins", { amount: fmt(zair.zairTax - zair.actualTax) })}</strong>
              </p>
            {:else if zair?.over}<p>{t("taxtags.tx.zairOver")}</p>{/if}
          </div>
        </div>
      {:else if res.effect === "noEci"}
        <div class="space-y-3 rounded-lg bg-warn/10 p-3 text-[13px] text-ink-2">
          <div class="flex items-start gap-2.5">
            <Icon name="alert" size={16} class="mt-0.5 shrink-0 text-warn" />
            <p>{t("taxtags.tx.noEciNote")}</p>
          </div>
          <Checkbox label={t("taxtags.tx.attest")} description={t("taxtags.tx.attestHint")} checked={attest} onchange={(v) => void setProfile({ usTrade: v })} />
        </div>
      {/if}

      {#if family() === "us"}<p class="text-[12px] text-faint">{t("taxtags.tx.usNotModeled")}</p>{/if}

      <dl class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {#each [["gross", res.totals.gross, ""], ["deductible", res.totals.deductible, "text-good"], ["nonDeductible", res.totals.nonDeductible, res.totals.nonDeductible ? "text-warn" : ""], ["vat", res.totals.vatReclaimable, ""]] as [k, v, tone] (k)}
          <div class="min-w-0">
            <dt class="text-[13px] text-sub">{t(`taxtags.tx.stat.${k}`)}</dt>
            <dd class="display num text-[20px] leading-7 whitespace-nowrap {tone || 'text-ink'}">{fmt(v as number)}</dd>
          </div>
        {/each}
      </dl>

      <div>
        <div class="flex h-2.5 overflow-hidden rounded-full bg-fill" role="img" aria-label={t("taxtags.tx.bucketsAria")}>
          {#each BUCKETS as b (b.key)}<div style:width="{(res.byBucket[b.key].gross / grossAll) * 100}%" style:background={b.color}></div>{/each}
        </div>
        <ul class="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-2">
          {#each BUCKETS as b (b.key)}
            <li class="flex items-baseline gap-2">
              <span class="size-2 shrink-0 translate-y-px rounded-full" style:background={b.color}></span>
              <span class="min-w-0 flex-1 text-ink-2">{t(`taxtags.bucket.${b.key}`)} <span class="text-faint">· {res.byBucket[b.key].n}</span></span>
              <span class="num text-ink">{fmt(res.byBucket[b.key].gross)}</span>
            </li>
          {/each}
        </ul>
        <p class="mt-2 text-[12px] text-faint">{t("taxtags.tx.untreatedNote")}</p>
      </div>

      {#if sg.length}
        <section aria-labelledby="ded-left">
          <div class="flex flex-wrap items-baseline gap-x-3">
            <h3 id="ded-left" class="text-[14px] text-ink">{t("taxtags.tx.leftTitle")}</h3>
            {#if claimable > 0}<span class="text-[13px] text-good">{t("taxtags.tx.claimable", { amount: fmt(claimable) })}</span>{/if}
          </div>
          <p class="text-[13px] text-sub">{t("taxtags.tx.leftSub")}</p>
          <ul class="mt-2 divide-y divide-line">
            {#each sg as s (s.kind + s.rule)}
              {@const r = ruleOf(s.rule)}
              <li class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <div class="min-w-0 flex-1 basis-56">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-[14px] text-ink" dir="auto">{ruleName(s.rule)}</span>
                    {#if r}<Badge size="sm" tone={r.incomeTaxPct === null ? "warn" : r.incomeTaxPct >= 100 ? "good" : r.incomeTaxPct > 0 ? "accent" : "bad"}>{r.incomeTaxPct === null ? t("taxtags.byUseShort") : pct(r.incomeTaxPct)}</Badge>{/if}
                    {#if r && shaky(r)}<Badge size="sm" tone="warn">{t("taxtags.verify")}</Badge>{/if}
                    <Badge size="sm">{t(`taxtags.tx.kind.${s.kind}`)}</Badge>
                  </div>
                  <div class="text-[12px] text-sub [overflow-wrap:anywhere]" dir="auto">{sample(s)}</div>
                  <div class="text-[12px] text-sub">
                    {#if s.kind === "uncategorized"}
                      {s.deductible === null ? t("taxtags.tx.needsShare") : t("taxtags.tx.upTo", { amount: fmt(s.deductible) })}{#if s.capped} <span class="text-warn">{t("trips.tx.capped")}</span>{/if}
                    {:else}
                      {s.deductible === null ? t("taxtags.tx.needsShare") : t("taxtags.tx.counts", { deductible: fmt(s.deductible), gross: fmt(s.gross) })}{#if s.capped} <span class="text-warn">{t("trips.tx.capped")}</span>{/if}
                    {/if}
                  </div>
                </div>
                <div class="num text-[14px] whitespace-nowrap text-ink">{fmt(s.gross)}</div>
                <Button size="sm" variant="primary" icon="tag" onclick={() => tagAs(s)}>{t("taxtags.tx.tagN", { n: s.ids.length, rule: bidi(ruleName(s.rule)) })}</Button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if losses.length}
        <section aria-labelledby="ded-lost">
          <h3 id="ded-lost" class="text-[14px] text-ink">{t("taxtags.tx.lostTitle")}</h3>
          <p class="text-[13px] text-sub">{t("taxtags.tx.lostSub")}</p>
          <div class="-mx-4 mt-2 sm:-mx-5">
            <Table {columns} rows={all ? losses : losses.slice(0, 8)} key={(r) => r.id} caption={t("taxtags.tx.lostTitle")} {sort} {onsort} onrowclick={(r) => open(r.id)}>
              {#snippet cell(r, c)}
                {#if c.key === "date"}{mdy(r.date)}
                {:else if c.key === "desc"}<span dir="auto" class="text-ink">{r.desc}</span>
                {:else if c.key === "rule"}<span dir="auto" class="text-ink-2">{r.rule ? ruleName(r.rule) : "—"}</span>
                {:else if c.key === "gross"}{fmt(r.gross)}
                {:else if c.key === "pct"}{pct(r.pct)}
                {:else if c.key === "deductible"}{fmt(r.deductible)}
                {:else}<span class="text-warn">{fmt(lost(r))}</span>{/if}
              {/snippet}
            </Table>
          </div>
          {#if losses.length > 8}<Button class="mt-1" variant="ghost" size="sm" onclick={() => (all = !all)}>{all ? t("taxtags.tx.showFewer") : t("taxtags.tx.showAll", { n: losses.length })}</Button>{/if}
        </section>
      {/if}

      {#if res.byRule.length}
        <section aria-labelledby="ded-by">
          <h3 id="ded-by" class="text-[14px] text-ink">{t("taxtags.tx.byRule")}</h3>
          <BarList items={res.byRule.map((x) => ({ key: x.rule, label: ruleName(x.rule), value: x.deductible }))} currency={cur} />
        </section>
      {/if}

      <section aria-labelledby="ded-trips">
        <div class="flex flex-wrap items-baseline gap-x-3">
          <h3 id="ded-trips" class="text-[14px] text-ink">{t("trips.tx.title")}</h3>
          <a class="text-[13px] text-accent-ink hover:underline" href={url("/trips")}>{res.trips.length ? t("trips.tx.manage") : t("trips.tx.add")}</a>
        </div>
        {#if res.trips.length}
          <p class="text-[13px] text-sub">{t("trips.tx.sub")}</p>
          <ul class="mt-2 divide-y divide-line">
            {#each res.trips as r (r.trip.id)}
              <li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-[13px]">
                <a class="min-w-0 flex-1 basis-44 text-ink [overflow-wrap:anywhere] hover:underline" href={url("/trips")} dir="auto">{r.trip.name}</a>
                {#if r.fxMissing}<Badge size="sm" tone="warn">{t("trips.fxMissingShort")}</Badge>{/if}
                {#if r.mixed}<Badge size="sm">{t("trips.mixed", { b: r.trip.businessDays, d: r.days })}</Badge>{/if}
                <span class="num text-sub">{fmt(r.gross)}</span>
                <span class="num text-ink">{fmt(r.deductible)}</span>
              </li>
            {/each}
          </ul>
        {:else}<p class="text-[13px] text-sub">{t("trips.tx.none")}</p>{/if}
      </section>

      {#if res.caps.length}
        <section aria-labelledby="ded-caps">
          <h3 id="ded-caps" class="text-[14px] text-ink">{t("taxtags.tx.capsTitle")}</h3>
          <ul class="mt-2 space-y-3">
            {#each res.caps as c (c.rule)}
              <li>
                <div class="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <span class="min-w-0 flex-1 text-ink-2" dir="auto">{ruleName(c.rule)}</span>
                  <span class="num text-ink">{t("taxtags.tx.capUsed", { used: fmt(c.used), amount: fmt(c.amount), per: t(`taxtags.per.${c.per}`) })}</span>
                </div>
                <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill" role="meter" aria-label={ruleName(c.rule)} aria-valuemin={0} aria-valuemax={c.amount} aria-valuenow={Math.min(c.used, c.amount)}>
                  <div class="h-full rounded-full {c.used >= c.amount ? 'bg-bad' : c.used >= c.amount * 0.8 ? 'bg-warn' : 'bg-good'}" style:width="{Math.min(100, (c.used / c.amount) * 100)}%"></div>
                </div>
                {#if c.over}<div class="mt-1 text-[12px] text-warn">{t("taxtags.tx.capOver", { n: c.over })}</div>{/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if gaps.length}
        <section aria-labelledby="ded-gaps">
          <h3 id="ded-gaps" class="text-[14px] text-ink">{t("taxtags.tx.gapsTitle")}</h3>
          <p class="text-[13px] text-sub">{t("taxtags.tx.gapsCount", { n: gaps.length, amount: fmt(gapSum) })}</p>
          <ul class="mt-1 divide-y divide-line">
            {#each gaps.slice(0, 6) as r (r.id)}
              <li>
                <button type="button" onclick={() => open(r.id)} class="flex w-full items-center gap-3 rounded-md py-2 text-start text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50">
                  <Icon name="alert" size={14} class="shrink-0 text-warn" />
                  <span class="min-w-0 flex-1 text-ink-2 [overflow-wrap:anywhere]" dir="auto">{r.desc}</span>
                  <span class="text-sub">{mdy(r.date)}</span>
                  <span class="num text-ink">{fmt(r.deductible)}</span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if mv.relevant.length || mv.other.length}
        <section aria-labelledby="ded-moves">
          <h3 id="ded-moves" class="text-[14px] text-ink">{t("taxtags.tx.movesTitle")}</h3>
          <ul class="mt-2 divide-y divide-line">
            {#each mv.relevant as m (m.id)}
              <li class="py-2.5">
                <details>
                  <summary class="cursor-pointer text-[14px] text-ink" dir="auto">{m.title[lang()]}</summary>
                  <div class="mt-2 space-y-1.5 text-[13px] text-ink-2" dir="auto" lang="en">
                    <p>{m.effect}</p>
                    <p class="text-sub">{m.when}</p>
                    <p>{#each m.sources as s (s.url)}<a class="me-3 text-accent-ink hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.title}</a>{/each}</p>
                  </div>
                </details>
              </li>
            {/each}
          </ul>
          {#if mv.other.length}
            <details class="mt-2 text-[13px]">
              <summary class="cursor-pointer text-sub hover:text-ink">{t("taxtags.tx.movesOther", { n: mv.other.length })}</summary>
              <ul class="mt-2 list-disc space-y-1 ps-5 text-ink-2">{#each mv.other as m (m.id)}<li dir="auto">{m.title[lang()]}</li>{/each}</ul>
            </details>
          {/if}
        </section>
      {/if}

      <div class="space-y-1 border-t border-line pt-3 text-[12px] text-faint">
        <p>{t("taxtags.tx.disclaimer")}</p>
        {#if table()?.disclaimer}<p dir="auto" lang="en">{table()!.disclaimer}</p>{/if}
        {#if sources.length}
          <details>
            <summary class="cursor-pointer hover:text-ink">{t("taxtags.tx.sources", { n: sources.length })}</summary>
            <ul class="mt-1 space-y-0.5">{#each sources as s (s.url)}<li><a class="text-accent-ink [overflow-wrap:anywhere] hover:underline" href={s.url} target="_blank" rel="noreferrer" dir="auto">{s.title}</a></li>{/each}</ul>
          </details>
        {/if}
      </div>
    {/if}
  </div>
</Card>
