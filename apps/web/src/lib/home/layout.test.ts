import { expect, test } from "vite-plus/test";
import { arrange, CARDS, move } from "./layout.ts";

test("home layout: saved order kept, new cards slot in after their default neighbour, unknown ids dropped", () => {
  expect(arrange(null).order).toEqual([...CARDS]);
  const { order, hidden } = arrange({ order: ["recent", "metrics", "gone", "chart"], hidden: ["flow", "nope"] });
  expect(order.slice(0, 2)).toEqual(["recent", "metrics"]);
  expect(order.indexOf("overview")).toBe(order.indexOf("metrics") + 1);
  expect(new Set(order)).toEqual(new Set(CARDS));
  expect([...hidden]).toEqual(["flow"]);
  expect(move(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
  expect(move(["a", "b"], "a", -1)).toEqual(["a", "b"]);
});
