import { expect, test } from "vite-plus/test";
import { clean, duplicate, off, problem, type Entry } from "./journal.ts";

const e = (lines: Entry["lines"], date = "2026-01-15"): Entry => ({ id: "x", date, lines });

test("journal: balanced debit/credit validation", () => {
  expect(
    problem(
      e([
        { account: "expense:x", debit: "100" },
        { account: "equity:owner", credit: 100 },
      ]),
    ),
  ).toBeNull();
  expect(
    off(
      e([
        { account: "expense:a", debit: "100.10" },
        { account: "equity:b", credit: "100" },
      ]),
    ),
  ).toBe(0.1);
  expect(
    problem(
      e([
        { account: "expense:a", debit: "100.10" },
        { account: "equity:b", credit: "100" },
      ]),
    ),
  ).toBe("unbalanced");
  expect(
    problem(
      e([
        { account: "expense:a", debit: 0.1 },
        { account: "expense:a", debit: 0.2 },
        { account: "equity:b", credit: 0.3 },
      ]),
    ),
  ).toBeNull(); // float noise
  expect(
    problem(
      e([
        { account: "ask", debit: 5 },
        { account: "equity:b", credit: 5 },
      ]),
    ),
  ).toBe("account");
  expect(
    problem(
      e([
        { account: "expense:a", debit: 5 },
        { account: "equity:b", credit: 5 },
        { account: "ask", debit: "" },
      ]),
    ),
  ).toBeNull(); // empty line ignored
  expect(problem(e([{ account: "ask" }, { account: "ask" }]))).toBe("empty");
  expect(
    problem(
      e(
        [
          { account: "expense:a", debit: 1 },
          { account: "equity:b", credit: 1 },
        ],
        "",
      ),
    ),
  ).toBe("date");
  expect(
    clean([
      e([
        { account: "expense:a", debit: "5" },
        { account: "ask", debit: "", credit: "" },
        { account: "equity:b", credit: "5" },
      ]),
    ])[0]!.lines,
  ).toEqual([
    { account: "expense:a", debit: 5, credit: 0 },
    { account: "equity:b", debit: 0, credit: 5 },
  ]);
});

test("journal: a debit line and a credit line are both needed, archived accounts and the start date are refused", () => {
  const two = e([
    { account: "expense:a", debit: 5 },
    { account: "equity:b", credit: 5 },
  ]);
  expect(problem(two, { coa: { "equity:b": { archived: true } } })).toBe("archived");
  expect(problem(two, { from: "2026-02-01" })).toBe("beforeStart");
  expect(problem(two, { from: "2026-01-15" })).toBeNull();
  expect(
    problem(
      e([
        { account: "expense:a", debit: 5 },
        { account: "expense:b", debit: -5 },
      ]),
    ),
  ).toBe("noCredit");
  expect(
    problem(
      e([
        { account: "expense:a", credit: 5 },
        { account: "equity:b", credit: 5 },
      ]),
    ),
  ).toBe("noDebit");
});

test("journal: duplicate copies date, memo and lines into a new draft id", () => {
  const src: Entry = { id: "je1", date: "2026-01-15", memo: "Rent", lines: [{ account: "expense:rent", debit: 100, credit: "" }, { account: "equity:owner", debit: "", credit: 100 }] };
  const copy = duplicate(src, "je2");
  expect(copy).toEqual({ id: "je2", date: "2026-01-15", memo: "Rent", lines: src.lines });
  expect(copy.lines[0]).not.toBe(src.lines[0]); // edits to the copy don't touch the original
  expect(problem(copy)).toBeNull();
});
