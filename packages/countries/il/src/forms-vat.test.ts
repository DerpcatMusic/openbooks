import { describe, expect, it } from "vite-plus/test";
import type { Txn } from "@openbooks/schema";
import { form1301, form1301Auto, form1301FromBooks } from "./forms.ts";
import { il } from "./index.ts";

const row = (id: string, amount: number, category: string): Txn => ({ id, date: "2026-03-01", amount, desc: id, source: "bank", account: "b", file: "", page: 0, category, why: "" });
const txns = [row("a", 11800, "business:sales"), row("b", -2360, "expense:software"), row("c", -1180, "expense:equipment")];
const T = il.table(2026);

describe("1301 for VAT-registered books", () => {
  it("takes turnover and expenses without VAT, equipment as depreciation", () => {
    const plain = form1301Auto({ txns, type: "osek-murshe" });
    expect(plain["238"]).toBe("11800"); // what it did before: receipts with VAT
    const a = form1301Auto({ txns, type: "osek-murshe", vat: { turnover: 10000, reclaimed: 540 }, capital: { cost: 1000, depreciation: 100 } });
    expect(a["238"]).toBe("10000");
    // expenses 3540 - 540 VAT - (1000 cost - 100 depreciation) = 2100
    expect(a["150"]).toBe(String(10000 - 2100));
  });
  it("advances come off the balance", () => {
    const base = { y: 2026, txns, type: "osek-murshe", T };
    const x = form1301({ ...base, vat: { turnover: 10000, reclaimed: 0 } });
    const y = form1301({ ...base, vat: { turnover: 10000, reclaimed: 0 }, advances: 300 });
    expect(x.turnover).toBe(10000);
    expect(y.advances).toBe(300);
    expect(y.balance).toBe(x.balance - 300);
  });
  it("fills the boxes tagged spending can supply", () => {
    expect(
      form1301FromBooks([
        { rule: "il.donations", gross: 500, deductible: 0 },
        { rule: "il.keren-hishtalmut", gross: 20000, deductible: 13202 },
        { rule: "il.software", gross: 99, deductible: 99 },
      ]),
    ).toEqual({ "037": "500", "136": "13202" });
  });
});
