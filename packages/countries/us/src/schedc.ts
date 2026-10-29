// Schedule C (Form 1040), Profit or Loss From Business: lines computed from the ledger and the deduction engine. 2025 form numbering.
// Revenue, refunds and other income come from the ledger accounts; every expense line comes from the deduction engine's per-transaction
// `deductible` (meals 50%, entertainment 0%, business-use tags, caps), so a rule is applied once, here nothing is multiplied again.
// Home office is the simplified method ($5/sq ft, up to 300) and vehicles the standard mileage rate by trip date, both from the owner's
// inputs. Sources: Schedule C instructions https://www.irs.gov/instructions/i1040sc ; Rev. Proc. 2013-13 (home office); Notice (mileage).
import type { FedTable } from "./schema.ts";
import { mileageDeduction, rd } from "./tax.ts";

export interface Trip {
  id?: string;
  date: string;
  miles: number;
  purpose?: string;
}
export interface VehicleInput {
  /** standard: miles × the rate of the trip's date + parking and tolls; actual: the ledger's vehicle accounts as the engine allows them. */
  method: "standard" | "actual";
  trips?: readonly Trip[];
  parkingTolls?: number;
  /** Part IV: miles driven in the year / commuting miles (business miles come from the trips). */
  totalMiles?: number;
  commutingMiles?: number;
  /** Date the vehicle was first used for business, YYYY-MM-DD (line 43). */
  placedInService?: string;
}
export interface SchedCInputs {
  /** Home office, simplified method: square feet used regularly and exclusively for the business (max 300) and the home's total. */
  homeSqft?: number;
  homeTotalSqft?: number;
  vehicle?: VehicleInput;
  /** Returns and allowances the ledger doesn't show (line 2). */
  returns?: number;
  /** The business holds inventory: cost of revenue accounts go to Part III. */
  inventory?: { on: boolean; begin?: number; end?: number };
}
/** The engine row of an expense, only what Schedule C needs. */
export interface DedRow {
  id: string;
  category: string;
  gross: number;
  deductible: number;
  rule?: string;
}
export interface LedgerRow {
  id: string;
  date: string;
  amount: number;
  category: string;
}
export interface SchedCWarn {
  k: string;
  v?: number;
  w?: string;
}

/** Ledger account name (the part after "type:") → Schedule C line. Anything not listed goes to Part V, "Other expenses". */
export const LINE_OF: Readonly<Record<string, string>> = {
  advertising: "8",
  marketing: "8",
  vehicle: "9",
  "platform-fees": "10",
  commissions: "10",
  fees: "10",
  contractors: "11",
  "contract-labor": "11",
  depreciation: "13",
  benefits: "14",
  insurance: "15",
  "mortgage-interest": "16a",
  interest: "16b",
  professional: "17",
  legal: "17",
  accounting: "17",
  office: "18",
  pension: "19",
  retirement: "19",
  "equipment-rental": "20a",
  rent: "20b",
  repairs: "21",
  supplies: "22",
  taxes: "23",
  licenses: "23",
  travel: "24a",
  meals: "24b",
  utilities: "25",
  "phone-internet": "25",
  wages: "26",
  payroll: "26",
  salaries: "26",
};
/** Schedule C line titles (2025). */
export const LINE_TITLE: Readonly<Record<string, string>> = {
  "1": "Gross receipts or sales",
  "2": "Returns and allowances",
  "3": "Subtract line 2 from line 1",
  "4": "Cost of goods sold",
  "5": "Gross profit",
  "6": "Other income",
  "7": "Gross income",
  "8": "Advertising",
  "9": "Car and truck expenses",
  "10": "Commissions and fees",
  "11": "Contract labor",
  "12": "Depletion",
  "13": "Depreciation and section 179",
  "14": "Employee benefit programs",
  "15": "Insurance (other than health)",
  "16a": "Interest: mortgage",
  "16b": "Interest: other",
  "17": "Legal and professional services",
  "18": "Office expense",
  "19": "Pension and profit-sharing plans",
  "20a": "Rent: vehicles, machinery, equipment",
  "20b": "Rent: other business property",
  "21": "Repairs and maintenance",
  "22": "Supplies",
  "23": "Taxes and licenses",
  "24a": "Travel",
  "24b": "Deductible meals",
  "25": "Utilities",
  "26": "Wages",
  "27a": "Energy efficient commercial buildings deduction",
  "27b": "Other expenses (Part V)",
  "28": "Total expenses",
  "29": "Tentative profit or (loss)",
  "30": "Expenses for business use of your home",
  "31": "Net profit or (loss)",
};
export const EXPENSE_LINES = ["8", "9", "10", "11", "12", "13", "14", "15", "16a", "16b", "17", "18", "19", "20a", "20b", "21", "22", "23", "24a", "24b", "25", "26", "27a", "27b"] as const;

const nameOf = (account: string) => (account.includes(":") ? account.slice(account.indexOf(":") + 1) : account);
const groupOf = (account: string) => (account || "ask").split(":")[0]!;
const human = (n: string) => {
  const s = n.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export interface SchedCResult {
  year: number;
  /** Form line → whole dollars. Only lines with an amount (and the totals 3, 5, 7, 28, 29, 31) are present. */
  lines: Record<string, number>;
  /** Where each line's money came from, largest first: ledger account (or "mileage", "home office") and amount. */
  sources: { line: string; account: string; amount: number }[];
  /** Part V other expenses (≤ 9 rows for the form; extra rows are rolled into the last one). */
  partV: { label: string; amount: number }[];
  /** Part III (only with inventory): lines 35-42. */
  partIII: Record<string, number> | null;
  /** Part IV: vehicle information. */
  vehicle: { method: "standard" | "actual"; businessMiles: number; commutingMiles: number; otherMiles: number; placedInService?: string; deduction: number; bands: { cents: number; miles: number; amount: number }[] } | null;
  homeOffice: { sqft: number; deduction: number; limited: boolean } | null;
  /** Net profit or loss (line 31): what Schedule SE and the QBI deduction start from. */
  netProfit: number;
  warnings: SchedCWarn[];
  /** Expenses the deduction rules do not allow: gross − deductible, for the "what was disallowed" note. */
  disallowed: number;
}

export function scheduleC(i: {
  year: number;
  fed: FedTable;
  txns: readonly LedgerRow[];
  deductions: readonly DedRow[];
  inputs?: SchedCInputs;
}): SchedCResult {
  const inp = i.inputs ?? {},
    inv = inp.inventory?.on ? inp.inventory : null,
    warnings: SchedCWarn[] = [],
    sources: SchedCResult["sources"] = [],
    amounts = new Map<string, number>(),
    other = new Map<string, number>(); // Part V by account name
  const add = (line: string, account: string, amount: number) => {
    if (!amount) return;
    amounts.set(line, (amounts.get(line) ?? 0) + amount);
    sources.push({ line, account, amount });
  };

  // income
  let receipts = 0,
    returns = rd(inp.returns ?? 0),
    otherIncome = 0,
    uncategorized = 0;
  for (const t of i.txns) {
    const g = groupOf(t.category);
    if (g === "revenue") {
      if (t.amount >= 0) receipts += t.amount;
      else returns += -t.amount; // a refund to a customer
    } else if (g === "other-income") otherIncome += t.amount;
    else if (g === "ask") uncategorized++;
  }
  if (uncategorized) warnings.push({ k: "uncategorized", v: uncategorized });

  // expenses: the engine's deductible share of each outflow; refunds (inflows on expense accounts) reduce the line
  const vehicle = inp.vehicle;
  let vehicleLedger = 0,
    disallowed = 0,
    cogs = 0,
    bigEquipment = 0;
  const eng = new Map(i.deductions.map((r) => [r.id, r]));
  for (const r of i.deductions) {
    disallowed += r.gross - r.deductible;
    const name = nameOf(r.category),
      g = groupOf(r.category);
    if (g === "cogs" && inv) {
      cogs += r.deductible;
      continue;
    }
    let line = r.rule?.startsWith("us.meals") ? "24b" : (LINE_OF[name] ?? null);
    if (name === "equipment") {
      if (r.gross <= i.fed.deMinimis) line = "22"; // de minimis safe harbor election, Reg. 1.263(a)-1(f)
      else {
        line = "13";
        bigEquipment += r.deductible;
      }
    }
    if (line === "9" && vehicle?.method === "standard") {
      vehicleLedger += r.deductible; // replaced by the mileage rate
      continue;
    }
    if (!r.deductible) continue;
    if (line) add(line, r.category, r.deductible);
    else other.set(name, (other.get(name) ?? 0) + r.deductible);
  }
  for (const t of i.txns) {
    const g = groupOf(t.category);
    if (t.amount <= 0 || (g !== "expense" && g !== "cogs") || eng.has(t.id)) continue;
    const name = nameOf(t.category);
    if (g === "cogs" && inv) cogs -= t.amount;
    else if (LINE_OF[name]) add(LINE_OF[name]!, t.category, -t.amount);
    else other.set(name, (other.get(name) ?? 0) - t.amount);
  }
  if (bigEquipment) warnings.push({ k: "equipment179", v: rd(bigEquipment) });

  // vehicle: standard mileage by trip date
  let veh: SchedCResult["vehicle"] = null;
  if (vehicle) {
    const m = vehicle.method === "standard" ? mileageDeduction(i.fed, vehicle.trips ?? []) : { miles: 0, amount: 0, bands: [] };
    const biz = vehicle.method === "standard" ? m.miles : (vehicle.trips ?? []).reduce((a, t) => a + (t.miles > 0 ? t.miles : 0), 0);
    if (vehicle.method === "standard") {
      add("9", "mileage", m.amount);
      add("9", "parking and tolls", rd(vehicle.parkingTolls ?? 0));
      if (vehicleLedger) warnings.push({ k: "vehicleLedgerIgnored", v: rd(vehicleLedger) });
      if (!(vehicle.trips ?? []).length) warnings.push({ k: "noTrips" });
    }
    const commuting = vehicle.commutingMiles ?? 0,
      total = vehicle.totalMiles ?? 0;
    veh = {
      method: vehicle.method,
      businessMiles: Math.round(biz),
      commutingMiles: Math.round(commuting),
      otherMiles: total > 0 ? Math.max(0, Math.round(total - biz - commuting)) : 0,
      placedInService: vehicle.placedInService,
      deduction: vehicle.method === "standard" ? m.amount + rd(vehicle.parkingTolls ?? 0) : rd(amounts.get("9") ?? 0),
      bands: m.bands,
    };
  }

  // Part V: whole dollars, nine rows max
  let partV = [...other]
    .map(([n, a]) => ({ label: human(n), amount: rd(a) }))
    .filter((x) => x.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
  if (partV.length > 9) {
    const rest = partV.slice(8);
    partV = [...partV.slice(0, 8), { label: `Other expenses (${rest.length} items)`, amount: rest.reduce((s, x) => s + x.amount, 0) }];
  }
  for (const p of partV) sources.push({ line: "27b", account: p.label, amount: p.amount });

  const lines: Record<string, number> = {};
  for (const [l, a] of amounts) if (rd(a)) lines[l] = rd(a);
  if (partV.length) lines["27b"] = partV.reduce((s, x) => s + x.amount, 0);

  // income lines
  const l1 = rd(receipts),
    l2 = rd(returns),
    l3 = l1 - l2;
  let partIII: Record<string, number> | null = null,
    l4 = 0;
  if (inv) {
    const begin = rd(inv.begin ?? 0),
      end = rd(inv.end ?? 0),
      purchases = rd(cogs),
      l40 = begin + purchases;
    l4 = l40 - end;
    partIII = { "35": begin, "36": purchases, "37": 0, "38": 0, "39": 0, "40": l40, "41": end, "42": l4 };
  }
  const l5 = l3 - l4,
    l6 = rd(otherIncome),
    l7 = l5 + l6;
  const l28 = EXPENSE_LINES.reduce((s, l) => s + (lines[l] ?? 0), 0),
    l29 = l7 - l28;

  // home office, simplified method: $5 × sq ft (max 300), never more than the tentative profit
  let home: SchedCResult["homeOffice"] = null;
  let l30 = 0;
  const hs = Math.max(0, inp.homeSqft ?? 0);
  if (hs > 0) {
    const sq = Math.min(hs, i.fed.homeOfficeSimplified.maxSqft),
      full = rd(sq * i.fed.homeOfficeSimplified.perSqft);
    l30 = Math.min(full, Math.max(0, l29));
    home = { sqft: sq, deduction: l30, limited: l30 < full };
    if (hs > sq) warnings.push({ k: "homeOver300", v: hs });
    sources.push({ line: "30", account: "home office", amount: l30 });
  }
  const l31 = l29 - l30;

  const out: Record<string, number> = { "1": l1 };
  if (l2) out["2"] = l2;
  Object.assign(out, { "3": l3 });
  if (inv) out["4"] = l4;
  Object.assign(out, { "5": l5 });
  if (l6) out["6"] = l6;
  Object.assign(out, { "7": l7 });
  for (const l of EXPENSE_LINES) if (lines[l]) out[l] = lines[l]!;
  Object.assign(out, { "28": l28, "29": l29 });
  if (l30) out["30"] = l30;
  out["31"] = l31;

  if (!l1 && !l6) warnings.push({ k: "noIncome" });
  if (l31 < 0) warnings.push({ k: "loss", v: -l31 });
  sources.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return { year: i.year, lines: out, sources, partV, partIII, vehicle: veh, homeOffice: home, netProfit: l31, warnings, disallowed: rd(disallowed) };
}
