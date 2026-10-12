import { createHash } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { sha1Hex } from "./sha1.ts";

test("sha1Hex matches node:crypto, including block boundaries and non-ASCII", () => {
  for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "bit|2025-01-02|-12.5|קפה ☕|k1"])
    expect(sha1Hex(s)).toBe(createHash("sha1").update(s, "utf8").digest("hex"));
});
