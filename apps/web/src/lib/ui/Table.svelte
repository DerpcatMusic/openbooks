<script lang="ts" generics="R">
  // Data table. Scrolls horizontally inside its own container (never widens the page, never clips a column); headers stay on
  // one line; `numeric` columns are end-aligned with tabular figures and never wrap. Text cells stay on one line unless the
  // column has `wrap`. Give `maxHeight` (e.g. "70vh") for a vertically scrolling body with a sticky header — without it the
  // header can't stick, because a horizontal scroll container also clips vertical stickiness.
  // Cells: the `cell` snippet (row, column), else column.value(row), else row[column.key]. `onrowclick` makes rows focusable
  // buttons (Enter/Space). `foot` renders <tfoot> rows (totals); `empty` shows when there are no rows.
  // `stack`: below 640px each row becomes a card (header hidden, every cell labelled by its column), so no column hides off-screen.
  // Sorting is the caller's: a `sortable` column's header is a button that calls `onsort(key)`; `sort` marks the active one.
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
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
    sort,
    onsort,
    stack = false,
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
    sort?: { key: string; dir: "asc" | "desc" } | null;
    onsort?: (key: string) => void;
    stack?: boolean;
    class?: string;
  } = $props();
  const read = (r: R, c: Column<R>) => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]);
  const pad = "px-3 first:ps-4 last:pe-4 sm:first:ps-5 sm:last:pe-5";
  const align = (c: Column<R>) => [c.numeric ? "num text-end whitespace-nowrap" : c.wrap ? "min-w-48" : "whitespace-nowrap", c.class];
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-focusable to scroll) -->
<div data-ui="table" class={["max-w-full overflow-auto overscroll-x-contain", stack && "stack", cls]} style:max-height={maxHeight} role="region" aria-label={caption} tabindex={caption ? 0 : undefined}>
  <table class="w-full border-separate border-spacing-0 text-[14px]">
    {#if caption}<caption class="sr-only">{caption}</caption>{/if}
    <thead>
      <tr>
        {#each columns as c (c.key)}
          <th
            scope="col"
            aria-sort={c.sortable && onsort ? (sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
            class={["sticky top-0 z-[1] h-9 border-b border-line bg-panel font-normal text-[13px] whitespace-nowrap text-sub", pad, c.numeric ? "text-end" : "text-start", c.class]}>
            {#if c.sortable && onsort}
              <button type="button" onclick={() => onsort(c.key)} class="inline-flex items-center gap-1 rounded outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
                {c.label}<Icon name="sort" size={12} class={sort?.key === c.key ? "text-ink" : "text-faint"} />
              </button>
            {:else if c.hideLabel}<span class="sr-only">{c.label}</span>{:else}{c.label}{/if}
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
            <td data-label={c.hideLabel ? undefined : c.label} class={["h-11 border-b border-line py-2 text-ink-2", pad, align(c)]}>
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

<style>
  @media (max-width: 639px) {
    .stack :is(table, tbody, tr, td) {
      display: block;
    }
    .stack thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .stack tr {
      padding: 0.5rem 1rem;
      border-bottom: 1px solid var(--color-line);
    }
    .stack td {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      width: 100%;
      min-width: 0;
      max-width: none;
      height: auto;
      border: 0;
      padding: 0.25rem 0;
      white-space: normal;
      text-align: end;
      overflow-wrap: anywhere;
    }
    .stack td[data-label]::before {
      content: attr(data-label);
      flex-shrink: 0;
      color: var(--color-sub);
      font-size: 13px;
      text-align: start;
    }
  }
</style>
