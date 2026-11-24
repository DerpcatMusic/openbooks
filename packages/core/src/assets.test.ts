import { describe, expect, test } from "vite-plus/test";
import type { AssetAccount } from "@openbooks/schema";
import {
  assetDailyValues,
  assetProblem,
  detectCryptoChain,
  isValidCryptoAddress,
  latestValuation,
  looksLikePrivateKey,
  mergeImportedAssets,
  upsertValuation,
} from "./assets.ts";

describe("crypto address validation", () => {
  test("accepts valid BTC and ETH public addresses", () => {
    expect(isValidCryptoAddress("btc", "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh")).toBe(true);
    expect(isValidCryptoAddress("btc", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe(true);
    expect(isValidCryptoAddress("btc", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe(true);
    expect(isValidCryptoAddress("eth", "0x742d35Cc6634C0532925a3b844Bc454e4438f44e")).toBe(true);
    expect(detectCryptoChain("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh")).toBe("btc");
    expect(detectCryptoChain("0x742d35Cc6634C0532925a3b844Bc454e4438f44e")).toBe("eth");
  });

  test("rejects private keys, WIFs, seed phrases, and malformed addresses", () => {
    const seed = "abandon ability able about above absent absorb abstract absurd abuse access accident";
    const hexPriv = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
    const wif = "5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ";
    expect(looksLikePrivateKey(seed)).toBe(true);
    expect(looksLikePrivateKey(hexPriv)).toBe(true);
    expect(looksLikePrivateKey(wif)).toBe(true);
    expect(isValidCryptoAddress("btc", seed)).toBe(false);
    expect(isValidCryptoAddress("eth", hexPriv)).toBe(false);
    expect(isValidCryptoAddress("btc", wif)).toBe(false);
    expect(isValidCryptoAddress("eth", "0x1234")).toBe(false);
    expect(isValidCryptoAddress("btc", "Bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh")).toBe(false); // mixed-case bech32 invalid
  });
});

describe("assetProblem", () => {
  const valid: AssetAccount = {
    id: "p1",
    kind: "pension",
    name: "Migdal Pension",
    provider: "Migdal",
    currency: "ILS",
    valuations: [{ date: "2026-03-01", value: 125000 }],
  };

  test("returns null for valid manual and crypto assets", () => {
    expect(assetProblem(valid)).toBeNull();
    expect(
      assetProblem({
        id: "c1",
        kind: "crypto",
        name: "Ledger BTC",
        currency: "USD",
        chain: "btc",
        address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        valuations: [],
      }),
    ).toBeNull();
  });

  test("flags invalid fields and private keys", () => {
    expect(assetProblem({ ...valid, name: "  " })).toBe("name");
    expect(assetProblem({ ...valid, currency: "nis" })).toBe("currency");
    expect(assetProblem({ ...valid, valuations: [{ date: "bad-date", value: 10 }] })).toBe("valuations");
    expect(assetProblem({ ...valid, valuations: [{ date: "2026-03-01", value: -5 }] })).toBe("valuations");
    expect(
      assetProblem({
        id: "c2",
        kind: "crypto",
        name: "Bad",
        currency: "USD",
        chain: "eth",
        address: "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318",
        valuations: [],
      }),
    ).toBe("privateKey");
  });
});

describe("valuations & daily series", () => {
  test("latestValuation picks newest on or before date and last on same-date ties", () => {
    const vs = [
      { date: "2026-01-15", value: 100 },
      { date: "2026-03-01", value: 150 },
      { date: "2026-03-01", value: 155 },
      { date: "2026-02-01", value: 120 },
    ];
    expect(latestValuation(vs)).toEqual({ date: "2026-03-01", value: 155 });
    expect(latestValuation(vs, "2026-02-15")).toEqual({ date: "2026-02-01", value: 120 });
    expect(latestValuation(vs, "2025-12-31")).toBeNull();
  });

  test("assetDailyValues steps forward from each valuation date and is 0 before the first", () => {
    const dates = ["2026-02-28", "2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"];
    const vals = assetDailyValues(
      [
        { date: "2026-03-01", value: 1000 },
        { date: "2026-03-03", value: 1250.5 },
      ],
      dates,
    );
    expect(vals).toEqual([0, 1000, 1000, 1250.5, 1250.5]);
  });

  test("upsertValuation replaces matching date and keeps chronological order", () => {
    const v1 = upsertValuation([{ date: "2026-03-05", value: 200 }], { date: "2026-02-01", value: 100 });
    expect(v1).toEqual([
      { date: "2026-02-01", value: 100 },
      { date: "2026-03-05", value: 200 },
    ]);
    const v2 = upsertValuation(v1, { date: "2026-03-05", value: 225.75, quantity: 0.5, unitPrice: 451.5 });
    expect(v2).toEqual([
      { date: "2026-02-01", value: 100 },
      { date: "2026-03-05", value: 225.75, quantity: 0.5, unitPrice: 451.5 },
    ]);
  });

  test("mergeImportedAssets adds new entries and appends dated valuations to existing matches", () => {
    const existing: AssetAccount[] = [
      {
        id: "pen-1",
        kind: "pension",
        name: "מנורה מבטחים פנסיה",
        provider: "מנורה מבטחים",
        currency: "ILS",
        valuations: [{ date: "2025-12-31", value: 180000 }],
        stale: true,
      },
    ];
    const merged = mergeImportedAssets(existing, [
      { kind: "pension", name: "מנורה מבטחים פנסיה", provider: "מנורה מבטחים", currency: "ILS", date: "2026-03-31", value: 195400 },
      { kind: "keren-hishtalmut", name: "קרן השתלמות — אלטשולר שחם", provider: "אלטשולר שחם", currency: "ILS", date: "2026-03-31", value: 82500 },
    ]);
    expect(merged.added).toBe(1);
    expect(merged.updated).toBe(1);
    expect(merged.assets).toHaveLength(2);
    expect(merged.assets[0]!.valuations).toEqual([
      { date: "2025-12-31", value: 180000 },
      { date: "2026-03-31", value: 195400 },
    ]);
    expect(merged.assets[0]!.stale).toBe(false);
    expect(merged.assets[1]!.kind).toBe("keren-hishtalmut");
  });
});
