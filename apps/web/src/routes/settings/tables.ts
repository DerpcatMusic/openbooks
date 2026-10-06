// Tax table editor helpers. Brackets are edited as "up to : rate %" pairs: "84120:10, 120720:14, ∞:50".
export type Brackets = [number | null, number][];
export const bracketsText = (b: Brackets) => b.map(([hi, r]) => `${hi ?? "∞"}:${+(r * 100).toFixed(2)}`).join(", ");
export const parseBrackets = (s: string): Brackets =>
  s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [hi = "", r = ""] = p.split(":");
      return [/∞|inf/i.test(hi) ? null : +hi.replace(/[^\d.]/g, ""), +r / 100];
    });
/** [field, input type] per country; labels are settings.f.<field>. */
export const FIELDS: Record<"il" | "us", [string, "number" | "text"][]> = {
  il: (
    [
      "point",
      "zairCeiling",
      "capitalRate",
      "avgWageMonthly",
      "blReducedMonthly",
      "blMaxMonthly",
      "blMinMonthly",
      "blRateReduced",
      "blRateFull",
      "healthRateReduced",
      "healthRateFull",
      "mezakaMonthly",
      "pensionRate1",
      "pensionRate2",
      "donationMin",
    ] as const
  ).map((k) => [k, "number"]),
  us: [
    ["form5472Penalty", "number"],
    ["dueMonthDay", "text"],
    ["extendedMonthDay", "text"],
    ["delawareTax", "number"],
    ["wyomingMin", "number"],
    ["treatyRoyalty", "number"],
    ["defaultWithholding", "number"],
    ["nec1099", "number"],
  ],
};
