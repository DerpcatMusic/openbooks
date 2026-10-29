import { describe, expect, it } from "vite-plus/test";
import { emptyFilings, filingRows, icsCalendar, markDone, readFilings, unmarkDone } from "./filings.ts";

const d = (id: string, date: string) => ({ id, date, title: { en: `Report ${id}`, he: `דוח ${id}` } });
describe("filings", () => {
  const list = [d("c", "2026-12-01"), d("a", "2026-10-01"), d("b", "2026-11-05")];
  it("gives each deadline a status", () => {
    const doc = markDone(emptyFilings(), "a", { on: "2026-10-02", confirmation: "123" });
    const r = filingRows(list, doc, "2026-10-29");
    expect(r.map((x) => [x.id, x.status])).toEqual([["a", "done"], ["b", "soon"], ["c", "upcoming"]]);
    expect(filingRows(list, emptyFilings(), "2026-10-29").map((x) => x.status)).toEqual(["overdue", "soon", "upcoming"]);
    expect(filingRows(list, emptyFilings(), "2026-10-29", 3).map((x) => x.status)).toEqual(["overdue", "upcoming", "upcoming"]);
    expect(r[1]!.days).toBe(7);
    expect(unmarkDone(doc, "a").done).toEqual({});
  });
  it("reads anything", () => {
    expect(readFilings(null)).toEqual(emptyFilings());
    expect(readFilings({ done: { x: { on: "2026-01-01" } }, settings: { a: 1 } }).done.x!.on).toBe("2026-01-01");
  });
  it("writes a valid iCalendar file", () => {
    const rows = filingRows([{ ...d("il.vat.2026-01", "2026-02-19"), url: "https://x.test/a", source: "Law; section, 5" }], emptyFilings(), "2026-02-01");
    const ics = icsCalendar(rows, { name: "OpenBooks", lang: "he", stamp: "20260201T000000Z" });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260219\r\nDTEND;VALUE=DATE:20260220");
    expect(ics).toContain("UID:il.vat.2026-01@openbooks");
    expect(ics).toContain("DESCRIPTION:Law\; section\\, 5");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(icsCalendar(rows, { name: "x", lang: "en", stamp: "s", skipDone: true })).toContain("Report il.vat");
  });
});
