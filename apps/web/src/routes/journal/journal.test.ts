import { expect, test } from "vitest";
import { clean, off, problem, type Entry } from "./journal.ts";

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
        { account: "a", debit: "100.10" },
        { account: "b", credit: "100" },
      ]),
    ),
  ).toBe(0.1);
  expect(
    problem(
      e([
        { account: "a", debit: "100.10" },
        { account: "b", credit: "100" },
      ]),
    ),
  ).toBe("unbalanced");
  expect(
    problem(
      e([
        { account: "a", debit: 0.1 },
        { account: "a", debit: 0.2 },
        { account: "b", credit: 0.3 },
      ]),
    ),
  ).toBeNull(); // float noise
  expect(
    problem(
      e([
        { account: "ask", debit: 5 },
        { account: "b", credit: 5 },
      ]),
    ),
  ).toBe("account");
  expect(
    problem(
      e([
        { account: "a", debit: 5 },
        { account: "b", credit: 5 },
        { account: "ask", debit: "" },
      ]),
    ),
  ).toBeNull(); // empty line ignored
  expect(problem(e([{ account: "ask" }, { account: "ask" }]))).toBe("empty");
  expect(
    problem(
      e(
        [
          { account: "a", debit: 1 },
          { account: "b", credit: 1 },
        ],
        "",
      ),
    ),
  ).toBe("date");
  expect(
    clean([
      e([
        { account: "a", debit: "5" },
        { account: "ask", debit: "", credit: "" },
        { account: "b", credit: "5" },
      ]),
    ])[0]!.lines,
  ).toEqual([
    { account: "a", debit: 5, credit: 0 },
    { account: "b", debit: 0, credit: 5 },
  ]);
});
