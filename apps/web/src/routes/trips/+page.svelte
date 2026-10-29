<script lang="ts">
  // Trips: business trips with the limits a plain deduction rule can't hold (per night, per day, per trip). A trip is a record (dates, country,
  // nights, business days, companion) plus the costs linked to it by tag or by transaction; the engine (core trips.ts, on the country pack's
  // sourced rules) says what of each cost is deductible and why. Israel: travel-abroad caps in dollars (the rate is yours), 25% more in the listed
  // countries, mixed trips by business days. US: lodging actual, travel meals 50% or the M&IE per diem, the §274(c) allocation of foreign trips.
  // Data: doc "trips". The Taxximizer's Deductions use the same trips.
  import { COUNTRY_CODES, deductions, group, tripMembers, tripProblem, TRIP_ROLES, type Trip, type TripRole } from "@openbooks/core";
  import type { Txn } from "@openbooks/schema";
  import { S, bizType, ent, family, fmt, mdy, saveDoc, tagsDoc, toast } from "#lib/stores/books.svelte.ts";
  import { t, bidi, locale } from "#lib/i18n.svelte.ts";
  import { input, hasRules, trips as tripsDoc } from "#lib/taxtags.svelte.ts";
  import { Badge, Button, Drawer, EmptyState, Input, Money, PageHeader, Select, Switch, Table, type Column } from "#lib/ui/index.ts";
  import { whyText } from "#lib/taxtags/tripWhy.ts";
  import { daysOf, defaultsFor, uid } from "./trips.ts";

  const cur = $derived(ent().currency ?? "ILS");
  const list = $derived(tripsDoc());
  const year = (x: Pick<Trip, "start">) => +x.start.slice(0, 4);
  const il = $derived(family() === "il");

  // ---- results per trip (the engine, with every trip of the year) ----
  const byYear = $derived.by(() => {
    const m = new Map<number, ReturnType<typeof deductions>>();
    if (!hasRules()) return m;
    for (const y of new Set(list.map(year))) {
      const inp = input(y);
      if (inp) m.set(y, deductions(inp));
    }
    return m;
  });
  const resultOf = (x: Trip) => byYear.get(year(x))?.trips.find((r) => r.trip.id === x.id);
  const rowsOf = (x: Trip) => (byYear.get(year(x))?.rows ?? []).filter((r) => r.trip === x.id);

  type Row = { trip: Trip; n: number; gross: number; deductible: number; fxMissing: boolean };
  const rows = $derived(
    [...list]
      .sort((a, b) => b.start.localeCompare(a.start))
      .map((x): Row => {
        const r = resultOf(x),
          rs = rowsOf(x);
        return { trip: x, n: rs.length, gross: rs.reduce((a, y) => a + y.gross, 0), deductible: rs.reduce((a, y) => a + y.deductible, 0) + (r?.unlinked ?? 0), fxMissing: !!r?.fxMissing };
      }),
  );
  const columns = $derived<Column<Row>[]>([
    { key: "name", label: t("common.name"), class: "w-full max-w-0 min-w-36" },
    { key: "dates", label: t("trips.col.dates") },
    { key: "country", label: t("trips.country") },
    { key: "days", label: t("trips.col.days"), numeric: true },
    { key: "n", label: t("trips.col.costs"), numeric: true },
    { key: "gross", label: t("trips.col.spent"), numeric: true },
    { key: "deductible", label: t("trips.col.deductible"), numeric: true },
  ]);

  const names = $derived(new Intl.DisplayNames(locale(), { type: "region" }));
  const countryName = (c: string) => {
    try {
      return names.of(c) ?? c;
    } catch {
      return c;
    }
  };
  const COUNTRIES = $derived([
    { value: "", label: t("trips.pickCountry"), disabled: true },
    ...COUNTRY_CODES.map((c) => ({ value: c, label: countryName(c) })).sort((a, b) => a.label.localeCompare(b.label, locale())),
  ]);

  // ---- editor ----
  let draft = $state<Trip | null>(null),
    open = $state(false),
    isNew = $state(false),
    showAll = $state(false);
  const edit = (x?: Trip) => {
    isNew = !x;
    showAll = false;
    draft = x ? (structuredClone($state.snapshot(x)) as Trip) : { id: uid(), name: "", purpose: "", country: "", ...defaultsFor(new Date().toLocaleDateString("sv"), new Date().toLocaleDateString("sv")) };
    open = true;
  };
  const days = $derived(draft ? daysOf(draft.start, draft.end) : 0);
  const problem = $derived(draft ? tripProblem(draft) : null);
  /** Moving a date keeps nights and business days in step while they still follow the dates (all days business, one night fewer than days). */
  function setDate(k: "start" | "end", v: string) {
    if (!draft) return;
    const was = daysOf(draft.start, draft.end),
      follow = { nights: draft.nights === Math.max(0, was - 1), biz: draft.businessDays === was };
    draft[k] = v;
    const now = daysOf(draft.start, draft.end);
    if (now > 0) {
      if (follow.nights) draft.nights = now - 1;
      if (follow.biz) draft.businessDays = now;
    }
  }
  const num = (v: string) => (v.trim() === "" ? undefined : +v);

  // what is linked: ids listed on the trip, and anything carrying one of its tags
  const txns = $derived((S.data?.txns ?? []) as Txn[]);
  const isCost = (x: Txn) => x.amount < 0 && ["expense", "cogs"].includes(group(x.category));
  const others = $derived(list.filter((x) => x.id !== draft?.id));
  const preview = $derived.by(() => {
    if (!draft || problem || !hasRules()) return null;
    const y = year(draft),
      inp = input(y);
    if (!inp) return null;
    const res = deductions({ ...inp, trips: [$state.snapshot(draft) as Trip, ...others.map((o) => $state.snapshot(o) as Trip)] });
    return { res: res.trips.find((r) => r.trip.id === draft!.id) ?? null, rows: res.rows.filter((r) => r.trip === draft!.id) };
  });
  const members = $derived(draft ? tripMembers([$state.snapshot(draft) as Trip], txns) : new Map());
  const linked = $derived(txns.filter((x) => isCost(x) && members.has(x.id)));
  const taken = $derived(tripMembers(others.map((o) => $state.snapshot(o) as Trip), txns));
  const near = (x: Txn) => {
    if (!draft) return false;
    const lo = new Date(draft.start + "T12:00"),
      hi = new Date(draft.end + "T12:00"),
      d = new Date(x.date + "T12:00");
    lo.setDate(lo.getDate() - 7);
    hi.setDate(hi.getDate() + 7);
    return d >= lo && d <= hi;
  };
  const candidates = $derived(txns.filter((x) => isCost(x) && !members.has(x.id) && !taken.has(x.id) && (showAll || near(x))).slice(0, 60));
  const tagOptions = $derived([
    { value: "", label: t("trips.addTag") },
    ...tagsDoc().tags.filter((g) => !g.inactive && !draft?.tags?.includes(g.id)).map((g) => ({ value: g.id, label: g.name })),
  ]);
  const tagName = (id: string) => tagsDoc().tags.find((g) => g.id === id)?.name ?? id;
  const link = (id: string) => draft && !draft.txns?.includes(id) && (draft.txns = [...(draft.txns ?? []), id]);
  const unlink = (id: string) => draft && (draft.txns = (draft.txns ?? []).filter((x) => x !== id));
  const setRole = (id: string, role: string) => {
    if (!draft) return;
    const roles = { ...draft.roles };
    if (role) roles[id] = role as TripRole;
    else delete roles[id];
    draft.roles = Object.keys(roles).length ? roles : (undefined as unknown as Trip["roles"]);
  };
  const roleOpts = $derived([{ value: "", label: t("trips.role.auto") }, ...TRIP_ROLES.map((r) => ({ value: r, label: t(`trips.role.${r}`) }))]);

  const why = (w: { k: string; v?: number; w?: string }) => whyText({ ...w, k: `trip.${w.k}` }, fmt);

  function clean(x: Trip): Trip {
    const out = { ...x, name: x.name.trim(), purpose: x.purpose.trim() } as Record<string, unknown>;
    for (const k of ["companion", "perDiem"]) if (!out[k]) delete out[k];
    for (const k of ["tags", "txns", "roles", "fx", "singleRoom", "carDays", "mie"]) {
      const v = out[k];
      if (v === undefined || v === null || (Array.isArray(v) && !v.length) || (typeof v === "number" && Number.isNaN(v))) delete out[k];
    }
    if (!out.companion) delete out.singleRoom;
    return out as unknown as Trip;
  }
  async function save() {
    if (!draft || problem) return;
    const next = clean($state.snapshot(draft) as Trip);
    await saveDoc("trips", [...list.filter((x) => x.id !== next.id), next]);
    toast(t("trips.saved", { name: bidi(next.name) }));
    open = false;
  }
  async function remove() {
    if (!draft) return;
    await saveDoc("trips", list.filter((x) => x.id !== draft!.id).length ? list.filter((x) => x.id !== draft!.id) : null);
    toast(t("trips.removed", { name: bidi(draft.name) }));
    open = false;
  }
  const needsFx = $derived(il && cur !== "USD" && !!draft && draft.country !== "IL" && draft.country !== "");
  const usBooks = $derived(family() !== "il");
</script>

<PageHeader title={t("trips.title")} sub={t("trips.sub")}>
  {#snippet actions()}
    <Button variant="primary" icon="plus" onclick={() => edit()} disabled={!bizType()}>{t("trips.new")}</Button>
  {/snippet}
</PageHeader>

<div class="px-4 pt-5 pb-16 sm:px-8">
  {#if !bizType() || !hasRules()}
    <div class="panel"><EmptyState icon="shield" title={t("trips.noRules")} text={t("taxtags.tx.noRules")} /></div>
  {:else if rows.length}
    <p class="mb-3 max-w-3xl text-[13px] text-sub">{t("trips.intro")}</p>
    <div class="panel overflow-hidden">
      <Table {columns} {rows} key={(r: Row) => r.trip.id} caption={t("trips.title")} onrowclick={(r: Row) => edit(r.trip)} stack>
        {#snippet cell(r: Row, c)}
          {#if c.key === "name"}
            <span class="block truncate text-ink" dir="auto">{r.trip.name}</span>
            {#if r.fxMissing}<Badge size="sm" tone="warn">{t("trips.fxMissingShort")}</Badge>{/if}
          {:else if c.key === "dates"}<span class="text-sub">{mdy(r.trip.start)} – {mdy(r.trip.end)}</span>
          {:else if c.key === "country"}<span class="text-ink-2" dir="auto">{countryName(r.trip.country)}</span>
          {:else if c.key === "days"}<span class="num">{daysOf(r.trip.start, r.trip.end)}</span>
          {:else if c.key === "n"}<span class="num">{r.n}</span>
          {:else if c.key === "gross"}<Money value={r.gross} currency={cur} />
          {:else}<Money value={r.deductible} currency={cur} class="text-ink" />{/if}
        {/snippet}
      </Table>
    </div>
  {:else}
    <div class="panel">
      <EmptyState icon="calendar" title={t("trips.empty.title")} text={t("trips.empty.text")}>
        <Button variant="primary" icon="plus" onclick={() => edit()}>{t("trips.new")}</Button>
      </EmptyState>
    </div>
  {/if}
</div>

<Drawer bind:open title={draft?.name || t("trips.new")} width={600}>
  {#if draft}
    <div class="space-y-6 px-4 py-5 sm:px-5">
      <section class="space-y-3">
        <Input label={t("common.name")} bind:value={draft.name} placeholder={t("trips.namePh")} autocomplete="off" />
        <Input label={t("trips.purpose")} bind:value={draft.purpose} placeholder={t("trips.purposePh")} autocomplete="off" />
        <div class="grid grid-cols-2 gap-3">
          <Input label={t("trips.start")} type="date" value={draft.start} onchange={(e) => setDate("start", e.currentTarget.value)} />
          <Input label={t("trips.end")} type="date" value={draft.end} min={draft.start} onchange={(e) => setDate("end", e.currentTarget.value)} />
        </div>
        <Select label={t("trips.country")} bind:value={draft.country} options={COUNTRIES} hint={il && draft.country && draft.country !== "IL" ? t("trips.upliftHint") : undefined} />
        <div class="grid grid-cols-2 gap-3">
          <Input label={t("trips.nights")} type="number" numeric min="0" max={days} value={draft.nights} onchange={(e) => (draft!.nights = Math.trunc(+e.currentTarget.value || 0))} hint={t("trips.daysAway", { n: days })} />
          <Input label={t("trips.businessDays")} type="number" numeric min="0" max={days} value={draft.businessDays} onchange={(e) => (draft!.businessDays = Math.trunc(+e.currentTarget.value || 0))} hint={t("trips.businessHint")} />
        </div>
        <Switch label={t("trips.companion")} description={t("trips.companionHint")} bind:checked={draft.companion} />
        {#if draft.companion}
          <Input label={t("trips.singleRoom")} type="number" numeric step="any" min="0" value={draft.singleRoom ?? ""} onchange={(e) => (draft!.singleRoom = num(e.currentTarget.value))} hint={t("trips.singleRoomHint", { cur: fmt(0).replace(/[\d.,\s]/g, "") })} />
        {/if}
        {#if needsFx}
          <Input label={t("trips.fx")} type="number" numeric step="any" min="0" value={draft.fx ?? ""} onchange={(e) => (draft!.fx = num(e.currentTarget.value))} hint={t("trips.fxHint")} />
        {/if}
        {#if il}
          <Input label={t("trips.carDays")} type="number" numeric min="0" max={days} value={draft.carDays ?? ""} onchange={(e) => (draft!.carDays = num(e.currentTarget.value))} hint={t("trips.carDaysHint")} />
        {:else if usBooks}
          <Switch label={t("trips.perDiem")} description={t("trips.perDiemHint")} bind:checked={draft.perDiem} />
          {#if draft.perDiem}<Input label={t("trips.mie")} type="number" numeric step="any" min="0" value={draft.mie ?? ""} onchange={(e) => (draft!.mie = num(e.currentTarget.value))} hint={t("trips.mieHint")} />{/if}
        {/if}
        {#if problem}<p class="text-[13px] text-warn" role="status">{t(`trips.problem.${problem}`)}</p>{/if}
      </section>

      <section>
        <h3 class="text-[14px] text-ink">{t("trips.linked")}</h3>
        <p class="mt-0.5 text-[13px] text-sub">{t("trips.linkedHint")}</p>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          {#each draft.tags ?? [] as g (g)}
            <Badge>{bidi(tagName(g))}<button type="button" class="ms-1.5 text-faint hover:text-ink" aria-label={t("trips.removeTag", { tag: tagName(g) })} onclick={() => (draft!.tags = (draft!.tags ?? []).filter((x) => x !== g))}>×</button></Badge>
          {/each}
          {#if tagOptions.length > 1}
            <Select variant="pill" icon="tag" label={t("trips.addTag")} value="" options={tagOptions} onchange={(v) => v && (draft!.tags = [...(draft!.tags ?? []), v])} />
          {/if}
        </div>
        {#if linked.length}
          <ul class="mt-3 divide-y divide-line rounded-lg border border-line">
            {#each linked as x (x.id)}
              {@const line = preview?.res?.lines[x.id]}
              <li class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                <button type="button" class="min-w-0 flex-1 basis-44 text-start outline-none focus-visible:ring-2 focus-visible:ring-accent/50" onclick={() => (S.drawer = x.id)}>
                  <span class="block truncate text-[14px] text-ink" dir="auto">{x.desc}</span>
                  <span class="block text-[12px] text-sub">{mdy(x.date)}</span>
                </button>
                <span class="text-end">
                  <Money value={-x.amount} currency={cur} class="text-ink" />
                  {#if line}<span class="block text-[12px] text-sub num">{t("trips.deducts", { amount: fmt(line.deductible, 2) })}</span>{/if}
                </span>
                <Select variant="pill" label={t("trips.role")} value={draft.roles?.[x.id] ?? ""} options={roleOpts} onchange={(v) => setRole(x.id, v)} />
                {#if draft.txns?.includes(x.id)}
                  <Button size="sm" variant="ghost" onclick={() => unlink(x.id)}>{t("trips.unlink")}</Button>
                {:else}<Badge size="sm">{t("trips.viaTag")}</Badge>{/if}
              </li>
            {/each}
          </ul>
        {:else}<p class="mt-3 text-[13px] text-faint">{t("trips.noneLinked")}</p>{/if}

        <details class="mt-3" open={!linked.length}>
          <summary class="cursor-pointer text-[13px] text-accent-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{t("trips.addCosts")}</summary>
          <label class="mt-2 flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" bind:checked={showAll} />{t("trips.showAll")}</label>
          {#if candidates.length}
            <ul class="mt-2 divide-y divide-line rounded-lg border border-line">
              {#each candidates as x (x.id)}
                <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span class="min-w-0 flex-1 basis-44"><span class="block truncate text-[14px] text-ink" dir="auto">{x.desc}</span><span class="block text-[12px] text-sub">{mdy(x.date)}</span></span>
                  <Money value={-x.amount} currency={cur} />
                  <Button size="sm" onclick={() => link(x.id)}>{t("trips.link")}</Button>
                </li>
              {/each}
            </ul>
          {:else}<p class="mt-2 text-[13px] text-faint">{t("trips.noCandidates")}</p>{/if}
        </details>
      </section>

      {#if preview?.res}
        {@const r = preview.res}
        <section>
          <h3 class="text-[14px] text-ink">{t("trips.breakdown")}</h3>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={r.mixed ? "warn" : "good"}>{r.mixed ? t("trips.mixed", { b: draft.businessDays, d: r.days }) : t("trips.allBusiness", { d: r.days })}</Badge>
            {#if r.uplift}<Badge tone="accent">{t("trips.uplift")}</Badge>{/if}
            {#if r.fxMissing}<Badge tone="warn" icon="alert">{t("trips.fxMissing")}</Badge>{/if}
          </div>
          <div class="mt-3 overflow-hidden rounded-lg border border-line">
            {#each r.parts as p, i (i)}
              <div class="border-b border-line px-3 py-2.5 last:border-b-0">
                <div class="flex flex-wrap items-baseline gap-x-3">
                  <span class="min-w-0 flex-1 basis-32 text-[14px] text-ink">{t(`trips.role.${p.role}`)}</span>
                  <span class="num text-[13px] text-sub">{t("trips.spent")} {fmt(p.gross, 2)}</span>
                  {#if p.cap !== null}<span class="num text-[13px] text-sub">{t("trips.limit")} {fmt(p.cap, 2)}</span>{/if}
                  <span class="num text-[14px] text-ink">{fmt(p.deductible, 2)}</span>
                </div>
                <ul class="mt-1 list-disc space-y-0.5 ps-5 text-[12px] text-sub">{#each p.why as w, j (j)}<li>{why(w)}</li>{/each}</ul>
              </div>
            {/each}
          </div>
          <div class="mt-3 flex flex-wrap justify-between gap-x-3 text-[14px]">
            <span class="text-ink-2">{t("trips.total")}</span>
            <span class="num text-ink">{fmt(r.deductible, 2)} <span class="text-sub">/ {fmt(r.gross, 2)}</span></span>
          </div>
          {#if r.unlinked}<p class="mt-1 text-[12px] text-sub">{t("trips.unlinkedNote", { amount: fmt(r.unlinked, 2) })}</p>{/if}
          <p class="mt-3 text-[12px] text-faint">{t(il ? "trips.noteIl" : "trips.noteUs")}</p>
        </section>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    {#if !isNew}<Button variant="ghost" class="me-auto hover:text-bad" icon="trash" onclick={remove}>{t("common.delete")}</Button>{/if}
    <Button variant="primary" disabled={!!problem} onclick={save}>{t("common.save")}</Button>
  {/snippet}
</Drawer>
