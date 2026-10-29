// Israeli filing calendar helpers: rest days (days the Tax Authority's deadlines skip), the "three rest days" postponement rule, and the
// VAT / advance periods. Pure; the Hebrew calendar comes from the JS runtime's ICU (Intl, calendar "hebrew").
//
// Sources (primary, consolidated texts on Hebrew Wikisource, read 2026-10-29):
//  - VAT Law 1975 s.67(b) "within 15 days after the report period", s.67(b1) postponement when at least three of the five days before the
//    deadline were rest days: the deadline becomes the fourth weekday (יום חול) after the run of rest days that follows; "rest days" are the
//    statutory rest days (Law and Administration Ordinance s.18A(a)) plus Chol HaMoed. Same text: Income Tax Ordinance s.175(f) (advances).
//  - VAT Law s.67א(ד)(1): a monthly detailed-reporting filer reports within 23 days of the period.
//  - VAT Regulations 1976 reg.20(b),(c): reporting period is a month; two months (Jan-Feb, Mar-Apr, ...) for a business whose turnover in the
//    "determining year" (12 months to 31 Aug of the previous tax year) is at most the ceiling (₪1,775,000 from Sep 2025, indexed every 1 Sep).
//  - Online filing is extended to the 19th: Tax Authority practice under VAT Law s.67ב(ד)(3) (secondary sources only; the gov.il page was
//    not reachable), so the date is shown with that caveat.
//  - Fridays are NOT rest days in the statutory definition, so they count as weekdays here.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const at = (s: string) => new Date(`${s}T12:00:00Z`);
export const addDays = (s: string, n: number) => iso(new Date(at(s).getTime() + n * 864e5));
const dow = (s: string) => at(s).getUTCDay(); // 0 = Sunday .. 6 = Saturday

const HEB = new Intl.DateTimeFormat("en-u-ca-hebrew", { timeZone: "UTC", day: "numeric", month: "long" });
/** [day, month name in ICU English] of the Hebrew date. */
function hebrew(s: string): [number, string] {
  const p = HEB.formatToParts(at(s));
  return [+p.find((x) => x.type === "day")!.value, p.find((x) => x.type === "month")!.value];
}

const cache = new Map<number, Set<string>>();
/** Rest days of a Gregorian year: Saturdays, Rosh Hashana (2), Yom Kippur, Sukkot day 1 and Shmini Atzeret, Pesach day 1 and 7, Shavuot,
 *  Independence Day (5 Iyar; Friday/Saturday: the Thursday before, Monday: the Tuesday after), and Chol HaMoed of Sukkot and Pesach. */
export function restDays(year: number): ReadonlySet<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const out = new Set<string>();
  for (let s = `${year}-01-01`; s <= `${year}-12-31`; s = addDays(s, 1)) {
    const [d, m] = hebrew(s);
    const rest =
      dow(s) === 6 ||
      (m === "Tishri" && (d === 1 || d === 2 || d === 10 || (d >= 15 && d <= 22))) || // 15 Sukkot, 16-21 Chol HaMoed (incl. Hoshana Rabba), 22 Shmini Atzeret
      (m === "Nisan" && d >= 15 && d <= 21) || // 15 Pesach, 16-20 Chol HaMoed, 21 Pesach
      (m === "Sivan" && d === 6);
    if (rest) out.add(s);
    if (m === "Iyar") {
      const base = addDays(s, 5 - d), // 5 Iyar
        w = dow(base),
        seen = w === 5 ? addDays(base, -1) : w === 6 ? addDays(base, -2) : w === 1 ? addDays(base, 1) : base;
      if (s === seen) out.add(s);
    }
  }
  cache.set(year, out);
  return out;
}
export const isRestDay = (s: string) => restDays(+s.slice(0, 4)).has(s);

/**
 * The real last day for a statutory deadline `d` (YYYY-MM-DD): a deadline that falls on a rest day moves to the next weekday; if at least
 * three of the five days before it were rest days it becomes the fourth weekday after the run of rest days that follows (s.67(b1)).
 * ponytail: "the run that follows" is taken as the run of rest days containing the latest rest day among the five.
 */
export function dueDate(d: string): string {
  const win = [1, 2, 3, 4, 5].map((n) => addDays(d, -n));
  const rest = win.filter(isRestDay);
  if (rest.length >= 3) {
    let end = rest.sort().at(-1)!;
    while (isRestDay(addDays(end, 1))) end = addDays(end, 1);
    let n = 0,
      x = end;
    while (n < 4) {
      x = addDays(x, 1);
      if (!isRestDay(x)) n++;
    }
    return x;
  }
  let x = d;
  while (isRestDay(x)) x = addDays(x, 1);
  return x;
}

export type VatFrequency = "monthly" | "bimonthly";
export interface Period {
  /** YYYY-MM of the first month; unique per period in a year. */
  key: string;
  from: string; // YYYY-MM-DD
  to: string;
  months: number;
}
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** The VAT reporting periods of a calendar year: 12 months, or 6 two-month periods starting in Jan, Mar, May, Jul, Sep, Nov. */
export function vatPeriods(year: number, f: VatFrequency): Period[] {
  const step = f === "monthly" ? 1 : 2;
  return Array.from({ length: 12 / step }, (_, i) => {
    const m = i * step + 1,
      last = m + step - 1;
    return { key: `${year}-${pad(m)}`, from: `${year}-${pad(m)}-01`, to: `${year}-${pad(last)}-${pad(lastDay(year, last))}`, months: step };
  });
}
/** The period of this frequency that holds `date`. */
export const periodOf = (date: string, f: VatFrequency): Period => vatPeriods(+date.slice(0, 4), f).find((p) => date >= p.from && date <= p.to)!;

/** When a periodic report (and its payment) is due: `day` of the month after the period, then rest-day rules. day: 15 statutory, 19 online, 23 detailed (s.67א). */
export function reportDue(p: Pick<Period, "to">, day: 15 | 19 | 23): string {
  const y = +p.to.slice(0, 4),
    m = +p.to.slice(5, 7);
  const ny = m === 12 ? y + 1 : y,
    nm = m === 12 ? 1 : m + 1;
  return dueDate(`${ny}-${pad(nm)}-${pad(day)}`);
}
