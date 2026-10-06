import { describe, expect, it } from "vite-plus/test";
import type { StoredTxn, Txn } from "@openbooks/schema";
import {
  balances,
  byAccount,
  cashIn,
  checkDictionaries,
  classify,
  cleanRules,
  inflate,
  ledger,
  payerOf,
  pl,
  priorPeriod,
  pyRound,
  pyStr,
  suggestRule,
  translate,
  type Dict,
} from "./index.ts";

const row = (id: string, date: string, amount: number, desc: string, extra: Partial<StoredTxn> = {}): StoredTxn => ({
  id,
  date,
  amount,
  desc,
  source: "bank",
  account: "One Zero",
  file: "a.pdf",
  page: 1,
  ...extra,
});

describe("python compatibility", () => {
  it("pyRound matches Python round(x, 2)", () => {
    // values printed by python3: round(0.125,2) etc.
    expect([0.125, -0.125, 0.375, 2.675, 1.005, -3.335, 1234.565].map((x) => pyRound(x))).toEqual([0.12, -0.12, 0.38, 2.67, 1, -3.33, 1234.57]);
    expect(Object.is(pyRound(-0.001), -0)).toBe(true); // Python: round(-0.001, 2) == -0.0
    expect(pyStr(pyRound(-0.001))).toBe("-0.0");
  });
  it("pyStr matches str(float) / str(int)", () => {
    expect([pyStr(-12), pyStr(0.1 + 0.2), pyStr(12, true), pyStr(1234.5)]).toEqual(["-12.0", "0.30000000000000004", "12", "1234.5"]);
    expect(() => pyStr(1e-7)).toThrow();
  });
});

describe("ledger", () => {
  const stored = [
    row("a", "2025-02-01", 100, "PAYPAL *client", { memo: "inv 7" }),
    row("b", "2025-01-05", -20, "Figma", { source: "mercury", mcat: "Software", account: "Mercury Checking" }),
    row("c", "2025-03-01", 50, "unknown"),
  ];
  it("override > first matching rule (desc, memo or [mcat]) > ask; journal lines are credit − debit; sorted by date", () => {
    const L = ledger(
      stored,
      { c: "personal:family" },
      [
        ["[Software]", " expense:software "],
        ["PAYPAL", "business:paypal"],
        ["inv", "business:client"],
      ],
      [
        {
          id: "je1",
          date: "2025-01-31",
          memo: "",
          lines: [
            { account: "expense:equipment", debit: 10.005 },
            { account: "equity:owner", credit: 10.005 },
          ],
        },
      ],
    );
    expect(L.map((t) => [t.id, t.category, t.why])).toEqual([
      ["b", "expense:software", "[Software]"],
      ["je1-0", "expense:equipment", "journal"],
      ["je1-1", "equity:owner", "journal"],
      ["a", "business:paypal", "PAYPAL"],
      ["c", "personal:family", "manual"],
    ]);
    expect(L[1]).toMatchObject({ amount: -10.01, desc: "Journal entry", account: "Journal", source: "journal" });
    expect(ledger([row("x", "2025-01-01", 1, "zzz")], {}, []).at(0)).toMatchObject({ category: "ask", why: "" });
  });
  it("classify: overrides, or a rule on top that clears overrides", () => {
    expect(classify(["a"], "business:client", [], { a: "x", b: "y" })).toEqual({ rules: [], overrides: { a: "business:client", b: "y" } });
    expect(classify(["a"], "business:client", [["old", "expense:x"]], { a: "x" }, "PAY,PAL")).toEqual({
      rules: [
        ["PAY PAL", "business:client"],
        ["old", "expense:x"],
      ],
      overrides: {},
    });
    expect(
      cleanRules([
        [" ", "a"],
        ["m", " "],
        [" k ", " c "],
      ]),
    ).toEqual([["k", "c"]]);
  });
});

describe("reports", () => {
  const T = (amount: number, category: string, extra: Partial<Txn> = {}): Txn => ({
    ...row(String(Math.random()), "2025-01-01", amount, "d"),
    category,
    why: "",
    ...extra,
  });
  const ts = [
    T(1000, "revenue:x"),
    T(500, "business:y"),
    T(-200, "cogs:h"),
    T(-100, "expense:s"),
    T(30, "other-income:c"),
    T(-7, "ask"),
    T(-999, "transfer:internal"),
    T(-50, "personal:z"),
  ];
  it("cash-basis P&L", () => {
    expect(pl(ts)).toMatchObject({ revenue: 1500, cogs: 200, gross: 1300, opex: 100, operating: 1200, other: 30, uncat: -7, net: 1223 });
    expect(
      byAccount(ts)
        .slice(0, 2)
        .map((a) => a.key),
    ).toEqual(["revenue:x", "transfer:internal"]);
    expect(cashIn(ts)).toBe(1530);
  });
  it("balances count statement-only accounts and stop at the day", () => {
    const b = balances(
      [T(10, "x", { account: "A" }), T(5, "x", { account: "A", date: "2025-02-01" })],
      [{ file: "m.json", label: "B", period: ["", ""], parsed: 0, total: 0, balance: true }],
      "2025-01-31",
    );
    expect(b).toEqual({ A: 10, B: 0 });
  });
  it("periods, payers, rule suggestions", () => {
    expect(priorPeriod({ from: "2025-01", to: "2025-03" })).toEqual({ from: "2024-10", to: "2024-12" });
    expect(payerOf({ desc: "העברה 12/03 ref-55 משה", source: "bank" })).toBe("העברה ref משה");
    expect(
      suggestRule([
        { desc: "SPOTIFY AB 1", source: "bank" },
        { desc: "x SPOTIFY 2", source: "bank" },
      ]),
    ).toBe("SPOTIFY");
    expect(
      suggestRule([
        { desc: "bit", source: "bit", who: "Dana" },
        { desc: "bit", source: "bit", who: "Dana" },
      ]),
    ).toBe("bit: Dana");
  });
});

describe("privacy (ported from web/src/lib/privacy.js self-check)", () => {
  it("inflates 3–9×, deterministic, sign kept, zero stays zero, salted, no single factor", () => {
    for (const n of [0.5, 1, 99.99, 1234.56, 26305, 1e7]) {
      const s = inflate(n, 7);
      expect(s >= n * 3 && s < n * 9 + 0.01).toBe(true);
      expect(inflate(-n, 7)).toBe(-s);
      expect(inflate(n, 7)).toBe(s);
    }
    expect(inflate(0, 7)).toBe(0);
    expect(new Set([1, 2, 3, 4, 5].map((s) => inflate(1000, s))).size).toBeGreaterThan(3);
    expect(inflate(1000, 7) / 1000).not.toBe(inflate(2000, 7) / 2000);
  });
});

describe("i18n", () => {
  const en: Dict = { hi: "Hi {name}", n: { one: "{n} item", other: "{n} items" }, only: "English" };
  const he: Dict = { hi: "שלום {name}", n: { one: "פריט אחד", two: "שני פריטים", other: "{n} פריטים" } };
  it("translate: plurals, fallback to English, then the key", () => {
    expect(translate({ en, he }, "he", "n", { n: 2 })).toBe("שני פריטים");
    expect(translate({ en, he }, "en", "n", { n: 1 })).toBe("1 item");
    expect(translate({ en, he }, "he", "only")).toBe("English");
    expect(translate({ en, he }, "he", "nope")).toBe("nope");
    expect(translate({ en, he }, "he", "hi", { name: "דנה" })).toBe("שלום דנה");
  });
  it("checkDictionaries (ported from web/src/lib/locales/check.js)", () => {
    expect(checkDictionaries(en, he)).toEqual(["missing: only"]);
    expect(checkDictionaries({ a: "{x}" }, { a: "y", b: "z" })).toEqual(["a: translation lacks {x}", "extra (not in en): b"]);
  });
  it("the shipped dictionaries pass", async () => {
    const dir = "../../../apps/web/src/lib/locales/";
    const [en, he] = (await Promise.all([import(`${dir}en.ts`), import(`${dir}he.ts`)])) as { default: Dict }[];
    expect(checkDictionaries(en!.default, he!.default)).toEqual([]);
  });
});
