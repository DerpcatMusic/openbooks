<script lang="ts">
  import { BASE } from "#lib/nav.ts";
  // Printable invoice / bill / receipt / tax invoice on an A4 sheet (/invoices/<id>/doc?e=<entity>; the shell drops the sidebar
  // for paths ending in /doc). Always paper-white whatever the app theme, and in the document's own language, not the UI's:
  // US invoices in English; Israeli documents in Hebrew (RTL, מקור/העתק) with an English version for customers abroad.
  // Exempt Israeli books (osek patur/zair) may not issue חשבונית מס and say so; VAT-registered ones show net, VAT and total.
  import { page } from "$app/state";
  import { S, doc, money, dmy, mdyEn, bizType } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { total, net, vatOf, status, lineTotal, type Invoice, type Customer } from "../../invoices.ts";
  import { vatRegistered } from "@openbooks/country-il";
  import { L, METHOD_EN } from "./doc.ts";

  let { params }: { params: { id: string } } = $props();
  const inv = $derived(doc<Invoice[]>("invoices").find((i) => i.id === params.id));
  const cust = $derived(inv && doc<Customer[]>("customers").find((c) => c.id === inv.customer));
  const p = $derived((S.data?.profile ?? {}) as Record<string, string | undefined>);
  const il = $derived(!!inv && inv.kind !== "invoice");
  let english = $state(page.url.searchParams.get("lang") === "en");
  const lg = $derived(il && !english ? "he" : "en");
  const l = $derived(L[lg]);
  let copy = $state(false); // first print to the customer is the מקור / original; the copy you keep is העתק / copy

  const cur = $derived(inv?.currency || S.data?.entity.currency || (il ? "ILS" : "USD"));
  const nf = $derived(new Intl.NumberFormat("en-US", { style: "currency", currency: cur, currencyDisplay: "narrowSymbol" }));
  const m = (n: number) => (cur === "ILS" ? `₪${money(n)}` : nf.format(n));
  const date = (iso: string) => (lg === "he" ? dmy(iso) : mdyEn(iso));

  const draft = $derived(inv?.status === "draft");
  const paid = $derived(!!inv && status(inv) === "paid");
  const vat = $derived(inv?.vat ?? 0);
  const registered = $derived(!!inv && il && vatRegistered(bizType(+inv.issued.slice(0, 4))));
  const showVat = $derived(registered && inv?.vat !== undefined);
  const company = $derived(!!inv && bizType(+inv.issued.slice(0, 4)) === "ltd");
  const title = $derived(inv ? l.kind[inv.kind] : "");
  const owner = $derived(il ? `${p.first ?? ""} ${p.last ?? ""}`.trim() || S.data?.entity.name || "" : (p.legalName ?? S.data?.entity.name ?? ""));
  const paidTxn = $derived(inv?.paidTxn ? S.data?.txns.find((x) => x.id === inv.paidTxn) : undefined);
  const method = $derived(inv ? inv.method || "העברה בנקאית" : "");
  const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
</script>

<svelte:head><title>{inv ? `${title} ${inv.number ?? l.draft}${cust ? ` — ${cust.name}` : ""}` : "OpenBooks"}</title></svelte:head>

<div class="bar no-print fixed end-4 top-4 z-10 flex flex-wrap justify-end gap-2">
  <a href="{BASE}/invoices?e={encodeURIComponent(S.e)}" class="tool">{t("invoiceDoc.back")}</a>
  {#if il}
    <button onclick={() => (english = !english)} class="tool">{english ? t("invoiceDoc.hebrew") : t("invoiceDoc.english")}</button>
    <button onclick={() => (copy = !copy)} class="tool">{copy ? t("invoiceDoc.showOriginal") : t("invoiceDoc.showCopy")}</button>
  {/if}
  <button onclick={() => print()} class="tool dark">{t("invoiceDoc.print")}</button>
</div>

{#if !S.data}
  <div class="inv-doc"></div>
{:else if !inv}
  <div class="inv-doc"><section class="sheet"><p>{t("invoiceDoc.notFound")}</p></section></div>
{:else}
  <div class="inv-doc" dir={lg === "he" ? "rtl" : "ltr"} lang={lg}>
    <section class="sheet">
      {#if draft}<div class="mark">{l.draft}</div>{:else if paid && !il}<div class="mark paid">{l.paidMark}</div>{/if}
      <div class="top">
        <div>
          <div class="biz"><bdi>{owner}</bdi></div>
          {#if il}
            <div>{company ? l.companyNo : registered ? l.murshe : l.patur} <span dir="ltr">{p.id ?? ""}</span></div>
            {#if p.business}<div dir="auto">{p.business}</div>{/if}
            {#if p.address}<div dir="auto">{p.address}</div>{/if}
            {#if p.phone}<div>{l.phone} <span dir="ltr">{p.phone}</span></div>{/if}
            {#if p.email}<div dir="ltr" class="start">{p.email}</div>{/if}
          {:else}
            {#if p.address}<div>{p.address}</div>{/if}
            {#if p.cityStateZip}<div>{p.cityStateZip}</div>{/if}
            {#if p.ein}<div>EIN {p.ein}</div>{/if}
          {/if}
        </div>
        <div class="end">
          {#if il}<div class="orig">{copy ? l.copy : l.original}</div>{/if}
          <h1>{title}</h1>
          <table class="meta"><tbody>
            <tr><td>{l.number}</td><td>{inv.number ?? "—"}</td></tr>
            <tr><td>{l.date}</td><td>{date(inv.issued)}</td></tr>
            {#if inv.due && inv.kind !== "receipt"}<tr><td>{l.due}</td><td>{date(inv.due)}</td></tr>{/if}
          </tbody></table>
        </div>
      </div>

      <div class="to">
        <div class="lbl">{l.to}</div>
        <div class="name"><bdi>{cust?.name ?? ""}</bdi></div>
        {#if cust?.address}<div dir="auto">{cust.address}</div>{/if}
        {#if cust?.email}<div dir="ltr" class="start">{cust.email}</div>{/if}
      </div>

      {#if inv.ref}<p>{l.forRef(l.kind[inv.refKind ?? "bill"], inv.ref)}</p>{/if}

      <table class="items">
        <thead><tr><th>{l.desc}</th><th class="n" style="width:46pt">{l.qty}</th><th class="n" style="width:80pt">{l.price}</th><th class="n" style="width:90pt">{l.amount}</th></tr></thead>
        <tbody>
          {#each inv.items as i, k (k)}<tr><td dir="auto">{i.desc}</td><td class="n">{i.qty}</td><td class="n">{m(+i.price || 0)}</td><td class="n">{m(lineTotal(i))}</td></tr>{/each}
        </tbody>
        <tfoot>
          {#if showVat}
            <tr class="sub"><td colspan="3">{l.net}</td><td class="n">{m(net(inv))}</td></tr>
            <tr class="sub"><td colspan="3">{l.vat} {pct(vat)}</td><td class="n">{m(vatOf(inv))}</td></tr>
          {/if}
          <tr class="grand"><td colspan="3">{inv.kind === "receipt" ? l.totalReceived : il ? l.totalDue : l.totalDueCur(cur)}</td><td class="n">{m(total(inv))}</td></tr>
        </tfoot>
      </table>

      {#if inv.kind === "receipt"}
        <table class="items pay">
          <thead><tr><th>{l.method}</th><th style="width:90pt">{l.date}</th><th class="n" style="width:90pt">{l.amount}</th></tr></thead>
          <tbody><tr><td dir="auto">{lg === "en" ? (METHOD_EN[method] ?? method) : method}{paidTxn?.who ? ` (${paidTxn.who})` : ""}</td><td>{date(inv.paidDate ?? inv.issued)}</td><td class="n">{m(total(inv))}</td></tr></tbody>
        </table>
      {:else if paid}
        <div class="due">{l.paidInFull(inv.paidDate ? date(inv.paidDate) : "")}</div>
      {:else if inv.due}
        <div class="due">{l.pay} <b>{m(total(inv))}</b> {l.by} <b>{date(inv.due)}</b>.</div>
      {/if}

      {#if inv.notes}<div class="notes" dir="auto"><div class="lbl">{l.notes}</div>{inv.notes}</div>{/if}

      {#if il}
        <div class="legal">
          {#if !registered}{l.exempt}{:else if showVat && !vat}{l.zeroRated}{/if}
          {#if inv.kind === "bill"}{registered ? l.billNotTax : l.billNotReceipt}{/if}
        </div>
        <div class="sign"><span>{l.sign}: ____________________</span><span><bdi>{owner}</bdi></span></div>
      {/if}
    </section>
  </div>
{/if}

<style>
  :global(html:has(.inv-doc)),
  :global(body:has(.inv-doc)) {
    background: #e9e9ec;
    color-scheme: light;
  }
  .tool {
    border-radius: 8px;
    background: #fff;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    color: #111;
    white-space: nowrap;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.14);
    outline: none;
  }
  .tool:focus-visible {
    box-shadow: 0 0 0 2px #fff, 0 0 0 4px #3b6cf6;
  }
  .tool.dark {
    background: #111;
    color: #fff;
  }
  .inv-doc {
    color: #111;
    font-size: 10.5pt;
    line-height: 1.5;
    padding: 72px 0 24px;
  }
  .inv-doc[dir="rtl"] {
    font-family: "Noto Sans Hebrew", Arial, sans-serif;
  }
  .sheet {
    position: relative;
    width: 210mm;
    max-width: 100%;
    min-height: 297mm;
    margin: 0 auto;
    padding: 20mm 18mm;
    background: #fff;
    box-shadow: 0 2px 16px rgb(0 0 0 / 0.08);
    overflow: hidden;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 14pt 24pt;
    padding-bottom: 14pt;
    border-bottom: 1.5pt solid #111;
    color: #333;
  }
  .biz {
    font-size: 14pt;
    font-weight: 700;
    color: #111;
    margin-bottom: 2pt;
  }
  .end {
    text-align: end;
    margin-inline-start: auto;
  }
  .start {
    text-align: start;
  }
  [dir="rtl"] .start {
    text-align: right;
  }
  h1 {
    font-size: 22pt;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: #111;
    margin-bottom: 6pt;
  }
  .orig {
    display: inline-block;
    border: 1pt solid #111;
    border-radius: 3pt;
    padding: 0 8pt;
    font-size: 9pt;
    font-weight: 700;
    margin-bottom: 6pt;
  }
  .meta {
    margin-inline-start: auto;
    border-collapse: collapse;
  }
  .meta td {
    padding: 1pt 0;
  }
  .meta td:first-child {
    color: #666;
    padding-inline-end: 14pt;
  }
  .meta td:last-child {
    font-variant-numeric: tabular-nums;
    color: #111;
  }
  .to {
    margin: 18pt 0 16pt;
    color: #333;
  }
  .lbl {
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #777;
    margin-bottom: 2pt;
  }
  [dir="rtl"] .lbl {
    text-transform: none;
    letter-spacing: 0;
    font-size: 9pt;
  }
  .name {
    font-size: 12pt;
    font-weight: 600;
    color: #111;
  }
  .items {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8pt;
  }
  .items th {
    font-size: 9pt;
    font-weight: 600;
    color: #555;
    text-align: start;
    border-bottom: 1pt solid #bbb;
    padding: 4pt 6pt;
  }
  .items td {
    border-bottom: 0.6pt solid #ddd;
    padding: 6pt;
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  .items .n {
    text-align: end;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  [dir="rtl"] .items .n {
    direction: ltr;
    text-align: left;
  }
  .items tfoot td {
    border-bottom: 0;
  }
  .items tfoot .sub td {
    color: #444;
    padding: 3pt 6pt;
  }
  .items tfoot .sub:first-child td {
    border-top: 1pt solid #bbb;
    padding-top: 6pt;
  }
  .items tfoot .grand td {
    border-top: 1.5pt solid #111;
    font-weight: 700;
    font-size: 12pt;
    padding-top: 8pt;
  }
  .pay {
    margin-top: 18pt;
  }
  .due {
    margin-top: 16pt;
  }
  .notes {
    margin-top: 16pt;
    white-space: pre-wrap;
    color: #333;
  }
  .legal {
    margin-top: 22pt;
    font-size: 9pt;
    color: #555;
  }
  .sign {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8pt 24pt;
    margin-top: 28pt;
  }
  .mark {
    position: absolute;
    top: 46%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-24deg);
    font-size: 96pt;
    font-weight: 800;
    color: rgb(0 0 0 / 0.05);
    pointer-events: none;
    letter-spacing: 0.1em;
    white-space: nowrap;
  }
  .mark.paid {
    color: rgb(24 133 84 / 0.09);
  }
  /* phones: the sheet keeps A4 proportions in print, but on screen it shrinks to the viewport */
  @media screen and (max-width: 820px) {
    .bar {
      position: static;
      justify-content: flex-start;
      padding: 12px 16px;
    }
    .inv-doc {
      padding: 0;
    }
    .sheet {
      min-height: 0;
      padding: 24px 16px;
      box-shadow: none;
    }
    .mark {
      font-size: 56pt;
    }
  }
  @page {
    size: A4;
    margin: 16mm 14mm;
  }
  @media print {
    .no-print {
      display: none;
    }
    /* privacy mode blurs names on screen; a printed document must stay legible */
    .inv-doc :global(*) {
      filter: none !important;
    }
    :global(html:has(.inv-doc)),
    :global(body:has(.inv-doc)) {
      background: #fff !important;
    }
    .inv-doc {
      padding: 0;
    }
    .sheet {
      width: auto;
      max-width: none;
      min-height: 0;
      padding: 0;
      box-shadow: none;
      overflow: visible;
    }
    .items tr {
      break-inside: avoid;
    }
  }
</style>
