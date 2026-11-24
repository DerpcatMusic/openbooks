import { expect, test } from "vite-plus/test";
import { convert } from "./fx.ts";
import { isAutoCardPayoff, ledger } from "./ledger.ts";
import {
  decideTransfer,
  detectMergedTransfers,
  impliedFee,
  refOf,
  suggestTransfers,
  transferAccounts,
  transferCandidates,
  transferJourneys,
  type TransferRow,
} from "./transfers.ts";

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

test("detectMergedTransfers deduplicates Mercury -> Wise -> Israeli bank chains and reports implied fee", () => {
  const rs: TransferRow[] = [
    row("llc", "m-out", "2025-03-02", -1000, "Mercury Checking", "USD"),
    row("wise", "w-in", "2025-03-03", 992, "Wise USD", "USD"), // $8 wire/Wise fee (0.8%)
    row("wise", "w-out", "2025-03-03", -992, "Wise USD", "USD"),
    row("il", "oz-in", "2025-03-06", 3580, "One Zero", "ILS"), // 992 * 3.7 = 3670.4 ILS (~2.5% FX spread/fee)
  ];
  const { matches, dedupRefs } = detectMergedTransfers(rs, [], { convert: fx });
  expect(matches).toHaveLength(2);
  expect(matches[0]).toMatchObject({ out: { id: "m-out" }, in: { id: "w-in" }, fee: 8 });
  expect(matches[1]).toMatchObject({ out: { id: "w-out" }, in: { id: "oz-in" } });
  expect(matches[1]!.fee).toBeGreaterThan(80);
  expect(dedupRefs.size).toBe(4);
});

test("detectMergedTransfers never takes a row filed as income or spending out of the totals", () => {
  const rs: TransferRow[] = [
    row("llc", "rent", "2025-03-02", -1000, "Mercury Checking", "USD", "expense:rent"),
    row("il", "client", "2025-03-03", 3650, "One Zero", "ILS", "revenue:services"),
    row("llc", "m-out", "2025-03-02", -500, "Mercury Checking", "USD", "own:transfer"),
    row("wise", "w-in", "2025-03-03", 497, "Wise USD", "USD"),
  ];
  const { matches } = detectMergedTransfers(rs, [], { convert: fx });
  expect(matches.map((m) => [m.out.id, m.in.id])).toEqual([["m-out", "w-in"]]);
});

test("transferJourneys chains Mercury -> Wise -> One Zero into one journey and keeps an unrelated move apart", () => {
  const rs: TransferRow[] = [
    row("llc", "m-out", "2025-03-02", -1000, "Mercury Checking", "USD"),
    row("wise", "w-in", "2025-03-03", 992, "Wise USD", "USD"),
    row("wise", "w-out", "2025-03-03", -992, "Wise USD", "USD"),
    row("il", "oz-in", "2025-03-06", 3580, "One Zero", "ILS"),
    row("il", "b-out", "2025-03-04", -200, "Hapoalim"),
    row("il", "s-in", "2025-03-04", 200, "Savings"),
  ];
  const js = transferJourneys(detectMergedTransfers(rs, [], { convert: fx }).matches);
  expect(js.map((j) => j.map((m) => `${m.out.id}>${m.in.id}`))).toEqual([["m-out>w-in", "w-out>oz-in"], ["b-out>s-in"]]);
  expect(impliedFee(rs[0]!, rs[1]!)).toBe(8);
  expect(impliedFee(rs[4]!, rs[5]!)).toBe(0);
});

test("the bank's own data wins: Mercury's converted amount and a shared reference beat a closer-looking guess", () => {
  const wire = { ...row("llc", "wire", "2025-03-03", -1000, "Mercury Checking", "USD"), link: { to: { amount: 3610, currency: "ILS" } } };
  const rs: TransferRow[] = [
    wire,
    row("il", "decoy", "2025-03-04", 3700, "Hapoalim"), // exactly 1000 at the BoI rate: the amount-only guess
    row("il", "real", "2025-03-05", 3610, "One Zero"), // what Mercury said would arrive
  ];
  const [m] = suggestTransfers(rs, [], { convert: fx });
  expect(m).toMatchObject({ out: { id: "wire" }, in: { id: "real" }, evidence: 2, fee: 90 });

  const memo = { ...row("llc", "ach", "2025-03-02", -500, "Mercury Checking", "USD"), link: { ref: "DGM payout 0325" } };
  const byRef = suggestTransfers(
    [
      memo,
      row("w", "other", "2025-03-02", 500, "Wise USD", "USD"),
      { ...row("w", "mine", "2025-03-03", 500, "Wise USD", "USD"), link: { ref: "DGM payout 0325" } },
    ],
    [],
  );
  expect(byRef.map((x) => [x.in.id, x.evidence])).toEqual([["mine", 2]]);

  const named = { ...row("llc", "n", "2025-03-02", -200, "Mercury Checking", "USD"), link: { party: "Dolmen Gate · Wise" } };
  expect(suggestTransfers([named, row("il", "x", "2025-03-02", 200, "Bank", "USD"), row("w", "y", "2025-03-02", 200, "Wise USD", "USD")], [])[0]).toMatchObject(
    { in: { id: "y" }, evidence: 1 },
  );
});

test("isAutoCardPayoff & ledger: Mercury Credit card payments auto-classify as transfer:internal without duplicating expenses", () => {
  const mk = (id: string, account: string, amount: number, desc: string, kind?: string) => ({
    id,
    date: "2026-04-01",
    amount,
    desc,
    source: "mercury",
    account,
    file: "mercury-sync.json",
    page: 1,
    ...(kind ? { kind } : {}),
  });
  const stored = [
    mk("c1", "Mercury Credit", -120, "OpenAI", "creditCardTransaction"),
    mk("p1", "Mercury Checking ••1234", -120, "Mercury Credit", "creditCardPayment"),
    mk("p2", "Mercury Credit", 120, "Payment Thank You", "creditCardPayment"),
    mk("p3", "Mercury Checking ••1234", -50, "Mercury Credit Autopay"),
  ];
  expect(isAutoCardPayoff(stored[0]!)).toBe(false);
  expect(isAutoCardPayoff(stored[1]!)).toBe(true);
  expect(isAutoCardPayoff(stored[2]!)).toBe(true);
  expect(isAutoCardPayoff(stored[3]!)).toBe(true);

  const rows = ledger(stored, { p3: "expense:other" }, [["OpenAI", "expense:software"]]);
  expect(rows.find((r) => r.id === "c1")?.category).toBe("expense:software");
  expect(rows.find((r) => r.id === "p1")).toMatchObject({ category: "transfer:internal", why: "auto-transfer" });
  expect(rows.find((r) => r.id === "p2")).toMatchObject({ category: "transfer:internal", why: "auto-transfer" });
  // Manual override always wins over auto-transfer
  expect(rows.find((r) => r.id === "p3")).toMatchObject({ category: "expense:other", why: "manual" });
});
