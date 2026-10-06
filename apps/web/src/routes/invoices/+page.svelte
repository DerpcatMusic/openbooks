<script lang="ts">
  // Invoices (US), bills / receipts (Israeli osek patur / zair: חשבון עסקה + קבלה, never חשבונית מס) and, for VAT-registered
  // Israeli books (osek murshe, ltd) in the issue year, חשבונית מס with VAT at that year's rate. Data: docs "invoices" + "customers".
  // Port of web/src/views/Invoices.svelte. Logic: ./invoices.ts. Printable document: ./[id]/doc.
  import { goto } from "#lib/nav.ts";
  import { payerOf } from "@openbooks/core";
  import { S, doc, saveDoc, ent, isUS, mdy, toast, bizType, taxTable } from "#lib/stores/books.svelte.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Drawer, EmptyState, Field, Icon, IconButton, Input, Money, PageHeader, Search, Segmented, Select, Stat, Switch, Table, Tabs } from "#lib/ui/index.ts";
  import type { Column, Tone } from "#lib/ui/index.ts";
  import type { Txn } from "@openbooks/schema";
  import { today, addDays, uid, total, net, vatOf, status, nextNumber, candidates, unmatched, kindsFor } from "./invoices.ts";
  import { vatRegistered } from "@openbooks/country-il";
  import type { Invoice, Customer, Kind, Status } from "./invoices.ts";

  const us = $derived(isUS());
  const cur = $derived(ent().currency ?? (us ? "USD" : "ILS"));
  const METHODS = ["העברה בנקאית", "ביט", "PayPal", "מזומן", "צ'ק", "כרטיס אשראי"];
  const STATUS: Record<Status, Tone> = { draft: "neutral", unpaid: "accent", overdue: "bad", paid: "good" };
  const kindLabel = (k: Kind) => t(`invoices.kind.${k}`);

  // VAT follows the business type in force in the document's year (an osek zair who became murshe in 2026 charges VAT from 2026).
  const yOf = (iso: string | null | undefined) => +(iso || today()).slice(0, 4);
  const registeredIn = (iso: string | null | undefined) => !us && vatRegistered(bizType(yOf(iso)));
  const rateIn = (iso: string | null | undefined) => (registeredIn(iso) ? Number(taxTable(yOf(iso)).vatRate ?? 0) : 0);
  const pct = (r: number) => String(Math.round(r * 1000) / 10);
  const registeredNow = $derived(registeredIn(today()));

  const invoices = $derived(doc<Invoice[]>("invoices"));
  const customers = $derived(doc<Customer[]>("customers"));
  const custOf = (inv: Invoice) => customers.find((c) => c.id === inv.customer);
  const nameOf = (inv: Invoice) => custOf(inv)?.name ?? "—";
  type Row = { inv: Invoice; st: Status; amt: number };
  const all = $derived(
    invoices
      .map((inv): Row => ({ inv, st: status(inv), amt: total(inv) }))
      .sort((a, b) => (b.inv.issued ?? "").localeCompare(a.inv.issued ?? "") || (b.inv.created ?? "").localeCompare(a.inv.created ?? "")),
  );

  // ---- stats ----
  const year = String(new Date().getFullYear());
  const sumOf = (rs: readonly Row[]) => rs.reduce((a, r) => a + r.amt, 0);
  const open = $derived(all.filter((r) => r.st === "unpaid" || r.st === "overdue"));
  const overdue = $derived(all.filter((r) => r.st === "overdue"));
  /** A bill / tax invoice and the receipt made from it point at the same payment: count it once. */
  const hasReceipt = (inv: Invoice) => invoices.some((x) => x.kind === "receipt" && x.status !== "draft" && x.ref === inv.number && (x.refKind ?? "bill") === inv.kind);
  const paidYear = $derived(all.filter((r) => r.st === "paid" && (r.inv.paidDate ?? r.inv.issued ?? "").startsWith(year) && !(r.inv.kind !== "receipt" && hasReceipt(r.inv))));

  // ---- list ----
  let tab = $state("all"),
    q = $state("");
  const count = (k: Status) => all.filter((r) => r.st === k).length;
  const TABS = $derived([{ key: "all", label: t("invoices.tab.all"), count: all.length }, ...(["draft", "unpaid", "overdue", "paid"] as const).map((k) => ({ key: k, label: t(`invoices.status.${k}`), count: count(k) }))]);
  const rows = $derived(
    all.filter(
      (r) =>
        (tab === "all" || r.st === tab) &&
        (!q || `${r.inv.number ?? ""} ${nameOf(r.inv)} ${r.inv.notes ?? ""} ${r.inv.items.map((i) => i.desc).join(" ")} ${r.amt}`.toLowerCase().includes(q.toLowerCase())),
    ),
  );
  const columns: Column<Row>[] = $derived([
    { key: "number", label: t("invoices.col.number") },
    { key: "customer", label: t("invoices.col.customer"), class: "w-full max-w-0 min-w-36" },
    { key: "issued", label: t("invoices.col.issued") },
    { key: "due", label: t("invoices.col.due") },
    { key: "amount", label: t("common.amount"), numeric: true },
    { key: "status", label: t("invoices.col.status") },
    { key: "go", label: t("common.open"), hideLabel: true, class: "w-10" },
  ]);

  // ---- editor ----
  let draft = $state<Invoice | null>(null),
    drawer = $state(false),
    custName = $state(""),
    custEmail = $state(""),
    custAddress = $state(""),
    paying = $state(false),
    paidOn = $state(today());
  const saved = $derived(!!draft && invoices.some((i) => i.id === draft!.id));
  const locked = $derived(!!draft && draft.status !== "draft"); // issued documents keep their content; only payment changes
  /** VAT on the open document: frozen once issued, else the issue year's rate (unless zero-rated). */
  const vatNow = $derived(!draft ? 0 : locked ? (draft.vat ?? 0) : draft.noVat ? 0 : rateIn(draft.issued));
  const kinds = $derived(draft ? (locked ? [draft.kind] : kindsFor(us, registeredIn(draft.issued))) : []);
  const dNet = $derived(draft ? net(draft) : 0);
  const dVat = $derived(draft ? vatOf({ items: draft.items, vat: vatNow }) : 0);
  const dTotal = $derived(draft ? total({ items: draft.items, vat: vatNow }) : 0);
  const showsVat = $derived(!!draft && (vatNow > 0 || (!locked && registeredIn(draft.issued)) || (locked && draft.vat !== undefined && draft.kind === "tax")));
  const taken = $derived(new Set(invoices.filter((i) => i.id !== draft?.id && !(draft?.kind === "receipt" && i.kind !== "receipt" && i.number === draft?.ref)).map((i) => i.paidTxn).filter((x): x is string => !!x)));
  const cands = $derived(draft && paying ? candidates({ ...draft, vat: vatNow }, S.data?.txns ?? [], taken, custName).slice(0, 8) : []);
  const paidTxn = $derived(draft?.paidTxn ? S.data?.txns.find((x) => x.id === draft!.paidTxn) : undefined);
  const who = (x: Txn) => x.who ?? payerOf(x);

  // A draft whose date moves into a year without VAT registration can't stay a חשבונית מס.
  $effect(() => {
    if (draft && !locked && !kinds.includes(draft.kind)) draft.kind = kinds[0]!;
  });

  function edit(inv: Invoice) {
    draft = structuredClone($state.snapshot(inv)) as Invoice;
    const c = custOf(inv);
    custName = c?.name ?? "";
    custEmail = c?.email ?? "";
    custAddress = c?.address ?? "";
    paying = false;
    paidOn = today();
    drawer = true;
  }
  function create({ customerName = "", ...over }: Partial<Invoice> & { customerName?: string } = {}) {
    const d = over.issued ?? today();
    const kind: Kind = us ? "invoice" : registeredIn(d) ? "tax" : "bill";
    edit({
      id: uid(), kind, number: null, customer: null, items: [{ desc: "", qty: 1, price: 0 }], issued: d, due: addDays(d, 30), currency: cur,
      notes: "", method: "", status: "draft", paidTxn: null, paidDate: null, ref: null, created: new Date().toISOString(), ...over,
    });
    if (customerName) custName = customerName;
  }
  function pickCustomer() {
    const c = customers.find((c) => c.name.toLowerCase() === custName.trim().toLowerCase());
    if (c) {
      custEmail = c.email ?? "";
      custAddress = c.address ?? "";
    }
  }
  function setKind(k: string) {
    if (!draft) return;
    draft.kind = k as Kind;
    if (k === "receipt") draft.method ||= METHODS[0];
  }

  async function save(next = draft) {
    if (!next) return;
    const name = custName.trim();
    if (name) {
      const c = customers.find((c) => c.name.toLowerCase() === name.toLowerCase());
      const rec = { ...(c ?? { id: uid() }), name, email: custEmail.trim(), address: custAddress.trim() };
      if (!c || c.name !== rec.name || (c.email ?? "") !== rec.email || (c.address ?? "") !== rec.address)
        await saveDoc("customers", c ? customers.map((x) => (x.id === c.id ? rec : x)) : [...customers, rec]);
      next.customer = rec.id;
    }
    if (next.status === "draft") {
      next.items = next.items.filter((i) => i.desc.trim() || +i.price);
      if (!next.items.length) next.items = [{ desc: "", qty: 1, price: 0 }];
      if (vatNow || registeredIn(next.issued)) next.vat = vatNow;
      else delete next.vat;
    }
    const v = $state.snapshot(next) as Invoice;
    await saveDoc("invoices", invoices.some((i) => i.id === v.id) ? invoices.map((i) => (i.id === v.id ? v : i)) : [...invoices, v]);
  }
  async function issue() {
    if (!draft) return;
    if (!custName.trim()) return toast(t("invoices.needCustomer"));
    if (!dTotal) return toast(t("invoices.needLine"));
    await save(); // freezes VAT and drops empty lines while still a draft
    draft.number = nextNumber(invoices, draft.kind);
    if (draft.kind === "receipt" || draft.paidTxn) {
      draft.status = "paid";
      draft.paidDate ??= draft.issued;
    } else draft.status = "open";
    await save();
    toast(t("invoices.issued", { doc: t(`invoices.doc.${draft.kind}`), number: draft.number }));
  }
  async function markPaid(x: Txn | null) {
    if (!draft) return;
    draft.status = "paid";
    draft.paidTxn = x?.id ?? null;
    draft.paidDate = x?.date ?? paidOn;
    paying = false;
    await save();
  }
  async function markUnpaid() {
    if (!draft) return;
    draft.status = "open";
    draft.paidTxn = null;
    draft.paidDate = null;
    await save();
  }
  async function remove() {
    if (!draft) return;
    const id = draft.id;
    drawer = false;
    await saveDoc("invoices", invoices.filter((i) => i.id !== id));
  }
  function receiptFrom(src: Invoice) {
    const c = customers.find((c) => c.id === src.customer);
    create({
      kind: "receipt", items: structuredClone($state.snapshot(src.items)), issued: src.paidDate ?? today(), due: null, paidTxn: src.paidTxn, paidDate: src.paidDate,
      ref: src.number, refKind: src.kind, method: METHODS[0], noVat: src.noVat, customerName: c?.name ?? "",
    });
    custEmail = c?.email ?? "";
    custAddress = c?.address ?? "";
  }
  function openTxn(id: string) {
    drawer = false;
    void goto("/transactions").then(() => (S.drawer = id));
  }

  // ---- payments with no invoice/receipt ----
  let showLoose = $state(false);
  const loose = $derived(unmatched((S.data?.txns ?? []).filter((x) => x.date.startsWith(year) || x.date.startsWith(String(+year - 1))), invoices, customers));
  function fromPayment({ t: x, customer }: { t: Txn; customer: Customer | null }) {
    const r = rateIn(x.date); // the bank amount includes VAT: back it out of the line price
    create({
      kind: us ? "invoice" : r ? "tax" : "receipt", items: [{ desc: us ? "" : x.desc, qty: 1, price: r ? Math.round((x.amount / (1 + r)) * 100) / 100 : x.amount }],
      issued: x.date, due: us || r ? x.date : null, paidTxn: x.id, paidDate: x.date, method: us ? "" : x.who ? "ביט" : METHODS[0], customerName: customer?.name ?? who(x),
    });
  }

  const title = $derived(us ? t("invoices.title.us") : registeredNow ? t("invoices.title.ilVat") : t("invoices.title.il"));
  const sub = $derived(us ? "" : registeredNow ? t("invoices.sub.ilVat") : t("invoices.sub.il"));
  const drawerTitle = $derived(draft ? `${kindLabel(draft.kind)}${draft.number ? ` ${draft.number}` : ""}` : "");
  const kindHint = $derived(!draft ? "" : draft.kind === "tax" ? t("invoices.taxHint") : draft.kind === "bill" ? t("invoices.billHint") : t("invoices.receiptHint"));
  const newMain = () => create();
  const TERMS = $derived([[t("invoices.term.now"), 0], [t("invoices.term.net", { n: 15 }), 15], [t("invoices.term.net", { n: 30 }), 30]] as [string, number][]);
</script>

<svelte:head><title>{title} · OpenBooks</title></svelte:head>

<PageHeader {title} {sub}>
  {#snippet actions()}
    {#if !us}<Button icon="plus" onclick={() => create({ kind: "receipt", due: null, method: METHODS[0] })}>{t("invoices.newReceipt")}</Button>{/if}
    <Button variant="primary" icon="plus" onclick={newMain}>{us ? t("invoices.newInvoice") : registeredNow ? t("invoices.newTax") : t("invoices.newBill")}</Button>
  {/snippet}
</PageHeader>

<div class="px-4 sm:px-8">
  <div class="panel mt-4 grid gap-6 p-5 sm:grid-cols-3 sm:p-6">
    <Stat label={t("invoices.outstanding")} value={sumOf(open)} currency={cur} hint={t("invoices.openN", { n: open.length })} />
    <Stat label={t("invoices.status.overdue")} value={sumOf(overdue)} currency={cur} class={overdue.length ? "[&_.display]:text-bad" : ""} hint={t("invoices.pastDueN", { n: overdue.length })} />
    <Stat label={t("invoices.paidIn", { year })} value={sumOf(paidYear)} currency={cur} hint={t("invoices.paidN", { n: paidYear.length })} />
  </div>

  <Tabs items={TABS} bind:value={tab} label={t("invoices.list")} class="mt-6" />
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
    <span class="min-w-0 flex-1 text-[14px] whitespace-nowrap text-sub"><span class="num">{rows.length}</span> · <Money value={sumOf(rows)} currency={cur} /></span>
    <Search bind:value={q} label={t("common.search")} class="w-full sm:w-64" />
  </div>
</div>

<div class="sm:px-8">
  <div class="panel overflow-hidden max-sm:rounded-none">
    {#if rows.length}
    <Table {columns} {rows} key={(r) => r.inv.id} caption={t("invoices.list")} onrowclick={(r) => edit(r.inv)} selected={(r) => drawer && draft?.id === r.inv.id}>
      {#snippet cell(r, c)}
        {#if c.key === "number"}
          <span class="inline-flex items-center gap-1.5">
            {#if r.inv.number}<span class="num text-ink">{r.inv.number}</span>{:else}<span class="text-faint">{t("invoices.status.draft")}</span>{/if}
            {#if !us}<span class="text-[12px] text-sub" lang="he">{t(`invoices.short.${r.inv.kind}`)}</span>{/if}
          </span>
        {:else if c.key === "customer"}
          <span class="block truncate text-ink" dir="auto">{nameOf(r.inv)}</span>
        {:else if c.key === "issued"}
          <span class="num text-sub">{r.inv.issued ? mdy(r.inv.issued) : ""}</span>
        {:else if c.key === "due"}
          <span class="num text-sub">{r.inv.due && r.inv.kind !== "receipt" ? mdy(r.inv.due) : ""}</span>
        {:else if c.key === "amount"}
          <Money value={r.amt} currency={cur} class="text-ink" />
        {:else if c.key === "status"}
          <Badge tone={STATUS[r.st]}>{t(`invoices.status.${r.st}`)}</Badge>
        {:else}
          <Icon name="chevron-right" size={14} class="text-faint rtl:-scale-x-100" />
        {/if}
      {/snippet}
    </Table>
    {:else}
        <EmptyState icon="file" title={all.length ? t("invoices.empty.nothing") : us ? t("invoices.empty.us") : t("invoices.empty.il")} text={all.length ? t("invoices.empty.noMatch") : us ? t("invoices.empty.usText") : t("invoices.empty.ilText")}>
          {#if !all.length}<Button variant="primary" icon="plus" onclick={newMain}>{us ? t("invoices.newInvoice") : registeredNow ? t("invoices.newTax") : t("invoices.newBill")}</Button>{/if}
        </EmptyState>
    {/if}
  </div>
</div>

{#if loose.length}
  <div class="px-4 pt-8 sm:px-8">
    <section class="panel overflow-hidden">
      <button class="flex w-full items-center gap-3 px-4 py-4 text-start outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset sm:px-5" aria-expanded={showLoose} onclick={() => (showLoose = !showLoose)}>
        <span class="grid size-8 shrink-0 place-items-center rounded-full bg-warn/15 text-warn"><Icon name="alert" size={15} /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-[14px] text-ink">{t(us ? "invoices.loose.us" : "invoices.loose.il", { n: loose.length })}</span>
          <span class="block text-[13px] text-sub">{t("invoices.loose.fromCustomer", { n: loose.filter((l) => l.customer).length })} {us ? "" : t("invoices.loose.ilNote")}</span>
        </span>
        <Icon name={showLoose ? "chevron-down" : "chevron-right"} size={14} class="shrink-0 text-sub {showLoose ? '' : 'rtl:-scale-x-100'}" />
      </button>
      {#if showLoose}
        <ul class="divide-y divide-line border-t border-line">
          {#each loose.slice(0, 25) as l (l.t.id)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:px-5">
              <span class="num w-28 shrink-0 text-[14px] text-sub">{mdy(l.t.date)}</span>
              <span class="min-w-0 flex-1 basis-40 text-[14px]">
                <span class="block truncate text-ink" dir="auto">{who(l.t)}</span>
                {#if l.customer}<span class="block truncate text-[12px] text-accent-ink" dir="auto">{l.customer.name}</span>{/if}
              </span>
              <Money value={l.t.amount} currency={cur} class="text-good" />
              <Button size="sm" onclick={() => fromPayment(l)}>{us ? t("invoices.createInvoice") : t("invoices.createReceipt")}</Button>
            </li>
          {/each}
          {#if loose.length > 25}<li class="px-4 py-2.5 text-[13px] text-sub sm:px-5">{t("invoices.loose.more", { n: loose.length - 25 })}</li>{/if}
        </ul>
      {/if}
    </section>
  </div>
{/if}

<Drawer bind:open={drawer} title={drawerTitle} width={480}>
  {#snippet actions()}
    {#if saved && draft}<Button size="sm" icon="printer" href="/invoices/{draft.id}/doc?e={encodeURIComponent(S.e)}" target="_blank">{t("invoices.printPdf")}</Button>{/if}
  {/snippet}
  {#if draft}
    {@const st = status(draft)}
    <div class="px-4 py-5 sm:px-5">
      <div class="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS[st]}>{t(`invoices.status.${st}`)}</Badge>
        {#if draft.ref}<span class="text-[13px] text-sub">{t("invoices.forDoc", { doc: t(`invoices.doc.${draft.refKind ?? "bill"}`), ref: draft.ref })}</span>{/if}
      </div>
      <div class="display mt-2 text-[32px] leading-10"><Money value={dTotal} currency={cur} class="text-ink" /></div>
      <div class="text-[13px] text-sub">
        {draft.currency ?? cur}{#if us}{:else if vatNow}{` · ${t("invoices.inclVat", { rate: pct(vatNow) })}`}{:else if !showsVat}{` · ${t("invoices.noVat")}`}{/if}
      </div>
    </div>

    {#if kinds.length > 1}
      <div class="border-t border-line px-4 py-4 sm:px-5">
        <Segmented label={t("invoices.document")} items={kinds.map((k) => ({ key: k, label: kindLabel(k) }))} value={draft.kind} onchange={setKind} size="sm" />
        <p class="mt-2 text-[12px] text-sub">{kindHint}</p>
      </div>
    {/if}

    <div class="space-y-3 border-t border-line px-4 py-4 sm:px-5">
      <Input label={t("invoices.col.customer")} bind:value={custName} oninput={pickCustomer} disabled={locked} list="ob-customers" placeholder={t("invoices.customerPh")} autocomplete="off" />
      <datalist id="ob-customers">{#each customers as c (c.id)}<option value={c.name}></option>{/each}</datalist>
      <div class="grid gap-3 sm:grid-cols-2">
        <Input label={t("invoices.email")} bind:value={custEmail} disabled={locked} type="email" dir="ltr" />
        <Input label={us ? t("invoices.address") : t("invoices.addressId")} bind:value={custAddress} disabled={locked} />
      </div>
    </div>

    <div class="border-t border-line px-4 py-4 sm:px-5">
      <div class="text-[13px] text-ink-2">{t("invoices.lines")}</div>
      {#each draft.items as it, i (i)}
        <div class="mt-2 grid grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_2rem] items-end gap-2">
          <Input label={t("common.description")} hideLabel={i > 0} bind:value={it.desc} disabled={locked} />
          <Input label={t("invoices.qty")} hideLabel={i > 0} bind:value={it.qty} disabled={locked} numeric type="number" min="0" step="any" />
          <Input label={t("invoices.unitPrice")} hideLabel={i > 0} bind:value={it.price} disabled={locked} numeric type="number" step="0.01" />
          {#if !locked && draft.items.length > 1}
            <IconButton icon="x" size="sm" class="mb-1 hover:text-bad" label={t("invoices.removeLine")} onclick={() => draft!.items.splice(i, 1)} />
          {:else}<span></span>{/if}
        </div>
      {/each}
      <div class="mt-3 flex flex-wrap items-center gap-2">
        {#if !locked}<Button size="sm" variant="ghost" icon="plus" onclick={() => draft!.items.push({ desc: "", qty: 1, price: 0 })}>{t("invoices.addLine")}</Button>{/if}
        <dl class="ms-auto grid grid-cols-[auto_auto] items-baseline gap-x-4 gap-y-1 text-end text-[13px]">
          {#if showsVat}
            <dt class="text-sub">{t("invoices.net")}</dt><dd><Money value={dNet} currency={cur} class="text-ink-2" /></dd>
            <dt class="text-sub">{t("invoices.vat", { rate: pct(vatNow) })}</dt><dd><Money value={dVat} currency={cur} class="text-ink-2" /></dd>
          {/if}
          <dt class="text-sub">{t("common.total")}</dt><dd><Money value={dTotal} currency={cur} class="text-[15px] text-ink" /></dd>
        </dl>
      </div>
      {#if !locked && registeredIn(draft.issued)}
        <Switch class="mt-4" label={t("invoices.zeroVat")} description={t("invoices.zeroVatHint")} checked={!!draft.noVat} onchange={(v) => (draft!.noVat = v || undefined)} />
      {/if}
    </div>

    <div class="grid gap-3 border-t border-line px-4 py-4 sm:grid-cols-2 sm:px-5">
      <Input label={draft.kind === "receipt" ? t("invoices.dateReceived") : t("invoices.issueDate")} type="date" bind:value={draft.issued} disabled={locked} />
      {#if draft.kind === "receipt"}
        <Select label={t("invoices.method")} bind:value={draft.method} disabled={locked} options={[...new Set([...METHODS, draft.method || METHODS[0]!])].map((m) => ({ value: m, label: m }))} />
      {:else}
        <Input label={t("invoices.dueDate")} type="date" bind:value={draft.due} disabled={locked} />
        {#if !locked}
          <div class="flex flex-wrap gap-1.5 sm:col-span-2" role="group" aria-label={t("invoices.dueTerms")}>
            {#each TERMS as [l, n] (n)}
              <Button size="sm" variant={draft.due === addDays(draft.issued, n) ? "secondary" : "ghost"} aria-pressed={draft.due === addDays(draft.issued, n)} onclick={() => (draft!.due = addDays(draft!.issued, n))}>{l}</Button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <div class="border-t border-line px-4 py-4 sm:px-5">
      <Field label={us ? t("invoices.notesUs") : t("common.notes")}>
        {#snippet children(a)}
          <textarea id={a.id} bind:value={draft!.notes} rows="3" dir="auto" class="w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-[14px] text-ink outline-none hover:border-ink/30 focus:ring-2 focus:ring-accent/50"></textarea>
        {/snippet}
      </Field>
    </div>

    {#if draft.status !== "draft" && draft.kind !== "receipt"}
      <div class="border-t border-line px-4 py-4 sm:px-5">
        <div class="text-[13px] text-ink-2">{t("invoices.payment")}</div>
        {#if draft.status === "paid"}
          <div class="mt-2 flex items-center gap-2 text-[14px]">
            <Icon name="check" size={16} class="shrink-0 text-good" />
            <span class="min-w-0 flex-1 truncate text-ink-2" dir="auto">{paidTxn ? t("invoices.paidFrom", { date: mdy(draft.paidDate ?? paidTxn.date), who: bidi(who(paidTxn)) }) : t("invoices.paidOutside", { date: mdy(draft.paidDate ?? draft.issued) })}</span>
            {#if paidTxn}<Money value={paidTxn.amount} currency={cur} class="text-good" />{/if}
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            {#if paidTxn}<Button size="sm" onclick={() => openTxn(paidTxn.id)}>{t("invoices.openTxn")}</Button>{/if}
            {#if !us && !hasReceipt(draft)}<Button size="sm" variant="primary" onclick={() => receiptFrom(draft!)}>{t("invoices.receiptFromBill")}</Button>{/if}
            <Button size="sm" variant="ghost" onclick={markUnpaid}>{t("invoices.markUnpaid")}</Button>
          </div>
        {:else if paying}
          <p class="mt-1 text-[12px] text-sub">{t("invoices.candHint", { date: mdy(draft.issued) })}</p>
          <div class="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line">
            {#each cands as { t: tx, amountMatch, sim } (tx.id)}
              <button onclick={() => markPaid(tx)} class="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-start text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset">
                <span class="num w-24 shrink-0 text-sub">{mdy(tx.date)}</span>
                <span class="min-w-0 flex-1 basis-24 truncate text-ink-2" dir="auto">{who(tx)}</span>
                {#if amountMatch}<Badge tone="good" size="sm">{t("invoices.match.amount")}</Badge>{/if}
                {#if sim >= 0.5}<Badge tone="accent" size="sm">{t("invoices.match.payer")}</Badge>{/if}
                <Money value={tx.amount} currency={cur} class="text-ink" />
              </button>
            {:else}<div class="px-3 py-4 text-center text-[13px] text-sub">{t("invoices.noCands")}</div>{/each}
          </div>
          <div class="mt-3 flex flex-wrap items-end gap-2">
            <Input label={t("invoices.paidOn")} type="date" bind:value={paidOn} class="w-44" />
            <Button onclick={() => markPaid(null)}>{t("invoices.paidOther")}</Button>
            <span class="flex-1"></span>
            <Button variant="ghost" onclick={() => (paying = false)}>{t("common.cancel")}</Button>
          </div>
        {:else}
          <div class="mt-2"><Button variant="primary" icon="check" onclick={() => (paying = true)}>{t("invoices.markPaid")}</Button></div>
        {/if}
      </div>
    {/if}

    {#if draft.kind === "receipt" && paidTxn}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-4 py-4 text-[13px] text-sub sm:px-5">
        <span>{t("invoices.payment")}:</span>
        <span class="text-ink-2" dir="auto">{mdy(paidTxn.date)} · {who(paidTxn)}</span>
        <Money value={paidTxn.amount} currency={cur} class="text-good" />
      </div>
    {/if}
  {/if}
  {#snippet footer()}
    {#if draft}
      {#if draft.status === "draft"}
        {#if saved}<Button variant="ghost" class="me-auto hover:text-bad" icon="trash" onclick={remove}>{t("common.delete")}</Button>{/if}
        <Button onclick={() => save().then(() => toast(t("invoices.draftSaved")))}>{t("invoices.saveDraft")}</Button>
        <Button variant="primary" onclick={issue}>{t(`invoices.issue.${draft.kind}`)}</Button>
      {:else}
        <span class="me-auto self-center text-[12px] text-faint">{t("invoices.lockedHint")}</span>
        <Button onclick={() => save().then(() => toast(t("invoices.saved")))}>{t("invoices.saveNotes")}</Button>
      {/if}
    {/if}
  {/snippet}
</Drawer>
