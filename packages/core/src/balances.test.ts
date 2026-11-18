import { expect, test } from "vite-plus/test";
import { chartOfAccounts } from "./coa.ts";
import { accountCurrencies, cashIn, cashOut, checkAnchors, dailyBalances, mergeAnchors, plOf } from "./reports.ts";

const t = (date: string, amount: number, account = "Checking", category = "expense:x", extra: object = {}) => ({
  date,
  amount,
  account,
  category,
  source: "bank",
  ...extra,
});

test("cash in/out leave out transfers, own money, owner equity, personal and loans", () => {
  const ts = [
    t("2025-01-01", 100, "A", "revenue:x"),
    t("2025-01-01", -40, "A", "expense:x"),
    ...["transfer:internal", "own:transfer", "equity:owner", "personal:family", "loan:bank"].flatMap((c) => [t("2025-01-02", 999, "A", c), t("2025-01-02", -999, "A", c)]),
  ];
  expect([cashIn(ts), cashOut(ts)]).toEqual([100, 40]);
});

test("loan is a liability, not P&L", () => {
  expect(plOf("loan:bank")).toBeNull();
  expect(chartOfAccounts(["loan:bank"], [], {})[0]).toMatchObject({ klass: "liability", side: "credit" });
});

test("daily balances: no anchor starts at 0, one per day, journal rows ignored", () => {
  const r = dailyBalances([t("2025-01-01", 10), t("2025-01-03", -4), { ...t("2025-01-02", 99), source: "journal" }], {}, "2025-01-01", "2025-01-04");
  expect(r.dates).toEqual(["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04"]);
  expect(r.balances).toEqual({ Checking: [10, 10, 6, 6] });
  // history before `from` is carried in
  expect(dailyBalances([t("2024-12-01", 7), t("2025-01-02", 1)], {}, "2025-01-01", "2025-01-02").balances.Checking).toEqual([7, 8]);
});

test("daily balances: an anchor fixes its day, forward and backward from it; the latest anchor on or before a day wins", () => {
  const ts = [t("2025-01-01", 10), t("2025-01-03", -4), t("2025-01-05", 50)];
  // opening 1000 on Jan 2: Jan 1 is worked back from it
  expect(dailyBalances(ts, { Checking: [{ date: "2025-01-02", balance: 1000 }] }, "2025-01-01", "2025-01-05").balances.Checking).toEqual([
    1000, 1000, 996, 996, 1046,
  ]);
  // a second anchor (the bank says 2000 on Jan 4) resets from there on; before it the first still holds
  expect(
    dailyBalances(
      ts,
      {
        Checking: [
          { date: "2025-01-04", balance: 2000 },
          { date: "2025-01-02", balance: 1000 },
        ],
      },
      "2025-01-01",
      "2025-01-05",
    ).balances.Checking,
  ).toEqual([1000, 1000, 996, 2000, 2050]);
  // an account with only an anchor shows its balance
  expect(dailyBalances([], { Savings: [{ date: "2025-01-01", balance: 5 }] }, "2025-01-01", "2025-01-02").balances).toEqual({ Savings: [5, 5] });
});

test("Mercury's reported balance is an automatic anchor; a stored one on the same day wins", () => {
  const auto = checkAnchors([
    { file: "m.json", label: "Ops", period: ["2025-01-01", "2025-01-31"], parsed: 0, total: 1234.5, balance: true },
    { file: "x.pdf", label: "Other", period: ["2025-01-01", "2025-01-31"], parsed: 0, total: 9 },
  ]);
  expect(auto).toEqual({ Ops: [{ date: "2025-01-31", balance: 1234.5 }] });
  expect(mergeAnchors(auto, { Ops: [{ date: "2025-01-31", balance: 1 }] })).toEqual({ Ops: [{ date: "2025-01-31", balance: 1 }] });
  expect(mergeAnchors(auto, { Ops: [{ date: "2025-01-01", balance: 1 }] }).Ops).toHaveLength(2);
});

test("account currency: what most of its rows are in, else the books'", () => {
  expect(
    accountCurrencies(
      [t("2025-01-01", 1, "Card"), t("2025-01-01", 1, "USD acct", "x", { currency: "USD" }), t("2025-01-02", 1, "USD acct", "x", { currency: "USD" }), t("2025-01-03", 1, "USD acct")],
      "ILS",
    ),
  ).toEqual({ Card: "ILS", "USD acct": "USD" });
});
