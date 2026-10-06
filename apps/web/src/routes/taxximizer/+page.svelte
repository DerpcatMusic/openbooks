<script lang="ts">
  import { BASE } from "#lib/nav.ts";
  // TAXXIMIZER: run the same business through every structure an Israeli resident could use (osek patur / zair / murshe, Ltd,
  // US LLC, US C-corp), pull every lever (zair vs actual, pension, salary vs dividend) and rank by what you keep after tax, BL,
  // VAT and running costs. All maths: @openbooks/country-il taxximize() and advise(); this page only collects inputs and shows.
  // Inputs are saved per tax year in this business's doc "taxximizer"; the advisor's answers are the person's (doc _app/person).
  import { onMount } from "svelte";
  import { pl } from "@openbooks/core";
  import { advise, il, taxximize, type IlRates, type Structure, type TaxximizeInput } from "@openbooks/country-il";
  import { us } from "@openbooks/country-us";
  import { S, isUS, taxTable, yearTxns, doc, saveDoc, ent, bizLabel, bizType, toast } from "#lib/stores/books.svelte.ts";
  import { t, I, ltr, bidi, has } from "#lib/i18n.svelte.ts";
  import { scramble, axis } from "#lib/privacy.svelte.ts";
  import { basePoints, loadPerson, savePerson, typeOf, withFact, answerOf, normalizeFacts, type Person } from "#lib/person.ts";
  import { Badge, Button, Card, Checkbox, Icon, Input, PageHeader, Segmented, Select, Skeleton, Table } from "#lib/ui/index.ts";
  import type { Column } from "#lib/ui/index.ts";
  import Ask from "./Ask.svelte";

  type Saved = Partial<{ mode: string; revenue: number; expenses: number; vatExpenses: number; clients: TaxximizeInput["clients"]; points: number; paturOk: boolean; fx: number; costs: Record<string, number | undefined> }>;
  const y = $derived(S.year);
  const thisYear = new Date().getFullYear();
  const yearOpts = $derived(
    [...new Set([...(S.data?.years ?? []), thisYear, thisYear + 1])]
      .sort()
      .reverse()
      .map((v) => ({ value: String(v), label: String(v) })),
  );
  const all = $derived(doc<Record<string, Saved>>("taxximizer", {}));
  const saved = $derived(all[y] ?? {});
  const set = (k: keyof Saved, v: unknown) => saveDoc("taxximizer", { ...all, [y]: { ...saved, [k]: v } });
  const num = (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    return v === "" ? undefined : +v;
  };
  const T = $derived(taxTable(y) as unknown as IlRates & { note?: string });
  const U = $derived(taxTable(y, "us") as { costs?: { llc?: number; ccorp?: number }; corpRate?: number });
  const ready = $derived(!!T.ltd && T.blRateReduced != null);

  // defaults from this business's books for the year (US books are in dollars → ₪ at the entered rate)
  const fx = $derived(saved.fx ?? 3.6);
  const P = $derived(pl(yearTxns(y)));
  const toIls = (v: number) => Math.round(isUS() ? v * fx : v);
  // two modes: "books" = this year's real numbers (read-only), "whatif" = type any numbers and play
  const mode = $derived(saved.mode ?? "books"),
    whatif = $derived(mode === "whatif");
  const i = $derived({
    revenue: whatif ? (saved.revenue ?? toIls(P.revenue)) : toIls(P.revenue),
    expenses: whatif ? (saved.expenses ?? toIls(P.cogs + P.opex)) : toIls(P.cogs + P.opex),
    clients: saved.clients ?? (isUS() ? "foreign" : "business"),
    points: saved.points ?? 2.25,
    paturOk: saved.paturOk ?? true,
    fx,
    costs: saved.costs ?? {},
  } satisfies TaxximizeInput);
  const r = $derived(ready ? taxximize({ ...i, vatExpenses: whatif ? (saved.vatExpenses ?? i.expenses) : i.expenses }, T, U) : null);
  const NOW: Record<string, string> = { "osek-patur": "patur", "osek-zair": "murshe", "osek-murshe": "murshe", ltd: "ltd", "llc-disregarded": "llc", "llc-ccorp": "ccorp" };
  const base = $derived(
    r?.rows.find((x) => x.key === NOW[bizType(y) ?? ""] && x.ok) ?? r?.rows.find((x) => x.key === (isUS() ? "llc" : "patur") && x.ok) ?? r?.rows.find((x) => x.ok),
  );
  /** Always shekels (the Taxximizer compares in ₪ whatever the books' currency); through scramble() like every amount. */
  const ils = (n: number) => {
    const v = scramble(n),
      s = (v < 0 ? "−" : "") + "₪" + Math.round(Math.abs(v)).toLocaleString("en-US");
    return I.lang === "he" ? ltr(s) : s;
  };
  // the pack returns i18n key suffixes (label, noteKey, why.k, levers[].k); translated here
  const L = (x: Structure) => t(`taxximizer.label.${x.label}`);
  const levers = (x: Extract<Structure, { ok: true }>) =>
    x.levers.map((l) => t(`taxximizer.lever.${l.k}`, { amount: ils(l.amount ?? 0), salary: ils(l.salary ?? 0), div: ils(l.div ?? 0) })).join(" · ");
  const pct = (n: number) => ltr((i.revenue ? (n / i.revenue) * 100 : 0).toFixed(1) + "%");
  /** Bar = share of the best option's keep, from the amounts as shown (privacy mode: the scrambled ones, so no true ratio leaks). */
  const share = (n: number) => (r?.best ? Math.max(0, Math.min(1, scramble(n) / Math.max(1, ...r.ranked.map((x) => scramble(x.keep))))) : 0);

  // "test it": keep vs revenue, same expense ratio, every structure → where the lines cross is where switching pays
  const COLORS: Record<string, string> = { patur: "var(--color-s1)", murshe: "var(--color-s2)", ltd: "var(--color-s3)", llc: "var(--color-s4)", ccorp: "var(--color-s5)" };
  let cw = $state(640);
  const W = $derived(Math.max(252, cw - 8)), // real pixels: labels stay 11px on a phone; fixed height so the width observer never loops
    H = 220,
    MAXR = $derived(Math.max(300000, i.revenue * 2.5));
  const curve = $derived(
    !ready
      ? []
      : Array.from({ length: 41 }, (_, k) => {
          const rev = (MAXR * k) / 40,
            ratio = i.revenue ? i.expenses / i.revenue : 0;
          return { rev, rows: taxximize({ ...i, revenue: rev, expenses: rev * ratio }, T, U).rows };
        }),
  );
  const keepOf = (x: Structure | undefined) => (x?.ok ? x.keep : 0);
  const maxKeep = $derived(Math.max(1, ...curve.flatMap((c) => c.rows.map(keepOf))));
  const sx = (v: number) => (v / MAXR) * W,
    sy = (v: number) => H - (Math.max(0, v) / maxKeep) * H;
  const line = (key: string) =>
    curve
      .map((c, k) => {
        const x = c.rows.find((z) => z.key === key);
        if (!x?.ok) return "";
        const prev = k && curve[k - 1]!.rows.find((z) => z.key === key)?.ok;
        return `${prev ? "L" : "M"}${sx(c.rev).toFixed(1)},${sy(x.keep).toFixed(1)}`;
      })
      .join("");
  // axis ticks: one privacy factor for the whole axis (axis()), compact so five labels fit on a phone
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const tick = (v: number) => ltr("₪" + compact.format(axis(v)));
  const xTicks = $derived(W < 420 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]);
  let hoverKey = $state<string | null>(null);

  const MODES = $derived(["books", "whatif"].map((key) => ({ key, label: t(`taxximizer.mode.${key}`) })));
  const CLIENTS = $derived(["business", "consumer", "foreign"].map((key) => ({ key, label: t(`taxximizer.clients.${key}`) })));
  const COSTS = ["patur", "zair", "murshe", "ltd", "llc", "ccorp"];

  // ---------- What you should do: playbook moves for everything this person runs, savings from the pack's advisor ----------
  let person = $state<Person | null>(null);
  let legacy = false; // server without /api/person (books.py): answers stay in this business's doc "advisor"
  onMount(async () => {
    while (!S.data) await new Promise((ok) => setTimeout(ok, 50));
    try {
      person = await loadPerson(S.data.entities, S.year);
    } catch {
      legacy = true;
      person = { residence: "il", facts: doc<Person["facts"]>("advisor", {}) };
    }
  });
  const answers = $derived(normalizeFacts(person?.facts ?? {}));
  async function answer(k: string, v: string | number | boolean | undefined) {
    if (!person) return;
    const next = withFact(person, k, v);
    person = next;
    try {
      if (legacy) await saveDoc("advisor", next.facts);
      else await savePerson(next);
    } catch (x) {
      toast(String((x as Error).message || x));
    }
  }
  const PLAYBOOK = [...il.playbook, ...us.playbook];
  const types = $derived([...new Set((S.data?.entities ?? []).map((e) => (e.id === ent().id ? bizType(y) : typeOf(e, y))).filter((x): x is string => !!x))]);
  const ilType = $derived(types.find((x) => x.startsWith("osek-") || x === "ltd") ?? "osek-murshe");
  const multiCountry = $derived(new Set((S.data?.entities ?? []).map((e) => e.currency)).size > 1);
  const tips = $derived(
    ready && person
      ? advise(PLAYBOOK, answers, { y, type: isUS() ? ilType : (bizType(y) ?? ilType), types, turnover: i.revenue, expenses: i.expenses, points: basePoints(answers, y), T, fx })
      : [],
  );
  const saves = $derived(tips.filter((x) => x.status === "save")),
    todo = $derived(tips.filter((x) => x.status === "check")),
    asks = $derived(tips.filter((x) => x.status === "ask" || x.status === "info"));
  const totalSave = $derived(saves.reduce((s, x) => s + x.saving, 0));
  let showAll = $state(false),
    open = $state<string | null>(null);
  const he = $derived(I.lang === "he"); // playbook items carry their own _en / _he text
  const typeLabel = (ty: string) => (has(`biz.${ty}`) ? t(`biz.${ty}`) : ty);

  type Row = Structure;
  const columns: Column<Row>[] = $derived([
    { key: "structure", label: t("taxximizer.th.structure"), wrap: true, class: "min-w-64" },
    { key: "tax", label: t("taxximizer.th.incomeTax"), numeric: true },
    { key: "bl", label: t("taxximizer.th.blHealth"), numeric: true },
    { key: "vatCost", label: t("taxximizer.th.vatCost"), numeric: true },
    { key: "cost", label: t("taxximizer.th.running"), numeric: true },
    { key: "keep", label: t("taxximizer.youKeep"), numeric: true },
  ]);
  const rows = $derived(r ? [...r.ranked, ...r.rows.filter((x) => !x.ok)] : []);
  const hoverRow = (e: PointerEvent) => {
    const k = (e.target as HTMLElement).closest("tr")?.querySelector<HTMLElement>("[data-k]")?.dataset.k;
    hoverKey = k ?? null;
  };
</script>

<PageHeader title={t("taxximizer.title")} sub={t("taxximizer.sub", { flag: ent().flag ?? "", y })}>
  {#snippet actions()}
    <Button variant="ghost" size="sm" icon="user" href="/you">{t("taxximizer.youLink")}</Button>
    {#if multiCountry}<Button variant="ghost" size="sm" icon="external" href="/you#cross-border">{t("taxximizer.crossBorder")}</Button>{/if}
    <Select variant="pill" icon="calendar" label={t("taxximizer.year")} value={String(y)} onchange={(v) => (S.year = +v)} options={yearOpts} />
  {/snippet}
</PageHeader>

<div class="px-4 pt-5 pb-12 sm:px-8">
  {#if !S.data}
    <Skeleton class="h-64" />
  {:else if !ready || !r}
    <Card><p class="text-[14px] text-sub">{t("taxximizer.noRates", { y })}</p></Card>
  {:else}
    <div class="grid gap-4 2xl:grid-cols-[320px_minmax(0,1fr)]">
      <!-- inputs: one column beside the results on wide screens, two columns above them below 2xl (the table needs the width) -->
      <aside class="panel grid h-fit min-w-0 content-start gap-4 p-4 sm:p-5 md:grid-cols-2 2xl:grid-cols-1" aria-label={t("taxximizer.inputs")}>
        <Segmented class="w-full md:col-span-2 2xl:col-span-1" label={t("taxximizer.inputs")} items={MODES} value={mode} onchange={(v) => set("mode", v)} />
        {#if whatif}
          <Input numeric type="number" step="any" label={t("taxximizer.revenue")} value={i.revenue} hint={t("taxximizer.revenueHint", { amount: ils(toIls(P.revenue)), y })} onchange={(e) => set("revenue", num(e))} />
          <Input numeric type="number" step="any" label={t("taxximizer.expenses")} value={i.expenses} hint={t("taxximizer.expensesHint")} onchange={(e) => set("expenses", num(e))} />
          <Input
            numeric
            type="number"
            step="any"
            label={t("taxximizer.vatExpenses")}
            value={saved.vatExpenses ?? i.expenses}
            hint={t("taxximizer.vatExpensesHint")}
            onchange={(e) => set("vatExpenses", num(e))} />
        {:else}
          <dl class="space-y-1.5 text-[14px]">
            <div class="flex gap-3"><dt class="flex-1 text-sub">{t("taxximizer.revenueY", { y })}</dt><dd class="num text-ink">{ils(i.revenue)}</dd></div>
            <div class="flex gap-3"><dt class="flex-1 text-sub">{t("taxximizer.expensesY", { y })}</dt><dd class="num text-ink">{ils(i.expenses)}</dd></div>
            {#if P.uncat}<div class="text-[12px] text-warn">{t("taxximizer.uncat", { amount: ils(Math.abs(toIls(P.uncat))) })}</div>{/if}
            {#if isUS()}<div class="text-[12px] text-faint">{t("taxximizer.dollarBooks", { fx: ltr(String(fx)) })}</div>{/if}
          </dl>
        {/if}
        <div class="text-[13px] text-sub">
          <div>{t("taxximizer.whoPays")}</div>
          <Segmented class="mt-1 w-full" label={t("taxximizer.whoPays")} items={CLIENTS} value={i.clients} onchange={(v) => set("clients", v)} />
          <span class="mt-1 block text-[12px] text-faint">{t(`taxximizer.clientsHint.${i.clients}`)}</span>
        </div>
        <Input numeric type="number" step="any" label={t("taxximizer.points")} value={i.points} hint={t("taxximizer.pointsHint")} onchange={(e) => set("points", num(e))} />
        <Input numeric type="number" step="any" label={t("taxximizer.fx")} value={fx} hint={t(isUS() ? "taxximizer.fxHintUS" : "taxximizer.fxHint")} onchange={(e) => set("fx", num(e))} />
        <Checkbox label={t("taxximizer.paturOk")} description={t("taxximizer.paturOkHint")} checked={i.paturOk} onchange={(v) => set("paturOk", v)} />
        <details class="border-t border-line pt-3 text-[13px] md:col-span-2 2xl:col-span-1">
          <summary class="cursor-pointer text-sub hover:text-ink">{t("taxximizer.costs")}</summary>
          <div class="mt-3 space-y-2">
            {#each COSTS as k (k)}
              <label class="flex items-center gap-2 text-ink-2">
                <span class="min-w-0 flex-1">{t(`taxximizer.cost.${k}`)}</span>
                <input
                  type="number"
                  value={i.costs[k] ?? T.costs?.[k] ?? 0}
                  onchange={(e) => set("costs", { ...i.costs, [k]: num(e) })}
                  dir="ltr"
                  class="num h-8 w-24 shrink-0 rounded-lg border border-line-strong bg-panel px-2 text-end text-[13px] text-ink outline-none focus:ring-2 focus:ring-accent/50" />
              </label>
            {/each}
            <p class="text-[12px] text-faint">
              {t("taxximizer.costsNote", { llc: U.costs?.llc ?? 0, ccorp: U.costs?.ccorp ?? 0 })}
              {#if T.costsNote}<span dir="auto">{T.costsNote}</span>{/if}
            </p>
          </div>
        </details>
      </aside>

      <div class="min-w-0 space-y-4">
        {#if r.best}
          <section class="panel glow p-4 sm:p-5">
            <div class="flex flex-wrap items-start gap-x-3 gap-y-3">
              <Icon name="sparkle" size={20} class="mt-1 shrink-0 text-accent-ink" />
              <div class="min-w-0 flex-1 basis-56">
                <div class="text-[13px] text-sub">{t("taxximizer.keepsMost")}</div>
                <div class="display text-[24px] leading-8 text-ink">{L(r.best)}</div>
                <div class="mt-1 text-[14px] text-ink-2">{levers(r.best)}</div>
              </div>
              <div class="text-end">
                <div class="text-[13px] text-sub">{t("taxximizer.youKeep")}</div>
                <div class="display num text-[28px] leading-8 whitespace-nowrap text-ink">{ils(r.best.keep)}</div>
                {#if base?.ok && base.key !== r.best.key}<div class="text-[13px] text-good">{t("taxximizer.vs", { amount: ils(r.best.keep - base.keep), label: L(base) })}</div>{/if}
              </div>
            </div>
            {#if base}<div class="mt-3 text-[12px] text-faint">{t("taxximizer.setUp", { biz: bidi(bizLabel()), y })}</div>{/if}
          </section>
        {/if}

        <Card title={t("taxximizer.todo")} description={t("taxximizer.todoSub", { types: types.map(typeLabel).join(" + "), y })}>
          {#snippet actions()}
            {#if totalSave}
              <div class="text-end">
                <div class="text-[12px] text-sub">{t("taxximizer.foundSoFar")}</div>
                <div class="display num text-[20px] whitespace-nowrap text-good">{ils(totalSave)}</div>
              </div>
            {/if}
          {/snippet}
          {#if !person}
            <Skeleton class="h-24" />
          {:else}
            <ul class="-mt-2 divide-y divide-line">
              {#each [...saves, ...todo, ...(showAll ? asks : asks.slice(0, 6))] as x (x.item.id)}
                {@const it = x.item}
                <li class="py-3">
                  <button class="flex w-full items-start gap-3 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-accent/60" aria-expanded={open === it.id} onclick={() => (open = open === it.id ? null : it.id)}>
                    <Icon
                      name={x.status === "save" ? "sparkle" : x.status === "check" ? "alert" : "check"}
                      size={16}
                      class="mt-0.5 shrink-0 {x.status === 'save' ? 'text-good' : x.status === 'check' ? 'text-warn' : 'text-faint'}" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-[14px] text-ink">{he ? it.title_he : it.title_en}</span>
                      <span class="block text-[12px] text-sub">
                        {x.status === "ask" ? t("taxximizer.status.ask", { n: x.missing.length }) : x.status === "info" || x.status === "check" ? t(`taxximizer.status.${x.status}`) : he ? it.how_he : it.how_en}
                      </span>
                    </span>
                    <span class="flex shrink-0 flex-col items-end gap-1">
                      {#if x.saving}<span class="num text-[14px] whitespace-nowrap text-good">+{ils(x.saving)}</span>{/if}
                      {#if it.risk && it.risk !== "none"}<Badge size="sm" tone={it.risk === "high" ? "bad" : "warn"}>{t(`taxximizer.risk.${it.risk}`)}</Badge>{/if}
                    </span>
                  </button>
                  {#if open === it.id}
                    <div class="mt-3 space-y-3 ps-7 text-[13px]">
                      {#each it.ask as q (q.key)}
                        <Ask {q} value={answerOf(answers, q.key)} onchange={(v) => answer(q.key, v)} />
                      {/each}
                      <p class="text-ink-2">{he ? it.how_he : it.how_en}</p>
                      <p class="text-[12px] text-faint">{t("taxximizer.rule")} <span dir="ltr" lang="en">{it.rule}</span></p>
                      <p class="text-[12px] text-faint">
                        {#each it.source.split(/\s*;\s*/) as src, n (n)}{#if src.startsWith("http")}<a class="me-2 text-accent-ink hover:underline" href={src} target="_blank" rel="noreferrer">{t("taxximizer.source")}</a>{:else}<span class="me-2" dir="auto">{src}</span>{/if}{/each}{t(it.verified ? "taxximizer.verified" : "taxximizer.unverified")}
                      </p>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
            <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              {#if asks.length > 6}<Button variant="ghost" size="sm" onclick={() => (showAll = !showAll)}>{showAll ? t("taxximizer.showFewer") : t("taxximizer.showAll", { n: asks.length })}</Button>{/if}
              <span class="text-[12px] text-faint">{t("taxximizer.answersOnce")} <a class="text-accent-ink hover:underline" href="{BASE}/you">{t("taxximizer.youLink")}</a></span>
            </div>
          {/if}
        </Card>

        <section class="panel min-w-0 overflow-hidden" role="presentation" onpointerover={hoverRow} onpointerleave={() => (hoverKey = null)}>
          <Table caption={t("taxximizer.title")} {columns} {rows} key={(x) => x.key} selected={(x) => x.key === hoverKey}>
            {#snippet cell(x, c)}
              {#if c.key === "structure"}
                <div class="py-1" data-k={x.key}>
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
                    <span class="size-2.5 shrink-0 rounded-full" style:background={COLORS[x.key]}></span>
                    <span>{L(x)}</span>
                    {#if r.best?.key === x.key}<Badge size="sm" tone="accent">{t("taxximizer.best")}</Badge>{/if}
                    {#if base?.key === x.key}<Badge size="sm">{t("taxximizer.now")}</Badge>{/if}
                  </div>
                  {#if x.ok}
                    <div class="mt-1 text-[12px] text-ink-2">{levers(x)}</div>
                    <div class="mt-1 max-w-[46ch] text-[12px] text-faint">{t(`taxximizer.note.${x.noteKey}`)}</div>
                  {:else}
                    <div class="mt-1 text-[12px] text-bad">{t(`taxximizer.why.${x.why.k}`, { amount: ils(x.why.amount ?? 0) })}</div>
                  {/if}
                </div>
              {:else if x.ok && c.key === "keep"}
                <div class="num text-ink">{ils(x.keep)}</div>
                <div class="text-[12px] text-sub"><span class="num pii">{pct(x.keep)}</span>{#if x.pension} · {t("taxximizer.inPension", { amount: ils(x.pension) })}{/if}</div>
                <div class="ms-auto mt-1 h-1 w-24 overflow-hidden rounded-full bg-fill" role="meter" aria-label={t("taxximizer.keepShare")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share(x.keep) * 100)}>
                  <div class="h-full rounded-full" style:width="{share(x.keep) * 100}%" style:background={COLORS[x.key]}></div>
                </div>
              {:else if x.ok}
                {ils(x[c.key as "tax" | "bl" | "vatCost" | "cost"])}
              {/if}
            {/snippet}
          </Table>
        </section>

        <Card title={t("taxximizer.chartTitle")} description={t("taxximizer.chartSub")}>
          <div bind:clientWidth={cw} class="w-full" dir="ltr">
            <svg viewBox="-4 -6 {W + 8} {H + 28}" width="100%" height={H + 28} role="img" aria-label={t("taxximizer.chartAria")} class="block overflow-visible">
              {#each [0.25, 0.5, 0.75, 1] as g (g)}
                <line x1="0" x2={W} y1={sy(maxKeep * g)} y2={sy(maxKeep * g)} stroke="var(--color-line)" />
                <text x="2" y={sy(maxKeep * g) - 4} class="fill-faint text-[11px]">{tick(maxKeep * g)}</text>
              {/each}
              <line x1={sx(i.revenue)} x2={sx(i.revenue)} y1="0" y2={H} stroke="var(--color-sub)" stroke-dasharray="3 3" />
              {#each Object.keys(COLORS) as key (key)}
                <path d={line(key)} fill="none" stroke={COLORS[key]} stroke-width={hoverKey === key ? 3 : 1.75} opacity={hoverKey && hoverKey !== key ? 0.2 : 1} />
              {/each}
              {#each xTicks as g (g)}
                <text x={sx(MAXR * g)} y={H + 18} text-anchor={g === 0 ? "start" : g === 1 ? "end" : "middle"} class="fill-faint text-[11px]">{tick(MAXR * g)}</text>
              {/each}
            </svg>
          </div>
          <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-sub">
            {#each r.rows as x (x.key)}
              <button class="flex items-center gap-1.5 rounded-sm whitespace-nowrap outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60" onpointerenter={() => (hoverKey = x.key)} onpointerleave={() => (hoverKey = null)} onfocus={() => (hoverKey = x.key)} onblur={() => (hoverKey = null)}>
                <span class="size-2 shrink-0 rounded-full" style:background={COLORS[x.key]}></span>{L(x)}
              </button>
            {/each}
          </div>
        </Card>

        <Card title={t("taxximizer.assumes")}>
          <ul class="list-disc space-y-1 ps-5 text-[13px] text-ink-2">
            {#each [1, 2, 3, 4] as n (n)}<li>{t(`taxximizer.assume.${n}`)}</li>{/each}
            <li>{t("taxximizer.assume.5", { note: bidi(T.ltdNote ?? T.note ?? "") })}</li>
          </ul>
          <p class="mt-3 text-[12px] text-faint">{t("taxximizer.disclaimer")}</p>
        </Card>
      </div>
    </div>
  {/if}
</div>
