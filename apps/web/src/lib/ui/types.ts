// Prop shapes shared by the kit's components (import from "#lib/ui/index.ts").
import type { IconName } from "./icons.ts";

export interface SegmentedItem {
  key: string;
  label?: string;
  icon?: IconName;
  /** Required for icon-only items: becomes the aria-label. */
  title?: string;
  lang?: string;
}

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

export interface Column<R = Record<string, unknown>> {
  key: string;
  label: string;
  /** Numbers: end-aligned, tabular figures, never wrap. */
  numeric?: boolean;
  /** Let long text wrap (min 12rem) instead of widening the table. Default: one line, table scrolls. */
  wrap?: boolean;
  /** Visually hidden header (e.g. an actions column); still read by screen readers. */
  hideLabel?: boolean;
  class?: string;
  value?: (row: R) => unknown;
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  onselect: () => void;
}

export interface BarRow {
  key: string;
  label: string;
  sub?: string;
  v: Record<string, number>;
  [extra: string]: unknown;
}
export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

/** What Field passes to its control snippet. */
export interface FieldA11y {
  id: string;
  describedby: string | undefined;
  invalid: boolean | undefined;
}
