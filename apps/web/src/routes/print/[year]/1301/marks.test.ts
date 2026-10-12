import { expect, test } from "vite-plus/test";
import { marks, type Layout } from "./marks.ts";

test("1301 marks: X, cells right-aligned, money grouped", () => {
  const L: Layout = {
    size: [100, 100],
    pages: ["p-1.png"],
    fields: {
      mine: [{ page: 1, kind: "check", x0: 10, x1: 20, top: 30, bottom: 40 }],
      id: [{ page: 1, kind: "text", align: "cells", cells: [1, 2, 3, 4], x0: 0, x1: 0, top: 0, bottom: 20 }],
      "238": [{ page: 1, kind: "text", x0: 10, x1: 50, top: 0, bottom: 12 }],
      "060": [{ page: 2, kind: "text", x0: 0, x1: 9, top: 0, bottom: 0 }],
    },
  };
  const v = (k: string) => ({ mine: "X", id: "1-23", "238": "18414", "060": "5" })[k] ?? "";
  const ms = marks(L, 1, v);
  expect(ms.find((x) => x.cls === "x")).toEqual({ cls: "x", text: "X", style: "left:15pt;top:35pt" });
  expect(ms.filter((x) => x.cls === "cell").map((x) => x.text + x.style)).toEqual(["1left:2pt;top:8pt", "2left:3pt;top:8pt", "3left:4pt;top:8pt"]);
  expect(ms.find((x) => x.cls === "txt")?.text).toBe("18,414");
  expect(ms).toHaveLength(5); // 060 is on page 2
});
