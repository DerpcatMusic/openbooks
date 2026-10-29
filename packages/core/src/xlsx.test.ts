// The XLSX writer: the output is a real zip whose parts are well-formed XML, with the cells, styles and sheet settings that were asked for.
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { colName, crc32, dateSerial, sheetNames, xlsx, zip, type Sheet } from "./index.ts";

/** Read a zip back: central directory -> local header -> (inflate) -> text. Checks the CRC of every file. */
function unzip(b: Uint8Array): Record<string, string> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = b.length - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  expect(eocd).toBeGreaterThanOrEqual(0);
  const n = v.getUint16(eocd + 10, true);
  let c = v.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    expect(v.getUint32(c, true)).toBe(0x02014b50);
    const method = v.getUint16(c + 10, true),
      crc = v.getUint32(c + 16, true),
      csize = v.getUint32(c + 20, true),
      usize = v.getUint32(c + 24, true),
      nlen = v.getUint16(c + 28, true),
      elen = v.getUint16(c + 30, true),
      clen = v.getUint16(c + 32, true),
      off = v.getUint32(c + 42, true);
    const name = new TextDecoder().decode(b.subarray(c + 46, c + 46 + nlen));
    expect(v.getUint32(off, true)).toBe(0x04034b50);
    const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const raw = b.subarray(start, start + csize);
    const data = method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw;
    expect(data.length).toBe(usize);
    expect(crc32(data)).toBe(crc);
    out[name] = new TextDecoder().decode(data);
    c += 46 + nlen + elen + clen;
  }
  return out;
}
/** Well-formedness: every tag opens and closes in order (enough to catch an unescaped character or a missing close). */
function wellFormed(xml: string) {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?[^>]*\?>/g, "").matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) expect(stack.pop()).toBe(m[2]);
    else stack.push(m[2]!);
  }
  expect(stack).toEqual([]);
  expect(xml.replace(/<[^>]*>/g, "")).not.toMatch(/[<>]/); // no stray angle bracket in text
}

const sheet: Sheet = {
  name: "Profit & Loss",
  widths: [30, 14],
  freeze: { rows: 1, cols: 1 },
  rows: [
    [{ v: "Account", s: { bold: true, fill: true } }, { v: "2026", s: { bold: true, fill: true, align: "right" } }],
    [{ v: "Revenue", s: { bold: true } }, null],
    [{ v: "Sales <web> & \"shop\"", s: { indent: 1 } }, { v: 1234.5, s: { fmt: "money" } }],
    [{ v: "Total revenue", s: { bold: true, border: "top" } }, { v: 1234.5, s: { fmt: "money", bold: true, border: "top" } }],
    [{ v: "Net income", s: { bold: true, border: "total" } }, { v: -80, s: { fmt: "money", bold: true, border: "total" } }],
    [{ v: "2026-03-05", s: { fmt: "date" } }, { v: 0.253, s: { fmt: "pct" } }],
    ["שורה בעברית", 7],
  ],
};

describe("zip", () => {
  it("crc32 of a known string", () => expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926));
  it("stored and deflated archives both read back byte for byte", async () => {
    const files = [
      { name: "a.txt", data: new TextEncoder().encode("hello ".repeat(500)) },
      { name: "dir/שלום.txt", data: new TextEncoder().encode("x") },
    ];
    for (const deflate of [true, false]) {
      const z = await zip(files, { deflate });
      expect(unzip(z)).toEqual({ "a.txt": "hello ".repeat(500), "dir/שלום.txt": "x" });
      if (deflate) expect(z.length).toBeLessThan(500);
    }
  });
});

describe("xlsx", () => {
  it("is a zip with the parts of a workbook, all well-formed XML", async () => {
    const parts = unzip(await xlsx([sheet, { name: "GL", rows: [["a"]] }], { title: "Acme" }));
    expect(Object.keys(parts).sort()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"].sort(),
    );
    for (const [name, xml] of Object.entries(parts)) {
      expect(xml.startsWith("<?xml"), name).toBe(true);
      wellFormed(xml);
    }
    expect(parts["xl/workbook.xml"]).toContain('<sheet name="Profit &amp; Loss" sheetId="1" r:id="rId1"/>');
    expect(parts["[Content_Types].xml"]).toContain("/xl/worksheets/sheet2.xml");
  });
  it("cells: text escaped, numbers raw, dates as serials, the Hebrew intact, empty styled cells kept", async () => {
    const x = unzip(await xlsx([sheet]))["xl/worksheets/sheet1.xml"]!;
    expect(x).toContain('<c r="A3" s="');
    expect(x).toContain("Sales &lt;web&gt; &amp; &quot;shop&quot;");
    expect(x).toMatch(/<c r="B3" s="\d+"><v>1234.5<\/v><\/c>/);
    expect(x).toMatch(/<c r="A6" s="\d+"><v>46086<\/v><\/c>/); // 2026-03-05
    expect(x).toContain("שורה בעברית");
    expect(x).toContain('<c r="B7"><v>7</v></c>');
    expect(x).toContain('<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>');
    expect(x).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
    expect(x).not.toContain("rightToLeft");
    expect(unzip(await xlsx([{ ...sheet, rtl: true }]))["xl/worksheets/sheet1.xml"]).toContain('rightToLeft="1"');
  });
  it("styles: one xf per combination, with the number formats, bold, indent, fill and borders", async () => {
    const s = unzip(await xlsx([sheet]))["xl/styles.xml"]!;
    expect(s).toContain('<numFmt numFmtId="164" formatCode="#,##0.00;[Red]-#,##0.00"/>');
    expect(s).toContain('formatCode="yyyy-mm-dd"');
    const count = +/<cellXfs count="(\d+)"/.exec(s)![1]!;
    expect(s.match(/<xf /g)!.length).toBe(count + 1); // + the cellStyleXfs entry
    expect(s).toContain('<alignment horizontal="left" indent="1"/>');
    expect(s).toContain('fontId="1"');
    expect(s).toContain('fillId="2"');
    expect(s).toContain('<border><left/><right/><top style="thin"><color auto="1"/></top><bottom style="double"><color auto="1"/></bottom><diagonal/></border>');
    // the same style twice is one xf
    const two = unzip(await xlsx([{ name: "x", rows: [[{ v: 1, s: { bold: true } }, { v: 2, s: { bold: true } }]] }]))["xl/styles.xml"]!;
    expect(+/<cellXfs count="(\d+)"/.exec(two)![1]!).toBe(2);
  });
  it("text control characters are dropped; not-a-number cells are left out; tiny negatives are zero", async () => {
    const x = unzip(await xlsx([{ name: "x", rows: [["a\u0001b", Number.NaN, -1e-9, 1]] }]))["xl/worksheets/sheet1.xml"]!;
    expect(x).toContain(">ab<");
    expect(x).not.toContain("NaN");
    expect(x).toContain("<v>0</v>");
    wellFormed(x);
  });
  it("is deterministic", async () => {
    expect(Buffer.from(await xlsx([sheet]))).toEqual(Buffer.from(await xlsx([sheet])));
  });
});

describe("helpers", () => {
  it("column letters and date serials", () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(dateSerial("1900-03-01")).toBe(61);
    expect(dateSerial("2026-01-01")).toBe(46023);
    expect(dateSerial("2026-13-01")).toBeNull();
    expect(dateSerial("nope")).toBeNull();
  });
  it("sheet names: no forbidden characters, at most 31, unique ignoring case, never empty", () => {
    expect(sheetNames(["P&L", "a/b:c", "x".repeat(40), "p&l", "", "'q'"])).toEqual(["P&L", "a b c", "x".repeat(31), "p&l 2", "Sheet5", "q"]);
  });
});
