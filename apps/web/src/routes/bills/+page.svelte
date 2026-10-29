<script lang="ts">
  // Bills (accounts payable): what you owe vendors, the mirror of Invoices. Filters (status, vendor, date), sortable columns, a
  // drawer to enter and edit a bill, and payment applications: an open bill lists the outgoing transactions that could pay it (the exact
  // fit first, then amount and vendor name) and takes them whole or in part, so a bill can be paid by several transactions and one
  // transaction can pay several bills. Paid, partially paid and overdue are derived from the payments; any can be unapplied.
  // Business spending no bill points at is hinted below, with the bill it fits when there is one.
  // Data: docs "bills" + "vendors". Logic: ./bills.ts.
  import { goto } from "#lib/nav.ts";
  import { page } from "$app/state";
  import { group, payerOf } from "@openbooks/core";
  import { S, doc, saveDoc, ent, isUS, allCats, mdy, toast, fmt } from "#lib/stores/books.svelte.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Drawer, EmptyState, Icon, IconButton, Input, Money, PageHeader, Search, Select, Stat, Table, Tabs } from "#lib/ui/index.ts";
  import type { Column, Tone } from "#lib/ui/index.ts";
  import CategorySelect from "#lib/txns/CategorySelect.svelte";
  import type { Txn } from "@openbooks/schema";
  import { addDays, amountDue, apply, applied, candidates, dueOf, isOverdue, lineAmount, nextNumber, paid, readBills, remaining, status, suggestBills, today, total, uid, unapply, unmatched } from "./bills.ts";
  import type { Bill, Status, Vendor } from "./bills.ts";

  const cur = $derived(ent().currency ?? (isUS() ? "USD" : "ILS"));
  const STATUS: Record<Status, Tone> = { draft: "neutral", open: "accent", partial: "warn", overdue: "bad", paid: "good", cancelled: "neutral" };
  const bills = $derived(readBills(doc("bills")));
  const vendors = $derived(doc<Vendor[]>("vendors"));
  const nameOf = (b: Bill) => vendors.find((v) => v.id === b.vendor)?.name ?? "—";
  const who = (x: Txn) => x.who ?? payerOf(x);
  const txnOf = (id: string | null) => (id ? S.data?.txns.find((x) => x.id === id) : undefined);
  /** Per transaction: how much the bills have taken of it. */
  const taken = $derived(applied(bills));

  type Row = { b: Bill; st: Status; vendor: string; amt: number; due: number; late: boolean };
  const all = $derived(bills.map((b): Row => ({ b, st: status(b), vendor: nameOf(b), amt: total(b), due: amountDue(b), late: isOverdue(b) })));

  // ---- stats ----
  const year = String(new Date().getFullYear());
  const sumDue = (rs: readonly Row[]) => rs.reduce((a, r) => a + r.due, 0);
  const owed = $derived(all.filter((r) => r.due));
  const overdue = $derived(all.filter((r) => r.late));
  const payYear = $derived(bills.flatMap((b) => b.payments).filter((p) => p.date.startsWith(year)));

  // ---- filters and sort ----
  let tab = $state("all"),
    vendorF = $state(""),
    from = $state(""),
    to = $state(""),
    q = $state(""),
    sort = $state<{ key: string; dir: "asc" | "desc" } | null>({ key: "date", dir: "desc" });
  const filtered = $derived(!!vendorF || !!from || !!to);
  /** The overdue tab holds every bill past due that still owes money, a partly paid one too. */
  const inTab = (r: Row, k: string) => (k === "all" ? true : k === "overdue" ? r.late : r.st === k);
  const TABS = $derived([
    { key: "all", label: t("bills.tab.all"), count: all.length },
    ...(["draft", "open", "partial", "overdue", "paid", "cancelled"] as const).map((k) => ({ key: k, label: t(`bills.status.${k}`), count: all.filter((r) => inTab(r, k)).length })),
  ]);
  const VENDORS = $derived([{ value: "", label: t("bills.filter.allVendors") }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]);
  const val = (r: Row, k: string): string | number =>
    k === "number" ? r.b.number : k === "vendor" ? r.vendor : k === "date" ? r.b.date : k === "dueDate" ? (r.b.due ?? "") : k === "status" ? r.st : k === "amount" ? r.amt : r.due;
  const rows = $derived.by(() => {
    const s = q.trim().toLowerCase();
    const out = all.filter(
      (r) =>
        inTab(r, tab) &&
        (!vendorF || r.b.vendor === vendorF) &&
        (!from || r.b.date >= from) &&
        (!to || r.b.date <= to) &&
        (!s || `${r.b.number} ${r.vendor} ${r.b.memo} ${r.b.lines.map((l) => l.desc).join(" ")} ${r.amt}`.toLowerCase().includes(s)),
    );
    if (!sort) return out;
    const { key, dir } = sort;
    return out.sort((x, y) => {
      const a = val(x, key),
        b = val(y, key);
      const c = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
      return dir === "asc" ? c : -c;
    });
  });
  const sortBy = (key: string) => (sort = { key, dir: sort?.key === key && sort.dir === "asc" ? "desc" : "asc" });
  const columns: Column<Row>[] = $derived([
    { key: "number", label: t("bills.col.number"), sortable: true },
    { key: "vendor", label: t("bills.col.vendor"), sortable: true, class: "w-full max-w-0 min-w-36" },
    { key: "date", label: t("common.date"), sortable: true },
    { key: "dueDate", label: t("bills.col.dueDate"), sortable: true },
    { key: "status", label: t("bills.col.status"), sortable: true },
    { key: "amount", label: t("common.amount"), numeric: true, sortable: true },
    { key: "due", label: t("bills.col.due"), numeric: true, sortable: true },
    { key: "go", label: t("common.open"), hideLabel: true, class: "w-10" },
  ]);

  // ---- editor ----
  let draft = $state<Bill | null>(null),
    drawer = $state(false),
    vName = $state(""),
    paidOn = $state(today()),
    applyAmt = $state<string | number>(""),
    outAmt = $state<string | number>("");
  const saved = $derived(!!draft && bills.some((b) => b.id === draft!.id));
  const locked = $derived(!!draft && draft.status === "cancelled"); // cancelled bills keep their content until reopened
  const dTotal = $derived(draft ? total(draft) : 0);
  const dPaid = $derived(draft ? paid(draft) : 0);
  const dDue = $derived(draft ? amountDue(draft) : 0);
  const cands = $derived(draft?.status === "open" && dDue > 0 ? candidates(draft, S.data?.txns ?? [], taken, vName).slice(0, 6) : []);
  const EXPENSE = () => allCats().filter((c) => ["expense", "cogs"].includes(group(c)));
  const TERMS = $derived([[t("invoices.term.now"), 0], [t("invoices.term.net", { n: 15 }), 15], [t("invoices.term.net", { n: 30 }), 30]] as [string, number][]);

  function edit(b: Bill) {
    draft = structuredClone($state.snapshot(b)) as Bill;
    vName = vendors.find((v) => v.id === b.vendor)?.name ?? "";
    paidOn = today();
    applyAmt = "";
    outAmt = "";
    drawer = true;
  }
  function create(over: Partial<Bill> = {}) {
    const date = over.date ?? today();
    edit({
      id: uid(), number: nextNumber(bills), vendor: null, date, due: dueOf(date), lines: [{ desc: "", amount: 0, account: "" }],
      status: "draft", payments: [], memo: "", created: new Date().toISOString(), ...over,
    });
  }
  // a link from a report (/bills?open=<id>) opens that bill once
  let opened = "";
  $effect(() => {
    const id = page.url.searchParams.get("open");
    const b = id && id !== opened ? bills.find((x) => x.id === id) : undefined;
    if (b) {
      opened = id!;
      edit(b);
    }
  });
  /** A known vendor's terms and default expense account fill a draft. */
  function pickVendor() {
    const v = vendors.find((x) => x.name.toLowerCase() === vName.trim().toLowerCase());
    if (!v || draft?.status !== "draft") return;
    draft.due = dueOf(draft.date, v);
    for (const l of draft.lines) l.account ||= v.account ?? "";
  }

  async function save(next = draft) {
    if (!next) return false;
    if (next.status !== "draft" && total(next) < paid(next)) {
      toast(t("bills.belowPaid", { paid: fmt(paid(next), 2) }));
      return false;
    }
    const name = vName.trim();
    let v = vendors.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (name && !v) {
      v = { id: uid(), name };
      await saveDoc("vendors", [...vendors, v]);
    }
    next.vendor = name ? v!.id : null;
    next.number = next.number.trim() || nextNumber(bills);
    if (next.status === "draft") {
      next.lines = next.lines.filter((l) => l.desc.trim() || lineAmount(l));
      if (!next.lines.length) next.lines = [{ desc: "", amount: 0, account: "" }];
    }
    const b = $state.snapshot(next) as Bill;
    await saveDoc("bills", bills.some((x) => x.id === b.id) ? bills.map((x) => (x.id === b.id ? b : x)) : [...bills, b]);
    return true;
  }
  async function approve() {
    if (!draft) return;
    if (!vName.trim()) return toast(t("bills.needVendor"));
    if (!dTotal) return toast(t("bills.needLine"));
    draft.status = "open"; // paid when the payments already cover it (Create bill from a payment)
    if (await save()) toast(t("bills.approved", { number: draft.number }));
    else draft.status = "draft";
  }
  /** Apply a transaction (whole or `applyAmt` of it) or, with x null, money paid outside the books on `paidOn`. */
  async function pay(x: Txn | null) {
    if (!draft) return;
    const want = +(x ? applyAmt : outAmt) || Infinity;
    const next = apply(draft, x, want, paidOn, taken, uid());
    if (next === draft.payments) return toast(t("bills.applyNone"));
    draft.payments = next;
    applyAmt = outAmt = "";
    await save();
  }
  /** Take one payment off the bill; the transaction is free for another bill again. */
  async function unapplyPayment(id: string) {
    if (!draft) return;
    draft.payments = unapply(draft, id);
    if (draft.status !== "draft") await save();
  }
  async function reopen() {
    if (!draft) return;
    draft.status = "open";
    await save();
  }
  async function cancelBill() {
    if (!draft || draft.payments.length) return;
    draft.status = "cancelled";
    await save();
  }
  async function remove() {
    if (!draft) return;
    const id = draft.id;
    drawer = false;
    await saveDoc("bills", bills.filter((b) => b.id !== id));
  }
  function openTxn(id: string) {
    drawer = false;
    void goto("/transactions").then(() => (S.drawer = id));
  }

  // ---- spending with no bill ----
  let showLoose = $state(false);
  const loose = $derived(unmatched((S.data?.txns ?? []).filter((x) => x.date.startsWith(year) || x.date.startsWith(String(+year - 1))), bills, vendors));
  function fromPayment({ t: x, vendor }: { t: Txn; vendor: Vendor | null }) {
    const left = remaining(x, taken);
    create({ date: x.date, due: null, payments: [{ id: uid(), txn: x.id, amount: left, date: x.date }], lines: [{ desc: who(x), amount: left, account: x.category === "ask" ? "" : x.category }] });
    vName = vendor?.name ?? who(x);
  }
  /** The payment settles a bill that already exists: apply it there. */
  async function applyTo(b: Bill, x: Txn) {
    const next = apply(b, x, Infinity, x.date, taken, uid());
    if (next === b.payments) return;
    await saveDoc("bills", bills.map((y) => (y.id === b.id ? { ...$state.snapshot(y), payments: next } : y)));
    toast(t("bills.appliedTo", { number: b.number }));
  }
</script>

<PageHeader title={t("bills.title")} sub={t("bills.sub")}>
  {#snippet actions()}
    <Button variant="primary" icon="plus" onclick={() => create()}>{t("bills.new")}</Button>
  {/snippet}
</PageHeader>

<div class="px-4 sm:px-8">
  <div class="panel mt-4 grid gap-6 p-5 sm:grid-cols-3 sm:p-6">
    <Stat label={t("bills.owed")} value={sumDue(owed)} currency={cur} hint={t("bills.openN", { n: owed.length })} />
    <Stat label={t("bills.status.overdue")} value={sumDue(overdue)} currency={cur} class={overdue.length ? "[&_.display]:text-bad" : ""} hint={t("bills.pastDueN", { n: overdue.length })} />
    <Stat label={t("bills.paidIn", { year })} value={payYear.reduce((a, p) => a + p.amount, 0)} currency={cur} hint={t("bills.paidN", { n: payYear.length })} />
  </div>

  <Tabs items={TABS} bind:value={tab} label={t("bills.list")} class="mt-6" />
  <div class="flex flex-wrap items-end gap-x-3 gap-y-2 py-3">
    <span class="min-w-28 flex-1 text-[14px] whitespace-nowrap text-sub"><span class="num">{rows.length}</span> · <Money value={rows.reduce((a, r) => a + r.amt, 0)} currency={cur} /></span>
    <Select label={t("bills.filter.vendor")} variant="pill" bind:value={vendorF} options={VENDORS} />
    <Input label={t("bills.filter.from")} type="date" bind:value={from} class="w-40" />
    <Input label={t("bills.filter.to")} type="date" bind:value={to} class="w-40" />
    {#if filtered}<Button variant="ghost" size="sm" onclick={() => ((vendorF = ""), (from = ""), (to = ""))}>{t("bills.filter.clear")}</Button>{/if}
    <Search bind:value={q} label={t("common.search")} class="w-full sm:w-56" />
  </div>
</div>

<div class="sm:px-8">
  <div class="panel overflow-hidden max-sm:rounded-none">
    {#if rows.length}
      <Table {columns} {rows} key={(r) => r.b.id} caption={t("bills.list")} {sort} onsort={sortBy} onrowclick={(r) => edit(r.b)} selected={(r) => drawer && draft?.id === r.b.id}>
        {#snippet cell(r, c)}
          {#if c.key === "number"}
            <span class="num text-ink">{r.b.number}</span>
          {:else if c.key === "vendor"}
            <span class="block truncate text-ink" dir="auto">{r.vendor}</span>
          {:else if c.key === "date"}
            <span class="num text-sub">{mdy(r.b.date)}</span>
          {:else if c.key === "dueDate"}
            <span class="num {r.late ? 'text-bad' : 'text-sub'}">{r.b.due ? mdy(r.b.due) : ""}</span>
          {:else if c.key === "status"}
            <Badge tone={STATUS[r.st]}>{t(`bills.status.${r.st}`)}</Badge>
          {:else if c.key === "amount"}
            <Money value={r.amt} currency={cur} class="text-ink" />
          {:else if c.key === "due"}
            <Money value={r.due} currency={cur} class={r.due ? "text-ink" : "text-faint"} />
          {:else}
            <Icon name="chevron-right" size={14} class="text-faint rtl:-scale-x-100" />
          {/if}
        {/snippet}
      </Table>
    {:else}
      <EmptyState icon="calendar" title={all.length ? t("bills.empty.noMatch") : t("bills.empty.nothing")} text={all.length ? t("bills.empty.noMatchText") : t("bills.empty.text")}>
        {#if !all.length}<Button variant="primary" icon="plus" onclick={() => create()}>{t("bills.new")}</Button>{/if}
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
          <span class="block text-[14px] text-ink">{t("bills.unmatched.title", { n: loose.length })}</span>
          <span class="block text-[13px] text-sub">{t("bills.unmatched.sub")}</span>
        </span>
        <Icon name={showLoose ? "chevron-down" : "chevron-right"} size={14} class="shrink-0 text-sub {showLoose ? '' : 'rtl:-scale-x-100'}" />
      </button>
      {#if showLoose}
        <ul class="divide-y divide-line border-t border-line">
          {#each loose.slice(0, 25) as l (l.t.id)}
            {@const fit = suggestBills(l.t, bills, taken)[0]}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:px-5">
              <span class="num w-28 shrink-0 text-[14px] text-sub">{mdy(l.t.date)}</span>
              <span class="min-w-0 flex-1 basis-40 text-[14px]">
                <span class="block truncate text-ink" dir="auto">{who(l.t)}</span>
                {#if l.vendor}<span class="block truncate text-[12px] text-accent-ink" dir="auto">{l.vendor.name}</span>{/if}
              </span>
              <Money value={-remaining(l.t, taken)} currency={cur} class="text-ink" />
              {#if fit}<Button size="sm" variant="primary" onclick={() => applyTo(fit, l.t)}>{t("bills.applyToBill", { number: fit.number })}</Button>{/if}
              <Button size="sm" onclick={() => fromPayment(l)}>{t("bills.createFromPayment")}</Button>
            </li>
          {/each}
          {#if loose.length > 25}<li class="px-4 py-2.5 text-[13px] text-sub sm:px-5">{t("bills.unmatched.more", { n: loose.length - 25 })}</li>{/if}
        </ul>
      {/if}
    </section>
  </div>
{/if}

<Drawer bind:open={drawer} title={draft?.number ?? ""} width={480}>
  {#if draft}
    {@const st = status(draft)}
    <div class="px-4 py-5 sm:px-5">
      <Badge tone={STATUS[st]}>{t(`bills.status.${st}`)}</Badge>
      {#if st === "overdue" || (st === "partial" && isOverdue(draft))}<Badge tone="bad" class="ms-1.5">{t("bills.status.overdue")}</Badge>{/if}
      <div class="display mt-2 text-[32px] leading-10"><Money value={dTotal} currency={cur} class="text-ink" /></div>
      {#if dPaid && draft.status !== "draft"}
        <dl class="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
          <div class="flex items-baseline gap-1.5"><dt class="text-sub">{t("bills.paidSoFar")}</dt><dd><Money value={dPaid} currency={cur} class="text-good" /></dd></div>
          <div class="flex items-baseline gap-1.5"><dt class="text-sub">{t("bills.col.due")}</dt><dd><Money value={dDue} currency={cur} class="text-ink" /></dd></div>
        </dl>
      {/if}
    </div>

    <div class="space-y-3 border-t border-line px-4 py-4 sm:px-5">
      <Input label={t("bills.col.vendor")} bind:value={vName} oninput={pickVendor} disabled={locked} list="ob-vendors" placeholder={t("bills.vendorPh")} autocomplete="off" />
      <datalist id="ob-vendors">{#each vendors as v (v.id)}<option value={v.name}></option>{/each}</datalist>
      <div class="grid gap-3 sm:grid-cols-2">
        <Input label={t("bills.number")} bind:value={draft.number} disabled={locked} dir="ltr" />
        <Input label={t("bills.date")} type="date" bind:value={draft.date} disabled={locked} />
        <Input label={t("bills.dueDate")} type="date" bind:value={draft.due} disabled={locked} />
        {#if !locked}
          <div class="flex flex-wrap items-end gap-1.5" role="group" aria-label={t("bills.terms")}>
            {#each TERMS as [l, n] (n)}
              <Button size="sm" variant={draft.due === addDays(draft.date, n) ? "secondary" : "ghost"} aria-pressed={draft.due === addDays(draft.date, n)} onclick={() => (draft!.due = addDays(draft!.date, n))}>{l}</Button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="border-t border-line px-4 py-4 sm:px-5">
      <div class="text-[13px] text-ink-2">{t("bills.lines")}</div>
      {#each draft.lines as l, i (i)}
        <div class="mt-2 grid grid-cols-[minmax(0,1fr)_6.5rem_2rem] items-end gap-2">
          <Input label={t("common.description")} hideLabel={i > 0} bind:value={l.desc} disabled={locked} />
          <Input label={t("common.amount")} hideLabel={i > 0} bind:value={l.amount} disabled={locked} numeric type="number" min="0" step="0.01" />
          {#if !locked && draft.lines.length > 1}
            <IconButton icon="x" size="sm" class="mb-1 hover:text-bad" label={t("bills.removeLine")} onclick={() => draft!.lines.splice(i, 1)} />
          {:else}<span></span>{/if}
        </div>
        <div class="mt-1 ps-1"><CategorySelect value={l.account} onchange={(c) => (l.account = c)} suggestions={EXPENSE} placeholder={t("bills.account")} label={t("bills.account")} disabled={locked} /></div>
      {/each}
      <div class="mt-3 flex flex-wrap items-center gap-2">
        {#if !locked}<Button size="sm" variant="ghost" icon="plus" onclick={() => draft!.lines.push({ desc: "", amount: 0, account: "" })}>{t("bills.addLine")}</Button>{/if}
        <dl class="ms-auto grid grid-cols-[auto_auto] items-baseline gap-x-4 text-end text-[13px]">
          <dt class="text-sub">{t("common.total")}</dt><dd><Money value={dTotal} currency={cur} class="text-[15px] text-ink" /></dd>
        </dl>
      </div>
    </div>

    <div class="border-t border-line px-4 py-4 sm:px-5">
      <label class="block text-[13px] text-ink-2" for="ob-bill-memo">{t("bills.memo")}</label>
      <textarea id="ob-bill-memo" bind:value={draft.memo} rows="3" dir="auto" disabled={locked} class="mt-1 w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-[14px] text-ink outline-none hover:border-ink/30 focus:ring-2 focus:ring-accent/50 disabled:opacity-50"></textarea>
    </div>

    {#if draft.payments.length}
      <div class="border-t border-line px-4 py-4 sm:px-5">
        <div class="text-[13px] text-ink-2">{t("bills.payments")}</div>
        <ul class="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line">
          {#each draft.payments as p (p.id)}
            {@const tx = txnOf(p.txn)}
            <li class="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-[13px]">
              <Icon name="check" size={14} class="shrink-0 text-good" />
              <span class="num w-24 shrink-0 text-sub">{mdy(p.date)}</span>
              <span class="min-w-0 flex-1 basis-24 truncate text-ink-2" dir="auto">{tx ? who(tx) : t("bills.paidOutsideShort")}</span>
              <Money value={p.amount} currency={cur} class="text-ink" />
              {#if tx}<Button size="sm" variant="ghost" onclick={() => openTxn(tx.id)}>{t("bills.openTxn")}</Button>{/if}
              {#if !locked}<Button size="sm" variant="ghost" onclick={() => unapplyPayment(p.id)}>{t("bills.unapply")}</Button>{/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if draft.status === "open" && dDue > 0}
      <div class="border-t border-line px-4 py-4 sm:px-5">
        <div class="text-[13px] text-ink-2">{t("bills.payment")}</div>
        <p class="mt-1 text-[12px] text-sub">{t("bills.suggestHint", { date: mdy(draft.date) })}</p>
        <Input label={t("bills.applyAmount")} hint={t("bills.applyHint", { amount: fmt(dDue, 2) })} bind:value={applyAmt} numeric type="number" min="0" step="0.01" class="mt-2 w-44" />
        <div class="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line">
          {#each cands as { t: tx, left, exact, amountMatch, sim } (tx.id)}
            <button onclick={() => pay(tx)} class="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-start text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset">
              <span class="num w-24 shrink-0 text-sub">{mdy(tx.date)}</span>
              <span class="min-w-0 flex-1 basis-24 truncate text-ink-2" dir="auto">{who(tx)}</span>
              {#if exact}<Badge tone="good" size="sm">{t("bills.match.exact")}</Badge>{:else if amountMatch}<Badge tone="good" size="sm">{t("bills.match.amount")}</Badge>{/if}
              {#if sim >= 0.5}<Badge tone="accent" size="sm">{t("bills.match.payer")}</Badge>{/if}
              <span class="flex flex-col items-end">
                <Money value={tx.amount} currency={cur} class="text-ink" />
                {#if left < -tx.amount}<span class="text-[11px] text-sub">{t("bills.leftOfPayment", { amount: fmt(left, 2) })}</span>{/if}
              </span>
            </button>
          {:else}<div class="px-3 py-4 text-center text-[13px] text-sub">{t("bills.noCands")}</div>{/each}
        </div>
        <div class="mt-3 flex flex-wrap items-end gap-2">
          <Input label={t("bills.paidOn")} type="date" bind:value={paidOn} class="w-44" />
          <Input label={t("bills.paidAmount")} bind:value={outAmt} numeric type="number" min="0" step="0.01" placeholder={String(dDue)} class="w-36" />
          <Button onclick={() => pay(null)}>{t("bills.paidOther")}</Button>
        </div>
      </div>
    {/if}
  {/if}
  {#snippet footer()}
    {#if draft}
      {#if draft.status === "draft"}
        {#if saved}<Button variant="ghost" class="me-auto hover:text-bad" icon="trash" onclick={remove}>{t("common.delete")}</Button>{/if}
        <Button onclick={() => save().then((ok) => ok && toast(t("bills.draftSaved")))}>{t("bills.saveDraft")}</Button>
        <Button variant="primary" onclick={approve}>{t("bills.approve")}</Button>
      {:else if draft.status === "open"}
        <Button variant="ghost" class="me-auto hover:text-bad" disabled={draft.payments.length > 0} title={draft.payments.length ? t("bills.cancelBlocked") : undefined} onclick={cancelBill}>{t("bills.cancel")}</Button>
        <Button onclick={() => save().then((ok) => ok && toast(t("bills.saved")))}>{t("common.save")}</Button>
      {:else}
        <span class="me-auto self-center text-[12px] text-faint">{t("bills.lockedHint")}</span>
        <Button onclick={() => reopen()}>{t("bills.reopen")}</Button>
      {/if}
    {/if}
  {/snippet}
</Drawer>
