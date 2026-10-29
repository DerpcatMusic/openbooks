// Business trips (doc "trips"): the per-night, per-day and per-trip limits that a plain deduction rule can't express. A trip is a record
// (dates, country, nights, business days, companion) plus the transactions linked to it (by tag or by id); each linked cost has a role
// (flight, lodging, meals and local costs, car rental, companion, other) and the trip decides what is deductible of each.
//   Israel, Regulation on deducting certain expenses 2(2) (docs/tax-research-il.md "Business travel abroad"): lodging up to $365 a night for
//   the first 7 nights, nights 8-90 up to $160 in full and 75% (min $160, max $273.75) of a dearer night, over 90 nights $160; other
//   expenses up to $102 a day of stay with lodging and $171 without; a rental car up to $80 a day; all caps x1.25 in the listed countries;
//   a mixed trip: lodging, daily allowance and car only for the business days; a companion: nothing, and a room shared with one costs no more
//   than the single price. 2025 and 2026 amounts come from the rule table, the caps are in US dollars.
//   United States, IRC 162(a)(2), 274(c), 274(m)(3), 274(n) and Reg. 1.274-4 / 1.162-2: lodging actual, travel meals 50% of actual or the
//   M&IE per diem (75% of the rate on the first and last day; sole proprietors only), a foreign trip is allocated by business days unless
//   it is 7 consecutive days or less (not counting the day you leave), or under 25% of it is personal; a domestic trip's fare is deductible only
//   when business is the main purpose; a companion who is not a bona fide employee: nothing, and a shared room at the single rate.
// Pure: ledger rows and the rule table in, the deductible part of every linked cost and a breakdown out. Not tax advice.
import type { DeductionRule, Txn } from "@openbooks/schema";
import { daysBetween } from "./accrual.ts";
import { isIsoDate } from "./journal.ts";
import { haystack } from "./rules.ts";

export type TripRole = "transport" | "lodging" | "meals" | "carRental" | "companion" | "other";
export const TRIP_ROLES: readonly TripRole[] = ["transport", "lodging", "meals", "carRental", "companion", "other"];

/** doc "trips" is a list of these. */
export interface Trip {
  id: string;
  name: string;
  /** First and last day away, YYYY-MM-DD. */
  start: string;
  end: string;
  /** ISO 3166 alpha-2 of the destination ("US", "DE"); a trip with several countries takes the main one. */
  country: string;
  /** Nights spent away (hotel nights). */
  nights: number;
  /** Days of the trip that were business days (travel days count when the trip was for business). */
  businessDays: number;
  /** A companion travelled who is not working for the business (the spouse, a partner): their costs are not deductible. */
  companion?: boolean;
  purpose: string;
  /** Transactions are part of the trip when they carry one of these tags (tag ids) or are listed in `txns` (ledger row ids). */
  tags?: string[];
  txns?: string[];
  /** The role of a linked cost when it isn't obvious from its tax tag or text. */
  roles?: Record<string, TripRole>;
  /** Books currency per 1 US dollar, for the dollar caps of Israeli trips (the Bank of Israel representative rate of the trip, or your own). */
  fx?: number;
  /** Price per night of a single room (books currency): a room shared with a companion is deductible up to it. */
  singleRoom?: number;
  /** Days with a rental car (default: the business days). */
  carDays?: number;
  /** US: take the M&IE per diem instead of the actual meals; `mie` = the daily rate (default: the rule table's). */
  perDiem?: boolean;
  mie?: number;
}

/** Why the trip is not usable as entered, or null. */
export type TripProblem = "name" | "dates" | "country" | "nights" | "businessDays" | "fx" | "carDays";
export function tripProblem(t: Pick<Trip, "name" | "start" | "end" | "country" | "nights" | "businessDays"> & Partial<Trip>): TripProblem | null {
  if (!String(t.name ?? "").trim()) return "name";
  if (!isIsoDate(t.start) || !isIsoDate(t.end) || t.end < t.start) return "dates";
  if (!/^[A-Z]{2}$/.test(t.country ?? "")) return "country";
  const days = daysBetween(t.start, t.end) + 1;
  if (!Number.isInteger(t.nights) || t.nights < 0 || t.nights > days) return "nights";
  if (!Number.isInteger(t.businessDays) || t.businessDays < 0 || t.businessDays > days) return "businessDays";
  if (t.fx !== undefined && !(t.fx > 0)) return "fx";
  if (t.carDays !== undefined && !(Number.isInteger(t.carDays) && t.carDays >= 0 && t.carDays <= days)) return "carDays";
  return null;
}

/** Countries where the Israeli travel caps are 25% higher (docs/tax-research-il.md). */
export const IL_UPLIFT = new Set("AU AT IT IS IE AO BE DE AE DK NL HK GB TW GR JP LU NO ES OM FI FR QA KR CM CA SE CH".split(" "));
/** ISO 3166 alpha-2 codes for the destination picker; the UI names them with Intl.DisplayNames. */
export const COUNTRY_CODES =
  "AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW".split(
    " ",
  );

/** One part of a trip's cost: what was spent, what is deductible, the ceiling that applied (books currency) and why. */
export interface TripPart {
  role: TripRole;
  gross: number;
  deductible: number;
  /** The most the rule allowed for the whole part (null: no ceiling, a share or an all-or-nothing rule). */
  cap: number | null;
  why: TripWhy[];
}
/** A reason as a code the UI translates ("trips.why.<k>"): v = a number, w = a word. */
export interface TripWhy {
  k: string;
  v?: number;
  w?: string;
}
export interface TripResult {
  trip: Trip;
  country: "il" | "us";
  days: number;
  /** Fewer business days than days away. */
  mixed: boolean;
  foreign: boolean;
  /** The caps are 25% higher (Israel, listed country). */
  uplift: boolean;
  /** Dollar caps need a rate to the books' currency and there is none: they were not enforced. */
  fxMissing: boolean;
  gross: number;
  deductible: number;
  parts: TripPart[];
  /** Per-diem money with no meals linked to it (the US M&IE option): deductible, but not attached to any transaction. */
  unlinked: number;
  /** Ledger row id -> deductible share of it. */
  lines: Record<string, { role: TripRole; gross: number; deductible: number }>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
/** The rule-table value for the year (2025/2026 columns): the year's, else the latest column. */
const byYear = (v: unknown, y: number, d: number) => {
  const m = (v ?? {}) as Record<string, number>;
  return m[String(y)] ?? m[Object.keys(m).sort().at(-1) ?? ""] ?? d;
};

/** Role of a cost: the trip's own choice, else what its rule says, else what the text says. */
const RULE_ROLE: Readonly<Record<string, TripRole>> = {
  "il.travel.flights": "transport",
  "us.travel.transport": "transport",
  "il.travel.lodging": "lodging",
  "il.lodging-il": "lodging",
  "us.travel.lodging": "lodging",
  "il.travel.perdiem": "meals",
  "us.meals.travel": "meals",
  "us.meals.per-diem": "meals",
  "il.travel.car-rental": "carRental",
  "il.travel.companion": "companion",
  "us.travel.companion": "companion",
};
const TEXT_ROLE: readonly [RegExp, TripRole][] = [
  [/car rental|rent[- ]a[- ]car|hertz|avis|sixt|europcar|budget rent|השכרת רכב/, "carRental"],
  [/hotel|hostel|lodg|airbnb|resort|inn\b|motel|booking\.com|מלון|אכסני|לינה/, "lodging"],
  [/airline|airways|flight|\bair\b|el al|ryanair|easyjet|lufthansa|delta|united|rail|train|טיסה|אל על|רכבת/, "transport"],
  [/restaurant|cafe|coffee|food|meal|uber|lyft|taxi|metro|bus\b|מסעדה|מונית|אוכל/, "meals"],
];
export function roleOf(trip: Pick<Trip, "roles">, id: string, rule: string | undefined, text: string): TripRole {
  const own = trip.roles?.[id];
  if (own) return own;
  if (rule && RULE_ROLE[rule]) return RULE_ROLE[rule]!;
  const hay = text.toLowerCase();
  return TEXT_ROLE.find(([re]) => re.test(hay))?.[1] ?? "other";
}
/** The rule a role stands for in each country (for the evidence list and the Taxximizer's per-rule totals); "other" keeps the cost's own. */
export const ROLE_RULE: Readonly<Record<"il" | "us", Partial<Record<TripRole, string>>>> = {
  il: { transport: "il.travel.flights", lodging: "il.travel.lodging", meals: "il.travel.perdiem", carRental: "il.travel.car-rental", companion: "il.travel.companion" },
  us: { transport: "us.travel.transport", lodging: "us.travel.lodging", meals: "us.meals.travel", carRental: "us.travel.transport", companion: "us.travel.companion" },
};

/** A linked cost: the ledger row, its role and the text it was classified from. */
export interface TripCost {
  id: string;
  gross: number;
  role: TripRole;
}
export interface TripContext {
  country: "il" | "us";
  year: number;
  /** The books' currency; the dollar caps convert at trip.fx unless it is USD. */
  currency: string;
  rule: (id: string) => DeductionRule | undefined;
}

/** Whether a foreign trip falls under the 274(c) allocation: more than 7 consecutive days (not counting the day you leave) and 25% or more personal. */
export function allocates274c(days: number, businessDays: number) {
  const personal = (days - businessDays) / days;
  return days - 1 > 7 && personal >= 0.25 - 1e-9;
}

/**
 * What of a trip's linked costs is deductible. `costs` are the trip's rows (outflows of the tax year) with their roles. Every money figure
 * of a part is in the books' currency; the dollar caps are converted at trip.fx (1 when the books are in dollars).
 */
export function tripDeduction(trip: Trip, costs: readonly TripCost[], cx: TripContext): TripResult {
  const days = Math.max(1, daysBetween(trip.start, trip.end) + 1),
    B = Math.min(days, Math.max(0, trip.businessDays)),
    mixed = B < days,
    foreign = trip.country !== (cx.country === "il" ? "IL" : "US"),
    nights = Math.max(0, Math.min(trip.nights, days)),
    bizNights = mixed ? Math.min(nights, B) : nights,
    abroad = cx.country === "il" && foreign, // Israeli caps are for travel abroad; a trip inside Israel follows the plain rules below
    uplift = abroad && IL_UPLIFT.has(trip.country);
  const rate = cx.currency === "USD" ? 1 : trip.fx && trip.fx > 0 ? trip.fx : null,
    usd = (d: number) => (rate === null ? null : d * rate * (uplift ? 1.25 : 1)),
    fxMissing = rate === null;
  const gross = (role: TripRole) => r2(sum(costs.filter((c) => c.role === role).map((c) => c.gross)));
  const parts: TripPart[] = [];
  let unlinked = 0;
  const part = (role: TripRole, ded: number, cap: number | null, why: TripWhy[]) => {
    const g = gross(role);
    if (!g) return;
    parts.push({ role, gross: g, deductible: r2(Math.max(0, Math.min(ded, g))), cap: cap === null ? null : r2(cap), why });
  };
  const missing: TripWhy[] = fxMissing ? [{ k: "fxMissing" }] : [];
  const share = mixed ? B / days : 1; // meals and local costs of the days away, only the business ones
  // the single room price: a room shared with a companion is deductible up to it (both countries)
  const nightlyOf = (g: number) => {
    if (!nights) return 0;
    const avg = g / nights;
    return trip.companion && trip.singleRoom && trip.singleRoom > 0 ? Math.min(avg, trip.singleRoom) : avg;
  };
  const roomWhy = (): TripWhy[] =>
    trip.companion ? (trip.singleRoom && trip.singleRoom > 0 ? [{ k: "singleRoom", v: trip.singleRoom }] : [{ k: "singleRoomUnknown" }]) : [];

  if (abroad) {
    const lod = cx.rule("il.travel.lodging")?.values,
      per = cx.rule("il.travel.perdiem")?.values,
      car = cx.rule("il.travel.car-rental")?.values,
      y = cx.year;
    const c1 = byYear(lod?.firstSevenNights, y, 365),
      full = byYear(lod?.nights8to90Full, y, 160),
      max75 = byYear(lod?.nights8to90Max75pct, y, 273.75),
      over90 = byYear(lod?.over90Nights, y, 160);
    // lodging: per night, by the night's number; actual per night is the average of what was paid
    const lg = gross("lodging");
    if (lg) {
      const a = nightlyOf(lg);
      let ded = 0;
      if (rate !== null) {
        const night = (n: number) => {
          const k1 = usd(c1)!,
            kFull = usd(full)!,
            kMax = usd(max75)!;
          if (nights > 90) return Math.min(a, usd(over90)!);
          if (n <= 7) return Math.min(a, k1);
          return a <= kFull ? a : Math.max(kFull, Math.min(0.75 * a, kMax));
        };
        for (let n = 1; n <= bizNights; n++) ded += night(n);
      } else ded = a * bizNights;
      const cap = rate === null ? null : Array.from({ length: bizNights }, (_, i) => i + 1).reduce((s, n) => s + (n > 90 || nights > 90 ? usd(over90)! : n <= 7 ? usd(c1)! : usd(max75)!), 0);
      part("lodging", ded, cap, [
        ...missing,
        ...(nights ? [] : [{ k: "noNights" }]),
        ...(mixed ? [{ k: "businessNights", v: bizNights, w: String(nights) }] : []),
        ...roomWhy(),
        ...(uplift ? [{ k: "uplift", w: trip.country }] : []),
        { k: "ilLodging" },
      ]);
    }
    // other expenses (meals, local transport): a ceiling per day of stay, higher without lodging
    const mg = gross("meals");
    if (mg) {
      const withL = Math.min(bizNights, B),
        without = Math.max(0, B - withL),
        cap = rate === null ? null : withL * usd(byYear(per?.withLodging, y, 102))! + without * usd(byYear(per?.withoutLodging, y, 171))!;
      part("meals", cap === null ? mg * share : Math.min(mg, cap), cap, [...missing, { k: "ilPerDiem", v: withL, w: String(without) }, ...(uplift ? [{ k: "uplift", w: trip.country }] : [])]);
    }
    const cg = gross("carRental");
    if (cg) {
      const d = Math.min(days, trip.carDays ?? B),
        cap = rate === null ? null : d * usd(byYear(car?.perDay, y, 80))!;
      part("carRental", cap === null ? cg * share : Math.min(cg, cap), cap, [...missing, { k: "ilCar", v: d }]);
    }
    // flights: in full when business is the main purpose of the trip, else by business days (practice; no published ITA rule)
    const tg = gross("transport");
    if (tg) {
      const main = B * 2 > days;
      part("transport", main ? tg : (tg * B) / days, null, [{ k: main ? "mainPurpose" : "byDays", v: B, w: String(days) }, { k: "flightClass" }]);
    }
  } else {
    // United States books (and a trip inside Israel, where the only differences are the meals and the 274(c) rule: foreign is false there)
    const mieRate = trip.mie && trip.mie > 0 ? trip.mie : (cx.rule("us.meals.per-diem")?.cap?.amount ?? 68);
    const lg = gross("lodging");
    if (lg) {
      const a = nightlyOf(lg);
      part("lodging", a * bizNights, null, [...(mixed ? [{ k: "businessNights", v: bizNights, w: String(nights) }] : []), ...roomWhy()]);
    }
    const mg = gross("meals");
    if (cx.country === "il") {
      if (mg) part("meals", 0, null, [{ k: "ilMealsOwn" }]); // s.32(1): a meal inside Israel is a private cost
    } else if (trip.perDiem) {
      // M&IE per diem in place of the actual meals: 50% of the rate, 75% of it on the first and last day
      const eff = B >= 2 ? B - 0.5 : B === 1 ? 0.75 : 0,
        ded = r2(mieRate * eff * 0.5),
        onMeals = Math.min(ded, mg);
      part("meals", onMeals, ded, [{ k: "usPerDiem", v: mieRate, w: String(B) }]);
      if (ded - onMeals > 0.004) {
        unlinked = r2(ded - onMeals);
        parts.push({ role: "meals", gross: 0, deductible: unlinked, cap: ded, why: [{ k: "usPerDiem", v: mieRate, w: String(B) }, { k: "perDiemUnlinked" }] });
      }
    } else if (mg) part("meals", mg * 0.5 * share, null, [{ k: "usMeals50" }, ...(mixed ? [{ k: "byDays", v: B, w: String(days) }] : [])]);
    // fares: a foreign trip is allocated by business days under 274(c) unless an exception applies; a domestic one needs business as the main purpose
    const tg = gross("transport") + gross("carRental");
    if (tg) {
      let f = 1;
      const why: TripWhy[] = [];
      if (foreign && mixed && allocates274c(days, B)) ((f = B / days), why.push({ k: "us274c", v: B, w: String(days) }));
      else if (foreign && mixed) why.push({ k: "us274cExempt", v: days });
      else if (!foreign && mixed) {
        const main = B * 2 > days;
        f = main ? 1 : 0;
        why.push({ k: main ? "mainPurpose" : "mainPersonal", v: B, w: String(days) });
      }
      for (const role of ["transport", "carRental"] as const) part(role, gross(role) * f, null, why);
    }
  }
  // a companion's own costs, and anything else linked: in full unless a companion
  const co = gross("companion");
  if (co) part("companion", 0, null, [{ k: "companion" }]);
  const og = gross("other");
  if (og) part("other", og, null, [{ k: "otherFull" }]);

  // spread each part over its costs by size
  const lines: TripResult["lines"] = {};
  for (const c of costs) {
    const p = parts.find((x) => x.role === c.role && x.gross > 0);
    lines[c.id] = { role: c.role, gross: c.gross, deductible: p ? r2((c.gross * p.deductible) / p.gross) : 0 };
  }
  // the cent left over by rounding goes to the biggest cost of the part
  for (const p of parts.filter((x) => x.gross > 0)) {
    const ids = costs.filter((c) => c.role === p.role).sort((a, b) => b.gross - a.gross);
    if (ids.length) lines[ids[0]!.id]!.deductible = r2(lines[ids[0]!.id]!.deductible + (p.deductible - sum(ids.map((c) => lines[c.id]!.deductible))));
  }
  return {
    trip,
    country: cx.country,
    days,
    mixed,
    foreign,
    uplift,
    fxMissing: fxMissing && abroad,
    gross: r2(sum(costs.map((c) => c.gross))),
    deductible: r2(sum(parts.map((p) => p.deductible))),
    parts,
    unlinked,
    lines,
  };
}

/** Rows (ledger ids) that belong to the trip: its listed ids, and anything carrying one of its tags. First trip wins. */
export function tripMembers(trips: readonly Trip[], txns: readonly Pick<Txn, "id" | "tags">[]): Map<string, Trip> {
  const m = new Map<string, Trip>();
  for (const t of txns)
    for (const trip of trips)
      if (trip.txns?.includes(t.id) || trip.tags?.some((g) => t.tags?.includes(g))) {
        m.set(t.id, trip);
        break;
      }
  return m;
}
/** The text a role is guessed from. */
export const tripText = (t: Pick<Txn, "desc" | "memo" | "mcat">) => haystack(t);
