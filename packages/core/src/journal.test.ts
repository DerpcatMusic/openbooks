import { describe, expect, it } from "vite-plus/test";
import { imbalance, isIsoDate, journalProblem, parseDate, parseMoney, pasteEntries } from "./index.ts";

const e = (lines: { account: string; debit?: unknown; credit?: unknown }[], date = "2026-03-10") => ({ date, lines });
const good = [{ account: "expense:software", debit: 100 }, { account: "equity:owner", credit: 100 }];

describe("journalProblem", () => {
  it("accepts a balanced entry with a debit and a credit", () => expect(journalProblem(e(good))).toBeNull());
  it("compares in whole cents, so float noise is fine and a missing cent is not", () => {
    expect(journalProblem(e([{ account: "expense:a", debit: 0.1 }, { account: "expense:a", debit: 0.2 }, { account: "equity:b", credit: 0.3 }]))).toBeNull();
    expect(journalProblem(e([{ account: "expense:a", debit: "100.10" }, { account: "equity:b", credit: 100 }]))).toBe("unbalanced");
    expect(imbalance([{ account: "a", debit: 100.1 }, { account: "b", credit: 100 }])).toBe(0.1);
  });
  it("needs at least one debit line and one credit line", () => {
    expect(journalProblem(e([{ account: "expense:a", debit: 5 }, { account: "expense:b", debit: -5 }]))).toBe("noCredit");
    expect(journalProblem(e([{ account: "expense:a", credit: 5 }, { account: "equity:b", credit: 5 }]))).toBe("noDebit");
  });
  it("needs a real date, an amount somewhere, and a ledger account on every line that has an amount", () => {
    expect(journalProblem(e(good, ""))).toBe("date");
    expect(journalProblem(e(good, "2026-02-30"))).toBe("date");
    expect(journalProblem(e([{ account: "ask" }, { account: "ask" }]))).toBe("empty");
    expect(journalProblem(e([{ account: "ask", debit: 5 }, { account: "equity:b", credit: 5 }]))).toBe("account");
    expect(journalProblem(e([{ account: "bogus:x", debit: 5 }, { account: "equity:b", credit: 5 }]))).toBe("account");
    expect(journalProblem(e([...good, { account: "ask", debit: "", credit: "" }]))).toBeNull(); // a blank row of the editor is ignored
  });
  it("refuses archived accounts and dates before the entries start date", () => {
    expect(journalProblem(e(good), { coa: { "expense:software": { archived: true } } })).toBe("archived");
    expect(journalProblem(e(good), { coa: { "expense:other": { archived: true } } })).toBeNull();
    expect(journalProblem(e(good), { from: "2026-03-11" })).toBe("beforeStart");
    expect(journalProblem(e(good), { from: "2026-03-10" })).toBeNull();
  });
});

describe("parsing", () => {
  it("dates: ISO, day-first or month-first by hint, 13+ says which, dots are day first", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(parseDate("2026-03-05")).toBe("2026-03-05");
    expect(parseDate("05/03/2026", true)).toBe("2026-03-05");
    expect(parseDate("05/03/2026", false)).toBe("2026-05-03");
    expect(parseDate("25/03/2026", false)).toBe("2026-03-25");
    expect(parseDate("03/25/2026", true)).toBe("2026-03-25");
    expect(parseDate("5.3.26", false)).toBe("2026-03-05");
    expect(parseDate("31/02/2026")).toBe("");
    expect(parseDate("tomorrow")).toBe("");
  });
  it("amounts: thousands separators, currency signs, parentheses, blank is 0, junk is NaN", () => {
    expect(parseMoney("1,234.50")).toBe(1234.5);
    expect(parseMoney("$ 99")).toBe(99);
    expect(parseMoney("(50.25)")).toBe(50.25);
    expect(parseMoney("")).toBe(0);
    expect(parseMoney("12,34")).toBeNaN();
    expect(parseMoney("abc")).toBeNaN();
  });
});

describe("pasteEntries", () => {
  const resolve = (c: string) => (/^[a-z-]+:[a-z-]+$/.test(c) ? c : ({ Software: "expense:software", Owner: "equity:owner", Hosting: "cogs:hosting" } as Record<string, string>)[c] ?? "");
  it("groups rows by date and memo into balanced entries, tab- or comma-separated, header skipped", () => {
    const text = ["Date\tAccount\tDebit\tCredit\tMemo", "2026-03-10\tSoftware\t100\t\tGitHub", "2026-03-10\tOwner\t\t100\tGitHub", "2026-03-11,Hosting,\"1,200.50\",,AWS", "2026-03-11,Owner,,\"1,200.50\",AWS"].join("\n");
    const d = pasteEntries(text, resolve);
    expect(d.errors).toEqual([]);
    expect(d.rejected).toEqual([]);
    expect(d.entries).toEqual([
      { date: "2026-03-10", memo: "GitHub", lines: [{ account: "expense:software", debit: 100, credit: 0 }, { account: "equity:owner", debit: 0, credit: 100 }] },
      { date: "2026-03-11", memo: "AWS", lines: [{ account: "cogs:hosting", debit: 1200.5, credit: 0 }, { account: "equity:owner", debit: 0, credit: 1200.5 }] },
    ]);
  });
  it("reports unreadable rows with their row number, and groups that don't balance as rejected", () => {
    const text = ["2026-03-10\tSoftware\t100\t\tA", "2026-03-10\tOwner\t\t90\tA", "nonsense\tOwner\t\t5\tB", "2026-03-12\tNowhere\t5\t\tC", "2026-03-12\tSoftware\tx\t\tC", "2026-03-12\tSoftware\t5\t5\tC", "2026-03-12\tSoftware"].join("\n");
    const d = pasteEntries(text, resolve);
    expect(d.errors).toEqual([{ row: 3, problem: "date" }, { row: 4, problem: "account" }, { row: 5, problem: "amount" }, { row: 6, problem: "both" }, { row: 7, problem: "columns" }]);
    expect(d.rejected).toEqual([{ date: "2026-03-10", memo: "A", problem: "unbalanced", rows: [1, 2] }]);
    expect(d.entries).toEqual([]);
  });
  it("applies the books' rules: archived accounts and the entries start date", () => {
    const text = "2026-03-10\tSoftware\t5\t\tA\n2026-03-10\tOwner\t\t5\tA";
    expect(pasteEntries(text, resolve, { coa: { "equity:owner": { archived: true } } }).rejected[0]!.problem).toBe("archived");
    expect(pasteEntries(text, resolve, { from: "2026-04-01" }).rejected[0]!.problem).toBe("beforeStart");
  });
  it("a day-first spreadsheet is read as such when asked", () => {
    const text = "05/03/2026\tSoftware\t5\t\tA\n05/03/2026\tOwner\t\t5\tA";
    expect(pasteEntries(text, resolve, { dayFirst: true }).entries[0]!.date).toBe("2026-03-05");
    expect(pasteEntries(text, resolve, { dayFirst: false }).entries[0]!.date).toBe("2026-05-03");
  });
});
