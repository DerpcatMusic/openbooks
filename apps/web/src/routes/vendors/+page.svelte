<script lang="ts">
  // Vendors: who you buy from (accounts payable). Saved vendors with their defaults (expense account, payment terms) and what is
  // owed and paid to each; below, payees you paid from the bank who are not saved as vendors yet, one click to add them.
  // Data: docs "vendors" + "bills". Logic: ../bills/bills.ts.
  import { group, payers } from "@openbooks/core";
  import type { Txn } from "@openbooks/schema";
  import { S, doc, saveDoc, ent, isUS, allCats, catLabel, toast } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Button, Drawer, EmptyState, Icon, Input, Money, PageHeader, Search, Table } from "#lib/ui/index.ts";
  import type { Column } from "#lib/ui/index.ts";
  import CategorySelect from "#lib/txns/CategorySelect.svelte";
  import { byVendor, uid } from "../bills/bills.ts";
  import type { Bill, Vendor } from "../bills/bills.ts";

  const cur = $derived(ent().currency ?? (isUS() ? "USD" : "ILS"));
  const vendors = $derived(doc<Vendor[]>("vendors"));
  const bills = $derived(doc<Bill[]>("bills"));
  const termsLabel = (n = 30) => (n ? t("invoices.term.net", { n }) : t("invoices.term.now"));
  const EXPENSE = () => allCats().filter((c) => ["expense", "cogs"].includes(group(c)));

  // ---- list ----
  let q = $state("");
  type Row = { v: Vendor; owed: number; paid: number };
  const sums = $derived(byVendor(bills));
  const rows = $derived(
    vendors
      .filter((v) => !q.trim() || `${v.name} ${v.email ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
      .map((v): Row => ({ v, owed: sums.get(v.id)?.owed ?? 0, paid: sums.get(v.id)?.paid ?? 0 }))
      .sort((a, b) => a.v.name.localeCompare(b.v.name)),
  );
  const columns: Column<Row>[] = $derived([
    { key: "name", label: t("common.name"), class: "w-full max-w-0 min-w-36" },
    { key: "email", label: t("vendors.email") },
    { key: "account", label: t("bills.account") },
    { key: "terms", label: t("vendors.col.terms") },
    { key: "owed", label: t("vendors.col.owed"), numeric: true },
    { key: "paid", label: t("vendors.col.paid"), numeric: true },
    { key: "go", label: t("common.open"), hideLabel: true, class: "w-10" },
  ]);

  // ---- payees paid from the bank with no vendor yet (the counterparties' outgoing side) ----
  let showPayees = $state(true);
  const known = $derived(new Set(vendors.map((v) => v.name.trim().toLowerCase())));
  const payees = $derived(
    payers(($state.snapshot(S.data?.txns ?? []) as Txn[]).filter((x) => !x.category.startsWith("transfer:") && x.source !== "journal")).filter(
      (p) => p.out > 0 && !known.has(p.key.trim().toLowerCase()) && p.cats.some((c) => ["expense", "cogs", "ask"].includes(group(c))),
    ),
  );
  const addPayee = (p: (typeof payees)[number]) => saveDoc("vendors", [...vendors, { id: uid(), name: p.key, account: p.cats.find((c) => ["expense", "cogs"].includes(group(c))) ?? "" }]);

  // ---- editor ----
  let draft = $state<Vendor | null>(null),
    drawer = $state(false);
  const saved = $derived(!!draft && vendors.some((v) => v.id === draft!.id));
  const hasBills = $derived(!!draft && bills.some((b) => b.vendor === draft!.id));
  const edit = (v?: Vendor) => {
    draft = v ? (structuredClone($state.snapshot(v)) as Vendor) : { id: uid(), name: "", email: "", address: "", account: "", terms: 30 };
    drawer = true;
  };
  async function save() {
    if (!draft) return;
    const v = { ...($state.snapshot(draft) as Vendor), name: draft.name.trim() };
    if (!v.name) return toast(t("vendors.needName"));
    if (vendors.some((x) => x.id !== v.id && x.name.toLowerCase() === v.name.toLowerCase())) return toast(t("vendors.duplicate"));
    drawer = false;
    await saveDoc("vendors", saved ? vendors.map((x) => (x.id === v.id ? v : x)) : [...vendors, v]);
    toast(t("vendors.saved"));
  }
  async function remove() {
    if (!draft || hasBills) return;
    const id = draft.id;
    drawer = false;
    await saveDoc("vendors", vendors.filter((v) => v.id !== id));
  }
</script>

<PageHeader title={t("vendors.title")} sub={t("vendors.sub")}>
  {#snippet actions()}
    <Button variant="primary" icon="plus" onclick={() => edit()}>{t("vendors.new")}</Button>
  {/snippet}
</PageHeader>

<div class="px-4 sm:px-8">
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2 py-4">
    <span class="min-w-28 flex-1 text-[14px] whitespace-nowrap text-sub"><span class="num">{rows.length}</span></span>
    <Search bind:value={q} label={t("common.search")} class="w-full sm:w-64" />
  </div>
</div>

<div class="sm:px-8">
  <div class="panel overflow-hidden max-sm:rounded-none">
    {#if rows.length}
      <Table {columns} {rows} key={(r) => r.v.id} caption={t("vendors.list")} stack onrowclick={(r) => edit(r.v)} selected={(r) => drawer && draft?.id === r.v.id}>
        {#snippet cell(r, c)}
          {#if c.key === "name"}
            <span class="block truncate text-ink" dir="auto">{r.v.name}</span>
          {:else if c.key === "email"}
            <span class="text-sub" dir="ltr">{r.v.email ?? ""}</span>
          {:else if c.key === "account"}
            <span class="text-sub">{r.v.account ? catLabel(r.v.account) : ""}</span>
          {:else if c.key === "terms"}
            <span class="text-sub">{termsLabel(r.v.terms)}</span>
          {:else if c.key === "owed"}
            <Money value={r.owed} currency={cur} class={r.owed ? "text-ink" : "text-faint"} />
          {:else if c.key === "paid"}
            <Money value={r.paid} currency={cur} class={r.paid ? "text-ink" : "text-faint"} />
          {:else}
            <Icon name="chevron-right" size={14} class="text-faint rtl:-scale-x-100" />
          {/if}
        {/snippet}
      </Table>
    {:else}
      <EmptyState icon="users" title={vendors.length ? t("vendors.empty.noMatch") : t("vendors.empty.nothing")} text={vendors.length ? "" : t("vendors.empty.text")}>
        {#if !vendors.length}<Button variant="primary" icon="plus" onclick={() => edit()}>{t("vendors.new")}</Button>{/if}
      </EmptyState>
    {/if}
  </div>
</div>

{#if payees.length}
  <div class="px-4 pt-8 sm:px-8">
    <section class="panel overflow-hidden">
      <button class="flex w-full items-center gap-3 px-4 py-4 text-start outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset sm:px-5" aria-expanded={showPayees} onclick={() => (showPayees = !showPayees)}>
        <span class="grid size-8 shrink-0 place-items-center rounded-full bg-accent/12 text-accent-ink"><Icon name="users" size={15} /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-[14px] text-ink">{t("vendors.payees.title", { n: payees.length })}</span>
          <span class="block text-[13px] text-sub">{t("vendors.payees.sub")}</span>
        </span>
        <Icon name={showPayees ? "chevron-down" : "chevron-right"} size={14} class="shrink-0 text-sub {showPayees ? '' : 'rtl:-scale-x-100'}" />
      </button>
      {#if showPayees}
        <ul class="divide-y divide-line border-t border-line">
          {#each payees.slice(0, 25) as p (p.key)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:px-5">
              <span class="min-w-0 flex-1 basis-40 truncate text-[14px] text-ink" dir="auto">{p.key}</span>
              <Money value={-p.out} currency={cur} class="text-ink" />
              <Button size="sm" onclick={() => addPayee(p)}>{t("vendors.payees.add")}</Button>
            </li>
          {/each}
          {#if payees.length > 25}<li class="px-4 py-2.5 text-[13px] text-sub sm:px-5">{t("vendors.payees.more", { n: payees.length - 25 })}</li>{/if}
        </ul>
      {/if}
    </section>
  </div>
{/if}

<Drawer bind:open={drawer} title={draft?.name || t("vendors.new")} width={440}>
  {#if draft}
    <div class="space-y-3 px-4 py-5 sm:px-5">
      <Input label={t("common.name")} bind:value={draft.name} placeholder={t("bills.vendorPh")} autocomplete="off" />
      <Input label={t("vendors.email")} bind:value={draft.email} type="email" dir="ltr" />
      <Input label={t("vendors.address")} bind:value={draft.address} />
      <div>
        <div class="mb-1 text-[13px] text-ink-2">{t("vendors.account")}</div>
        <CategorySelect value={draft.account ?? ""} onchange={(c) => (draft!.account = c)} suggestions={EXPENSE} label={t("vendors.account")} />
      </div>
      <div>
        <div class="mb-1 text-[13px] text-ink-2">{t("vendors.terms")}</div>
        <div class="flex flex-wrap gap-1.5" role="group" aria-label={t("vendors.terms")}>
          {#each [0, 15, 30, 45, 60] as n (n)}
            <Button size="sm" variant={(draft.terms ?? 30) === n ? "secondary" : "ghost"} aria-pressed={(draft.terms ?? 30) === n} onclick={() => (draft!.terms = n)}>{termsLabel(n)}</Button>
          {/each}
        </div>
      </div>
      {#if hasBills}<p class="text-[12px] text-sub">{t("vendors.hasBills")}</p>{/if}
    </div>
  {/if}
  {#snippet footer()}
    {#if saved && !hasBills}<Button variant="ghost" class="me-auto hover:text-bad" icon="trash" onclick={remove}>{t("common.delete")}</Button>{/if}
    <Button variant="primary" onclick={save}>{t("common.save")}</Button>
  {/snippet}
</Drawer>
