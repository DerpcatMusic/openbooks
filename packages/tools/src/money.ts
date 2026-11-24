// Money across the books: the exchange-rate cache, net worth in one currency, and transfer pairs between accounts and entities.
// Shared by the HTTP server (/api/networth, /api/fx, /api/transfers) and the tools (net_worth, vat_report). Logic is in core
// (fx.ts, reports.ts dailyBalances, transfers.ts); this file reads the books and keeps the rates.
import {
  accountCurrencies,
  cashIn,
  cashOut,
  checkAnchors,
  convert,
  currencyOf,
  dailyBalances,
  decideTransfer,
  detectMergedTransfers,
  impliedFee,
  isCard,
  MAX_GAP_DAYS,
  mergeAnchors,
  rateOn,
  refOf,
  suggestTransfers,
  transferAccounts,
  transferCandidates,
  transferJourneys,
  type Anchors,
  type RateTable,
  type TransferMatch,
  type TransferOptions,
  type TransferRow,
  type TransfersDoc,
} from "@openbooks/core";
import { fetchBoiRates } from "@openbooks/importers";
import { Books } from "@openbooks/storage";
import { Data, Effect } from "effect";

export class BadPair extends Data.TaggedError("BadInput")<{ message: string }> {}

const DAY = 86400000;
const shift = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const today = () => new Date().toLocaleDateString("sv");

// ---------- the rate cache: doc(_app, "fx") ----------
/** rates: currency → date → ILS per unit. spans: the range each currency was fetched for (a date inside it without a rate had none). */
export interface FxDoc {
  rates: Record<string, Record<string, number>>;
  spans: Record<string, [string, string]>;
}
/** Network attempts this process made: a failed or empty range isn't retried for an hour (offline stays fast). */
const tried = new Map<string, number>();
const RETRY_MS = 3600_000;

/**
 * The rate table covering `need` (currency → [from, to]), fetching from the Bank of Israel only the ranges the cache lacks (plus the days
 * before `from` that a weekend lookup reaches back to). Offline or failing: whatever the cache has; missing rates stay missing.
 * Today is never marked fetched (the BoI publishes in the afternoon), so it is asked again after RETRY_MS.
 */
export const ensureRates = (need: Readonly<Record<string, readonly [string, string]>>) =>
  Effect.gen(function* () {
    const bs = yield* Books;
    const doc = yield* bs.doc<FxDoc>("_app", "fx", { rates: {}, spans: {} }).pipe(Effect.orDie);
    const rates = { ...doc.rates },
      spans = { ...doc.spans },
      now = today();
    let changed = false;
    for (const [cur, [from, to]] of Object.entries(need)) {
      if (cur === "ILS" || !/^[A-Z]{3}$/.test(cur)) continue;
      const a = shift(from, -MAX_GAP_DAYS),
        b = to < now ? to : now;
      if (a > b) continue;
      const s = spans[cur];
      const gaps: [string, string][] = !s
        ? [[a, b]]
        : [...(a < s[0] ? [[a, shift(s[0], -1)] as [string, string]] : []), ...(b > s[1] ? [[shift(s[1], 1), b] as [string, string]] : [])];
      for (const [x, y] of gaps) {
        const k = `${cur}|${x}|${y}`;
        if (Date.now() - (tried.get(k) ?? 0) < RETRY_MS) continue;
        tried.set(k, Date.now());
        const got = yield* Effect.tryPromise(() => fetchBoiRates(cur, x, y)).pipe(Effect.orElseSucceed(() => null));
        if (!got) continue; // offline: keep the cache as it is
        rates[cur] = { ...rates[cur], ...got };
        const done = y < now ? y : shift(now, -1); // today stays open
        const cur0 = spans[cur];
        spans[cur] = [cur0 && cur0[0] < x ? cur0[0] : x, cur0 && cur0[1] > done ? cur0[1] : done];
        changed = true;
      }
    }
    if (changed) yield* bs.putDoc("_app", "fx", { rates, spans }).pipe(Effect.orDie);
    return rates as RateTable;
  });

/** Rates for these (currency, date) rows: one range per currency. */
export const ratesFor = (rows: readonly { currency: string; date: string }[]) => {
  const need: Record<string, [string, string]> = {};
  for (const { currency: c, date: d } of rows) {
    const r = need[c];
    if (!r) need[c] = [d, d];
    else need[c] = [d < r[0] ? d : r[0], d > r[1] ? d : r[1]];
  }
  return ensureRates(need);
};

// ---------- net worth ----------
export interface NetWorthExcluded {
  entity: string;
  account: string;
  reason: "credits-only";
}
export interface NetWorth {
  currency: string;
  dates: string[];
  series: { entity: string; account: string; currency: string; liability: boolean; values: number[] }[];
  missing: { currency: string; date: string }[];
  /** Unanchored credits-only accounts (e.g. One Zero PDF / bit CSV with only deposits and no outflows or balance) excluded so balances aren't overstated. */
  excluded?: NetWorthExcluded[];
}

/** Every entity's bank and card accounts, one end-of-day balance a day from..to, each converted to `currency` at that day's rate. */
export const netWorth = (currency: string, from: string, to: string) =>
  Effect.map(netWorthDetail(currency, from, to), (n): NetWorth => ({
    ...n,
    series: n.series.map((s) => ({ entity: s.entity, account: s.account, currency: s.currency, liability: s.liability, values: s.values })),
  }));
/** netWorth plus each account's own-currency balances (`native`). */
export const netWorthDetail = (currency: string, from: string, to: string) =>
  Effect.gen(function* () {
    const bs = yield* Books;
    const raw: { entity: string; account: string; currency: string; values: number[] }[] = [];
    const excluded: NetWorthExcluded[] = [];
    let dates: string[] = [];
    for (const e of yield* bs.entities) {
      const txns = yield* bs.ledger(e.id).pipe(Effect.orDie),
        { checks } = yield* bs.checks(e.id).pipe(Effect.orDie),
        stored = yield* bs.doc<Anchors>(e.id, "anchors", {}).pipe(Effect.orDie);
      const base = currencyOf(e),
        cur = accountCurrencies(txns, base);
      const anchors = mergeAnchors(checkAnchors(checks), stored);
      const d = dailyBalances(txns, anchors, from, to);
      dates = d.dates;
      for (const [account, values] of Object.entries(d.balances)) {
        const hasAnchor = (anchors[account]?.length ?? 0) > 0;
        const acctTxns = txns.filter((t) => t.source !== "journal" && t.account === account);
        const isCreditsOnlyFeed = acctTxns.every((t) => t.source === "bit") || (account === "One Zero" && (e as { import?: string }).import !== "all");
        const creditsOnly = !hasAnchor && acctTxns.length > 0 && acctTxns.every((t) => t.amount >= 0) && isCreditsOnlyFeed;
        if (creditsOnly) {
          // A credits-only feed (One Zero PDF, One Zero credits-only sync, bit CSV) never imports withdrawals/spending.
          // Summing all-time deposits without outflows or a balance anchor would fabricate an inflated fake bank balance.
          excluded.push({ entity: e.id, account, reason: "credits-only" });
          continue;
        }
        raw.push({ entity: e.id, account, currency: cur[account] ?? base, values });
      }
    }
    const table = yield* ensureRates(Object.fromEntries([...new Set([currency, ...raw.map((s) => s.currency)])].map((c) => [c, [from, to] as const])));
    const missing = new Map<string, { currency: string; date: string }>();
    const series = raw.map((s) => ({
      entity: s.entity,
      account: s.account,
      currency: s.currency,
      liability: isCard(s.account),
      native: s.values,
      values: s.values.map((v, i) => {
        const x = convert(table, v, s.currency, currency, dates[i]!);
        if (x !== null) return Math.round(x * 100) / 100;
        for (const c of [s.currency, currency]) if (rateOn(table, c, dates[i]!) === null) missing.set(`${c}|${dates[i]}`, { currency: c, date: dates[i]! });
        return 0;
      }),
    }));
    return {
      currency,
      dates,
      series,
      missing: [...missing.values()].sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency)),
      ...(excluded.length ? { excluded } : {}),
    };
  });

// ---------- combined multi-entity money flow ----------
export interface CombinedFlowTxn {
  id: string;
  entity: string;
  entityName: string;
  flag: string;
  account: string;
  date: string;
  category: string;
  desc: string;
  who?: string;
  /** Signed amount converted to the requested display `currency` at Bank of Israel daily rates. */
  amount: number;
  nativeAmount: number;
  nativeCurrency: string;
}

export interface TransferSideOut {
  ref: string;
  entity: string;
  account: string;
  date: string;
  desc: string;
  native: number;
  currency: string;
  /** Absolute amount in the flow's currency. */
  amount: number;
}
export interface TransferJourneyOut {
  legs: { out: TransferSideOut; in: TransferSideOut; fee: number; confirmed: boolean }[];
  sent: number;
  received: number;
  fee: number;
}

export interface CombinedFlow {
  currency: string;
  from: string;
  to: string;
  entities: { id: string; name: string; flag: string; currency: string; accounts: string[] }[];
  txns: CombinedFlowTxn[];
  /**
   * Money moved between your own accounts and businesses in the span, as journeys (Mercury → Wise → One Zero is one journey of two
   * legs). Confirmed legs are filed as transfers; detected ones are only left out of the totals until you confirm or reject them.
   * What each leg cost (wire fee, FX spread against the BoI rate) is booked in `txns` as an expense:bank-fees row and counted as out.
   */
  transfers: {
    /** Sum of what left the first account of each journey. */
    moved: number;
    fees: number;
    /** Detected legs waiting to be confirmed. */
    pending: number;
    journeys: TransferJourneyOut[];
  };
  /** Monthly combined inflows, outflows, and net across all entities in `currency`. */
  monthly: { month: string; in: number; out: number; net: number; moved: number }[];
  /** Worldwide totals and per-entity breakdown after transfer deduplication. */
  totals: {
    in: number;
    out: number;
    net: number;
    uncatCount: number;
    byEntity: { id: string; name: string; flag: string; in: number; out: number; net: number; uncatCount: number }[];
  };
  missing: { currency: string; date: string }[];
}

/**
 * Every entity's real cash-flow transactions (inflows & outflows, excluding internal/inter-entity transfers, owner draws, and loans)
 * in [from, to], converted to `currency` at Bank of Israel daily rates. Also runs fee-aware transfer detection across entities
 * (e.g. Mercury -> Wise -> One Zero) to auto-deduplicate unconfirmed inter-entity transfers and surface their wire/FX fees.
 */
export const combinedFlow = (currency: string, from: string, to: string) =>
  Effect.gen(function* () {
    const bs = yield* Books;
    const raw: {
      entity: string;
      entityName: string;
      flag: string;
      account: string;
      id: string;
      date: string;
      category: string;
      desc: string;
      who?: string;
      nativeAmount: number;
      nativeCurrency: string;
    }[] = [];
    const entities: CombinedFlow["entities"] = [];
    const allTransferRows: TransferRow[] = [];
    const decidedDocs: TransfersDoc[] = [];
    const uncatByEntity = new Map<string, number>();

    for (const e of yield* bs.entities) {
      const txns = yield* bs.ledger(e.id).pipe(Effect.orDie);
      const decided = yield* bs.doc<TransfersDoc>(e.id, "transfers", {}).pipe(Effect.orDie);
      decidedDocs.push(decided);
      const base = currencyOf(e);
      const accts = new Set<string>();
      let uncat = 0;
      for (const t of txns) {
        if (t.source === "journal") continue;
        if (t.date < from || t.date > to) continue;
        if (t.category === "ask") uncat++;
        allTransferRows.push({
          entity: e.id,
          id: t.id,
          date: t.date,
          amount: t.amount,
          currency: t.currency ?? base,
          account: t.account,
          desc: t.desc,
          category: t.category,
          memo: t.memo,
          link: t.link,
        });
        const ok = (t.amount > 0 ? cashIn([t]) : cashOut([t])) !== 0;
        if (!ok) continue;
        accts.add(t.account);
        raw.push({
          entity: e.id,
          entityName: e.short || e.name || e.id,
          flag: e.flag ?? "",
          account: t.account,
          id: t.id,
          date: t.date,
          category: t.category,
          desc: t.desc,
          ...(t.who ? { who: t.who } : {}),
          nativeAmount: t.amount,
          nativeCurrency: t.currency ?? base,
        });
      }
      uncatByEntity.set(e.id, uncat);
      entities.push({
        id: e.id,
        name: e.short || e.name || e.id,
        flag: e.flag ?? "",
        currency: base,
        accounts: [...accts].sort(),
      });
    }

    const currencies = [...new Set([currency, ...raw.map((r) => r.nativeCurrency), ...allTransferRows.map((r) => r.currency)])];
    const table = currencies.length > 1 ? yield* ensureRates(Object.fromEntries(currencies.map((c) => [c, [from, to] as const]))) : {};
    const conv = (a: number, f: string, t: string, d: string) => (f === t ? a : convert(table, a, f, t, d));

    // Every movement in the span: confirmed pairs (both sides in range) plus detected, unconfirmed ones (left out of the totals).
    const { matches, dedupRefs } = detectMergedTransfers(allTransferRows, decidedDocs, { convert: conv });
    const byRef = new Map(allTransferRows.map((r) => [refOf(r), r]));
    const confirmed = new Map<string, { out: TransferRow; in: TransferRow }>();
    for (const d of decidedDocs)
      for (const p of d.confirmed ?? []) {
        const o = byRef.get(p.out),
          i = byRef.get(p.in);
        if (o && i) confirmed.set(`${p.out}|${p.in}`, { out: o, in: i });
      }
    const legs = [
      ...[...confirmed.values()].map((p) => ({ out: p.out, in: p.in, gap: 0, diff: 0, fee: impliedFee(p.out, p.in, conv), evidence: 0, confirmed: true })),
      ...matches.map((m) => ({ ...m, confirmed: false })),
    ];
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const inCur = (r: TransferRow, n: number) => round2(Math.abs(conv(n, r.currency, currency, r.date) ?? 0));
    const side = (r: TransferRow): TransferSideOut => ({
      ref: refOf(r),
      entity: r.entity,
      account: r.account,
      date: r.date,
      desc: r.desc,
      native: r.amount,
      currency: r.currency,
      amount: inCur(r, r.amount),
    });
    const entityName = new Map(entities.map((e) => [e.id, e]));
    const journeys: TransferJourneyOut[] = transferJourneys(legs).map((j) => {
      const ls = j.map((m) => ({
        out: side(m.out),
        in: side(m.in),
        fee: inCur(m.in, m.fee),
        confirmed: (m as (typeof legs)[number]).confirmed,
      }));
      return { legs: ls, sent: ls[0]!.out.amount, received: ls.at(-1)!.in.amount, fee: round2(ls.reduce((a, l) => a + l.fee, 0)) };
    });
    // The cost of moving money is real spending: one expense:bank-fees row per leg, on the sender's side, the day it arrived.
    for (const j of journeys)
      for (const l of j.legs) {
        if (!(l.fee > 0)) continue;
        const e = entityName.get(l.out.entity);
        raw.push({
          entity: l.out.entity,
          entityName: e?.name ?? l.out.entity,
          flag: e?.flag ?? "",
          account: l.out.account,
          id: `fee~${l.in.ref}`,
          date: l.in.date,
          category: "expense:bank-fees",
          desc: `${l.out.account} → ${l.in.account}`,
          nativeAmount: -l.fee,
          nativeCurrency: currency,
        });
      }

    const missing = new Map<string, { currency: string; date: string }>();
    const txns: CombinedFlowTxn[] = [];
    const byMonth = new Map<string, { in: number; out: number }>();
    const byEnt = new Map<string, { in: number; out: number }>();
    for (const e of entities) byEnt.set(e.id, { in: 0, out: 0 });

    for (const r of raw) {
      if (dedupRefs.has(refOf(r))) continue;
      const converted = conv(r.nativeAmount, r.nativeCurrency, currency, r.date);
      if (converted === null) {
        for (const c of [r.nativeCurrency, currency]) {
          if (rateOn(table, c, r.date) === null) missing.set(`${c}|${r.date}`, { currency: c, date: r.date });
        }
        continue;
      }
      const amt = Math.round(converted * 100) / 100;
      txns.push({ ...r, amount: amt });
      const ym = r.date.slice(0, 7);
      const mb = byMonth.get(ym) ?? { in: 0, out: 0 };
      if (amt > 0) mb.in += amt;
      else mb.out += Math.abs(amt);
      byMonth.set(ym, mb);
      const eb = byEnt.get(r.entity) ?? { in: 0, out: 0 };
      if (amt > 0) eb.in += amt;
      else eb.out += Math.abs(amt);
      byEnt.set(r.entity, eb);
    }

    const movedByMonth = new Map<string, number>();
    for (const j of journeys) {
      const ym = j.legs[0]!.out.date.slice(0, 7);
      movedByMonth.set(ym, (movedByMonth.get(ym) ?? 0) + j.sent);
      if (!byMonth.has(ym)) byMonth.set(ym, { in: 0, out: 0 });
    }
    const monthly = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, in: round2(v.in), out: round2(v.out), net: round2(v.in - v.out), moved: round2(movedByMonth.get(month) ?? 0) }));
    const entityBreakdown = entities.map((e) => {
      const v = byEnt.get(e.id) ?? { in: 0, out: 0 };
      return {
        id: e.id,
        name: e.name,
        flag: e.flag,
        in: round2(v.in),
        out: round2(v.out),
        net: round2(v.in - v.out),
        uncatCount: uncatByEntity.get(e.id) ?? 0,
      };
    });
    const totalIn = round2(entityBreakdown.reduce((a, x) => a + x.in, 0));
    const totalOut = round2(entityBreakdown.reduce((a, x) => a + x.out, 0));

    return {
      currency,
      from,
      to,
      entities,
      txns,
      transfers: {
        moved: round2(journeys.reduce((a, j) => a + j.sent, 0)),
        fees: round2(journeys.reduce((a, j) => a + j.fee, 0)),
        pending: legs.filter((l) => !l.confirmed).length,
        journeys: journeys.sort((a, b) => b.legs[0]!.out.date.localeCompare(a.legs[0]!.out.date)),
      },
      monthly,
      totals: {
        in: totalIn,
        out: totalOut,
        net: round2(totalIn - totalOut),
        uncatCount: entityBreakdown.reduce((a, x) => a + x.uncatCount, 0),
        byEntity: entityBreakdown,
      },
      missing: [...missing.values()].sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency)),
    } satisfies CombinedFlow;
  });

// ---------- transfers ----------
/** Every entity's stored transactions as transfer sides, the decided pairs, and a converter at the BoI rates. */
const transferBooks = Effect.gen(function* () {
  const bs = yield* Books;
  const rows: TransferRow[] = [],
    decided: TransfersDoc[] = [],
    metas = new Map<string, { id: string; kind?: string | undefined }>();
  for (const e of yield* bs.entities) {
    metas.set(e.id, e);
    const base = currencyOf(e);
    decided.push(yield* bs.doc<TransfersDoc>(e.id, "transfers", {}).pipe(Effect.orDie));
    for (const t of yield* bs.ledger(e.id).pipe(Effect.orDie))
      if (t.source !== "journal")
        rows.push({
          entity: e.id,
          id: t.id,
          date: t.date,
          amount: t.amount,
          currency: t.currency ?? base,
          account: t.account,
          desc: t.desc,
          category: t.category,
          memo: t.memo,
          link: t.link,
        });
  }
  const table = new Set(rows.map((r) => r.currency)).size > 1 ? yield* ratesFor(rows) : {};
  const opt: TransferOptions = { convert: (a, f, t, d) => convert(table, a, f, t, d) };
  return { rows, decided, metas, opt };
});

/** Suggested pairs with a side in entity `e` (all when omitted). */
export const transferSuggestions = (e?: string, o: Pick<TransferOptions, "window" | "tolerance"> = {}) =>
  Effect.map(transferBooks, ({ rows, decided, opt }) =>
    suggestTransfers(rows, decided, { ...opt, ...o }).filter((m: TransferMatch) => !e || m.out.entity === e || m.in.entity === e),
  );

/** Manual search: the possible other sides of one row (`entity/id`). */
export const transferSearch = (ref: string, window?: number) =>
  Effect.map(transferBooks, ({ rows, decided, opt }) => {
    const row = rows.find((r) => refOf(r) === ref);
    return row ? transferCandidates(row, rows, decided, { ...opt, ...(window ? { window } : {}) }) : [];
  });

/**
 * Confirm or reject a pair. The pair goes into the "transfers" doc of each entity it touches (the close date guards each), and a confirmed
 * pair files both sides through classify: transfer:internal within one entity; the US LLC side equity:owner and the other own:transfer
 * across entities.
 */
export const decideTransferPair = (pair: { out: string; in: string }, as: "confirmed" | "rejected") =>
  Effect.gen(function* () {
    const bs = yield* Books;
    const split = (r: string) => {
      const i = r.indexOf("/");
      return [r.slice(0, i), r.slice(i + 1)] as const;
    };
    const [oe, oid] = split(pair.out),
      [ie, iid] = split(pair.in);
    const es = new Map((yield* bs.entities).map((x) => [x.id, x]));
    const om = es.get(oe),
      im = es.get(ie);
    const has = (e: string, id: string) => Effect.map(bs.ledger(e), (ts) => ts.some((t) => t.id === id));
    if (!om || !im || !(yield* has(oe, oid)) || !(yield* has(ie, iid))) return yield* Effect.fail(new BadPair({ message: "No such transaction in the pair." }));
    for (const e of new Set([oe, ie])) yield* bs.putDoc(e, "transfers", decideTransfer(yield* bs.doc<TransfersDoc>(e, "transfers", {}), pair, as));
    if (as === "confirmed") {
      const acc = transferAccounts(om, im);
      yield* bs.classify(oe, [oid], acc.out);
      yield* bs.classify(ie, [iid], acc.in);
    }
  });
