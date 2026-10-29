<script lang="ts">
  // Uniform-structure files (מבנה אחיד, OPENFRMT 1.31) for a date range: INI.TXT + BKMVDATA.TXT (+ README.TXT) in one zip, to give your accountant
  // or the Tax Authority when it asks, and to check with the Authority's simulator. OpenBooks is not a registered program (registration with
  // the Tax Authority is a separate process OpenBooks has not done). Logic: country-il openfrmt.ts.
  import { iso88598, uniformDocs, uniformFiles, type CustomerDoc, type InvoiceDoc } from "@openbooks/country-il";
  import { zip } from "@openbooks/core";
  import { S, bizType, doc, ent, toast } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Card, EmptyState, Input, PageHeader } from "#lib/ui/index.ts";
  import { download, il, isIL, patchIl } from "#lib/filings.svelte.ts";

  const s = $derived(il());
  let from = $state(`${S.year}-01-01`),
    to = $state(`${S.year}-12-31`);
  $effect(() => {
    from = `${S.year}-01-01`;
    to = `${S.year}-12-31`;
  });
  const bad = $derived(!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from);
  const out = $derived.by(() => {
    if (bad || !s.vatId || !S.data) return null;
    const now = new Date();
    return uniformFiles({
      business: { vatId: s.vatId, name: ent().name ?? "" },
      taxYear: +to.slice(0, 4),
      from,
      to,
      generated: { date: now.toLocaleDateString("sv"), time: now.toLocaleTimeString("sv").slice(0, 5) },
      primaryId: Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => b % 10).join(""),
      currency: ent().currency ?? "ILS",
      docs: uniformDocs(doc<InvoiceDoc[]>("invoices") as never, doc<CustomerDoc[]>("customers"), (i) => ((i as { method?: string }).method === "ביט" ? "other" : "transfer")),
      rows: S.data.txns.map((x) => ({ id: x.id, date: x.date, amount: x.amount, desc: x.desc, account: x.account, category: x.category, source: x.source })),
    });
  });
  function get() {
    if (!out) return;
    const bytes = zip([
      { name: `${out.dir}/INI.TXT`, data: iso88598(out.ini) },
      { name: `${out.dir}/BKMVDATA.TXT`, data: iso88598(out.data) },
      { name: `${out.dir}/README.TXT`, data: iso88598(out.readme) },
    ]);
    download(`OPENFRMT-${from}_${to}.zip`, bytes as BlobPart, "application/zip");
    toast(t("uniform.downloaded"));
  }
</script>

<PageHeader title={t("uniform.title")} sub={t("uniform.sub")} />

<div class="space-y-6 px-4 py-4 sm:px-8">
  <div role="note" class="rounded-lg border border-warn/30 bg-warn/8 px-4 py-3 text-[13px] text-warn">{t("uniform.notRegistered")}</div>
  {#if !S.data || !isIL() || !bizType()}
    <EmptyState icon="download" title={t("filings.noType")} text={t("adv.ilOnly")} />
  {:else}
    <Card title={t("uniform.range")}>
      <div class="grid gap-3 sm:grid-cols-3">
        <Input label={t("uniform.from")} type="date" bind:value={from} />
        <Input label={t("uniform.to")} type="date" bind:value={to} />
        <Input label={t("filings.vatId")} value={s.vatId} dir="ltr" inputmode="numeric" placeholder="514290543" hint={t("uniform.idHint")} onchange={(e) => patchIl({ vatId: e.currentTarget.value.replace(/\D/g, "") })} />
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" icon="download" onclick={get} disabled={!out}>{t("uniform.download")}</Button>
        {#if bad}<span class="text-[13px] text-bad">{t("uniform.badRange")}</span>
        {:else if !s.vatId}<span class="text-[13px] text-sub">{t("uniform.needId")}</span>{/if}
      </div>
    </Card>

    {#if out}
      <Card title={t("uniform.summary")} description={out.dir}>
        <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-[14px] sm:grid-cols-4">
          {#each Object.entries(out.counts) as [k, n] (k)}
            <div><dt class="text-[12px] text-sub"><Badge size="sm">{k}</Badge> {t(`uniform.rec.${k}`)}</dt><dd class="num mt-1 text-[18px]">{n}</dd></div>
          {/each}
        </dl>
        {#each out.notes.slice(0, 6) as n (n)}<p class="mt-2 text-[13px] text-warn" dir="auto">{n}</p>{/each}
        {#if out.notes.length > 6}<p class="mt-2 text-[13px] text-sub">{t("uniform.moreNotes", { n: out.notes.length - 6 })}</p>{/if}
      </Card>
    {/if}

    <Card title={t("uniform.how")}>
      <ol class="list-decimal space-y-1.5 ps-5 text-[14px] text-ink-2">
        {#each [1, 2, 3, 4] as n (n)}<li>{t(`uniform.step.${n}`)}</li>{/each}
      </ol>
      <p class="mt-3 text-[12px] text-faint">{t("uniform.unverified")}</p>
    </Card>
  {/if}
</div>
