// Transfer matching: money that left one of your accounts and arrived in another, in the same books or across them (the LLC paying its
// owner's Israeli account). Modelled on autolink.ts: score every fitting (out, in) pair, then assign greedily one-to-one, strongest first.
// Pure and deterministic. The confirmed and rejected pairs live in each entity's doc "transfers"; a rejected pair is never suggested again.
//
// A pair fits when: one row is money out and the other money in; they sit in different accounts (never two rows of one account); they are
// dated within `window` days of each other; and the amounts agree: in one currency within `same` (fees aside, near exact), across currencies
// within `tolerance` after converting at the rate of the day the money left (a missing rate = no match, never 1:1).
import type { EntityMeta, TransferLink } from "@openbooks/schema";
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
  memo?: string | undefined;
  /** What the bank says about the other side (Mercury, Wise): exact converted amount, reference, counterparty. */
  link?: TransferLink | undefined;
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
  /**
   * Rank every same-currency pair before any cross-currency one. A cross-currency amount difference mixes an FX spread with the
   * fee, so the closer-looking pair is often the wrong one (Mercury USD → Wise USD → ILS: the direct Mercury → ILS match can look
   * nearer than the real chain). Off by default, so the one-off transfer dialog keeps its old order.
   */
  preferSame?: boolean;
}
export interface TransferMatch {
  out: TransferRow;
  in: TransferRow;
  /** Days between the sides (from the day the bank said it would land, when it said). */
  gap: number;
  /** How far the amounts differ, as a fraction of the money in. */
  diff: number;
  /** Implied transfer / wire / FX fee in `in.currency` (converted outflow minus received inflow, clamped >= 0). */
  fee: number;
  /** How the bank's own data backs the pair: 2 = exact converted amount or shared reference, 1 = names the other side, 0 = amounts only. */
  evidence: number;
}

export const DEFAULT_WINDOW = 4;
export const SEARCH_WINDOW = 30;
export const refOf = (r: Pick<TransferRow, "entity" | "id">) => `${r.entity}/${r.id}`;
const key = (p: TransferPair) => `${p.out}|${p.in}`;
const shift = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** How far apart the two amounts are (a fraction of the money in) + implied fee, or null when they can't be compared or don't fit. */
function fit(o: TransferRow, i: TransferRow, opt: TransferOptions): { diff: number; fee: number } | null {
  const want = i.amount;
  if (!(want > 0)) return null;
  // the bank said what arrives on the other side: compare with that, near exact, instead of with our own conversion
  const told = o.link?.to?.currency === i.currency ? o.link.to.amount : null;
  const got = told ?? sent(o, i, opt.convert);
  if (got === null) return null;
  const diff = Math.abs(got - want) / want;
  const tol = told !== null || o.currency === i.currency ? (opt.same ?? 0.005) : (opt.tolerance ?? 0.03);
  if (Math.abs(got - want) <= 0.01 || diff <= tol) {
    return { diff, fee: impliedFee(o, i, opt.convert) };
  }
  return null;
}

/** The money out of `o`, in `i`'s currency at the rate of the day it left; null = no rate. */
const sent = (o: TransferRow, i: TransferRow, convert: TransferOptions["convert"]) =>
  o.currency === i.currency ? -o.amount : (convert?.(-o.amount, o.currency, i.currency, o.date) ?? null);

/** What the move cost, in `i`'s currency: sent minus received (wire fee, FX spread against the BoI rate), never below 0. */
export function impliedFee(o: TransferRow, i: TransferRow, convert?: TransferOptions["convert"]): number {
  const got = sent(o, i, convert);
  return got !== null && got > i.amount + 0.01 ? Math.round((got - i.amount) * 100) / 100 : 0;
}

const norm = (x: string | undefined) =>
  (x ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
/** The first word of an account name ("Wise USD" → "wise", "One Zero ••1234" → "one"), the bank it belongs to. */
const bankWord = (account: string) => norm(account).split(" ")[0] ?? "";
/** How strongly the banks' own data ties `o` to `i` (see TransferMatch.evidence). */
export function evidence(o: TransferRow, i: TransferRow): number {
  const to = o.link?.to;
  if (to && to.currency === i.currency && Math.abs(to.amount - i.amount) <= Math.max(0.01, 0.005 * i.amount)) return 2;
  const ref = norm(o.link?.ref);
  if (ref.length >= 4 && (norm(i.link?.ref) === ref || ` ${norm(`${i.desc} ${i.memo ?? ""}`)} `.includes(` ${ref} `))) return 2;
  const names = (p: string | undefined, account: string) => {
    const w = bankWord(account);
    return w.length >= 3 && ` ${norm(p)} `.includes(` ${w} `);
  };
  return names(o.link?.party, i.account) || names(i.link?.party, o.account) ? 1 : 0;
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
  const byDate = [...ins].sort((a, b) => a.date.localeCompare(b.date));
  const first = (d: string) => {
    let lo = 0,
      hi = byDate.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (byDate[m]!.date < d) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  for (const o of outs) {
    // the bank's own estimate of when it lands (a Wise payout, a Mercury wire): measure the gap from that day, not the day it left
    const eta = o.link?.eta,
      valid = !!eta && !Number.isNaN(Date.parse(`${eta}T00:00:00Z`)) && new Date(`${eta}T00:00:00Z`).toISOString().startsWith(eta);
    const at = valid && eta >= o.date ? eta : o.date,
      last = shift(at, window);
    for (let k = first(shift(o.date, -window)); k < byDate.length; k++) {
      const i = byDate[k]!,
        gap = Math.abs(daysBetween(at, i.date));
      if (i.date > last) break;
      if (o.entity === i.entity && o.account === i.account) continue;
      if (gap > window || rejected.has(key({ out: refOf(o), in: refOf(i) }))) continue;
      const m = fit(o, i, opt);
      if (m !== null) out.push({ out: o, in: i, gap, diff: m.diff, fee: m.fee, evidence: evidence(o, i) });
    }
  }
  const filed = (m: TransferMatch) =>
    +!(NOT_FLOW.has(group(m.out.category)) || m.out.category === "ask") + +!(NOT_FLOW.has(group(m.in.category)) || m.in.category === "ask");
  const tier = (m: TransferMatch) => (opt.preferSame && m.out.currency !== m.in.currency ? 1 : 0);
  return out.sort(
    (a, b) =>
      b.evidence - a.evidence ||
      tier(a) - tier(b) ||
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
export function transferCandidates(
  row: TransferRow,
  rows: readonly TransferRow[],
  decided: readonly TransfersDoc[],
  opt: TransferOptions = {},
): TransferMatch[] {
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
 * Detect unconfirmed inter-entity and cross-account transfer legs (e.g., Mercury -> Wise -> Israeli bank, allowing for
 * wire/Wise fees up to 2.5% same-currency and 5% cross-currency FX spread within 7 days) so a merged multi-entity view
 * automatically deduplicates the transferred principal without double-counting income or expenses.
 */
export function detectMergedTransfers(
  rows: readonly TransferRow[],
  decided: readonly TransfersDoc[],
  opt: Pick<TransferOptions, "convert"> = {},
): { matches: TransferMatch[]; dedupRefs: Set<string> } {
  // Only rows still open to being a movement: a row you filed as income or spending is never silently taken out of the totals.
  const movable = rows.filter((r) => r.category === "ask" || NOT_FLOW.has(group(r.category)));
  const matches = suggestTransfers(movable, decided, {
    ...opt,
    window: 7,
    same: 0.025,
    tolerance: 0.05,
    preferSame: true,
  }).filter((m) => m.out.entity !== m.in.entity || m.out.account !== m.in.account);
  const dedupRefs = new Set<string>();
  for (const m of matches) {
    dedupRefs.add(refOf(m.out));
    dedupRefs.add(refOf(m.in));
  }
  return { matches, dedupRefs };
}

/**
 * Chain pairs into journeys, oldest first: a pair continues a journey when it leaves the account the journey's money last landed in
 * (same entity, account and currency), on or up to `window` days after it landed, for about the same amount (within `same`).
 * Mercury → Wise, then Wise → One Zero is one journey of two legs; each pair belongs to exactly one journey.
 */
export function transferJourneys(ms: readonly TransferMatch[], window = 7, same = 0.025): TransferMatch[][] {
  const sorted = [...ms].sort((a, b) => a.out.date.localeCompare(b.out.date) || refOf(a.out).localeCompare(refOf(b.out)));
  const js: TransferMatch[][] = [];
  for (const m of sorted) {
    const j = js.find((j) => {
      const l = j.at(-1)!.in,
        gap = daysBetween(l.date, m.out.date);
      return (
        l.entity === m.out.entity &&
        l.account === m.out.account &&
        l.currency === m.out.currency &&
        gap >= 0 &&
        gap <= window &&
        Math.abs(-m.out.amount - l.amount) <= Math.max(0.01, same * l.amount)
      );
    });
    if (j) j.push(m);
    else js.push([m]);
  }
  return js;
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
