<script lang="ts">
  // Israeli VAT periodic report (osek murshe, Ltd): the form's fields for one period from the issued tax invoices and the input VAT on
  // expenses, due dates, problems found, and the PCN874 file to upload. OpenBooks cannot submit for you: the Tax Authority takes the report only
  // from you. Logic: country-il vat.ts / pcn874.ts; inputs: docs "invoices", "customers", the deduction rules (vatPct).
  import { page } from "$app/state";
  import { checkPcn874, inputRows, pcn874, vatPeriods, type VatLine } from "@openbooks/country-il";
  import { S, bizType, mdy, toast } from "#lib/stores/books.svelte.ts";
  import { goto } from "#lib/nav.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Card, EmptyState, Input, Money, PageHeader, Select, Table } from "#lib/ui/index.ts";
  import type { Column } from "#lib/ui/index.ts";
  import { download, il, patchIl, vatBooks, vatCtx, vatFor } from "#lib/filings.svelte.ts";

  const s = $derived(il());
  const todayIso = new Date().toLocaleDateString("sv");
  const thisYear = new Date().getFullYear();
  const periods = $derived([thisYear - 1, thisYear].flatMap((y) => vatPeriods(y, s.vatFrequency)));
  const ended = $derived(periods.filter((p) => p.to <= todayIso).at(-1) ?? periods[0]!);
  const p = $derived(periods.find((x) => x.key === page.url.searchParams.get("period")) ?? ended);
  const label = (x: { from: string; to: string }) => {
    const f = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
    const a = new Date(`${x.from}T12:00Z`), b = new Date(`${x.to}T12:00Z`);
    return x.from.slice(0, 7) === x.to.slice(0, 7) ? f.format(a) : `${f.format(a)} – ${f.format(b)}`;
  };
  const pick = (k: string) => goto(`/filings/vat?period=${k}`, { replace: true, reset: false });

  const r = $derived(vatBooks(+p.from.slice(0, 4)) ? vatFor(p) : null);
  const errors = $derived(r?.issues.filter((i) => i.level === "error") ?? []);
  const file = $derived.by(() => {
    if (!r || !s.vatId) return null;
    try {
      const text = pcn874({ vatId: s.vatId, report: r, created: todayIso });
      return { text, problems: checkPcn874(text) };
    } catch (e) {
      return { text: "", problems: [String((e as Error).message)] };
    }
  });
  function get() {
    if (!file?.text) return;
    download("PCN874.TXT", file.text, "text/plain;charset=us-ascii");
    toast(t("vat.downloaded"));
  }

  // ---- fields as the form asks ----
  type F = { key: string; label: string; value: number; strong?: boolean };
  const fields = $derived<F[]>(
    r
      ? [
          { key: "taxable", label: t("vat.f.taxable"), value: r.totals.taxableSales },
          { key: "output", label: t("vat.f.output"), value: r.totals.outputVat },
          { key: "zero", label: t("vat.f.zero"), value: r.totals.zeroExempt },
          { key: "other", label: t("vat.f.other"), value: r.totals.otherInputsVat },
          { key: "equip", label: t("vat.f.equipment"), value: r.totals.equipmentVat },
          { key: "pay", label: r.totals.payable >= 0 ? t("vat.f.pay") : t("vat.f.refund"), value: Math.abs(r.totals.payable), strong: true },
        ]
      : [],
  );

  // ---- detail ----
  const cols: Column<VatLine>[] = $derived([
    { key: "type", label: t("vat.col.type") },
    { key: "date", label: t("common.date") },
    { key: "label", label: t("vat.col.doc"), class: "w-full max-w-0 min-w-32" },
    { key: "party", label: t("vat.col.party") },
    { key: "net", label: t("vat.col.net"), numeric: true },
    { key: "vat", label: t("vat.col.vat"), numeric: true },
  ]);

  // ---- suppliers without a number (their inputs go in as petty cash) ----
  const unnamed = $derived.by(() => {
    const c = vatCtx(+p.from.slice(0, 4));
    if (!c || !r) return [];
    const m = new Map<string, number>();
    for (const x of inputRows(c.rows, c.txns)) {
      if (x.date < p.from || x.date > p.to || !x.supplier || s.supplierIds[x.supplier]) continue;
      m.set(x.supplier, (m.get(x.supplier) ?? 0) + x.vatReclaimable);
    }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 12);
  });
  const setSupplier = (name: string, id: string) => patchIl({ supplierIds: { ...s.supplierIds, [name]: id.replace(/\D/g, "") } });
  const ISSUE_LEVEL = { error: "bad", warn: "warn" } as const;
</script>

<PageHeader title={t("vat.title")} sub={t("vat.sub")}>
  {#snippet actions()}
    <Select variant="pill" icon="calendar" label={t("vat.period")} value={p.key} options={periods.map((x) => ({ value: x.key, label: label(x) }))} onchange={pick} />
  {/snippet}
</PageHeader>

<div class="space-y-6 px-4 py-4 sm:px-8">
  {#if !S.data || !bizType()}
    <EmptyState icon="file" title={t("filings.noType")} text={t("filings.noTypeText")} />
  {:else if !r}
    <EmptyState icon="file" title={t("vat.notRegistered")} text={t("vat.notRegisteredText")}>
      <Button href="/filings">{t("filings.title")}</Button>
    </EmptyState>
  {:else}
    <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card title={t("vat.fields")} description={t("vat.fieldsHint")} flush>
        <dl class="divide-y divide-line">
          {#each fields as f (f.key)}
            <div class="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5 {f.strong ? 'bg-fill' : ''}">
              <dt class="min-w-0 text-[14px] {f.strong ? 'font-medium text-ink' : 'text-ink-2'}">{f.label}</dt>
              <dd class="num shrink-0 text-[15px] {f.strong ? 'font-medium text-ink' : ''}"><Money value={f.value} cents={false} /></dd>
            </div>
          {/each}
        </dl>
        <p class="px-4 py-3 text-[12px] text-faint sm:px-5">{t("vat.rounding")}</p>
      </Card>

      <div class="space-y-4">
        <Card title={t("vat.due")}>
          <dl class="space-y-2 text-[14px]">
            <div class="flex justify-between gap-3"><dt class="text-sub">{t("vat.due.statutory")}</dt><dd class="num font-medium">{mdy(r.due.statutory)}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-sub">{t("vat.due.online")}</dt><dd class="num">{mdy(r.due.online)}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-sub">{t("vat.due.detailed")}</dt><dd class="num">{mdy(r.due.detailed)}</dd></div>
          </dl>
          <p class="mt-3 text-[12px] text-faint">{t("vat.due.note")}</p>
          <Button class="mt-3" size="sm" href="/filings">{t("vat.markOnHub")}</Button>
        </Card>
        <Card title={t("vat.file")}>
          {#if !s.vatId}
            <Input label={t("filings.vatId")} value="" dir="ltr" inputmode="numeric" placeholder="514290543" hint={t("vat.needId")} onchange={(e) => patchIl({ vatId: e.currentTarget.value.replace(/\D/g, "") })} />
          {:else}
            <div class="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon="download" onclick={get} disabled={!file?.text}>{t("vat.download")}</Button>
              {#if file && !file.problems.length}<Badge tone="good" icon="check">{t("vat.fileOk")}</Badge>{/if}
            </div>
            {#each file?.problems ?? [] as x (x)}<p class="mt-2 text-[12px] text-bad">{x}</p>{/each}
            <p class="mt-3 text-[12px] text-faint">{t("vat.fileNote")}</p>
          {/if}
        </Card>
      </div>
    </div>

    {#if r.issues.length}
      <Card title={t("vat.issues")} flush>
        <ul class="divide-y divide-line">
          {#each r.issues as i, n (n)}
            <li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] sm:px-5">
              <Badge size="sm" tone={ISSUE_LEVEL[i.level]}>{t(`vat.level.${i.level}`)}</Badge>
              <span class="min-w-0 flex-1" dir="auto">{t(`vat.issue.${i.code}`, { ref: i.ref ?? "", v: i.v ?? 0 })}</span>
            </li>
          {/each}
        </ul>
      </Card>
    {/if}

    {#if unnamed.length}
      <Card title={t("vat.suppliers")} description={t("vat.suppliersHint")}>
        <div class="grid gap-3 sm:grid-cols-2">
          {#each unnamed as [name, vat] (name)}
            <Input label="{name} · ₪{Math.round(vat)}" value="" dir="ltr" inputmode="numeric" placeholder="514290543" onchange={(e) => setSupplier(name, e.currentTarget.value)} />
          {/each}
        </div>
      </Card>
    {/if}

    <Card title={t("vat.detail", { n: r.lines.length })} flush>
      <Table columns={cols} rows={r.lines} key={(l, i) => `${l.src[0]}-${i}`} caption={t("vat.detail", { n: r.lines.length })} stack>
        {#snippet cell(l, c)}
          {#if c.key === "type"}<Badge size="sm" tone={l.side === "sale" ? "accent" : "neutral"}>{l.type}</Badge>
          {:else if c.key === "label"}<span class="block truncate" dir="auto">{l.label}</span>
          {:else if c.key === "party"}<span class="num">{+l.party ? l.party : "—"}</span>
          {:else if c.key === "date"}{l.date}
          {:else}<Money value={l[c.key as "net" | "vat"]} cents={false} />{/if}
        {/snippet}
        {#snippet empty()}<p class="px-4 py-6 text-[14px] text-sub sm:px-5">{t("vat.noLines")}</p>{/snippet}
      </Table>
    </Card>

    <Card title={t("vat.steps")}>
      <ol class="list-decimal space-y-1.5 ps-5 text-[14px] text-ink-2">
        {#each [1, 2, 3, 4, 5, 6] as n (n)}<li>{t(`vat.step.${n}`)}</li>{/each}
      </ol>
    </Card>
  {/if}
</div>
