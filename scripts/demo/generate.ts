// Generates examples/showcase: two made-up businesses with ~21 months of books whose numbers add up.
// Every invoice/receipt total is its lines' qty × price, every paid one has a deposit of exactly that amount,
// and account balances are the sum of their transactions. Seeded, so the output never changes.
// bun scripts/demo/generate.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dir, "../../examples/showcase");
let seed = 20250101;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
const between = (a: number, b: number) => a + rnd() * (b - a);
const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, 28)).padStart(2, "0")}`;
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const MONTHS: [number, number][] = [];
for (let y = 2025, m = 1; y < 2026 || m <= 9; m === 12 ? ((m = 1), y++) : m++) MONTHS.push([y, m]);
const write = (p: string, v: unknown) => {
  mkdirSync(join(OUT, p, ".."), { recursive: true });
  writeFileSync(join(OUT, p), typeof v === "string" ? v : JSON.stringify(v, null, 1) + "\n");
};
rmSync(OUT, { recursive: true, force: true });

// ---------- Acme Audio LLC: US single-member LLC selling audio plugins and mixing services (USD, Mercury) ----------
{
  type T = {
    id: string;
    accountId: string;
    amount: number;
    postedAt: string;
    createdAt: string;
    counterpartyName: string;
    bankDescription?: string;
    mercuryCategory?: string;
    note?: string;
    kind: string;
    status: string;
  };
  const txns: T[] = [];
  let n = 0;
  const tx = (acc: "chk" | "cc", date: string, amount: number, who: string, kind: string, extra: Partial<T> = {}) =>
    txns.push({
      id: `t-${String(++n).padStart(4, "0")}`,
      accountId: `acc-${acc}`,
      amount: r2(amount),
      postedAt: `${date}T15:00:00Z`,
      createdAt: `${date}T09:00:00Z`,
      counterpartyName: who,
      kind,
      status: "sent",
      ...extra,
    });

  const customers = [
    { id: "c-north", name: "Northbound Records", email: "ap@northbound.example", address: "220 W 29th St, New York, NY 10001" },
    { id: "c-lumen", name: "Lumen Studios", email: "billing@lumen.example", address: "1400 Sunset Blvd, Los Angeles, CA 90028" },
    { id: "c-kite", name: "Kite & Key Media", email: "finance@kitekey.example", address: "88 Market St, San Francisco, CA 94105" },
    { id: "c-ruth", name: "Ruth Alvarez", email: "ruth@alvarez.example" },
  ];
  const work = [
    { desc: "Mix — per song", price: 350 },
    { desc: "Master — per song", price: 90 },
    { desc: "Stem mastering — per song", price: 140 },
    { desc: "Sound design — per day", price: 600 },
    { desc: "Revision round", price: 75 },
  ];
  const invoices: any[] = [];
  tx("chk", "2025-01-02", 5000, "", "internalTransfer", { bankDescription: "Owner contribution — OWNER" });
  for (const [y, m] of MONTHS) {
    // plugin sales: Stripe pays out weekly
    for (const d of [3, 10, 17, 24])
      tx("chk", iso(y, m, d), between(260, 720) * (1 + (y - 2025) * 0.35), "Stripe", "externalTransfer", {
        bankDescription: "STRIPE TRANSFER",
        mercuryCategory: "Income",
      });
    tx("chk", iso(y, m, 12), between(140, 420), "DistroKid", "externalTransfer", { bankDescription: "DISTROKID ROYALTIES" });
    tx("chk", iso(y, m, 6), between(300, 520), "Patreon", "externalTransfer", { bankDescription: "PATREON PAYOUT" });
    // client work: 1–2 invoices a month, paid 10–35 days later (the last ones still open)
    for (let k = 0, kn = y > 2025 ? 2 + Math.floor(rnd() * 2) : rnd() < 0.5 ? 1 : 2; k < kn; k++) {
      const issued = iso(y, m, 2 + Math.floor(rnd() * 20));
      const items = [...new Set([pick(work), pick(work)])].map((w) => ({
        desc: w.desc,
        qty: w.desc.includes("day") ? 1 + Math.floor(rnd() * 3) : 2 + Math.floor(rnd() * 9),
        price: w.price,
      }));
      const total = items.reduce((a, i) => a + i.qty * i.price, 0);
      const c = pick(customers);
      const number = `INV-${String(invoices.length + 1).padStart(4, "0")}`;
      const paidDate = addDays(issued, 10 + Math.floor(rnd() * 25));
      const paid = paidDate < "2026-09-20";
      if (paid) tx("chk", paidDate, total, c.name, "externalTransfer", { bankDescription: `ACH CREDIT ${c.name.toUpperCase()} ${number}` });
      invoices.push({
        id: `inv-${invoices.length + 1}`,
        kind: "invoice",
        number,
        customer: c.id,
        items,
        issued,
        due: addDays(issued, 30),
        currency: "USD",
        status: paid ? "paid" : "open",
        paidTxn: null,
        paidDate: paid ? paidDate : null,
        ref: null,
        created: issued,
      });
    }
    // costs on the Mercury credit card
    tx("cc", iso(y, m, 1), -20, "OpenAI", "creditCardTransaction", { mercuryCategory: "Software" });
    tx("cc", iso(y, m, 2), -between(38, 160), "Anthropic", "creditCardTransaction", { mercuryCategory: "Software" });
    tx("cc", iso(y, m, 4), -between(64, 140), "Amazon Web Services", "creditCardTransaction", { mercuryCategory: "Software" });
    tx("cc", iso(y, m, 5), -12.99, "Splice", "creditCardTransaction", { mercuryCategory: "Software", note: "samples" });
    tx("cc", iso(y, m, 7), -59.99, "Adobe", "creditCardTransaction", { mercuryCategory: "Software" });
    tx("cc", iso(y, m, 9), -between(180, 650), "Meta Ads", "creditCardTransaction", { mercuryCategory: "Advertising" });
    tx("cc", iso(y, m, 15), -29, "Shopify", "creditCardTransaction", { mercuryCategory: "Software" });
    if (m % 4 === 2)
      tx("cc", iso(y, m, 18), -between(240, 1400), pick(["Sweetwater", "B&H Photo", "Thomann"]), "creditCardTransaction", { mercuryCategory: "Equipment" });
    if (m % 5 === 0)
      tx("cc", iso(y, m, 21), -between(320, 900), pick(["Delta Air Lines", "United Airlines"]), "creditCardTransaction", { mercuryCategory: "Travel" });
    // pay the card in full each month, owner draws quarterly
    const ccBal = txns.filter((t) => t.accountId === "acc-cc").reduce((a, t) => a + t.amount, 0);
    if (ccBal < 0) {
      tx("chk", iso(y, m, 27), ccBal, "Mercury Credit", "internalTransfer", { bankDescription: "Payment to Mercury Credit" });
      tx("cc", iso(y, m, 27), -ccBal, "Mercury Checking", "internalTransfer", { bankDescription: "Payment from Mercury Checking" });
    }
    if (m % 3 === 0) tx("chk", iso(y, m, 28), -6500, "", "internalTransfer", { bankDescription: "Owner draw — Transfer to OWNER" });
    if (m === 3) tx("chk", iso(y, m, 14), -300, "Harbor Compliance", "externalTransfer", { bankDescription: "DE REGISTERED AGENT" });
    if (m === 4) tx("chk", iso(y, m, 20), -1250, "Pine & Co CPA", "externalTransfer", { bankDescription: "TAX PREP 5472/1120" });
  }
  invoices.push({
    id: "inv-draft",
    kind: "invoice",
    number: null,
    customer: "c-lumen",
    items: [
      { desc: "Mix — per song", qty: 6, price: 350 },
      { desc: "Master — per song", qty: 6, price: 90 },
    ],
    issued: "2026-09-29",
    due: "2026-10-29",
    currency: "USD",
    status: "draft",
    paidTxn: null,
    paidDate: null,
    ref: null,
    created: "2026-09-29",
  });
  const bal = (a: string) => r2(txns.filter((t) => t.accountId === a).reduce((s, t) => s + t.amount, 0));
  write("acme/entity.json", { name: "Acme Audio LLC", short: "Acme Audio", kind: "us-llc", currency: "USD", flag: "🇺🇸" });
  write("acme/inbox/mercury-api.json", {
    accounts: [
      { id: "acc-chk", name: "Mercury Checking ••4021", currentBalance: bal("acc-chk") },
      { id: "acc-cc", name: "Mercury Credit ••7710", currentBalance: bal("acc-cc") },
    ],
    transactions: txns,
  });
  write(
    "acme/rules.csv",
    `# text in the description / bank memo / [Mercury category] → ledger account. First match wins.
Payment to Mercury Credit,transfer:internal
Payment from Mercury Checking,transfer:internal
OWNER,equity:owner
ACH CREDIT,revenue:services
DistroKid,revenue:music-royalties
Stripe,revenue:plugin-sales
Patreon,revenue:patreon
Shopify,cogs:platform-fees
Amazon Web Services,cogs:hosting
OpenAI,cogs:ai-models
Anthropic,cogs:ai-models
Splice,expense:software
Adobe,expense:software
Meta Ads,expense:advertising
[Equipment],expense:equipment
[Travel],expense:travel
REGISTERED AGENT,expense:professional
CPA,expense:professional
`,
  );
  write("acme/data/invoices.json", invoices);
  write("acme/data/customers.json", customers);
  write("acme/data/profile.json", {
    legalName: "Acme Audio LLC",
    ein: "00-0000000",
    state: "WY",
    formed: "2024-11-04",
    address: "30 N Gould St, Ste R",
    cityStateZip: "Sheridan, WY 82801",
    naics: "512250",
    owner: "Noa Cohen",
    ownerAddress: "12 Dizengoff St, Tel Aviv",
    ownerCountry: "Israel",
    ownerTin: "000000018",
    business: "Audio software and sound engineering",
  });
}

// ---------- Noa Cohen, osek zair: Israeli illustrator & music teacher (ILS, Leumi + Max via scrapers, bit) ----------
{
  const bank: any[] = [],
    card: any[] = [],
    bit: string[] = ["Status,Reference,Note,Amount,Type,Direction,Name,Date"];
  let ref = 100;
  const ts = (d: string) => `${addDays(d, -1)}T21:00:00.000Z`; // scrapers give Israel midnight in UTC
  const students = ["דנה לוי", "יוסי בן דוד", "מיכל אברהם", "עומר שפירא", "תמר כץ", "איתי מזרחי", "Sarah Miller"];
  const studios = [
    { id: "s-gal", name: "גלריה תדר", email: "office@teder.example" },
    { id: "s-orot", name: "מתנ״ס אורות", email: "hugim@orot.example" },
    { id: "s-blue", name: "Blue Door Publishing", email: "pay@bluedoor.example" },
  ];
  const docs: any[] = [];
  const num = { bill: 0, receipt: 0 };
  const doc = (
    kind: "bill" | "receipt",
    customer: string,
    items: { desc: string; qty: number; price: number }[],
    issued: string,
    paidDate: string | null,
    refNo: string | null = null,
  ) => {
    const number = String(++num[kind]).padStart(4, "0");
    docs.push({
      id: `${kind}-${num[kind]}`,
      kind,
      number,
      customer,
      items,
      issued,
      due: kind === "bill" ? addDays(issued, 30) : null,
      currency: "ILS",
      status: paidDate ? "paid" : "open",
      paidTxn: null,
      paidDate,
      ref: refNo,
      created: issued,
    });
    return number;
  };
  for (const [y, m] of MONTHS) {
    // private lessons paid by bit, one receipt per payment
    for (let k = 0, kn = 3 + Math.floor(rnd() * 4); k < kn; k++) {
      const d = iso(y, m, 1 + Math.floor(rnd() * 27)),
        who = pick(students),
        lessons = 1 + Math.floor(rnd() * 4),
        amt = lessons * 220;
      bit.push(`Done,B${ref++},שיעור,${amt.toFixed(2)},Transfer,Credit,${who},${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`);
      doc("receipt", who, [{ desc: "שיעור פרטי (60 דק׳)", qty: lessons, price: 220 }], d, d);
    }
    // illustration / workshop gigs by bank transfer: a bill, then a receipt referencing it when paid
    if (rnd() < 0.7) {
      const s = pick(studios),
        issued = iso(y, m, 3 + Math.floor(rnd() * 15));
      const items =
        s.id === "s-blue"
          ? [{ desc: "איור לספר — עמוד", qty: 4 + Math.floor(rnd() * 8), price: 450 }]
          : [
              { desc: "סדנת איור (3 שעות)", qty: 1 + Math.floor(rnd() * 2), price: 1350 },
              { desc: "חומרים למשתתפים", qty: 1, price: 180 },
            ];
      const total = items.reduce((a, i) => a + i.qty * i.price, 0);
      const paidDate = addDays(issued, 12 + Math.floor(rnd() * 30));
      const paid = paidDate < "2026-09-20";
      const billNo = doc("bill", s.id, items, issued, paid ? paidDate : null);
      if (paid) {
        bank.push({ date: ts(paidDate), chargedAmount: total, description: `העברה מ${s.name}`, identifier: 5000 + bank.length, status: "completed" });
        doc("receipt", s.id, items, paidDate, paidDate, billNo);
      }
    }
    // business costs on the Max card, card bill and personal spending from the bank
    const c = (d: number, amt: number, desc: string) =>
      card.push({ date: ts(iso(y, m, d)), chargedAmount: -r2(amt), description: desc, identifier: `mx${card.length}`, status: "completed" });
    c(3, 64.9, "ADOBE CREATIVE CLD");
    c(8, 39, "PROCREATE DREAMS");
    c(11, between(90, 260), pick(["צבעי אקריל — ארט סנטר", "נייר ומכחולים — גולדה"]));
    c(14, 99, "פרטנר — סלולר");
    if (m % 3 === 1) c(19, between(450, 900), "מרחב עבודה — WeWork");
    if (m === 6) c(22, 4890, "iPad Pro — iDigital");
    const bill = card.filter((t) => t.date.startsWith(`${y}-${String(m).padStart(2, "0")}`)).reduce((a, t) => a + t.chargedAmount, 0);
    bank.push({
      date: ts(iso(y, m, 28)),
      chargedAmount: r2(bill),
      description: "מקס איט פיננסים — חיוב כרטיס",
      identifier: 9000 + bank.length,
      status: "completed",
    });
    bank.push({
      date: ts(iso(y, m, 10)),
      chargedAmount: -r2(between(1600, 2400)),
      description: "העברה לחשבון חיסכון",
      identifier: 7000 + bank.length,
      status: "completed",
    });
    bank.push({ date: ts(iso(y, m, 2)), chargedAmount: -5.9, description: "עמלת ערוץ ישיר", identifier: 8000 + bank.length, status: "completed" });
  }
  write("noa/entity.json", { name: "נועה כהן · עוסק זעיר", short: "Osek zair", kind: "il-osek-zair", currency: "ILS", flag: "🇮🇱" });
  write("noa/inbox/leumi-sync.json", { source: "scraper", companyId: "leumi", name: "Leumi", accounts: [{ accountNumber: "000-123456/78", txns: bank }] });
  write("noa/inbox/max-sync.json", { source: "scraper", companyId: "max", name: "Max", accounts: [{ accountNumber: "000041234567", txns: card }] });
  write("noa/inbox/bit-2025-2026.csv", bit.join("\n") + "\n");
  write(
    "noa/rules.csv",
    `# text in the description → ledger account. First match wins.
bit:,business:client
העברה מ,business:client
ADOBE,expense:software
PROCREATE,expense:software
צבעי,expense:equipment
נייר,expense:equipment
iPad,expense:equipment
פרטנר,expense:phone-internet
WeWork,expense:professional
עמלת,expense:bank-fees
מקס איט,transfer:internal
חיסכון,own:savings
`,
  );
  write("noa/data/invoices.json", docs);
  write("noa/data/customers.json", studios);
  write("noa/data/profile.json", { bitName: "Noa Cohen", first: "Noa", last: "Cohen", id: "000000018", discharge: "2023-08-14", serviceMonths: 24 });
}
console.log(`wrote ${OUT}`);
