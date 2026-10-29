import { describe, expect, it } from "vite-plus/test";
import {
  csv1099,
  nec1099,
  passThrough,
  prepare1099s,
  scheduleC,
  us,
  usReturn,
  viaOf,
  type BillLike,
  type DedRow,
  type LedgerRow,
  type TxnLike,
  type Vendor1099,
} from "./index.ts";

const fed = us.table(2026).fed;
const tx = (id: string, date: string, amount: number, category: string, desc = id, extra: Partial<TxnLike> = {}): LedgerRow & TxnLike => ({
  id,
  date,
  amount,
  category,
  desc,
  account: "Mercury Checking",
  ...extra,
});
const ded = (t: LedgerRow, deductible = -t.amount, rule?: string): DedRow => ({
  id: t.id,
  category: t.category,
  gross: -t.amount,
  deductible,
  ...(rule ? { rule } : {}),
});

describe("Schedule C from the ledger and the deduction engine", () => {
  const rows = [
    tx("r1", "2026-02-01", 60000, "revenue:services"),
    tx("r2", "2026-03-01", 40000, "revenue:sales"),
    tx("r3", "2026-03-05", -500, "revenue:sales"), // a refund to a customer: line 2
    tx("o1", "2026-04-01", 120, "other-income:cashback"),
    tx("a1", "2026-02-02", -5000, "expense:advertising"),
    tx("m1", "2026-02-03", -2000, "expense:meals"),
    tx("s1", "2026-02-04", -1200, "expense:software"),
    tx("e1", "2026-02-05", -3000, "expense:equipment"), // over the $2,500 de minimis: line 13
    tx("e2", "2026-02-06", -400, "expense:equipment"), // line 22
    tx("v1", "2026-02-07", -900, "expense:vehicle"),
    tx("c1", "2026-02-08", -8000, "expense:contractors"),
    tx("p1", "2026-02-09", -300, "expense:phone-internet"),
    tx("h1", "2026-02-10", -700, "cogs:hosting"),
    tx("x1", "2026-02-11", 50, "expense:software", "refund"), // a refund lowers the expense
    tx("q", "2026-02-12", -80, "ask"),
  ];
  const deductions = rows
    .filter((t) => t.amount < 0 && /^(expense|cogs):/.test(t.category))
    .map((t) => (t.category === "expense:meals" ? ded(t, 1000, "us.meals") : ded(t)));
  const base = { year: 2026, fed, txns: rows, deductions };

  it("income lines, expense lines and the engine's meals share (not applied twice)", () => {
    const r = scheduleC(base);
    expect(r.lines).toMatchObject({ "1": 100000, "2": 500, "3": 99500, "5": 99500, "6": 120, "7": 99620 });
    expect(r.lines["8"]).toBe(5000);
    expect(r.lines["24b"]).toBe(1000); // 50% from the engine, once
    expect(r.lines["13"]).toBe(3000);
    expect(r.lines["22"]).toBe(400);
    expect(r.lines["9"]).toBe(900); // no vehicle method chosen: the ledger's vehicle account as the engine allows it
    expect(r.lines["11"]).toBe(8000);
    expect(r.lines["25"]).toBe(300);
    expect(r.partV).toEqual(
      [
        { label: "Hosting", amount: 700 },
        { label: "Software", amount: 1150 },
      ].sort((a, b) => b.amount - a.amount),
    );
    expect(r.lines["27b"]).toBe(1850);
    expect(r.lines["28"]).toBe(5000 + 900 + 8000 + 3000 + 300 + 400 + 1000 + 1850 - 0);
    expect(r.netProfit).toBe(r.lines["7"]! - r.lines["28"]!);
    expect(r.disallowed).toBe(1000);
    expect(r.warnings.map((w) => w.k).sort()).toEqual(["equipment179", "uncategorized"]);
  });

  it("standard mileage by trip date replaces the ledger's vehicle costs; parking and tolls are added", () => {
    const r = scheduleC({
      ...base,
      inputs: {
        vehicle: {
          method: "standard",
          trips: [
            { date: "2026-05-01", miles: 1000 },
            { date: "2026-08-01", miles: 1000 },
          ],
          parkingTolls: 40,
          totalMiles: 5000,
          commutingMiles: 1500,
        },
      },
    });
    expect(r.lines["9"]).toBe(725 + 760 + 40);
    expect(r.vehicle).toMatchObject({ businessMiles: 2000, commutingMiles: 1500, otherMiles: 1500, deduction: 1525 });
    expect(r.warnings).toContainEqual({ k: "vehicleLedgerIgnored", v: 900 });
  });

  it("home office, simplified: $5 a square foot to 300, never more than the tentative profit", () => {
    expect(scheduleC({ ...base, inputs: { homeSqft: 200 } }).lines["30"]).toBe(1000);
    const big = scheduleC({ ...base, inputs: { homeSqft: 450 } });
    expect(big.lines["30"]).toBe(1500);
    expect(big.warnings).toContainEqual({ k: "homeOver300", v: 450 });
    const tiny = scheduleC({ year: 2026, fed, txns: [tx("r", "2026-01-01", 400, "revenue:services")], deductions: [], inputs: { homeSqft: 300 } });
    expect(tiny.lines["30"]).toBe(400); // limited to the profit
    expect(tiny.homeOffice?.limited).toBe(true);
    expect(tiny.netProfit).toBe(0);
  });

  it("inventory: cost of revenue goes to Part III", () => {
    const r = scheduleC({ ...base, inputs: { inventory: { on: true, begin: 1000, end: 500 } } });
    expect(r.partIII).toMatchObject({ "35": 1000, "36": 700, "40": 1700, "41": 500, "42": 1200 });
    expect(r.lines["4"]).toBe(1200);
    expect(r.lines["5"]).toBe(99500 - 1200);
  });

  it("a year with only a loss", () => {
    const r = scheduleC({
      year: 2026,
      fed,
      txns: [tx("e", "2026-01-01", -900, "expense:software")],
      deductions: [ded(tx("e", "2026-01-01", -900, "expense:software"))],
    });
    expect(r.netProfit).toBe(-900);
    expect(r.warnings.map((w) => w.k)).toEqual(expect.arrayContaining(["noIncome", "loss"]));
  });

  it("more than nine other-expense kinds roll into the last row", () => {
    const names = "abcdefghijk".split("");
    const ts = names.map((n, k) => tx(`z${k}`, "2026-01-02", -(100 + k), `expense:odd-${n}`));
    const r = scheduleC({ year: 2026, fed, txns: ts, deductions: ts.map((t) => ded(t)) });
    expect(r.partV).toHaveLength(9);
    expect(r.partV.at(-1)!.label).toBe("Other expenses (3 items)");
    expect(r.partV.reduce((s, x) => s + x.amount, 0)).toBe(ts.reduce((s, t) => s - t.amount, 0));
  });
});

describe("1099-NEC preparation", () => {
  const vendors: Vendor1099[] = [
    { id: "a", name: "Ana Designer", tin: "123456789", tinType: "ssn", address: "1 Main St, Austin, TX 78701", w9: true },
    { id: "b", name: "Bo Writer", address: "2 Side St, Reno, NV 89501" },
    { id: "c", name: "Cee Consulting LLC", payee: "corporation", tin: "987654321", address: "3 Elm St, Provo, UT 84601" },
    { id: "d", name: "Dee Law PC", payee: "corporation", tin: "111223333", address: "4 Oak St, Salem, OR 97301" },
    { id: "e", name: "Eli Coder", tin: "222334444", address: "5 Pine St, Boise, ID 83701" },
    { id: "f", name: "Fay Abroad", payee: "foreign" },
  ];
  const txns: TxnLike[] = [
    tx("t1", "2026-03-01", -2500, "expense:contractors", "ACH Ana Designer"),
    tx("t2", "2026-04-01", -1500, "expense:contractors", "Wire Bo Writer"),
    tx("t3", "2026-05-01", -9000, "expense:contractors", "Cee Consulting LLC"),
    tx("t4", "2026-06-01", -5000, "expense:legal", "Dee Law PC retainer"),
    tx("t5", "2026-07-01", -3000, "expense:contractors", "Eli Coder", { account: "Mercury Credit Card" }),
    tx("t6", "2026-08-01", -4000, "expense:contractors", "PAYPAL *FAY ABROAD"),
    tx("t7", "2026-09-01", -2600, "expense:contractors", "Check 114 Gus Newcomer"), // no vendor yet
    tx("t8", "2025-12-30", -9999, "expense:contractors", "Ana Designer"), // last year
    tx("t9", "2026-10-01", -700, "expense:software", "Ana Designer"), // not services
  ];
  const bills: BillLike[] = [
    // Ana's bill paid partly from t1 (2,000) and partly outside the books: no double count of t1
    {
      id: "b1",
      vendor: "a",
      status: "open",
      lines: [{ amount: 3000, account: "expense:contractors" }],
      payments: [
        { id: "p1", txn: "t1", amount: 2000, date: "2026-03-01" },
        { id: "p2", txn: null, amount: 500, date: "2026-03-10" },
      ],
    },
    // a bill of goods: not reportable
    {
      id: "b2",
      vendor: "e",
      status: "open",
      lines: [{ amount: 800, account: "expense:equipment" }],
      payments: [{ id: "p3", txn: null, amount: 800, date: "2026-05-05" }],
    },
  ];
  const rows = prepare1099s({ year: 2026, threshold: 2000, vendors, bills, txns });
  const by = (n: string) => rows.find((r) => r.name === n)!;

  it("threshold, cash vs card, corporations, legal exception", () => {
    expect(by("Ana Designer")).toMatchObject({ total: 3000, status: "ready", file: true }); // 2,000 + 500 through the bill, 500 of t1 left over; the bill's other 500 was paid outside the books
    expect(by("Bo Writer")).toMatchObject({ total: 1500, status: "below", file: false }); // under $2,000
    expect(by("Cee Consulting LLC")).toMatchObject({ status: "corporation", file: false });
    expect(by("Dee Law PC")).toMatchObject({ total: 5000, status: "ready", file: true }); // a corporation, but legal services
    expect(by("Eli Coder")).toMatchObject({ total: 0, excluded: 3000, file: false }); // paid by card: on the payee's 1099-K; the equipment bill is not services
    expect(by("Fay Abroad")).toMatchObject({ excluded: 4000, status: "foreign", file: false }); // PayPal
  });
  it("a payee with no vendor record is listed to be added; a payment is never counted twice", () => {
    const g = rows.find((r) => r.name.includes("Gus"))!;
    expect(g).toMatchObject({ total: 2600, status: "missing", file: true, vendor: null });
    expect(g.issues).toContain("notVendor");
    expect(rows.some((r) => r.payments.some((p) => p.date.startsWith("2025")))).toBe(false);
    const ana = by("Ana Designer");
    expect(ana.payments.filter((p) => p.txn === "t1").reduce((s, p) => s + p.amount, 0)).toBe(2500);
  });
  it("missing TIN or address is flagged with the backup withholding warning", () => {
    const b = prepare1099s({
      year: 2026,
      threshold: 2000,
      vendors: [{ id: "x", name: "No Tin" }],
      bills: [],
      txns: [tx("n", "2026-01-05", -2100, "expense:contractors", "No Tin")],
    })[0]!;
    expect(b.status).toBe("missing");
    expect(b.issues).toEqual(expect.arrayContaining(["noTin", "backupWithholding", "noAddress", "noW9"]));
  });
  it("2025 threshold was $600", () => {
    const r = prepare1099s({ year: 2025, threshold: 600, vendors, bills: [], txns: [tx("o", "2025-05-05", -650, "expense:contractors", "Bo Writer")] });
    expect(r[0]).toMatchObject({ name: "Bo Writer", status: "missing", file: true });
  });
  it("payment method detection", () => {
    expect(viaOf({ account: "Mercury Credit", desc: "x", kind: undefined })).toBe("card");
    expect(viaOf({ account: "Checking", desc: "x", kind: "debitCardTransaction" })).toBe("card");
    expect(viaOf({ account: "Checking", desc: "VENMO PAYMENT" })).toBe("network");
    expect(viaOf({ account: "Checking", desc: "ACH payment" })).toBe("bank");
    expect(viaOf(undefined)).toBe("unknown");
  });
  it("CSV: one line per payee to file, boxes in order", () => {
    const csv = csv1099(rows, { name: "Acme", tin: "12-3456789", address: "9 Biz Rd", city: "Austin", state: "TX", zip: "78701" }, 2026).trim().split("\n");
    expect(csv[0]).toContain("Box 1a Nonemployee compensation");
    expect(csv).toHaveLength(1 + rows.filter((r) => r.file).length);
    expect(
      csv.some((l) => l.startsWith("2026,1099-NEC,Acme,12-3456789,9 Biz Rd,Austin,TX,78701,,Ana Designer,ssn,123456789,1 Main St,Austin,TX,78701,US,,3000.00")),
    ).toBe(true);
    const n = nec1099(by("Ana Designer"), { name: "Acme" }, 2026);
    expect(n.recipient).toMatchObject({ name: "Ana Designer", street: "1 Main St", city: "Austin", state: "TX", zip: "78701" });
  });
});

describe("partnership and S-corporation worksheet", () => {
  const owners = [
    { name: "A", pct: 60, role: "general" as const, guaranteed: 10000 },
    { name: "B", pct: 40, role: "limited" as const },
  ];
  it("allocates ordinary income by percentage and finds each partner's SE earnings", () => {
    const p = passThrough({ type: "partnership", year: 2026, revenue: 200000, cogs: 20000, deductions: 70000, otherIncome: 0, distributions: 50000, owners });
    expect(p.lines).toMatchObject({ grossProfit: 180000, totalIncome: 180000, guaranteedPayments: 10000, ordinary: 100000 });
    expect(p.k1.map((k) => [k.name, k.box1, k.box4, k.box14, k.distribution])).toEqual([
      ["A", 60000, 10000, 70000, 30000],
      ["B", 40000, 0, 0, 20000],
    ]);
    expect(p.warnings).toEqual([]);
  });
  it("warns when the percentages are off; an S-corp has no SE earnings and a reasonable-compensation note", () => {
    const p = passThrough({
      type: "s-corp",
      year: 2026,
      revenue: 100000,
      cogs: 0,
      deductions: 40000,
      otherIncome: 0,
      distributions: 0,
      owners: [
        { name: "A", pct: 50 },
        { name: "B", pct: 30 },
      ],
    });
    expect(p.warnings).toEqual(expect.arrayContaining(["pctNot100", "reasonableComp"]));
    expect(p.k1.every((k) => k.box14 === 0)).toBe(true);
    expect(p.k1[0]!.box1).toBe(30000);
  });
  it("the last owner takes the rounding cent", () => {
    const p = passThrough({
      type: "partnership",
      year: 2026,
      revenue: 100,
      cogs: 0,
      deductions: 0,
      otherIncome: 0,
      distributions: 0,
      owners: [
        { name: "A", pct: 33.33 },
        { name: "B", pct: 33.33 },
        { name: "C", pct: 33.34 },
      ],
    });
    expect(p.k1.reduce((s, k) => s + k.box1, 0)).toBe(100);
  });
});

describe("usReturn by business type", () => {
  const rows = [
    tx("r1", "2026-02-01", 100000, "revenue:services"),
    tx("e1", "2026-02-02", -20000, "expense:software"),
    tx("c1", "2026-02-03", -3000, "expense:contractors", "Ana Designer"),
  ];
  const deductions = rows.filter((t) => t.amount < 0).map((t) => ded(t));
  const base = { year: 2026, table: us.table(2026), txns: rows, deductions, nonDeductible: 0, vendors: [{ id: "a", name: "Ana Designer" }] };
  it("sole proprietor: Schedule C, SE, QBI, estimates this year and next, contractors", () => {
    const r = usReturn({ ...base, type: "sole-prop", inputs: { status: "single", priorTax: 9000, priorAgi: 70000 } });
    expect(r.track).toBe("individual");
    expect(r.schedC!.netProfit).toBe(77000);
    expect(r.personal!.se.line12).toBeGreaterThan(10000);
    expect(r.estimates!.installments).toHaveLength(4);
    expect(r.nextEstimates!.installments[0]!.due).toBe("2027-04-15");
    expect(r.contractors[0]).toMatchObject({ name: "Ana Designer", total: 3000, file: true });
    expect(r.needs1099).toBe(true);
  });
  it("C-corp: 21% and the 1120-W installments; foreign-owned LLC: nothing to compute here", () => {
    const c = usReturn({ ...base, type: "llc-ccorp" });
    expect(c.corp!.tax).toBeCloseTo(16170, 2);
    expect(c.corp!.estimates.installments).toHaveLength(4);
    const f = usReturn({ ...base, type: "llc-disregarded" });
    expect([f.schedC, f.corp, f.contractors, f.notes]).toEqual([null, null, [], ["foreignOwned"]]);
  });
  it("detects the IRS payments in the ledger", () => {
    const r = usReturn({
      ...base,
      type: "sole-prop",
      txns: [...rows, tx("i1", "2026-04-15", -2500, "equity:owner", "USATAXPYMT IRS"), tx("i2", "2026-06-15", -2500, "equity:owner", "EFTPS payment")],
    });
    expect(r.paid).toEqual({ count: 2, total: 5000 });
  });
});
