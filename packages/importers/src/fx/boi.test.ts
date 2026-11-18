import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { fetchBoiRates, parseBoiCsv } from "./boi.ts";

// The shape the live API answers (recorded 2026-11-18), one quoted COMMENTS cell added
const CSV = `SERIES_CODE,FREQ,BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MEASURE,DATA_TYPE,DATA_SOURCE,TIME_COLLECT,CONF_STATUS,PUB_WEBSITE,UNIT_MULT,COMMENTS,TIME_PERIOD,OBS_VALUE,RELEASE_STATUS
RER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,,2025-01-02,3.65,YP
RER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,"a, b",2025-01-03,3.656,YP
`;
const JPY = `SERIES_CODE,FREQ,BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MEASURE,DATA_TYPE,DATA_SOURCE,TIME_COLLECT,CONF_STATUS,PUB_WEBSITE,UNIT_MULT,COMMENTS,TIME_PERIOD,OBS_VALUE,RELEASE_STATUS
RER_JPY_ILS,D,JPY,ILS,ILS,OF00,BOI_MRKT,V,F,Y,2,,2025-01-02,2.3232,YP
`;

let srv: Server;
const asked: string[] = [];
beforeAll(async () => {
  srv = createServer((req, res) => {
    asked.push(req.url!);
    if (req.url!.includes("RER_USD_ILS")) res.end(CSV);
    else if (req.url!.includes("RER_JPY_ILS")) res.end(JPY);
    else res.writeHead(404).end("NoResultsFound");
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  process.env.OPENBOOKS_BOI_API = `http://127.0.0.1:${(srv.address() as { port: number }).port}/EXR`;
});
afterAll(() => {
  delete process.env.OPENBOOKS_BOI_API;
  srv?.close();
});

test("parses the CSV: date → ILS per unit, per-100 quotes divided", () => {
  expect(parseBoiCsv(CSV)).toEqual({ "2025-01-02": 3.65, "2025-01-03": 3.656 });
  expect(parseBoiCsv(JPY)).toEqual({ "2025-01-02": 0.023232 });
  expect(parseBoiCsv("")).toEqual({});
});

test("fetches one series for the range; an unknown currency is empty, ILS needs no request", async () => {
  expect(await fetchBoiRates("USD", "2025-01-01", "2025-01-10")).toEqual({ "2025-01-02": 3.65, "2025-01-03": 3.656 });
  expect(asked.at(-1)).toBe("/EXR/RER_USD_ILS?startperiod=2025-01-01&endperiod=2025-01-10&format=csv");
  expect(await fetchBoiRates("XYZ", "2025-01-01", "2025-01-10")).toEqual({});
  const n = asked.length;
  expect(await fetchBoiRates("ILS", "2025-01-01", "2025-01-10")).toEqual({});
  expect(asked.length).toBe(n);
});

test("offline throws (the caller falls back to its cache)", async () => {
  process.env.OPENBOOKS_BOI_API = "http://127.0.0.1:9/EXR";
  await expect(fetchBoiRates("USD", "2025-01-01", "2025-01-02", 2000)).rejects.toThrow();
  process.env.OPENBOOKS_BOI_API = `http://127.0.0.1:${(srv.address() as { port: number }).port}/EXR`;
});
