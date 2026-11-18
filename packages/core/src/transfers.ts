// Transfer matching: money that left one of your accounts and arrived in another, in the same books or across them (the LLC paying its
// owner's Israeli account). Modelled on autolink.ts: score every fitting (out, in) pair, then assign greedily one-to-one, strongest first.
// Pure and deterministic. The confirmed and rejected pairs live in each entity's doc "transfers"; a rejected pair is never suggested again.
//
// A pair fits when: one row is money out and the other money in; they sit in different accounts (never two rows of one account); they are
// dated within `window` days of each other; and the amounts agree: in one currency within `same` (fees aside, near exact), across currencies
// within `tolerance` after converting at the rate of the day the money left (a missing rate = no match, never 1:1).
import type { EntityMeta } from "@openbooks/schema";
import { daysBetween } from "./accrual.ts";
import { group, NOT_FLOW } from "./reports.ts";

export interface TransferRow {
  entity: string;
  id: string;
  date: string;
  amount: number;
  currency: string;
  account: string;
  desc: string;
  category: string;
}
/** A decided pair: `${entity}/${txn id}` of the money out and of the money in. */
export interface TransferPair {
  out: string;
  in: string;
}
/** doc "transfers" (per entity; a cross-entity pair is stored in both). */
export interface TransfersDoc {
  confirmed?: TransferPair[];
  rejected?: TransferPair[];
}
export interface TransferOptions {
  /** Days apart the two sides may be. Default 4 (DEFAULT_WINDOW); manual search uses SEARCH_WINDOW. */
  window?: number;
  /** Cross-currency: how far the converted amount may be off, as a fraction. Default 0.03. */
  tolerance?: number;
  /** Same currency: how far the amounts may be off (a fee), as a fraction. Default 0.005. */
  same?: number;
  /** `amount` in `from` as `to` on `date`; null = no rate. */
  convert?: (amount: number, from: string, to: string, date: string) => number | null;
}
export interface TransferMatch {
  out: TransferRow;
  in: TransferRow;
  /** Days between the sides. */
  gap: number;
  /** How far the amounts differ, as a fraction of the money in. */
  diff: number;
}

export const DEFAULT_WINDOW = 4;
export const SEARCH_WINDOW = 30;
export const refOf = (r: Pick<TransferRow, "entity" | "id">) => `${r.entity}/${r.id}`;
const key = (p: TransferPair) => `${p.out}|${p.in}`;

/** How far apart the two amounts are (a fraction of the money in), or null when they can't be compared or don't fit. */
function fit(o: TransferRow, i: TransferRow, opt: TransferOptions): number | null {
  const want = i.amount;
  const got = o.currency === i.currency ? -o.amount : (opt.convert?.(-o.amount, o.currency, i.currency, o.date) ?? null);
  if (got === null || !(want > 0)) return null;
  const diff = Math.abs(got - want) / want;
  const tol = o.currency === i.currency ? (opt.same ?? 0.005) : (opt.tolerance ?? 0.03);
  return Math.abs(got - want) <= 0.01 || diff <= tol ? diff : null;
}

/** Rows that can be a side: a stored transaction (no split line, no journal), not in a pair already decided either way. */
function open(rows: readonly TransferRow[], decided: readonly TransfersDoc[]) {
  const used = new Set(decided.flatMap((d) => (d.confirmed ?? []).flatMap((p) => [p.out, p.in])));
  return rows.filter((r) => r.amount !== 0 && !r.id.includes("~") && !used.has(refOf(r)));
}

/** Every fitting (out, in) pair, best first: closest amount, then nearest date, then a side already filed as a movement, then ids. */
function pairs(outs: readonly TransferRow[], ins: readonly TransferRow[], decided: readonly TransfersDoc[], opt: TransferOptions) {
  const rejected = new Set(decided.flatMap((d) => (d.rejected ?? []).map(key)));
  const window = opt.window ?? DEFAULT_WINDOW;
  const out: TransferMatch[] = [];
  for (const o of outs)
    for (const i of ins) {
      if (o.entity === i.entity && o.account === i.account) continue;
      const gap = Math.abs(daysBetween(o.date, i.date));
      if (gap > window || rejected.has(key({ out: refOf(o), in: refOf(i) }))) continue;
      const diff = fit(o, i, opt);
      if (diff !== null) out.push({ out: o, in: i, gap, diff });
    }
  const filed = (m: TransferMatch) => +!(NOT_FLOW.has(group(m.out.category)) || m.out.category === "ask") + +!(NOT_FLOW.has(group(m.in.category)) || m.in.category === "ask");
  return out.sort(
    (a, b) =>
      Math.round(a.diff * 1e4) - Math.round(b.diff * 1e4) ||
      a.gap - b.gap ||
      filed(a) - filed(b) ||
      refOf(a.out).localeCompare(refOf(b.out)) ||
      refOf(a.in).localeCompare(refOf(b.in)),
  );
}

/** Likely transfers among `rows` (every entity's), each row in at most one pair; decided rows and rejected pairs left out. */
export function suggestTransfers(rows: readonly TransferRow[], decided: readonly TransfersDoc[], opt: TransferOptions = {}): TransferMatch[] {
  const rs = open(rows, decided);
  const used = new Set<string>(),
    out: TransferMatch[] = [];
  for (const m of pairs(
    rs.filter((r) => r.amount < 0),
    rs.filter((r) => r.amount > 0),
    decided,
    opt,
  )) {
    if (used.has(refOf(m.out)) || used.has(refOf(m.in))) continue;
    used.add(refOf(m.out)).add(refOf(m.in));
    out.push(m);
  }
  return out.sort((a, b) => a.out.date.localeCompare(b.out.date) || refOf(a.out).localeCompare(refOf(b.out)));
}

/** Manual search: every possible other side of one row within SEARCH_WINDOW days (unless `window` says otherwise), best first. */
export function transferCandidates(row: TransferRow, rows: readonly TransferRow[], decided: readonly TransfersDoc[], opt: TransferOptions = {}): TransferMatch[] {
  const o = { ...opt, window: opt.window ?? SEARCH_WINDOW },
    rs = open(rows, decided).filter((r) => refOf(r) !== refOf(row));
  return row.amount < 0
    ? pairs(
        [row],
        rs.filter((r) => r.amount > 0),
        decided,
        o,
      )
    : pairs(
        rs.filter((r) => r.amount < 0),
        [row],
        decided,
        o,
      );
}

/**
 * The ledger account each side gets when a pair is confirmed: within one entity both are a transfer between accounts; across entities the
 * US LLC side is the owner's equity (a draw when money leaves it, a contribution when it arrives) and the other side your own money moving.
 */
export function transferAccounts(outEntity: Pick<EntityMeta, "kind"> & { id: string }, inEntity: Pick<EntityMeta, "kind"> & { id: string }) {
  if (outEntity.id === inEntity.id) return { out: "transfer:internal", in: "transfer:internal" };
  const side = (e: Pick<EntityMeta, "kind">) => (e.kind === "us-llc" ? "equity:owner" : "own:transfer");
  return { out: side(outEntity), in: side(inEntity) };
}

/** The doc with a pair added to `confirmed` or `rejected` (and taken out of the other list). */
export function decideTransfer(doc: TransfersDoc, pair: TransferPair, as: "confirmed" | "rejected"): TransfersDoc {
  const other = as === "confirmed" ? "rejected" : "confirmed",
    k = key(pair);
  return {
    ...doc,
    [as]: [...(doc[as] ?? []).filter((p) => key(p) !== k), pair],
    [other]: (doc[other] ?? []).filter((p) => key(p) !== k),
  };
}
