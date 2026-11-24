// Tests for Israeli Har HaKesef / Mislaka (XLSX & CSV) and generic asset CSV parser.
import { deflateRawSync } from "node:zlib";
import { crc32, xlsx } from "@openbooks/core";
import { describe, expect, test } from "vite-plus/test";
import { inferAssetKind, parseAssetDate, parseAssetImport, readXlsxSheets } from "./assets.ts";

/** Build a deflate-compressed ZIP archive (method 8), like Excel / Har HaKesef produces. */
function zipDeflate(files: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const u16 = (n: number) => [n & 255, (n >>> 8) & 255];
  const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const local: Uint8Array[] = [];
  const central: number[][] = [];
  let at = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const comp = new Uint8Array(deflateRawSync(f.data));
    const common = [
      ...u16(20),
      ...u16(0x0800),
      ...u16(8),
      ...u16(0),
      ...u16(0),
      ...u32(crc32(f.data)),
      ...u32(comp.length),
      ...u32(f.data.length),
      ...u16(name.length),
    ];
    local.push(new Uint8Array([0x50, 0x4b, 3, 4, ...common, ...u16(0)]), name, comp);
    central.push([0x50, 0x4b, 1, 2, ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(at), ...name]);
    at += 30 + name.length + comp.length;
  }
  const dir = new Uint8Array(central.flat());
  const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(dir.length), ...u32(at), 0, 0]);
  const out = new Uint8Array(at + dir.length + end.length);
  let o = 0;
  for (const p of [...local, dir, end]) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("Har HaKesef / Mislaka XLSX parser", () => {
  test("parses Hebrew Har HaKesef XLSX with preamble metadata, product kinds, dates and total row", async () => {
    const bytes = await xlsx([
      {
        name: "הר הכסף",
        rtl: true,
        rows: [
          ["דוח הר הכסף - ריכוז מוצרים פנסיוניים"],
          ["נכון לתאריך: 31/03/2026"],
          [],
          ["סוג מוצר", "שם קופה", "גוף מוסדי", "מספר חשבון", "יתרה צבורה", "נכון לתאריך"],
          ["קרן פנסיה", "מנורה מבטחים פנסיה מקיפה", "מנורה מבטחים", "123456", 245800.5, { v: "2026-03-31", s: { fmt: "date" } }],
          ["קרן השתלמות", "אלטשולר שחם השתלמות כללי", "אלטשולר שחם", "654321", "₪98,420.00", "31/03/2026"],
          ["קופת גמל להשקעה", "מיטב גמל להשקעה S&P 500", "מיטב", "777888", 54100, ""],
          ['סה"כ', "", "", "", 398320.5, ""],
        ],
      },
    ]);

    const res = parseAssetImport({ name: "har-hakesef-2026.xlsx", bytes });
    expect(res.format).toBe("har-hakesef");
    expect(res.reportDate).toBe("2026-03-31");
    expect(res.skipped).toBe(1); // total row skipped
    expect(res.rows).toEqual([
      {
        kind: "pension",
        name: "מנורה מבטחים פנסיה מקיפה",
        provider: "מנורה מבטחים",
        currency: "ILS",
        date: "2026-03-31",
        value: 245800.5,
        accountNumber: "123456",
      },
      {
        kind: "keren-hishtalmut",
        name: "אלטשולר שחם השתלמות כללי",
        provider: "אלטשולר שחם",
        currency: "ILS",
        date: "2026-03-31",
        value: 98420,
        accountNumber: "654321",
      },
      {
        kind: "gemel",
        name: "מיטב גמל להשקעה S&P 500",
        provider: "מיטב",
        currency: "ILS",
        date: "2026-03-31", // fell back to preamble reportDate
        value: 54100,
        accountNumber: "777888",
      },
    ]);
  });

  test("parses deflate-compressed Excel XLSX with sharedStrings.xml and date numFmt styles", () => {
    const enc = new TextEncoder();
    const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="8" uniqueCount="8">
  <si><t>סוג מוצר</t></si>
  <si><t>חברה מנהלת</t></si>
  <si><t>סך צבירה</t></si>
  <si><t>תאריך נכונות</t></si>
  <si><t>ביטוח מנהלים</t></si>
  <si><t>מגדל</t></si>
  <si><r><t>קרן </t></r><r><t>השתלמות</t></r></si>
  <si><t>הפניקס</t></si>
</sst>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
  <cellXfs count="2">
    <xf numFmtId="0"/>
    <xf numFmtId="164"/>
  </cellXfs>
</styleSheet>`;
    // Serial 46082 = 2026-03-01 (days since 1899-12-30)
    const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
    <row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2"><v>310000</v></c><c r="D2" s="1"><v>46082</v></c></row>
    <row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c><c r="C3"><v>62500.25</v></c><c r="D3" s="1"><v>46082</v></c></row>
  </sheetData>
</worksheet>`;
    const bytes = zipDeflate([
      { name: "xl/sharedStrings.xml", data: enc.encode(sharedStrings) },
      { name: "xl/styles.xml", data: enc.encode(styles) },
      { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet1) },
    ]);

    const sheets = readXlsxSheets(bytes);
    expect(sheets).toHaveLength(1);
    const res = parseAssetImport({ name: "mislaka.xlsx", bytes });
    expect(res.format).toBe("har-hakesef");
    expect(res.rows).toEqual([
      { kind: "pension", name: "ביטוח מנהלים — מגדל", provider: "מגדל", currency: "ILS", date: "2026-03-01", value: 310000 },
      { kind: "keren-hishtalmut", name: "קרן השתלמות — הפניקס", provider: "הפניקס", currency: "ILS", date: "2026-03-01", value: 62500.25 },
    ]);
  });
});

describe("Har HaKesef CSV and generic asset CSV parser", () => {
  test("parses Hebrew Mislaka CSV with UTF-8 BOM and quoted NIS amounts", () => {
    const csv = [
      "\ufeffדוח מסלקה פנסיונית",
      'סוג מוצר,שם תוכנית,חברה מנהלת,יתרה בש"ח,תאריך',
      'קרן פנסיה,הראל פנסיה,הראל,"142,350.75 ₪",15.02.2026',
      'פוליסת חיסכון,הכשרה בסט אינווסט,הכשרה,"45,000",02/2026',
      'סה"כ,,,"187,350.75",',
    ].join("\n");

    const res = parseAssetImport({ name: "mislaka.csv", bytes: new TextEncoder().encode(csv) });
    expect(res.format).toBe("har-hakesef");
    expect(res.skipped).toBe(1);
    expect(res.rows).toEqual([
      { kind: "pension", name: "הראל פנסיה", provider: "הראל", currency: "ILS", date: "2026-02-15", value: 142350.75 },
      { kind: "gemel", name: "הכשרה בסט אינווסט", provider: "הכשרה", currency: "ILS", date: "2026-02-28", value: 45000 },
    ]);
  });

  test("parses generic CSV (name, kind, provider, balance, currency, date) across currencies", () => {
    const csv = [
      "name,kind,provider,balance,currency,date",
      "Interactive Brokers IRA,brokerage,IBKR,42500.50,USD,2026-03-10",
      "Migdal Pension,pension,Migdal,180000,ILS,10/03/2026",
      "Cold Storage,crypto,Ledger,$12500,,2026-03-10",
      "Euro Savings,other,Revolut,8200,EUR,2026-03-10",
      "Total,,,243200.50,,",
    ].join("\n");

    const res = parseAssetImport({ name: "assets.csv", bytes: new TextEncoder().encode(csv) }, { defaultCurrency: "ILS" });
    expect(res.format).toBe("csv");
    expect(res.skipped).toBe(1);
    expect(res.rows).toEqual([
      { kind: "brokerage", name: "Interactive Brokers IRA", provider: "IBKR", currency: "USD", date: "2026-03-10", value: 42500.5 },
      { kind: "pension", name: "Migdal Pension", provider: "Migdal", currency: "ILS", date: "2026-03-10", value: 180000 },
      { kind: "crypto", name: "Cold Storage", provider: "Ledger", currency: "USD", date: "2026-03-10", value: 12500 },
      { kind: "other", name: "Euro Savings", provider: "Revolut", currency: "EUR", date: "2026-03-10", value: 8200 },
    ]);
  });

  test("helper edge cases for dates and kinds", () => {
    expect(parseAssetDate("2026-03-04")).toBe("2026-03-04");
    expect(parseAssetDate("04/03/2026")).toBe("2026-03-04");
    expect(parseAssetDate("04.03.26")).toBe("2026-03-04");
    expect(parseAssetDate("02/2024")).toBe("2024-02-29"); // leap year
    expect(parseAssetDate("not a date")).toBeNull();
    expect(inferAssetKind("קרן השתלמות")).toBe("keren-hishtalmut");
    expect(inferAssetKind("brokerage")).toBe("brokerage");
    expect(inferAssetKind("unknown label")).toBe("other");
  });
});
