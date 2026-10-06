<script lang="ts">
  // A financial statement table: section heads, indented lines (clickable when they drill into transactions), subtotals and a
  // grand total, one numeric column per entry of `cols`. Same look as the kit's Table, plus what it can't do: full-width
  // section rows and a sticky label column, so wide monthly statements scroll inside their own container on a phone.
  // `change` adds a "change" column comparing column 0 with column 1 (period comparison).
  import { t } from "#lib/i18n.svelte.ts";
  import { Money } from "#lib/ui/index.ts";
  import { change as rel, type Line } from "./statements.ts";

  let {
    lines,
    cols,
    first,
    caption,
    currency,
    change = false,
    userLabels = false,
    onopen,
  }: {
    lines: readonly Line[];
    cols: readonly string[];
    first: string;
    caption: string;
    currency: string;
    change?: boolean;
    /** Line labels are user data (account names): isolated, dir=auto, blurred in privacy mode. */
    userLabels?: boolean;
    onopen?: (l: Line) => void;
  } = $props();
  const pad = "px-3 first:ps-4 last:pe-4 sm:first:ps-5 sm:last:pe-5";
  const pct = (l: Line) => rel(l.v[0] ?? 0, l.v[1] ?? 0);
  const open = (l: Line) => (onopen && l.kind === "line" && l.key ? () => onopen(l) : undefined);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-focusable to scroll) -->
<div data-ui="table" class="st max-w-full overflow-x-auto overscroll-x-contain" role="region" aria-label={caption} tabindex="0">
  <table class="w-full border-separate border-spacing-0 text-[14px]">
    <caption class="sr-only">{caption}</caption>
    <thead>
      <tr>
        <th scope="col" class="sticky start-0 z-[2] h-9 border-b border-line bg-panel text-start text-[13px] font-normal whitespace-nowrap text-sub {pad}">{first}</th>
        {#each cols as c, i (i)}<th scope="col" class="h-9 border-b border-line text-end text-[13px] font-normal whitespace-nowrap text-sub {pad}">{c}</th>{/each}
        {#if change}<th scope="col" class="h-9 border-b border-line text-end text-[13px] font-normal whitespace-nowrap text-sub {pad}">{t("reports.change")}</th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each lines as l, r (r)}
        {@const click = open(l)}
        {#if l.kind === "head"}
          <tr class="head">
            <th scope="colgroup" class="sticky start-0 z-[1] h-9 border-b border-line text-start font-medium text-ink {pad}">{l.label}</th>
            <td colspan={cols.length + (change ? 1 : 0)} class="h-9 border-b border-line {pad}"></td>
          </tr>
        {:else}
          <tr
            class={[l.kind, click && "cursor-pointer outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent/60"]}
            tabindex={click ? 0 : undefined}
            onclick={click}
            onkeydown={click && ((e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), click()))}>
            <th
              scope="row"
              class={[
                "sticky start-0 z-[1] h-11 max-w-[min(20rem,50vw)] min-w-40 border-b border-line py-2 text-start font-normal [overflow-wrap:break-word] sm:min-w-56",
                pad,
                l.kind === "line" ? "ps-8! sm:ps-10! text-ink-2" : "font-medium text-ink",
                l.warn && "text-warn!",
              ]}>
              {#if userLabels && l.kind === "line" && !l.key?.startsWith("type:")}<bdi>{l.label}</bdi>{:else}{l.label}{/if}
            </th>
            {#each l.v as v, i (i)}
              <td class="h-11 border-b border-line text-end whitespace-nowrap {pad}">
                {#if l.kind !== "total" && Math.abs(v) < 0.005}<span class="text-faint">—</span>
                {:else}<Money value={v} {currency} class={[l.kind === "line" ? (l.warn ? "text-warn" : "text-ink-2") : "font-medium text-ink", l.kind === "total" && v < -0.005 && "text-bad!"].filter(Boolean).join(" ")} />{/if}
              </td>
            {/each}
            {#if change}
              {@const c = pct(l)}
              <td class="num h-11 border-b border-line text-end whitespace-nowrap text-sub {pad}" dir="ltr">
                {#if c === null || !isFinite(c)}<span class="text-faint">—</span>{:else}{c > 0 ? "+" : c < 0 ? "−" : ""}{Math.abs(c * 100).toFixed(1)}%{/if}
              </td>
            {/if}
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
</div>

<style>
  /* Sticky label cells need an opaque background; rows tint on hover through it. */
  .st :global(:is(th, td)) {
    background: var(--panel);
  }
  .st :global(tr.head > :is(th, td)) {
    background: var(--side);
  }
  .st :global(tbody tr:not(.head):hover > :is(th, td)) {
    background: linear-gradient(var(--hover), var(--hover)), var(--panel);
  }
  .st :global(tr.total > :is(th, td)) {
    border-top: 1px solid var(--line-strong);
  }
</style>
