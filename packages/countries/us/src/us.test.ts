import { describe, expect, it } from "vite-plus/test";
import { checkDictionaries } from "@openbooks/core";
import { llcObligations, missingProfile, us } from "./index.ts";

describe("us pack", () => {
  it("LLC obligations with due dates from the table", () => {
    const o = llcObligations(2025, us.table(2025), { state: "WY" });
    expect(o.map((x) => [x.form, x.due])).toEqual([
      ["5472", "2026-04-15"],
      ["1120 (pro forma)", "2026-04-15"],
      ["State annual report", undefined],
    ]);
    expect(o[2]!.why).toContain("WY");
    expect(missingProfile({ ein: "1" }).length).toBe(11);
  });
  it("playbook and strings", () => {
    expect(us.playbook.length).toBe(9);
    expect(checkDictionaries(us.strings.en, us.strings.he)).toEqual([]);
    expect(us.manifest.businessTypes.find((b) => b.key === "llc-disregarded")?.treatment).toBe("transparent");
  });
});
