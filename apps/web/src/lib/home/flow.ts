// Sankey data for a period: money in by source → money out by destination, keyed by ledger account or by counterparty.
// Which rows count as money in / out is core's cashIn / cashOut (transfers, owner and own money left out), asked one row at a time
// so this never drifts from the totals shown elsewhere.
import { cashIn, cashOut, payerOf } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import { topN, type FlowItem } from "../ui/sankey.ts";

export type FlowMode = "account" | "payer";
const IN = ["var(--color-s3)", "var(--color-s1)", "var(--color-s5)", "var(--color-s4)", "var(--color-s6)", "var(--color-s6)"];
const OUT = ["var(--color-s2)", "var(--color-s4)", "var(--color-s5)", "var(--color-s1)", "var(--color-s3)", "var(--color-s6)", "var(--color-s6)"];

export const counts = (t: Txn) => (t.amount > 0 ? cashIn([t]) : cashOut([t])) !== 0;

/** Sources and targets, each the largest few plus "Other". `label` names a ledger account; counterparties are their own label. */
export function flowData(ts: readonly Txn[], mode: FlowMode, label: (account: string) => string, other: string) {
  const inn = new Map<string, number>(),
    out = new Map<string, number>();
  for (const t of ts) {
    if (!counts(t)) continue;
    const k = mode === "account" ? t.category : payerOf(t) || "?";
    const m = t.amount > 0 ? inn : out;
    m.set(k, (m.get(k) ?? 0) + Math.abs(t.amount));
  }
  // keys "in:<k>" / "out:<k>": an account can be on both sides (a refund); `flowKey` gives <k> back
  const items = (side: string, m: Map<string, number>, colors: string[], n: number) =>
    topN(
      [...m].map(([k, value]) => ({ key: `${side}:${k}`, label: mode === "account" ? label(k) : k, value, color: "" })),
      n,
      { key: `${side}:~other`, label: other, color: "" },
    ).map((x, i) => ({ ...x, color: x.key.endsWith(":~other") ? "var(--color-s6)" : colors[i % colors.length]! }) as FlowItem);
  return { sources: items("in", inn, IN, 5), targets: items("out", out, OUT, 7) };
}
/** The account or counterparty of a node key; null for Other, surplus, deficit and the middle. */
export const flowKey = (key: string) => {
  const k = key.slice(key.indexOf(":") + 1);
  return /^(in|out):/.test(key) && k !== "~other" ? k : null;
};
