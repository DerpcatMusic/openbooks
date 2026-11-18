// Bank of Israel representative exchange rates ("שער יציג") from its public SDMX API, as ILS per one unit.
// Endpoint (verified 2026-11-18 with a real request):
//   https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?startperiod=2025-01-01&endperiod=2025-01-10&format=csv
// CSV columns include UNIT_MULT (JPY is quoted per 100: UNIT_MULT 2), TIME_PERIOD and OBS_VALUE; an unknown series answers 404.
// No key, no account. Only weekdays the BoI publishes appear (core/fx.ts rateOn carries the last one over weekends and holidays).

// OPENBOOKS_BOI_API: tests point it at a local fake. Read on each call so a test can set it after import.
const base = () => process.env.OPENBOOKS_BOI_API ?? "https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0";

/** Splits one CSV line (BoI quotes fields with commas in COMMENTS). */
const cells = (line: string) => [...line.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1]!.replace(/^"|"$/g, "").replaceAll('""', '"')).slice(0, -1);

/** Parse a BoI EXR CSV into date → ILS per one unit. */
export function parseBoiCsv(text: string): Record<string, number> {
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
  if (!head) return {};
  const h = cells(head),
    di = h.indexOf("TIME_PERIOD"),
    vi = h.indexOf("OBS_VALUE"),
    mi = h.indexOf("UNIT_MULT");
  if (di < 0 || vi < 0) throw new Error("Bank of Israel: unexpected CSV (no TIME_PERIOD / OBS_VALUE)");
  const out: Record<string, number> = {};
  for (const l of lines) {
    const c = cells(l),
      v = Number(c[vi]),
      mult = mi >= 0 ? Number(c[mi]) || 0 : 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(c[di] ?? "") && v > 0) out[c[di]!] = v / 10 ** mult;
  }
  return out;
}

/** The representative rates of `currency` (ISO 4217) between two dates, inclusive. {} for a currency the BoI doesn't publish. Throws when offline. */
export async function fetchBoiRates(currency: string, from: string, to: string, timeoutMs = 8000): Promise<Record<string, number>> {
  if (!/^[A-Z]{3}$/.test(currency) || currency === "ILS") return {};
  const url = `${base()}/RER_${currency}_ILS?startperiod=${from}&endperiod=${to}&format=csv`;
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "text/csv" } });
  if (r.status === 404) return {};
  if (!r.ok) throw new Error(`Bank of Israel ${r.status} for ${currency}`);
  return parseBoiCsv(await r.text());
}
