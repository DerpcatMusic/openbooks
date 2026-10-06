<script lang="ts">
  // Chart of accounts (port of web/src/views/Accounts.svelte): the bank/card accounts that feed the books with their statement
  // reconciliation, then every ledger account by type with where it reports and its activity in the period (click to drill in).
  import { group, isCard, TYPES } from "@openbooks/core";
  import { S, ent, isUS, allCats, catLabel, typeLabel, balances, accounts, periodTxns, periodLabel, fmt, mdy } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Card, EmptyState, Icon, Money, PageHeader, Table, type Column } from "#lib/ui/index.ts";
  import { go } from "#lib/reports/go.ts";
  import PeriodPicker from "#lib/reports/PeriodPicker.svelte";

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

  // ledger accounts by type, in the chart's type order
  type Acct = { key: string; n: number; v: number };
  const used = $derived([...new Set([...allCats(), ...txns.map((x) => x.category)])]);
  const types = $derived(
    Object.keys(TYPES)
      .map((g) => ({
        g,
        rows: used
          .filter((c) => group(c) === g)
          .map((c): Acct => {
            const xs = ts.filter((x) => x.category === c);
            return { key: c, n: xs.length, v: xs.reduce((a, x) => a + x.amount, 0) };
          }),
      }))
      .filter((x) => x.rows.length),
  );
  const acctCols = $derived<Column<Acct>[]>([
    { key: "name", label: `${t("common.name")} · ${t("accounts.code")}`, wrap: true },
    { key: "n", label: t("accounts.txns"), numeric: true },
    { key: "v", label: t("common.amount"), numeric: true },
  ]);
  const reportOf = (g: string) => t(TYPES[g] ? "accounts.pl" : g === "equity" ? "accounts.bs" : "accounts.notOnReports");
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
    <h2 class="text-[15px] text-ink">{t("accounts.ledger")} <span class="text-[13px] text-sub">{t("accounts.activityIn", { period: periodLabel() })}</span></h2>
    <div class="mt-3 space-y-4">
      {#each types as { g, rows } (g)}
        <Card title={typeLabel(g)} description={`${t("accounts.report")}: ${reportOf(g)}`} level={3} flush>
          <Table columns={acctCols} {rows} key={(r) => r.key} caption={typeLabel(g)} onrowclick={(r) => go("transactions", r.key === "ask" ? "ask" : `cat:${r.key}`)}>
            {#snippet cell(r, c)}
              {#if c.key === "name"}<bdi class="block text-ink">{catLabel(r.key)}</bdi><bdi dir="ltr" class="block font-mono text-[12px] break-all text-sub">{r.key}</bdi>
              {:else if c.key === "n"}<span class={r.n ? "" : "text-faint"}>{r.n}</span>
              {:else if r.n}<Money value={r.v} currency={cur} />
              {:else}<span class="text-faint">—</span>{/if}
            {/snippet}
          </Table>
        </Card>
      {/each}
    </div>
    <p class="mt-4 text-[13px] text-sub">{h1}<span class="font-mono whitespace-nowrap" dir="ltr">type:name</span>{h2}</p>
  </div>
</div>
