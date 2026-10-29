<script lang="ts">
  // Manual journal entries: double-entry adjustments with no bank movement (owner-paid expenses, depreciation, reclasses,
  // accruals). Port of web/src/views/Journal.svelte. Edits stay local until Save; an entry saves only when it has a debit and a credit
  // line, its debits equal its credits to the cent, every line with an amount has a ledger account that isn't archived, and it isn't
  // dated before the books' start date (./journal.ts, core journal.ts). "Paste from a spreadsheet" turns rows (date, account, debit,
  // credit, memo) into draft entries after a preview with errors; "Duplicate" copies an entry as a new draft.
  import { pasteEntries } from "@openbooks/core";
  import { doc, saveDoc, catLabel, catGroups, allCats, chart, coa, closed, closeDate, startDate, family, mdy, fmt, toast, ent, isArchived } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Dialog, EmptyState, Icon, IconButton, Input, Money, PageHeader, Select } from "#lib/ui/index.ts";
  import { totals, off, problem, clean, blankLine, duplicate, type Entry } from "./journal.ts";

  let entries = $state<Entry[]>([]),
    dirty = $state(false),
    open = $state<string | null>(null);
  $effect(() => {
    if (!dirty) entries = structuredClone($state.snapshot(doc<Entry[]>("journal")));
  });
  const cur = $derived(ent().currency ?? "ILS");
  // an entry already saved with a date on or before the close date is locked (a draft isn't: the server checks it when it's saved)
  const savedDate = $derived(new Map(doc<Entry[]>("journal").map((e) => [e.id, e.date])));
  const locked = (e: Entry) => closed(savedDate.get(e.id) ?? "");
  const SIDES = ["debit", "credit"] as const;
  const today = () => new Date().toLocaleDateString("sv");
  // the books' rules for an entry: archived accounts out, nothing before the entries start date
  const ctx = $derived({ coa: $state.snapshot(coa()), from: startDate() });
  const bad = $derived(entries.find((e) => problem(e, ctx)));
  const edit = (fn: () => void) => {
    fn();
    dirty = true;
  };
  const groups = $derived([{ label: t("journal.pickAccount"), options: [{ value: "ask", label: t("journal.pickAccount") }] }, ...catGroups()]);
  /** catGroups lists every known account; keep an entry's own (maybe since-removed) account selectable too. */
  const groupsFor = (v: string) =>
    v === "ask" || groups.some((g) => g.options.some((o) => o.value === v))
      ? groups
      : [...groups, { label: isArchived(v) ? t("gaps2.journal.archivedGroup") : catLabel(v), options: [{ value: v, label: isArchived(v) ? `${catLabel(v)} ${t("gaps2.journal.archivedMark")}` : catLabel(v) }] }];

  function copy(e: Entry) {
    const id = `je${Date.now().toString(36)}`;
    edit(() => entries.unshift(duplicate($state.snapshot(e) as Entry, id)));
    open = id;
    toast(t("gaps2.journal.duplicated"));
  }

  // ---------- paste from a spreadsheet ----------
  let pasting = $state(false),
    pasted = $state("");
  /** a cell names a ledger account by id ("expense:software"), by its name in the chart, or by its account code */
  const known = $derived.by(() => {
    const m = new Map<string, string>();
    for (const c of allCats()) {
      m.set(c.toLowerCase(), c);
      m.set(catLabel(c).trim().toLowerCase(), c);
    }
    for (const r of chart()) if (!(r.type === "bank" || r.type === "card")) m.set(String(r.code), r.id);
    return m;
  });
  const draft = $derived(pasteEntries(pasted, (cell) => known.get(cell.trim().toLowerCase()) ?? "", { ...ctx, dayFirst: family() === "il" }));
  const draftTotal = $derived(draft.entries.reduce((a, e) => a + e.lines.reduce((x, l) => x + l.debit, 0), 0));
  const skipped = $derived(draft.errors.length + draft.rejected.reduce((a, r) => a + r.rows.length, 0));
  function importPasted() {
    const stamp = Date.now().toString(36);
    edit(() => entries.unshift(...draft.entries.map((e, i): Entry => ({ id: `je${stamp}${i}`, date: e.date, memo: e.memo, lines: e.lines.map((l) => ({ account: l.account, debit: l.debit || "", credit: l.credit || "" })) }))));
    toast(t("gaps2.journal.imported", { n: draft.entries.length }));
    pasting = false;
    pasted = "";
  }

  function add() {
    const id = `je${Date.now().toString(36)}`;
    edit(() => entries.unshift({ id, date: today(), memo: "", lines: [blankLine(), blankLine()] }));
    open = id;
  }
  async function save() {
    if (bad) {
      open = bad.id;
      return toast(t(`gaps2.journal.problem.${problem(bad, ctx)}`, { date: startDate() ? mdy(startDate()!) : "" }));
    }
    await saveDoc("journal", clean($state.snapshot(entries) as Entry[]));
    dirty = false;
    toast(t("journal.saved"));
  }
  function amount(l: Entry["lines"][number], k: "debit" | "credit", v: string) {
    edit(() => {
      l[k] = v;
      if (+v) l[k === "debit" ? "credit" : "debit"] = ""; // a line is a debit or a credit, not both
    });
  }
  function keys(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && dirty) {
      e.preventDefault();
      void save();
    }
  }
  const accountsOf = (e: Entry) => [...new Set(e.lines.filter((l) => l.account !== "ask").map((l) => catLabel(l.account)))].join(" · ");
</script>

<svelte:window onkeydown={keys} />
<PageHeader title={t("journal.title")} sub={t("journal.sub")}>
  {#snippet actions()}
    {#if dirty}<Button variant="ghost" onclick={() => (dirty = false)}>{t("journal.discard")}</Button>{/if}
    <Button icon="upload" onclick={() => (pasting = true)}>{t("gaps2.journal.paste")}</Button>
    <Button icon="plus" onclick={add}>{t("journal.new")}</Button>
    <Button variant="primary" onclick={save} disabled={!dirty}>{t("common.save")}</Button>
  {/snippet}
</PageHeader>

<div class="px-4 pt-5 pb-10 sm:px-8">
  {#if dirty}<p class="mb-3 flex items-center gap-1.5 text-[13px] text-warn" role="status"><Icon name="info" size={14} />{t("journal.unsaved")}</p>{/if}
  {#if !entries.length}
    <div class="panel">
      <EmptyState icon="list" title={t("journal.empty")} text={t("journal.emptyText")}>
        <Button variant="primary" icon="plus" onclick={add}>{t("journal.new")}</Button>
      </EmptyState>
    </div>
  {/if}
  <div class="grid gap-3">
    {#each entries as e, i (e.id)}
      {@const [d, c] = totals(e)}
      {@const diff = off(e)}
      {@const lk = locked(e)}
      {@const why = problem(e, ctx)}
      <section class="panel overflow-hidden">
        <button
          class="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 text-start outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset sm:px-5"
          aria-expanded={open === e.id}
          aria-controls="je-{e.id}"
          onclick={() => (open = open === e.id ? null : e.id)}>
          <Icon name="chevron-right" size={14} class="shrink-0 text-sub transition-transform {open === e.id ? 'rotate-90' : 'rtl:-scale-x-100'}" />
          <span class="num w-28 shrink-0 text-[14px] text-sub">{e.date ? mdy(e.date) : ""}</span>
          {#if lk}<span title={t("close.locked", { date: mdy(closeDate() ?? "") })} class="shrink-0 text-faint"><Icon name="lock" size={14} /></span>{/if}
          <span class="min-w-0 flex-1 basis-40 truncate text-[14px] text-ink">
            <bdi>{e.memo || t("journal.untitled")}</bdi>{#if accountsOf(e)}<span class="ms-2 text-sub">{accountsOf(e)}</span>{/if}
          </span>
          {#if diff}<Badge tone="bad">{t("journal.offBy", { amount: fmt(Math.abs(diff), 2) })}</Badge>{:else if why === "archived" || why === "beforeStart" || why === "noDebit" || why === "noCredit"}<Badge tone="warn">{t(`gaps2.journal.badge.${why}`)}</Badge>{/if}
          <Money value={d} currency={cur} class="text-ink" />
        </button>
        {#if open === e.id}
          <div id="je-{e.id}" class="border-t border-line px-4 py-4 sm:px-5">
            {#if lk}<p class="mb-3 flex items-center gap-1.5 text-[13px] text-sub" role="status"><Icon name="lock" size={14} />{t("close.locked", { date: mdy(closeDate() ?? "") })}</p>{/if}
            <div class="flex flex-wrap gap-3">
              <Input label={t("common.date")} type="date" value={e.date} disabled={lk} oninput={(x) => edit(() => (e.date = (x.currentTarget as HTMLInputElement).value))} class="w-44" />
              <Input label={t("journal.memo")} value={e.memo ?? ""} disabled={lk} oninput={(x) => edit(() => (e.memo = (x.currentTarget as HTMLInputElement).value))} placeholder={t("journal.memoPlaceholder")} class="min-w-0 flex-1 basis-64" />
            </div>

            <!-- lines: a 4-column grid from sm up; on phones the account takes the full row and debit/credit sit under it -->
            <div class="mt-4 text-[14px]" role="group" aria-label={t("common.ledgerAccount")}>
              <div class="hidden h-9 grid-cols-[minmax(0,1fr)_7rem_7rem_2rem] items-center gap-2 border-b border-line text-[13px] text-sub sm:grid" aria-hidden="true">
                <span>{t("common.ledgerAccount")}</span><span class="text-end">{t("journal.debit")}</span><span class="text-end">{t("journal.credit")}</span><span></span>
              </div>
              {#each e.lines as l, j (j)}
                <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-end gap-2 border-b border-line py-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_2rem] sm:items-center sm:py-1.5">
                  <Select label={t("journal.line", { n: j + 1 })} variant="pill" value={l.account} groups={groupsFor(l.account)} disabled={lk} onchange={(v) => edit(() => (l.account = v))} class={["col-span-3 sm:col-span-1", l.account === "ask" ? "[&_select]:text-warn" : ""].join(" ")} />
                  {#each SIDES as k (k)}
                    <label class="flex min-w-0 flex-col gap-0.5">
                      <span class="text-[12px] text-sub sm:sr-only">{t(`journal.${k}`)}<span class="sr-only"> · {t("journal.line", { n: j + 1 })}</span></span>
                      <input
                        inputmode="decimal"
                        dir="ltr"
                        disabled={lk}
                        value={l[k] === 0 ? "" : (l[k] ?? "")}
                        oninput={(x) => amount(l, k, x.currentTarget.value)}
                        class="num h-8 w-full min-w-0 rounded-md bg-fill px-2 text-end text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/50 sm:bg-transparent sm:hover:bg-fill sm:focus:bg-fill"
                        placeholder="0.00" />
                    </label>
                  {/each}
                  <IconButton icon="x" size="sm" class="hover:text-bad" label={t("journal.removeLine")} disabled={lk || e.lines.length <= 2} onclick={() => edit(() => e.lines.splice(j, 1))} />
                </div>
              {/each}
              <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_2rem]">
                <div class="col-span-3 sm:col-span-1"><Button size="sm" variant="ghost" icon="plus" disabled={lk} onclick={() => edit(() => e.lines.push(blankLine()))}>{t("journal.addLine").replace(/^\+\s*/, "")}</Button></div>
                <div dir="ltr" class="px-2 text-end font-medium"><Money value={d} currency={cur} class="text-ink" /></div>
                <div dir="ltr" class="px-2 text-end font-medium"><Money value={c} currency={cur} class="text-ink" /></div>
                <span></span>
              </div>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
              <span class="flex min-w-0 flex-1 items-center gap-1.5 {diff || (why && why !== 'empty') ? 'text-bad' : 'text-good'}" role="status">
                <Icon name={diff || (why && why !== "empty") ? "alert" : "check"} size={14} class="shrink-0" />
                {#if diff}{t("journal.differ", { amount: fmt(Math.abs(diff), 2) })}{:else if why && why !== "empty"}{t(`gaps2.journal.problem.${why}`, { date: startDate() ? mdy(startDate()!) : "" })}{:else}{t("journal.balanced")}{/if}
              </span>
              <Button variant="ghost" size="sm" icon="copy" onclick={() => copy(e)}>{t("gaps2.journal.duplicate")}</Button>
              <Button variant="ghost" size="sm" icon="trash" class="hover:text-bad" disabled={lk} onclick={() => edit(() => { entries.splice(i, 1); open = null; })}>{t("journal.deleteEntry")}</Button>
            </div>
          </div>
        {/if}
      </section>
    {/each}
  </div>
  <p class="mt-6 text-[13px] text-sub">{t("journal.howto")}</p>
</div>

<Dialog bind:open={pasting} title={t("gaps2.journal.pasteTitle")} description={t("gaps2.journal.pasteHelp")} size="lg">
  <label class="block">
    <span class="sr-only">{t("gaps2.journal.pasteTitle")}</span>
    <textarea
      bind:value={pasted}
      rows="7"
      dir="ltr"
      spellcheck="false"
      placeholder={t("gaps2.journal.pastePlaceholder")}
      class="num w-full resize-y rounded-lg border border-line-strong bg-panel px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/50"></textarea>
  </label>
  <p class="mt-1 text-[12px] text-faint">{t("gaps2.journal.pasteGroups")}</p>
  {#if pasted.trim()}
    <div class="mt-3 space-y-3" aria-live="polite">
      {#if draft.entries.length}
        <div>
          <div class="text-[13px] text-good">{t("gaps2.journal.ready", { n: draft.entries.length })} · <Money value={draftTotal} currency={cur} /></div>
          <ul class="mt-1 divide-y divide-line rounded-lg border border-line text-[13px]">
            {#each draft.entries as e, i (i)}
              <li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5">
                <span class="num text-sub">{mdy(e.date)}</span>
                <span class="min-w-0 flex-1 basis-32 truncate text-ink" dir="auto">{e.memo || t("journal.untitled")}</span>
                <span class="text-sub">{t("gaps2.journal.lines", { n: e.lines.length })}</span>
                <Money value={e.lines.reduce((a, l) => a + l.debit, 0)} currency={cur} class="text-ink" />
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if draft.rejected.length}
        <div>
          <div class="text-[13px] text-bad">{t("gaps2.journal.rejected", { n: draft.rejected.length })}</div>
          <ul class="mt-1 space-y-0.5 text-[13px] text-ink-2">
            {#each draft.rejected as r (r.rows.join())}
              <li>{t("gaps2.journal.rows", { n: r.rows.length, rows: r.rows.join(", ") })}: {t(`gaps2.journal.problem.${r.problem}`, { date: startDate() ? mdy(startDate()!) : "" })} <span class="text-sub" dir="auto">({r.memo || r.date})</span></li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if draft.errors.length}
        <div>
          <div class="text-[13px] text-bad">{t("gaps2.journal.errors", { n: draft.errors.length })}</div>
          <ul class="mt-1 space-y-0.5 text-[13px] text-ink-2">
            {#each draft.errors as r (r.row)}<li>{t("gaps2.journal.row", { row: r.row })}: {t(`gaps2.journal.err.${r.problem}`)}</li>{/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (pasting = false)}>{t("common.cancel")}</Button>
    <Button variant="primary" icon="plus" onclick={importPasted} disabled={!draft.entries.length}>{skipped ? t("gaps2.journal.importSome", { n: draft.entries.length, skipped }) : t("gaps2.journal.importN", { n: draft.entries.length })}</Button>
  {/snippet}
</Dialog>
