<script lang="ts">
  // Chart of accounts (port of web/src/views/Accounts.svelte): the bank/card accounts that feed the books with their statement
  // reconciliation, then the chart: every account with its ledger code, type, subtype and normal side, its activity in the period
  // (click the amount to drill in). Click a row to edit it (name, code, subtype, archive); add accounts; filter; export CSV.
  // The ids ("type:slug") never change; the edits are an overlay in the "coa" doc (books.svelte.ts).
  import { isCard, type CoaRow, type Klass } from "@openbooks/core";
  import { S, ent, isUS, balances, accounts, chart, isBank, rowName, typeLabel, periodTxns, periodLabel, fmt, mdy } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Card, EmptyState, Icon, IconButton, Money, PageHeader, Search, Select, Table, Tabs, type Column } from "#lib/ui/index.ts";
  import { go } from "#lib/reports/go.ts";
  import { saveCsv } from "#lib/reports/download.ts";
  import { csv } from "#lib/reports/statements.ts";
  import PeriodPicker from "#lib/reports/PeriodPicker.svelte";
  import AccountDialog from "#lib/coa/AccountDialog.svelte";

  const us = $derived(isUS());
  const cur = $derived(ent().currency ?? "USD");
  const ts = $derived(periodTxns());
  const txns = $derived(S.data!.txns);
  const bal = $derived(balances(txns.at(-1)?.date ?? ""));

  // bank and card accounts: statements with a total to reconcile, then accounts seen only in exports
  type Bank = { key: string; label: string; from?: string; to?: string; value: number; off: number | null };
  const banks = $derived<Bank[]>([
    ...S.data!.checks.map((c, i) => ({ key: `c${i}`, label: c.label, from: c.period[0], to: c.period[1], value: c.total, off: c.total - c.parsed })),
    ...accounts()
      .filter((a) => !S.data!.checks.some((c) => c.label.startsWith(a)))
      .map((a) => ({ key: `a:${a}`, label: a, value: us ? (bal[a] ?? 0) : txns.filter((x) => x.account === a).reduce((s, x) => s + x.amount, 0), off: null })),
  ]);
  const bankCols = $derived<Column<Bank>[]>([
    { key: "label", label: t("common.account") },
    { key: "value", label: us ? t("accounts.balance") : t("common.moneyIn"), numeric: true },
    { key: "rec", label: t("accounts.reconciliation") },
    { key: "period", label: t("accounts.period") },
  ]);

  // the chart: every account with its code, class and activity in the period; tabs by class, search and status filters
  const TABS = ["all", "assets", "liabilities", "equity", "revenues", "expenses"] as const;
  const KLASS: Record<string, Klass> = { assets: "asset", liabilities: "liability", equity: "equity", revenues: "revenue", expenses: "expense" };
  type Acct = CoaRow & { label: string; sub: string; n: number; v: number };
  let tab = $state("all"),
    q = $state(""),
    status = $state("active"),
    editing = $state<CoaRow | null>(null),
    dialog = $state(false);
  const activity = $derived.by(() => {
    const m = new Map<string, { n: number; v: number }>();
    for (const x of ts)
      for (const k of [x.category, x.account]) {
        const a = m.get(k) ?? { n: 0, v: 0 };
        (a.n++, (a.v += x.amount), m.set(k, a));
      }
    return m;
  });
  const all = $derived<Acct[]>(
    chart().map((r) => ({
      ...r,
      label: rowName(r),
      sub: r.subtype ?? (isBank(r) ? t(r.type === "card" ? "coa.sub.card" : "coa.sub.bank") : typeLabel(r.type)),
      ...(activity.get(r.id) ?? { n: 0, v: 0 }),
    })),
  );
  const filtered = $derived.by(() => {
    const s = q.trim().toLowerCase();
    return all.filter(
      (r) => (status === "all" || (status === "archived") === r.archived) && (!s || [r.label, r.sub, r.id, String(r.code)].some((x) => x.toLowerCase().includes(s))),
    );
  });
  const rows = $derived(filtered.filter((r) => tab === "all" || r.klass === KLASS[tab]));
  const tabs = $derived(TABS.map((key) => ({ key, label: t(`coa.tab.${key}`), count: filtered.filter((r) => key === "all" || r.klass === KLASS[key]).length })));
  const acctCols = $derived<Column<Acct>[]>([
    { key: "code", label: t("coa.col.code") },
    { key: "name", label: t("common.ledgerAccount"), wrap: true },
    { key: "klass", label: t("common.type") },
    { key: "sub", label: t("coa.col.subtype") },
    { key: "side", label: t("coa.col.side") },
    { key: "v", label: t("reports.activity"), numeric: true },
    { key: "edit", label: t("coa.edit"), hideLabel: true },
  ]);
  const edit = (r: CoaRow | null) => ((editing = r), (dialog = true));
  const side = (r: CoaRow) => (r.side ? t(`coa.side.${r.side}`) : "—");
  const drill = (r: Acct) => go("transactions", isBank(r) ? `account:${r.id}` : r.id === "ask" ? "ask" : `cat:${r.id}`);
  const exportCsv = () =>
    saveCsv(
      `${ent().short ?? "books"} ${t("accounts.title")}`,
      csv([
        [t("coa.col.code"), t("common.ledgerAccount"), t("coa.col.id"), t("common.type"), t("coa.col.subtype"), t("coa.col.side"), t("coa.status")],
        ...rows.map((r) => [String(r.code), r.label, r.id, t(`coa.klass.${r.klass}`), r.sub, r.side ? t(`coa.side.${r.side}`) : "", t(r.archived ? "coa.status.archived" : "coa.status.active")]),
      ]),
    );
  const [h1, h2] = $derived(t("accounts.addHint").split("{code}"));
</script>

<PageHeader title={t("accounts.title")} sub={t("accounts.sub")}>
  {#snippet actions()}<PeriodPicker />{/snippet}
</PageHeader>

<div class="space-y-6 px-4 pt-5 pb-10 sm:px-8">
  <Card title={t("accounts.bank")} flush>
    {#if banks.length}
      <Table columns={bankCols} rows={banks} key={(r) => r.key} caption={t("accounts.bank")}>
        {#snippet cell(r, c)}
          {#if c.key === "label"}
            <span class="inline-flex items-center gap-2.5 text-ink"><Icon name={isCard(r.label) ? "wallet" : "bank"} size={15} class="text-sub" /><bdi>{r.label}</bdi></span>
          {:else if c.key === "period"}
            {#if r.from && r.to}<span class="text-sub tabular-nums">{mdy(r.from)} – {mdy(r.to)}</span>{:else}<span class="text-sub">{t("accounts.export")}</span>{/if}
          {:else if c.key === "value"}
            <Money value={r.value} currency={cur} />
          {:else if r.off === null}
            <span class="text-sub">{t("accounts.noStatement")}</span>
          {:else if Math.abs(r.off) < 0.005}
            <span class="inline-flex items-center gap-1.5 text-good"><Icon name="check" size={15} />{t("accounts.reconciled")}</span>
          {:else}
            <span class="inline-flex items-center gap-1.5 text-bad"><Icon name="alert" size={15} />{t("accounts.offBy", { amount: fmt(r.off, 2) })}</span>
          {/if}
        {/snippet}
      </Table>
    {:else}
      <EmptyState icon="bank" title={t("accounts.noBank")} text={t("accounts.noBankHint")} compact />
    {/if}
  </Card>

  <div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 class="min-w-0 flex-1 basis-48 text-[15px] text-ink">{t("accounts.ledger")} <span class="text-[13px] text-sub">{t("accounts.activityIn", { period: periodLabel() })}</span></h2>
      <Button size="sm" icon="download" onclick={exportCsv}>{t("reports.exportCsv")}</Button>
      <Button size="sm" variant="primary" icon="plus" onclick={() => edit(null)}>{t("coa.add")}</Button>
    </div>
    <Card flush class="mt-3">
      <Tabs items={tabs} value={tab} onchange={(k) => (tab = k)} label={t("accounts.title")} class="px-4 sm:px-5" />
      <div role="group" aria-label={t("coa.filters")} class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
        <span class="inline-flex items-center gap-1.5 text-[13px] text-sub"><Icon name="filter" size={15} />{t("coa.filters")}</span>
        <Search bind:value={q} label={t("coa.search")} class="w-56 max-w-full" />
        <Select
          variant="pill"
          label={t("coa.status")}
          value={status}
          options={["active", "archived", "all"].map((k) => ({ value: k, label: t(`coa.status.${k}`) }))}
          onchange={(v) => (status = v)} />
      </div>
      <Table columns={acctCols} {rows} key={(r) => r.id} caption={t("accounts.title")} onrowclick={edit}>
        {#snippet cell(r, c)}
          {#if c.key === "code"}<span class="num text-ink">{r.code}</span>
          {:else if c.key === "name"}
            <span class="flex flex-wrap items-center gap-x-2 gap-y-1"><bdi class="text-ink">{r.label}</bdi>{#if r.archived}<Badge size="sm">{t("coa.archived")}</Badge>{/if}</span>
            {#if !isBank(r)}<bdi dir="ltr" class="block font-mono text-[12px] break-all text-sub">{r.id}</bdi>{/if}
          {:else if c.key === "klass"}{t(`coa.klass.${r.klass}`)}
          {:else if c.key === "sub"}<bdi>{r.sub}</bdi>
          {:else if c.key === "side"}<span class={r.side ? "" : "text-faint"}>{side(r)}</span>
          {:else if c.key === "v"}
            {#if r.n}
              <button
                type="button"
                title={t("common.transactions", { n: r.n })}
                onclick={(e) => (e.stopPropagation(), drill(r))}
                class="rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50"><Money value={r.v} currency={cur} /></button>
            {:else}<span class="text-faint">—</span>{/if}
          {:else}
            <IconButton icon="edit" label={t("coa.edit")} size="sm" variant="ghost" onclick={(e) => (e.stopPropagation(), edit(r))} />
          {/if}
        {/snippet}
        {#snippet empty()}<EmptyState icon="report" title={t("coa.empty")} text={t("coa.emptyHint")} compact />{/snippet}
      </Table>
    </Card>
    <p class="mt-4 text-[13px] text-sub">{h1}<span class="font-mono whitespace-nowrap" dir="ltr">type:name</span>{h2}</p>
  </div>
</div>

<AccountDialog bind:open={dialog} row={editing} />
