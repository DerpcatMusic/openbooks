<script lang="ts">
  // Advance payments: income tax (the rate in the Assessing Officer's notice times the turnover of the previous month(s)) and Bituach Leumi
  // (monthly, on your declared income), the dates, what you paid (linked to the bank payment) and what is still open. Paid income-tax
  // advances come off the 1301 balance. Logic: country-il advances.ts. Data: doc "filings" (settings.il).
  import { blAdvances, paidTotal, taxAdvances, vatTurnover, withPaid, type AdvanceRow, type PaidAdvance } from "@openbooks/country-il";
  import { isBiz } from "@openbooks/core";
  import { S, bizType, mdy, money, taxTable, toast } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Card, Dialog, EmptyState, Input, Money, PageHeader, Select, Stat, Table } from "#lib/ui/index.ts";
  import type { Column } from "#lib/ui/index.ts";
  import { il, isIL, patchIl, vatBooks, vatCtx } from "#lib/filings.svelte.ts";
  import type { IlRates } from "@openbooks/country-il";

  const s = $derived(il());
  const y = $derived(S.year);
  const todayIso = new Date().toLocaleDateString("sv");
  const T = $derived(taxTable(y) as unknown as IlRates);
  const sole = $derived((bizType(y) ?? "").startsWith("osek-"));

  // turnover between two dates: sales before VAT (VAT books), else business receipts
  function turnover(from: string, to: string) {
    if (vatBooks(y)) {
      const c = vatCtx(y);
      if (c) {
        const v = vatTurnover(from, to, c);
        if (v) return v;
      }
    }
    const k = vatBooks(y) ? 1 + (Number(T.vatRate) || 0.18) : 1;
    return S.data!.txns.filter((x) => x.date >= from && x.date <= to && isBiz(x.category)).reduce((a, x) => a + x.amount, 0) / k;
  }
  const taxRows = $derived(s.taxAdvanceFrequency === "none" ? [] : withPaid(taxAdvances(y, s.taxAdvanceFrequency, s.taxAdvanceRatePct, turnover), s.advancesPaid));
  // BL: declared monthly income, else last year's profit / 12
  const lastProfit = $derived.by(() => {
    const tx = S.data!.txns.filter((x) => +x.date.slice(0, 4) === y - 1);
    const rev = tx.filter((x) => isBiz(x.category)).reduce((a, x) => a + x.amount, 0),
      exp = tx.filter((x) => x.amount < 0 && ["expense:", "cogs:"].some((p) => x.category.startsWith(p))).reduce((a, x) => a - x.amount, 0);
    return Math.max(0, rev - exp);
  });
  const blIncome = $derived(s.blMonthlyIncome ?? Math.round(lastProfit / 12));
  const blRows = $derived(sole && s.blAdvances ? withPaid(blAdvances(y, T, blIncome), s.advancesPaid) : []);

  const sum = (xs: readonly { amount: number }[]) => xs.reduce((a, r) => a + r.amount, 0);
  const paidTax = $derived(paidTotal(s.advancesPaid, y, "tax")),
    paidBl = $derived(paidTotal(s.advancesPaid, y, "bl"));

  const cols = (kind: "tax" | "bl"): Column<AdvanceRow & { paid: number; open: number }>[] => [
    { key: "due", label: t("adv.col.due") },
    { key: "period", label: kind === "tax" ? t("adv.col.turnoverOf") : t("adv.col.monthOf") },
    { key: "base", label: kind === "tax" ? t("adv.col.turnover") : t("adv.col.income"), numeric: true },
    { key: "amount", label: t("adv.col.amount"), numeric: true },
    { key: "paid", label: t("adv.col.paid"), numeric: true },
    { key: "go", label: t("adv.col.pay"), hideLabel: true },
  ];
  const period = (r: AdvanceRow) => (r.from.slice(0, 7) === r.to.slice(0, 7) ? r.from.slice(0, 7) : `${r.from.slice(0, 7)} – ${r.to.slice(0, 7)}`);

  // ---- record a payment ----
  let dlg = $state(false),
    row = $state<(AdvanceRow & { open: number }) | null>(null),
    date = $state(""),
    amount = $state<string | number>(""),
    txn = $state("");
  const outflows = $derived.by(() => {
    if (!row) return [];
    const from = shift(row.due, -25),
      to = shift(row.due, 40);
    return S.data!.txns.filter((x) => x.amount < 0 && x.date >= from && x.date <= to).sort((a, b) => Math.abs(Math.abs(b.amount) - row!.open) - Math.abs(Math.abs(a.amount) - row!.open) || a.date.localeCompare(b.date)).slice(0, 25);
  });
  function shift(iso: string, n: number) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function pay(r: AdvanceRow & { open: number }) {
    row = r;
    date = todayIso;
    amount = r.open || r.amount;
    txn = "";
    dlg = true;
  }
  function pickTxn(id: string) {
    txn = id;
    const x = S.data!.txns.find((q) => q.id === id);
    if (x) {
      date = x.date;
      amount = Math.abs(x.amount);
    }
  }
  async function save() {
    if (!row || !(+amount > 0)) return;
    const rec: PaidAdvance = { id: uid(), kind: row.kind, row: row.id, year: y, date, amount: +amount, ...(txn ? { txn } : {}) };
    await patchIl({ advancesPaid: [...s.advancesPaid, rec] });
    dlg = false;
    toast(t("adv.saved"));
  }
  const remove = (id: string) => patchIl({ advancesPaid: s.advancesPaid.filter((p) => p.id !== id) });
  const uid = () => Math.random().toString(36).slice(2, 10);
  const mine = $derived(s.advancesPaid.filter((p) => p.year === y).sort((a, b) => b.date.localeCompare(a.date)));
</script>

<PageHeader title={t("adv.title")} sub={t("adv.sub")}>
  {#snippet actions()}
    <Select variant="pill" icon="calendar" label={t("period.taxYear")} value={String(y)} options={S.data!.years.map((x) => ({ value: String(x), label: String(x) })).reverse()} onchange={(v) => (S.year = +v)} />
  {/snippet}
</PageHeader>

<div class="space-y-6 px-4 py-4 sm:px-8">
  {#if !S.data || !isIL() || !bizType(y)}
    <EmptyState icon="wallet" title={t("filings.noType")} text={t("adv.ilOnly")} />
  {:else}
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat size="md" label={t("adv.paidTax")} value={paidTax} />
      <Stat size="md" label={t("adv.dueTax")} value={sum(taxRows)} />
      <Stat size="md" label={t("adv.paidBl")} value={paidBl} />
      <Stat size="md" label={t("adv.dueBl")} value={sum(blRows)} />
    </div>

    <Card title={t("adv.tax")} description={t("adv.taxHint")} flush>
      <div class="grid gap-3 border-b border-line px-4 py-4 sm:grid-cols-3 sm:px-5">
        <Input label={t("adv.rate")} type="number" step="0.01" min="0" numeric value={s.taxAdvanceRatePct || ""} placeholder="0" hint={t("adv.rateHint")} onchange={(e) => patchIl({ taxAdvanceRatePct: Math.max(0, +e.currentTarget.value || 0) })} />
        <Select label={t("filings.taxAdvanceFrequency")} value={s.taxAdvanceFrequency} options={[{ value: "monthly", label: t("filings.monthly") }, { value: "bimonthly", label: t("filings.bimonthly") }, { value: "none", label: t("filings.noAdvances") }]} onchange={(v) => patchIl({ taxAdvanceFrequency: v as "monthly" | "bimonthly" | "none" })} />
      </div>
      {#if s.taxAdvanceFrequency === "none"}
        <p class="px-4 py-5 text-[14px] text-sub sm:px-5">{t("adv.noneText")}</p>
      {:else}
        {#if !s.taxAdvanceRatePct}<p role="note" class="border-b border-warn/30 bg-warn/8 px-4 py-2.5 text-[13px] text-warn sm:px-5">{t("adv.rateMissing")}</p>{/if}
        <Table columns={cols("tax")} rows={taxRows} key={(r) => r.id} caption={t("adv.tax")} stack>
          {#snippet cell(r, c)}
            {#if c.key === "due"}<span class="num">{mdy(r.due)}</span>{#if r.due < todayIso && r.open > 0}<Badge size="sm" tone="bad" class="ms-2">{t("filings.status.overdue")}</Badge>{/if}
            {:else if c.key === "period"}<span class="num">{period(r)}</span>
            {:else if c.key === "go"}{#if r.open > 0 && r.amount > 0}<Button size="sm" onclick={() => pay(r)}>{t("adv.record")}</Button>{:else if r.amount > 0}<Badge size="sm" tone="good" icon="check">{t("filings.status.done")}</Badge>{/if}
            {:else}<Money value={r[c.key as "base"]} cents={false} />{/if}
          {/snippet}
        </Table>
      {/if}
    </Card>

    {#if sole}
      <Card title={t("adv.bl")} description={t("adv.blHint")} flush>
        <div class="grid gap-3 border-b border-line px-4 py-4 sm:grid-cols-3 sm:px-5">
          <Input label={t("adv.blIncome")} type="number" step="1" min="0" numeric value={s.blMonthlyIncome ?? ""} placeholder={String(blIncome)} hint={t("adv.blIncomeHint", { y: y - 1, v: money(Math.round(lastProfit / 12)) })} onchange={(e) => patchIl({ blMonthlyIncome: e.currentTarget.value === "" ? null : Math.max(0, +e.currentTarget.value || 0) })} />
        </div>
        {#if blRows.length}
          <Table columns={cols("bl")} rows={blRows} key={(r) => r.id} caption={t("adv.bl")} stack>
            {#snippet cell(r, c)}
              {#if c.key === "due"}<span class="num">{mdy(r.due)}</span>{#if r.due < todayIso && r.open > 0}<Badge size="sm" tone="bad" class="ms-2">{t("filings.status.overdue")}</Badge>{/if}
              {:else if c.key === "period"}<span class="num">{period(r)}</span>
              {:else if c.key === "go"}{#if r.open > 0}<Button size="sm" onclick={() => pay(r)}>{t("adv.record")}</Button>{:else}<Badge size="sm" tone="good" icon="check">{t("filings.status.done")}</Badge>{/if}
              {:else}<Money value={r[c.key as "base"]} cents={false} />{/if}
            {/snippet}
          </Table>
        {:else}
          <p class="px-4 py-5 text-[14px] text-sub sm:px-5">{t("adv.blOff")}</p>
        {/if}
      </Card>
    {/if}

    {#if mine.length}
      <Card title={t("adv.payments")} flush>
        <ul class="divide-y divide-line">
          {#each mine as p (p.id)}
            <li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[14px] sm:px-5">
              <span class="num w-24 shrink-0 text-ink-2">{mdy(p.date)}</span>
              <Badge size="sm">{t(`adv.kind.${p.kind}`)}</Badge>
              <span class="min-w-0 flex-1 text-sub">{p.row || t("adv.extra")}{p.txn ? ` · ${t("adv.linked")}` : ""}</span>
              <span class="num"><Money value={p.amount} cents={false} /></span>
              <Button size="sm" variant="ghost" onclick={() => remove(p.id)}>{t("common.delete")}</Button>
            </li>
          {/each}
        </ul>
      </Card>
    {/if}
    <p class="text-[12px] text-faint">{t("adv.disclaimer")}</p>
  {/if}
</div>

<Dialog bind:open={dlg} title={t("adv.recordTitle")} description={row ? `${t(`adv.kind.${row.kind}`)} · ${mdy(row.due)}` : ""}>
  <div class="space-y-3">
    <Select label={t("adv.fromBank")} value={txn} options={[{ value: "", label: t("adv.noTxn") }, ...outflows.map((x) => ({ value: x.id, label: `${x.date} · ${x.desc.slice(0, 40)} · ${money(Math.abs(x.amount))}` }))]} onchange={pickTxn} />
    <Input label={t("common.date")} type="date" bind:value={date} />
    <Input label={t("common.amount")} type="number" step="0.01" numeric bind:value={amount} />
  </div>
  {#snippet actions()}
    <Button onclick={() => (dlg = false)}>{t("common.cancel")}</Button>
    <Button variant="primary" onclick={save} disabled={!(+amount > 0) || !date}>{t("common.save")}</Button>
  {/snippet}
</Dialog>
