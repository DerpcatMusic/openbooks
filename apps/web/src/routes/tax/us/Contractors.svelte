<script lang="ts">
  // Form 1099-NEC: who you paid for services in the year, who needs a form, and the files to send. Logic: the US pack's contractors.ts
  // (card and PayPal/Venmo/Stripe payments are the payment company's 1099-K, corporations are exempt except legal services).
  // The IRS has no upload we can use without an account, so: a CSV for your e-file provider or IRIS, and the recipient copies (Copy B) as PDF.
  import { csv1099, dueOn, nec1099, pdfFor, type Row1099 } from "@openbooks/country-us";
  import { ent, fmt, mdy, taxTable, toast } from "#lib/stores/books.svelte.ts";
  import { bidi, t } from "#lib/i18n.svelte.ts";
  import { saveCsv } from "#lib/reports/download.ts";
  import { Badge, Button, Card, Money, Table, type Column } from "#lib/ui/index.ts";
  import { payerOf, usNow } from "#lib/ustax/books.ts";

  let { y }: { y: number } = $props();
  const cur = $derived(ent().currency ?? "USD");
  const rows = $derived(usNow(y).contractors);
  const toFile = $derived(rows.filter((r) => r.file));
  const payer = $derived(payerOf(y));
  const threshold = $derived((taxTable(y, "us") as { nec1099?: number }).nec1099 ?? 600);
  const form = $derived(pdfFor("1099-nec", y));
  const due = $derived(dueOn(y + 1, 1, 31));
  const payerGap = $derived(!payer.name || !payer.tin || !payer.address);
  const tone = (s: Row1099["status"]) => (s === "ready" ? "good" : s === "missing" ? "warn" : "neutral");

  const cols: Column<Row1099>[] = $derived([
    { key: "name", label: t("fus.nec.payee"), wrap: true },
    { key: "total", label: t("fus.nec.box1"), numeric: true },
    { key: "excluded", label: t("fus.nec.excluded"), numeric: true },
    { key: "status", label: t("fus.nec.status") },
    { key: "go", label: t("fus.nec.form"), hideLabel: true },
  ]);

  let busy = $state(false);
  async function pdf(list: readonly Row1099[], name: string) {
    busy = true;
    try {
      const irs = await import("./pdf.ts");
      irs.download(await irs.fill1099NEC(list.filter((r) => r.vendor).map((r) => nec1099(r, payer, y)), y), `${name}.pdf`);
    } catch (e) {
      toast(t("taxUS.fillError", { msg: bidi((e as Error).message) }));
    } finally {
      busy = false;
    }
  }
  const slug = (s: string) => s.replace(/\W+/g, "-");
</script>

<Card title={t("fus.nec.title", { y })} description={t("fus.nec.sub", { n: fmt(threshold), date: mdy(due) })} flush>
  {#snippet actions()}
    <Button size="sm" icon="download" disabled={!toFile.length} onclick={() => saveCsv(`1099-NEC-${y}`, csv1099(rows, payer, y))}>{t("fus.nec.csv")}</Button>
    <Button size="sm" variant="primary" icon="download" loading={busy} disabled={busy || !form || !toFile.some((r) => r.vendor)} onclick={() => pdf(toFile, `1099-NEC-${y}-copy-B`)}>{t("fus.nec.allPdf")}</Button>
  {/snippet}
  <Table columns={cols} rows={rows} key={(r) => r.vendor?.id ?? r.name} caption={t("fus.nec.title", { y })} stack>
    {#snippet cell(r, c)}
      {#if c.key === "name"}
        <span class="text-ink" dir="auto">{r.name}</span>
        {#if r.issues.length}<span class="mt-0.5 block text-[12px] text-sub">{r.issues.map((i) => t(`fus.nec.issue.${i}`)).join(" · ")}</span>{/if}
      {:else if c.key === "total"}<Money value={r.total} currency={cur} class={r.total ? "text-ink" : "text-faint"} />
      {:else if c.key === "excluded"}<Money value={r.excluded} currency={cur} class={r.excluded ? "text-sub" : "text-faint"} />
      {:else if c.key === "status"}<Badge size="sm" tone={tone(r.status)}>{t(`fus.nec.s.${r.status}`)}</Badge>
      {:else if r.file && r.vendor}
        <Button size="sm" disabled={busy || !form} onclick={() => pdf([r], `1099-NEC-${y}-${slug(r.name)}`)}>{t("fus.nec.pdf")}</Button>
      {:else if r.file}<Button size="sm" href="/vendors">{t("fus.nec.addVendor")}</Button>{/if}
    {/snippet}
    {#snippet empty()}<p class="px-4 py-4 text-[14px] text-sub sm:px-5">{t("fus.nec.none", { y })}</p>{/snippet}
  </Table>
  <ul class="space-y-1 border-t border-line px-4 py-3 text-[13px] text-sub sm:px-5">
    {#if payerGap}<li class="text-warn">{t("fus.nec.payerGap")}</li>{/if}
    {#if !form}<li>{t("fus.nec.noForm", { y })}</li>{/if}
    <li>{t("fus.nec.copyA")}</li>
    <li>{t("fus.nec.card")}</li>
  </ul>
</Card>
