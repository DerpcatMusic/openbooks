// Money split into display parts: −₪1,234.⁵⁶. Pure (no privacy): Money.svelte applies scramble() first.
// Always en-US grouping inside a forced-LTR span so the sign and symbol never flip in Hebrew.
const cache = new Map<string, Intl.NumberFormat>();
const nf = (currency: string) => {
  let f = cache.get(currency);
  if (!f)
    cache.set(
      currency,
      (f = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })),
    );
  return f;
};

export interface MoneyParts {
  sign: "" | "−";
  symbol: string;
  whole: string;
  cents: string;
}

export function moneyParts(n: number, currency = "ILS"): MoneyParts {
  const p = nf(currency).formatToParts(Math.abs(n));
  const pick = (t: string) =>
    p
      .filter((x) => x.type === t)
      .map((x) => x.value)
      .join("");
  const whole = p
    .filter((x) => x.type === "integer" || x.type === "group")
    .map((x) => x.value)
    .join("");
  const cents = pick("fraction");
  // −0.00 shows as 0.00
  return { sign: n < 0 && (whole !== "0" || /[1-9]/.test(cents)) ? "−" : "", symbol: pick("currency"), whole, cents };
}

/** Plain-text amount (aria-labels, titles, CSV-free contexts): "−₪1,234.56" or "−₪1,234" without cents. */
export function moneyText(n: number, currency = "ILS", cents = true): string {
  const m = moneyParts(n, currency);
  return `${m.sign}${m.symbol}${m.whole}${cents ? `.${m.cents}` : ""}`;
}
