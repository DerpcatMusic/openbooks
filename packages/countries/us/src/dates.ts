// Federal due dates move to the next business day when they fall on a Saturday, Sunday or legal holiday (IRC §7503; Treas. Reg.
// §301.7503-1). "Legal holiday" is a legal holiday in the District of Columbia: the federal holidays plus Emancipation Day (April 16),
// each observed on the Friday before when it falls on a Saturday and on the Monday after when it falls on a Sunday (DC Code §1-612.02).
// Source for the rule: https://www.irs.gov/instructions/i1040gi ("Due date … falls on a Saturday, Sunday, or legal holiday").
export const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const dow = (s: string) => utc(s).getUTCDay(); // 0 = Sunday
export const addDays = (s: string, n: number) => new Date(utc(s).getTime() + n * 86400000).toISOString().slice(0, 10);

/** The n-th (1-based) given weekday of a month; n = -1 is the last one. */
function nth(y: number, m: number, weekday: number, n: number) {
  if (n > 0) {
    const first = dow(iso(y, m, 1));
    return iso(y, m, 1 + ((weekday - first + 7) % 7) + 7 * (n - 1));
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return iso(y, m, last - ((dow(iso(y, m, last)) - weekday + 7) % 7));
}
const observed = (s: string) => (dow(s) === 6 ? addDays(s, -1) : dow(s) === 0 ? addDays(s, 1) : s);

/** Days of year y on which a federal deadline moves: DC legal holidays, as observed. */
export function legalHolidays(y: number): Set<string> {
  return new Set(
    [
      iso(y, 1, 1), // New Year's Day
      nth(y, 1, 1, 3), // Martin Luther King Jr. Day
      nth(y, 2, 1, 3), // Washington's Birthday
      nth(y, 5, 1, -1), // Memorial Day
      iso(y, 6, 19), // Juneteenth
      iso(y, 7, 4),
      nth(y, 9, 1, 1), // Labor Day
      nth(y, 10, 1, 2), // Columbus / Indigenous Peoples' Day
      iso(y, 11, 11), // Veterans Day
      nth(y, 11, 4, 4), // Thanksgiving
      iso(y, 12, 25),
      iso(y, 4, 16), // DC Emancipation Day
    ].map(observed),
  );
}

/** The date itself, or the next day that is not a weekend or legal holiday. */
export function nextBusinessDay(s: string): string {
  let d = s;
  for (;;) {
    const y = +d.slice(0, 4);
    const hol = new Set([...legalHolidays(y), ...legalHolidays(y + 1)]); // Jan 1 observed on Dec 31 belongs to the next year's list
    if (dow(d) !== 0 && dow(d) !== 6 && !hol.has(d)) return d;
    d = addDays(d, 1);
  }
}
/** Due date "month/day of year y", moved to the next business day. */
export const dueOn = (y: number, m: number, d: number) => nextBusinessDay(iso(y, m, d));
