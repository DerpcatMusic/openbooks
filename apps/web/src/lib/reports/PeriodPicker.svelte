<script lang="ts">
  // Date range pill (port of web/src/lib/ui/PeriodPicker.svelte): presets (this/last month, last 3/12 months, YTD, all time),
  // each tax year, and a custom month range. Writes S.period ({ from, to } months) or, for a whole tax year, S.year with
  // S.period = null. On the Popover API like the kit's Menu: top layer, light dismiss, Esc closes and returns focus.
  import { S, period, periodLabel, monthYear } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { Icon, place } from "#lib/ui/index.ts";
  import type { Period } from "@openbooks/core";

  const id = $props.id();
  let btn = $state<HTMLButtonElement>(),
    pop = $state<HTMLElement>(),
    open = $state(false);
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const back = (n: number) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - n);
    return ym(d);
  };
  const now = ym(new Date());
  const years = $derived((S.data?.years ?? []).toReversed());
  const presets = $derived([
    { label: t("period.thisMonth"), p: { from: now, to: now } },
    { label: t("period.lastMonth"), p: { from: back(1), to: back(1) } },
    { label: t("period.last3"), p: { from: back(2), to: now } },
    { label: t("period.last12"), p: { from: back(11), to: now } },
    { label: t("period.ytd"), p: { from: `${now.slice(0, 4)}-01`, to: now } },
    ...(S.data?.years.length ? [{ label: t("period.all"), p: { from: `${S.data.years[0]}-01`, to: `${S.data.years.at(-1)}-12` } }] : []),
  ]);
  const p = $derived(period());
  const same = (a: Period, b: Period) => a.from === b.from && a.to === b.to;
  const label = $derived(S.period ? (presets.find((x) => same(x.p, p))?.label ?? periodLabel(p)) : String(S.year));
  const close = () => {
    pop?.hidePopover();
    btn?.focus();
  };
  const pick = (x: Period) => {
    S.period = x;
    close();
  };
  const year = (y: number) => {
    S.year = y;
    S.period = null;
    close();
  };
  const setFrom = (v: string) => v && (S.period = { from: v, to: v > p.to ? v : p.to });
  const setTo = (v: string) => v && (S.period = { from: v < p.from ? v : p.from, to: v });

  function toggled(e: ToggleEvent) {
    open = e.newState === "open";
    if (!open || !btn || !pop) return;
    const rtl = getComputedStyle(btn).direction === "rtl";
    const at = place(btn.getBoundingClientRect(), { width: pop.offsetWidth, height: pop.offsetHeight }, { width: innerWidth, height: innerHeight }, { align: "end", rtl });
    pop.style.top = `${at.top}px`;
    pop.style.left = `${at.left}px`;
    pop.querySelector<HTMLElement>("[aria-pressed=true]")?.focus();
  }
  const item = "outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
</script>

<button
  bind:this={btn}
  type="button"
  popovertarget="{id}-p"
  aria-expanded={open}
  aria-haspopup="dialog"
  aria-label={t("period.label", { period: label })}
  class="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full bg-fill ps-3 pe-2.5 text-[14px] whitespace-nowrap text-ink-2 transition-colors hover:bg-line-strong hover:text-ink {item}">
  <Icon name="calendar" size={15} /><span>{label}</span><Icon name="chevron-down" size={14} class="opacity-70" />
</button>

<div
  bind:this={pop}
  id="{id}-p"
  popover="auto"
  role="dialog"
  aria-label={t("period.title")}
  ontoggle={toggled}
  class="fixed inset-auto m-0 max-h-[calc(100vh-16px)] w-[min(420px,calc(100vw-16px))] overflow-y-auto rounded-2xl border border-line-strong bg-panel text-[14px] text-ink shadow-[var(--shadow)]">
  <div class="flex max-sm:flex-col">
    <div class="border-line p-1.5 max-sm:grid max-sm:grid-cols-2 max-sm:border-b sm:w-44 sm:shrink-0 sm:border-e">
      {#each presets as x (x.label)}
        <button
          type="button"
          onclick={() => pick(x.p)}
          aria-pressed={!!S.period && same(x.p, p)}
          class="flex w-full items-center rounded-lg px-2.5 py-1.5 text-start {item} {S.period && same(x.p, p) ? 'bg-accent/10 text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink'}"
          >{x.label}</button>
      {/each}
    </div>
    <div class="min-w-0 flex-1 p-4">
      <div class="text-[12px] text-sub">{t("period.taxYear")}</div>
      <div class="mt-2 flex flex-wrap gap-1.5">
        {#each years as y (y)}
          <button
            type="button"
            onclick={() => year(y)}
            aria-pressed={!S.period && S.year === y}
            class="num h-7 rounded-full px-3 text-[13px] {item} {!S.period && S.year === y ? 'bg-ink text-panel' : 'bg-fill text-ink-2 hover:text-ink'}">{y}</button>
        {/each}
      </div>
      <div class="mt-5 text-[12px] text-sub">{t("period.custom")}</div>
      <div class="mt-2 grid gap-2">
        <label class="flex items-center gap-2"
          ><span class="w-12 shrink-0 text-sub">{t("period.from")}</span><input
            type="month"
            dir="ltr"
            value={p.from}
            onchange={(e) => setFrom(e.currentTarget.value)}
            class="h-8 min-w-0 tabular-nums flex-1 rounded-lg border border-line bg-transparent px-2 text-ink {item}" /></label>
        <label class="flex items-center gap-2"
          ><span class="w-12 shrink-0 text-sub">{t("period.to")}</span><input
            type="month"
            dir="ltr"
            value={p.to}
            onchange={(e) => setTo(e.currentTarget.value)}
            class="h-8 min-w-0 tabular-nums flex-1 rounded-lg border border-line bg-transparent px-2 text-ink {item}" /></label>
      </div>
      <div class="mt-3 text-[12px] text-faint">{monthYear(p.from)} – {monthYear(p.to)}</div>
    </div>
  </div>
</div>
