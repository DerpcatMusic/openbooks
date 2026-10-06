import { describe, expect, it } from "vite-plus/test";
import type { StatementRow } from "@openbooks/schema";
import { intAmount, parseJson, uid, uidAmount } from "./uid.ts";

describe("uid", () => {
  it("untagged rows print as floats, tagged integer literals as ints (exact past 2^53)", () => {
    const row = (amount: number): StatementRow => ({ date: "2025-01-01", amount, desc: "x", source: "bank", account: "A", file: "f", page: 1, key: "k" });
    const d = parseJson('{"a": 10, "b": 10.0, "c": 9007199254740993, "d": -0}') as Record<string, number>;
    expect(["a", "b", "c", "d"].map((k) => uidAmount(intAmount(row(d[k]!), d, k)))).toEqual(["10", "10.0", "9007199254740993", "0"]);
    expect(uidAmount(row(10))).toBe("10.0");
    // sha1("bank|2025-01-01|10.0|x|k")[:12], printed by python3
    expect(uid(row(10))).toBe(py0);
  });
});

const py0 = "3c299f17026b";
