// Settlement-to-payout gross-to-net reconciliation (ASCAP, music distributors, Polar, Stripe, etc.):
// Turns payer settlement rows (gross - fees - refunds - actual withholding = net) into exact signed SplitLine[]
// tied to the matching bank deposit without double-counting revenue. Re-importing the same settlement is idempotent.
import type { SplitLine, SplitsDoc } from "@openbooks/schema";
import { cleanSplit, remaining, splitProblem } from "./splits.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface SettlementAccounts {
  /** Gross income ledger account (e.g. "revenue:music-royalties" or "revenue:plugin-sales"). */
  gross: string;
  /** Platform / distributor fee account (default "cogs:platform-fees"). */
  fees?: string;
  /** Refunds / chargebacks account (defaults to gross revenue account as a contra line). */
  refunds?: string;
  /** Documented tax withholding account (e.g. "expense:foreign-withholding" or "equity:tax-withheld"). */
  withholding?: string;
}

export interface SettlementPayerConfig {
  /** Payer identifier (e.g. "ascap", "polar", "stripe"). */
  payer: string;
  /** Beneficial legal seller / payee (e.g. "Personal" vs "Dolmen Gate LLC"). */
  seller: string;
  /** Date from which this seller / payee contract takes effect (YYYY-MM-DD); earlier earning periods are flagged. */
  effectiveDate?: string;
  /** Default accounts used when splitting matched bank deposits. */
  accounts: SettlementAccounts;
  /** Optional substring to match against bank transaction description / memo (case-insensitive). */
  bankMatch?: string;
  /** Max calendar days between settlement date and bank deposit date (default 10). */
  dateWindowDays?: number;
}

export interface SettlementRow {
  /** Stable external id from the payer statement (ensures idempotent re-import). */
  externalId: string;
  payer: string;
  /** Settlement / payout date (YYYY-MM-DD). */
  date: string;
  /** Optional earning / rights period ("2026-Q1", "2026-03", etc.) kept separate from settlement date. */
  rightsPeriod?: string;
  /** Optional territory / source country for treaty & basket analysis. */
  territory?: string;
  currency: string;
  /** Gross revenue before fees, refunds, and withholding (positive). */
  gross: number;
  /** Platform / distributor fees (positive magnitude; emitted as negative split line). */
  fees: number;
  /** Refunds / adjustments (positive magnitude; emitted as negative split line). */
  refunds: number;
  /** Actual documented tax withheld (positive magnitude; never invented from a default rate). */
  withholding: number;
  /** Net payout deposited to bank. */
  net: number;
  /** Optional FX rate if settled in another currency. */
  fxRate?: number;
  /** Source CSV / statement filename for audit trail. */
  sourceFile?: string;
}

export interface BankDepositLike {
  id: string;
  date: string;
  amount: number;
  desc: string;
  memo?: string;
}

export type SettlementMatchStatus = "matched" | "already_matched" | "unmatched" | "math_mismatch";

export interface SettlementReconciliationItem {
  settlement: SettlementRow;
  status: SettlementMatchStatus;
  bankTxnId?: string;
  bankDate?: string;
  /** Generated split lines (when matched or already_matched). */
  lines?: SplitLine[];
  /** Gross - fees - refunds - withholding - net (non-zero on math_mismatch). */
  variance: number;
  /** True when the settlement or earning period predates the payer config's seller effectiveDate (personal-to-LLC transition check). */
  beforeEffectiveDate: boolean;
}

export interface SettlementReconciliationResult {
  items: SettlementReconciliationItem[];
  /** New/updated splits ready to merge into doc "splits" (unchanged on idempotent re-import). */
  splitsPatch: SplitsDoc;
  summary: {
    matched: number;
    alreadyMatched: number;
    unmatched: number;
    mathMismatch: number;
    beforeEffectiveDate: number;
    totalGross: number;
    totalFees: number;
    totalRefunds: number;
    totalWithholding: number;
    totalNet: number;
  };
}

/** Build signed split lines for one settlement: gross (>0), -fees, -refunds, -withholding; sums to `net` to the cent. */
export function settlementSplitLines(s: SettlementRow, cfg: SettlementPayerConfig): SplitLine[] {
  const tag = `[settlement:${s.externalId}]`;
  const period = s.rightsPeriod ? ` · ${s.rightsPeriod}` : "";
  const terr = s.territory ? ` · ${s.territory}` : "";
  const lines: SplitLine[] = [];
  if (r2(s.gross) !== 0) {
    lines.push({
      account: cfg.accounts.gross,
      amount: r2(s.gross),
      memo: `${s.payer} gross${period}${terr} ${tag}`,
    });
  }
  if (r2(s.fees) !== 0) {
    lines.push({
      account: cfg.accounts.fees ?? "cogs:platform-fees",
      amount: -r2(Math.abs(s.fees)),
      memo: `${s.payer} fees ${tag}`,
    });
  }
  if (r2(s.refunds) !== 0) {
    lines.push({
      account: cfg.accounts.refunds ?? cfg.accounts.gross,
      amount: -r2(Math.abs(s.refunds)),
      memo: `${s.payer} refunds ${tag}`,
    });
  }
  if (r2(s.withholding) !== 0) {
    lines.push({
      account: cfg.accounts.withholding ?? "expense:foreign-withholding",
      amount: -r2(Math.abs(s.withholding)),
      memo: `${s.payer} withholding${terr} ${tag}`,
    });
  }
  return cleanSplit(lines);
}

const dayDiff = (a: string, b: string) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 864e5));

const sameSplit = (a: readonly SplitLine[] | undefined, b: readonly SplitLine[]) => {
  if (!a || a.length !== b.length) return false;
  return a.every((x, i) => x.account === b[i]!.account && r2(x.amount) === r2(b[i]!.amount) && (x.memo ?? "") === (b[i]!.memo ?? ""));
};

/**
 * Reconcile payer settlements against bank deposits without double-counting revenue.
 * Re-running on the same statements is 100% idempotent (returns empty `splitsPatch`).
 */
export function reconcileSettlements(
  settlements: readonly SettlementRow[],
  bankTxns: readonly BankDepositLike[],
  existingSplits: SplitsDoc | undefined,
  cfg: SettlementPayerConfig,
): SettlementReconciliationResult {
  const windowDays = cfg.dateWindowDays ?? 10;
  const needle = (cfg.bankMatch ?? cfg.payer).toLowerCase();
  const usedTxns = new Set<string>();
  const items: SettlementReconciliationItem[] = [];
  const splitsPatch: Record<string, readonly SplitLine[]> = {};

  for (const s of settlements) {
    const expectedNet = r2(s.gross - Math.abs(s.fees) - Math.abs(s.refunds) - Math.abs(s.withholding));
    const variance = r2(expectedNet - s.net);
    const beforeEffectiveDate = !!cfg.effectiveDate && s.date < cfg.effectiveDate;
    if (Math.abs(variance) >= 0.01) {
      items.push({ settlement: s, status: "math_mismatch", variance, beforeEffectiveDate });
      continue;
    }

    const lines = settlementSplitLines(s, cfg);
    // Single-component settlement (e.g. gross === net, zero fees/refunds/withholding) needs no split, only matching check.
    const needsSplit = lines.length >= 2 && splitProblem(s.net, lines) === null;

    // Candidate bank deposits: same net amount to the cent, within dateWindowDays, matching payer keyword if present.
    const candidates = bankTxns
      .filter((t) => !usedTxns.has(t.id) && Math.abs(remaining(t.amount, [{ amount: s.net }])) === 0 && dayDiff(t.date, s.date) <= windowDays)
      .sort((a, b) => {
        const am = `${a.desc} ${a.memo ?? ""}`.toLowerCase().includes(needle) ? 0 : 1;
        const bm = `${b.desc} ${b.memo ?? ""}`.toLowerCase().includes(needle) ? 0 : 1;
        return am - bm || dayDiff(a.date, s.date) - dayDiff(b.date, s.date);
      });

    const hit = candidates[0];
    if (!hit) {
      items.push({ settlement: s, status: "unmatched", variance: 0, beforeEffectiveDate });
      continue;
    }
    usedTxns.add(hit.id);

    const existing = existingSplits?.[hit.id];
    const tagMarker = `[settlement:${s.externalId}]`;
    const already =
      (needsSplit && sameSplit(existing, lines)) || (existing?.some((l) => l.memo?.includes(tagMarker)) && splitProblem(hit.amount, existing) === null);

    if (already || !needsSplit) {
      items.push({
        settlement: s,
        status: already ? "already_matched" : "matched",
        bankTxnId: hit.id,
        bankDate: hit.date,
        lines,
        variance: 0,
        beforeEffectiveDate,
      });
      continue;
    }
    splitsPatch[hit.id] = lines;
    items.push({ settlement: s, status: "matched", bankTxnId: hit.id, bankDate: hit.date, lines, variance: 0, beforeEffectiveDate });
  }

  return {
    items,
    splitsPatch,
    summary: {
      matched: items.filter((i) => i.status === "matched").length,
      alreadyMatched: items.filter((i) => i.status === "already_matched").length,
      unmatched: items.filter((i) => i.status === "unmatched").length,
      mathMismatch: items.filter((i) => i.status === "math_mismatch").length,
      beforeEffectiveDate: items.filter((i) => i.beforeEffectiveDate).length,
      totalGross: r2(settlements.reduce((a, s) => a + s.gross, 0)),
      totalFees: r2(settlements.reduce((a, s) => a + Math.abs(s.fees), 0)),
      totalRefunds: r2(settlements.reduce((a, s) => a + Math.abs(s.refunds), 0)),
      totalWithholding: r2(settlements.reduce((a, s) => a + Math.abs(s.withholding), 0)),
      totalNet: r2(settlements.reduce((a, s) => a + s.net, 0)),
    },
  };
}
