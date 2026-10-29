import { describe, expect, it } from "vite-plus/test";
import layout from "../form/openfrmt-1.31.json";
import { iso88598, readRecord, record, uniformFiles, uniformZip, type UniformInput } from "./openfrmt.ts";

const inp: UniformInput = {
  business: { vatId: "514290543", name: 'דוגמה בע"מ', street: "הרצל", houseNo: "5", city: "תל אביב", zip: "6100000", companyId: "514290543" },
  taxYear: 2026,
  from: "2026-01-01",
  to: "2026-12-31",
  generated: { date: "2026-10-29", time: "14:32" },
  primaryId: "123456789012345",
  currency: "ILS",
  docs: [
    {
      id: "i1",
      type: 305,
      number: "0001",
      date: "2026-01-05",
      customerName: "Acme",
      customerVatId: "123456782",
      lines: [{ desc: "Consulting", qty: 2, price: 5000 }],
      vat: 0.18,
    },
    {
      id: "i2",
      type: 400,
      number: "0001",
      date: "2026-01-20",
      customerName: "Acme",
      customerVatId: "123456782",
      lines: [{ desc: "Consulting", qty: 2, price: 5000 }],
      vat: 0.18,
      method: "transfer",
      base: { type: 305, number: "0001" },
    },
  ],
  rows: [
    { id: "t1", date: "2026-01-20", amount: 11800, desc: "Acme transfer", account: "bank:leumi", category: "business:sales" },
    { id: "t2", date: "2026-01-22", amount: -59, desc: "Cursor", account: "bank:leumi", category: "expense:software" },
    { id: "je1-0", date: "2026-01-31", amount: -100, desc: "Accrual", account: "Journal", category: "expense:rent" },
    { id: "je1-1", date: "2026-01-31", amount: 100, desc: "Accrual", account: "Journal", category: "liability:payable" },
  ],
};

describe("uniform structure", () => {
  const f = uniformFiles(inp);
  const lines = f.data.split("\r\n").slice(0, -1);
  it("builds every record at its layout length", () => {
    for (const l of lines) expect(l.length).toBe((layout.records as any)[l.slice(0, 4)].length);
    expect(readRecord("A100", lines[0]!)).toMatchObject({ 1100: "A100", 1101: "000000001", 1102: "514290543", 1103: "123456789012345", 1104: "&OF1.31&" });
    expect(lines.at(-1)!.slice(0, 4)).toBe("Z900");
  });
  it("numbers records in order and counts them in INI and Z900", () => {
    lines.forEach((l, i) => expect(+l.slice(4, 13)).toBe(i + 1));
    const z = readRecord("Z900", lines.at(-1)!);
    expect(+z[1155]!).toBe(lines.length);
    const ini = f.ini.split("\r\n").slice(0, -1);
    const a = readRecord("A000", ini[0]!);
    expect(+a[1002]!).toBe(lines.length);
    expect(a[1003]).toBe("000000000".slice(0, 0) + "514290543");
    expect(a[1004]).toBe("123456789012345");
    expect(a[1023]).toBe("2026");
    expect(a[1024]).toBe("20260101");
    expect(a[1032]).toBe("ILS");
    const counts = Object.fromEntries(ini.slice(1).map((l) => [l.slice(0, 4), +l.slice(4)]));
    expect(counts).toEqual({ A100: 1, B100: 6, B110: 5, C100: 2, D110: 2, D120: 1, Z900: 1 });
    expect(f.counts.B100).toBe(6);
  });
  it("golden lines", () => {
    // A100: code, record no, VAT no, primary id, constant, 50 spaces
    expect(lines[0]).toBe("A100" + "000000001" + "514290543" + "123456789012345" + "&OF1.31&" + " ".repeat(50));
    const c = lines.find((l) => l.startsWith("C100"))!;
    expect(readRecord("C100", c)).toMatchObject({
      1203: "305",
      1204: "0001",
      1205: "20260105",
      1215: "123456782",
      1219: "+00000001000000",
      1222: "+00000000180000",
      1223: "+00000001180000",
    });
    expect(c.slice(317 + 0, 317 + 15)).toBe("+00000001000000");
    const d = readRecord(
      "D110",
      lines.find((l) => l.startsWith("D110"))!,
    );
    expect(d).toMatchObject({ 1260: "Consulting", 1264: "+0000000000020000", 1265: "+00000000500000", 1268: "1800" });
  });
  it("balances the ledger movements", () => {
    const b = lines.filter((l) => l.startsWith("B100")).map((l) => readRecord("B100", l));
    const sum = (s: string) => b.filter((r) => r[1366] === s).reduce((a, r) => a + +r[1368]!.slice(1), 0);
    expect(sum("1")).toBe(sum("2"));
    const by = Map.groupBy(b, (r) => r[1353]);
    for (const [, g] of by)
      expect(g.filter((r) => r[1366] === "1").reduce((a, r) => a + +r[1368]!.slice(1), 0)).toBe(
        g.filter((r) => r[1366] === "2").reduce((a, r) => a + +r[1368]!.slice(1), 0),
      );
    expect(f.notes).toEqual([]);
  });
  it("puts the files under OPENFRMT/<id without check digit>.<yy>/MMDDhhmm", () => {
    expect(f.dir).toBe("OPENFRMT/51429054.26/10291432");
  });
  it("rejects values that do not fit", () => {
    expect(() => record("A100", { 1101: 12345678901 })).toThrow();
    expect(() => record("NOPE", {})).toThrow();
  });
  it("encodes Hebrew as ISO-8859-8 and zips it", () => {
    expect([...iso88598("אבת€")]).toEqual([0xe0, 0xe1, 0xfa, 0x3f]);
    const z = uniformZip(f);
    expect(z[0]).toBe(0x50);
    expect(z.length).toBeGreaterThan(f.data.length);
  });
});

describe("notes and README", () => {
  it("README is Hebrew and English; notes are codes with the value for the sentence", async () => {
    const { noteText } = await import("./openfrmt.ts");
    const f = uniformFiles(inp);
    expect(f.readme).toContain("ייצוא מבנה אחיד");
    expect(f.readme).toContain("uniform-structure export");
    expect(noteText({ code: "noCustomerName", ref: "0042" })).toBe("document 0042 has no customer name");
    expect(noteText({ code: "unbalanced", n: 2 })).toBe("2 journal entries do not balance");
  });
});
