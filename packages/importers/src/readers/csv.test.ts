// Expected values below were produced by books.py (Python 3.14) on the same inputs.
import { describe, expect, it } from "vite-plus/test";
import type { CsvProfile } from "@openbooks/schema";
import { uid, uidAmount } from "../uid.ts";
import { csvDate, csvDecode, csvPreview, csvTable, mappedCsv, money, pyFloat } from "./csv.ts";

// A Hebrew bank export in cp1255 (Excel era): title line, header, a quoted amount, two zero-fee lines without a reference, a footer.
const LEUMI = Uint8Array.from(
  "e3e5e720faf0e5f2e5fa3b3b3b0d0afae0f8e9ea3bfae9e0e5f83be7e5e1e43be6ebe5fa3be0f1eeebfae00d0a33312f31322f323032353b22e4f2e1f8e42020ee2decf7e5e7223b3b22312e3233342c3530223b37370d0a30312f30312f323032363bf2eeece43b302c30303b302c30303b0d0a30312f30312f323032363bf2eeece43b302c30303b302c30303b0d0a30322f30312f323032363b224f66666963653b20737570706c696573223b2831322e35293b3b0d0af1e422eb3b3b3b3b0d0a"
    .match(/../g)!
    .map((h) => parseInt(h, 16)),
);
const profile: CsvProfile = {
  name: "Leumi",
  account: "Leumi ILS",
  headerSignature: "תאריך|תיאור|חובה|זכות|אסמכתא",
  dateCol: 0,
  descCol: 1,
  debitCol: 2,
  creditCol: 3,
  refCol: 4,
};

describe("csvDecode", () => {
  it("falls back to Python's cp1255 table", () => {
    expect(csvDecode(LEUMI).slice(0, 10)).toBe("דוח תנועות");
    expect(csvDecode(Uint8Array.of(0xca, 0xfd, 0x80))).toBe("�‎€"); // 0xCA undefined in Python (WHATWG maps it)
  });
  it("drops one UTF-8 BOM", () => expect(csvDecode(new TextEncoder().encode("﻿a,b"))).toBe("a,b"));
});

describe("csvTable", () => {
  it("sniffs the delimiter and parses like Python's csv module", () => {
    expect(csvTable('a;b;"c;d"\n1;2;3')).toEqual([
      [
        ["a", "b", "c;d"],
        ["1", "2", "3"],
      ],
      ";",
    ]);
    expect(csvTable('x,"multi\r\nline",  y \r\n\r\n"a""b",c')).toEqual([[["x", "multi\r\nline", "y"], [], ['a"b', "c"]], ","]);
    expect(csvTable("a\tb\tc\n1\t2\t3")[1]).toBe("\t");
  });
  it("rejects a lone CR inside a line, as Python does on StringIO", () => expect(() => csvTable("a,b\rc,d")).toThrow(/new-line/));
});

describe("money / csvDate / pyFloat", () => {
  it.each([
    ["₪1,234.50", 1234.5],
    ["-$5", -5],
    ["(12.00)", -12],
    ["12.00-", -12],
    ["1.234,56 €", 1234.56],
    ["−3,5", -3.5],
    ["1,234", 1234],
    ["1.234.567", 1234567],
    ['12 ש"ח', 12],
    ["", null],
    ["abc", null],
  ])("money(%j) = %j", (s, v) => expect(money(s)).toBe(v));
  it("keeps -0", () => expect(Object.is(money("-0"), -0)).toBe(true));
  it.each([
    ["31/12/2025", undefined, "2025-12-31"],
    ["12/31/25", "MM/DD/YYYY", "2025-12-31"],
    ["2025-12-31", "YYYY-MM-DD", "2025-12-31"],
    ["31.12.2025 10:30", "DD/MM/YYYY", "2025-12-31"],
    ["29/02/2025", undefined, null],
    ["29/02/2024", undefined, "2024-02-29"],
    ["x", undefined, null],
  ])("csvDate(%j, %j) = %j", (s, f, v) => expect(csvDate(s, f)).toBe(v));
  it("float() grammar", () => {
    expect([pyFloat(" 1_000.5 "), pyFloat("1e3"), pyFloat("١٢"), pyFloat("-inf"), pyFloat("0x10"), pyFloat("1__0"), pyFloat("")]).toEqual([
      1000.5,
      1000,
      12,
      -Infinity,
      null,
      null,
      null,
    ]);
  });
});

describe("mappedCsv", () => {
  it("reads a cp1255 Hebrew export with debit/credit columns; ids match books.py", () => {
    const m = mappedCsv({ name: "leumi.csv", bytes: LEUMI, text: csvDecode(LEUMI) }, { csvProfiles: [{ ...profile, headerSignature: "nope" }, profile] })!;
    expect(m.checks).toEqual([]);
    expect(m.rows.map((r) => [r.date, r.amount, r.desc, r.page, r.key, uidAmount(r), uid(r)])).toEqual([
      ["2025-12-31", 1234.5, "העברה מ-לקוח", 3, "Leumi ILS|77", "1234.5", "fd64699d91a8"],
      ["2026-01-01", 0, "עמלה", 4, "Leumi ILS|#0", "0", "edb19e28170e"], // Python int 0: both columns zero
      ["2026-01-01", 0, "עמלה", 5, "Leumi ILS|#1", "0", "2a927271ef04"],
      ["2026-01-02", -12.5, "Office; supplies", 6, "Leumi ILS|#0", "-12.5", "7b1e7ea32fd5"],
    ]);
    expect(m.rows[0]).toEqual({
      date: "2025-12-31",
      amount: 1234.5,
      desc: "העברה מ-לקוח",
      memo: "",
      source: "csv",
      account: "Leumi ILS",
      file: "leumi.csv",
      page: 3,
      key: "Leumi ILS|77",
    });
  });
  it("is null when no profile's header is in the file", () =>
    expect(mappedCsv({ name: "x.csv", bytes: new Uint8Array() }, { csvProfiles: [profile] })).toBe(null));
  it("inverted zero keeps Python's -0.0; no account prints None in the key", () => {
    const m = mappedCsv(
      { name: "z.csv", bytes: new TextEncoder().encode("D,A\n01/01/2025,0\n") },
      { csvProfiles: [{ headerSignature: "D|A", dateCol: 0, amountCol: 1, invert: true }] },
    )!;
    expect([m.rows[0]!.key, m.rows[0]!.account, uidAmount(m.rows[0]!), uid(m.rows[0]!)]).toEqual(["None|#0", "CSV", "-0.0", "a99fb2914963"]);
  });
});

describe("csvPreview", () => {
  it("guesses the header and previews a draft profile", () => {
    const p = csvPreview(csvDecode(LEUMI), { ...profile, invert: true, headerRow: 1 });
    expect([p.delimiter, p.header, p.lines, p.rows.length, p.rows[0]]).toEqual([";", 1, 7, 7, ["דוח תנועות", "", "", ""]]);
    expect(p.parsed!.map((r) => [r.amount, r.file, r.page])).toEqual([
      [-1234.5, "", 3],
      [0, "", 4],
      [0, "", 5],
      [12.5, "", 6],
    ]);
    expect("parsed" in csvPreview("a,b", {} as CsvProfile)).toBe(false);
  });
});
