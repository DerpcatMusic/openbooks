// Recurring payments and income of the open books (core recurring()), minus the ones the user dismissed (doc "recurring-dismissed":
// { key: true }). Shared by the Home card, the Reports list and the insights.
import { recurring as detect, recurringBase, type Recurring } from "@openbooks/core";
import { S, doc, saveDoc } from "#lib/stores/books.svelte.ts";

const today = () => new Date().toLocaleDateString("sv");
export const dismissedDoc = () => doc<Record<string, boolean>>("recurring-dismissed", {});
let memo: { txns: unknown; day: string; out: ReturnType<typeof detect> } | null = null;
/** Every active recurring series (computed once per books state). */
export function allRecurring() {
  const txns = S.data?.txns ?? [];
  if (memo?.txns !== txns || memo.day !== today()) memo = { txns, day: today(), out: detect(txns, today()) };
  return memo.out;
}
/** Dismissed by its own key, or by the payer-wide key older dismissals were stored under. */
export const isDismissed = (r: Pick<Recurring, "key">, d = dismissedDoc()) => !!(d[r.key] || d[recurringBase(r.key)]);
export const activeRecurring = () => allRecurring().filter((r) => !isDismissed(r));
export function setDismissed(key: string, on: boolean) {
  const next = { ...dismissedDoc() };
  if (on) next[key] = true;
  else {
    delete next[key];
    delete next[recurringBase(key)];
  }
  return saveDoc("recurring-dismissed", Object.keys(next).length ? next : null);
}
