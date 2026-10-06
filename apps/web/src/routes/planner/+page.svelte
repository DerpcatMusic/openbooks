<script lang="ts">
  // Tax planner: what this year will cost and what you can still do about it, from the books plus a few answers.
  // Israel compares osek zair (30% deemed) with actual expenses; the US side lists the LLC's obligations and treaty withholding.
  // Port of web/src/views/Planner.svelte. Maths: @openbooks/country-il (ilPlan, …) and @openbooks/country-us (corpTax).
  import { pl } from "@openbooks/core";
  import { form1301, ilPlan, isComplete, mandatoryPension, reservistPoints, type IlRates, type IlTable } from "@openbooks/country-il";
  import { corpTax, type UsTable } from "@openbooks/country-us";
  import { S, bizType, catLabel, doc, ent, fmt, isUS, mdy, saveDoc, taxTable, yearTxns } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Card, Checkbox, Icon, Input, Money, PageHeader, Select, Table, type Column, type IconName } from "#lib/ui/index.ts";
  import { corpInput, isCorp } from "#lib/ustax/books.ts";
  import { ilProfile } from "../tax/il/il.ts";

  type Saved = Record<string, number | boolean | string | undefined>;
  const us = $derived(isUS());
  const y = $derived(S.year);
  const cur = $derived(ent().currency ?? (us ? "USD" : "ILS"));
  const yearOpts = $derived(
    (S.data?.years ?? [])
      .map((v) => ({ value: String(v), label: String(v) }))
      .reverse(),
  );
  // answers persist per year in the "planner" doc
  const all = () => doc<Record<string, Saved>>("planner", {});
  const saved = $derived(all()[y] ?? {});
  const set = (k: string, v: Saved[string]) => saveDoc("planner", { ...all(), [y]: { ...saved, [k]: v } });
  const num = (k: string, d = 0) => (saved[k] as number | undefined) ?? d;

  // ---------- Israel ----------
  const T = $derived(taxTable(y) as unknown as IlTable);
  const hasRates = $derived(isComplete(T));
  const R = $derived(T as IlRates);
  const txns = $derived(yearTxns(y));
  const b = $derived(
    us || !S.data ? null : form1301({ y, txns, type: bizType(y) ?? "", T, form: S.data.form?.[y] ?? {}, profile: ilProfile() }),
  );
  const P = $derived(pl(txns));
  const turnover = $derived(num("turnover", Math.round(b?.turnover ?? 0)));
  const days = $derived(num("reserveDays")),
    degree = $derived(num("degreeYear"));
  const degreePts = $derived(degree && y > degree && y <= degree + 3 ? 1 : 0);
  const resPts = $derived(reservistPoints(days, y));
  const points = $derived((b?.resident ?? 2.25) + (b?.soldier ?? 0) + resPts + degreePts);
  const mandatory = $derived(hasRates ? mandatoryPension(turnover * 0.7, R) : 0);
  const input = $derived({
    turnover,
    expenses: num("expenses", Math.round(P.cogs + P.opex)),
    foreign: num("foreign"),
    points,
    pension: num("pension", Math.round(mandatory)),
    donations: num("donations"),
    selfEmployed: !!saved.selfEmployed,
    withheld: b?.withheld ?? 0,
  });
  const zair = $derived(hasRates ? ilPlan({ ...input, zair: true }, R) : null),
    actual = $derived(hasRates ? ilPlan({ ...input, zair: false }, R) : null);
  const llcBlocks = $derived(!!input.foreign); // §87ה(א)(5): income attributed from a transparent body switches off the 30%
  const best = $derived(!zair || !actual ? null : llcBlocks ? "actual" : zair.total <= actual.total ? "zair" : "actual");
  const plan = $derived(best === "zair" ? zair : actual);
  const saving = $derived(plan ? plan.total - ilPlan({ ...input, pension: input.pension + 1000, zair: best === "zair" }, R).total : 0);
  const overCeiling = $derived(turnover > (T.zairCeiling ?? Infinity));
  type RowKey = "business" | "pensionDed" | "blDed" | "taxable" | "gross" | "pointsCredit" | "pensionCredit" | "donationCredit" | "tax" | "bl" | "health" | "total";
  const ROWS: [RowKey, -1 | 0, "sum"?][] = [
    ["business", 0], ["pensionDed", -1], ["blDed", -1], ["taxable", 0, "sum"],
    ["gross", 0], ["pointsCredit", -1], ["pensionCredit", -1], ["donationCredit", -1], ["tax", 0, "sum"],
    ["bl", 0], ["health", 0], ["total", 0, "sum"],
  ]; // prettier-ignore
  const ptsText = $derived(
    [
      t("planner.pts.resident"),
      b?.soldier && t("planner.pts.soldier", { pts: b.soldier.toFixed(2) }),
      resPts && t("planner.pts.reservist", { pts: resPts }),
      degreePts && t("planner.pts.degree"),
    ]
      .filter(Boolean)
      .join(" · "),
  );
  const annualDue = $derived(
    y === 2025 ? mdy("2026-06-30") : y >= 2026 && !llcBlocks ? mdy(`${y + 1}-03-31`) : t("planner.due.notPublished", { y: y + 1 }),
  );

  // ---------- US ----------
  const UT = $derived(taxTable(y, "us") as unknown as Partial<UsTable>);
  const p = $derived((S.data?.profile ?? {}) as Record<string, string | undefined>);
  const corp = $derived(us && isCorp(y));
  const ctax = $derived(corp ? corpTax(corpInput(y)) : null);
  const treaty = $derived(UT.treatyRoyalty ?? 0.1);
  type Line = { key: string; label: string; value: number };
  const revLines: Line[] = $derived(us ? P.lines.revenue.map((l) => ({ key: l.key, label: catLabel(l.key), value: l.value })) : []);
  const kind = (l: Line) => (saved[`kind:${l.key}`] as string | undefined) ?? (/royalt|distrib|youtube|stream|music/i.test(`${l.key} ${l.label}`) ? "royalty" : "business");
  const wht = $derived(revLines.reduce((a, l) => a + (kind(l) === "royalty" ? l.value : 0), 0));
  const ECI = ["office", "people", "inventory"] as const;
  const eci = $derived(ECI.filter((k) => saved[`eci:${k}`]));
  const stateFee = $derived(
    (
      ({
        DE: () => t("planner.stateFee.DE", { amount: fmt(UT.delawareTax ?? 400) }),
        WY: () => t("planner.stateFee.WY", { amount: fmt(UT.wyomingMin ?? 60) }),
        NM: () => t("planner.stateFee.NM"),
      }) as Record<string, () => string>
    )[(p.state ?? "").toUpperCase().slice(0, 2)]?.() ?? null,
  );
  const fx = $derived(num("usdIls", 3.06));
  type Duty = { title: string; when: string | null; text: string; link?: [string, string] };
  const duties: Duty[] = $derived([
    corp
      ? {
          title: t("planner.cc.1120"),
          when: `${y + 1}-${UT.dueMonthDay ?? "04-15"}`,
          text: t("planner.cc.1120Text", { tax: fmt(ctax!.tax), rate: Math.round((UT.corpRate ?? 0.21) * 100), taxable: fmt(ctax!.taxable), amount: fmt(UT.form5472Penalty ?? 25000) }),
          link: ["/tax/us", t("common.open")],
        }
      : {
          title: t("planner.duty.5472"),
          when: `${y + 1}-${UT.dueMonthDay ?? "04-15"}`,
          text: t("planner.duty.5472Text", { amount: fmt(UT.form5472Penalty ?? 25000) }),
          link: ["/tax/us", t("common.open")],
        },
    { title: t("planner.duty.7004"), when: `${y + 1}-${UT.dueMonthDay ?? "04-15"}`, text: t("planner.duty.7004Text", { date: mdy(`${y + 1}-${UT.extendedMonthDay ?? "10-15"}`) }) },
    stateFee
      ? { title: t("planner.duty.state"), when: null, text: stateFee }
      : { title: t("planner.duty.stateUnset"), when: null, text: t("planner.duty.stateUnsetText"), link: ["/tax/us", t("planner.duty.addState")] },
    {
      title: t("planner.duty.w8"),
      when: null,
      text: t("planner.duty.w8Text", { def: Math.round((UT.defaultWithholding ?? 0.3) * 100), treaty: Math.round(treaty * 100) }),
    },
    { title: t("planner.duty.boi"), when: null, text: t("planner.duty.boiText") },
    { title: t("planner.duty.1099"), when: `${y + 1}-01-31`, text: t("planner.duty.1099Text", { amount: fmt(UT.nec1099 ?? 2000), y }) },
  ]);
  const incomeCols: Column<Line>[] = $derived([
    { key: "label", label: t("common.ledgerAccount") },
    { key: "kind", label: t("planner.treatedAs") },
    { key: "value", label: String(y), numeric: true },
    { key: "max", label: t("planner.maxWithheld"), numeric: true },
  ]);
  const treatOpts = $derived([
    { value: "royalty", label: t("planner.royalty") },
    { value: "business", label: t("planner.businessProfits") },
  ]);
  const ilsNet = $derived(Math.round(P.net * fx));
</script>

<PageHeader title={t("planner.title")} badge={String(y)} sub={t("planner.sub", { flag: ent().flag ?? "", y })}>
  {#snippet actions()}
    <Select variant="pill" icon="calendar" label={t("planner.year")} value={String(y)} options={yearOpts} onchange={(v) => (S.year = +v)} />
  {/snippet}
</PageHeader>

{#snippet field(label: string, k: string, def: number | string, hint = "")}
  <Input
    {label}
    {hint}
    numeric
    type="number"
    step="any"
    value={(saved[k] as number | undefined) ?? def}
    onchange={(e: Event) => {
      const v = (e.currentTarget as HTMLInputElement).value;
      set(k, v === "" ? undefined : +v);
    }} />
{/snippet}

{#snippet tip(icon: IconName, tone: string, text: string)}
  <li class="flex gap-2"><Icon name={icon} size={16} class="mt-0.5 shrink-0 {tone}" /><span class="min-w-0">{text}</span></li>
{/snippet}

<div class="px-4 pb-12 pt-5 sm:px-8">
  {#if !S.data}
    <!-- loading: the layout fetches the books -->
  {:else if !us}
    {#if !hasRates || !zair || !actual || !b || !plan}
      <Card>
        <p class="text-[14px] text-sub">{t("planner.noRates", { y })}</p>
        <Button class="mt-3" size="sm" href="/settings">{t("planner.addInSettings")}</Button>
      </Card>
    {:else}
      <div class="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card title={t("planner.yourYear", { y })}>
          <div class="space-y-4">
            {@render field(t("planner.turnover"), "turnover", Math.round(b.turnover), t("planner.fromBooks", { amount: fmt(b.turnover) }))}
            {@render field(t("planner.expenses"), "expenses", Math.round(P.cogs + P.opex), t("planner.expensesHint"))}
            {@render field(t("planner.foreign"), "foreign", 0, t("planner.foreignHint"))}
            {@render field(t("planner.pension"), "pension", Math.round(mandatory), t("planner.pensionHint", { amount: fmt(mandatory) }))}
            {@render field(t("planner.donations"), "donations", 0, t("planner.donationsHint", { amount: fmt(R.donationMin) }))}
            {@render field(t("planner.reserve", { y: y - 1 }), "reserveDays", 0, y >= 2026 ? t("planner.reserveHint", { pts: resPts }) : t("planner.reserveNone"))}
            {@render field(t("planner.degree"), "degreeYear", "", t("planner.degreeHint"))}
            <Checkbox
              label={t("planner.selfEmployed")}
              description={t("planner.selfEmployedHint", { amount: fmt(R.blMinMonthly) })}
              checked={!!saved.selfEmployed}
              onchange={(v) => set("selfEmployed", v)} />
            <div class="border-t border-line pt-3 text-[13px] text-sub">
              {t("planner.points")} <span class="text-ink num">{points.toFixed(2)}</span> × {fmt(R.point)}
              <span class="block text-[12px] text-faint">{ptsText}</span>
            </div>
          </div>
        </Card>

        <div class="min-w-0 space-y-4">
          <div class="grid gap-4 md:grid-cols-2">
            {#each [{ key: "zair", title: t("planner.zairTitle"), r: zair, sub: t("planner.zairSub") }, { key: "actual", title: t("planner.actualTitle"), r: actual, sub: t("planner.actualSub") }] as o (o.key)}
              <section class="panel relative min-w-0 overflow-hidden p-4 sm:p-5 {best === o.key ? 'glow ring-1 ring-accent/40' : ''}">
                <div class="flex flex-wrap items-start gap-2">
                  <div class="min-w-0 flex-1 basis-40">
                    <h2 class="text-[15px] text-ink">{o.title}</h2>
                    <div class="text-[12px] text-sub">{o.sub}</div>
                  </div>
                  {#if best === o.key}<Badge tone="accent" size="sm">{t("planner.lower")}</Badge>{/if}
                  {#if o.key === "zair" && (llcBlocks || overCeiling)}<Badge tone="bad" size="sm">{t("planner.notAvailable")}</Badge>{/if}
                </div>
                <div class="mt-4 text-[13px] text-sub">{t("planner.taxBl")}</div>
                <div class="display text-[30px] leading-9 text-ink"><Money value={o.r.total} currency={cur} cents={false} /></div>
                <div class="text-[13px] text-sub">{t("planner.effective", { pct: (o.r.effective * 100).toFixed(1), amount: fmt(o.r.total / 12) })}</div>
                <dl class="mt-4 text-[14px]">
                  {#each ROWS as [k, sign, kind] (k)}
                    {#if kind === "sum" || Math.abs(o.r[k]) >= 0.5}
                      <div class="flex gap-3 py-1.5 {kind === 'sum' ? 'border-t border-line text-ink' : 'text-ink-2'}">
                        <dt class="min-w-0 flex-1">{t(`planner.row.${k}`)}</dt>
                        <dd><Money value={sign ? -o.r[k] : o.r[k]} currency={cur} cents={false} /></dd>
                      </div>
                    {/if}
                  {/each}
                </dl>
              </section>
            {/each}
          </div>

          <Card title={t("planner.payLess")}>
            <ul class="space-y-3 text-[14px] text-ink-2">
              {#if zair.tax === 0 && actual.tax === 0}{@render tip("check", "text-good", t("planner.tip.wiped"))}{/if}
              {@render tip("sparkle", "text-accent-ink", t("planner.tip.pension", { amount: fmt(saving) }))}
              {#if y >= 2026}{@render tip("shield", "text-accent-ink", t("planner.tip.reservist", { y: y - 1 }))}{/if}
              {@render tip("file", "text-accent-ink", t("planner.tip.donations", { amount: fmt(R.donationMin) }))}
              {#if llcBlocks}{@render tip("alert", "text-warn", t("planner.tip.llc"))}{/if}
              {#if overCeiling}{@render tip("alert", "text-bad", t("planner.tip.ceiling", { amount: fmt(T.zairCeiling) }))}{/if}
            </ul>
          </Card>

          <Card title={t("planner.due")}>
            <div class="divide-y divide-line text-[14px]">
              {#each [[t("planner.due.pension", { amount: fmt(mandatory) }), mdy(`${y}-12-31`)], [t(y >= 2026 && !llcBlocks ? "planner.due.short" : "planner.due.annual"), annualDue], [t("planner.due.bl"), t("planner.due.blWhen", { amount: fmt((plan.bl + plan.health) / 12) })], [t("planner.due.vat"), mdy(`${y + 1}-01-31`)]] as [what, when] (what)}
                <div class="flex flex-wrap gap-x-3 gap-y-0.5 py-2.5 first:pt-0 last:pb-0">
                  <span class="min-w-0 flex-1 basis-48 text-ink-2">{what}</span><span class="text-sub num">{when}</span>
                </div>
              {/each}
            </div>
          </Card>
          <p class="text-[12px] text-faint">{t("planner.footer", { note: T.note ?? "" })}</p>
        </div>
      </div>
    {/if}
  {:else}
    <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div class="min-w-0 space-y-4">
        <Card title={t("planner.obligations", { y })}>
          <div class="divide-y divide-line">
            {#each duties as d (d.title)}
              <div class="flex flex-wrap items-start gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div class="min-w-0 flex-1 basis-56">
                  <div class="text-[14px] text-ink">{d.title}</div>
                  <div class="text-[13px] text-sub">{d.text}</div>
                </div>
                {#if d.when}<span class="shrink-0 text-[13px] text-ink-2 num">{mdy(d.when)}</span>{/if}
                {#if d.link}<Button size="sm" href={d.link[0]}>{d.link[1]}</Button>{/if}
              </div>
            {/each}
          </div>
        </Card>

        <Card title={t("planner.income")} description={t("planner.incomeText", { pct: Math.round(treaty * 100) })} flush>
          <Table columns={incomeCols} rows={revLines} key={(l) => l.key}>
            {#snippet cell(l, c)}
              {#if c.key === "label"}<span class="text-ink" dir="auto">{l.label}</span>
              {:else if c.key === "kind"}
                <Select variant="pill" label={t("planner.treatAs", { label: l.label })} value={kind(l)} options={treatOpts} onchange={(v) => set(`kind:${l.key}`, v)} />
              {:else if c.key === "value"}<Money value={l.value} currency={cur} />
              {:else if kind(l) === "royalty"}<Money value={l.value * treaty} currency={cur} />
              {:else}<span class="text-faint">—</span>{/if}
            {/snippet}
            {#snippet empty()}<p class="px-4 py-4 text-[14px] text-sub sm:px-5">{t("planner.noRevenue", { y })}</p>{/snippet}
            {#snippet foot()}
              {#if revLines.length}<tr><td colspan="3">{t("planner.treatySum")}</td><td class="text-end"><Money value={wht * treaty} currency={cur} /></td></tr>{/if}
            {/snippet}
          </Table>
        </Card>
      </div>

      <div class="min-w-0 space-y-4">
        <Card title={t("planner.eciTitle")}>
          <div class="space-y-2.5">
            {#each ECI as k (k)}<Checkbox label={t(`planner.eci.${k}`)} checked={!!saved[`eci:${k}`]} onchange={(v) => set(`eci:${k}`, v)} />{/each}
          </div>
          <div class="mt-4 rounded-xl p-3 text-[13px] {eci.length ? 'bg-warn/10 text-warn' : 'bg-good/10 text-good'}">
            {t(eci.length ? "planner.eciYes" : "planner.eciNo")}
          </div>
        </Card>

        <Card title={t("planner.ilReturn")} description={t(corp ? "planner.cc.ilText" : "planner.ilText")}>
          {@render field(t("planner.fx"), "usdIls", 3.06, t("planner.fxHint"))}
          <div class="mt-3 flex flex-wrap justify-between gap-x-3 border-t border-line pt-3 text-[14px]">
            <span class="text-ink-2">{t("planner.netProfit", { y })}</span><Money value={P.net} currency={cur} />
          </div>
          <div class="flex flex-wrap justify-between gap-x-3 py-1 text-[14px]">
            <span class="text-ink-2">{t("planner.inShekels")}</span><Money value={ilsNet} currency="ILS" cents={false} />
          </div>
          <p class="mt-2 text-[12px] text-faint">{t("planner.ilFooter")}</p>
        </Card>
      </div>
    </div>
  {/if}
</div>
