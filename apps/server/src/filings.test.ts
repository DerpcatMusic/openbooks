// filing_calendar, vat_report and export_uniform_file over an Israeli osek murshe's real docs, through /api/tools/run (the registry MCP and the AI use).
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { http, type Running, startTs, testBooks } from "./testing.ts";

type J = Record<string, any>;
let s: Running, clean: () => void, home: string;
beforeAll(async () => {
  [home, clean] = testBooks();
  s = await startTs(home);
  const post = (path: string, body: unknown) => http(s.port, "POST", path, body);
  await post("/api/meta?e=zz-il", { types: { "2025": "osek-murshe", "2026": "osek-murshe" } });
  await post("/api/doc?e=zz-il", { name: "customers", value: [{ id: "c1", name: "Client Ltd", vatId: "123456782" }] });
  await post("/api/doc?e=zz-il", {
    name: "invoices",
    value: [
      { id: "i1", kind: "tax", number: "0001", customer: "c1", items: [{ desc: "work", qty: 1, price: 8000 }], vat: 0.18, issued: "2026-04-01", due: "2026-05-01", status: "open", paidTxn: null, paidDate: null, ref: null },
      { id: "i2", kind: "tax", number: "0002", customer: "c1", items: [{ desc: "work", qty: 1, price: 1000 }], vat: 0.18, issued: "2026-05-02", due: null, status: "open", paidTxn: null, paidDate: null, ref: null },
      { id: "i3", kind: "tax", number: null, customer: "c1", items: [{ desc: "draft", qty: 1, price: 999 }], vat: 0.18, issued: "2026-04-03", due: null, status: "draft", paidTxn: null, paidDate: null, ref: null },
    ],
  });
  await post("/api/doc?e=zz-il", { name: "filings", value: { done: { "il.vat.2026-03": { on: "2026-04-18", confirmation: "ABC123" } }, settings: { il: { vatId: "514290543", vatFrequency: "monthly" } } } });
}, 30_000);
afterAll(() => {
  s?.stop();
  clean?.();
});
const run = async (name: string, args: J = {}) => {
  const r = await http(s.port, "POST", "/api/tools/run", { name, entity: "zz-il", args });
  expect(r.status).toBe(200);
  const j = r.json() as J;
  expect(j.error, `${name}: ${j.error}`).toBeUndefined();
  return j.result as J;
};

test("filing_calendar: the year's deadlines with status and the user's done marks", async () => {
  const r = await run("filing_calendar", { year: 2026 });
  expect(r).toMatchObject({ country: "il", businessType: "osek-murshe", year: 2026 });
  const by = Object.fromEntries((r.rows as J[]).map((x) => [x.id, x]));
  expect(by["il.vat.2026-03"]).toMatchObject({ status: "done", doneOn: "2026-04-18", confirmation: "ABC123", date: "2026-04-15" });
  expect(by["il.1301.2025"]).toMatchObject({ form: "1301" });
  expect(by["il.vat.2026-04"].date).toBe("2026-05-15");
  expect(by["il.vat.2025-12"].date.startsWith("2026-01")).toBe(true); // a 2025 period, due in January 2026: listed in the calendar year it is due
  expect(by["il.vat.2026-12"]).toBeUndefined(); // due January 2027
  expect(r.counts.done).toBe(1);
  expect([...r.rows].map((x: J) => x.date)).toEqual([...r.rows].map((x: J) => x.date).sort());
  const up = await run("filing_calendar", { year: 2026, upcomingOnly: true });
  expect((up.rows as J[]).some((x) => x.status === "done")).toBe(false);
});

test("vat_report: output VAT from issued tax invoices in the period, drafts and other months left out", async () => {
  const r = await run("vat_report", { period: "2026-04", lines: true });
  expect(r.period).toEqual({ from: "2026-04-01", to: "2026-04-30", months: 1 });
  expect(r.totals).toMatchObject({ taxableSales: 8000, outputVat: 1440, zeroExempt: 0, salesRecords: 1, otherInputsVat: 0, equipmentVat: 0, payable: 1440 });
  expect(r.due.statutory).toBe("2026-05-15");
  expect(r.lines).toEqual([expect.objectContaining({ type: "S", vat: 1440, net: 8000 })]);
  const may = await run("vat_report", { period: "2026-05" });
  expect(may.totals.outputVat).toBe(180);
  const two = await run("vat_report", { period: "2026-04", frequency: "bimonthly" });
  expect(two.period).toEqual({ from: "2026-03-01", to: "2026-04-30", months: 2 }); // March-April is the two-month period
});

test("vat_report refuses books that are not VAT registered", async () => {
  await http(s.port, "POST", "/api/meta?e=zz-il", { types: { "2025": "osek-patur", "2026": "osek-patur" } });
  const r = await http(s.port, "POST", "/api/tools/run", { name: "vat_report", entity: "zz-il", args: { period: "2026-04" } });
  expect((r.json() as J).error).toContain("not VAT-registered");
  await http(s.port, "POST", "/api/meta?e=zz-il", { types: { "2025": "osek-murshe", "2026": "osek-murshe" } });
});

test("export_uniform_file writes the zip with INI.TXT and BKMVDATA.TXT", async () => {
  const r = await run("export_uniform_file", { from: "2026-01-01", to: "2026-12-31" });
  expect(r.registered).toBe(false);
  expect(r.counts).toMatchObject({ A100: 1, C100: 2, Z900: 1 });
  expect(existsSync(r.path)).toBe(true);
  const z = readFileSync(r.path);
  expect(z.subarray(0, 4).toString("hex")).toBe("504b0304");
  expect(z.includes(Buffer.from("BKMVDATA.TXT"))).toBe(true);
  expect(z.includes(Buffer.from("&OF1.31&"))).toBe(true);
});
