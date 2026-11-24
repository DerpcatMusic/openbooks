// Unit tests for read-only crypto address balance/price parsers and service:
// recorded mempool.space + Ethereum JSON-RPC + Yahoo/CoinGecko payloads only — no live network calls.
import { describe, expect, test } from "vite-plus/test";
import type { AssetAccount } from "@openbooks/schema";
import { createCryptoService, parseCoinGeckoPrices, parseEthBalanceRpc, parseMempoolAddress, parseYahooSpotPrice } from "./crypto.ts";

const BTC_ADDR = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const ETH_ADDR = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

// Recorded mempool.space /api/address/<addr> payload: 1.5 BTC funded - 0.5 BTC spent + 0.05 BTC incoming mempool = 1.05 BTC
const SAMPLE_MEMPOOL_BTC = {
  address: BTC_ADDR,
  chain_stats: {
    funded_txo_count: 3,
    funded_txo_sum: 150_000_000,
    spent_txo_count: 1,
    spent_txo_sum: 50_000_000,
    tx_count: 4,
  },
  mempool_stats: {
    funded_txo_count: 1,
    funded_txo_sum: 5_000_000,
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 1,
  },
};

// Recorded Ethereum JSON-RPC eth_getBalance payload: 2.5 ETH = 2500000000000000000 wei = 0x22b1c8c1227a0000
const SAMPLE_ETH_RPC = {
  jsonrpc: "2.0",
  id: 1,
  result: "0x22b1c8c1227a0000",
};

const SAMPLE_YAHOO_BTC = {
  chart: {
    result: [{ meta: { currency: "USD", symbol: "BTC-USD", regularMarketPrice: 92000 } }],
    error: null,
  },
};

const SAMPLE_COINGECKO_ETH = {
  ethereum: { usd: 3200.5 },
};

describe("crypto payload parsers", () => {
  test("parseMempoolAddress parses confirmed + mempool satoshis into BTC", () => {
    expect(parseMempoolAddress(SAMPLE_MEMPOOL_BTC)).toBe(1.05);
    expect(parseMempoolAddress({ chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } })).toBe(0);
    expect(parseMempoolAddress(null)).toBeNull();
    expect(parseMempoolAddress({ chain_stats: { funded_txo_sum: "bad" } })).toBeNull();
  });

  test("parseEthBalanceRpc parses hex wei via BigInt without precision loss", () => {
    expect(parseEthBalanceRpc(SAMPLE_ETH_RPC)).toBe(2.5);
    expect(parseEthBalanceRpc({ jsonrpc: "2.0", id: 1, result: "0x0" })).toBe(0);
    // 12345.67890123 ETH = 12345678901230000000000 wei
    const bigHex = `0x${12345_67890123_0000000000n.toString(16)}`;
    expect(parseEthBalanceRpc({ jsonrpc: "2.0", id: 1, result: bigHex })).toBe(12345.67890123);
    expect(parseEthBalanceRpc({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "rate limited" } })).toBeNull();
    expect(parseEthBalanceRpc({ result: "not-hex" })).toBeNull();
  });

  test("parseYahooSpotPrice & parseCoinGeckoPrices extract positive USD prices", () => {
    expect(parseYahooSpotPrice(SAMPLE_YAHOO_BTC)).toBe(92000);
    expect(parseYahooSpotPrice({ chart: { result: [{ indicators: { quote: [{ close: [null, 3150.25] }] } }] } })).toBe(3150.25);
    expect(parseYahooSpotPrice({ chart: { result: null } })).toBeNull();
    expect(parseCoinGeckoPrices(SAMPLE_COINGECKO_ETH)).toEqual({ eth: 3200.5 });
    expect(parseCoinGeckoPrices({ bitcoin: { usd: -1 } })).toEqual({});
  });
});

describe("createCryptoService", () => {
  test("fetches BTC and ETH balances + prices with generic User-Agent, no user data, and caches within TTL", async () => {
    let clock = 1_795_546_000_000;
    const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];

    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      calls.push({ url, headers, ...(typeof init?.body === "string" ? { body: init.body } : {}) });

      if (url === `http://mempool.test/api/address/${BTC_ADDR}`) {
        return new Response(JSON.stringify(SAMPLE_MEMPOOL_BTC), { status: 200 });
      }
      if (url === "http://eth-rpc.test") {
        return new Response(JSON.stringify(SAMPLE_ETH_RPC), { status: 200 });
      }
      if (url.includes("BTC-USD")) {
        return new Response(JSON.stringify(SAMPLE_YAHOO_BTC), { status: 200 });
      }
      if (url.includes("ETH-USD")) {
        // Simulate Yahoo failing for ETH-USD so CoinGecko fallback is exercised
        return new Response("unavailable", { status: 503 });
      }
      if (url.startsWith("http://coingecko.test") && url.includes("ethereum")) {
        return new Response(JSON.stringify(SAMPLE_COINGECKO_ETH), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const svc = createCryptoService({
      mempoolBase: "http://mempool.test",
      ethRpcUrls: ["http://eth-rpc.test"],
      yahooBase: "http://yahoo.test/v8/finance/chart",
      coingeckoBase: "http://coingecko.test/simple/price",
      ttlMs: 60_000,
      fetchImpl: fakeFetch,
      now: () => clock,
      today: () => "2026-03-04",
    });

    const btcAsset: AssetAccount = {
      id: "btc-1",
      kind: "crypto",
      name: "Hardware BTC",
      currency: "USD",
      chain: "btc",
      address: BTC_ADDR,
      valuations: [],
    };
    const rBtc = await svc.refreshAsset(btcAsset);
    expect(rBtc.ok).toBe(true);
    expect(rBtc.asset.stale).toBe(false);
    expect(rBtc.asset.valuations).toEqual([{ date: "2026-03-04", value: 96600, quantity: 1.05, unitPrice: 92000 }]);

    const ethAsset: AssetAccount = {
      id: "eth-1",
      kind: "crypto",
      name: "Hardware ETH",
      currency: "USD",
      chain: "eth",
      address: ETH_ADDR,
      valuations: [],
    };
    const rEth = await svc.refreshAsset(ethAsset);
    expect(rEth.ok).toBe(true);
    expect(rEth.asset.valuations).toEqual([{ date: "2026-03-04", value: 8001.25, quantity: 2.5, unitPrice: 3200.5 }]);

    // Privacy check: generic User-Agent, no cookies/auth, no entity/name leakage
    for (const c of calls) {
      expect(c.headers["user-agent"]).toContain("OpenBooks");
      expect(c.headers.cookie).toBeUndefined();
      expect(c.headers.authorization).toBeUndefined();
      expect(c.url).not.toContain("Hardware");
      expect(c.body ?? "").not.toContain("Hardware");
    }

    // Second refresh within TTL hits cache (0 additional network calls)
    const countBefore = calls.length;
    clock += 10_000;
    const rBtcCached = await svc.refreshAsset(rBtc.asset);
    expect(rBtcCached.ok).toBe(true);
    expect(calls.length).toBe(countBefore);

    // After TTL expires, refreshes from network again
    clock += 60_000;
    await svc.refreshAsset(rBtc.asset);
    expect(calls.length).toBeGreaterThan(countBefore);
  });

  test("failure leaves the last valuation intact and marks the asset stale", async () => {
    const failingFetch = (async () => new Response("gateway timeout", { status: 504 })) as unknown as typeof fetch;
    const svc = createCryptoService({
      mempoolBase: "http://mempool.test",
      ethRpcUrls: ["http://eth-rpc.test"],
      yahooBase: "http://yahoo.test/v8/finance/chart",
      coingeckoBase: "http://coingecko.test/simple/price",
      fetchImpl: failingFetch,
      today: () => "2026-03-05",
    });

    const existing: AssetAccount = {
      id: "btc-1",
      kind: "crypto",
      name: "Cold BTC",
      currency: "USD",
      chain: "btc",
      address: BTC_ADDR,
      valuations: [{ date: "2026-03-04", value: 96600, quantity: 1.05, unitPrice: 92000 }],
      stale: false,
    };

    const r = await svc.refreshAsset(existing);
    expect(r.ok).toBe(false);
    expect(r.asset.stale).toBe(true);
    expect(r.asset.lastError).toBeTruthy();
    expect(r.asset.valuations).toEqual(existing.valuations);
  });

  test("non-USD crypto refresh refuses 1:1 when FX rate is missing", async () => {
    const okFetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/address/")) return new Response(JSON.stringify(SAMPLE_MEMPOOL_BTC), { status: 200 });
      return new Response(JSON.stringify(SAMPLE_YAHOO_BTC), { status: 200 });
    }) as typeof fetch;

    const svc = createCryptoService({
      mempoolBase: "http://mempool.test",
      yahooBase: "http://yahoo.test/v8/finance/chart",
      fetchImpl: okFetch,
      today: () => "2026-03-05",
    });

    const ilsCrypto: AssetAccount = {
      id: "btc-ils",
      kind: "crypto",
      name: "BTC in ILS",
      currency: "ILS",
      chain: "btc",
      address: BTC_ADDR,
      valuations: [{ date: "2026-03-04", value: 350000 }],
    };

    const r = await svc.refreshAsset(ilsCrypto, { convertFromUsd: () => null });
    expect(r.ok).toBe(false);
    expect(r.asset.stale).toBe(true);
    expect(r.asset.valuations).toEqual([{ date: "2026-03-04", value: 350000 }]);
  });
});
