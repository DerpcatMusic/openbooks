<script lang="ts">
  // Cross-border: for the person's residence country, what each country's pack says about businesses abroad — the residence
  // pack's crossBorder hook (attributed income, foreign tax credit, reliefs that don't apply, forms) and the foreign pack's own
  // forms. No maths here. Items without a cited source (docs/architecture.md open items: §87ה) are marked unverified.
  import type { CrossBorder, Obligation } from "@openbooks/core";
  import { S, mdy } from "#lib/stores/books.svelte.ts";
  import { t, I, bidi, has } from "#lib/i18n.svelte.ts";
  import { businesses, foreignObligations, packById, withFact, fxKey, taxKey, FX_DEFAULT, type Biz, type Person } from "#lib/person.ts";
  import { Badge, Card, Input, Money, Skeleton } from "#lib/ui/index.ts";

  let { person, y, onsave }: { person: Person; y: number; onsave: (p: Person) => void } = $props();

  /** Laws the packs cite without a source yet (docs/architecture.md § Open items). */
  const UNCITED = new Set(["§87ה"]);
  const home = $derived(packById(person.residence));
  const name = (id: string) => {
    const p = packById(id);
    return p ? p.manifest.names[I.lang] : id.toUpperCase();
  };
  const flag = (id: string) => packById(id)?.manifest.flag ?? "";

  let biz = $state<Biz[] | null>(null);
  let failed = $state("");
  // ponytail: other businesses' books are fetched per entity/year change; a shared multi-entity store would avoid it
  const ids = $derived((S.data?.entities ?? []).map((e) => e.id + ":" + JSON.stringify(e.types ?? {})).join());
  $effect(() => {
    void ids;
    const es = $state.snapshot(S.data?.entities ?? []),
      yy = y;
    biz = null;
    failed = "";
    businesses(es, yy).then(
      (b) => (biz = b),
      (x) => (failed = String((x as Error).message || x)),
    );
  });
  const paid = (b: Biz): Biz => ({ ...b, year: { ...b.year, foreignTaxPaid: +(person.facts[taxKey(b.entity.id, y)] ?? 0) || 0 } });
  const own = $derived((biz ?? []).filter((b) => b.year.country === person.residence));
  const abroad = $derived((biz ?? []).filter((b) => b.year.country !== person.residence).map(paid));
  const curs = $derived([...new Set(abroad.map((b) => b.year.currency))]);
  const rate = (c: string) => {
    const v = person.facts[fxKey(c, y)];
    return v === undefined ? FX_DEFAULT[c] : +v;
  };
  const fx = $derived(Object.fromEntries(curs.map((c) => [c, rate(c) ?? NaN])));
  const missingFx = $derived(curs.filter((c) => !Number.isFinite(fx[c])));
  const cb = $derived.by((): CrossBorder | { error: string } | null => {
    if (!home?.crossBorder || !abroad.length || missingFx.length) return null;
    try {
      return home.crossBorder(person, y, own.map((b) => b.year), abroad.map((b) => b.year), fx);
    } catch (x) {
      return { error: String((x as Error).message || x) };
    }
  });
  const set = (k: string, v: string) => onsave(withFact(person, k, v === "" ? undefined : +v));

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const formName = (o: Obligation) => (has(`you.form.${o.country}.${slug(o.form)}`) ? t(`you.form.${o.country}.${slug(o.form)}`) : o.form);
  const why = (o: Obligation, b?: Biz) => {
    const k = `you.ob.${o.country}.${slug(o.form)}`;
    if (!has(k)) return o.why;
    const m = o.form === "150" ? abroad.find((x) => o.why.includes(`(${x.entity.id})`)) : b;
    return t(k, { name: bidi(m?.entity.short || m?.entity.name || ""), state: bidi(String(m?.profile.state || t("you.notSet"))) });
  };
  type Line = { o: Obligation & { extendedDue?: string }; b?: Biz };
  const lines = $derived<Line[]>([
    ...(cb && "obligations" in cb ? cb.obligations.map((o) => ({ o })) : []),
    ...abroad.flatMap((b) => foreignObligations(b, y).map((o) => ({ o, b }))),
  ]);
  const byCountry = $derived(Object.entries(Object.groupBy(lines, (l) => l.o.country)));
</script>

<Card title={t("you.cb.title")} description={home ? t("you.cb.sub", { y, country: name(person.residence) }) : undefined}>
  {#if failed}
    <p class="text-[13px] text-bad">{failed}</p>
  {:else if !biz}
    <p class="mb-3 text-[13px] text-sub">{t("you.cb.loading")}</p>
    <Skeleton class="h-24" />
  {:else if !abroad.length}
    <p class="text-[14px] text-sub">{t("you.cb.none", { country: name(person.residence) })}</p>
  {:else if !home?.crossBorder}
    <p class="text-[14px] text-sub">{t("you.cb.noHook", { country: name(person.residence) })}</p>
  {:else}
    <ul class="divide-y divide-line">
      {#each abroad as b (b.entity.id)}
        <li class="flex flex-wrap items-end gap-x-4 gap-y-3 py-3 first:pt-0">
          <div class="min-w-0 flex-1 basis-56">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span aria-hidden="true">{b.pack.manifest.flag}</span>
              <span class="text-[14px] text-ink" dir="auto">{b.entity.short || b.entity.name}</span>
              <Badge size="sm">{t(`biz.${b.year.type}`)}</Badge>
            </div>
            <div class="mt-0.5 text-[12px] text-sub">{t(`you.cb.treatment.${b.year.treatment}`)}</div>
            <div class="mt-1 text-[13px] text-ink-2">
              {t("you.cb.profit", { y })}: <Money value={b.year.revenue - b.year.expenses} currency={b.year.currency} cents={false} />
            </div>
          </div>
          <Input
            class="w-full sm:w-52"
            numeric
            type="number"
            step="any"
            min="0"
            label={t("you.cb.taxPaid", { name: bidi(b.entity.short || b.entity.name || b.entity.id), country: name(b.year.country) })}
            hint={t("you.cb.taxPaidHint", { cur: b.year.currency })}
            value={String(person.facts[taxKey(b.entity.id, y)] ?? 0)}
            onchange={(e) => set(taxKey(b.entity.id, y), e.currentTarget.value)} />
        </li>
      {/each}
    </ul>
    <div class="mt-2 flex flex-wrap gap-4">
      {#each curs as c (c)}
        <Input
          class="w-full sm:w-52"
          numeric
          type="number"
          step="any"
          min="0"
          label={t("you.cb.fx", { cur: c, y })}
          hint={t("you.cb.fxHint", { cur: c, home: home.manifest.currency })}
          value={Number.isFinite(fx[c]) ? String(fx[c]) : ""}
          onchange={(e) => set(fxKey(c, y), e.currentTarget.value)} />
      {/each}
    </div>

    {#if missingFx.length}
      <p class="mt-4 text-[13px] text-warn">{t("you.cb.fxMissing", { cur: missingFx.join(", ") })}</p>
    {:else if cb && "error" in cb}
      <p class="mt-4 text-[13px] text-bad" dir="ltr">{cb.error}</p>
    {:else if cb}
      <div class="mt-5 grid gap-3 sm:grid-cols-2">
        <div class="rounded-xl bg-fill p-3">
          <div class="text-[13px] text-sub">{t("you.cb.attributed", { country: name(person.residence) })}</div>
          <div class="display mt-0.5 text-[22px] text-ink"><Money value={cb.attributedIncome} currency={home.manifest.currency} cents={false} /></div>
          <p class="mt-1 text-[12px] text-faint">{t("you.cb.attributedHint")}</p>
        </div>
        <div class="rounded-xl bg-fill p-3">
          <div class="text-[13px] text-sub">{t("you.cb.credit")}</div>
          <div class="display mt-0.5 text-[22px] text-ink"><Money value={cb.foreignTaxCredit} currency={home.manifest.currency} cents={false} /></div>
          <p class="mt-1 text-[12px] text-faint">{t("you.cb.creditHint", { country: name(person.residence) })}</p>
        </div>
      </div>
      {#if cb.blocked.length}
        <div class="mt-4">
          <h3 class="text-[13px] text-sub">{t("you.cb.blocked")}</h3>
          <ul class="mt-1 space-y-1">
            {#each cb.blocked as x (x.key)}
              <li class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-ink-2">
                <span>{has(`you.cb.blocked.${x.key}`) ? t(`you.cb.blocked.${x.key}`) : x.key}</span>
                <span class="text-[12px] text-faint" dir="auto">{x.law}</span>
                {#if UNCITED.has(x.law)}<Badge size="sm" tone="warn" icon="alert">{t("you.cb.unverified")}</Badge>{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}

    {#if lines.length}
      <div class="mt-5">
        <h3 class="text-[13px] text-sub">{t("you.cb.file")}</h3>
        {#each byCountry as [c, ls] (c)}
          <div class="mt-2 text-[13px] text-ink">{t("you.cb.fileIn", { flag: flag(c), country: name(c) })}</div>
          <ul class="mt-1 divide-y divide-line">
            {#each ls ?? [] as l, n (n)}
              <li class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span class="shrink-0 text-[14px] whitespace-nowrap text-ink" dir="auto">{formName(l.o)}</span>
                <span class="min-w-0 flex-1 basis-56 text-[13px] text-ink-2" dir="auto">{why(l.o, l.b)}</span>
                {#if l.o.due}
                  <span class="text-[12px] whitespace-nowrap text-sub">
                    {t("you.cb.due", { date: mdy(l.o.due) })}{#if l.o.extendedDue} · {t("you.cb.extended", { date: mdy(l.o.extendedDue) })}{/if}
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        {/each}
      </div>
    {/if}
    {#if cb && "blocked" in cb && cb.blocked.some((x) => UNCITED.has(x.law))}
      <p class="mt-4 flex items-start gap-2 text-[12px] text-faint"><Badge size="sm" tone="warn" icon="alert">{t("you.cb.unverified")}</Badge><span>{t("you.cb.unverifiedNote")}</span></p>
    {/if}
  {/if}
</Card>
