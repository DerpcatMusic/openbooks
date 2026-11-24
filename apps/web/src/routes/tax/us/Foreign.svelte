<script lang="ts">
  // US tax for the open LLC: what the IRS needs for the tax year, computed from the books, and the official forms filled from them.
  // Disregarded single-member LLC owned from abroad: Form 5472 + pro forma 1120 (+ Part V statement). LLC taxed as a C-corp: its own 1120 + 5472
  // and the 1120-W estimates. The header and year picker are the page's (+page.svelte); field maps are the US pack's form hooks (irs.ts).
  import {
    ccorpObligations,
    corpTax,
    form5472Set,
    llcObligations,
    partIV,
    partV,
    pdfFor,
    requiredPartVII,
    treatmentOf,
    usTable,
    validate5472,
    type IrsTxn,
    type Part5472Treatment,
    type PartVIIAnswers,
    type RelatedParty5472,
    type UsTable,
  } from "@openbooks/country-us";
  import { S, catLabel, ent, fmt, mdy, saveTags, setProfile, splitsDoc, tagsDoc, taxTable, toast, yearTxns } from "#lib/stores/books.svelte.ts";
  import { brokenSplits, ensureRelatedPartyTag, group, relatedPartyTags } from "@openbooks/core";
  import { bidi, t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Card, Icon, IconButton, Input, Money, Segmented, Select, Table, type Column } from "#lib/ui/index.ts";
  import { corpInput, form5472Doc, irsInput, isCorp, ownerTxns, saveForm5472Doc, totalAssets, usNow } from "#lib/ustax/books.ts";
  import Contractors from "./Contractors.svelte";
  import Deadlines from "./Deadlines.svelte";
  import type { Txn } from "@openbooks/schema";

  let { y }: { y: number } = $props();
  const p = $derived((S.data?.profile ?? {}) as Record<string, any>);
  const cur = $derived(ent().currency ?? "USD");
  const corp = $derived(isCorp(y));
  const yts = $derived(yearTxns(y));
  const owner = $derived(ownerTxns(y));
  const fdoc = $derived(form5472Doc());
  const irsData = $derived(irsInput(y));
  const p4 = $derived(partIV(irsData));
  const p5 = $derived(partV(irsData));
  const formSet = $derived(form5472Set({ ...irsData, de: !corp }));
  const issues = $derived(validate5472({ ...irsData, de: !corp }));
  const has1120Blank = $derived(!!pdfFor("1120", y));
  const broken = $derived(brokenSplits(yts, splitsDoc()));
  const assets = $derived(totalAssets(y));
  const ask = $derived(yts.filter((x) => x.category === "ask"));
  const UT = $derived(taxTable(y, "us") as unknown as UsTable);
  const duties = $derived((corp ? ccorpObligations : llcObligations)(y, UT, p));
  const due = $derived(duties[0]!.due!),
    ext = $derived(duties[0]!.extendedDue!);
  const ctax = $derived(corp ? corpTax(corpInput(y)) : null);
  const est = $derived(corp ? usNow(y).corp?.estimates : null);

  // Grouped profile fields for clean Form 5472 Part I / Part II editing
  const COMPANY_FIELDS: [string, string, "auto" | "ltr"][] = [
    ["legalName", "text", "auto"],
    ["ein", "text", "ltr"],
    ["state", "text", "auto"],
    ["formed", "date", "ltr"],
    ["address", "text", "ltr"],
    ["cityStateZip", "text", "ltr"],
    ["business", "text", "auto"],
    ["naics", "text", "ltr"],
  ];
  const OWNER_FIELDS: [string, string, "auto" | "ltr"][] = [
    ["owner", "text", "auto"],
    ["ownerLegalName", "text", "ltr"],
    ["ownerAddress", "text", "auto"],
    ["ownerTin", "text", "ltr"],
  ];
  const COUNTRY_FIELDS: [string, string, "auto" | "ltr"][] = [
    ["businessCountries", "text", "auto"],
    ["taxReturnCountry", "text", "auto"],
    ["ownerCountry", "text", "auto"],
    ["ownerBusinessCountry", "text", "auto"],
    ["ownerCitizenship", "text", "auto"],
    ["ownerResidence", "text", "auto"],
  ];
  const OPTIONAL = new Set(["taxReturnCountry", "ownerLegalName", "ownerBusinessCountry", "ownerCitizenship", "ownerResidence"]);
  const labelFor = (k: string) =>
    k === "ownerLegalName" || k === "ownerBusinessCountry" || k === "ownerCitizenship" || k === "ownerResidence" ? t(`legal.5472.${k}`) : t(`taxUS.f.${k}`);

  const nonAsciiIssues = $derived(issues.filter((i) => i.code === "nonAscii"));
  const missingIssues = $derived(issues.filter((i) => i.code === "missing"));
  const partVIIQuestions = $derived(requiredPartVII(!corp, (p.partVII ?? {}) as PartVIIAnswers));
  const partVII = $derived((p.partVII ?? {}) as PartVIIAnswers);
  const setPartVII = (k: keyof PartVIIAnswers, v: boolean) => setProfile({ partVII: { ...partVII, [k]: v } });
  const confirmAllNo = () => {
    const next: PartVIIAnswers = { ...partVII };
    for (const q of requiredPartVII(!corp, { ...partVII, q37: false })) next[q] = false;
    void setProfile({ partVII: next });
  };

  const TREATMENTS: Part5472Treatment[] = [
    "contribution",
    "distribution",
    "services",
    "rent",
    "royalty",
    "intangible",
    "commission",
    "loan",
    "interest",
    "other-part4",
    "formation",
    "reimbursement",
    "other-part5",
  ];
  const treatmentOpts = $derived(TREATMENTS.map((k) => ({ value: k, label: t(`legal.5472.tr.${k}`) })));
  const partyOpts = $derived([
    { value: "", label: t("legal.5472.ownerParty") },
    ...(fdoc.relatedParties ?? []).map((rp) => ({ value: rp.id, label: rp.name || rp.id })),
  ]);

  type LedgerRow5472 = IrsTxn & { _key: string; _manual?: boolean; _bankId?: string };
  const rows5472 = $derived<LedgerRow5472[]>([
    ...owner.map((x) => ({
      _key: `b:${x.id}`,
      _bankId: x.id,
      id: x.id,
      date: x.date,
      desc: x.memo ? `${x.desc} · ${x.memo}` : x.desc,
      amount: x.amount,
      ...(group(x.category) === "equity" ? {} : { related: true }),
      treatment: fdoc.treatments?.[x.id],
      partyId: fdoc.parties?.[x.id],
    })),
    ...(fdoc.events?.[String(y)] ?? [])
      .filter((ev) => !ev.date || ev.date.startsWith(`${y}-`))
      .map((ev, i) => ({ ...ev, _key: `m:${ev.id ?? i}`, _manual: true })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1)));

  function setRowTreatment(r: LedgerRow5472, tr: Part5472Treatment) {
    if (r._bankId) {
      void saveForm5472Doc({ ...fdoc, treatments: { ...fdoc.treatments, [r._bankId]: tr } });
    } else {
      const list = (fdoc.events?.[String(y)] ?? []).map((ev) => (ev.id === r.id ? { ...ev, treatment: tr } : ev));
      void saveForm5472Doc({ ...fdoc, events: { ...fdoc.events, [String(y)]: list } });
    }
  }
  function setRowParty(r: LedgerRow5472, pid: string) {
    if (r._bankId) {
      const next = { ...fdoc.parties };
      if (pid) next[r._bankId] = pid;
      else delete next[r._bankId];
      void saveForm5472Doc({ ...fdoc, parties: next });
    } else {
      const list = (fdoc.events?.[String(y)] ?? []).map((ev) => (ev.id === r.id ? { ...ev, partyId: pid || undefined } : ev));
      void saveForm5472Doc({ ...fdoc, events: { ...fdoc.events, [String(y)]: list } });
    }
  }
  let newEv = $state({ date: "", desc: "", amount: "", treatment: "formation" as Part5472Treatment, partyId: "" });
  $effect(() => {
    const targetPrefix = `${y}-`;
    if (!newEv.date || (!newEv.desc && !newEv.amount && !newEv.date.startsWith(targetPrefix))) {
      newEv.date = `${y}-01-15`;
    }
  });
  function addEvent() {
    const amt = Number(newEv.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newEv.date) || !newEv.desc.trim() || !Number.isFinite(amt) || amt === 0) return;
    const evYear = Number(newEv.date.slice(0, 4));
    if (!Number.isInteger(evYear) || evYear < 1990 || evYear > 2100) return;
    const ev: IrsTxn = {
      id: `ev-${crypto.randomUUID().slice(0, 8)}`,
      date: newEv.date,
      desc: newEv.desc.trim(),
      amount: amt,
      treatment: newEv.treatment,
      ...(newEv.partyId ? { partyId: newEv.partyId } : {}),
    };
    const bucket = String(evYear);
    const prev = fdoc.events?.[bucket] ?? [];
    void saveForm5472Doc({ ...fdoc, events: { ...fdoc.events, [bucket]: [...prev, ev] } });
    if (evYear !== y) toast(`Saved off-bank event under tax year ${evYear} (matching ${ev.date}).`);
    newEv = { ...newEv, date: `${y}-01-15`, desc: "", amount: "" };
  }
  function removeEvent(id: string | undefined) {
    if (!id) return;
    const list = (fdoc.events?.[String(y)] ?? []).filter((ev) => ev.id !== id);
    void saveForm5472Doc({ ...fdoc, events: { ...fdoc.events, [String(y)]: list } });
  }
  let newParty = $state({ name: "", address: "", tin: "", residenceCountry: "" });
  function addParty() {
    if (!newParty.name.trim()) return;
    const rp: RelatedParty5472 = {
      id: `rp-${crypto.randomUUID().slice(0, 6)}`,
      name: newParty.name.trim(),
      address: newParty.address.trim() || undefined,
      tin: newParty.tin.trim() || undefined,
      businessCountry: newParty.residenceCountry.trim() || undefined,
      residenceCountry: newParty.residenceCountry.trim() || undefined,
      foreign: true,
      relatedToReportingCorp: true,
      relatedTo25Shareholder: true,
    };
    void saveForm5472Doc({ ...fdoc, relatedParties: [...(fdoc.relatedParties ?? []), rp] });
    newParty = { name: "", address: "", tin: "", residenceCountry: "" };
  }
  function removeParty(id: string) {
    void saveForm5472Doc({ ...fdoc, relatedParties: (fdoc.relatedParties ?? []).filter((rp) => rp.id !== id) });
  }

  const code = $derived((p.state ?? "").trim().toUpperCase().slice(0, 2));
  const stateText = $derived(
    ["WY", "DE", "NM"].includes(code) ? t(`taxUS.state.${code}`, { amount: fmt(UT.delawareTax ?? usTable(y).delawareTax) }) : p.state ? t("taxUS.state.other", { state: bidi(p.state) }) : t("taxUS.state.none"),
  );

  // auto-fill: the official IRS PDFs filled from the books (pdf-lib is ~1 MB, so it loads on click)
  let filling = $state(false);
  let fillErr = $state<string | null>(null);
  async function fill(kind: "packet" | "5472" | "1120") {
    filling = true;
    fillErr = null;
    try {
      const irs = await import("./pdf.ts");
      const d = corp ? corpInput(y) : irsInput(y);
      const name = (p.legalName ?? "LLC").replace(/\W+/g, "-");
      if (kind === "packet") irs.download(await irs.filingPacket(d), `${name}-${y}-${corp ? "1120-5472" : "5472-1120"}-packet.pdf`);
      else if (kind === "5472") irs.download(await irs.fill5472({ ...d, de: !corp }), `${name}-${y}-f5472.pdf`);
      else irs.download(await irs.fill1120(d), `${name}-${y}-f1120${corp ? "" : "-pro-forma"}.pdf`);
    } catch (e) {
      const irs = await import("./pdf.ts");
      fillErr =
        e instanceof irs.UnfilledFields
          ? t("legal.unfilled", { form: e.form, list: e.fields.join(", ") })
          : e instanceof irs.NoBlank
            ? t("legal.noBlank", { form: e.form, y: e.year })
            : t("taxUS.fillError", { msg: bidi((e as Error).message) });
    } finally {
      filling = false;
    }
  }

  const relTags = $derived(relatedPartyTags(tagsDoc()));
  const addRelatedTag = () => saveTags(ensureRelatedPartyTag(tagsDoc(), t("legal.relatedTag")).doc);

  type Step = { ok: boolean | null; title: string; text: string; href?: string };
  const steps: Step[] = $derived([
    {
      ok: !issues.length,
      title: t("taxUS.details"),
      text: issues.length ? t("legal.5472.blocked", { n: issues.length }) : t("taxUS.detailsOk"),
    },
    ...(broken.length
      ? [{ ok: false as const, title: t("legal.brokenSplits", { n: broken.length }), text: t("legal.brokenSplitsText"), href: "/transactions" }]
      : []),
    {
      ok: !ask.length,
      title: t("taxUS.categorized"),
      text: ask.length ? t("taxUS.uncategorized", { n: ask.length, y }) : t("taxUS.allCategorized", { n: yts.length, y }),
      href: ask.length ? "/review" : undefined,
    },
    ...(corp
      ? [
          {
            ok: null,
            title: t("taxUS.cc.income"),
            text: t("taxUS.cc.incomeText", { taxable: fmt(ctax!.taxable), rate: Math.round((UT.corpRate ?? 0.21) * 100), tax: fmt(ctax!.tax) }),
          },
          { ok: null, title: t("taxUS.cc.5472"), text: t("taxUS.cc.5472Text", { assets: fmt(assets, 2) }) },
          { ok: null, title: t("taxUS.fileBy", { date: mdy(due) }), text: t("taxUS.cc.fileByText", { date: mdy(due), ext: mdy(ext) }) },
          {
            ok: null,
            title: t("taxUS.cc.dividends"),
            text: t("taxUS.cc.dividendsText", { rate: Math.round((UT.treatyDividend ?? 0.25) * 100), date: mdy(duties[2]!.due!) }),
          },
        ]
      : [
          {
            ok: true,
            title: t("taxUS.partV"),
            text: `${t("legal.5472.partIVTitle")}: ${fmt(p4.total, 2)} · ${t("legal.5472.partVOnlyTitle")}: ${fmt(p5.total, 2)} (${formSet.length}× 5472)`,
          },
          { ok: null, title: t("taxUS.fill5472"), text: t("taxUS.fill5472Text", { assets: fmt(assets, 2) }) },
          { ok: null, title: t("taxUS.proForma"), text: t("taxUS.proFormaText") },
          { ok: null, title: t("taxUS.fileBy", { date: mdy(due) }), text: t("taxUS.fileByText", { ext: mdy(ext) }) },
        ]),
    { ok: null, title: t("fus.boi.title"), text: t("fus.boi.text") },
    { ok: null, title: t("taxUS.stateFiling"), text: stateText },
    { ok: null, title: t("taxUS.israel"), text: t(corp ? "taxUS.cc.israelText" : "taxUS.israelText", { y }) },
  ]);

  const wcols: Column<{ n: number; due: string; amount: number }>[] = $derived([
    { key: "n", label: t("fus.est.payment") },
    { key: "due", label: t("fus.est.due") },
    { key: "amount", label: t("common.amount"), numeric: true },
  ]);
  const cols: Column<LedgerRow5472>[] = $derived([
    { key: "date", label: t("common.date"), class: "w-28" },
    { key: "desc", label: t("common.description"), wrap: true },
    { key: "treatment", label: t("legal.5472.treatment"), class: "w-48" },
    ...(partyOpts.length > 1 ? [{ key: "party", label: t("legal.5472.party"), class: "w-40" }] : []),
    { key: "amount", label: t("common.amount"), numeric: true, class: "w-32" },
  ]);
</script>

<div>
  <div class="flex flex-wrap items-center gap-3 rounded-2xl border {issues.length ? 'border-warn/35 bg-warn/8' : 'border-accent/25 bg-accent/6'} px-4 py-4 sm:px-5">
    <span class="grid size-9 shrink-0 place-items-center rounded-full {issues.length ? 'bg-warn/15 text-warn' : 'bg-accent/15 text-accent-ink'}">
      <Icon name={issues.length ? "alert" : "form"} size={18} />
    </span>
    <div class="min-w-0 flex-1 basis-56">
      <div class="text-[14px] text-ink">{t("taxUS.autoTitle", { y })}</div>
      <div class="text-[13px] text-sub">
        {#if issues.length}
          {t("legal.5472.blocked", { n: issues.length })}
        {:else if !has1120Blank}
          {t("legal.5472.no1120Blank", { y })}
        {:else}
          {t(corp ? "taxUS.cc.autoText" : "taxUS.autoText")}
        {/if}
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" onclick={() => fill("1120")} disabled={filling || !has1120Blank || issues.length > 0}>1120</Button>
      <Button size="sm" onclick={() => fill("5472")} disabled={filling || issues.length > 0}>5472{formSet.length > 1 ? ` (×${formSet.length})` : ""}</Button>
      <Button size="sm" variant="primary" icon="download" loading={filling} onclick={() => fill("packet")} disabled={filling || !has1120Blank || issues.length > 0}>
        {filling ? t("taxUS.filling") : t("taxUS.packet")}
      </Button>
    </div>
  </div>

  {#if nonAsciiIssues.length}
    <div role="alert" class="mt-3 flex items-start gap-3 rounded-2xl border border-bad/30 bg-bad/8 px-4 py-3 text-[13px] text-ink">
      <Icon name="alert" size={16} class="mt-0.5 shrink-0 text-bad" />
      <div class="space-y-1">
        {#each nonAsciiIssues as iss (iss.field)}
          <div>{t("legal.5472.nonAscii", { field: labelFor(iss.field) })}</div>
        {/each}
      </div>
    </div>
  {/if}

  {#if fillErr}
    <div role="alert" class="mt-3 flex items-start gap-3 rounded-2xl border border-warn/30 bg-warn/8 px-4 py-3 text-[14px] text-ink">
      <span class="mt-0.5 shrink-0 text-warn"><Icon name="alert" size={18} /></span>
      <span class="min-w-0 flex-1" dir="auto">{fillErr}</span>
    </div>
  {/if}

  <div class="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_370px]">
    <div class="min-w-0 space-y-4">
      <Card flush>
        <ol class="divide-y divide-line">
          {#each steps as s, i (i)}
            <li class="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
              <span class="mt-0.5 shrink-0 {s.ok === true ? 'text-good' : s.ok === false ? 'text-warn' : 'text-faint'}">
                {#if s.ok === null}<span class="grid size-[18px] place-items-center rounded-full border border-line-strong text-[11px] text-sub num">{i + 1}</span>
                {:else}<Icon name={s.ok ? "check" : "alert"} size={18} />{/if}
              </span>
              <div class="min-w-0 flex-1 basis-48">
                <div class="text-[14px] text-ink">{s.title}</div>
                <div class="mt-0.5 text-[14px] text-sub">{s.text}</div>
              </div>
              {#if s.href}<Button size="sm" href={s.href}>{t("taxUS.review")}</Button>{/if}
            </li>
          {/each}
        </ol>
      </Card>

      {#if est}
        <Card title={t("fus.w.title", { y })} description={est.exempt ? t("fus.w.exempt", { min: fmt(UT.fed?.corpEstimateMin ?? 500) }) : t("fus.w.sub", { amount: fmt(est.required) })} flush>
          <Table columns={wcols} rows={est.installments} key={(r) => r.n} caption={t("fus.w.title", { y })} stack>
            {#snippet cell(r, c)}
              {#if c.key === "n"}<span class="text-sub">{t("fus.est.n", { n: r.n })}</span>
              {:else if c.key === "due"}<span class="text-ink num">{mdy(r.due)}</span>
              {:else}<Money value={r.amount} currency={cur} />{/if}
            {/snippet}
          </Table>
        </Card>
      {/if}

      <Card title={t(corp ? "taxUS.cc.ownerTitle" : "taxUS.partVTitle", { y })} flush>
        <div class="grid gap-3 border-b border-line px-4 py-3 sm:grid-cols-3 sm:px-5">
          <div class="rounded-xl bg-fill px-3 py-2">
            <div class="text-[12px] text-sub">{t("legal.5472.partIVTitle")}</div>
            <div class="mt-0.5 text-[16px] font-medium text-ink"><Money value={p4.total} currency={cur} /></div>
          </div>
          <div class="rounded-xl bg-fill px-3 py-2">
            <div class="text-[12px] text-sub">{t("legal.5472.partVOnlyTitle")}</div>
            <div class="mt-0.5 text-[16px] font-medium text-ink"><Money value={p5.total} currency={cur} /></div>
          </div>
          <div class="rounded-xl bg-fill px-3 py-2">
            <div class="text-[12px] text-sub">Line 1f / 1h ({formSet.length}× 5472)</div>
            <div class="mt-0.5 text-[16px] font-medium text-ink"><Money value={p4.total + (corp ? 0 : p5.total)} currency={cur} /></div>
          </div>
        </div>
        <Table columns={cols} rows={rows5472} key={(r) => r._key}>
          {#snippet cell(r, c)}
            {#if c.key === "date"}<span class="text-sub num">{mdy(r.date)}</span>
            {:else if c.key === "desc"}
              <div class="flex items-center gap-2">
                {#if r._bankId}
                  <button type="button" class="text-start text-ink hover:underline" dir="auto" onclick={() => (S.drawer = r._bankId!)}>{r.desc}</button>
                {:else}
                  <span class="text-ink" dir="auto">{r.desc}</span>
                  <IconButton icon="x" size="sm" label={t("common.remove")} onclick={() => removeEvent(r.id)} />
                {/if}
              </div>
            {:else if c.key === "treatment"}
              <Select
                variant="pill"
                label={t("legal.5472.treatment")}
                value={treatmentOf(r)}
                options={treatmentOpts}
                onchange={(v) => setRowTreatment(r, v as Part5472Treatment)} />
            {:else if c.key === "party"}
              <Select
                variant="pill"
                label={t("legal.5472.party")}
                value={r.partyId ?? ""}
                options={partyOpts}
                onchange={(v) => setRowParty(r, v)} />
            {:else}<Money value={r.amount} currency={cur} plus />{/if}
          {/snippet}
          {#snippet empty()}<p class="px-4 py-4 text-[14px] text-sub sm:px-5">{t("taxUS.noOwner", { cat: catLabel("equity:owner") })}</p>{/snippet}
        </Table>
        <div class="border-t border-line px-4 py-3.5 sm:px-5">
          <div class="text-[13px] font-medium text-ink">{t("legal.5472.addEvent")}</div>
          <p class="mt-0.5 text-[12px] text-sub">{t("legal.5472.addEventHint")}</p>
          <div class="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Input label={t("common.date")} type="date" min={`${y}-01-01`} max={`${y}-12-31`} dir="ltr" bind:value={newEv.date} />
            <Input label={t("common.description")} bind:value={newEv.desc} placeholder="e.g. Doola formation fee" />
            <Input label={t("common.amount")} numeric type="number" step="any" bind:value={newEv.amount} placeholder="+500 / -1200" />
            <Select label={t("legal.5472.treatment")} value={newEv.treatment} options={treatmentOpts} onchange={(v) => (newEv.treatment = v as Part5472Treatment)} />
            <div class="flex items-end"><Button size="sm" icon="plus" onclick={addEvent}>{t("common.add")}</Button></div>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 sm:px-5">
          <p class="min-w-0 flex-1 basis-56 text-[13px] text-sub">{t(relTags.size ? "legal.relatedHint" : "legal.relatedHintNone")}</p>
          {#if !relTags.size}<Button size="sm" onclick={addRelatedTag}>{t("legal.relatedAdd")}</Button>{/if}
        </div>
      </Card>

      <Card title={t("legal.5472.partVII")} description={t("legal.5472.partVIISub")}>
        {#snippet actions()}
          <Button size="sm" variant="ghost" onclick={confirmAllNo}>{t("legal.5472.markAllNo")}</Button>
        {/snippet}
        <ul class="divide-y divide-line">
          {#each partVIIQuestions as q (q)}
            <li class="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <span class="min-w-0 flex-1 basis-60 text-[13px] text-ink-2">{t(`legal.5472.${q}`)}</span>
              <Segmented
                size="sm"
                label={t(`legal.5472.${q}`)}
                value={partVII[q] === true ? "yes" : partVII[q] === false ? "no" : ""}
                items={[
                  { key: "yes", label: t("common.yes") },
                  { key: "no", label: t("common.no") },
                ]}
                onchange={(v) => setPartVII(q, v === "yes")} />
            </li>
          {/each}
        </ul>
      </Card>

      <Card title={t("legal.5472.partiesTitle")}>
        {#if (fdoc.relatedParties ?? []).length}
          <ul class="mb-3 divide-y divide-line">
            {#each fdoc.relatedParties ?? [] as rp (rp.id)}
              <li class="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span class="min-w-0 flex-1 text-ink" dir="auto">{rp.name}{rp.residenceCountry ? ` · ${rp.residenceCountry}` : ""}{rp.tin ? ` · ${rp.tin}` : ""}</span>
                <IconButton icon="x" size="sm" label={t("common.remove")} onclick={() => removeParty(rp.id)} />
              </li>
            {/each}
          </ul>
        {/if}
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Input label={t("common.name")} bind:value={newParty.name} placeholder="English legal name" />
          <Input label={t("taxUS.f.ownerAddress")} bind:value={newParty.address} />
          <Input label={t("taxUS.f.ownerTin")} dir="ltr" bind:value={newParty.tin} />
          <Input label={t("taxUS.f.ownerCountry")} bind:value={newParty.residenceCountry} placeholder="Israel" />
          <div class="flex items-end"><Button size="sm" icon="plus" onclick={addParty}>{t("legal.5472.addParty")}</Button></div>
        </div>
      </Card>

      {#if corp}<Contractors {y} />{/if}
      <Deadlines {y} />
    </div>

    <Card title={t("taxUS.companyOwner")} description={t("taxUS.savedWith")} class="xl:sticky xl:top-4">
      <div class="profile space-y-5">
        <div>
          <h3 class="mb-2.5 text-[12px] font-medium tracking-wide text-sub uppercase">{t("legal.5472.sectionCompany")}</h3>
          <div class="space-y-3">
            {#each COMPANY_FIELDS as [k, type, dir] (k)}
              <Input
                label={labelFor(k)}
                {type}
                {dir}
                value={p[k] ?? ""}
                required={!p[k] && !OPTIONAL.has(k)}
                onchange={(e: Event) => setProfile({ [k]: (e.currentTarget as HTMLInputElement).value })} />
            {/each}
          </div>
        </div>
        <div class="border-t border-line pt-4">
          <h3 class="mb-2.5 text-[12px] font-medium tracking-wide text-sub uppercase">{t("legal.5472.sectionOwner")}</h3>
          <div class="space-y-3">
            {#each OWNER_FIELDS as [k, type, dir] (k)}
              <Input
                label={labelFor(k)}
                {type}
                {dir}
                value={p[k] ?? ""}
                required={!p[k] && !OPTIONAL.has(k)}
                onchange={(e: Event) => setProfile({ [k]: (e.currentTarget as HTMLInputElement).value })} />
            {/each}
          </div>
        </div>
        <div class="border-t border-line pt-4">
          <h3 class="mb-2.5 text-[12px] font-medium tracking-wide text-sub uppercase">{t("legal.5472.sectionCountries")}</h3>
          <div class="space-y-3">
            {#each COUNTRY_FIELDS as [k, type, dir] (k)}
              <Input
                label={labelFor(k)}
                {type}
                {dir}
                value={p[k] ?? ""}
                required={!p[k] && !OPTIONAL.has(k)}
                hint={k === "businessCountries" || k === "taxReturnCountry" ? t(`legal.hint.${k}`) : undefined}
                onchange={(e: Event) => setProfile({ [k]: (e.currentTarget as HTMLInputElement).value })} />
            {/each}
          </div>
        </div>
      </div>
      {#if missingIssues.length}
        <p class="mt-4 text-[12px] text-warn">{t("taxUS.missing", { list: missingIssues.map((m) => labelFor(m.field)).join(", ") })}</p>
      {/if}
      <p class="mt-4 text-[12px] leading-relaxed text-faint">{t("taxUS.disclaimer")}</p>
    </Card>
  </div>
</div>

<style>
  /* privacy mode: the company's and owner's identifiers are personal data */
  :global(html[data-private]) .profile :global(input) {
    filter: blur(6px);
  }
  :global(html[data-private]) .profile :global(input:focus) {
    filter: none;
  }
</style>
