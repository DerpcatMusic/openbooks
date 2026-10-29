// us_tax_estimate and prepare_1099s on a throwaway sole-proprietor books: Schedule C from the ledger with the meals rule applied once,
// the 1099-NEC list (bank vs card payments, TIN masked), and the foreign-owned LLC that gets neither. In-process, no ports.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Books } from "@openbooks/storage";
import { runTool } from "@openbooks/tools";
import { ManagedRuntime } from "effect";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { defaultLayer } from "./services.ts";

const mercury = (rows: [string, string, number, string, string][]) => ({
  source: "test",
  accounts: [
    { id: "a1", name: "Mercury Checking ••0001", currentBalance: 0 },
    { id: "c1", name: "Mercury Credit", currentBalance: 0 },
  ],
  transactions: rows.map(([acct, date, amount, who, mcat], i) => ({
    id: `t${i}`,
    accountId: acct,
    amount,
    createdAt: `${date}T12:00:00Z`,
    postedAt: `${date}T12:00:00Z`,
    status: "sent",
    counterpartyName: who,
    bankDescription: who,
    note: null,
    externalMemo: null,
    mercuryCategory: mcat,
    kind: "other",
  })),
});
const entity = (home: string, id: string, meta: object, rows: [string, string, number, string, string][], rules: string) => {
  mkdirSync(join(home, id, "inbox"), { recursive: true });
  writeFileSync(join(home, id, "entity.json"), JSON.stringify({ name: id, short: id, currency: "USD", flag: "us", ...meta }));
  writeFileSync(join(home, id, "rules.csv"), rules);
  writeFileSync(join(home, id, "inbox/mercury.json"), JSON.stringify(mercury(rows)));
};

let home = "";
const rt = () => ManagedRuntime.make(defaultLayer({ home, vaultN: 1024 }));
let r: ReturnType<typeof rt>;
const tool = (name: string, args: object) => r.runPromise(runTool(name, args, { entity: undefined, lang: "en", via: "mcp" })) as Promise<Record<string, any>>;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "openbooks-ustools-"));
  const rows: [string, string, number, string, string][] = [
    ["a1", "2026-02-01", 100000, "Client Co", ""],
    ["a1", "2026-03-01", -2000, "Cloud Host", ""],
    ["a1", "2026-03-10", -2500, "Ana Designer", ""],
    ["c1", "2026-04-02", -3000, "Bob Writer", ""],
    ["a1", "2026-05-05", -400, "Cafe Roma", ""],
  ];
  const rules =
    "Client Co,revenue:services\nCloud Host,expense:software\nAna Designer,expense:contractors\nBob Writer,expense:contractors\nCafe Roma,expense:meals\n";
  entity(home, "solo", { types: { "2026": "sole-prop" } }, rows, rules);
  entity(home, "zz-foreign", { types: { "2026": "llc-disregarded" } }, rows, rules);
  r = rt();
  await r.runPromise(
    Books.use((b) =>
      b.putDoc("solo", "vendors", [
        { id: "v1", name: "Ana Designer", address: "1 Main St", city: "Austin", state: "TX", zip: "78701", tin: "123-45-6789", tinType: "ssn", w9: true },
        { id: "v2", name: "Bob Writer" },
      ]),
    ),
  );
});
afterAll(async () => {
  await r.dispose();
  rmSync(home, { recursive: true, force: true });
});

test("us_tax_estimate: Schedule C applies the meals rule once; SE, QBI and estimates follow", async () => {
  const x = await tool("us_tax_estimate", { year: 2026, entity: "solo" });
  expect(x).toMatchObject({ track: "individual", businessType: "sole-prop" });
  expect(x.scheduleC.lines["1"]).toBe(100000);
  expect(x.scheduleC.lines["24b"]).toBe(200); // 50% of 400, not 25%
  expect(x.scheduleC.lines["31"]).toBe(100000 - 2000 - 2500 - 3000 - 200);
  expect(x.summary.netProfit).toBe(x.scheduleC.lines["31"]);
  expect(x.summary.selfEmploymentTax).toBeGreaterThan(0);
  expect(x.estimates.installments).toHaveLength(4);
  expect(x.estimates.installments.reduce((s: number, i: { amount: number }) => s + i.amount, 0)).toBe(x.estimates.total);
  expect(x.nextYearEstimates.installments[0].due).toMatch(/^2027-/);
  expect(x.ownerInputsMissing.length).toBeGreaterThan(0);
});

test("prepare_1099s: bank payment to a saved vendor is ready, card payment is left to the 1099-K, TINs are masked", async () => {
  const x = await tool("prepare_1099s", { year: 2026, entity: "solo" });
  expect(x.threshold).toBe(2000);
  expect(x.dueDate).toBe("2027-02-01"); // Jan 31, 2027 is a Sunday
  const ana = x.payees.find((p: any) => p.name === "Ana Designer"),
    bob = x.payees.find((p: any) => p.name === "Bob Writer");
  expect(ana).toMatchObject({ status: "ready", file: true, total: 2500, tin: "***6789", issues: [] });
  expect(bob).toMatchObject({ file: false, total: 0, excludedCardOrNetwork: 3000 });
  expect(x.toFile).toBe(1);
  expect(x.payerMissing).toEqual(expect.arrayContaining(["tax ID"]));
  expect(JSON.stringify(x)).not.toContain("123-45-6789");
});

test("a foreign-owned LLC gets no income tax estimate and no 1099s", async () => {
  const e = await tool("us_tax_estimate", { year: 2026, entity: "zz-foreign" });
  expect(e).toMatchObject({ track: "foreign-owned", scheduleC: null, estimates: null });
  const n = await tool("prepare_1099s", { year: 2026, entity: "zz-foreign" });
  expect(n.toFile).toBe(0);
  expect(n.note).toContain("foreign-owned");
});
