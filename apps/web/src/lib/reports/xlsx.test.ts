import { inflateRawSync } from "node:zlib";
import { expect, test } from "vite-plus/test";
import { agingReport, xlsx, type Cell } from "@openbooks/core";
import { agingSheet, ledgerSheet, statementSheet, titleRows } from "./xlsx.ts";
import { cfIndirect, plStatement, type Line } from "./statements.ts";

const t = (k: string) => k;
/** Cells of a sheet part as { ref: value } (inline strings and numbers), from the real bytes. */
async function cells(sheet: Parameters<typeof xlsx>[0][number], i = 1) {
  const b = await xlsx([sheet]);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let c = v.getUint32(b.length - 22 + 16, true);
  for (let k = 0; k < v.getUint16(b.length - 22 + 10, true); k++) {
    const nlen = v.getUint16(c + 28, true),
      name = new TextDecoder().decode(b.subarray(c + 46, c + 46 + nlen)),
      off = v.getUint32(c + 42, true),
      csize = v.getUint32(c + 20, true),
      data = b.subarray(off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true), off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true) + csize);
    if (name === `xl/worksheets/sheet${i}.xml`) {
      const xml = new TextDecoder().decode(v.getUint16(c + 10, true) === 8 ? inflateRawSync(data) : data);
      return Object.fromEntries([...xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)<\/c>)/g)].map((m) => [m[1]!, m[2] !== undefined ? +m[2] : (m[3] ?? "")]));
    }
    c += 46 + nlen + v.getUint16(c + 30, true) + v.getUint16(c + 32, true);
  }
  throw new Error("no sheet");
}

test("a P&L as a sheet: header, banded section heads, indented lines, a line above subtotals, numbers as numbers", async () => {
  const rows = [
    { date: "2026-01-05", amount: 1000.456, category: "revenue:sales" },
    { date: "2026-01-09", amount: -200, category: "expense:software" },
  ];
  const lines = plStatement([rows], true, t, (k) => k);
  const sheet = statementSheet("P&L", titleRows("Acme", "Profit and loss", "2026 · cash basis"), "Ledger account", ["2026"], lines);
  const c = await cells(sheet);
  expect(c.A1).toBe("Acme — Profit and loss");
  expect(c.A4).toBe("Ledger account");
  expect(c.B4).toBe("2026");
  const at = (label: string) => Object.entries(c).find(([, v]) => v === label)![0].slice(1);
  expect(c[`B${at("revenue:sales")}`]).toBe(1000.46); // cents, not floating-point noise
  expect(c[`B${at("reports.netIncome")}`]).toBe(800.46);
  expect(sheet.freeze).toEqual({ rows: 4, cols: 1 });
});

test("cash flow lines and the ledger / aging sheets keep their dates and numbers", async () => {
  const cf: Line[] = cfIndirect([[{ date: "2026-01-02", amount: 100, category: "revenue:sales" }]], t, (k) => k);
  expect((await cells(statementSheet("CF", [], "Activity", ["Total"], cf))).B1).toBe("Total");
  const gl = ledgerSheet(
    "GL",
    [],
    [{ label: "Sales", value: 100, rows: [{ tx: { date: "2026-01-02", desc: "Stripe", account: "Checking", amount: 100 }, run: 100 }] }],
    { date: "Date", description: "Description", account: "Account", ledger: "Ledger", amount: "Amount", balance: "Balance" },
  );
  const c = await cells(gl);
  expect(c.A3).toBe(46024); // 2026-01-02 as a date serial
  expect(c.B3).toBe("Stripe");
  expect(c.E2).toBe(100); // the group total sits on its band
  const r = agingReport([{ id: "a", party: "p", name: "Client", ref: "1", date: "2026-01-01", due: "2026-01-31", gross: 300, payments: [{ amount: 100, date: "2026-02-01" }] }], "2026-03-01");
  const ag = await cells(agingSheet("AR", [], r, "party", t, (i) => `b${i}`, { party: "Customer", ref: "Invoice", none: "None" }));
  expect(ag.A1).toBe("Customer");
  expect(Object.values(ag)).toContain("Client");
  expect(Object.values(ag)).toContain(200);
  const src = await cells(agingSheet("AR", [], r, "source", t, (i) => `b${i}`, { party: "Customer", ref: "Invoice", none: "None" }));
  expect(src.C2).toBe(46023); // issue date, a real date
});

test("title rows are plain cells", () => {
  const rows: Cell[][] = titleRows("Acme", "GL", "x");
  expect(rows).toHaveLength(3);
});
