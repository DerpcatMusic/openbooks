<script lang="ts">
  // The drawer's "Split" block: allocate one bank transaction to several ledger accounts. Amounts are typed as shares in the
  // transaction's own direction (a ₪40 line of a ₪100 payment is 40); a minus makes a line go the other way. A live "left to
  // allocate" counts to the cent, and Save waits until it is exactly zero. Saved as doc "splits" (core splits.ts): the ledger then
  // has one row per line, so reports, tags and deductions follow. Closed periods show the lines but can't change them.
  import { activeTags, baseId, cleanSplit, evenAmounts, pickByGroup, groupMap, remaining, splitProblem, type SplitProblem } from "@openbooks/core";
  import type { SplitLine, TagsDoc, Txn } from "@openbooks/schema";
  import { S, catLabel, closed, closeDate, fmt, isArchived, mdy, saveSplits, splitsDoc, tagsDoc, toast } from "#lib/stores/books.svelte.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { Badge, Button, Icon, IconButton, Money, Select } from "#lib/ui/index.ts";
  import CategorySelect from "./CategorySelect.svelte";
  import TagChip from "./TagChip.svelte";

  let { x, currency }: { x: Txn; currency: string } = $props();
  const me = $props.id();
  type Draft = { account: string; amount: string; memo: string; tags: string[] };

  const id = $derived(baseId(x.id));
  const parts = $derived((S.data?.txns ?? []).filter((r) => baseId(r.id) === id));
  /** The transaction's amount: a split's lines add up to it. */
  const total = $derived(Math.round(parts.reduce((a, r) => a + r.amount, 0) * 100) / 100);
  const sign = $derived(total < 0 ? -1 : 1);
  const isSplit = $derived(x.why === "split");
  const locked = $derived(closed(x.date));
  const tg = $derived($state.snapshot(tagsDoc()) as TagsDoc);
  const tagOf = (g: string) => tg.tags.find((o) => o.id === g);

  let draft = $state<Draft[] | null>(null);
  const mag = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(",", ".")));
  const lines = $derived<SplitLine[]>((draft ?? []).map((d) => ({ account: d.account, amount: sign * (Number.isFinite(mag(d.amount)) ? mag(d.amount) : Number.NaN), ...(d.memo.trim() ? { memo: d.memo } : {}), ...(d.tags.length ? { tags: d.tags } : {}) })));
  /** Left to allocate, in the transaction's direction (positive = still to give a line). */
  const left = $derived(sign * remaining(total, lines));
  const problem = $derived<SplitProblem | null>(draft ? splitProblem(total, lines, (a) => !isArchived(a)) : null);
  const money = (n: number) => String(Math.round(n * 100) / 100);

  function start() {
    const stored = splitsDoc()[id];
    draft = stored
      ? stored.map((l) => ({ account: l.account, amount: money(sign * l.amount), memo: l.memo ?? "", tags: [...(l.tags ?? [])] }))
      : [
          { account: x.category === "ask" ? "" : x.category, amount: money(Math.abs(total)), memo: "", tags: [] },
          { account: "", amount: "", memo: "", tags: [] },
        ];
  }
  const add = () => draft?.push({ account: "", amount: left > 0 ? money(left) : "", memo: "", tags: [] });
  const fill = (d: Draft) => (d.amount = money(mag(d.amount) + left));
  const even = () => {
    if (!draft) return;
    const n = draft.length;
    evenAmounts(Math.abs(total), n).forEach((a, i) => (draft![i]!.amount = money(a)));
  };
  /** One tag per group on a line: the newest pick replaces the other of its group. */
  function addTag(d: Draft, g: string) {
    if (!g) return;
    const groups = groupMap(tg);
    d.tags = [...pickByGroup(groups, [g, ...d.tags.toReversed()])].filter((o) => o === g || d.tags.includes(o));
  }
  const reasons: Record<SplitProblem, string> = {
    lines: "gaps2.split.needTwo",
    amount: "gaps2.split.needAmount",
    account: "gaps2.split.needAccount",
    sum: "gaps2.split.sum",
  };

  async function save() {
    if (!draft || problem) return;
    await saveSplits({ ...splitsDoc(), [id]: cleanSplit(lines) });
    draft = null;
    toast(t("gaps2.split.saved", { n: lines.length }));
  }
  async function unsplit() {
    const before = splitsDoc(),
      { [id]: gone, ...rest } = before;
    if (!gone) return;
    await saveSplits(rest);
    draft = null;
    toast(t("gaps2.split.removed"), { label: t("gaps2.undo"), run: () => void saveSplits({ ...splitsDoc(), [id]: gone }) });
  }
  const field =
    "ui-align h-8 min-w-0 rounded-md bg-fill px-2 text-[14px] text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/50";
</script>

<div class="border-t border-line px-4 py-4 sm:px-5" data-testid="txn-split">
  <div class="flex flex-wrap items-center gap-2">
    <span class="min-w-0 flex-1 text-[13px] text-sub">{t("gaps2.split.title")}</span>
    {#if !draft && !locked}
      {#if isSplit}
        <Button size="sm" icon="edit" onclick={start}>{t("gaps2.split.edit")}</Button>
        <Button size="sm" variant="ghost" icon="trash" class="hover:text-bad" onclick={unsplit}>{t("gaps2.split.unsplit")}</Button>
      {:else}
        <Button size="sm" icon="list" onclick={start} disabled={!total}>{t("gaps2.split.start")}</Button>
      {/if}
    {/if}
  </div>

  {#if locked}
    <p class="mt-2 flex items-center gap-1.5 text-[13px] text-sub"><Icon name="lock" size={13} />{t("close.locked", { date: mdy(closeDate() ?? "") })}</p>
  {/if}

  {#if !draft}
    {#if isSplit}
      <ul class="mt-2 divide-y divide-line text-[14px]">
        {#each parts as r (r.id)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 {r.id === x.id ? 'font-medium' : ''}">
            <span class="min-w-0 flex-1 basis-40 text-ink">{catLabel(r.category)}{#if r.memo && r.memo !== parts[0]?.memo}<span class="ms-2 text-[13px] text-sub" dir="auto">{r.memo}</span>{/if}</span>
            <span class="flex flex-wrap gap-1">{#each r.tags ?? [] as g (g)}{@const o = tagOf(g)}{#if o}<TagChip name={o.name} color={o.color} />{/if}{/each}</span>
            <Money value={r.amount} {currency} class="text-ink" />
          </li>
        {/each}
        <li class="flex items-center gap-3 py-2 text-[13px] text-sub"><span class="flex-1">{t("gaps2.split.total")}</span><Money value={total} {currency} /></li>
      </ul>
    {:else}
      <p class="mt-1 text-[13px] text-faint">{t("gaps2.split.hint")}</p>
    {/if}
  {:else}
    <div class="mt-3 space-y-3" role="group" aria-label={t("gaps2.split.title")}>
      {#each draft as d, i (i)}
        <div class="rounded-xl border border-line p-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="num w-5 text-[13px] text-faint">{i + 1}</span>
            <CategorySelect value={d.account} variant="pill" placeholder={t("gaps2.split.pickAccount")} label={t("gaps2.split.lineAccount", { n: i + 1 })} onchange={(c) => (d.account = c)} />
            <input
              inputmode="decimal"
              dir="ltr"
              value={d.amount}
              oninput={(e) => (d.amount = e.currentTarget.value)}
              placeholder="0.00"
              aria-label={t("gaps2.split.lineAmount", { n: i + 1 })}
              class="{field} num ms-auto w-28 text-end" />
            <IconButton icon="x" size="sm" class="hover:text-bad" label={t("gaps2.split.removeLine", { n: i + 1 })} disabled={draft.length <= 2} onclick={() => draft?.splice(i, 1)} />
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-2 ps-7">
            <input dir="auto" value={d.memo} oninput={(e) => (d.memo = e.currentTarget.value)} placeholder={t("gaps2.split.memo")} aria-label={t("gaps2.split.lineMemo", { n: i + 1 })} class="{field} min-w-32 flex-1 basis-40" />
            {#if left !== 0}<Button size="sm" variant="ghost" onclick={() => fill(d)}>{t("gaps2.split.fill")}</Button>{/if}
          </div>
          {#if tg.tags.length}
            <div class="mt-2 flex flex-wrap items-center gap-1.5 ps-7">
              {#each d.tags as g (g)}
                {@const o = tagOf(g)}
                <button type="button" class="inline-flex items-center gap-1 rounded-full bg-fill px-2.5 py-1 text-[12px] text-ink-2 outline-none hover:bg-line-strong focus-visible:ring-2 focus-visible:ring-accent/50" aria-label={t("gaps2.split.removeTag", { tag: o?.name ?? g })} onclick={() => (d.tags = d.tags.filter((v) => v !== g))}>
                  <bdi>{o?.name ?? g}</bdi><Icon name="x" size={10} />
                </button>
              {/each}
              <Select variant="pill" label={t("gaps2.split.addTag", { n: i + 1 })} value="" options={[{ value: "", label: t("gaps2.split.tag") }, ...activeTags(tg).filter((g) => !d.tags.includes(g.id)).map((g) => ({ value: g.id, label: g.name }))]} onchange={(v) => addTag(d, v)} />
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button size="sm" variant="ghost" icon="plus" onclick={add}>{t("gaps2.split.addLine")}</Button>
      <Button size="sm" variant="ghost" onclick={even}>{t("gaps2.split.even")}</Button>
      <span class="ms-auto flex items-center gap-1.5 text-[14px] {problem === 'sum' || left !== 0 ? 'text-warn' : 'text-good'}" role="status" aria-live="polite" data-testid="split-left">
        <Icon name={left === 0 ? "check" : "alert"} size={14} />
        {#if left === 0}{t("gaps2.split.balanced")}{:else}{left > 0 ? t("gaps2.split.left") : t("gaps2.split.over")}&nbsp;<Money value={Math.abs(left)} {currency} />{/if}
      </span>
    </div>
    <p class="mt-1 text-[12px] text-faint">{t("gaps2.split.of", { total: fmt(Math.abs(total), 2) })} {problem && problem !== "sum" ? `· ${t(reasons[problem])}` : ""}</p>
    <div class="mt-3 flex flex-wrap justify-end gap-2">
      <Button variant="ghost" onclick={() => (draft = null)}>{t("common.cancel")}</Button>
      <Button variant="primary" onclick={save} disabled={!!problem}>{t("gaps2.split.save")}</Button>
    </div>
  {/if}
</div>
