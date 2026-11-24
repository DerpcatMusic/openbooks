// Live market quotes for the Home hub (GET /api/markets).
// Server-side fetch only (no browser CORS, no API keys, no user data in outbound requests).
// Primary source: Yahoo Finance v8 chart API (returns price, daily change, and 5m intraday sparkline points).
// Fallback source: Stooq CSV snapshot (used if a Yahoo symbol fails and a Stooq mapping exists).
// Cached in memory for 60s; on partial or total upstream failure, falls back to last known good quotes flagged stale.

export type MarketGroup = "world" | "il";
export type MarketFormat = "index" | "price" | "fx" | "yield";
export type MarketSource = "yahoo" | "stooq";

export interface InstrumentSpec {
  readonly id: string;
  readonly symbol: string;
  readonly group: MarketGroup;
  readonly label: string;
  readonly format: MarketFormat;
  readonly currency?: string;
  readonly yahooSymbol: string;
  readonly stooqSymbol?: string;
}

export interface MarketQuote {
  id: string;
  symbol: string;
  group: MarketGroup;
  label: string;
  format: MarketFormat;
  currency?: string;
  last: number;
  change: number | null;
  changePct: number | null;
  asOf: string | null;
  series: number[];
  source: MarketSource;
  delayed: boolean;
  stale: boolean;
}

export interface MarketsResponse {
  world: MarketQuote[];
  il: MarketQuote[];
  asOf: string;
  stale: boolean;
  delayed: boolean;
  sources: MarketSource[];
}

export const INSTRUMENTS: readonly InstrumentSpec[] = [
  // Worldwide
  { id: "sp500", symbol: "^GSPC", group: "world", label: "S&P 500", format: "index", currency: "USD", yahooSymbol: "^GSPC", stooqSymbol: "^spx" },
  { id: "nasdaq", symbol: "^IXIC", group: "world", label: "Nasdaq", format: "index", currency: "USD", yahooSymbol: "^IXIC", stooqSymbol: "^ndq" },
  { id: "dow", symbol: "^DJI", group: "world", label: "Dow Jones", format: "index", currency: "USD", yahooSymbol: "^DJI", stooqSymbol: "^dji" },
  { id: "msci-world", symbol: "URTH", group: "world", label: "MSCI World", format: "price", currency: "USD", yahooSymbol: "URTH", stooqSymbol: "urth.us" },
  { id: "gold", symbol: "GC=F", group: "world", label: "Gold", format: "price", currency: "USD", yahooSymbol: "GC=F", stooqSymbol: "xauusd" },
  { id: "brent", symbol: "BZ=F", group: "world", label: "Brent Oil", format: "price", currency: "USD", yahooSymbol: "BZ=F", stooqSymbol: "cb.f" },
  { id: "btc", symbol: "BTC-USD", group: "world", label: "Bitcoin", format: "price", currency: "USD", yahooSymbol: "BTC-USD", stooqSymbol: "btcusd" },
  { id: "us10y", symbol: "^TNX", group: "world", label: "US 10Y", format: "yield", currency: "%", yahooSymbol: "^TNX", stooqSymbol: "10usy.b" },
  // Israel
  { id: "ta35", symbol: "TA35.TA", group: "il", label: "TA-35", format: "index", currency: "ILS", yahooSymbol: "TA35.TA", stooqSymbol: "^ta35" },
  { id: "ta125", symbol: "^TA125.TA", group: "il", label: "TA-125", format: "index", currency: "ILS", yahooSymbol: "^TA125.TA", stooqSymbol: "^ta125" },
  { id: "tabanks", symbol: "TA-BANKS.TA", group: "il", label: "TA Banks-5", format: "index", currency: "ILS", yahooSymbol: "TA-BANKS.TA" },
  { id: "usdils", symbol: "USD/ILS", group: "il", label: "USD / ILS", format: "fx", currency: "ILS", yahooSymbol: "ILS=X", stooqSymbol: "usdils" },
  { id: "eurils", symbol: "EUR/ILS", group: "il", label: "EUR / ILS", format: "fx", currency: "ILS", yahooSymbol: "EURILS=X", stooqSymbol: "eurils" },
  { id: "teva", symbol: "TEVA.TA", group: "il", label: "Teva", format: "price", currency: "ILS", yahooSymbol: "TEVA.TA" },
];

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_SPARKLINE_POINTS = 32;
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const STOOQ_BASE = "https://stooq.com/q/l/";
const REQUEST_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; OpenBooks/1.0)", Accept: "application/json,text/csv,text/plain,*/*" };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

/** Downsample an intraday series evenly to at most `max` points while always keeping the first and last points. */
export function downsample(values: readonly number[], max = MAX_SPARKLINE_POINTS): number[] {
  const clean = values.filter(isNum);
  if (clean.length <= max) return clean.map((v) => round(v, 4));
  const out: number[] = [];
  const step = (clean.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const idx = i === max - 1 ? clean.length - 1 : Math.round(i * step);
    out.push(round(clean[idx]!, 4));
  }
  return out;
}

interface YahooChartPayload {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        symbol?: string;
        exchangeName?: string;
        exchangeDataDelayedBy?: number;
        regularMarketTime?: number;
        regularMarketPrice?: number;
        regularMarketChangePercent?: number;
        fulldayChange?: number;
        fulldayChangePercent?: number;
        chartPreviousClose?: number;
        previousClose?: number;
      };
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }> | null;
    error?: unknown;
  };
}

/** Parse one Yahoo Finance v8 chart JSON payload into a MarketQuote. Returns null if the payload is invalid or missing a price. */
export function parseYahooChart(spec: InstrumentSpec, payload: unknown): MarketQuote | null {
  if (!payload || typeof payload !== "object") return null;
  const result = (payload as YahooChartPayload).chart?.result?.[0];
  if (!result || typeof result !== "object") return null;
  const meta = result.meta;
  if (!meta || typeof meta !== "object") return null;

  const rawCloses = (result.indicators?.quote?.[0]?.close ?? []).filter(isNum);
  const rawLast = isNum(meta.regularMarketPrice) ? meta.regularMarketPrice : rawCloses.at(-1);
  if (!isNum(rawLast)) return null;

  // Tel Aviv stocks (e.g. TEVA.TA) are quoted in ILA (agorot = 1/100 ILS); normalize to ILS.
  const isAgorot = meta.currency?.toUpperCase() === "ILA";
  const divisor = isAgorot ? 100 : 1;
  const last = round(rawLast / divisor, 6);

  const rawPrev = isNum(meta.chartPreviousClose) ? meta.chartPreviousClose : isNum(meta.previousClose) ? meta.previousClose : null;
  const rawChange = isNum(meta.fulldayChange) ? meta.fulldayChange : rawPrev !== null ? rawLast - rawPrev : null;
  const change = rawChange !== null ? round(rawChange / divisor, 6) : null;

  let changePct: number | null = null;
  if (isNum(meta.regularMarketChangePercent)) changePct = round(meta.regularMarketChangePercent, 3);
  else if (isNum(meta.fulldayChangePercent)) changePct = round(meta.fulldayChangePercent, 3);
  else if (rawChange !== null && rawPrev !== null && rawPrev !== 0) changePct = round((rawChange / rawPrev) * 100, 3);

  const asOf = isNum(meta.regularMarketTime) && meta.regularMarketTime > 0 ? new Date(meta.regularMarketTime * 1000).toISOString() : null;
  const series = downsample(isAgorot ? rawCloses.map((v) => v / divisor) : rawCloses);

  const exchange = (meta.exchangeName ?? "").toUpperCase();
  const delayed = isNum(meta.exchangeDataDelayedBy) ? meta.exchangeDataDelayedBy > 0 : exchange !== "CCY" && exchange !== "CCC";
  const currency = spec.format === "yield" ? "%" : isAgorot ? "ILS" : (spec.currency ?? (meta.currency || undefined));

  return {
    id: spec.id,
    symbol: spec.symbol,
    group: spec.group,
    label: spec.label,
    format: spec.format,
    ...(currency ? { currency } : {}),
    last,
    change,
    changePct,
    asOf,
    series,
    source: "yahoo",
    delayed,
    stale: false,
  };
}

const parseNumCell = (s: string | undefined): number | null => {
  if (!s) return null;
  const t = s.trim();
  if (!t || t === "N/D" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Parse Stooq CSV (`f=sd2t2ohlcvp&h&e=csv`) into quotes matched against `specs`. Bad rows are skipped without failing valid rows. */
export function parseStooqCsv(csv: string, specs: readonly InstrumentSpec[]): MarketQuote[] {
  const trimmed = csv.trim();
  if (!trimmed || trimmed.startsWith("<")) return []; // reject HTML error / anti-bot pages

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0]!.split(",").map((c) => c.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iSym = col("symbol");
  const iDate = col("date");
  const iTime = col("time");
  const iOpen = col("open");
  const iClose = col("close");
  const iPrev = col("previous", "prev", "prev close", "previous close");
  if (iSym < 0 || iClose < 0) return [];

  const byStooq = new Map<string, InstrumentSpec>();
  for (const s of specs) {
    if (s.stooqSymbol) byStooq.set(s.stooqSymbol.toLowerCase(), s);
    byStooq.set(s.symbol.toLowerCase(), s);
  }

  const out: MarketQuote[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(",").map((c) => c.trim());
    const sym = cells[iSym]?.toLowerCase();
    if (!sym) continue;
    const spec = byStooq.get(sym);
    if (!spec) continue;

    const last = parseNumCell(cells[iClose]);
    if (last === null) continue;

    const prev = iPrev >= 0 ? parseNumCell(cells[iPrev]) : null;
    const open = iOpen >= 0 ? parseNumCell(cells[iOpen]) : null;
    const ref = prev ?? open;
    const change = ref !== null ? round(last - ref, 6) : null;
    const changePct = change !== null && ref !== null && ref !== 0 ? round((change / ref) * 100, 3) : null;

    let asOf: string | null = null;
    const d = iDate >= 0 ? cells[iDate] : undefined;
    const tm = iTime >= 0 ? cells[iTime] : undefined;
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const iso = tm && /^\d{2}:\d{2}(:\d{2})?$/.test(tm) ? `${d}T${tm.length === 5 ? `${tm}:00` : tm}Z` : `${d}T00:00:00Z`;
      if (!Number.isNaN(Date.parse(iso))) asOf = iso;
    }

    out.push({
      id: spec.id,
      symbol: spec.symbol,
      group: spec.group,
      label: spec.label,
      format: spec.format,
      ...(spec.currency ? { currency: spec.currency } : {}),
      last,
      change,
      changePct,
      asOf,
      series: [],
      source: "stooq",
      delayed: true,
      stale: false,
    });
  }
  return out;
}

export interface MarketsServiceOptions {
  instruments?: readonly InstrumentSpec[];
  ttlMs?: number;
  timeoutMs?: number;
  yahooBase?: string;
  stooqBase?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createMarketsService(opts: MarketsServiceOptions = {}) {
  const instruments = opts.instruments ?? INSTRUMENTS;
  const ttlMs = opts.ttlMs ?? CACHE_TTL_MS;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const yahooBase = (opts.yahooBase ?? process.env.OPENBOOKS_YAHOO_API ?? YAHOO_BASE).replace(/\/+$/, "");
  const stooqBase = opts.stooqBase ?? process.env.OPENBOOKS_STOOQ_API ?? STOOQ_BASE;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());

  const lastGood = new Map<string, MarketQuote>();
  let cached: { at: number; data: MarketsResponse } | null = null;
  let inflight: Promise<MarketsResponse> | null = null;

  async function fetchYahooOne(spec: InstrumentSpec): Promise<MarketQuote | null> {
    const url = `${yahooBase}/${encodeURIComponent(spec.yahooSymbol)}?range=1d&interval=5m`;
    try {
      const res = await fetchImpl(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      return parseYahooChart(spec, body);
    } catch {
      return null;
    }
  }

  async function fetchStooqFallback(missing: readonly InstrumentSpec[]): Promise<Map<string, MarketQuote>> {
    const map = new Map<string, MarketQuote>();
    const withStooq = missing.filter((s) => s.stooqSymbol);
    if (!withStooq.length || !stooqBase) return map;
    const symbols = withStooq.map((s) => s.stooqSymbol!).join("+");
    const sep = stooqBase.includes("?") ? "&" : "?";
    const url = `${stooqBase}${sep}s=${encodeURIComponent(symbols)}&f=sd2t2ohlcvp&h&e=csv`;
    try {
      const res = await fetchImpl(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return map;
      const text = await res.text();
      for (const q of parseStooqCsv(text, withStooq)) map.set(q.id, q);
    } catch {
      /* fallback best-effort */
    }
    return map;
  }

  async function refresh(): Promise<MarketsResponse> {
    const settled = await Promise.allSettled(instruments.map((spec) => fetchYahooOne(spec)));
    const fresh = new Map<string, MarketQuote>();
    const missing: InstrumentSpec[] = [];

    for (let i = 0; i < instruments.length; i++) {
      const spec = instruments[i]!;
      const r = settled[i]!;
      if (r.status === "fulfilled" && r.value) fresh.set(spec.id, r.value);
      else missing.push(spec);
    }

    if (missing.length) {
      const fallback = await fetchStooqFallback(missing);
      for (const [id, q] of fallback) fresh.set(id, q);
    }

    const world: MarketQuote[] = [];
    const il: MarketQuote[] = [];
    const sourceSet = new Set<MarketSource>();
    let freshCount = 0;

    for (const spec of instruments) {
      const got = fresh.get(spec.id);
      let q: MarketQuote | null = null;
      if (got) {
        lastGood.set(spec.id, got);
        q = got;
        freshCount++;
      } else {
        const prev = lastGood.get(spec.id);
        if (prev) {
          q = { ...prev, stale: true };
        }
      }
      if (!q) continue;
      sourceSet.add(q.source);
      if (q.group === "world") world.push(q);
      else il.push(q);
    }

    const all = [...world, ...il];
    const response: MarketsResponse = {
      world,
      il,
      asOf: new Date(now()).toISOString(),
      stale: freshCount === 0,
      delayed: all.some((q) => q.delayed),
      sources: [...sourceSet],
    };

    // Only cache for the full TTL when we got at least one fresh quote; if everything failed, keep stale result briefly (10s) so we retry soon.
    cached = { at: freshCount > 0 ? now() : now() - Math.max(0, ttlMs - 10_000), data: response };
    return response;
  }

  return {
    async get(): Promise<MarketsResponse> {
      if (cached && now() - cached.at < ttlMs) return cached.data;
      if (!inflight) {
        inflight = refresh().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
  };
}
