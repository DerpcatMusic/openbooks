// Money across the books over HTTP: /api/networth (every entity, one currency, one value a day), /api/fx (the cached BoI rates) and
// /api/transfers (an LLC → owner's Israeli account pair, confirmed: both sides filed). The Bank of Israel is a local fake.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { http, type Running, startTs } from "./testing.ts";

type J = Record<string, any>;
let s: Running, boi: Server, home: string;
const asked: string[] = [];
// USD at 3.7 from Mar 2 2026 (a Monday) on; nothing earlier: Feb is "missing"
const CSV = (from: string, to: string) =>
  [
    "SERIES_CODE,FREQ,BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MEASURE,DATA_TYPE,DATA_SOURCE,TIME_COLLECT,CONF_STATUS,PUB_WEBSITE,UNIT_MULT,COMMENTS,TIME_PERIOD,OBS_VALUE,RELEASE_STATUS",
    ...["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]
      .filter((d) => d >= from && d <= to)
      .map((d) => `RER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,,${d},3.7,YP`),
  ].join("\n");

beforeAll(async () => {
  boi = createServer((req, res) => {
    asked.push(req.url!);
    const u = new URL(req.url!, "http://x");
    if (!u.pathname.endsWith("RER_USD_ILS")) return res.writeHead(404).end();
    res.end(CSV(u.searchParams.get("startperiod")!, u.searchParams.get("endperiod")!));
  });
  await new Promise<void>((ok) => boi.listen(0, "127.0.0.1", ok));
  home = mkdtempSync(join(tmpdir(), "openbooks-money-"));
  const ent = (id: string, meta: object, file: string, data: object) => {
    mkdirSync(join(home, id, "inbox"), { recursive: true });
    writeFileSync(join(home, id, "entity.json"), JSON.stringify(meta));
    writeFileSync(join(home, id, "inbox", file), JSON.stringify(data));
  };
  ent("llc", { name: "LLC", kind: "us-llc", currency: "USD" }, "mercury.json", {
    // a 2,000 royalty lands Mar 5, after every net-worth window below (they end Mar 4, when the balance was still 5,000)
    accounts: [{ id: "a", name: "Mercury Checking", currentBalance: 7000 }],
    transactions: [
      { id: "w1", accountId: "a", amount: -1000, postedAt: "2026-03-03T12:00:00Z", status: "sent", counterpartyName: "Owner", kind: "other" },
      { id: "r1", accountId: "a", amount: 2000, postedAt: "2026-03-05T12:00:00Z", status: "sent", counterpartyName: "Distributor", kind: "other" },
    ],
  });
  ent("il", { name: "Osek", kind: "il-osek-zair", currency: "ILS" }, "scraper.json", {
    source: "scraper",
    companyId: "hapoalim",
    name: "Hapoalim",
    accounts: [
      { accountNumber: "1234", txns: [{ date: "2026-03-04T00:00:00", chargedAmount: 3640, description: "Wire in", identifier: "h1", status: "completed" }] },
    ],
  });
  s = await startTs(home, { OPENBOOKS_BOI_API: `http://127.0.0.1:${(boi.address() as { port: number }).port}/EXR` });
}, 30_000);
afterAll(() => {
  s?.stop();
  boi?.close();
  rmSync(home, { recursive: true, force: true });
});

const get = async (p: string) => (await http(s.port, "GET", p)).json() as J;

test("net worth: every entity's accounts, a value a day in one currency, missing rates listed", async () => {
  const r = await get("/api/networth?currency=ILS&from=2026-02-28&to=2026-03-04");
  expect(Object.keys(r)).toEqual(["currency", "dates", "series", "missing"]);
  expect(r.dates).toEqual(["2026-02-28", "2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"]);
  // Mercury's current balance (5000 after the Mar 3 draw) anchors the series: 6000 before it
  expect(r.series).toEqual([
    { entity: "il", account: "Hapoalim ••1234", currency: "ILS", liability: false, values: [0, 0, 0, 0, 3640] },
    { entity: "llc", account: "Mercury Checking", currency: "USD", liability: false, values: [0, 0, 22200, 18500, 18500] },
  ]);
  expect(r.missing).toEqual([
    { currency: "USD", date: "2026-02-28" },
    { currency: "USD", date: "2026-03-01" },
  ]);
  const usd = await get("/api/networth?currency=USD&from=2026-03-04&to=2026-03-04");
  expect(usd.series.map((x: J) => x.values[0])).toEqual([983.78, 5000]); // 3640 / 3.7
  expect((await http(s.port, "GET", "/api/networth?currency=usd")).status).toBe(400);
});

test("fx: the rates come from the cache once fetched", async () => {
  const n = asked.length;
  const r = await get("/api/fx?currencies=USD&from=2026-03-02&to=2026-03-04");
  expect(r.rates.USD["2026-03-03"]).toBe(3.7);
  expect(asked.length).toBe(n); // already cached by the net worth call
});

test("transfers: the LLC's draw pairs with the Israeli deposit across currencies; confirming files both sides", async () => {
  const { suggestions } = await get("/api/transfers?e=il");
  expect(suggestions).toHaveLength(1);
  const m = suggestions[0];
  expect([m.out.entity, m.out.amount, m.in.entity, m.in.amount]).toEqual(["llc", -1000, "il", 3640]); // 3700 at the rate: -1.6%
  const pair = { out: `llc/${m.out.id}`, in: `il/${m.in.id}` };
  expect((await http(s.port, "POST", "/api/transfers?e=il", { ...pair, as: "maybe" })).status).toBe(400);
  expect((await http(s.port, "POST", "/api/transfers?e=il", { ...pair, as: "confirmed" })).status).toBe(200);
  const cat = async (e: string) => (await get(`/api/state?e=${e}`)).txns[0].category;
  expect([await cat("llc"), await cat("il")]).toEqual(["equity:owner", "own:transfer"]);
  expect((await get("/api/transfers?e=il")).suggestions).toEqual([]);
  expect((await get("/api/state?e=llc")).docs.transfers).toEqual({ confirmed: [pair], rejected: [] });
});

test("net_worth tool: the totals on one day, each account in its own currency and converted", async () => {
  const r = (await http(s.port, "POST", "/api/tools/run", { name: "net_worth", args: { currency: "ILS", date: "2026-03-04" }, entity: "il" })).json() as J;
  expect(r.result).toMatchObject({ currency: "ILS", date: "2026-03-04", total: 22140, assets: 22140, liabilities: 0, missing: [] });
  expect(r.result.accounts.find((a: J) => a.entity === "llc")).toEqual({
    entity: "llc",
    account: "Mercury Checking",
    currency: "USD",
    liability: false,
    balance: 5000,
    converted: 18500,
  });
});

test("tax_summary: the LLC's income reaches the Israeli return at the Bank of Israel rate of its day", async () => {
  const llc = (await get("/api/state?e=llc")).txns.find((t: J) => t.amount === 2000);
  expect((await http(s.port, "POST", "/api/category?e=llc", { ids: [llc.id], category: "revenue:music-royalties" })).status).toBe(200);
  const r = (await http(s.port, "POST", "/api/tools/run", { name: "tax_summary", args: { year: 2026 }, entity: "il" })).json() as J;
  // 2,000 USD on Mar 5 at 3.7 = 7,400 ₪ attributed (the owner draw is equity, not an expense); every rate known, so it is on the return
  expect(r.result.crossBorder).toMatchObject({ attributedIncome: 7400, missingRates: 0, onReturn: true });
  expect(r.result.taxable).toBe(r.result.turnover + 7400); // osek zair closed: no 30% on the Israeli turnover either
});
