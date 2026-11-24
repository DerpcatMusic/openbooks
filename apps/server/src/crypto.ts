// Read-only public crypto wallet balance & spot price lookups (BTC + ETH).
// Never accepts or transmits private keys, seed phrases, or user data other than the public address.
// Server-side fetch only, generic User-Agent, 15s timeout, in-memory TTL cache; failure leaves the last valuation intact and marks it stale.
import { isValidCryptoAddress, upsertValuation } from "@openbooks/core";
import type { AssetAccount, CryptoChain } from "@openbooks/schema";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MEMPOOL_BASE = "https://mempool.space";
const DEFAULT_ETH_RPCS = ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"];
const DEFAULT_YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const DEFAULT_COINGECKO_BASE = "https://api.coingecko.com/api/v3/simple/price";

export const CRYPTO_REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; OpenBooks/1.0)",
  Accept: "application/json",
};

const round8 = (n: number) => Math.round(n * 1e8) / 1e8;
const round2 = (n: number) => Math.round(n * 100) / 100;
const isFiniteInt = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);
const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

interface MempoolStats {
  funded_txo_sum?: unknown;
  spent_txo_sum?: unknown;
}
interface MempoolAddressPayload {
  chain_stats?: MempoolStats;
  mempool_stats?: MempoolStats;
}

/** Parse mempool.space `/api/address/<addr>` JSON into a BTC balance (confirmed + unconfirmed mempool delta). Returns null on invalid payload. */
export function parseMempoolAddress(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as MempoolAddressPayload;
  const cs = p.chain_stats;
  if (!cs || typeof cs !== "object") return null;
  if (!isFiniteInt(cs.funded_txo_sum) || !isFiniteInt(cs.spent_txo_sum)) return null;
  let sats = cs.funded_txo_sum - cs.spent_txo_sum;
  const ms = p.mempool_stats;
  if (ms && typeof ms === "object" && isFiniteInt(ms.funded_txo_sum) && isFiniteInt(ms.spent_txo_sum)) {
    sats += ms.funded_txo_sum - ms.spent_txo_sum;
  }
  if (sats < 0) sats = 0;
  return round8(sats / 1e8);
}

interface EthRpcPayload {
  result?: unknown;
  error?: unknown;
}

/** Parse Ethereum JSON-RPC `eth_getBalance` response (`{"result":"0x..."}`) into an ETH balance using BigInt. Returns null on error or malformed payload. */
export function parseEthBalanceRpc(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as EthRpcPayload;
  if (p.error !== undefined && p.error !== null) return null;
  if (typeof p.result !== "string" || !/^0x[0-9a-fA-F]+$/.test(p.result)) return null;
  try {
    const wei = BigInt(p.result);
    if (wei < 0n) return null;
    // Scale down to 1e-8 ETH precision before converting to Number to stay exact even for large balances.
    const whole = wei / 10n ** 18n;
    const frac8 = (wei % 10n ** 18n) / 10n ** 10n;
    const eth = Number(whole) + Number(frac8) / 1e8;
    return Number.isFinite(eth) ? round8(eth) : null;
  } catch {
    return null;
  }
}

interface YahooChartSpot {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: unknown };
      indicators?: { quote?: Array<{ close?: Array<unknown> }> };
    }> | null;
    error?: unknown;
  };
}

/** Parse a Yahoo Finance v8 chart response for a crypto pair (e.g. BTC-USD, ETH-USD) into its USD spot price. */
export function parseYahooSpotPrice(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const r = (payload as YahooChartSpot).chart?.result?.[0];
  if (!r || typeof r !== "object") return null;
  const price = r.meta?.regularMarketPrice;
  if (isFiniteNum(price) && price > 0) return price;
  const closes = (r.indicators?.quote?.[0]?.close ?? []).filter(isFiniteNum);
  const last = closes.at(-1);
  return isFiniteNum(last) && last > 0 ? last : null;
}

/** Parse a CoinGecko `/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd` response into USD spot prices by chain. */
export function parseCoinGeckoPrices(payload: unknown): Partial<Record<CryptoChain, number>> {
  if (!payload || typeof payload !== "object") return {};
  const obj = payload as Record<string, { usd?: unknown } | undefined>;
  const out: Partial<Record<CryptoChain, number>> = {};
  if (isFiniteNum(obj.bitcoin?.usd) && obj.bitcoin.usd > 0) out.btc = obj.bitcoin.usd;
  if (isFiniteNum(obj.ethereum?.usd) && obj.ethereum.usd > 0) out.eth = obj.ethereum.usd;
  return out;
}

export interface CryptoServiceOptions {
  mempoolBase?: string;
  ethRpcUrls?: readonly string[];
  yahooBase?: string;
  coingeckoBase?: string;
  timeoutMs?: number;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  today?: () => string;
}

export interface RefreshCryptoOptions {
  force?: boolean;
  /** Optional converter from USD to the asset's currency on `date` (via BoI FX). Returning null fails the refresh rather than using 1:1. */
  convertFromUsd?: (amountUsd: number, toCurrency: string, date: string) => Promise<number | null> | number | null;
}

export interface CryptoRefreshResult {
  asset: AssetAccount;
  ok: boolean;
  error?: string;
}

const YAHOO_SYMBOL: Record<CryptoChain, string> = { btc: "BTC-USD", eth: "ETH-USD" };
const COINGECKO_ID: Record<CryptoChain, string> = { btc: "bitcoin", eth: "ethereum" };

export function createCryptoService(opts: CryptoServiceOptions = {}) {
  const mempoolBase = (opts.mempoolBase ?? process.env.OPENBOOKS_MEMPOOL_API ?? DEFAULT_MEMPOOL_BASE).replace(/\/+$/, "");
  const envEthRpc = process.env.OPENBOOKS_ETH_RPC;
  const ethRpcUrls =
    opts.ethRpcUrls ??
    (envEthRpc
      ? envEthRpc
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : DEFAULT_ETH_RPCS);
  const yahooBase = (opts.yahooBase ?? process.env.OPENBOOKS_YAHOO_API ?? DEFAULT_YAHOO_BASE).replace(/\/+$/, "");
  const coingeckoBase = opts.coingeckoBase ?? process.env.OPENBOOKS_COINGECKO_API ?? DEFAULT_COINGECKO_BASE;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const today = opts.today ?? (() => new Date(now()).toISOString().slice(0, 10));

  const balanceCache = new Map<string, { at: number; value: number }>();
  const priceCache = new Map<CryptoChain, { at: number; value: number }>();

  async function fetchBtcBalance(address: string): Promise<number | null> {
    const url = `${mempoolBase}/api/address/${encodeURIComponent(address)}`;
    try {
      const res = await fetchImpl(url, { headers: CRYPTO_REQUEST_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      return parseMempoolAddress(await res.json());
    } catch {
      return null;
    }
  }

  async function fetchEthBalance(address: string): Promise<number | null> {
    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] });
    for (const rpcUrl of ethRpcUrls) {
      if (!rpcUrl) continue;
      try {
        const res = await fetchImpl(rpcUrl, {
          method: "POST",
          headers: { ...CRYPTO_REQUEST_HEADERS, "Content-Type": "application/json" },
          body: payload,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;
        const bal = parseEthBalanceRpc(await res.json());
        if (bal !== null) return bal;
      } catch {
        /* try next public RPC */
      }
    }
    return null;
  }

  async function fetchBalance(chain: CryptoChain, address: string, force = false): Promise<number | null> {
    const clean = address.trim();
    if (!isValidCryptoAddress(chain, clean)) return null;
    const key = `${chain}:${chain === "eth" ? clean.toLowerCase() : clean}`;
    const hit = balanceCache.get(key);
    if (!force && hit && now() - hit.at < ttlMs) return hit.value;
    const bal = chain === "btc" ? await fetchBtcBalance(clean) : await fetchEthBalance(clean);
    if (bal !== null) balanceCache.set(key, { at: now(), value: bal });
    return bal;
  }

  async function fetchUsdPrice(chain: CryptoChain, force = false): Promise<number | null> {
    const hit = priceCache.get(chain);
    if (!force && hit && now() - hit.at < ttlMs) return hit.value;

    // Primary: Yahoo Finance v8 chart (same public source as markets.ts)
    if (yahooBase) {
      try {
        const url = `${yahooBase}/${encodeURIComponent(YAHOO_SYMBOL[chain])}?range=1d&interval=1h`;
        const res = await fetchImpl(url, { headers: CRYPTO_REQUEST_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) {
          const p = parseYahooSpotPrice(await res.json());
          if (p !== null) {
            priceCache.set(chain, { at: now(), value: p });
            return p;
          }
        }
      } catch {
        /* try fallback */
      }
    }

    // Fallback: CoinGecko public simple price endpoint
    if (coingeckoBase) {
      try {
        const sep = coingeckoBase.includes("?") ? "&" : "?";
        const url = `${coingeckoBase}${sep}ids=${COINGECKO_ID[chain]}&vs_currencies=usd`;
        const res = await fetchImpl(url, { headers: CRYPTO_REQUEST_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) {
          const prices = parseCoinGeckoPrices(await res.json());
          const p = prices[chain];
          if (p !== undefined) {
            priceCache.set(chain, { at: now(), value: p });
            return p;
          }
        }
      } catch {
        /* fallback exhausted */
      }
    }

    return null;
  }

  /**
   * Refresh one crypto asset account.
   * On success: appends/updates today's valuation and clears `stale` / `lastError`.
   * On failure: leaves `valuations` unchanged and marks `stale: true` with a safe error summary.
   */
  async function refreshAsset(asset: AssetAccount, o: RefreshCryptoOptions = {}): Promise<CryptoRefreshResult> {
    if (asset.kind !== "crypto" || !asset.chain || !asset.address) {
      return { asset, ok: false, error: "Not a connected crypto address" };
    }
    if (!isValidCryptoAddress(asset.chain, asset.address)) {
      return {
        asset: { ...asset, stale: true, lastError: "Invalid public address" },
        ok: false,
        error: "Invalid public address",
      };
    }

    const [quantity, usdPrice] = await Promise.all([fetchBalance(asset.chain, asset.address, o.force), fetchUsdPrice(asset.chain, o.force)]);
    if (quantity === null) {
      const error = `Could not fetch ${asset.chain.toUpperCase()} balance`;
      return { asset: { ...asset, stale: true, lastError: error }, ok: false, error };
    }
    if (usdPrice === null) {
      const error = `Could not fetch ${asset.chain.toUpperCase()} spot price`;
      return { asset: { ...asset, stale: true, lastError: error }, ok: false, error };
    }

    const date = today();
    let value = round2(quantity * usdPrice);
    let unitPrice = round2(usdPrice);
    if (asset.currency !== "USD") {
      if (!o.convertFromUsd) {
        const error = `Missing FX rate for USD→${asset.currency}`;
        return { asset: { ...asset, stale: true, lastError: error }, ok: false, error };
      }
      const [convertedVal, convertedUnit] = await Promise.all([
        o.convertFromUsd(quantity * usdPrice, asset.currency, date),
        o.convertFromUsd(usdPrice, asset.currency, date),
      ]);
      if (convertedVal === null || convertedUnit === null) {
        const error = `Missing FX rate for USD→${asset.currency}`;
        return { asset: { ...asset, stale: true, lastError: error }, ok: false, error };
      }
      value = round2(convertedVal);
      unitPrice = round2(convertedUnit);
    }

    const { lastError: _ignored, ...rest } = asset;
    const updated: AssetAccount = {
      ...rest,
      valuations: upsertValuation(asset.valuations, { date, value, quantity, unitPrice }),
      lastRefreshed: new Date(now()).toISOString(),
      stale: false,
    };
    return { asset: updated, ok: true };
  }

  return {
    fetchBalance,
    fetchUsdPrice,
    refreshAsset,
    clearCache() {
      balanceCache.clear();
      priceCache.clear();
    },
  };
}
