// Leverage from your own money: what the books show you could keep, from how the money sits and moves (not from tax law tables, which
// the country packs' advisors cover). Pure: pass the merged numbers in (one display currency), get levers out.
//
// - idle cash: money that sat in your accounts the whole window and was more than a buffer of your spending. Each year it stays put it
//   earns nothing; in a deferral wrapper or a yield account it would.
// - transfer routes: what moving your own money cost on each route you used (Mercury → Wise → One Zero vs a direct wire), and what
//   sending everything the cheapest way you already use would have saved.
// - year-end timing: headroom under the osek zair ceiling, so payments due near the end of the year can be timed (cash basis: income
//   counts when it is received).

export interface LeverJourney {
  legs: readonly { out: { entity: string; account: string }; in: { entity: string; account: string } }[];
  sent: number;
  fee: number;
}
export interface LeverInput {
  /** Total cash (bank accounts, not cards) at the end of each day of the window, in the display currency. */
  cashDaily: readonly number[];
  /** Average monthly money out, in the display currency. */
  monthlyOut: number;
  journeys: readonly LeverJourney[];
  /** Osek zair: turnover so far this tax year and the ceiling (both ₪); omit when not zair. */
  zair?: { turnover: number; ceiling: number };
  /** Months of spending kept as a buffer before cash counts as idle. Default 3. */
  bufferMonths?: number;
  /** Yearly yield idle cash could earn (a money-market fund, a deposit). Default 0.04. */
  yieldRate?: number;
}
export interface RouteCost {
  route: string;
  count: number;
  sent: number;
  fee: number;
  /** fee / sent */
  pct: number;
}
export type Lever =
  | { id: "idle-cash"; yearly: number; idle: number; buffer: number; rate: number }
  | { id: "transfer-routes"; yearly: number; fees: number; routes: RouteCost[]; best: RouteCost }
  | { id: "year-end"; yearly: 0; headroom: number; used: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const routeOf = (j: LeverJourney) => [j.legs[0]!.out.account, ...j.legs.map((l) => l.in.account)].join(" → ");

export function levers(inp: LeverInput): Lever[] {
  const out: Lever[] = [];

  // money that never left: the lowest end-of-day cash of the window, less the buffer
  if (inp.cashDaily.length >= 28) {
    const floor = Math.min(...inp.cashDaily),
      buffer = Math.max(0, inp.monthlyOut) * (inp.bufferMonths ?? 3),
      rate = inp.yieldRate ?? 0.04,
      idle = Math.max(0, floor - buffer);
    if (idle > 0) out.push({ id: "idle-cash", yearly: r2(idle * rate), idle: r2(idle), buffer: r2(buffer), rate });
  }

  // the cost of each route you moved money on, and the saving if all of it went the cheapest way you already use
  const by = new Map<string, RouteCost>();
  for (const j of inp.journeys) {
    if (!(j.sent > 0) || !j.legs.length) continue;
    const k = routeOf(j),
      c = by.get(k) ?? { route: k, count: 0, sent: 0, fee: 0, pct: 0 };
    c.count++;
    c.sent += j.sent;
    c.fee += Math.max(0, j.fee);
    by.set(k, c);
  }
  const routes = [...by.values()].map((c) => ({ ...c, sent: r2(c.sent), fee: r2(c.fee), pct: c.fee / c.sent })).sort((a, b) => b.fee - a.fee);
  if (routes.length) {
    const best = routes.reduce((a, b) => (b.pct < a.pct ? b : a));
    const fees = r2(routes.reduce((a, c) => a + c.fee, 0));
    const saving = r2(routes.reduce((a, c) => a + Math.max(0, c.fee - c.sent * best.pct), 0));
    if (fees > 0) out.push({ id: "transfer-routes", yearly: saving, fees, routes, best });
  }

  // close to the zair ceiling: say how much room is left
  if (inp.zair && inp.zair.ceiling > 0) {
    const used = inp.zair.turnover / inp.zair.ceiling;
    if (used >= 0.8) out.push({ id: "year-end", yearly: 0, headroom: r2(Math.max(0, inp.zair.ceiling - inp.zair.turnover)), used });
  }
  return out.sort((a, b) => b.yearly - a.yearly);
}
