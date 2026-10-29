<script lang="ts">
  // US tax for the open LLC: what the IRS needs for the tax year, computed from the books, and the official forms filled from them.
  // Disregarded single-member LLC: Form 5472 + pro forma 1120 (+ Part V statement). LLC taxed as a C-corp: its own 1120 + 5472.
  // Port of web/src/views/TaxUS.svelte; field maps are the US pack's form hooks (irs.ts), the PDF writing is ./pdf.ts.
  import { ccorpObligations, corpTax, llcObligations, type UsTable } from "@openbooks/country-us";
  import { S, catLabel, ent, fmt, mdy, setProfile, taxTable, toast, yearTxns } from "#lib/stores/books.svelte.ts";
  import { bidi, t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Card, Icon, Input, Money, PageHeader, Select, Table, type Column } from "#lib/ui/index.ts";
  import { corpInput, irsInput, isCorp, ownerTxns, totalAssets } from "#lib/ustax/books.ts";
  import type { Txn } from "@openbooks/schema";

  const y = $derived(S.year);
  const p = $derived((S.data?.profile ?? {}) as Record<string, string | undefined>);
  const cur = $derived(ent().currency ?? "USD");
  const corp = $derived(isCorp(y));
  const yts = $derived(yearTxns(y));
  const owner = $derived(ownerTxns(y));
  const contributions = $derived(owner.filter((x) => x.amount > 0)),
    distributions = $derived(owner.filter((x) => x.amount < 0));
  const sum = (ts: readonly Txn[]) => ts.reduce((a, x) => a + x.amount, 0);
  const assets = $derived(totalAssets(y));
  const ask = $derived(yts.filter((x) => x.category === "ask"));
  const UT = $derived(taxTable(y, "us") as unknown as UsTable);
  const duties = $derived((corp ? ccorpObligations : llcObligations)(y, UT, p));
  const due = $derived(duties[0]!.due!),
    ext = $derived(duties[0]!.extendedDue!);
  const ctax = $derived(corp ? corpTax(corpInput(y)) : null);

  // [key, input type, dir]: identifiers and addresses stay LTR inside a Hebrew page
  const FIELDS: [string, string, "auto" | "ltr"][] = [
    ["legalName", "text", "auto"],
    ["ein", "text", "ltr"],
    ["state", "text", "auto"],
    ["formed", "date", "ltr"],
    ["address", "text", "ltr"],
    ["cityStateZip", "text", "ltr"],
    ["naics", "text", "ltr"],
    ["owner", "text", "auto"],
    ["ownerAddress", "text", "auto"],
    ["ownerCountry", "text", "auto"],
    ["ownerTin", "text", "ltr"],
    ["business", "text", "auto"],
  ];
  const missing = $derived(FIELDS.filter(([k]) => !p[k]).map(([k]) => t(`taxUS.f.${k}`)));
  const code = $derived((p.state ?? "").trim().toUpperCase().slice(0, 2));
  const stateText = $derived(
    ["WY", "DE", "NM"].includes(code) ? t(`taxUS.state.${code}`) : p.state ? t("taxUS.state.other", { state: bidi(p.state) }) : t("taxUS.state.none"),
  );

  // auto-fill: the official IRS PDFs filled from the books (pdf-lib is ~1 MB, so it loads on click)
  let filling = $state(false);
  async function fill(kind: "packet" | "5472" | "1120") {
    filling = true;
    try {
      const irs = await import("./pdf.ts");
      const d = corp ? corpInput(y) : irsInput(y);
      const name = (p.legalName ?? "LLC").replace(/\W+/g, "-");
      if (kind === "packet") irs.download(await irs.filingPacket(d), `${name}-${y}-${corp ? "1120-5472" : "5472-1120"}-packet.pdf`);
      else if (kind === "5472") irs.download(await irs.fill5472({ ...d, de: !corp }), `${name}-${y}-f5472.pdf`);
      else irs.download(await irs.fill1120(d), `${name}-${y}-f1120${corp ? "" : "-pro-forma"}.pdf`);
    } catch (e) {
      toast(t("taxUS.fillError", { msg: bidi((e as Error).message) }));
    } finally {
      filling = false;
    }
  }

  type Step = { ok: boolean | null; title: string; text: string; href?: string };
  const steps: Step[] = $derived([
    { ok: !missing.length, title: t("taxUS.details"), text: missing.length ? t("taxUS.missing", { list: missing.join(", ") }) : t("taxUS.detailsOk") },
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
            text: t("taxUS.partVText", { nc: contributions.length, c: fmt(sum(contributions), 2), nd: distributions.length, d: fmt(-sum(distributions), 2) }),
          },
          { ok: null, title: t("taxUS.fill5472"), text: t("taxUS.fill5472Text", { assets: fmt(assets, 2) }) },
          { ok: null, title: t("taxUS.proForma"), text: t("taxUS.proFormaText") },
          { ok: null, title: t("taxUS.fileBy", { date: mdy(due) }), text: t("taxUS.fileByText", { ext: mdy(ext) }) },
        ]),
    { ok: null, title: t("taxUS.stateFiling"), text: stateText },
    { ok: null, title: t("taxUS.israel"), text: t(corp ? "taxUS.cc.israelText" : "taxUS.israelText", { y }) },
  ]);

  const yearOpts = $derived(
    (S.data?.years ?? [])
      .map((v) => ({ value: String(v), label: String(v) }))
      .reverse(),
  );
  const cols: Column<Txn>[] = $derived([
    { key: "date", label: t("common.date"), class: "w-32" },
    { key: "desc", label: t("common.description"), wrap: true },
    { key: "kind", label: t("taxUS.kind"), class: "w-40" },
    { key: "amount", label: t("common.amount"), numeric: true, class: "w-36" },
  ]);
</script>

<PageHeader title={t("nav.form5472")} badge={String(y)} sub={t(corp ? "taxUS.cc.sub" : "taxUS.sub")}>
  {#snippet actions()}
    <Select variant="pill" icon="calendar" label={t("taxUS.year")} value={String(y)} options={yearOpts} onchange={(v) => (S.year = +v)} />
  {/snippet}
</PageHeader>

<div class="px-4 pb-12 pt-4 sm:px-8">
  <div class="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/25 bg-accent/6 px-4 py-4 sm:px-5">
    <span class="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent-ink"><Icon name="form" size={18} /></span>
    <div class="min-w-0 flex-1 basis-56">
      <div class="text-[14px] text-ink">{t("taxUS.autoTitle", { y })}</div>
      <div class="text-[13px] text-sub">
        {#if corp}{missing.length ? t("taxUS.cc.autoTextMissing", { n: missing.length }) : t("taxUS.cc.autoText")}
        {:else}{missing.length ? t("taxUS.autoTextMissing", { n: missing.length }) : t("taxUS.autoText")}{/if}
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" onclick={() => fill("1120")} disabled={filling}>1120</Button>
      <Button size="sm" onclick={() => fill("5472")} disabled={filling}>5472</Button>
      <Button size="sm" variant="primary" icon="download" loading={filling} onclick={() => fill("packet")} disabled={filling}>{filling ? t("taxUS.filling") : t("taxUS.packet")}</Button>
    </div>
  </div>

  <div class="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
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

      <Card title={t(corp ? "taxUS.cc.ownerTitle" : "taxUS.partVTitle", { y })} flush>
        <Table columns={cols} rows={owner} key={(r) => r.id} onrowclick={(r) => (S.drawer = r.id)}>
          {#snippet cell(r, c)}
            {#if c.key === "date"}<span class="text-sub num">{mdy(r.date)}</span>
            {:else if c.key === "desc"}<span class="text-ink" dir="auto">{r.desc}{r.memo ? ` · ${r.memo}` : ""}</span>
            {:else if c.key === "kind"}<Badge size="sm" tone={r.amount > 0 ? "good" : "neutral"}>{t(r.amount > 0 ? "taxUS.contribution" : "taxUS.distribution")}</Badge>
            {:else}<Money value={r.amount} currency={cur} plus />{/if}
          {/snippet}
          {#snippet empty()}<p class="px-4 py-4 text-[14px] text-sub sm:px-5">{t("taxUS.noOwner", { cat: catLabel("equity:owner") })}</p>{/snippet}
          {#snippet foot()}
            {#if owner.length}
              <tr><td colspan="3">{t("taxUS.contributions")}</td><td class="text-end"><Money value={sum(contributions)} currency={cur} /></td></tr>
              <tr><td colspan="3">{t("taxUS.distributions")}</td><td class="text-end"><Money value={-sum(distributions)} currency={cur} /></td></tr>
            {/if}
          {/snippet}
        </Table>
      </Card>
    </div>

    <Card title={t("taxUS.companyOwner")} description={t("taxUS.savedWith")} class="xl:sticky xl:top-4">
      <div class="profile space-y-3">
        {#each FIELDS as [k, type, dir] (k)}
          <Input
            label={t(`taxUS.f.${k}`)}
            {type}
            {dir}
            value={p[k] ?? ""}
            required={!p[k]}
            onchange={(e: Event) => setProfile({ [k]: (e.currentTarget as HTMLInputElement).value })} />
        {/each}
      </div>
      <p class="mt-5 text-[12px] leading-relaxed text-faint">{t("taxUS.disclaimer")}</p>
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
