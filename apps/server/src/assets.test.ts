// End-to-end HTTP tests for asset accounts: CRUD, net-worth inclusion (with BoI FX & missing-rate handling),
// read-only crypto refresh (success + stale fallback), and Har HaKesef XLSX / CSV import.
// Uses local fake HTTP servers only — zero live network calls.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { xlsx } from "@openbooks/core";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { http, type Running, startTs } from "./testing.ts";

type J = Record<string, any>;
const BTC_ADDR = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const ETH_ADDR = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

let s: Running;
let boi: Server;
let cryptoMock: Server;
let home: string;
let failCrypto = false;

const BOI_CSV = (from: string, to: string) =>
  [
    "SERIES_CODE,FREQ,BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MEASURE,DATA_TYPE,DATA_SOURCE,TIME_COLLECT,CONF_STATUS,PUB_WEBSITE,UNIT_MULT,COMMENTS,TIME_PERIOD,OBS_VALUE,RELEASE_STATUS",
    // USD rate exists ONLY from 2026-03-02 onward; 2026-02-28 & 2026-03-01 have no rate
    ...["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]
      .filter((d) => d >= from && d <= to)
      .map((d) => `RER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,,${d},3.7,YP`),
  ].join("\n");

beforeAll(async () => {
  boi = createServer((req, res) => {
    const u = new URL(req.url!, "http://x");
    if (!u.pathname.endsWith("RER_USD_ILS")) return res.writeHead(404).end();
    res.end(BOI_CSV(u.searchParams.get("startperiod")!, u.searchParams.get("endperiod")!));
  });
  await new Promise<void>((ok) => boi.listen(0, "127.0.0.1", ok));

  cryptoMock = createServer((req, res) => {
    if (failCrypto) {
      res.writeHead(503).end("upstream unavailable");
      return;
    }
    const u = new URL(req.url!, "http://x");
    if (u.pathname === `/api/address/${BTC_ADDR}`) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          address: BTC_ADDR,
          chain_stats: { funded_txo_sum: 50_000_000, spent_txo_sum: 0 }, // 0.5 BTC
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      );
      return;
    }
    if (u.pathname === "/eth-rpc") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xde0b6b3a7640000" }), // 1.0 ETH
      );
      return;
    }
    if (u.pathname.includes("BTC-USD")) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 80000 } }] } }));
      return;
    }
    if (u.pathname.includes("ETH-USD")) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 3000 } }] } }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => cryptoMock.listen(0, "127.0.0.1", ok));

  home = mkdtempSync(join(tmpdir(), "openbooks-assets-"));
  mkdirSync(join(home, "il", "inbox"), { recursive: true });
  writeFileSync(join(home, "il", "entity.json"), JSON.stringify({ name: "Osek", kind: "il-osek-zair", currency: "ILS" }));
  writeFileSync(
    join(home, "il", "inbox", "scraper.json"),
    JSON.stringify({
      source: "scraper",
      companyId: "hapoalim",
      name: "Hapoalim",
      accounts: [
        { accountNumber: "1234", txns: [{ date: "2026-03-04T00:00:00", chargedAmount: 10000, description: "Client", identifier: "h1", status: "completed" }] },
      ],
    }),
  );

  const boiPort = (boi.address() as { port: number }).port;
  const mockPort = (cryptoMock.address() as { port: number }).port;
  s = await startTs(home, {
    OPENBOOKS_BOI_API: `http://127.0.0.1:${boiPort}/EXR`,
    OPENBOOKS_MEMPOOL_API: `http://127.0.0.1:${mockPort}`,
    OPENBOOKS_ETH_RPC: `http://127.0.0.1:${mockPort}/eth-rpc`,
    OPENBOOKS_YAHOO_API: `http://127.0.0.1:${mockPort}/yahoo`,
    OPENBOOKS_COINGECKO_API: `http://127.0.0.1:${mockPort}/cg`,
  });
}, 30_000);

afterAll(() => {
  s?.stop();
  boi?.close();
  cryptoMock?.close();
  rmSync(home, { recursive: true, force: true });
});

const get = async (p: string) => (await http(s.port, "GET", p)).json() as J;

test("assets CRUD, net worth inclusion with BoI FX, missing rate never 1:1, and non-liability", async () => {
  // 1. Add an Israeli pension named "Max Pension" (contains "Max", must STILL be liability: false!)
  const add1 = await http(s.port, "POST", "/api/assets?e=il", {
    id: "pen-max",
    kind: "pension",
    name: "Max Pension",
    provider: "Migdal",
    currency: "ILS",
    valuations: [
      { date: "2026-03-01", value: 100000 },
      { date: "2026-03-03", value: 105000 },
    ],
  });
  expect(add1.status).toBe(200);

  // 2. Add a USD brokerage asset starting 2026-02-28 (when USD BoI rate is missing until 2026-03-02)
  const add2 = await http(s.port, "POST", "/api/assets?e=il", {
    id: "brk-ibkr",
    kind: "brokerage",
    name: "IBKR Portfolio",
    provider: "Interactive Brokers",
    currency: "USD",
    valuations: [{ date: "2026-02-28", value: 10000 }],
  });
  expect(add2.status).toBe(200);

  // 3. Reject a private key pasted into a crypto address field
  const badKey = await http(s.port, "POST", "/api/assets?e=il", {
    kind: "crypto",
    name: "Oops",
    currency: "USD",
    chain: "eth",
    address: "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318",
    valuations: [],
  });
  expect(badKey.status).toBe(400);

  // 4. Verify GET /api/assets returns saved entries
  const list = await get("/api/assets?e=il");
  expect(list.assets).toHaveLength(2);

  // 5. Verify /api/networth includes assets as non-liability series, converts via BoI FX, and never uses 1:1 for missing rates
  const nw = await get("/api/networth?currency=ILS&from=2026-02-28&to=2026-03-04");
  const pen = nw.series.find((x: J) => x.account === "Max Pension");
  const brk = nw.series.find((x: J) => x.account === "IBKR Portfolio");
  expect(pen).toEqual({
    entity: "il",
    account: "Max Pension",
    currency: "ILS",
    liability: false,
    values: [0, 100000, 100000, 105000, 105000],
  });
  expect(brk).toEqual({
    entity: "il",
    account: "IBKR Portfolio",
    currency: "USD",
    liability: false,
    // 2026-02-28 & 2026-03-01 missing USD rate -> 0 (NEVER 10000 1:1!); 2026-03-02..04 -> 10000 * 3.7 = 37000
    values: [0, 0, 37000, 37000, 37000],
  });
  expect(nw.missing).toEqual([
    { currency: "USD", date: "2026-02-28" },
    { currency: "USD", date: "2026-03-01" },
  ]);

  // 6. Verify net_worth tool on 2026-03-04 sums bank + ILS pension + converted USD brokerage
  const tool = (await http(s.port, "POST", "/api/tools/run", { name: "net_worth", args: { currency: "ILS", date: "2026-03-04" }, entity: "il" })).json() as J;
  expect(tool.result.total).toBe(10000 + 105000 + 37000);
  expect(tool.result.liabilities).toBe(0);

  // 7. Edit & delete
  const edited = await http(s.port, "POST", "/api/assets?e=il", {
    id: "pen-max",
    kind: "pension",
    name: "Max Pension",
    provider: "Migdal",
    currency: "ILS",
    value: 108000,
    date: "2026-03-04",
  });
  expect(edited.status).toBe(200);
  const penAfterEdit = (edited.json() as J).docs.assets.find((x: J) => x.id === "pen-max");
  expect(penAfterEdit.valuations).toHaveLength(3);

  const del = await http(s.port, "POST", "/api/assets/delete?e=il", { id: "brk-ibkr" });
  expect(del.status).toBe(200);
  expect((await get("/api/assets?e=il")).assets.map((x: J) => x.id)).toEqual(["pen-max"]);
});

test("crypto refresh fetches BTC + ETH balances via public APIs and marks stale on failure without losing valuation", async () => {
  await http(s.port, "POST", "/api/assets?e=il", {
    id: "btc-cold",
    kind: "crypto",
    name: "BTC Cold",
    currency: "USD",
    chain: "btc",
    address: BTC_ADDR,
    valuations: [],
  });
  await http(s.port, "POST", "/api/assets?e=il", {
    id: "eth-cold",
    kind: "crypto",
    name: "ETH Cold",
    currency: "USD",
    chain: "eth",
    address: ETH_ADDR,
    valuations: [],
  });

  failCrypto = false;
  const r1 = await http(s.port, "POST", "/api/assets/refresh?e=il", { force: true });
  expect(r1.status).toBe(200);
  expect(r1.headers["x-openbooks-assets-refreshed"]).toBe("2");
  expect(r1.headers["x-openbooks-assets-failed"]).toBe("0");
  const st1 = r1.json() as J;
  const btc1 = st1.docs.assets.find((x: J) => x.id === "btc-cold");
  const eth1 = st1.docs.assets.find((x: J) => x.id === "eth-cold");
  expect(btc1.stale).toBe(false);
  expect(btc1.valuations.at(-1)).toMatchObject({ value: 40000, quantity: 0.5, unitPrice: 80000 });
  expect(eth1.stale).toBe(false);
  expect(eth1.valuations.at(-1)).toMatchObject({ value: 3000, quantity: 1, unitPrice: 3000 });

  // Upstream outage: force refresh keeps previous valuations and marks stale
  failCrypto = true;
  const r2 = await http(s.port, "POST", "/api/assets/refresh?e=il", { id: "btc-cold", force: true });
  expect(r2.status).toBe(200);
  expect(r2.headers["x-openbooks-assets-failed"]).toBe("1");
  const btc2 = (r2.json() as J).docs.assets.find((x: J) => x.id === "btc-cold");
  expect(btc2.stale).toBe(true);
  expect(btc2.valuations).toEqual(btc1.valuations);
  failCrypto = false;
});

test("POST /api/assets/import imports Har HaKesef XLSX and updates valuations on re-import", async () => {
  const bytes1 = await xlsx([
    {
      name: "הר הכסף",
      rows: [
        ["סוג מוצר", "שם קופה", "גוף מוסדי", "יתרה צבורה", "נכון לתאריך"],
        ["קרן השתלמות", "מור השתלמות", "מור", 65000, "2026-01-31"],
      ],
    },
  ]);
  const res1 = await http(s.port, "POST", "/api/assets/import?e=il&name=har-hakesef.xlsx", bytes1);
  expect(res1.status).toBe(200);
  expect(res1.headers["x-openbooks-assets-added"]).toBe("1");

  // Re-import newer snapshot for the same fund -> updates valuations instead of duplicating
  const bytes2 = await xlsx([
    {
      name: "הר הכסף",
      rows: [
        ["סוג מוצר", "שם קופה", "גוף מוסדי", "יתרה צבורה", "נכון לתאריך"],
        ["קרן השתלמות", "מור השתלמות", "מור", 71200, "2026-03-31"],
      ],
    },
  ]);
  const res2 = await http(s.port, "POST", "/api/assets/import?e=il&name=har-hakesef-2.xlsx", bytes2);
  expect(res2.status).toBe(200);
  expect(res2.headers["x-openbooks-assets-added"]).toBe("0");
  expect(res2.headers["x-openbooks-assets-updated"]).toBe("1");
  const mor = (res2.json() as J).docs.assets.filter((x: J) => x.name === "מור השתלמות");
  expect(mor).toHaveLength(1);
  expect(mor[0].valuations).toEqual([
    { date: "2026-01-31", value: 65000 },
    { date: "2026-03-31", value: 71200 },
  ]);
});
