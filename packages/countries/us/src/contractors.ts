// Form 1099-NEC: who to send one to, from the vendors, bills and ledger. Reportable = payments for services to a non-corporate US payee
// totalling the threshold or more in the calendar year ($600 up to 2025, $2,000 for payments after 2025: OBBBA §70433), paid by cash,
// check, ACH or wire. Payments by credit/debit card or through a third-party network (PayPal, Venmo, Stripe, Square…) are reported by the
// payment settlement entity on Form 1099-K and are NOT put on a 1099-NEC (Instructions for Forms 1099-MISC and 1099-NEC, "Form 1099-K").
// Payments to corporations are exempt except legal services; a payee with no TIN on file is subject to backup withholding (Pub. 1099 part N).
// IRS e-filing (IRIS) needs an IRS-issued template that is only available inside the IRIS Taxpayer Portal, so this produces a plain CSV for
// the user's e-file provider or for typing into IRIS, and the filled recipient copy (Copy B) of the form.
import { ascii } from "./irs.ts";

export type TinType = "ssn" | "ein";
export interface Vendor1099 {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  tin?: string;
  tinType?: TinType;
  /** Form W-9 on file (true, or the date received). */
  w9?: boolean | string;
  /** individual (default: sole proprietor / LLC owned by a person), corporation (incl. LLC taxed as one), foreign (W-8BEN: no 1099). */
  payee?: "individual" | "corporation" | "foreign";
  /** Never issue a 1099 to this vendor (a reason the user knows, e.g. a government agency). */
  exempt?: boolean;
  email?: string;
  /** Default ledger account of the vendor, used for bill lines without one. */
  account?: string;
}
export interface BillLike {
  id: string;
  vendor: string | null;
  status: string;
  lines: readonly { amount: number | string; account: string }[];
  payments: readonly { id: string; txn: string | null; amount: number; date: string }[];
}
export interface TxnLike {
  id: string;
  date: string;
  amount: number;
  desc: string;
  memo?: string;
  account: string;
  source?: string;
  kind?: string;
  category: string;
}
export interface Payer {
  name?: string;
  tin?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
}

/** Ledger accounts (the part after "type:") whose outflows are payments for services. */
export const NEC_ACCOUNTS: ReadonlySet<string> = new Set(["contractors", "contract-labor", "professional", "legal", "accounting", "consulting", "freelance"]);
const LEGAL = new Set(["legal"]);
const nameOf = (a: string) => a.slice(a.indexOf(":") + 1);
const reportable = (account: string) => (account.startsWith("expense:") || account.startsWith("cogs:")) && NEC_ACCOUNTS.has(nameOf(account));
const NETWORK = /\b(paypal|venmo|cash ?app|stripe|square|zelle pay?)\b/i;
const CARD_KIND = /card/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const r2 = (n: number) => Math.round(n * 100) / 100;

export type Via = "bank" | "card" | "network" | "unknown";
/** How a payment left the account: a card or a payment network means Form 1099-K reports it, not you. */
export function viaOf(t: Pick<TxnLike, "account" | "desc" | "memo" | "kind"> | undefined): Via {
  if (!t) return "unknown";
  if (/credit|card/i.test(t.account) || (t.kind && CARD_KIND.test(t.kind))) return "card";
  if (NETWORK.test(`${t.account} ${t.desc} ${t.memo ?? ""}`)) return "network";
  return "bank";
}

export interface Payment1099 {
  date: string;
  amount: number;
  txn: string | null;
  via: Via;
  from: "bill" | "ledger";
  desc: string;
  /** For legal services: even a corporation gets a 1099-NEC. */
  legal: boolean;
}
export type Status1099 = "ready" | "below" | "missing" | "corporation" | "foreign" | "exempt" | "none";
export interface Row1099 {
  vendor: Vendor1099 | null;
  name: string;
  /** Reportable payments of the year (bank / check / unknown): Box 1a. */
  total: number;
  /** Paid by card or through a payment network: on the payee's 1099-K, not here. */
  excluded: number;
  payments: Payment1099[];
  status: Status1099;
  /** Codes the UI translates: noTin, noAddress, noW9, unknownMethod, notVendor, backupWithholding. */
  issues: string[];
  /** A 1099-NEC is due for this payee (reportable total at or over the threshold, not exempt). */
  file: boolean;
}

export function splitCityStateZip(s: string | undefined) {
  const m = /^\s*(.+?),?\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/.exec(s ?? "");
  return m ? { city: m[1]!, state: m[2]!.toUpperCase(), zip: m[3]! } : { city: (s ?? "").trim(), state: "", zip: "" };
}

export function prepare1099s(i: {
  year: number;
  threshold: number;
  vendors: readonly Vendor1099[];
  bills: readonly BillLike[];
  txns: readonly TxnLike[];
}): Row1099[] {
  const byTxn = new Map(i.txns.map((t) => [t.id, t])),
    rows = new Map<string, Row1099>(),
    taken = new Map<string, number>(); // txn id → amount applied to bills
  const row = (v: Vendor1099 | null, name: string) => {
    const key = v ? `v:${v.id}` : `n:${norm(name)}`;
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { vendor: v, name: v?.name ?? name, total: 0, excluded: 0, payments: [], status: "none", issues: [], file: false }));
    return r;
  };
  const book = (r: Row1099, p: Payment1099) => {
    r.payments.push(p);
    if (p.via === "card" || p.via === "network") r.excluded = r2(r.excluded + p.amount);
    else r.total = r2(r.total + p.amount);
  };
  const vendorById = new Map(i.vendors.map((v) => [v.id, v]));
  const year = String(i.year);

  // 1. bills: payments applied to a bill, the share of its lines that are payments for services
  for (const b of i.bills) {
    for (const p of b.payments) if (p.txn) taken.set(p.txn, r2((taken.get(p.txn) ?? 0) + p.amount));
    const v = b.vendor ? vendorById.get(b.vendor) : undefined;
    if (!v || b.status === "cancelled" || b.status === "draft") continue;
    const tot = b.lines.reduce((s, l) => s + (+l.amount || 0), 0);
    if (!tot) continue;
    const share = b.lines.filter((l) => reportable(l.account || v.account || "")).reduce((s, l) => s + (+l.amount || 0), 0) / tot;
    if (!share) continue;
    const legal = b.lines.some((l) => LEGAL.has(nameOf(l.account || v.account || "")));
    for (const p of b.payments) {
      if (!p.date.startsWith(year)) continue;
      const t = p.txn ? byTxn.get(p.txn) : undefined;
      book(row(v, v.name), { date: p.date, amount: r2(p.amount * share), txn: p.txn, via: viaOf(t), from: "bill", desc: t?.desc ?? "", legal });
    }
  }
  // 2. ledger: contractor-type outflows not applied to a bill, matched to a vendor by name
  const named = i.vendors.map((v) => ({ v, n: norm(v.name) })).filter((x) => x.n.length >= 3);
  for (const t of i.txns) {
    if (t.amount >= 0 || !t.date.startsWith(year) || !reportable(t.category)) continue;
    const left = r2(-t.amount - (taken.get(t.id) ?? 0));
    if (left <= 0.004) continue;
    const hay = norm(`${t.desc} ${t.memo ?? ""}`),
      hit = named.filter((x) => hay.includes(x.n)).sort((a, b) => b.n.length - a.n.length)[0];
    const r = hit ? row(hit.v, hit.v.name) : row(null, t.desc);
    book(r, { date: t.date, amount: left, txn: t.id, via: viaOf(t), from: "ledger", desc: t.desc, legal: LEGAL.has(nameOf(t.category)) });
  }

  for (const r of rows.values()) {
    const v = r.vendor,
      iss = r.issues;
    r.payments.sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!v) iss.push("notVendor");
    if (v?.exempt) r.status = "exempt";
    else if (v?.payee === "foreign") r.status = "foreign";
    else if (v?.payee === "corporation" && !r.payments.some((p) => p.legal)) r.status = "corporation";
    else if (r.total >= i.threshold) r.status = "ready";
    else r.status = "below";
    if (r.status === "ready") {
      r.file = true;
      if (!v?.tin) iss.push("noTin", "backupWithholding");
      if (!v?.address || !(v.city || /\d{5}/.test(v.address))) iss.push("noAddress");
      if (!v?.w9) iss.push("noW9");
      if (r.payments.some((p) => p.via === "unknown")) iss.push("unknownMethod");
      if (!v?.tin || !v?.address) r.status = "missing"; // still to file: the details are what is missing
    }
  }
  return [...rows.values()].filter((r) => r.total > 0 || r.excluded > 0).sort((a, b) => b.total - a.total);
}

const csv = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** One line per payee to file: the data a 1099-NEC needs, in the order of the form's boxes. For an e-file provider or for typing into IRIS. */
export function csv1099(rows: readonly Row1099[], payer: Payer, year: number): string {
  const head = [
    "Tax year",
    "Form",
    "Payer name",
    "Payer TIN",
    "Payer address",
    "Payer city",
    "Payer state",
    "Payer ZIP",
    "Payer phone",
    "Recipient name",
    "Recipient TIN type",
    "Recipient TIN",
    "Recipient address",
    "Recipient city",
    "Recipient state",
    "Recipient ZIP",
    "Recipient country",
    "Account number",
    "Box 1a Nonemployee compensation",
    "Box 4 Federal income tax withheld",
    "Box 5 State tax withheld",
    "Box 6 State/Payer's state no.",
    "Box 7 State income",
  ];
  const out = [head.map(csv).join(",")];
  for (const r of rows.filter((x) => x.file)) {
    const v = r.vendor,
      a = v?.city ? { city: v.city, state: v.state ?? "", zip: v.zip ?? "" } : splitCityStateZip(v?.address?.includes(",") ? v.address.slice(v.address.indexOf(",") + 1) : "");
    out.push(
      [
        year,
        "1099-NEC",
        payer.name,
        payer.tin,
        payer.address,
        payer.city,
        payer.state,
        payer.zip,
        payer.phone,
        r.name,
        v?.tinType ?? "",
        v?.tin ?? "",
        v?.address?.split(",")[0] ?? "",
        a.city,
        a.state,
        a.zip,
        v?.country ?? "US",
        "",
        r.total.toFixed(2),
        "",
        "",
        "",
        "",
      ]
        .map(csv)
        .join(","),
    );
  }
  return out.join("\n") + "\n";
}

/** Box values for one recipient's 1099-NEC (a plain data object for the PDF field map). */
export function nec1099(r: Row1099, payer: Payer, year: number) {
  const v = r.vendor!,
    a = v.city ? { city: v.city, state: v.state ?? "", zip: v.zip ?? "" } : splitCityStateZip(v.address?.includes(",") ? v.address.slice(v.address.indexOf(",") + 1) : "");
  return {
    year,
    payer: { ...payer, name: ascii(payer.name) },
    recipient: { name: v.name, tin: v.tin ?? "", street: (v.address ?? "").split(",")[0]!.trim(), city: a.city, state: a.state, zip: a.zip, country: v.country ?? "" },
    box1a: Math.round(r.total * 100) / 100,
  };
}
export type Nec = ReturnType<typeof nec1099>;
