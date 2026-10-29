// The US tax inputs the TaxUS and Planner pages share, read from the open books for tax year y (owner money, year-end assets,
// the C-corp's P&L for its 1120). The maths is the US pack's (irs.ts); this only gathers the numbers.
import { group, isCard, migrateBill, pl } from "@openbooks/core";
import {
  splitCityStateZip,
  untreatedMealsHalf,
  usReturn,
  usOwned,
  usTrack,
  type CorpInput,
  type IrsInput,
  type Payer,
  type UsDeadlineFacts,
  type UsInputs,
  type UsReturn,
  type UsTable,
  type Vendor1099,
} from "@openbooks/country-us";
import { balances, bizType, doc, S, saveDoc, taxTable, yearTxns } from "../stores/books.svelte.ts";
import { disallowed, result } from "../taxtags.svelte.ts";

export const isCorp = (y = S.year) => bizType(y) === "llc-ccorp";
/** Transactions with the owner (equity:*): contributions > 0, distributions < 0. */
export const ownerTxns = (y = S.year) => yearTxns(y).filter((t) => group(t.category) === "equity");
/** Bank balances (not cards) at the end of the year: 5472 line 1c / 1120 item D. */
export const totalAssets = (y = S.year) =>
  Object.entries(balances(`${y}-12-31`))
    .filter(([a]) => !isCard(a))
    .reduce((s, [, v]) => s + v, 0);

export function irsInput(y = S.year): IrsInput {
  return {
    year: y,
    ...S.data?.profile,
    totalAssets: totalAssets(y),
    transactions: ownerTxns(y).map((t) => ({ date: t.date, desc: t.memo ? `${t.desc} · ${t.memo}` : t.desc, amount: t.amount })),
  };
}

export function corpInput(y = S.year): CorpInput {
  const P = pl(yearTxns(y)),
    advertising = -(P.lines.expense.find((l) => l.key === "expense:advertising")?.value ?? 0);
  return {
    ...irsInput(y),
    revenue: P.revenue,
    cogs: P.cogs,
    advertising,
    otherDeductions: Math.max(0, P.opex - advertising - disallowed(y) - untreatedMealsHalf(result(y)?.rows ?? [])), // what the US deduction rules disallow (meals 50%, entertainment 0%…) comes off
    otherIncome: P.other,
    corpRate: taxTable(y, "us").corpRate ?? 0.21,
  };
}

// ---------- individual / pass-through / contractor side (Schedule C, SE, 1040-ES, K-1, 1099-NEC) ----------
// The year's owner inputs live in the books doc "taxus" ({ [year]: UsInputs }): what the ledger cannot know (filing status, W-2 wages, trips…).
export const track = (y = S.year) => usTrack(bizType(y));
export const usInputs = (y = S.year): UsInputs => doc<Record<string, UsInputs>>("taxus", {})[y] ?? {};
/** Merge into the year's inputs; `schedC` merges one level deeper so a single field edit keeps the trips. */
export function saveUsInputs(y: number, patch: Partial<UsInputs>) {
  const all = $state.snapshot(doc<Record<string, UsInputs>>("taxus", {})) as Record<string, UsInputs>,
    cur = all[y] ?? {},
    next: UsInputs = { ...cur, ...patch, ...(patch.schedC ? { schedC: { ...cur.schedC, ...patch.schedC } } : {}) };
  for (const k of Object.keys(next) as (keyof UsInputs)[]) if (next[k] === undefined) delete next[k];
  return saveDoc("taxus", { ...all, [y]: next });
}

// ---------- the saved facts the deadlines read (doc "profile": the same ones the filled forms use) ----------
type Facts = Record<string, string | number | boolean | undefined>;
const profile = () => (S.data?.profile ?? {}) as Facts;
/** The legal form for the Delaware fee: an LLC (also an LLC taxed as a corporation) or a corporation. Saved as profile.entityForm; else from the business type. */
export const entityForm = (type: string): "llc" | "corporation" => {
  const f = profile().entityForm;
  return f === "llc" || f === "corporation" ? f : type === "llc-ccorp" ? "llc" : "corporation";
};
/** A C-corp's owner is foreign (it then attaches Form 5472): profile.foreignOwned when set, else the owner's country not being the US. */
export const foreignOwned = (type: string): boolean => {
  const p = profile();
  return typeof p.foreignOwned === "boolean" ? p.foreignOwned : usTrack(type) === "c-corp" && !usOwned(String(p.ownerCountry ?? ""));
};
/** Everything the US pack's deadlines() reads for a business type, from the saved profile. One place for the tax page and the filings hub. */
export function usFacts(type: string): UsDeadlineFacts {
  const p = profile();
  return {
    businessType: type,
    state: String(p.state ?? ""),
    formed: String(p.formed ?? ""),
    foreignAccountsOver10k: p.foreignAccounts === true,
    entityForm: entityForm(type),
    foreignOwned: foreignOwned(type),
  };
}

/** The flat state income tax rate in percent the owner entered with the filing settings (profile.stateRate); older books kept it per year with the other inputs. */
export const stateRate = (y = S.year): number | undefined => {
  const r = profile().stateRate;
  return typeof r === "number" ? r : usInputs(y).stateRate;
};
/** The state the owner pays income tax to, as typed (shown in the estimate's labels). */
export const stateName = () => String(profile().stateName ?? "").trim();

/** The whole US return for year y from the open books: one run feeds the page, the PDFs and (same maths) the MCP tools. */
export function usNow(y = S.year): UsReturn {
  const r = result(y);
  return usReturn({
    year: y,
    type: bizType(y) ?? "",
    table: taxTable(y, "us") as unknown as UsTable,
    nextTable: taxTable(y + 1, "us") as unknown as UsTable,
    txns: yearTxns(y) as never,
    deductions: (r?.rows ?? []).map((x) => ({ id: x.id, category: x.category, gross: x.gross, deductible: x.deductible, rule: x.rule })),
    nonDeductible: r?.totals.nonDeductible ?? 0,
    inputs: { ...usInputs(y), stateRate: stateRate(y) },
    vendors: doc<Vendor1099[]>("vendors"),
    bills: doc<unknown[]>("bills").map((b) => migrateBill(b as never)) as never, // the same migration routes/bills/bills.ts readBills does
  });
}

/** The payer block of a 1099-NEC: the business itself. */
export function payerOf(y = S.year): Payer {
  const p = (S.data?.profile ?? {}) as Record<string, string | undefined>,
    csz = splitCityStateZip(p.cityStateZip),
    ein = !!p.ein;
  return { name: p.legalName || p.taxpayerName, tin: ein ? p.ein : p.ssn, tinType: ein ? "ein" : "ssn", address: p.address, ...csz, phone: p.phone };
}

/** A number typed into an input (commas, $ and spaces tolerated); blank = undefined so the field clears. */
export const numOf = (e: Event) => {
  const v = (e.currentTarget as HTMLInputElement).value.replace(/[,$\s]/g, "");
  return v === "" || Number.isNaN(Number(v)) ? undefined : Number(v);
};
export const textOf = (e: Event) => (e.currentTarget as HTMLInputElement).value.trim();

/** The sidebar / command bar label of the US tax page for the open business. */
export const navKey = (y = S.year) =>
  ({ individual: "nav.taxIndividual", "foreign-owned": "nav.form5472", "c-corp": "nav.form5472", partnership: "nav.taxPartnership", "s-corp": "nav.taxScorp" })[
    track(y)
  ];
