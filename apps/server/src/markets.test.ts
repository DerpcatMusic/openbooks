// Unit tests for live markets quote parsers (Yahoo Finance chart JSON + Stooq CSV), partial failure isolation, caching, and stale fallback.
// Uses recorded sample payloads only — never touches the live network.
import { describe, expect, test } from "vite-plus/test";
import { createMarketsService, downsample, INSTRUMENTS, parseStooqCsv, parseYahooChart, type InstrumentSpec } from "./markets.ts";

const SPEC_SPX = INSTRUMENTS.find((s) => s.id === "sp500")!;
const SPEC_USDILS = INSTRUMENTS.find((s) => s.id === "usdils")!;
const SPEC_TEVA = INSTRUMENTS.find((s) => s.id === "teva")!;
const SPEC_TA35 = INSTRUMENTS.find((s) => s.id === "ta35")!;
const SPEC_US10Y = INSTRUMENTS.find((s) => s.id === "us10y")!;

// Recorded sample payloads modeled on live Yahoo Finance v8 chart responses.
const SAMPLE_YAHOO_SPX = {
  chart: {
    result: [
      {
        meta: {
          currency: "USD",
          symbol: "^GSPC",
          exchangeName: "SNP",
          regularMarketTime: 1795545954,
          regularMarketPrice: 7199.05,
          regularMarketChangePercent: -0.527,
          fulldayChange: -38.12,
          chartPreviousClose: 7237.17,
        },
        indicators: {
          quote: [{ close: [7210.5, null, 7205.2, 7195.8, 7199.05] }],
        },
      },
    ],
    error: null,
  },
};

const SAMPLE_YAHOO_USDILS = {
  chart: {
    result: [
      {
        meta: {
          currency: "ILS",
          symbol: "ILS=X",
          exchangeName: "CCY",
          regularMarketTime: 1795545911,
          regularMarketPrice: 3.3414,
          chartPreviousClose: 3.3029,
        },
        indicators: {
          quote: [{ close: [3.305, 3.32, 3.335, 3.3414] }],
        },
      },
    ],
    error: null,
  },
};

const SAMPLE_YAHOO_TEVA_ILA = {
  chart: {
    result: [
      {
        meta: {
          currency: "ILA",
          symbol: "TEVA.TA",
          exchangeName: "TLV",
          regularMarketTime: 1795534081,
          regularMarketPrice: 13490,
          fulldayChange: 220,
          regularMarketChangePercent: 1.658,
          chartPreviousClose: 13270,
        },
        indicators: {
          quote: [{ close: [13270, 13380, 13490] }],
        },
      },
    ],
  },
};

const SAMPLE_STOOQ_CSV = [
  "Symbol,Date,Time,Open,High,Low,Close,Volume,Previous",
  "^SPX,2026-11-24,18:45:00,7210.00,7223.95,7138.93,7199.05,1682410000,7237.17",
  "^TA35,N/D,N/D,N/D,N/D,N/D,N/D,N/D,N/D",
  "BROKEN_ROW_WITHOUT_ENOUGH_COLS",
  "USDILS,2026-11-24,18:45:00,3.3050,3.3565,3.2896,3.3414,0,3.3029",
  "10USY.B,2026-11-24,18:30:00,4.918,4.930,4.890,4.906,0,4.918",
].join("\n");

describe("parseYahooChart", () => {
  test("parses index quote with sparkline and change metadata", () => {
    const q = parseYahooChart(SPEC_SPX, SAMPLE_YAHOO_SPX);
    expect(q).not.toBeNull();
    expect(q).toMatchObject({
      id: "sp500",
      symbol: "^GSPC",
      group: "world",
      format: "index",
      currency: "USD",
      last: 7199.05,
      change: -38.12,
      changePct: -0.527,
      source: "yahoo",
      delayed: true,
      stale: false,
    });
    expect(q!.asOf).toBe(new Date(1795545954 * 1000).toISOString());
    expect(q!.series).toEqual([7210.5, 7205.2, 7195.8, 7199.05]);
  });

  test("derives change and changePct from chartPreviousClose and marks FX non-delayed", () => {
    const q = parseYahooChart(SPEC_USDILS, SAMPLE_YAHOO_USDILS);
    expect(q).not.toBeNull();
    expect(q!.last).toBe(3.3414);
    expect(q!.change).toBeCloseTo(0.0385, 4);
    expect(q!.changePct).toBeCloseTo(1.166, 2);
    expect(q!.delayed).toBe(false);
    expect(q!.series).toEqual([3.305, 3.32, 3.335, 3.3414]);
  });

  test("normalizes Tel Aviv ILA (agorot) quotes to ILS", () => {
    const q = parseYahooChart(SPEC_TEVA, SAMPLE_YAHOO_TEVA_ILA);
    expect(q).not.toBeNull();
    expect(q!.currency).toBe("ILS");
    expect(q!.last).toBe(134.9);
    expect(q!.change).toBe(2.2);
    expect(q!.changePct).toBe(1.658);
    expect(q!.series).toEqual([132.7, 133.8, 134.9]);
  });

  test("returns null for malformed or error payloads", () => {
    expect(parseYahooChart(SPEC_SPX, null)).toBeNull();
    expect(parseYahooChart(SPEC_SPX, { chart: { result: null, error: { code: "Not Found" } } })).toBeNull();
    expect(parseYahooChart(SPEC_SPX, { chart: { result: [{ meta: {} }] } })).toBeNull();
  });

  test("downsamples long sparklines while keeping endpoints", () => {
    const pts = Array.from({ length: 120 }, (_, i) => i * 1.5);
    const out = downsample(pts, 20);
    expect(out.length).toBe(20);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(119 * 1.5);
  });
});

describe("parseStooqCsv", () => {
  test("parses valid rows and skips N/D or malformed rows without breaking others", () => {
    const quotes = parseStooqCsv(SAMPLE_STOOQ_CSV, [SPEC_SPX, SPEC_TA35, SPEC_USDILS, SPEC_US10Y]);
    expect(quotes.map((q) => q.id)).toEqual(["sp500", "usdils", "us10y"]);
    const spx = quotes[0]!;
    expect(spx.last).toBe(7199.05);
    expect(spx.change).toBeCloseTo(-38.12, 2);
    expect(spx.changePct).toBeCloseTo(-0.527, 2);
    expect(spx.asOf).toBe("2026-11-24T18:45:00Z");
    expect(spx.source).toBe("stooq");
    expect(spx.delayed).toBe(true);
    expect(spx.series).toEqual([]);
  });

  test("ignores HTML error/challenge pages cleanly", () => {
    expect(parseStooqCsv("<!DOCTYPE html><html><body>challenge</body></html>", INSTRUMENTS)).toEqual([]);
  });
});

describe("createMarketsService", () => {
  const subset: readonly InstrumentSpec[] = [SPEC_SPX, SPEC_USDILS, SPEC_TEVA];

  test("falls back to Stooq for one failed Yahoo symbol without failing others, and strips user data", async () => {
    const seenUrls: string[] = [];
    const seenHeaders: Record<string, string>[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seenUrls.push(url);
      const h = new Headers(init?.headers);
      seenHeaders.push(Object.fromEntries(h.entries()));
      if (url.includes("%5EGSPC")) return new Response(JSON.stringify(SAMPLE_YAHOO_SPX), { status: 200 });
      if (url.includes("ILS%3DX")) return new Response("upstream error", { status: 503 });
      if (url.includes("TEVA.TA")) return new Response(JSON.stringify(SAMPLE_YAHOO_TEVA_ILA), { status: 200 });
      if (url.startsWith("http://stooq.test")) return new Response(SAMPLE_STOOQ_CSV, { status: 200 });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const svc = createMarketsService({
      instruments: subset,
      yahooBase: "http://yahoo.test/v8/finance/chart",
      stooqBase: "http://stooq.test/q/l/",
      fetchImpl: fakeFetch,
      now: () => 1_795_546_000_000,
    });

    const res = await svc.get();
    expect(res.stale).toBe(false);
    expect(res.world.map((q) => [q.id, q.source])).toEqual([["sp500", "yahoo"]]);
    expect(res.il.map((q) => [q.id, q.source])).toEqual([
      ["usdils", "stooq"],
      ["teva", "yahoo"],
    ]);
    expect(res.sources.sort()).toEqual(["stooq", "yahoo"]);
    // Privacy: no cookies or authorization headers in outbound requests
    for (const h of seenHeaders) {
      expect(h.cookie).toBeUndefined();
      expect(h.authorization).toBeUndefined();
    }
    expect(seenUrls.some((u) => u.startsWith("http://stooq.test"))).toBe(true);
  });

  test("caches for 60s and returns stale fallback when upstream fails later", async () => {
    let clock = 1_795_546_000_000;
    let mode: "ok" | "partial-fail" | "all-fail" = "ok";
    let calls = 0;

    const fakeFetch = (async (input: string | URL | Request) => {
      calls++;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (mode === "all-fail") throw new Error("network down");
      if (url.includes("%5EGSPC")) return new Response(JSON.stringify(SAMPLE_YAHOO_SPX), { status: 200 });
      if (url.includes("ILS%3DX")) {
        if (mode === "partial-fail") return new Response("err", { status: 500 });
        return new Response(JSON.stringify(SAMPLE_YAHOO_USDILS), { status: 200 });
      }
      if (url.includes("TEVA.TA")) return new Response(JSON.stringify(SAMPLE_YAHOO_TEVA_ILA), { status: 200 });
      return new Response("404", { status: 404 });
    }) as typeof fetch;

    const svc = createMarketsService({
      instruments: subset,
      ttlMs: 60_000,
      yahooBase: "http://yahoo.test/v8/finance/chart",
      stooqBase: "",
      fetchImpl: fakeFetch,
      now: () => clock,
    });

    const first = await svc.get();
    expect(first.stale).toBe(false);
    expect(first.world).toHaveLength(1);
    expect(first.il).toHaveLength(2);
    expect(calls).toBe(3);

    // Within 60s TTL: served from memory cache without re-fetching
    clock += 30_000;
    const second = await svc.get();
    expect(second).toBe(first);
    expect(calls).toBe(3);

    // After 60s TTL with one failing symbol: failed symbol falls back to last good flagged stale, others stay fresh
    clock += 35_000;
    mode = "partial-fail";
    const partial = await svc.get();
    expect(partial.stale).toBe(false);
    expect(partial.il.find((q) => q.id === "usdils")?.stale).toBe(true);
    expect(partial.il.find((q) => q.id === "usdils")?.last).toBe(3.3414);
    expect(partial.il.find((q) => q.id === "teva")?.stale).toBe(false);

    // After another 60s TTL with total upstream outage: all last good quotes returned flagged stale
    clock += 65_000;
    mode = "all-fail";
    const outage = await svc.get();
    expect(outage.stale).toBe(true);
    expect(outage.world[0]?.stale).toBe(true);
    expect(outage.world[0]?.last).toBe(7199.05);
    expect(outage.il.every((q) => q.stale)).toBe(true);
  });
});
