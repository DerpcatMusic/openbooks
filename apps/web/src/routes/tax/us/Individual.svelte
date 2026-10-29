<script lang="ts">
  // A US person's sole proprietorship or single-member LLC: Schedule C from the ledger and the deduction engine, Schedule SE, the QBI deduction,
  // a federal income tax estimate, the four 1040-ES payments (with the next year planned), 1099-NECs for contractors, and the official forms filled.
  // Maths: the US pack (schedc.ts, tax.ts, return.ts); the owner's inputs the ledger cannot know are the books doc "taxus" (lib/ustax/books.ts).
  import { esWorksheet, LINE_TITLE, missingIndividual, pdfFor, STATUSES, type EstimateResult, type SchedCInputs, type Trip, type UsProfile, type VehicleInput } from "@openbooks/country-us";
  import { S, catLabel, ent, fmt, mdy, setProfile, taxTable, toast } from "#lib/stores/books.svelte.ts";
  import { bidi, t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Card, Icon, IconButton, Input, Money, Segmented, Select, Stat, Switch, Table, type Column } from "#lib/ui/index.ts";
  import { numOf, saveUsInputs, textOf, usInputs, usNow } from "#lib/ustax/books.ts";
  import Contractors from "./Contractors.svelte";
  import Deadlines from "./Deadlines.svelte";

  let { y }: { y: number } = $props();
  const today = new Date().toLocaleDateString("sv");
  const p = $derived((S.data?.profile ?? {}) as Record<string, string | boolean | undefined>);
  const prof = $derived(p as UsProfile);
  const cur = $derived(ent().currency ?? "USD");
  const ret = $derived(usNow(y));
  const sc = $derived(ret.schedC!);
  const pt = $derived(ret.personal!);
  const inp = $derived(usInputs(y));
  const cInp = $derived<SchedCInputs>(inp.schedC ?? {});
  const veh = $derived<VehicleInput>(cInp.vehicle ?? { method: "standard" });
  const missing = $derived(missingIndividual(prof).map((k) => t(`fus.f.${k}`)));
  const set = (patch: Parameters<typeof saveUsInputs>[1]) => saveUsInputs(y, patch);
  const setC = (patch: SchedCInputs) => saveUsInputs(y, { schedC: patch });
  const setV = (patch: Partial<VehicleInput>) => setC({ vehicle: { ...veh, ...patch } });

  // ---------- the numbers ----------
  const order = (l: string) => parseFloat(l) + (l.replace(/\d+/, "").charCodeAt(0) || 0) / 1000;
  const SRC: Record<string, string> = { mileage: "fus.src.mileage", "parking and tolls": "fus.src.parking", "home office": "fus.src.home" };
  const srcName = (a: string) => (SRC[a] ? t(SRC[a]) : a.includes(":") ? catLabel(a) : a);
  type LineRow = { line: string; title: string; amount: number; from: string };
  const lineRows = $derived<LineRow[]>(
    Object.entries(sc.lines)
      .sort(([a], [b]) => order(a) - order(b))
      .map(([line, amount]) => ({
        line,
        title: LINE_TITLE[line] ?? line,
        amount,
        from: sc.sources
          .filter((s) => s.line === line)
          .slice(0, 3)
          .map((s) => srcName(s.account))
          .join(", "),
      })),
  );
  const lcols: Column<LineRow>[] = $derived([
    { key: "line", label: t("fus.sc.line"), class: "w-16" },
    { key: "title", label: t("fus.sc.title"), wrap: true },
    { key: "amount", label: t("common.amount"), numeric: true, class: "w-32" },
  ]);
  const paid = $derived(inp.paidEstimates ?? ret.paid.total);
  const stateTax = $derived(pt.state.tax);
  const nextTableYear = $derived((taxTable(y + 1, "us") as { year?: number }).year);
  const hasQbi = $derived(pt.qbi.deduction > 0 && !pt.qbi.above);

  // ---------- filled forms ----------
  const avail = $derived({ c: !!pdfFor("schedule-c", y) && !!pdfFor("schedule-se", y) && !!pdfFor("8995", y) });
  const esYears = $derived(
    ([[y, ret.estimates], [y + 1, ret.nextEstimates]] as [number, EstimateResult | null][]).filter(([yr, e]) => e && pdfFor("1040-es", yr)),
  );
  let filling = $state("");
  const slug = (s: string) => s.replace(/\W+/g, "-");
  async function make(kind: "c" | "se" | "q" | "packet" | "es", esYear = y) {
    filling = kind + esYear;
    try {
      const irs = await import("./pdf.ts");
      const nm = slug(String(p.taxpayerName || p.legalName || "taxpayer"));
      const ctx = { ...prof, year: y, result: sc, needs1099: ret.needs1099, homeTotalSqft: cInp.homeTotalSqft };
      if (kind === "c") irs.download(await irs.fillScheduleC(ctx), `${nm}-${y}-schedule-c.pdf`);
      else if (kind === "se") irs.download(await irs.fillScheduleSE({ ...prof, se: pt.se }), `${nm}-${y}-schedule-se.pdf`);
      else if (kind === "q") irs.download(await irs.fill8995({ ...prof, qbi: pt.qbi }), `${nm}-${y}-form-8995.pdf`);
      else if (kind === "packet") irs.download(await irs.individualPacket(ctx, pt.se, pt.qbi, hasQbi), `${nm}-${y}-schedule-c-se${hasQbi ? "-8995" : ""}.pdf`);
      else {
        const e = (esYear === y ? ret.estimates : ret.nextEstimates)!;
        irs.download(await irs.fill1040ES({ ...prof, installments: e.installments, worksheet: esWorksheet(pt, e, inp.credits) }), `${nm}-${esYear}-1040-ES.pdf`);
      }
    } catch (e) {
      toast(t("taxUS.fillError", { msg: bidi((e as Error).message) }));
    } finally {
      filling = "";
    }
  }

  // ---------- inputs ----------
  const FIELDS: [string, string, "auto" | "ltr"][] = [
    ["taxpayerName", "text", "auto"],
    ["ssn", "text", "ltr"],
    ["legalName", "text", "auto"],
    ["ein", "text", "ltr"],
    ["address", "text", "ltr"],
    ["cityStateZip", "text", "ltr"],
    ["business", "text", "auto"],
    ["naics", "text", "ltr"],
    ["phone", "text", "ltr"],
    ["state", "text", "auto"],
  ];
  const REQUIRED = new Set(["taxpayerName", "ssn", "address", "cityStateZip", "business", "naics"]);
  const NUMS = ["otherIncome", "w2SsWages", "withholding", "seHealthInsurance", "retirement", "itemized", "credits", "priorTax", "priorAgi"] as const;
  const statusOpts = $derived(STATUSES.map((s) => ({ value: s, label: t(`fus.status.${s}`) })));

  let trip = $state({ date: "", miles: "", purpose: "" });
  function addTrip() {
    const miles = Number(trip.miles);
    if (!trip.date || !(miles > 0)) return toast(t("fus.veh.needTrip"));
    setV({ trips: [...(veh.trips ?? []), { id: crypto.randomUUID().slice(0, 8), date: trip.date, miles, purpose: trip.purpose.trim() }] });
    trip = { date: trip.date, miles: "", purpose: "" };
  }
  const trips = $derived([...(veh.trips ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)));
  const tcols: Column<Trip>[] = $derived([
    { key: "date", label: t("common.date"), class: "w-28" },
    { key: "miles", label: t("fus.veh.miles"), numeric: true, class: "w-24" },
    { key: "purpose", label: t("fus.veh.purpose"), wrap: true },
    { key: "x", label: t("common.remove"), hideLabel: true, class: "w-10" },
  ]);
  const ecols: Column<{ n: number; due: string; amount: number }>[] = $derived([
    { key: "n", label: t("fus.est.payment") },
    { key: "due", label: t("fus.est.due") },
    { key: "amount", label: t("common.amount"), numeric: true },
  ]);
</script>

{#snippet estimates(yr: number, e: EstimateResult, next: boolean)}
  <Card title={t(next ? "fus.est.nextTitle" : "fus.est.title", { y: yr })} description={e.exempt ? t("fus.est.exempt") : t(e.basis === "current" && e.priorSafeHarbor === null ? "fus.est.basis.currentNoPrior" : `fus.est.basis.${e.basis}`, { required: fmt(e.required), current: fmt(e.currentSafeHarbor), prior: e.priorSafeHarbor === null ? "" : fmt(e.priorSafeHarbor) })} flush>
    <Table columns={ecols} rows={e.installments} key={(r) => r.n} caption={t("fus.est.title", { y: yr })} stack>
      {#snippet cell(r, c)}
        {#if c.key === "n"}<span class="text-sub">{t("fus.est.n", { n: r.n })}</span>{#if r.due < today}<Badge size="sm" class="ms-2">{t("fus.est.past")}</Badge>{/if}
        {:else if c.key === "due"}<span class="text-ink num">{mdy(r.due)}</span>
        {:else}<Money value={r.amount} currency={cur} />{/if}
      {/snippet}
    </Table>
    <ul class="space-y-1 border-t border-line px-4 py-3 text-[13px] text-sub sm:px-5">
      {#if e.highIncome}<li>{t("fus.est.high")}</li>{/if}
      {#if !e.exempt}<li>{t("fus.est.skip", { date: mdy(e.skipLast) })}</li>{/if}
      {#if next}<li>{t("fus.est.nextNote", { y: yr })}</li>{#if nextTableYear && nextTableYear < yr}<li>{t("fus.est.borrowed", { y: yr, from: nextTableYear })}</li>{/if}{/if}
      {#if !next}<li>{ret.paid.count ? t("fus.est.paidFound", { n: ret.paid.count, amount: fmt(ret.paid.total) }) : t("fus.est.paidNone")}{inp.paidEstimates !== undefined ? ` ${t("fus.est.paidSet", { amount: fmt(paid) })}` : ""}</li>{/if}
    </ul>
  </Card>
{/snippet}

<div>
  <div class="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/25 bg-accent/6 px-4 py-4 sm:px-5">
    <span class="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent-ink"><Icon name="form" size={18} /></span>
    <div class="min-w-0 flex-1 basis-56">
      <div class="text-[14px] text-ink">{t("fus.ind.autoTitle", { y })}</div>
      <div class="text-[13px] text-sub">{avail.c ? (missing.length ? t("fus.ind.autoMissing", { n: missing.length }) : t("fus.ind.autoText")) : t("fus.pdf.noYear", { y })}</div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" onclick={() => make("c")} disabled={!avail.c || !!filling}>Schedule C</Button>
      <Button size="sm" onclick={() => make("se")} disabled={!avail.c || !!filling}>SE</Button>
      <Button size="sm" onclick={() => make("q")} disabled={!avail.c || !!filling || !hasQbi}>8995</Button>
      {#each esYears as [yr] (yr)}
        <Button size="sm" onclick={() => make("es", yr)} disabled={!!filling}><bdi>1040-ES {yr}</bdi></Button>
      {/each}
      <Button size="sm" variant="primary" icon="download" loading={filling.startsWith("packet")} onclick={() => make("packet")} disabled={!avail.c || !!filling}>{filling.startsWith("packet") ? t("taxUS.filling") : t("fus.ind.packet")}</Button>
    </div>
  </div>

  <div class="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
    <div class="min-w-0 space-y-4">
      {#if sc.warnings.length || pt.qbi.above || missing.length}
        <ul class="space-y-1 rounded-2xl border border-warn/30 bg-warn/6 px-4 py-3 text-[13px] text-ink sm:px-5">
          {#if missing.length}<li>{t("taxUS.missing", { list: missing.join(", ") })}</li>{/if}
          {#each sc.warnings as w (w.k)}<li>{t(`fus.warn.${w.k}`, { v: w.k === "uncategorized" || w.k === "homeOver300" ? (w.v ?? 0) : fmt(w.v ?? 0) })}</li>{/each}
          {#if pt.qbi.above}<li>{t("fus.warn.qbiAbove")}</li>{/if}
        </ul>
      {/if}

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><Stat size="md" label={t("fus.stat.profit")} value={sc.netProfit} currency={cur} hint={t("fus.stat.profitHint")} /></Card>
        <Card><Stat size="md" label={t("fus.stat.se")} value={pt.se.line12} currency={cur} hint={t("fus.stat.seHint")} /></Card>
        <Card><Stat size="md" label={t("fus.stat.tax")} value={pt.incomeTax} currency={cur} hint={t("fus.stat.taxHint", { rate: Math.round(pt.marginal * 100) })} /></Card>
        <Card><Stat size="md" label={t("fus.stat.total")} value={pt.totalTax + stateTax} currency={cur} hint={t("fus.stat.totalHint", { state: fmt(stateTax) })} /></Card>
      </div>

      <Card title={t("fus.sc.card", { y })} description={t("fus.sc.sub")} flush>
        <Table columns={lcols} rows={lineRows} key={(r) => r.line} caption={t("fus.sc.card", { y })} stack>
          {#snippet cell(r, c)}
            {#if c.key === "line"}<span class="text-sub num">{r.line}</span>
            {:else if c.key === "title"}<span class="text-ink" dir="auto">{r.title}</span>{#if r.from}<span class="block text-[12px] text-sub" dir="auto">{r.from}</span>{/if}
            {:else}<Money value={r.amount} currency={cur} class={["28", "31"].includes(r.line) ? "text-ink" : ""} />{/if}
          {/snippet}
          {#snippet empty()}<p class="px-4 py-4 text-[14px] text-sub sm:px-5">{t("fus.sc.empty", { y })}</p>{/snippet}
        </Table>
        {#if sc.disallowed}<p class="border-t border-line px-4 py-3 text-[13px] text-sub sm:px-5">{t("fus.sc.disallowed", { amount: fmt(sc.disallowed) })}</p>{/if}
      </Card>

      <Card title={t("fus.tax.title", { y })} description={t("fus.tax.sub")} flush>
        <ul class="divide-y divide-line">
          {#each [["se", pt.se.line12], ["half", -pt.se.line13], ["agi", pt.agi], ["deduction", pt.deduction], ["qbi", -pt.qbi.deduction], ["taxable", pt.taxable], ["income", pt.incomeTax], ["addl", pt.se.additionalMedicare], ["total", pt.totalTax], ["withheld", -pt.withholding], ["due", pt.afterWithholding], ["state", stateTax]] as const as [k, v] (k)}
            <li class="flex items-baseline gap-3 px-4 py-2.5 sm:px-5">
              <span class="min-w-0 flex-1 text-[14px] {k === 'total' || k === 'due' ? 'text-ink' : 'text-sub'}">{t(`fus.tax.${k}`, { used: pt.usedItemized ? t("fus.tax.itemized") : t("fus.tax.standard") })}</span>
              <Money value={v} currency={cur} class={k === "total" || k === "due" ? "text-ink" : ""} />
            </li>
          {/each}
        </ul>
        {#if pt.qbi.minimumApplied}<p class="border-t border-line px-4 py-3 text-[13px] text-sub sm:px-5">{t("fus.tax.qbiMin")}</p>{/if}
        <p class="border-t border-line px-4 py-3 text-[13px] text-sub sm:px-5">{t("fus.tax.note")}</p>
      </Card>

      {@render estimates(y, ret.estimates!, false)}
      {@render estimates(y + 1, ret.nextEstimates!, true)}

      <Contractors {y} />
      <Deadlines {y} />
    </div>

    <div class="min-w-0 space-y-4 xl:sticky xl:top-4">
      <Card title={t("fus.you.title")} description={t("fus.you.saved")}>
        <div class="profile space-y-3">
          {#each FIELDS as [k, type, dir] (k)}
            <Input label={t(`fus.f.${k}`)} {type} {dir} value={String(p[k] ?? "")} required={REQUIRED.has(k) && !p[k]} onchange={(e: Event) => setProfile({ [k]: textOf(e) })} />
          {/each}
          <Switch label={t("fus.you.fbar")} description={t("fus.you.fbarSub")} checked={p.foreignAccounts === true} onchange={(v) => setProfile({ foreignAccounts: v })} />
        </div>
      </Card>

      <Card title={t("fus.in.title", { y })} description={t("fus.in.sub")}>
        <div class="space-y-3">
          <Select label={t("fus.in.status")} value={inp.status ?? "single"} options={statusOpts} onchange={(v) => set({ status: v as never })} />
          {#each NUMS as k (k)}
            <Input label={t(`fus.in.${k}`)} numeric value={inp[k] ?? ""} onchange={(e: Event) => set({ [k]: numOf(e) })} />
          {/each}
          <Input label={t("fus.in.paidEstimates")} hint={t("fus.in.paidHint", { n: ret.paid.count, amount: fmt(ret.paid.total) })} numeric value={inp.paidEstimates ?? ""} onchange={(e: Event) => set({ paidEstimates: numOf(e) })} />
          <Input label={t("fus.in.stateRate")} hint={t("fus.in.stateHint")} numeric value={inp.stateRate ?? ""} onchange={(e: Event) => set({ stateRate: numOf(e) })} />
        </div>
      </Card>

      <Card title={t("fus.biz.title")} description={t("fus.biz.sub")}>
        <div class="space-y-3">
          <Input label={t("fus.biz.returns")} numeric value={cInp.returns ?? ""} onchange={(e: Event) => setC({ returns: numOf(e) })} />
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <Input label={t("fus.biz.homeSqft")} hint={t("fus.biz.homeHint")} numeric value={cInp.homeSqft ?? ""} onchange={(e: Event) => setC({ homeSqft: numOf(e) })} />
            <Input label={t("fus.biz.homeTotal")} numeric value={cInp.homeTotalSqft ?? ""} onchange={(e: Event) => setC({ homeTotalSqft: numOf(e) })} />
          </div>
          <Switch label={t("fus.biz.inventory")} description={t("fus.biz.inventorySub")} checked={!!cInp.inventory?.on} onchange={(v) => setC({ inventory: { ...cInp.inventory, on: v } })} />
          {#if cInp.inventory?.on}
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <Input label={t("fus.biz.invBegin")} numeric value={cInp.inventory.begin ?? ""} onchange={(e: Event) => setC({ inventory: { ...cInp.inventory!, on: true, begin: numOf(e) } })} />
              <Input label={t("fus.biz.invEnd")} numeric value={cInp.inventory.end ?? ""} onchange={(e: Event) => setC({ inventory: { ...cInp.inventory!, on: true, end: numOf(e) } })} />
            </div>
          {/if}
        </div>
      </Card>

      <Card title={t("fus.veh.title")} description={t("fus.veh.sub")}>
        <div class="space-y-3">
          <Segmented
            label={t("fus.veh.method")}
            value={veh.method}
            items={[
              { key: "standard", label: t("fus.veh.standard") },
              { key: "actual", label: t("fus.veh.actual") },
            ]}
            onchange={(k) => setV({ method: k as "standard" | "actual" })} />
          {#if veh.method === "standard"}
            <div class="grid gap-3 sm:grid-cols-[1fr_1fr] xl:grid-cols-1 2xl:grid-cols-[1fr_1fr]">
              <Input label={t("common.date")} type="date" dir="ltr" bind:value={trip.date} />
              <Input label={t("fus.veh.miles")} numeric bind:value={trip.miles} />
            </div>
            <Input label={t("fus.veh.purpose")} bind:value={trip.purpose} />
            <Button size="sm" icon="plus" onclick={addTrip}>{t("fus.veh.add")}</Button>
            {#if trips.length}
              <Table columns={tcols} rows={trips} key={(r) => r.id ?? r.date + r.miles} caption={t("fus.veh.title")} stack>
                {#snippet cell(r, c)}
                  {#if c.key === "date"}<span class="text-sub num">{mdy(r.date)}</span>
                  {:else if c.key === "miles"}<span class="num">{r.miles}</span>
                  {:else if c.key === "purpose"}<span class="text-ink" dir="auto">{r.purpose}</span>
                  {:else}<IconButton icon="x" label={t("common.remove")} onclick={() => setV({ trips: (veh.trips ?? []).filter((x) => x !== r && x.id !== r.id) })} />{/if}
                {/snippet}
              </Table>
            {/if}
            {#if sc.vehicle}
              <p class="text-[13px] text-sub">
                {t("fus.veh.result", { miles: fmt(sc.vehicle.businessMiles), amount: fmt(sc.vehicle.deduction) })}
                {#each sc.vehicle.bands as b (b.cents)}<span class="block">{t("fus.veh.band", { miles: fmt(b.miles), cents: b.cents, amount: fmt(b.amount) })}</span>{/each}
              </p>
            {/if}
            <Input label={t("fus.veh.parking")} numeric value={veh.parkingTolls ?? ""} onchange={(e: Event) => setV({ parkingTolls: numOf(e) })} />
          {:else}
            <p class="text-[13px] text-sub">{t("fus.veh.actualNote")}</p>
          {/if}
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <Input label={t("fus.veh.totalMiles")} numeric value={veh.totalMiles ?? ""} onchange={(e: Event) => setV({ totalMiles: numOf(e) })} />
            <Input label={t("fus.veh.commuting")} numeric value={veh.commutingMiles ?? ""} onchange={(e: Event) => setV({ commutingMiles: numOf(e) })} />
          </div>
          <Input label={t("fus.veh.placed")} type="date" dir="ltr" value={veh.placedInService ?? ""} onchange={(e: Event) => setV({ placedInService: textOf(e) || undefined })} />
        </div>
      </Card>
      <p class="text-[12px] leading-relaxed text-faint">{t("fus.disclaimer")}</p>
    </div>
  </div>
</div>

<style>
  /* privacy mode: the taxpayer's identifiers are personal data */
  :global(html[data-private]) .profile :global(input) {
    filter: blur(6px);
  }
  :global(html[data-private]) .profile :global(input:focus) {
    filter: none;
  }
</style>
