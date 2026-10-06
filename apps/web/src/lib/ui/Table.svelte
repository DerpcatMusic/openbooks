<script lang="ts" generics="R">
  // Data table. Scrolls horizontally inside its own container (never widens the page, never clips a column); headers stay on
  // one line; `numeric` columns are end-aligned with tabular figures and never wrap. Text cells stay on one line unless the
  // column has `wrap`. Give `maxHeight` (e.g. "70vh") for a vertically scrolling body with a sticky header — without it the
  // header can't stick, because a horizontal scroll container also clips vertical stickiness.
  // Cells: the `cell` snippet (row, column), else column.value(row), else row[column.key]. `onrowclick` makes rows focusable
  // buttons (Enter/Space). `foot` renders <tfoot> rows (totals); `empty` shows when there are no rows.
  import type { Snippet } from "svelte";
  import type { Column } from "./types.ts";
  let {
    columns,
    rows,
    key,
    caption,
    cell,
    foot,
    empty,
    onrowclick,
    selected,
    maxHeight,
    class: cls = "",
  }: {
    columns: Column<R>[];
    rows: readonly R[];
    key?: (row: R, i: number) => string | number;
    caption?: string;
    cell?: Snippet<[R, Column<R>]>;
    foot?: Snippet;
    empty?: Snippet;
    onrowclick?: (row: R) => void;
    selected?: (row: R) => boolean;
    maxHeight?: string;
    class?: string;
  } = $props();
  const read = (r: R, c: Column<R>) => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]);
  const pad = "px-3 first:ps-4 last:pe-4 sm:first:ps-5 sm:last:pe-5";
  const align = (c: Column<R>) => [c.numeric ? "num text-end whitespace-nowrap" : c.wrap ? "min-w-48" : "whitespace-nowrap", c.class];
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-focusable to scroll) -->
<div data-ui="table" class={["max-w-full overflow-auto overscroll-x-contain", cls]} style:max-height={maxHeight} role="region" aria-label={caption} tabindex={caption ? 0 : undefined}>
  <table class="w-full border-separate border-spacing-0 text-[14px]">
    {#if caption}<caption class="sr-only">{caption}</caption>{/if}
    <thead>
      <tr>
        {#each columns as c (c.key)}
          <th scope="col" class={["sticky top-0 z-[1] h-9 border-b border-line bg-panel font-normal text-[13px] whitespace-nowrap text-sub", pad, c.numeric ? "text-end" : "text-start", c.class]}>
            {#if c.hideLabel}<span class="sr-only">{c.label}</span>{:else}{c.label}{/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as r, i (key ? key(r, i) : i)}
        <tr
          tabindex={onrowclick ? 0 : undefined}
          onclick={onrowclick && (() => onrowclick(r))}
          onkeydown={onrowclick && ((e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onrowclick(r)))}
          data-selected={selected?.(r) || undefined}
          class={[
            "transition-colors hover:bg-hover data-selected:bg-accent/9",
            onrowclick && "cursor-pointer outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent/60",
          ]}>
          {#each columns as c (c.key)}
            <td class={["h-11 border-b border-line py-2 text-ink-2", pad, align(c)]}>
              {#if cell}{@render cell(r, c)}{:else}{read(r, c) ?? ""}{/if}
            </td>
          {/each}
        </tr>
      {:else}
        {#if empty}<tr><td colspan={columns.length}>{@render empty()}</td></tr>{/if}
      {/each}
    </tbody>
    {#if foot}<tfoot class="[&_td]:h-11 [&_td]:px-3 [&_td]:font-medium [&_td]:whitespace-nowrap [&_td]:text-ink [&_td:first-child]:ps-4 [&_td:last-child]:pe-4 sm:[&_td:first-child]:ps-5 sm:[&_td:last-child]:pe-5">{@render foot()}</tfoot>{/if}
  </table>
</div>
