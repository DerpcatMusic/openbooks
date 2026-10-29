<script lang="ts">
  // Payroll: the runs your payroll provider (Gusto, ADP, a payroll bureau) made, recorded and matched to the bank. OpenBooks does NOT calculate
  // payroll tax: gross pay, employee withholding, benefits, employer taxes and net pay are typed in or imported from the provider's register and
  // only checked against each other. The same for Israel and the US. Data: doc "payroll" (core payroll.ts).
  // On the accrual basis a run books wages and employer taxes on its pay date and the bank rows matched to it clear the payroll liability;
  // on the cash basis wages count when the bank rows are filed, and the runs are a record of what is still to be paid.
  import {
    appliedTo,
    autoMatch,
    group,
    guessRegister,
    importRegister,
    payrollOwed,
    parseRegister,
    payrollLines,
    payrollLiability,
    payrollMatches,
    payrollPaid,
    payrollProblem,
    payrollStatus,
    payrollTotals,
    REGISTER_FIELDS,
    REGISTER_SUMMED,
    TAXES_ACCOUNT,
    WAGES_ACCOUNT,
    type PayrollRun,
    type RegisterMapping,
  } from "@openbooks/core";
  import type { Txn } from "@openbooks/schema";
  import { S, allCats, catLabel, doc, ent, fmt, isArchived, mdy, saveDoc, toast } from "#lib/stores/books.svelte.ts";
  import { basis, payrollRuns } from "#lib/stores/basis.svelte.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Drawer, EmptyState, Input, Money, PageHeader, Select, Stat, Table, type Column } from "#lib/ui/index.ts";
  import type { Tone } from "#lib/ui/index.ts";
  import FilePick from "../documents/FilePick.svelte";
  import { applied as billsApplied, readBills } from "../bills/bills.ts";
  import { uid } from "../invoices/invoices.ts";

  const cur = $derived(ent().currency ?? "ILS");
  const today = () => new Date().toLocaleDateString("sv");
  const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
  const runs = $derived(payrollRuns());
  const txns = $derived((S.data?.txns ?? []) as Txn[]);
  const accrual = $derived(basis() === "accrual");
  const STATUS: Record<string, Tone> = { open: "warn", partial: "accent", paid: "good" };

  // bank rows already applied, to a bill or to another run: one row can pay several things, never more than its money
  const billTaken = $derived(billsApplied(readBills(doc<unknown[]>("bills"))));
  const takenBy = (rs: readonly PayrollRun[]) => {
    const m = new Map(billTaken);
    for (const [k, v] of appliedTo(rs)) m.set(k, r2((m.get(k) ?? 0) + v));
    return m;
  };

  // ---------- list ----------
  type Row = { run: PayrollRun; st: string; cost: number; owed: number };
  const rows = $derived(
    [...runs]
      .sort((a, b) => b.payDate.localeCompare(a.payDate))
      .map((run): Row => ({ run, st: payrollStatus(run), cost: payrollLiability(run), owed: payrollOwed(run) })),
  );
  const totals = $derived(payrollTotals(runs));
  const columns = $derived<Column<Row>[]>([
    { key: "payDate", label: t("payroll.col.payDate") },
    { key: "period", label: t("payroll.col.period"), class: "w-full max-w-0 min-w-32" },
    { key: "gross", label: t("payroll.col.gross"), numeric: true },
    { key: "net", label: t("payroll.col.net"), numeric: true },
    { key: "cost", label: t("payroll.col.cost"), numeric: true },
    { key: "owed", label: t("payroll.col.owed"), numeric: true },
    { key: "st", label: t("payroll.col.status") },
  ]);

  async function matchAll() {
    const found = autoMatch(runs, txns, takenBy([]));
    if (!found.size) return void toast(t("payroll.matchedNone"));
    let n = 0;
    const next = runs.map((r) => {
      const add = found.get(r.id);
      if (!add) return r;
      n += add.length;
      return { ...r, payments: [...r.payments, ...add] };
    });
    await saveDoc("payroll", next);
    toast(t("payroll.matchedAll", { n, runs: found.size }));
  }

  // ---------- editor ----------
  let draft = $state<PayrollRun | null>(null),
    open = $state(false),
    isNew = $state(false),
    outAmount = $state(""),
    outDate = $state("");
  const blank = (provider: string): PayrollRun => ({ id: uid(), period: today().slice(0, 7), payDate: today(), gross: 0, employerTaxes: 0, employeeWithholding: 0, benefits: 0, net: 0, provider, payments: [] });
  const edit = (x?: PayrollRun) => {
    isNew = !x;
    outAmount = "";
    outDate = today();
    draft = x ? (structuredClone($state.snapshot(x)) as PayrollRun) : blank([...runs].sort((a, b) => b.payDate.localeCompare(a.payDate))[0]?.provider ?? "");
    open = true;
  };
  const expectedNet = (x: PayrollRun) => r2(x.gross - x.employeeWithholding - x.benefits);
  /** Changing gross, withholding or benefits moves net pay with them while net pay still equals what they give. */
  function setAmount(k: "gross" | "employerTaxes" | "employeeWithholding" | "benefits" | "net", v: string) {
    if (!draft) return;
    const follows = k !== "net" && k !== "employerTaxes" && draft.net === expectedNet(draft);
    draft[k] = r2(Math.max(0, Number(v) || 0));
    if (follows) draft.net = expectedNet(draft);
  }
  const problem = $derived(draft ? payrollProblem(draft) : undefined);
  const lines = $derived(draft && !problem ? payrollLines($state.snapshot(draft) as PayrollRun) : []);
  const mine = $derived(draft ? draft.payments : []);
  const others = $derived(runs.filter((r) => r.id !== draft?.id));
  const taken = $derived(takenBy(draft ? [...others, $state.snapshot(draft) as PayrollRun] : others));
  const suggestions = $derived(draft && !problem ? payrollMatches($state.snapshot(draft) as PayrollRun, txns, taken).slice(0, 12) : []);
  const byId = $derived(new Map(txns.map((x) => [x.id, x])));
  const expenseAccounts = $derived([
    { value: "", label: t("payroll.accountDefault") },
    ...[...new Set([WAGES_ACCOUNT, TAXES_ACCOUNT, ...allCats().filter((c) => ["expense", "cogs"].includes(group(c)) && !isArchived(c))])].map((c) => ({ value: c, label: catLabel(c) })),
  ]);
  const apply = (m: (typeof suggestions)[number]) => draft && (draft.payments = [...draft.payments, { id: uid(), txn: m.txn.id, amount: m.amount, date: m.txn.date }]);
  const unapply = (id: string) => draft && (draft.payments = draft.payments.filter((p) => p.id !== id));
  function addOutside() {
    const amount = r2(Number(outAmount) || 0);
    if (!draft || amount <= 0 || !outDate) return;
    draft.payments = [...draft.payments, { id: uid(), txn: null, amount, date: outDate }];
    outAmount = "";
  }
  const num = (n: number) => (n ? n : "");

  function clean(x: PayrollRun): PayrollRun {
    const out = { ...x, period: x.period.trim(), provider: x.provider.trim() } as Record<string, unknown>;
    if (typeof out.memo === "string") out.memo = out.memo.trim();
    for (const k of ["memo", "wages", "taxes"]) if (!out[k]) delete out[k];
    return out as unknown as PayrollRun;
  }
  async function save() {
    if (!draft || problem) return;
    const next = clean($state.snapshot(draft) as PayrollRun);
    await saveDoc("payroll", [...runs.filter((x) => x.id !== next.id), next]);
    toast(t("payroll.saved", { period: bidi(next.period) }));
    open = false;
  }
  async function remove() {
    if (!draft) return;
    const left = runs.filter((x) => x.id !== draft!.id);
    await saveDoc("payroll", left.length ? left : null);
    toast(t("payroll.removed", { period: bidi(draft.period) }));
    open = false;
  }

  // ---------- import a provider's register ----------
  let imp = $state(false),
    file = $state<{ name: string; rows: string[][] } | null>(null),
    m = $state<RegisterMapping>(guessRegister([], 0)),
    provider = $state(""),
    err = $state("");
  const FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"].map((v) => ({ value: v, label: v }));
  function openImport() {
    file = null;
    err = "";
    provider = [...runs].sort((a, b) => b.payDate.localeCompare(a.payDate))[0]?.provider ?? "";
    imp = true;
  }
  async function pick(files: File[]) {
    const f = files[0];
    if (!f) return;
    err = "";
    try {
      const b = await f.arrayBuffer();
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(b);
      } catch {
        text = new TextDecoder("windows-1255").decode(b); // Israeli exports are often Windows-1255
      }
      const parsed = parseRegister(text);
      if (parsed.length < 2) throw new Error(t("payroll.imp.read"));
      file = { name: f.name, rows: parsed };
      m = guessRegister(parsed, 0);
      if (!provider) provider = f.name.replace(/\.[^.]+$/, "");
    } catch (x) {
      err = String((x as Error).message || x);
      file = null;
    }
  }
  const header = $derived(file ? (file.rows[m.headerRow] ?? []) : []);
  const colOpts = $derived([{ value: "", label: t("payroll.imp.none") }, ...header.map((c, i) => ({ value: String(i), label: c || t("payroll.imp.column", { n: i + 1 }) }))]);
  const FIELD_LABEL: Record<(typeof REGISTER_FIELDS)[number] | (typeof REGISTER_SUMMED)[number], string> = {
    payDate: "payroll.payDate",
    period: "payroll.period",
    gross: "payroll.gross",
    employerTaxes: "payroll.employerTaxes",
    employeeWithholding: "payroll.withholding",
    benefits: "payroll.benefits",
    net: "payroll.net",
  };
  const result = $derived(file && provider.trim() ? importRegister(file.rows, $state.snapshot(m) as RegisterMapping, provider) : null);
  const fresh = $derived(result ? result.runs.filter((r) => !runs.some((x) => x.id === r.id)) : []);
  async function doImport() {
    if (!result || !fresh.length) return;
    const n = fresh.length, // the saved runs are in the state at once, so count before the save
      skipped = result.runs.length - n;
    await saveDoc("payroll", [...runs, ...fresh]);
    toast(t("payroll.imp.done", { n, skipped }));
    imp = false;
  }
</script>

<PageHeader title={t("payroll.title")} sub={t("payroll.sub")}>
  {#snippet actions()}
    {#if runs.length}<Button icon="check" onclick={matchAll}>{t("payroll.matchAll")}</Button>{/if}
    <Button icon="upload" onclick={openImport}>{t("payroll.import")}</Button>
    <Button variant="primary" icon="plus" onclick={() => edit()}>{t("payroll.new")}</Button>
  {/snippet}
</PageHeader>

<div class="px-4 pt-5 pb-16 sm:px-8">
  <div class="max-w-3xl space-y-2 text-[13px] text-sub">
    <p data-testid="payroll-notice">{t("payroll.notice")}</p>
    <p class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{t(accrual ? "payroll.basisAccrual" : "payroll.basisCash")}</span>
      {#if !accrual}<a href="/settings" class="text-accent-ink underline-offset-2 hover:underline">{t("payroll.settings")}</a>{/if}
    </p>
  </div>

  {#if rows.length}
    <div class="panel mt-4 grid gap-6 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
      <Stat label={t("payroll.stat.gross")} value={totals.gross} currency={cur} size="md" />
      <Stat label={t("payroll.stat.employer")} value={totals.employerTaxes} currency={cur} size="md" />
      <Stat label={t("payroll.stat.cost")} value={totals.cost} currency={cur} size="md" />
      <Stat label={t("payroll.stat.owed")} value={totals.owed} currency={cur} size="md" />
    </div>
    <div class="panel mt-4 overflow-hidden">
      <Table {columns} {rows} key={(r: Row) => r.run.id} caption={t("payroll.title")} onrowclick={(r: Row) => edit(r.run)} stack>
        {#snippet cell(r: Row, c)}
          {#if c.key === "payDate"}<span class="text-sub">{mdy(r.run.payDate)}</span>
          {:else if c.key === "period"}<span class="block truncate text-ink" dir="auto">{r.run.period}</span><span class="block truncate text-[12px] text-sub" dir="auto">{r.run.provider}</span>
          {:else if c.key === "gross"}<Money value={r.run.gross} currency={cur} />
          {:else if c.key === "net"}<Money value={r.run.net} currency={cur} />
          {:else if c.key === "cost"}<Money value={r.cost} currency={cur} class="text-ink" />
          {:else if c.key === "owed"}<Money value={r.owed} currency={cur} class={r.owed > 0.005 ? "text-ink" : "text-faint"} />
          {:else}<Badge tone={STATUS[r.st]}>{t(`payroll.status.${r.st}`)}</Badge>{/if}
        {/snippet}
      </Table>
    </div>
  {:else}
    <div class="panel mt-4">
      <EmptyState icon="users" title={t("payroll.empty.title")} text={t("payroll.empty.text")}>
        <div class="flex flex-wrap justify-center gap-2">
          <Button icon="upload" onclick={openImport}>{t("payroll.import")}</Button>
          <Button variant="primary" icon="plus" onclick={() => edit()}>{t("payroll.new")}</Button>
        </div>
      </EmptyState>
    </div>
  {/if}
</div>

<Drawer bind:open title={draft ? (draft.period ? `${t("payroll.editRun")} · ${bidi(draft.period)}` : t("payroll.editRun")) : t("payroll.editRun")} width={600}>
  {#if draft}
    {@const d = draft}
    <div class="space-y-6 px-4 py-5 sm:px-5">
      <section class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <Input label={t("payroll.payDate")} type="date" bind:value={draft.payDate} />
          <Input label={t("payroll.period")} bind:value={draft.period} placeholder={t("payroll.periodPh")} autocomplete="off" />
        </div>
        <Input label={t("payroll.provider")} bind:value={draft.provider} placeholder={t("payroll.providerPh")} autocomplete="off" />
        <div class="grid grid-cols-2 gap-3">
          <Input label={t("payroll.gross")} type="number" numeric step="any" min="0" value={num(d.gross)} onchange={(e) => setAmount("gross", e.currentTarget.value)} />
          <Input label={t("payroll.employerTaxes")} type="number" numeric step="any" min="0" value={num(d.employerTaxes)} onchange={(e) => setAmount("employerTaxes", e.currentTarget.value)} />
        </div>
        <p class="-mt-1 text-[12px] text-sub">{t("payroll.employerTaxesHint")}</p>
        <div class="grid grid-cols-2 gap-3">
          <Input label={t("payroll.withholding")} type="number" numeric step="any" min="0" value={num(d.employeeWithholding)} onchange={(e) => setAmount("employeeWithholding", e.currentTarget.value)} hint={t("payroll.withholdingHint")} />
          <Input label={t("payroll.benefits")} type="number" numeric step="any" min="0" value={num(d.benefits)} onchange={(e) => setAmount("benefits", e.currentTarget.value)} hint={t("payroll.benefitsHint")} />
        </div>
        <Input label={t("payroll.net")} type="number" numeric step="any" min="0" value={num(d.net)} onchange={(e) => setAmount("net", e.currentTarget.value)} hint={t("payroll.netHint", { amount: fmt(expectedNet(d), 2) })} />
        {#if problem === "net"}<p><Button size="sm" onclick={() => (d.net = expectedNet(d))}>{t("payroll.useNet", { amount: fmt(expectedNet(d), 2) })}</Button></p>{/if}
        <Input label={t("payroll.memo")} value={d.memo ?? ""} onchange={(e) => (d.memo = e.currentTarget.value)} autocomplete="off" />
        <details>
          <summary class="cursor-pointer text-[13px] text-accent-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{t("payroll.accounts")}</summary>
          <div class="mt-2 grid grid-cols-2 gap-3">
            <Select label={t("payroll.wagesAccount")} value={d.wages ?? ""} options={expenseAccounts} onchange={(v) => (d.wages = v || undefined)} />
            <Select label={t("payroll.taxesAccount")} value={d.taxes ?? ""} options={expenseAccounts} onchange={(v) => (d.taxes = v || undefined)} />
          </div>
        </details>
        {#if problem}<p class="text-[13px] text-warn" role="status">{t(`payroll.problem.${problem}`)}</p>{/if}
      </section>

      {#if lines.length}
        <section>
          <h3 class="text-[14px] text-ink">{t("payroll.lines")}</h3>
          <p class="mt-0.5 text-[13px] text-sub">{t("payroll.linesHint")}</p>
          <div class="mt-2 overflow-hidden rounded-lg border border-line text-[13px]" data-testid="payroll-lines">
            <div class="flex gap-3 border-b border-line bg-fill px-3 py-1.5 text-sub">
              <span class="min-w-0 flex-1">{t("common.account")}</span><span class="w-24 text-end">{t("payroll.debit")}</span><span class="w-24 text-end">{t("payroll.credit")}</span>
            </div>
            {#each lines as l (l.account)}
              <div class="flex gap-3 border-b border-line px-3 py-2 last:border-b-0">
                <span class="min-w-0 flex-1 [overflow-wrap:anywhere] text-ink" dir="auto">{catLabel(l.account)}</span>
                <span class="num w-24 text-end text-ink">{l.debit ? fmt(l.debit, 2) : ""}</span>
                <span class="num w-24 text-end text-ink">{l.credit ? fmt(l.credit, 2) : ""}</span>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <section>
        <h3 class="text-[14px] text-ink">{t("payroll.payments")}</h3>
        <p class="mt-0.5 text-[13px] text-sub">{t("payroll.paymentsHint")}</p>
        {#if !problem}
          <p class="mt-2 text-[13px] text-ink-2 num" data-testid="payroll-owed">{t("payroll.owedLine", { paid: fmt(payrollPaid(d), 2), cost: fmt(payrollLiability(d), 2), owed: fmt(payrollOwed(d), 2) })}</p>
        {/if}
        {#if mine.length}
          <ul class="mt-2 divide-y divide-line rounded-lg border border-line">
            {#each mine as p (p.id)}
              {@const x = p.txn ? byId.get(p.txn) : undefined}
              <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span class="min-w-0 flex-1 basis-44">
                  <span class="block truncate text-[14px] text-ink" dir="auto">{x ? x.desc : t("payroll.outside")}</span>
                  <span class="block text-[12px] text-sub">{mdy(p.date)}</span>
                </span>
                <Money value={p.amount} currency={cur} class="text-ink" />
                <Button size="sm" variant="ghost" onclick={() => unapply(p.id)}>{t("payroll.removePayment")}</Button>
              </li>
            {/each}
          </ul>
        {/if}

        {#if !problem}
          <h4 class="mt-4 text-[13px] text-ink-2">{t("payroll.suggested")}</h4>
          {#if suggestions.length}
            <ul class="mt-2 divide-y divide-line rounded-lg border border-line">
              {#each suggestions as s (s.txn.id)}
                <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span class="min-w-0 flex-1 basis-44">
                    <span class="block truncate text-[14px] text-ink" dir="auto">{s.txn.desc}</span>
                    <span class="block text-[12px] text-sub">{mdy(s.txn.date)}</span>
                  </span>
                  <Badge size="sm" tone={s.exact ? "good" : "neutral"}>{t(`payroll.kind.${s.kind}`)}</Badge>
                  <Money value={s.amount} currency={cur} />
                  <Button size="sm" onclick={() => apply(s)}>{t("payroll.apply")}</Button>
                </li>
              {/each}
            </ul>
          {:else}<p class="mt-2 text-[13px] text-faint">{t("payroll.noMatches")}</p>{/if}
          <details class="mt-3">
            <summary class="cursor-pointer text-[13px] text-accent-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{t("payroll.addOutside")}</summary>
            <div class="mt-2 flex flex-wrap items-end gap-3">
              <Input class="w-36" label={t("payroll.outsideAmount")} type="number" numeric step="any" min="0" bind:value={outAmount} />
              <Input class="w-40" label={t("payroll.outsideDate")} type="date" bind:value={outDate} />
              <Button onclick={addOutside} disabled={!(Number(outAmount) > 0)}>{t("payroll.addPayment")}</Button>
            </div>
          </details>
        {/if}
      </section>
    </div>
  {/if}
  {#snippet footer()}
    {#if !isNew}<Button variant="ghost" class="me-auto hover:text-bad" icon="trash" onclick={remove}>{t("common.delete")}</Button>{/if}
    <Button variant="primary" disabled={!!problem} onclick={save}>{t("common.save")}</Button>
  {/snippet}
</Drawer>

<Drawer bind:open={imp} title={t("payroll.imp.title")} width={640}>
  <div class="space-y-4 px-4 py-5 sm:px-5">
    <p class="text-[13px] text-sub">{t("payroll.imp.intro")}</p>
    <FilePick label={file ? file.name : t("payroll.imp.choose")} accept=".csv,.txt,text/csv" onpick={pick} />
    {#if err}<p class="text-[13px] text-bad" dir="auto" role="alert">{err}</p>{/if}
    {#if file}
      <div class="overflow-x-auto rounded-lg border border-line">
        <table class="w-full text-[13px]">
          <tbody>
            {#each file.rows.slice(Math.max(0, m.headerRow - 1), m.headerRow + 5) as r, i}
              {@const n = Math.max(0, m.headerRow - 1) + i}
              <tr class="border-b border-line last:border-0 {n === m.headerRow ? 'bg-accent/8 text-ink' : n < m.headerRow ? 'text-faint' : 'text-ink-2'}">
                <td class="px-2 py-1.5 text-faint num">{n + 1}</td>
                {#each r as cell}<td class="max-w-[180px] truncate px-2 py-1.5 whitespace-nowrap" dir="auto">{cell}</td>{/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Input label={t("payroll.imp.provider")} bind:value={provider} placeholder={t("payroll.providerPh")} autocomplete="off" />
        <Select
          label={t("payroll.imp.headerRow")}
          value={String(m.headerRow)}
          onchange={(v) => (m = guessRegister(file!.rows, +v))}
          options={file.rows.slice(0, 20).map((r, i) => ({ value: String(i), label: `${i + 1} · ${bidi(r.filter(Boolean).slice(0, 3).join(", "))}` }))} />
        {#each REGISTER_FIELDS as k (k)}
          <Select label={t(FIELD_LABEL[k])} value={m[k] == null ? "" : String(m[k])} onchange={(v) => (m[k] = v === "" ? null : +v)} options={colOpts} />
        {/each}
        <Select label={t("payroll.imp.dateFormat")} bind:value={m.dateFormat} options={FORMATS} />
      </div>
      <div class="space-y-3">
        <p class="text-[12px] text-sub">{t("payroll.imp.sumHint")}</p>
        {#each REGISTER_SUMMED as k (k)}
          <div>
            <div class="text-[13px] text-ink-2">{t(FIELD_LABEL[k])}</div>
            <div class="mt-1 flex flex-wrap items-center gap-1.5">
              {#each m[k] as c (c)}
                <Badge
                  >{header[c] || t("payroll.imp.column", { n: c + 1 })}<button
                    type="button"
                    class="ms-1.5 text-faint hover:text-ink"
                    aria-label={t("payroll.imp.removeColumn", { name: header[c] || t("payroll.imp.column", { n: c + 1 }) })}
                    onclick={() => (m[k] = m[k].filter((x) => x !== c))}>×</button
                  ></Badge>
              {/each}
              <Select
                variant="pill"
                icon="plus"
                label={t("payroll.imp.addColumn")}
                value=""
                options={[{ value: "", label: t("payroll.imp.addColumn") }, ...colOpts.slice(1).filter((o) => !m[k].includes(+o.value))]}
                onchange={(v) => v && (m[k] = [...m[k], +v])} />
            </div>
          </div>
        {/each}
      </div>
      {#if m.net == null}<p class="text-[12px] text-sub">{t("payroll.imp.netMissing")}</p>{/if}

      {#if result}
        {#if result.runs.length}
          <div>
            <h3 class="text-[14px] text-ink">{t("payroll.imp.preview")}</h3>
            <p class="text-[12px] text-sub" data-testid="payroll-import-ready">{t("payroll.imp.ready", { n: fresh.length })}</p>
            <ul class="mt-2 divide-y divide-line rounded-lg border border-line">
              {#each result.runs.slice(0, 8) as r (r.id)}
                <li class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]">
                  <span class="text-sub">{mdy(r.payDate)}</span>
                  <span class="min-w-0 flex-1 truncate text-ink" dir="auto">{r.period}</span>
                  <span class="num text-ink-2">{fmt(r.gross, 2)} / {fmt(r.net, 2)}</span>
                  {#if !fresh.includes(r)}<Badge size="sm">{t("payroll.imp.have")}</Badge>{/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if result.errors.length}
          <div>
            <h3 class="text-[14px] text-ink">{t("payroll.imp.errors")}</h3>
            <ul class="mt-1 list-disc space-y-0.5 ps-5 text-[13px] text-warn">{#each result.errors.slice(0, 10) as e, i (i)}<li>{t(`payroll.imp.err.${e.reason}`, { n: e.line })}</li>{/each}</ul>
          </div>
        {/if}
      {/if}
    {/if}
  </div>
  {#snippet footer()}
    <Button variant="primary" disabled={!fresh.length} onclick={doImport}>{t("payroll.imp.go", { n: fresh.length })}</Button>
  {/snippet}
</Drawer>
