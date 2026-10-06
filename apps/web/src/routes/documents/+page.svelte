<script lang="ts">
  // Documents: statements in inbox/ (they feed the books) and the year's proofs (certificates the return needs), with a
  // checklist of what this year still needs. IL: preview report + proof pack. Drop files anywhere (the shell) or use Add.
  import { S, isUS, upload, fileUrl, packUrl, mdy, yearTxns, bizType, taxTable } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { form1301, type IlTable } from "@openbooks/country-il";
  import { Badge, Button, Card, EmptyState, Icon, PageHeader, Select, Table } from "#lib/ui/index.ts";
  import FilePick from "./FilePick.svelte";

  const d = $derived(S.data!);
  const us = $derived(isUS());
  const proofs = $derived(d.proofs[S.year] ?? []);
  const has = (re: RegExp) => proofs.some((n) => re.test(n));
  const NEEDED = $derived.by(() => {
    if (us)
      return [
        { label: t("documents.ein"), why: t("documents.einWhy"), ok: has(/ein|cp.?575|147c/i) },
        { label: t("documents.articles"), why: t("documents.articlesWhy"), ok: has(/articles|formation|certificate/i) },
      ];
    const b = form1301({ y: S.year, txns: yearTxns(), type: bizType() ?? "", T: taxTable(S.year) as unknown as IlTable, form: d.form[S.year] ?? {}, profile: d.profile });
    return [
      b.soldier > 0 && { label: t("documents.f830"), why: t("documents.f830Why"), ok: has(/830/) },
      b.cap > 0 && { label: t("documents.f867"), why: t("documents.f867Why"), ok: has(/867|אלטשולר|altshuler|גמל/i) },
      b.withheld > 0 && { label: t("documents.withheld"), why: t("documents.withheldWhy"), ok: has(/867|אישור|ניכוי|אלטשולר/i) },
    ].filter((x) => !!x);
  });
  type Row = { name: string; bad?: boolean };
  const rows = $derived<Row[]>([...d.inbox.map((name) => ({ name })), ...(d.unreadable ?? []).map((name) => ({ name, bad: true }))]);
  const checksOf = (n: string) => d.checks.filter((c) => c.file === n);
  const countOf = (n: string) => d.txns.filter((x) => x.file === n).length;
  const COLS = $derived([
    { key: "file", label: t("documents.file") },
    { key: "covers", label: t("documents.covers") },
    { key: "txns", label: t("documents.txns"), numeric: true },
  ]);
  const years = $derived(d.years.map((y) => ({ value: String(y), label: String(y) })).reverse());
  const proofUrl = (name: string) => fileUrl(`${S.year}/${name}`, "proofs").replace("%2F", "/");
</script>

<svelte:head><title>{t("documents.title")} · OpenBooks</title></svelte:head>

<PageHeader title={t("documents.title")} sub={t("documents.sub")}>
  {#snippet actions()}
    {#if !us}
      <Button icon="file" href="/print/{S.year}?e={encodeURIComponent(S.e)}" target="_blank">{t("documents.preview")}</Button>
      <Button variant="primary" icon="printer" href={packUrl(S.year)} target="_blank">{t("documents.pack", { year: S.year })}</Button>
    {/if}
  {/snippet}
</PageHeader>

<div class="max-w-5xl space-y-6 px-4 pt-5 pb-16 sm:px-8">
  <Card title={t("documents.statements")} flush>
    {#snippet actions()}<FilePick label={t("common.add")} accept=".pdf,.csv,.json" multiple onpick={(f) => upload(f, "inbox")} />{/snippet}
    <Table columns={COLS} {rows} key={(r) => r.name} caption={t("documents.statements")}>
      {#snippet cell(r, c)}
        {#if c.key === "file"}
          {#if r.bad}<span class="pii text-bad" dir="auto">{r.name}</span>
          {:else}<a class="inline-flex items-center gap-2.5 text-ink hover:text-accent-ink" target="_blank" href={fileUrl(r.name)}><Icon name="file" size={15} class="shrink-0 text-sub" /><span class="pii" dir="auto">{r.name}</span></a>{/if}
        {:else if c.key === "covers"}
          {#if r.bad}<span class="text-[13px] whitespace-normal text-bad">{t("documents.unreadable")}</span>
          {:else}
            {@const cs = checksOf(r.name)}
            <span class="text-sub">{#if cs.length}<span class="num">{mdy(cs[0]!.period[0])} – {mdy(cs[0]!.period[1])}</span>{#if cs.length > 1} · {t("documents.accounts", { n: cs.length })}{/if}{:else}—{/if}</span>
          {/if}
        {:else if !r.bad}{countOf(r.name)}{/if}
      {/snippet}
      {#snippet empty()}<EmptyState compact icon="upload" title={t("documents.noStatements")} text={t(us ? "documents.noStatementsUS" : "documents.noStatementsIL")} />{/snippet}
    </Table>
  </Card>

  <Card title={t("documents.forYear", { year: S.year })} flush>
    {#snippet actions()}
      <Select variant="pill" icon="calendar" label={t("settings.year")} value={String(S.year)} onchange={(v) => (S.year = +v)} options={years} />
      <FilePick label={t("common.add")} accept=".pdf" multiple onpick={(f) => upload(f, "proofs")} />
    {/snippet}
    <ul class="divide-y divide-line border-t border-line">
      {#each NEEDED as n (n.label)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
          <span class={["shrink-0", n.ok ? "text-good" : "text-warn"]}><Icon name={n.ok ? "check" : "alert"} size={16} /></span>
          <span class="min-w-0 flex-1 basis-56 text-[14px] text-ink">{n.label}</span>
          <span class="flex flex-wrap items-center gap-2 text-[13px] text-sub"><Badge size="sm" tone={n.ok ? "good" : "warn"}>{t(n.ok ? "documents.attached" : "documents.missing")}</Badge>{n.why}</span>
        </li>
      {/each}
      {#each proofs as name (name)}
        <li class="px-4 py-3 sm:px-5">
          <a class="inline-flex max-w-full items-center gap-2.5 text-[14px] text-ink hover:text-accent-ink" target="_blank" href={proofUrl(name)}><Icon name="file" size={15} class="shrink-0 text-sub" /><span class="pii min-w-0 [overflow-wrap:anywhere]" dir="auto">{name.replace(/\.pdf$/i, "")}</span></a>
        </li>
      {/each}
    </ul>
    {#if !proofs.length}<p class="px-4 py-5 text-[14px] text-sub sm:px-5">{t("documents.noneFiled", { year: S.year })}</p>{/if}
  </Card>
</div>
