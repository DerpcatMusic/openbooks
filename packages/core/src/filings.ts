// The filings hub's data and logic, country-agnostic: the "filings" doc (done marks + per-country settings), a deadline's status, the upcoming
// list across years, and the .ics export. The deadlines themselves come from the country pack (CountryPack.deadlines).
import type { CountryPack, FilingDeadline } from "./country.ts";

export interface FilingDone {
  /** Date the user filed or paid (YYYY-MM-DD). */
  on: string;
  /** The Tax Authority's / IRS's confirmation or reference number. */
  confirmation?: string;
  note?: string;
}
/** Doc "filings": which deadlines the user marked filed, and each country pack's saved settings (VAT frequency, advance rate...). */
export interface FilingsDoc {
  done: Record<string, FilingDone>;
  settings: Record<string, unknown>;
}
export const emptyFilings = (): FilingsDoc => ({ done: {}, settings: {} });
/** Reads the stored doc whatever it holds. */
export function readFilings(raw: unknown): FilingsDoc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<FilingsDoc>;
  return { done: r.done && typeof r.done === "object" ? r.done : {}, settings: r.settings && typeof r.settings === "object" ? r.settings : {} };
}
export const markDone = (d: FilingsDoc, id: string, done: FilingDone): FilingsDoc => ({ ...d, done: { ...d.done, [id]: done } });
export function unmarkDone(d: FilingsDoc, id: string): FilingsDoc {
  const { [id]: _drop, ...rest } = d.done;
  return { ...d, done: rest };
}

export type FilingStatus = "done" | "overdue" | "soon" | "upcoming";
export interface FilingRow extends FilingDeadline {
  status: FilingStatus;
  /** Days until the date (negative: days late). */
  days: number;
  done?: FilingDone;
}
const dayNo = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5);

/** Status of every deadline on `today`: done (marked), overdue (past, not marked), soon (within `soonDays`), upcoming. Sorted by date. */
export function filingRows(deadlines: readonly FilingDeadline[], doc: FilingsDoc, today: string, soonDays = 14): FilingRow[] {
  return deadlines
    .map((d) => {
      const days = dayNo(d.date) - dayNo(today),
        done = doc.done[d.id];
      const status: FilingStatus = done ? "done" : days < 0 ? "overdue" : days <= soonDays ? "soon" : "upcoming";
      return { ...d, status, days, ...(done ? { done } : {}) };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, ";").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** RFC 5545 line folding at 75 octets (counted in UTF-8 bytes, never inside a character). */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "",
    len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const compact = (iso: string) => iso.replaceAll("-", "");
const next = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + 1)).toISOString().slice(0, 10);

/** An iCalendar file with one all-day event per deadline (a reminder the day before). `stamp` is the creation time, YYYYMMDDTHHMMSSZ. */
export function icsCalendar(rows: readonly FilingRow[], opts: { name: string; lang: "en" | "he"; stamp: string; skipDone?: boolean }): string {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OpenBooks//Filings//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(opts.name)}`];
  for (const r of rows) {
    if (opts.skipDone && r.status === "done") continue;
    const title = r.title[opts.lang] || r.title.en;
    L.push(
      "BEGIN:VEVENT",
      `UID:${esc(r.id)}@openbooks`,
      `DTSTAMP:${opts.stamp}`,
      `DTSTART;VALUE=DATE:${compact(r.date)}`,
      `DTEND;VALUE=DATE:${compact(next(r.date))}`,
      `SUMMARY:${esc(title)}`,
      ...(r.source || r.unverified
        ? [
            `DESCRIPTION:${esc([r.form ? `Form ${r.form}.` : "", r.unverified ? "Date not confirmed from a primary source." : "", r.source ?? ""].filter(Boolean).join(" "))}`,
          ]
        : []),
      ...(r.url ? [`URL:${r.url}`] : []),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(title)}`,
      "TRIGGER:-P1D",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

/** Deadlines that fall due in calendar `year`: the returns of the year before and the periods of this one. `factsFor` gives the entity's facts for a tax year (null = no business type then). */
export function dueInYear(
  pack: CountryPack,
  year: number,
  factsFor: (taxYear: number) => Parameters<NonNullable<CountryPack["deadlines"]>>[1] | null,
): FilingDeadline[] {
  const out = new Map<string, FilingDeadline>();
  for (const y of [year - 1, year]) {
    const f = factsFor(y);
    if (f) for (const d of pack.deadlines?.(y, f) ?? []) if (d.date.startsWith(String(year))) out.set(d.id, d);
  }
  return [...out.values()];
}
