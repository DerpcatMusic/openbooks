import { expect, test } from "vite-plus/test";
import { convert } from "./fx.ts";
import { decideTransfer, refOf, suggestTransfers, transferAccounts, transferCandidates, type TransferRow } from "./transfers.ts";

const row = (entity: string, id: string, date: string, amount: number, account: string, currency = "ILS", category = "ask"): TransferRow => ({
  entity,
  id,
  date,
  amount,
  currency,
  account,
  desc: id,
  category,
});
const RATES = { USD: { "2025-03-02": 3.6, "2025-03-03": 3.7 } };
const fx = (a: number, f: string, t: string, d: string) => convert(RATES, a, f, t, d);
const ids = (ms: ReturnType<typeof suggestTransfers>) => ms.map((m) => [m.out.id, m.in.id]);

test("same entity: out of one account into another within 4 days; never two rows of one account", () => {
  const rs = [
    row("il", "o1", "2025-03-01", -500, "Bank"),
    row("il", "i1", "2025-03-04", 500, "Savings"),
    row("il", "same", "2025-03-01", 500, "Bank"), // same account as o1: never its pair
    row("il", "late", "2025-03-10", 500, "Savings"), // 9 days: too far
  ];
  expect(ids(suggestTransfers(rs, []))).toEqual([["o1", "i1"]]);
  expect(
    ids(
      suggestTransfers(
        rs.filter((r) => r.id !== "i1"),
        [],
      ),
    ),
  ).toEqual([]);
});

test("one-to-one: two equal transfers pair by nearest date, each row used once", () => {
  const rs = [
    row("il", "o1", "2025-03-01", -100, "Bank"),
    row("il", "o2", "2025-03-05", -100, "Bank"),
    row("il", "i2", "2025-03-05", 100, "Card"),
    row("il", "i1", "2025-03-02", 100, "Card"),
  ];
  expect(ids(suggestTransfers(rs, []))).toEqual([
    ["o1", "i1"],
    ["o2", "i2"],
  ]);
});

test("same currency is near exact (a 0.4% fee passes, 2% does not)", () => {
  expect(ids(suggestTransfers([row("il", "o", "2025-03-01", -1000, "A"), row("il", "i", "2025-03-01", 996, "B")], []))).toHaveLength(1);
  expect(ids(suggestTransfers([row("il", "o", "2025-03-01", -1000, "A"), row("il", "i", "2025-03-01", 980, "B")], []))).toHaveLength(0);
});

test("cross currency and cross entity: converted at the rate of the day the money left, within 3% (configurable); no rate = no match", () => {
  const rs = [row("llc", "w", "2025-03-03", -1000, "Mercury", "USD"), row("il", "d", "2025-03-04", 3640, "Hapoalim")]; // 3700 at the rate: -1.6%
  expect(ids(suggestTransfers(rs, [], { convert: fx }))).toEqual([["w", "d"]]);
  expect(ids(suggestTransfers(rs, [], { convert: fx, tolerance: 0.01 }))).toEqual([]);
  expect(ids(suggestTransfers(rs, []))).toEqual([]); // no rates at all
  expect(
    ids(
      suggestTransfers(
        [
          { ...rs[0]!, date: "2025-02-01" },
          { ...rs[1]!, date: "2025-02-02" },
        ],
        [],
        { convert: fx },
      ),
    ),
  ).toEqual([]); // no rate that day
});

test("rejected pairs are never suggested again; confirmed rows are taken", () => {
  const rs = [row("il", "o", "2025-03-01", -100, "A"), row("il", "i", "2025-03-01", 100, "B"), row("il", "i2", "2025-03-02", 100, "C")];
  const pair = { out: refOf(rs[0]!), in: refOf(rs[1]!) };
  expect(ids(suggestTransfers(rs, [decideTransfer({}, pair, "rejected")]))).toEqual([["o", "i2"]]);
  expect(ids(suggestTransfers(rs, [decideTransfer({}, pair, "confirmed")]))).toEqual([]);
  // deciding again moves the pair between the lists
  expect(decideTransfer(decideTransfer({}, pair, "rejected"), pair, "confirmed")).toEqual({ confirmed: [pair], rejected: [] });
});

test("manual search looks 30 days out", () => {
  const rs = [row("il", "o", "2025-03-01", -100, "A"), row("il", "far", "2025-03-20", 100, "B")];
  expect(suggestTransfers(rs, [])).toEqual([]);
  expect(transferCandidates(rs[0]!, rs, []).map((m) => m.in.id)).toEqual(["far"]);
  expect(transferCandidates(rs[1]!, rs, []).map((m) => m.out.id)).toEqual(["o"]);
});

test("what a confirmed pair is filed as", () => {
  const llc = { id: "llc", kind: "us-llc" },
    il = { id: "il", kind: "il-osek-zair" };
  expect(transferAccounts(il, il)).toEqual({ out: "transfer:internal", in: "transfer:internal" });
  expect(transferAccounts(llc, il)).toEqual({ out: "equity:owner", in: "own:transfer" }); // owner draw
  expect(transferAccounts(il, llc)).toEqual({ out: "own:transfer", in: "equity:owner" }); // owner contribution
});
