import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ReadContext, ReadFile, ReadResult } from "./read.ts";

// Readers are mocked: this tests only which one read() picks (books.py read()), and what it hands it.
const m = vi.hoisted(() => {
  const r = (name: string) =>
    vi.fn((_f: unknown, _c: unknown): ReadResult => ({ rows: [], checks: [{ file: name, label: name, period: ["", ""], parsed: 0, total: 0 }] }));
  return {
    onezeroPdf: r("onezeroPdf"),
    onezeroJson: r("onezeroJson"),
    scraperJson: r("scraperJson"),
    mercuryJson: r("mercuryJson"),
    mercuryCsv: r("mercuryCsv"),
    bitCsv: r("bitCsv"),
    mappedCsv: vi.fn((_f: ReadFile, _c: ReadContext): ReadResult | null => null),
    csvDecode: vi.fn((b: Uint8Array) => new TextDecoder().decode(b).replace(/^﻿/, "")),
  };
});
vi.mock("./readers/onezero.ts", () => ({ onezeroPdf: m.onezeroPdf, onezeroJson: m.onezeroJson }));
vi.mock("./readers/scraper.ts", () => ({ scraperJson: m.scraperJson }));
vi.mock("./readers/mercury.ts", () => ({ mercuryJson: m.mercuryJson, mercuryCsv: m.mercuryCsv }));
vi.mock("./readers/bit.ts", () => ({ bitCsv: m.bitCsv }));
vi.mock("./readers/csv.ts", () => ({ mappedCsv: m.mappedCsv, csvDecode: m.csvDecode }));

const { read } = await import("./read.ts");
const ctx: ReadContext = { meta: { name: "Acme" }, profile: {}, csvProfiles: [], siblingPdfPeriods: () => [] };
const file = (name: string, text = ""): ReadFile => ({ name, bytes: new TextEncoder().encode(text) });
const picked = (name: string, text?: string) => read(file(name, text), ctx).checks[0]?.label;

describe("read() dispatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("by suffix, case-insensitive; JSON by its source field", () => {
    expect(picked("Statement.PDF")).toBe("onezeroPdf");
    expect(picked("a.json", '{"source": "onezero", "accounts": []}')).toBe("onezeroJson");
    expect(picked("a.JSON", '{"source": "scraper"}')).toBe("scraperJson");
    expect(picked("a.json", '{"accounts": [], "transactions": []}')).toBe("mercuryJson");
    expect(picked("a.json", '{"source": 7}')).toBe("mercuryJson");
    expect(m.onezeroJson.mock.calls[0]?.[0]).toMatchObject({ name: "a.json", text: '{"source": "onezero", "accounts": []}' });
  });

  it("CSV: Mercury header > mapped profile > bit", () => {
    expect(picked("x.csv", "﻿Date (UTC),Description,Amount\n01-02-2025,a,1")).toBe("mercuryCsv");
    expect(picked("x.csv", "Date,Amount\nDate (UTC)")).toBe("bitCsv");
    expect(m.mappedCsv.mock.calls[0]?.[0].text).toBe("Date,Amount\nDate (UTC)");
    m.mappedCsv.mockReturnValueOnce({ rows: [], checks: [{ file: "x.csv", label: "mapped", period: ["", ""], parsed: 0, total: 0 }] });
    expect(picked("x.csv", "a;b")).toBe("mapped");
    expect(m.bitCsv).toHaveBeenCalledTimes(1);
    expect(m.bitCsv.mock.calls[0]?.[1]).toBe(ctx);
  });

  it("throws for what books.py can't read (ingest lists it with ok = 0)", () => {
    expect(() => read(file("notes.txt"), ctx)).toThrow("unsupported");
    expect(() => read(file(".pdf"), ctx)).toThrow("unsupported"); // Path(".pdf").suffix == ""
    expect(() => read(file("a.json", "[1]"), ctx)).toThrow();
    expect(() => read(file("a.json", "null"), ctx)).toThrow();
    expect(() => read(file("a.json", '﻿{"source": "scraper"}'), ctx)).toThrow(); // json.loads rejects a BOM
    expect(() => read({ name: "a.json", bytes: new Uint8Array([0x7b, 0xff, 0x7d]) }, ctx)).toThrow(); // read_text(): strict UTF-8
  });

  it("returns uidAmount alongside the rows", () => {
    const r = read(file("a.pdf"), ctx);
    expect(r.uidAmount({ date: "2025-01-01", amount: 5, desc: "", source: "bank", account: "", file: "", page: 1, key: "" })).toBe("5.0");
  });
});
