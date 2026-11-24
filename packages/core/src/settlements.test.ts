import { describe, expect, it } from "vite-plus/test";
import { brokenSplits, reconcileSettlements, type SettlementPayerConfig, type SettlementRow } from "./index.ts";

describe("settlement-to-payout gross-to-net reconciliation", () => {
  const cfg: SettlementPayerConfig = {
    payer: "ASCAP",
    seller: "Dolmen Gate LLC",
    effectiveDate: "2026-03-01",
    accounts: {
      gross: "revenue:music-royalties",
      fees: "cogs:platform-fees",
      withholding: "expense:foreign-withholding",
    },
    bankMatch: "ascap",
  };

  const royalty: SettlementRow = {
    externalId: "ASCAP-2026-Q2-01",
    payer: "ASCAP",
    date: "2026-06-15",
    rightsPeriod: "2026-Q1",
    territory: "US",
    currency: "USD",
    gross: 1000,
    fees: 30,
    refunds: 0,
    withholding: 100,
    net: 870,
  };

  const bank = [{ id: "tx-mercury-1", date: "2026-06-17", amount: 870, desc: "ASCAP Distribution", memo: "Royalty payout" }];

  it("matches net deposit to gross/fees/withholding split without double counting and is idempotent on re-import", () => {
    const first = reconcileSettlements([royalty], bank, {}, cfg);
    expect(first.summary).toMatchObject({
      matched: 1,
      alreadyMatched: 0,
      unmatched: 0,
      mathMismatch: 0,
      totalGross: 1000,
      totalFees: 30,
      totalWithholding: 100,
      totalNet: 870,
    });
    const split = first.splitsPatch["tx-mercury-1"]!;
    expect(split).toHaveLength(3);
    expect(split.map((l) => [l.account, l.amount])).toEqual([
      ["revenue:music-royalties", 1000],
      ["cogs:platform-fees", -30],
      ["expense:foreign-withholding", -100],
    ]);

    // Re-importing the exact same settlement changes nothing
    const second = reconcileSettlements([royalty], bank, first.splitsPatch, cfg);
    expect(second.summary).toMatchObject({ matched: 0, alreadyMatched: 1, unmatched: 0 });
    expect(second.splitsPatch).toEqual({});
  });

  it("flags unmatched settlements, math mismatches, pre-effective-date payouts, and broken splits after bank re-import", () => {
    const preTransition: SettlementRow = { ...royalty, externalId: "ASCAP-2026-Q1", date: "2026-02-10", net: 870 };
    const badMath: SettlementRow = { ...royalty, externalId: "ASCAP-BAD", net: 850 };
    const res = reconcileSettlements([preTransition, badMath], [], {}, cfg);
    expect(res.items[0]).toMatchObject({ status: "unmatched", beforeEffectiveDate: true });
    expect(res.items[1]).toMatchObject({ status: "math_mismatch", variance: 20 });

    // If bank deposit changes from $870 to $865 on re-import, brokenSplits catches the dropped split explicitly
    const first = reconcileSettlements([royalty], bank, {}, cfg);
    const broken = brokenSplits([{ id: "tx-mercury-1", date: "2026-06-17", desc: "ASCAP Distribution", amount: 865 }], first.splitsPatch);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ id: "tx-mercury-1", txnAmount: 865, splitTotal: 870, diff: -5, problem: "sum" });
  });
});
