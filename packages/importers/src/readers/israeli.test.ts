// Israeli readers vs books.py on synthetic statements. Expected outputs come from books.py itself (fixtures/dump.py → python.json).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { uidAmount } from "../uid.ts";
import { bitCsv, pyCsv } from "./bit.ts";
import { onezeroJson, onezeroPdf, pdftotext, pyFloat } from "./onezero.ts";
import { localDay, scraperJson } from "./scraper.ts";

const FX = join(import.meta.dirname, "fixtures");
const raw = (n: string) => readFileSync(join(FX, n));
const file = (n: string, as = n) => ({ name: as, bytes: new Uint8Array(raw(n)) });
const py = JSON.parse(raw("python.json").toString()) as Record<string, { rows: unknown[]; checks: unknown[]; uidAmounts: string[] }>;
const ctx = (meta: object = {}) => ({ meta: { name: "t", ...meta }, profile: {}, siblingPdfPeriods: () => [["2025-03-01", "2025-03-31"] as [string, string]] });
const same = (name: string, out: { rows: { amount: number }[]; checks: unknown[] }) => {
  expect(out.rows).toEqual(py[name]!.rows);
  expect(out.checks).toEqual(py[name]!.checks);
  expect(out.rows.map((r) => uidAmount(r as never))).toEqual(py[name]!.uidAmounts);
};

describe("One Zero", () => {
  it("parses pdftotext output like books.py (bidi marks, wrapped descriptions, \\f pages, zero rows skipped)", () => {
    const out = onezeroPdf({ ...file("onezero.txt", "a.pdf"), text: raw("onezero.txt").toString() });
    same("pdf", out);
    expect(out.rows.map((r) => [r.page, r.desc])).toEqual([
      [1, "ישראל ישראלי העברה מ"],
      [2, 'בע"מ x תשלום מלקוח'],
      [2, 'חיוב - בע"מ x'],
    ]);
    same("pdf-first", onezeroPdf({ ...file("onezero-first.txt", "first.pdf"), text: raw("onezero-first.txt").toString() })); // lines[-1]
  });
  it("fails without the credits total", () => {
    expect(() => onezeroPdf({ name: "x.pdf", bytes: new Uint8Array(), text: "01/03/2025 - 31/03/2025\n" })).toThrow();
  });
  it("sync JSON: after the last PDF, credits only unless import=all; integer literals hash as ints", () => {
    same("sync", onezeroJson(file("onezero-sync.json"), ctx()));
    same("sync-all", onezeroJson(file("onezero-sync.json"), ctx({ import: "all" })));
    expect(py["sync"]!.uidAmounts.slice(0, 2)).toEqual(["300", "300.0"]);
  });
  it.skipIf(spawnSync("pdftotext", ["-v"]).error !== undefined)("runs pdftotext -layout on the bytes", () => {
    const pdf = minimalPdf("Hello One Zero"),
      dir = mkdtempSync(join(tmpdir(), "ob-oz-"));
    try {
      writeFileSync(join(dir, "a.pdf"), pdf);
      const byPath = spawnSync("pdftotext", ["-layout", join(dir, "a.pdf"), "-"]).stdout.toString();
      expect(pdftotext(pdf)).toBe(byPath);
      expect(byPath).toContain("Hello One Zero");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("israeli-bank-scrapers", () => {
  it("reads banks and cards like books.py (pending skipped, twin rows, installments, foreign currency memo)", () => {
    const hap = scraperJson(file("hapoalim-sync.json"));
    same("hapoalim", hap);
    expect(hap.rows.slice(0, 3).map((r) => r.date)).toEqual(["2025-03-02", "2025-03-06", "2025-03-06"]);
    expect(new Set(hap.rows.map((r) => r.key)).size).toBe(hap.rows.length);
    const max = scraperJson(file("max-sync.json"));
    same("max", max);
    expect(max.rows[0]!.memo).toBe("-12.5 USD");
    expect(max.rows[1]!.memo).toBe("installment 2/6");
  });
  it("reads decoded text when read() passes it", () => {
    same("max", scraperJson({ ...file("max-sync.json"), text: raw("max-sync.json").toString() }));
  });
  it("_local_day: the Israeli calendar day, Python's fromisoformat fallbacks", () => {
    const days = JSON.parse(raw("days.json").toString()) as string[];
    expect(days.map(localDay)).toEqual(JSON.parse(raw("days-python.json").toString()));
    expect(localDay("2025-07-01T21:00:00Z")).toBe("2025-07-02"); // IDT
    expect(localDay("2025-01-01T21:59:00Z")).toBe("2025-01-01"); // IST
    expect(localDay(null)).toBe("None");
  });
});

describe("bit", () => {
  it("reads credits from others like books.py", () => {
    same("bit", bitCsv(file("bit.csv"), { profile: { bitName: "Me Myself" } }));
    same("bit-noowner", bitCsv(file("bit.csv"), { profile: {} }));
  });
  it("rejects files with no bit rows or bad UTF-8", () => {
    expect(() => bitCsv({ name: "x.csv", bytes: new TextEncoder().encode("a,b\n") }, { profile: {} })).toThrow("not a bit export");
    expect(() => bitCsv({ name: "x.csv", bytes: new Uint8Array([0xff, 0xfe]) }, { profile: {} })).toThrow();
  });
  it("csv.reader semantics", () => {
    expect(pyCsv('a,"b,c"\r\n\n"x""y",z"q\r"open\nline')).toEqual([["a", "b,c"], [], ['x"y', 'z"q'], ["open\nline"]]);
    expect(pyCsv('"ab"c,\n')).toEqual([["abc", ""]]);
  });
  it("float() semantics", () => {
    expect(pyFloat(" 1_000.5 ")).toBe(1000.5);
    expect(pyFloat("-.5e1")).toBe(-5);
    for (const bad of ["", "0x10", "1,0", "abc", "1__0"]) expect(() => pyFloat(bad)).toThrow();
  });
});

/** A one-page PDF with one ASCII line (Helvetica), xref offsets computed. */
function minimalPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 20 50 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
