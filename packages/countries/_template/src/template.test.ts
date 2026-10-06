import { describe, expect, it } from "vite-plus/test";
import { checkDictionaries } from "@openbooks/core";
import { incomeTax, pack } from "./index.ts";

describe("template pack", () => {
  it("satisfies the contract", () => {
    expect(incomeTax(20000, pack.table(2026))).toBe(2000); // worked example: 10,000 at 0% + 10,000 at 20%
    expect(checkDictionaries(pack.strings.en, pack.strings.he)).toEqual([]);
    expect(pack.manifest.businessTypes.map((b) => b.key)).toContain(pack.manifest.defaultType);
  });
});
