<script lang="ts">
  // Mercury-style review queue: uncategorized transactions grouped by counterparty, one card at a time.
  // Keys: 1–5 pick a suggestion · / search all accounts (or create one) · R toggles "remember as a rule" · → or S skips ·
  // ← goes back · Z undoes the last pick. ← / → follow the reading direction; letters use the physical key (e.code), so they
  // work with a Hebrew keyboard layout too.
  import { payerOf, suggestRule, haystack, group } from "@openbooks/core";
  import type { Txn } from "@openbooks/schema";
  import { S, ent, suggest, catLabel, typeLabel, classify, saveRules, mdy } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { PageHeader, Button, Money, Icon, Badge } from "#lib/ui/index.ts";
  import CategorySelect from "#lib/txns/CategorySelect.svelte";

  type Group = { key: string; ts: Txn[]; total: number };
  const txns = $derived($state.snapshot(S.data?.txns ?? []) as Txn[]);
  const queue = $derived.by((): Group[] => {
    const m = new Map<string, Txn[]>();
    for (const x of txns)
      if (x.category === "ask") {
        const k = payerOf(x),
          g = m.get(k);
        if (g) g.push(x);
        else m.set(k, [x]);
      }
    return [...m]
      .map(([key, ts]) => ({ key, ts, total: ts.reduce((a, x) => a + x.amount, 0) }))
      .sort((a, b) => b.ts.length - a.ts.length || Math.abs(b.total) - Math.abs(a.total));
  });
  const start = S.data?.txns.filter((x) => x.category === "ask").length ?? 0;
  let skipped = $state<string[]>([]),
    done = $state(0),
    remember = $state(true),
    last = $state<{ g: Group; c: string; r?: string } | null>(null),
    picker = $state<{ open: () => Promise<void> }>();
  const pending = $derived(queue.filter((g) => !skipped.includes(g.key)));
  const cur = $derived(pending[0] ?? queue[0]);
  const sugg = $derived(cur ? suggest(cur.ts).slice(0, 5) : []);
  const rule = $derived(cur ? suggestRule(cur.ts) : "");
  const others = $derived(cur && rule ? txns.filter((x) => x.category !== "ask" && haystack(x).includes(rule)).length : 0);
  const left = $derived(queue.reduce((a, g) => a + g.ts.length, 0));
  const progress = $derived(start ? Math.min(1, done / start) : 1);
  const money = $derived(ent().currency ?? "ILS");
  const tags = $derived(cur ? [...new Set(cur.ts.flatMap((x) => [x.account, x.mcat && `Mercury: ${x.mcat}`, x.memo]).filter((v): v is string => !!v))].slice(0, 4) : []);

  async function pick(c: string) {
    const g = cur;
    if (!g) return;
    const r = remember && rule ? rule : undefined;
    last = { g, c, r };
    await classify(
      g.ts.map((x) => x.id),
      c,
      r,
    );
    done += g.ts.length;
  }
  function skip() {
    if (cur) skipped = [...skipped.filter((k) => k !== cur.key), cur.key];
    if (!pending.length) skipped = [];
  }
  const back = () => skipped.length && (skipped = skipped.slice(0, -1));
  async function undo() {
    const l = last;
    if (!l || !S.data) return;
    last = null;
    // a rule came with the pick: dropping it puts the rows back in the queue (the server stores match text trimmed, commas as spaces)
    const m = l.r?.replaceAll(",", " ").trim();
    if (m) await saveRules(S.data.rules.filter(([k, c]) => !(k === m && c.trim() === l.c)));
    else
      await classify(
        l.g.ts.map((x) => x.id),
        "ask",
      );
    done = Math.max(0, done - l.g.ts.length);
  }

  function key(e: KeyboardEvent) {
    const el = e.target as Element | null;
    if (e.metaKey || e.ctrlKey || e.altKey || S.drawer || S.cmd || el?.closest?.("input, textarea, select, [contenteditable], dialog, [popover]")) return;
    if (e.code === "KeyZ") {
      e.preventDefault();
      return void undo();
    }
    if (!cur) return;
    const rtl = document.documentElement.dir === "rtl",
      fwd = rtl ? "ArrowLeft" : "ArrowRight",
      bwd = rtl ? "ArrowRight" : "ArrowLeft";
    const n = /^Digit[1-9]$/.test(e.code) ? +e.code.slice(5) : /^[1-9]$/.test(e.key) ? +e.key : 0;
    if (n && n <= sugg.length) void pick(sugg[n - 1]!);
    else if (e.key === "/" || e.code === "Slash") {
      e.preventDefault();
      void picker?.open();
    } else if (e.code === "KeyR") remember = !remember;
    else if (e.key === fwd || e.code === "KeyS") skip();
    else if (e.key === bwd) back();
    else return;
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={key} />

{#snippet undoBtn()}
  <Button variant="ghost" size="sm" onclick={undo} aria-keyshortcuts="Z">
    {t("review.undo")} “<span class="[unicode-bidi:isolate]">{catLabel(last?.c ?? "")}</span>” <kbd class="ms-1 rounded bg-fill px-1 text-[11px]">Z</kbd>
  </Button>
{/snippet}

<PageHeader title={t("nav.review")} sub={queue.length ? t("review.sub", { n: left, groups: t("review.groups", { n: queue.length }) }) : t("review.caughtUp")}>
  {#snippet actions()}<Button variant="ghost" icon="list" href="/transactions/ask">{t("review.table")}</Button>{/snippet}
  <div
    class="mt-4 h-1 overflow-hidden rounded-full bg-fill"
    role="progressbar"
    aria-label={t("review.progress")}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(progress * 100)}>
    <div class="h-full rounded-full bg-linear-to-r from-accent to-s3 transition-[width] duration-500 rtl:bg-linear-to-l motion-reduce:transition-none" style:width="{progress * 100}%"></div>
  </div>
</PageHeader>

<div class="mx-auto max-w-[720px] px-4 py-6 sm:px-8 sm:py-10">
  {#if !cur}
    <div class="panel glow rise px-6 py-14 text-center sm:px-10">
      <div class="mx-auto grid size-14 place-items-center rounded-full bg-good/15 text-good"><Icon name="check" size={28} /></div>
      <h2 class="display mt-5 text-[22px] text-ink">{t("review.done")}</h2>
      <p class="mt-1 text-[14px] text-sub">{done ? t(remember ? "review.sortedRules" : "review.sorted", { n: done }) : t("review.empty")}</p>
      <div class="mt-6 flex flex-wrap justify-center gap-2">
        <Button href="/home">{t("review.home")}</Button>
        <Button variant="primary" href="/reports">{t("review.seePl")}</Button>
      </div>
      {#if last}<div class="mt-3">{@render undoBtn()}</div>{/if}
    </div>
  {:else}
    {#key cur.key}
      <section class="panel glow rise overflow-hidden" aria-labelledby="rv-title">
        <div class="px-5 pt-6 pb-5 sm:px-8 sm:pt-7 sm:pb-6">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-sub">
            <Badge tone="warn">{t("common.uncategorized")}</Badge>
            <span class="num">
              {t("common.transactions", { n: cur.ts.length })} ·
              {cur.ts.length > 1 ? `${mdy(cur.ts[0]!.date)} – ${mdy(cur.ts.at(-1)!.date)}` : mdy(cur.ts[0]!.date)}
            </span>
          </div>
          <h2 id="rv-title" class="ui-align display mt-3 text-[24px] leading-8 text-ink [overflow-wrap:anywhere] sm:text-[26px]" dir="auto">{cur.key}</h2>
          <div class="display mt-1 text-[30px] leading-10 sm:text-[34px]"><Money value={cur.total} currency={money} plus class={cur.total > 0 ? "text-good" : "text-ink"} /></div>
          {#if tags.length}
            <div class="mt-3 flex flex-wrap gap-1.5 text-[12px]">
              {#each tags as tag (tag)}<span class="max-w-full rounded-full bg-fill px-2 py-0.5 text-ink-2 [overflow-wrap:anywhere]" dir="auto">{tag}</span>{/each}
            </div>
          {/if}
        </div>

        <div class="border-t border-line px-5 py-5 sm:px-8">
          <div class="mb-2.5 text-[13px] text-sub">{sugg.length ? t("combo.suggested") : t("review.choose")}</div>
          <div class="grid gap-1.5 sm:grid-cols-2">
            {#each sugg as c, i (c)}
              <button
                type="button"
                onclick={() => pick(c)}
                aria-keyshortcuts={String(i + 1)}
                class="group flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 py-1.5 text-start outline-none transition hover:border-accent/60 hover:bg-accent/6 focus-visible:ring-2 focus-visible:ring-accent/50">
                <kbd class="grid size-6 shrink-0 place-items-center rounded-md bg-fill text-[12px] text-sub group-hover:bg-accent group-hover:text-white">{i + 1}</kbd>
                <span class="min-w-0 flex-1 text-[14px] text-ink [overflow-wrap:anywhere]">{catLabel(c)}</span>
                <span class="shrink-0 text-[11px] whitespace-nowrap text-faint">{typeLabel(group(c))}</span>
              </button>
            {/each}
            <CategorySelect
              bind:this={picker}
              value=""
              suggestions={sugg}
              onchange={pick}
              class="group flex min-h-11 w-full items-center gap-3 rounded-xl border border-dashed border-line-strong px-3 py-1.5 text-start text-sub outline-none transition hover:border-accent/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
              <kbd class="grid size-6 shrink-0 place-items-center rounded-md bg-fill text-[12px]">/</kbd><span class="min-w-0 flex-1 text-[14px]">{t("review.searchAll")}</span>
            </CategorySelect>
          </div>
          <label class="mt-4 flex cursor-pointer items-start gap-2.5 text-[14px] text-ink-2">
            <input type="checkbox" bind:checked={remember} class="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent" />
            <span class="min-w-0 flex-1">
              {t("review.remember")}
              {#if rule}<span class="text-sub">— {t("review.ruleLabel")} “<bdi>{rule}</bdi>”{others ? ` ${t("review.alsoMatches", { n: others })}` : ""}</span>{/if}
            </span>
            <kbd class="shrink-0 rounded-md bg-fill px-1.5 text-[11px] text-sub">R</kbd>
          </label>
        </div>

        {#if cur.ts.length > 1}
          <ul class="max-h-48 overflow-y-auto border-t border-line px-5 py-3 sm:px-8">
            {#each cur.ts as x (x.id)}
              <li class="flex items-baseline gap-3 py-1 text-[13px]">
                <span class="shrink-0 text-sub num">{mdy(x.date)}</span>
                <span class="ui-align min-w-0 flex-1 truncate text-ink-2" dir="auto" title={x.memo || x.desc}>{x.memo || x.desc}</span>
                <Money value={x.amount} currency={money} />
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/key}

    <div class="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-sub">
      <Button variant="ghost" size="sm" icon="chevron-left" onclick={back} disabled={!skipped.length} aria-keyshortcuts="ArrowLeft">{t("common.back")}</Button>
      <Button variant="ghost" size="sm" iconEnd="chevron-right" onclick={skip} aria-keyshortcuts="ArrowRight S">{t("review.skip")}</Button>
      {#if last}{@render undoBtn()}{/if}
      <span class="ms-auto whitespace-nowrap" aria-live="polite">{t("review.left", { n: pending.length, total: queue.length })}</span>
    </div>
    <p class="mt-6 text-center text-[12px] text-faint max-sm:hidden">{t("review34.keys")}</p>
  {/if}
</div>

