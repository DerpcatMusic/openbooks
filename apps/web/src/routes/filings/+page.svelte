<script lang="ts">
  // Filings hub: what is due and when for this business's country and type (CountryPack.deadlines), what is done (marked by you, with the
  // date and the confirmation number), links to each generator, and an .ics file for your calendar. Israeli settings (VAT number and
  // frequency, advance rates) are at the bottom. Data: doc "filings". Logic: @openbooks/core filings.ts, lib/filings.svelte.ts.
  import { icsCalendar, type FilingRow } from "@openbooks/core";
  import { S, mdy, setProfile, toast } from "#lib/stores/books.svelte.ts";
  import { lang, t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Card, Dialog, EmptyState, Input, PageHeader, Select, Stat, Switch } from "#lib/ui/index.ts";
  import type { Tone } from "#lib/ui/index.ts";
  import { calendar, download, hasCalendar, il, isIL, markFiled, patchIl, unmarkFiled, vatBooks } from "#lib/filings.svelte.ts";
  import { bizType } from "#lib/stores/books.svelte.ts";
  import { entityForm, foreignOwned, numOf, stateName, stateRate, textOf, track } from "#lib/ustax/books.ts";

  const todayIso = () => new Date().toLocaleDateString("sv");
  const now = new Date();
  let year = $state(now.getFullYear());
  let all = $state(false);
  const rows = $derived(calendar(year, todayIso()));
  const shown = $derived(all ? rows : rows.filter((r) => r.status !== "done" || r.days > -45).filter((r) => r.days >= -45 || r.status === "overdue"));
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const years = $derived([now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => ({ value: String(y), label: String(y) })));
  const TONE: Record<string, Tone> = { done: "good", overdue: "bad", soon: "warn", upcoming: "neutral" };

  /** Where the generator for a deadline lives. */
  function linkOf(r: FilingRow): { href: string; label: string } | null {
    const m = /^il\.vat\.(\d{4}-\d{2})$/.exec(r.id);
    if (m) return { href: `/filings/vat?period=${m[1]}`, label: t("filings.open.vat") };
    if (r.id.startsWith("il.adv.")) return { href: "/filings/advances", label: t("filings.open.advances") };
    if (r.id.startsWith("il.1301.")) return { href: "/tax/il", label: t("filings.open.1301") };
    if (r.id.startsWith("us.")) return { href: "/tax/us", label: t("filings.open.us") };
    return null;
  }

  // ---- mark filed ----
  let dlg = $state(false),
    target = $state<FilingRow | null>(null),
    on = $state(""),
    conf = $state("");
  function ask(r: FilingRow) {
    target = r;
    on = todayIso();
    conf = r.done?.confirmation ?? "";
    dlg = true;
  }
  async function save() {
    if (!target || !on) return;
    await markFiled(target.id, { on, ...(conf.trim() ? { confirmation: conf.trim() } : {}) });
    dlg = false;
    toast(t("filings.marked"));
  }

  function ics() {
    const text = icsCalendar(rows, { name: `OpenBooks ${year}`, lang: lang(), stamp: new Date().toISOString().replace(/[-:]|\.\d+/g, ""), skipDone: true });
    download(`filings-${year}.ics`, text, "text/calendar;charset=utf-8");
  }

  const s = $derived(il());
  const hasType = $derived(!!bizType());
  // US settings: the saved profile the deadlines read (the same facts the forms are filled from)
  const up = $derived((S.data?.profile ?? {}) as Record<string, string | number | boolean | undefined>);
  const tr = $derived(track(year));
  const corp = $derived(tr === "c-corp" || tr === "s-corp");
</script>

<PageHeader title={t("filings.title")} sub={t("filings.sub")}>
  {#snippet actions()}
    <Select variant="pill" icon="calendar" label={t("filings.year")} value={String(year)} options={years} onchange={(v) => (year = +v)} />
    <Button icon="download" onclick={ics} disabled={!rows.length}>{t("filings.ics")}</Button>
  {/snippet}
</PageHeader>

<div class="space-y-6 px-4 py-4 sm:px-8">
  {#if !S.data || !hasType}
    <EmptyState icon="calendar" title={t("filings.noType")} text={t("filings.noTypeText")}>
      <Button href="/setup" variant="primary">{t("filings.setType")}</Button>
    </EmptyState>
  {:else if !hasCalendar()}
    <EmptyState icon="calendar" title={t("filings.noCal")} text={t("filings.noCalText")} />
  {:else}
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat size="md" raw label={t("filings.status.overdue")} value={count("overdue")} />
      <Stat size="md" raw label={t("filings.status.soon")} value={count("soon")} />
      <Stat size="md" raw label={t("filings.status.upcoming")} value={count("upcoming")} />
      <Stat size="md" raw label={t("filings.status.done")} value={count("done")} />
    </div>

    <Card flush title={t("filings.deadlines", { y: year })}>
      {#snippet actions()}
        <Switch label={t("filings.showAll")} checked={all} onchange={(v) => (all = v)} />
      {/snippet}
      {#if !shown.length}
        <p class="px-4 py-6 text-[14px] text-sub sm:px-5">{t("filings.none")}</p>
      {:else}
        <ul class="divide-y divide-line">
          {#each shown as r (r.id)}
            {@const link = linkOf(r)}
            <li class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
              <div class="w-24 shrink-0 num text-[13px] text-ink-2">{mdy(r.date)}</div>
              <div class="min-w-0 flex-1 basis-60">
                <div class="text-[14px] text-ink" dir="auto">{r.title[lang()]}</div>
                <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-sub">
                  {#if r.form}<Badge size="sm">{r.form}</Badge>{/if}
                  {#if r.unverified}<Badge size="sm" tone="warn">{t("filings.unverified")}</Badge>{/if}
                  {#if r.done}<span>{t("filings.filedOn", { d: mdy(r.done.on) })}{r.done.confirmation ? ` · ${t("filings.confirmation")} ${r.done.confirmation}` : ""}</span>
                  {:else if r.status === "overdue"}<span>{t("filings.daysLate", { n: -r.days })}</span>
                  {:else if r.days === 0}<span>{t("filings.dueToday")}</span>
                  {:else}<span>{t("filings.inDays", { n: r.days })}</span>{/if}
                </div>
              </div>
              <Badge tone={TONE[r.status]}>{t(`filings.status.${r.status}`)}</Badge>
              <div class="flex flex-wrap items-center gap-2">
                {#if link}<Button size="sm" href={link.href}>{link.label}</Button>{/if}
                {#if r.done}
                  <Button size="sm" variant="ghost" onclick={() => unmarkFiled(r.id)}>{t("filings.undo")}</Button>
                {:else}
                  <Button size="sm" icon="check" onclick={() => ask(r)}>{t("filings.markFiled")}</Button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>
    <p class="text-[12px] text-faint">{t("filings.disclaimer")}</p>

    {#if isIL()}
      <div class="grid gap-4 lg:grid-cols-2">
        <Card title={t("filings.tools")}>
          <div class="flex flex-wrap gap-2">
            {#if vatBooks()}<Button href="/filings/vat" icon="file">{t("filings.open.vat")}</Button>{/if}
            <Button href="/filings/advances" icon="wallet">{t("filings.open.advances")}</Button>
            <Button href="/filings/uniform" icon="download">{t("filings.open.uniform")}</Button>
            <Button href="/tax/il" icon="form">{t("filings.open.1301")}</Button>
          </div>
        </Card>
        <Card title={t("filings.settings")} description={t("filings.settingsHint")}>
          <div class="space-y-3">
            <Input label={t("filings.vatId")} value={s.vatId} dir="ltr" inputmode="numeric" placeholder="514290543" onchange={(e) => patchIl({ vatId: e.currentTarget.value.replace(/\D/g, "") })} />
            {#if vatBooks()}
              <Select label={t("filings.vatFrequency")} value={s.vatFrequency} options={[{ value: "monthly", label: t("filings.monthly") }, { value: "bimonthly", label: t("filings.bimonthly") }]} onchange={(v) => patchIl({ vatFrequency: v as "monthly" | "bimonthly" })} />
            {/if}
            <Select label={t("filings.taxAdvanceFrequency")} value={s.taxAdvanceFrequency} options={[{ value: "monthly", label: t("filings.monthly") }, { value: "bimonthly", label: t("filings.bimonthly") }, { value: "none", label: t("filings.noAdvances") }]} onchange={(v) => patchIl({ taxAdvanceFrequency: v as "monthly" | "bimonthly" | "none" })} />
            <Switch label={t("filings.blAdvances")} description={t("filings.blAdvancesHint")} checked={s.blAdvances} onchange={(v) => patchIl({ blAdvances: v })} />
          </div>
        </Card>
      </div>
    {:else}
      <div class="grid gap-4 lg:grid-cols-2">
        <Card title={t("filings.tools")}>
          <div class="flex flex-wrap gap-2">
            <Button href="/tax/us" icon="form">{t("filings.open.us")}</Button>
          </div>
        </Card>
        <Card title={t("filings.us.settings")} description={t("filings.us.settingsHint")}>
          <div class="space-y-3">
            <Input label={t("filings.us.state")} hint={t("filings.us.stateHint")} value={String(up.state ?? "")} onchange={(e: Event) => setProfile({ state: textOf(e) })} />
            <Input label={t("taxUS.f.formed")} hint={t("filings.us.formedHint")} type="date" dir="ltr" value={String(up.formed ?? "")} onchange={(e: Event) => setProfile({ formed: textOf(e) })} />
            {#if corp}
              <Select label={t("filings.us.form")} hint={t("filings.us.formHint")} value={entityForm(bizType(year) ?? "")} options={[{ value: "llc", label: t("filings.us.llc") }, { value: "corporation", label: t("filings.us.corporation") }]} onchange={(v) => setProfile({ entityForm: v })} />
            {/if}
            {#if tr === "c-corp"}
              <Switch label={t("filings.us.foreignOwned")} description={t("filings.us.foreignOwnedHint")} checked={foreignOwned(bizType(year) ?? "")} onchange={(v) => setProfile({ foreignOwned: v })} />
            {/if}
            <Switch label={t("fus.you.fbar")} description={t("fus.you.fbarSub")} checked={up.foreignAccounts === true} onchange={(v) => setProfile({ foreignAccounts: v })} />
            {#if tr === "individual"}
              <Input label={t("fus.f.stateName")} value={stateName()} onchange={(e: Event) => setProfile({ stateName: textOf(e) })} />
              <Input label={t("fus.in.stateRate")} hint={t("fus.in.stateHint")} numeric value={stateRate(year) ?? ""} onchange={(e: Event) => setProfile({ stateRate: numOf(e) ?? 0 })} />
            {/if}
          </div>
        </Card>
      </div>
    {/if}
  {/if}
</div>

<Dialog bind:open={dlg} title={t("filings.markTitle")} description={target?.title[lang()]}>
  <div class="space-y-3">
    <Input label={t("filings.filedDate")} type="date" bind:value={on} />
    <Input label={t("filings.confirmationNo")} bind:value={conf} dir="ltr" hint={t("filings.confirmationHint")} />
  </div>
  {#snippet actions()}
    <Button onclick={() => (dlg = false)}>{t("common.cancel")}</Button>
    <Button variant="primary" onclick={save} disabled={!on}>{t("common.save")}</Button>
  {/snippet}
</Dialog>
