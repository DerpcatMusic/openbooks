// Asset accounts (pensions, Israeli savings wrappers, brokerage, read-only crypto wallets): validation, valuation series, and merge helpers.
// Pure: no I/O, no network. Shared by storage guards, net worth, importers, server routes, and the UI.
import type { AssetAccount, AssetKind, AssetValuation, CryptoChain } from "@openbooks/schema";
import { isIsoDate } from "./journal.ts";

export const ASSET_KINDS: readonly AssetKind[] = ["pension", "keren-hishtalmut", "gemel", "brokerage", "crypto", "other"];
export const CRYPTO_CHAINS: readonly CryptoChain[] = ["btc", "eth"];

const CURRENCY_RE = /^[A-Z]{3}$/;
const BTC_BECH32_RE = /^bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{25,87}$/;
const BTC_LEGACY_RE = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const ETH_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** Heuristic check for private keys / seed phrases so users never accidentally store secrets in public-address fields. */
export function looksLikePrivateKey(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  // 12-24 word mnemonic seed phrase
  if (s.split(/\s+/).length >= 12) return true;
  // 64-char hex private key (with or without 0x)
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(s)) return true;
  // Bitcoin WIF private keys (5..., K..., L...) or extended private keys (xprv/yprv/zprv)
  if (/^(xprv|yprv|zprv)[a-km-zA-HJ-NP-Z1-9]{20,}$/.test(s)) return true;
  if (/^[5KL][a-km-zA-HJ-NP-Z1-9]{50,51}$/.test(s)) return true;
  return false;
}

/** Validate a read-only public address for a supported crypto chain (mainnet BTC or ETH). */
export function isValidCryptoAddress(chain: CryptoChain, raw: string): boolean {
  const s = raw.trim();
  if (!s || looksLikePrivateKey(s)) return false;
  if (chain === "eth") return ETH_ADDR_RE.test(s);
  // Bech32 is case-insensitive, but mixed case is invalid per BIP-173
  if (/^bc1/i.test(s)) {
    const isAllLower = s === s.toLowerCase();
    const isAllUpper = s === s.toUpperCase();
    return (isAllLower || isAllUpper) && BTC_BECH32_RE.test(s.toLowerCase());
  }
  return BTC_LEGACY_RE.test(s);
}

/** Detect chain ("btc" | "eth") from a public address string; null if unrecognized. */
export function detectCryptoChain(raw: string): CryptoChain | null {
  if (isValidCryptoAddress("eth", raw)) return "eth";
  if (isValidCryptoAddress("btc", raw)) return "btc";
  return null;
}

export type AssetProblem = "id" | "kind" | "name" | "currency" | "valuations" | "chain" | "address" | "privateKey";

/** Validate one AssetAccount entry; null when valid. */
export function assetProblem(a: Partial<AssetAccount> | null | undefined): AssetProblem | null {
  if (!a || typeof a !== "object") return "id";
  if (typeof a.id !== "string" || !a.id.trim() || a.id.length > 80) return "id";
  if (!ASSET_KINDS.includes(a.kind as AssetKind)) return "kind";
  if (typeof a.name !== "string" || !a.name.trim() || a.name.length > 160) return "name";
  if (typeof a.currency !== "string" || !CURRENCY_RE.test(a.currency)) return "currency";
  if (!Array.isArray(a.valuations)) return "valuations";
  for (const v of a.valuations) {
    if (!v || typeof v !== "object") return "valuations";
    if (typeof v.date !== "string" || !isIsoDate(v.date)) return "valuations";
    if (typeof v.value !== "number" || !Number.isFinite(v.value) || v.value < 0) return "valuations";
    if (v.quantity !== undefined && (typeof v.quantity !== "number" || !Number.isFinite(v.quantity) || v.quantity < 0)) return "valuations";
    if (v.unitPrice !== undefined && (typeof v.unitPrice !== "number" || !Number.isFinite(v.unitPrice) || v.unitPrice < 0)) return "valuations";
  }
  if (a.address !== undefined && a.address !== "") {
    if (typeof a.address !== "string") return "address";
    if (looksLikePrivateKey(a.address)) return "privateKey";
    if (!a.chain || !CRYPTO_CHAINS.includes(a.chain)) return "chain";
    if (!isValidCryptoAddress(a.chain, a.address)) return "address";
  } else if (a.chain !== undefined && !CRYPTO_CHAINS.includes(a.chain)) {
    return "chain";
  }
  return null;
}

/** Latest valuation of an asset (optionally on or before `onOrBefore`), or null if none. Same-date ties keep the last entry. */
export function latestValuation(valuations: readonly AssetValuation[], onOrBefore?: string): AssetValuation | null {
  let best: AssetValuation | null = null;
  for (const v of valuations) {
    if (onOrBefore && v.date > onOrBefore) continue;
    if (!best || v.date >= best.date) best = v;
  }
  return best;
}

/**
 * Daily value series of an asset over sorted `dates` (YYYY-MM-DD): on each day `d`, the latest valuation with `v.date <= d`,
 * or 0 before the first valuation. Multiple valuations on the same date use the last one.
 */
export function assetDailyValues(valuations: readonly AssetValuation[], dates: readonly string[]): number[] {
  if (!valuations.length) return dates.map(() => 0);
  const byDate = new Map<string, number>();
  for (const v of valuations) byDate.set(v.date, v.value);
  const sorted = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let idx = -1;
  return dates.map((d) => {
    while (idx + 1 < sorted.length && sorted[idx + 1]![0] <= d) idx++;
    return idx >= 0 ? Math.round(sorted[idx]![1] * 100) / 100 : 0;
  });
}

/** Insert or replace a valuation for `entry.date`, returning a date-sorted valuation array. */
export function upsertValuation(valuations: readonly AssetValuation[], entry: AssetValuation): AssetValuation[] {
  const byDate = new Map<string, AssetValuation>();
  for (const v of valuations) byDate.set(v.date, v);
  byDate.set(entry.date, {
    date: entry.date,
    value: Math.round(entry.value * 100) / 100,
    ...(entry.quantity !== undefined ? { quantity: entry.quantity } : {}),
    ...(entry.unitPrice !== undefined ? { unitPrice: entry.unitPrice } : {}),
  });
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface ImportedAssetInput {
  kind: AssetKind;
  name: string;
  provider?: string;
  currency: string;
  date: string;
  value: number;
}

const normKey = (s: string | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Build a stable, URL-safe unique id for a new asset account. */
export function makeAssetId(existing: ReadonlySet<string>, base = "asset"): string {
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "asset";
  let candidate = `${slug}-${Math.random().toString(36).slice(2, 8)}`;
  while (existing.has(candidate)) candidate = `${slug}-${Math.random().toString(36).slice(2, 8)}`;
  return candidate;
}

/**
 * Merge imported pension/CSV rows into existing asset accounts.
 * Rows matching an existing asset's `(kind, name, provider)` update its valuations (preserving history); new rows become new assets.
 */
export function mergeImportedAssets(
  existing: readonly AssetAccount[],
  imported: readonly ImportedAssetInput[],
): { assets: AssetAccount[]; added: number; updated: number } {
  const next: AssetAccount[] = existing.map((a) => ({ ...a, valuations: [...a.valuations] }));
  const ids = new Set(next.map((a) => a.id));
  const keyOf = (a: { kind: AssetKind; name: string; provider?: string }) => `${a.kind}|${normKey(a.name)}|${normKey(a.provider)}`;
  const byKey = new Map<string, number>();
  next.forEach((a, i) => byKey.set(keyOf(a), i));

  let added = 0;
  let updated = 0;
  for (const row of imported) {
    const k = keyOf(row);
    const idx = byKey.get(k);
    if (idx !== undefined) {
      const cur = next[idx]!;
      next[idx] = {
        ...cur,
        currency: row.currency,
        valuations: upsertValuation(cur.valuations, { date: row.date, value: row.value }),
        stale: false,
      };
      updated++;
    } else {
      const id = makeAssetId(ids, row.kind);
      ids.add(id);
      const created: AssetAccount = {
        id,
        kind: row.kind,
        name: row.name.trim(),
        ...(row.provider?.trim() ? { provider: row.provider.trim() } : {}),
        currency: row.currency,
        valuations: [{ date: row.date, value: Math.round(row.value * 100) / 100 }],
      };
      byKey.set(k, next.push(created) - 1);
      added++;
    }
  }
  return { assets: next, added, updated };
}
