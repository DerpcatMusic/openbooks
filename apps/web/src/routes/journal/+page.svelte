<script lang="ts">
  // Manual journal entries: double-entry adjustments with no bank movement (owner-paid expenses, depreciation, reclasses,
  // accruals). Port of web/src/views/Journal.svelte. Edits stay local until Save; an entry saves only when its debits equal its
  // credits and every line with an amount has a ledger account (./journal.ts).
  import { doc, saveDoc, catLabel, catGroups, mdy, fmt, toast, ent } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Badge, Button, EmptyState, Icon, IconButton, Input, Money, PageHeader, Select } from "#lib/ui/index.ts";
  import { totals, off, problem, clean, blankLine, type Entry } from "./journal.ts";

  let entries = $state<Entry[]>([]),
    dirty = $state(false),
    open = $state<string | null>(null);
  $effect(() => {
    if (!dirty) entries = structuredClone($state.snapshot(doc<Entry[]>("journal")));
  });
  const cur = $derived(ent().currency ?? "ILS");
  const SIDES = ["debit", "credit"] as const;
  const today = () => new Date().toLocaleDateString("sv");
  const bad = $derived(entries.find((e) => problem(e)));
  const edit = (fn: () => void) => {
    fn();
    dirty = true;
  };
  const groups = $derived([{ label: t("journal.pickAccount"), options: [{ value: "ask", label: t("journal.pickAccount") }] }, ...catGroups()]);
  /** catGroups lists every known account; keep an entry's own (maybe since-removed) account selectable too. */
  const groupsFor = (v: string) => (v === "ask" || groups.some((g) => g.options.some((o) => o.value === v)) ? groups : [...groups, { label: catLabel(v), options: [{ value: v, label: catLabel(v) }] }]);

  function add() {
    const id = `je${Date.now().toString(36)}`;
    edit(() => entries.unshift({ id, date: today(), memo: "", lines: [blankLine(), blankLine()] }));
    open = id;
  }
  async function save() {
    if (bad) {
      open = bad.id;
      return toast(problem(bad) === "empty" ? t("journal.needLines") : t("journal.unbalanced"));
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
<svelte:head><title>{t("journal.title")} · OpenBooks</title></svelte:head>

<PageHeader title={t("journal.title")} sub={t("journal.sub")}>
  {#snippet actions()}
    {#if dirty}<Button variant="ghost" onclick={() => (dirty = false)}>{t("journal.discard")}</Button>{/if}
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
      <section class="panel overflow-hidden">
        <button
          class="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 text-start outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset sm:px-5"
          aria-expanded={open === e.id}
          aria-controls="je-{e.id}"
          onclick={() => (open = open === e.id ? null : e.id)}>
          <Icon name="chevron-right" size={14} class="shrink-0 text-sub transition-transform {open === e.id ? 'rotate-90' : 'rtl:-scale-x-100'}" />
          <span class="num w-28 shrink-0 text-[14px] text-sub">{e.date ? mdy(e.date) : ""}</span>
          <span class="min-w-0 flex-1 basis-40 truncate text-[14px] text-ink">
            <bdi>{e.memo || t("journal.untitled")}</bdi>{#if accountsOf(e)}<span class="ms-2 text-sub">{accountsOf(e)}</span>{/if}
          </span>
          {#if diff}<Badge tone="bad">{t("journal.offBy", { amount: fmt(Math.abs(diff), 2) })}</Badge>{/if}
          <Money value={d} currency={cur} class="text-ink" />
        </button>
        {#if open === e.id}
          <div id="je-{e.id}" class="border-t border-line px-4 py-4 sm:px-5">
            <div class="flex flex-wrap gap-3">
              <Input label={t("common.date")} type="date" value={e.date} oninput={(x) => edit(() => (e.date = (x.currentTarget as HTMLInputElement).value))} class="w-44" />
              <Input label={t("journal.memo")} value={e.memo ?? ""} oninput={(x) => edit(() => (e.memo = (x.currentTarget as HTMLInputElement).value))} placeholder={t("journal.memoPlaceholder")} class="min-w-0 flex-1 basis-64" />
            </div>

            <!-- lines: a 4-column grid from sm up; on phones the account takes the full row and debit/credit sit under it -->
            <div class="mt-4 text-[14px]" role="group" aria-label={t("common.ledgerAccount")}>
              <div class="hidden h-9 grid-cols-[minmax(0,1fr)_7rem_7rem_2rem] items-center gap-2 border-b border-line text-[13px] text-sub sm:grid" aria-hidden="true">
                <span>{t("common.ledgerAccount")}</span><span class="text-end">{t("journal.debit")}</span><span class="text-end">{t("journal.credit")}</span><span></span>
              </div>
              {#each e.lines as l, j (j)}
                <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-end gap-2 border-b border-line py-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_2rem] sm:items-center sm:py-1.5">
                  <Select label={t("journal.line", { n: j + 1 })} variant="pill" value={l.account} groups={groupsFor(l.account)} onchange={(v) => edit(() => (l.account = v))} class={["col-span-3 sm:col-span-1", l.account === "ask" ? "[&_select]:text-warn" : ""].join(" ")} />
                  {#each SIDES as k (k)}
                    <label class="flex min-w-0 flex-col gap-0.5">
                      <span class="text-[12px] text-sub sm:sr-only">{t(`journal.${k}`)}<span class="sr-only"> · {t("journal.line", { n: j + 1 })}</span></span>
                      <input
                        inputmode="decimal"
                        dir="ltr"
                        value={l[k] === 0 ? "" : (l[k] ?? "")}
                        oninput={(x) => amount(l, k, x.currentTarget.value)}
                        class="num h-8 w-full min-w-0 rounded-md bg-fill px-2 text-end text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/50 sm:bg-transparent sm:hover:bg-fill sm:focus:bg-fill"
                        placeholder="0.00" />
                    </label>
                  {/each}
                  <IconButton icon="x" size="sm" class="hover:text-bad" label={t("journal.removeLine")} disabled={e.lines.length <= 2} onclick={() => edit(() => e.lines.splice(j, 1))} />
                </div>
              {/each}
              <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_2rem]">
                <div class="col-span-3 sm:col-span-1"><Button size="sm" variant="ghost" icon="plus" onclick={() => edit(() => e.lines.push(blankLine()))}>{t("journal.addLine").replace(/^\+\s*/, "")}</Button></div>
                <div dir="ltr" class="px-2 text-end font-medium"><Money value={d} currency={cur} class="text-ink" /></div>
                <div dir="ltr" class="px-2 text-end font-medium"><Money value={c} currency={cur} class="text-ink" /></div>
                <span></span>
              </div>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
              <span class="flex min-w-0 flex-1 items-center gap-1.5 {diff ? 'text-bad' : 'text-good'}" role="status">
                <Icon name={diff ? "alert" : "check"} size={14} class="shrink-0" />
                {diff ? t("journal.differ", { amount: fmt(Math.abs(diff), 2) }) : t("journal.balanced")}
              </span>
              <Button variant="ghost" size="sm" icon="trash" class="hover:text-bad" onclick={() => edit(() => { entries.splice(i, 1); open = null; })}>{t("journal.deleteEntry")}</Button>
            </div>
          </div>
        {/if}
      </section>
    {/each}
  </div>
  <p class="mt-6 text-[13px] text-sub">{t("journal.howto")}</p>
</div>
