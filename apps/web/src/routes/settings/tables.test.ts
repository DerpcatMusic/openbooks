import { expect, test } from "vitest";
import { bracketsText, parseBrackets } from "./tables.ts";

test("brackets round-trip through the text editor", () => {
  const b: [number | null, number][] = [
    [84120, 0.1],
    [120720, 0.14],
    [null, 0.5],
  ];
  expect(bracketsText(b)).toBe("84120:10, 120720:14, ∞:50");
  expect(parseBrackets(bracketsText(b))).toEqual(b);
  expect(parseBrackets("₪1000 : 12.5, inf:47")).toEqual([
    [1000, 0.125],
    [null, 0.47],
  ]);
});
