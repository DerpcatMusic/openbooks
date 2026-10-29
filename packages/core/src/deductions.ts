// Deductions (the Taxximizer's smart tags): what each expense is worth for income tax, from the country pack's sourced rule table
// (tables/deductions.json), the tags a transaction carries (tags.ts: tag.tax = { rule, pct }) and the ledger account's default rule
// (coa taxRule). Pure: ledger rows, tags and rules in, per-transaction results, totals, cap use and suggestions out.
// Rule semantics are the table's own: incomeTaxPct is the share of the expense that is deductible; a tag's business-use `pct` multiplies it,
// except where the law has its own formula (IL mobile phone, IL private car, IL home landline), which is coded explicitly in POOLS.
// Not tax advice: every number is only as good as the rule's `confidence`/`unverified`, which the UI shows next to it.
import type { DeductionMove, DeductionRule, TagsDoc, Txn } from "@openbooks/schema";
import { group, payerOf } from "./reports.ts";
import { haystack } from "./rules.ts";
import { baseId } from "./splits.ts";

export type Bucket = "full" | "partial" | "none" | "untreated";
/** A reason, as a code the UI translates ("taxtags.why.<k>"): v = a number (percent, amount), w = a word (tag name, "year"…). */
export interface Why {
  k: string;
  v?: number;
  w?: string;
}
export interface TxnDeduction {
  id: string;
  date: string;
  desc: string;
  category: string;
  gross: number;
  /** Rule id when one applies (a tag's, else the account's); undefined = untreated, or only a business-use % from a tag. */
  rule?: string;
  from: "tag" | "account" | "none";
  /** The tag that decided it (id). */
  tag?: string;
  /** Deductible share of the gross after caps and pooled formulas, 0-100. */
  pct: number;
  deductible: number;
  /** Input VAT that can be reclaimed (VAT-registered IL types only; 0 where the table doesn't say). */
  vatReclaimable: number;
  capped: boolean;
  bucket: Bucket;
  why: Why[];
  /** What the rule asks you to keep (rule.evidence); empty for untreated expenses. */
  evidence: string[];
  /** Deductible money with no attachment on file. */
  receipt: boolean;
}
export interface CapUse {
  rule: string;
  per: string;
  amount: number;
  /** The most used (per year: the year's total; per recipient: the busiest recipient). */
  used: number;
  /** Recipients (or 1 for a yearly cap) whose cap is exhausted. */
  over: number;
}
export interface DeductionResult {
  rows: TxnDeduction[];
  totals: { n: number; gross: number; deductible: number; nonDeductible: number; vatReclaimable: number };
  byBucket: Record<Bucket, { n: number; gross: number; deductible: number }>;
  byRule: { rule: string; n: number; gross: number; deductible: number; vatReclaimable: number }[];
  caps: CapUse[];
  /** false = the deductions don't change tax on this track (IL zair: deemed 30%; foreign-owned US LLC with no US trade): bookkeeping only. */
  taxEffect: boolean;
  effect: "zair" | "noEci" | null;
}
export interface DeductionInput {
  /** Ledger rows; any year (the engine takes `year`). Expenses = outflows on expense / cost-of-revenue accounts. */
  txns: readonly Txn[];
  tags: TagsDoc;
  rules: readonly DeductionRule[];
  /** Ledger account → default rule id (coa doc entry `taxRule`); a tag's rule wins. */
  accountRules?: Readonly<Record<string, string>>;
  /** Business type key of the year ("osek-patur", "llc-disregarded"…). */
  type: string;
  year: number;
  /** The books' currency: caps stated in another currency are shown, not enforced (no fx here). */
  currency: string;
  /** txn id → attachment file names. */
  attachments?: Readonly<Record<string, readonly string[]>>;
  /** VAT rate (0.18) for the VAT-registered Israeli types; without it vatReclaimable is 0. */
  vatRate?: number;
  /** carPrice: IL private car list price for the shovi formula; usTrade: the owner attests a US trade or business (ECI). */
  facts?: { carPrice?: number; usTrade?: boolean };
}

const TRACK: Readonly<Record<string, string>> = {
  "osek-patur": "patur",
  "osek-zair": "zair",
  "osek-murshe": "murshe",
  "llc-ccorp": "c-corp",
  "llc-partnership": "schedule-c", // ponytail: the table has no partnership column; §162 expenses are the same as Schedule C's
};
/** Business type key → the `appliesTo` value of the rule tables. */
export const trackOf = (type: string) => TRACK[type] ?? type;
/** Rules that are year-level adjustments, credits or rate tables, not a share of one expense: never tagged or suggested per transaction. */
const NOT_PER_TXN: ReadonlySet<string> = new Set([
  "il.zair-deemed",
  "il.patur-vat",
  "il.recordkeeping",
  "il.pension",
  "il.insurance.disability",
  "il.bl-deduction",
  "us.qbi",
  "us.se-tax-deduction",
  "us.sec179-bonus-choice",
  "us.foreign-owned-no-eci",
  "us.meals.per-diem",
  "us.vehicle.mileage",
]);
/** Rules a tag or account can point at for this business type. */
export const taggable = (r: DeductionRule, type: string) => !NOT_PER_TXN.has(r.id) && r.appliesTo.includes(trackOf(type));
export const taggableRules = (rules: readonly DeductionRule[], type: string) => rules.filter((r) => taggable(r, type));

/** Per-books edits of the table (doc "taxrules": rule id → fields to replace), so an accountant's number can win over the research. */
export type RuleOverrides = Readonly<Record<string, Partial<Pick<DeductionRule, "incomeTaxPct" | "vatPct" | "cap">>>>;
export const withOverrides = (rules: readonly DeductionRule[], ov: RuleOverrides | null | undefined): DeductionRule[] =>
  rules.map((r) => (ov?.[r.id] ? { ...r, ...ov[r.id] } : r));

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const isExpense = (t: Txn) => t.amount < 0 && ["expense", "cogs"].includes(group(t.category));

/** Rules whose cap is a ceiling on the deduction itself (the other caps in the tables are per-day/trip limits, thresholds or credit bases). */
const MAX_DEDUCTION: ReadonlySet<string> = new Set(["il.keren-hishtalmut", "il.gifts", "us.gifts"]);
/** Rules with their own formula over the year's total, not a flat share. */
const POOL: Readonly<Record<string, "mobile" | "car" | "landline">> = {
  "il.phone.mobile": "mobile",
  "il.phone.landline-home": "landline",
  "il.vehicle.running": "car",
  "il.vehicle.purchase": "car",
  "il.parking-tolls": "car",
};

/** The rule has its own year-level formula, so a tag's business-use % is not applied to it. */
export const hasFormula = (ruleId: string) => ruleId in POOL;

/** Deductible share (0-100) of a rule with a tag's business-use pct; undefined while a share is needed and missing. */
function share(rule: DeductionRule, pct: number | undefined) {
  if (rule.incomeTaxPct === null) return pct;
  return (rule.incomeTaxPct * (pct ?? 100)) / 100;
}

/** The year's pooled formula: the deductible part of `sum` and the reason. */
function pooled(kind: "mobile" | "car" | "landline", sum: number, rule: DeductionRule, year: number, carPrice?: number): { ded: number; why: Why } {
  const v = rule.values ?? {};
  if (kind === "mobile") {
    // not deductible = the lower of 50% of the cost or ₪1,380 a year
    const nonDed = Math.min(sum * (1 - (rule.incomeTaxPct ?? 50) / 100), rule.cap?.amount ?? Infinity);
    return { ded: sum - nonDed, why: { k: "mobileLower", v: rule.cap?.amount ?? 0 } };
  }
  if (kind === "landline") {
    const thr = num(v.threshold, 26600),
      floor = num(v.floor, 2700),
      floorAbove = num(v.floorAbove, 5300);
    return { ded: Math.max(0, sum <= thr ? Math.min(0.8 * sum, sum - floor) : sum - floorAbove), why: { k: "landline" } };
  }
  // private car: max(45% of the costs, costs - the year's shovi); shovi = 12 months x 2.48% of the (capped) list price. ponytail: 12 months of use
  const caps = (v.shoviPriceCap ?? {}) as Record<string, number>,
    cap = caps[String(year)] ?? Math.max(0, ...Object.values(caps));
  const floor = sum * ((rule.incomeTaxPct ?? 45) / 100);
  if (!carPrice) return { ded: floor, why: { k: "carNoPrice", v: rule.incomeTaxPct ?? 45 } };
  const shovi = 12 * num(v.shoviRateTypical, 0.0248) * Math.min(carPrice, cap || carPrice);
  return { ded: Math.min(sum, Math.max(floor, sum - shovi)), why: { k: "carFormula", v: r2(shovi) } };
}

export function deductions(inp: DeductionInput): DeductionResult {
  const byId = new Map(inp.rules.map((r) => [r.id, r])),
    track = trackOf(inp.type),
    taxOf = new Map(inp.tags.tags.map((g) => [g.id, g.tax])),
    vatOn = (track === "murshe" || track === "ltd") && !!inp.vatRate;
  const usable = (id?: string) => {
    const r = id ? byId.get(id) : undefined;
    return r && taggable(r, inp.type) ? r : undefined;
  };
  const effect = track === "zair" ? "zair" : inp.type === "llc-disregarded" && !inp.facts?.usTrade ? "noEci" : null;
  const payer = new Map<string, string>();
  const rows: TxnDeduction[] = [];

  for (const t of inp.txns) {
    if (!isExpense(t) || +t.date.slice(0, 4) !== inp.year) continue;
    const gross = r2(-t.amount),
      tagged = (t.tags ?? []).flatMap((id) => {
        const x = taxOf.get(id);
        return x ? [{ id, ...x }] : [];
      });
    // a tag's rule wins over the account's; with several rule tags the lowest share wins (a "Companion" tag must beat a "Trip" tag)
    const lowest = (x: (typeof tagged)[number]) => share(usable(x.rule)!, x.pct) ?? 0;
    const best = tagged.filter((x) => usable(x.rule)).reduce<(typeof tagged)[number] | undefined>((m, x) => (!m || lowest(x) < lowest(m) ? x : m), undefined);
    const rule = best ? usable(best.rule) : usable(inp.accountRules?.[t.category]);
    const pcts = [best?.pct, ...tagged.filter((x) => !x.rule).map((x) => x.pct)].filter((p): p is number => p !== undefined);
    const pct = pcts.length ? Math.min(...pcts) : undefined;
    const decider = best ?? (rule ? undefined : tagged.find((x) => !x.rule && x.pct === pct)); // the tag that set the share
    const why: Why[] = [];
    let ded = gross;
    if (rule) {
      const s = POOL[rule.id] ? 100 : share(rule, pct); // pooled rules get their formula below
      if (POOL[rule.id] && pct !== undefined) why.push({ k: "pctIgnored" });
      if (s === undefined) why.push({ k: "needsPct" });
      else {
        ded = (gross * s) / 100;
        why.push(best ? { k: "tagRule", w: best.id } : { k: "accountRule" });
        if (pct !== undefined && !POOL[rule.id]) why.push({ k: "usePct", v: pct });
      }
      if (s === undefined) ded = 0;
      if (rule.vatPct === null && vatOn) why.push({ k: "vatUnknown" });
    } else if (pct !== undefined) {
      ded = (gross * pct) / 100;
      why.push({ k: "onlyPct", v: pct });
    }
    payer.set(t.id, payerOf(t));
    rows.push({
      id: t.id,
      date: t.date,
      desc: t.desc,
      category: t.category,
      gross,
      ...(rule ? { rule: rule.id } : {}),
      from: decider ? "tag" : rule ? "account" : "none",
      ...(decider ? { tag: decider.id } : {}),
      pct: 0,
      deductible: ded,
      vatReclaimable: 0,
      capped: false,
      bucket: "untreated",
      why,
      evidence: rule ? [...rule.evidence] : [],
      receipt: false,
    });
  }

  // pooled formulas: one deductible figure for the year's costs of the rule, shared across the transactions by their gross
  for (const kind of ["mobile", "car", "landline"] as const) {
    const pool = rows.filter((r) => r.rule && POOL[r.rule] === kind),
      rule = byId.get(kind === "mobile" ? "il.phone.mobile" : kind === "landline" ? "il.phone.landline-home" : "il.vehicle.running");
    const sum = pool.reduce((a, r) => a + r.gross, 0);
    if (!pool.length || !rule || !sum) continue;
    const { ded, why } = pooled(kind, sum, rule, inp.year, inp.facts?.carPrice);
    for (const r of pool) {
      r.deductible = (r.gross * ded) / sum;
      r.why.push(why);
    }
  }

  // ceilings on the deduction (per year, per recipient), first come first served by date
  const used = new Map<string, number>(),
    capRows: CapUse[] = [];
  for (const r of rows) {
    const rule = r.rule ? byId.get(r.rule) : undefined,
      cap = rule?.cap;
    if (!rule || !cap) continue;
    if (!MAX_DEDUCTION.has(rule.id) || cap.amount === null || cap.currency !== inp.currency) {
      if (cap.per === "day" || cap.per === "trip") r.why.push({ k: "capUnchecked", w: cap.per }); // ponytail: nights/days aren't in the books; add a days field on the trip tag to enforce
      continue;
    }
    const key = `${rule.id}|${cap.per === "recipient" ? payer.get(r.id) : ""}`,
      left = Math.max(0, cap.amount - (used.get(key) ?? 0));
    if (r.deductible > left + 0.005) {
      r.deductible = left;
      r.capped = true;
      r.why.push({ k: "capHit", v: cap.amount, w: cap.per });
    }
    used.set(key, (used.get(key) ?? 0) + r.deductible);
    let c = capRows.find((x) => x.rule === rule.id);
    if (!c) capRows.push((c = { rule: rule.id, per: cap.per, amount: cap.amount, used: 0, over: 0 }));
    c.used = Math.max(c.used, used.get(key)!);
  }
  for (const c of capRows) c.over = [...used].filter(([k, v]) => k.startsWith(`${c.rule}|`) && v >= c.amount - 0.005).length;

  for (const r of rows) {
    const rule = r.rule ? byId.get(r.rule) : undefined;
    r.deductible = r2(r.deductible);
    r.pct = r.gross ? r2((r.deductible / r.gross) * 100) : 0;
    r.bucket = !rule && !r.why.length ? "untreated" : r.deductible <= 0.005 ? "none" : r.deductible >= r.gross - 0.005 ? "full" : "partial";
    if (vatOn && rule?.vatPct) r.vatReclaimable = r2((((r.gross * inp.vatRate!) / (1 + inp.vatRate!)) * rule.vatPct) / 100); // ponytail: assumes the price includes Israeli VAT (foreign suppliers charge none)
    r.receipt = r.deductible > 0 && !(inp.attachments?.[baseId(r.id)]?.length ?? 0);
    if (rule?.vatPct === 0 && vatOn) r.why.push({ k: "vatNone" });
  }

  const sum = (xs: readonly TxnDeduction[], f: (r: TxnDeduction) => number) => r2(xs.reduce((a, r) => a + f(r), 0));
  const bucket = (b: Bucket) => {
    const xs = rows.filter((r) => r.bucket === b);
    return { n: xs.length, gross: sum(xs, (r) => r.gross), deductible: sum(xs, (r) => r.deductible) };
  };
  const ruleIds = [...new Set(rows.flatMap((r) => (r.rule ? [r.rule] : [])))];
  const gross = sum(rows, (r) => r.gross),
    deductible = sum(rows, (r) => r.deductible);
  return {
    rows,
    totals: { n: rows.length, gross, deductible, nonDeductible: r2(gross - deductible), vatReclaimable: sum(rows, (r) => r.vatReclaimable) },
    byBucket: { full: bucket("full"), partial: bucket("partial"), none: bucket("none"), untreated: bucket("untreated") },
    byRule: ruleIds
      .map((rule) => {
        const xs = rows.filter((r) => r.rule === rule);
        return {
          rule,
          n: xs.length,
          gross: sum(xs, (r) => r.gross),
          deductible: sum(xs, (r) => r.deductible),
          vatReclaimable: sum(xs, (r) => r.vatReclaimable),
        };
      })
      .sort((a, b) => b.gross - a.gross),
    caps: capRows,
    taxEffect: effect === null,
    effect,
  };
}

// ---------- suggestions: "tag these as X" ----------
export interface TagSuggestion {
  rule: string;
  /** expense: already counted as an expense, no tax meaning yet; uncategorized: an outflow on "ask" that looks deductible (money not claimed yet). */
  kind: "expense" | "uncategorized";
  ids: string[];
  gross: number;
  /** What the rule would allow of it; null = needs your business-use share first. */
  deductible: number | null;
}
const words = (kw: string, hay: string) => {
  const k = kw.trim().toLowerCase();
  if (!k) return false;
  if ([...k].length > 4) return hay.includes(k);
  const at = (i: number) => (i < 0 || i >= hay.length ? "" : hay[i]!);
  for (let i = hay.indexOf(k); i >= 0; i = hay.indexOf(k, i + 1)) if (!/[\p{L}\p{N}]/u.test(at(i - 1)) && !/[\p{L}\p{N}]/u.test(at(i + k.length))) return true;
  return false; // short keywords ("tea", "gym", "cpa") must stand alone, or "steam" would be a tea
};
/** How many of the rule's keywords / MCC codes the text contains; a multi-word keyword counts double, so "amazon web services" beats "amazon". */
export const matchScore = (r: DeductionRule, t: Pick<Txn, "desc" | "memo" | "mcat">) => {
  const hay = haystack(t).toLowerCase();
  return (
    r.match.keywords.reduce((n, k) => n + (words(k, hay) ? (k.trim().includes(" ") ? 2 : 1) : 0), 0) +
    (r.match.mcc ?? []).filter((m) => new RegExp(`(?<!\\d)${String(m)}(?!\\d)`).test(hay)).length
  );
};

/** Untagged outflows whose text matches a rule, grouped by rule: the best match wins, and a tie goes to the lowest deductible share (the safe reading). */
export function suggestTags(inp: DeductionInput): TagSuggestion[] {
  const taxed = new Set(inp.tags.tags.filter((g) => g.tax).map((g) => g.id)),
    known = taggableRules(inp.rules, inp.type),
    have = new Set(
      deductions(inp)
        .rows.filter((r) => r.bucket !== "untreated")
        .map((r) => r.id),
    );
  const out = new Map<string, TagSuggestion>();
  for (const t of inp.txns) {
    const kind = isExpense(t) ? "expense" : t.amount < 0 && t.category === "ask" && t.source !== "journal" ? "uncategorized" : null;
    if (!kind || +t.date.slice(0, 4) !== inp.year || have.has(t.id) || t.tags?.some((g) => taxed.has(g))) continue;
    let best: DeductionRule | undefined,
      hits = 0;
    for (const r of known) {
      const n = matchScore(r, t);
      if (n > hits || (n === hits && n > 0 && best && (r.incomeTaxPct ?? 100) < (best.incomeTaxPct ?? 100))) ((best = r), (hits = n));
    }
    if (!best) continue;
    const key = `${kind}|${best.id}`,
      s = out.get(key) ?? { rule: best.id, kind, ids: [], gross: 0, deductible: best.incomeTaxPct === null ? null : 0 };
    s.ids.push(t.id);
    s.gross = r2(s.gross + -t.amount);
    if (s.deductible !== null) s.deductible = r2(s.deductible + (-t.amount * best.incomeTaxPct!) / 100);
    out.set(key, s);
  }
  return [...out.values()].sort((a, b) => b.gross - a.gross);
}

// ---------- moves: the table's tax moves that fit the user's facts ----------
/** types: business types it is for; rules: rule-id prefixes the user must have expenses under. Moves not listed here are "other ideas". */
const MOVE_WHEN: Readonly<Record<string, { types?: string[]; rules?: string[] }>> = {
  "il.move.zair-vs-actual": { types: ["zair", "patur", "murshe"] },
  "il.move.keep-receipts-when-zair": { types: ["zair"] },
  "il.move.patur-to-murshe": { types: ["patur", "zair"] },
  "il.move.refreshments-office": { rules: ["il.cafe-work", "il.refreshments"] },
  "il.move.gifts-cap": { rules: ["il.gifts"] },
  "il.move.travel-documentation": { rules: ["il.travel"] },
  "il.move.pension-optimum": { types: ["patur", "zair", "murshe"] },
  "il.move.keren-hishtalmut": { types: ["patur", "zair", "murshe"] },
  "il.move.donation-credit": { rules: ["il.donations"] },
  "il.move.equipment-before-year-end": { types: ["murshe"], rules: ["il.depreciation"] },
  "il.move.vehicle-log": { rules: ["il.vehicle", "il.parking"] },
  "il.move.allocation-number": { types: ["murshe", "ltd"] },
  "il.move.mobile-plan": { rules: ["il.phone.mobile"] },
  "il.move.cash-avoidance": {},
  "us.move.mileage-vs-actual": { rules: ["us.vehicle"] },
  "us.move.log-everything": { rules: ["us.meals", "us.travel", "us.gifts", "us.vehicle"] },
  "us.move.timing-purchases": { rules: ["us.equipment"] },
  "us.move.safe-harbor": { rules: ["us.equipment"] },
  "us.move.retirement": { types: ["schedule-c"] },
  "us.move.sehi": { types: ["schedule-c"] },
  "us.move.home-office": { rules: ["us.homeoffice"] },
  "us.move.hire-spouse": { rules: ["us.travel.companion"] },
  "us.move.qbi": { types: ["schedule-c"] },
  "us.move.eci-election": { types: ["llc-disregarded"] },
  "us.move.startup": { rules: ["us.startup"] },
  "us.move.1099": { rules: ["us.contractors"] },
  "us.move.pay-card": { rules: ["us.contractors"] },
  "us.move.trip-days": { rules: ["us.travel.foreign-allocation", "us.travel.mixed", "us.travel.transport", "us.travel.lodging"] },
};
/** Split the table's moves into those that fit (business type, and expenses under the rules they are about) and the rest. */
export function relevantMoves(moves: readonly DeductionMove[], type: string, ruleIds: Iterable<string>) {
  const have = [...ruleIds],
    track = trackOf(type),
    relevant: DeductionMove[] = [],
    other: DeductionMove[] = [];
  for (const m of moves) {
    const w = MOVE_WHEN[m.id];
    (w && (!w.types || w.types.includes(track) || w.types.includes(type)) && (!w.rules || have.some((id) => w.rules!.some((p) => id.startsWith(p))))
      ? relevant
      : other
    ).push(m);
  }
  return { relevant, other };
}

/** Rules matching a search ("coffee", "קפה", "il.gifts"): label, id or keyword contains the text; label matches first. */
export function searchRules(rules: readonly DeductionRule[], q: string, lang: "en" | "he") {
  const s = q.trim().toLowerCase();
  if (!s) return [...rules];
  const rank = (r: DeductionRule) =>
    r.label[lang].toLowerCase().includes(s) || r.label.en.toLowerCase().includes(s) || r.label.he.includes(s)
      ? 0
      : r.id.includes(s)
        ? 1
        : r.match.keywords.some((k) => k.toLowerCase().includes(s))
          ? 2
          : 3;
  return rules.filter((r) => rank(r) < 3).sort((a, b) => rank(a) - rank(b));
}
