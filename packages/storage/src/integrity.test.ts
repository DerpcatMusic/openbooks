// Tamper-evidence: issued documents numbered and frozen in the write's transaction, the audit trail committing with each change, and the
// close date holding against ingest, meta, trips, payroll and tags.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { afterAll, expect, test } from "vite-plus/test";
import type { StatementRow } from "@openbooks/schema";
import { Actor, Books, booksLayer, ChangesLive, type Read } from "./index.ts";

const tmps: string[] = [];
afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** inbox/*.json = [{ id, date, amount }]: one row each. */
const read: Read = (file) => {
  const rows = (JSON.parse(new TextDecoder().decode(file.bytes)) as { id: string; date: string; amount: number }[]).map(
    (t): StatementRow => ({ date: t.date, amount: t.amount, desc: t.id, source: "bank", account: "Bank", file: file.name, page: 1, key: t.id }),
  );
  return { rows, checks: [], uidAmount: () => "" }; // the id doesn't move with the amount (like a bank's own transaction id)
};
const home = () => {
  const h = mkdtempSync(join(tmpdir(), "ob-integrity-"));
  tmps.push(h);
  mkdirSync(join(h, "co/inbox"), { recursive: true });
  return h;
};
const statement = (h: string, name: string, rows: { id: string; date: string; amount: number }[]) =>
  writeFileSync(join(h, "co/inbox", name), JSON.stringify(rows));
const run = <A, E>(h: string, eff: Effect.Effect<A, E, Books>) =>
  Effect.runPromise(Effect.provide(eff, booksLayer({ home: h, read }).pipe(Layer.provide(ChangesLive))));
const setup = (h: string) =>
  run(
    h,
    Effect.flatMap(Books, (b) => b.createEntity("co", { name: "Co", currency: "ILS", types: { "2025": "osek-zair" } })),
  );
const auditRows = (h: string) => {
  const db = new Database(join(h, "books.db"));
  try {
    return db.query<{ actor: string; kind: string; target: string; before: string; after: string }, []>("select actor, kind, target, before, after from audit order by rowid").all();
  } finally {
    db.close();
  }
};
const draft = (id: string, issued = "2026-03-01") => ({ id, kind: "receipt", number: null, status: "draft", issued, items: [{ desc: "x", qty: 1, price: 100 }] });
const issued = <T extends object>(d: T) => ({ ...d, status: "paid" });

test("issuing via putDoc: the server numbers, refuses edits/deletes/renumbers/backdates, and a stale tab can't take the same number", async () => {
  const h = home();
  await setup(h);
  const r = await run(
    h,
    Effect.gen(function* () {
      const b = yield* Books;
      yield* b.putDoc("co", "invoices", [draft("a"), draft("b")]);
      // both tabs saw [a, b] as drafts; tab 1 issues a, tab 2 issues b from its stale copy
      const tab1 = [issued(draft("a")), draft("b")];
      const tab2 = [draft("a"), issued(draft("b"))];
      yield* b.putDoc("co", "invoices", tab1);
      const stale = yield* Effect.flip(b.putDoc("co", "invoices", tab2)); // would un-issue a
      const now = yield* b.doc<{ id: string; number: string | null; status: string }[]>("co", "invoices", []);
      yield* b.putDoc("co", "invoices", now.map((d) => (d.id === "b" ? issued(d) : d)));
      const both = yield* b.doc<{ id: string; number: string | null }[]>("co", "invoices", []);
      const edit = yield* Effect.flip(b.putDoc("co", "invoices", both.map((d) => (d.id === "a" ? { ...d, items: [] } : d))));
      const renumber = yield* Effect.flip(b.putDoc("co", "invoices", both.map((d) => (d.id === "a" ? { ...d, number: "0009" } : d))));
      const del = yield* Effect.flip(b.putDoc("co", "invoices", both.filter((d) => d.id !== "a")));
      const wipe = yield* Effect.flip(b.putDoc("co", "invoices", null));
      const back = yield* Effect.flip(b.putDoc("co", "invoices", [...both, issued(draft("c", "2026-02-01"))]));
      return { stale, both, edit, renumber, del, wipe, back };
    }),
  );
  expect(r.stale).toMatchObject({ _tag: "BadInput", message: expect.stringContaining("0001 is issued") });
  expect(r.both.map((d) => [d.id, d.number])).toEqual([
    ["a", "0001"],
    ["b", "0002"],
  ]);
  for (const x of [r.edit, r.renumber, r.del, r.wipe]) expect(x._tag).toBe("BadInput");
  expect(r.back).toMatchObject({ _tag: "BadInput", message: expect.stringContaining("before the last one of its type (2026-03-01)") });
});

test("issuing at the same moment from two fibers gives gapless distinct numbers", async () => {
  const h = home();
  await setup(h);
  const nums = await run(
    h,
    Effect.gen(function* () {
      const b = yield* Books;
      // each tab adds its own new document, issued, to what it read: one of the two wins, the other is refused or numbered next
      const issueOne = (id: string) =>
        Effect.gen(function* () {
          const cur = yield* b.doc<object[]>("co", "invoices", []);
          yield* Effect.yieldNow;
          return yield* Effect.result(b.putDoc("co", "invoices", [...cur, issued(draft(id))]));
        });
      yield* Effect.all([issueOne("x"), issueOne("y"), issueOne("z")], { concurrency: "unbounded" });
      yield* Effect.all([issueOne("p"), issueOne("q")], { concurrency: "unbounded" });
      return (yield* b.doc<{ number: string }[]>("co", "invoices", [])).map((d) => d.number);
    }),
  );
  expect(nums.length).toBeGreaterThanOrEqual(2);
  expect(nums).toEqual(nums.map((_, i) => String(i + 1).padStart(4, "0")));
});

test("credit document and print count: the original is cancelled; first print 1 (original), then copies", async () => {
  const h = home();
  await setup(h);
  const r = await run(
    h,
    Effect.gen(function* () {
      const b = yield* Books;
      yield* b.putDoc("co", "invoices", [issued(draft("a"))]);
      const draftPrint = yield* b.recordPrint("co", "nope").pipe(Effect.flip);
      const p1 = yield* b.recordPrint("co", "a");
      const p2 = yield* b.recordPrint("co", "a");
      const cur = yield* b.doc<object[]>("co", "invoices", []);
      yield* b.putDoc("co", "invoices", [...cur, { id: "cr", kind: "credit", status: "open", cancels: "a", issued: "2026-03-02", items: [] }]);
      return { draftPrint, p1, p2, docs: yield* b.doc<Record<string, unknown>[]>("co", "invoices", []) };
    }),
  );
  expect(r.draftPrint._tag).toBe("BadInput");
  expect([r.p1, r.p2]).toEqual([1, 2]);
  expect(r.docs[0]).toMatchObject({ id: "a", status: "cancelled", cancelledBy: "cr", prints: 2 });
  expect(r.docs[1]).toMatchObject({ kind: "credit", number: "0001", ref: "0001", refKind: "receipt", items: [{ desc: "x", qty: 1, price: -100 }] });
  expect(auditRows(h).filter((x) => x.kind === "print")).toHaveLength(2);
});

test("audit: each write records actor, kind and the changed items in its own transaction; a refused write records nothing", async () => {
  const h = home();
  await setup(h);
  await run(
    h,
    Effect.gen(function* () {
      const b = yield* Books;
      yield* b.putDoc("co", "customers", [{ id: "c1", name: "Dana" }]);
      yield* b.putDoc("co", "customers", [{ id: "c1", name: "Dana" }, { id: "c2", name: "Avi" }]).pipe(Effect.provideService(Actor, "mcp"));
      yield* b.putDoc("co", "customers", [{ id: "c1", name: "Dana" }, { id: "c2", name: "Avi" }]); // no change: no row
      yield* b.setRules("co", [["Stripe", "revenue:sales"]]).pipe(Effect.provideService(Actor, "ai"));
      yield* b.setMeta("co", { short: "C" });
      yield* b.putDoc("co", "invoices", [issued(draft("a"))]);
      yield* Effect.flip(b.putDoc("co", "invoices", [])); // refused: rolled back with its audit row
      yield* b.putDoc("_ai", "config", { key: "secret" }); // app settings: never audited
    }),
  );
  const rows = auditRows(h);
  expect(rows.map((x) => [x.actor, x.kind, x.target])).toEqual([
    ["ui", "doc", "customers"],
    ["mcp", "doc", "customers"],
    ["ai", "rules", "rules"],
    ["ui", "meta", "entity"],
    ["ui", "doc", "invoices"],
  ]);
  expect(JSON.parse(rows[1]!.before)).toEqual([]);
  expect(JSON.parse(rows[1]!.after)).toEqual([{ id: "c2", name: "Avi" }]); // only the changed item
  expect(JSON.parse(rows[3]!.after)).toEqual({ short: "C" });
  const b = await run(h, Effect.flatMap(Books, (b) => b.audit("co", { kind: "meta" })));
  expect(b).toHaveLength(1);
});

test("ingest under a close date: closed rows stay as they were, the attempt is logged and shown; dropped splits are surfaced", async () => {
  const h = home();
  await setup(h);
  statement(h, "a.json", [
    { id: "old", date: "2025-01-10", amount: -50 },
    { id: "gone", date: "2025-01-12", amount: -10 },
    { id: "split", date: "2025-06-01", amount: -100 },
  ]);
  const r = await run(
    h,
    Effect.gen(function* () {
      const b = yield* Books;
      const sid = (yield* b.ledger("co")).find((t) => t.desc === "split")!.id;
      yield* b.putDoc("co", "splits", {
        [sid]: [
          { account: "expense:a", amount: -60 },
          { account: "expense:b", amount: -40 },
        ],
      });
      yield* b.putDoc("co", "books", { closeDate: "2025-01-31" });
      // the bank re-sends January differently (old's amount changed, gone dropped, a new closed row) and changes the split's amount
      statement(h, "a.json", [
        { id: "old", date: "2025-01-10", amount: -55 },
        { id: "late", date: "2025-01-20", amount: -7 },
        { id: "split", date: "2025-06-01", amount: -120 },
        { id: "new", date: "2025-02-03", amount: 30 },
      ]);
      yield* b.ingest("co").pipe(Effect.provideService(Actor, "sync"));
      return { sid, led: yield* b.ledger("co"), st: yield* b.state("co"), log: yield* b.audit("co", { kind: "ingest" }) };
    }),
  );
  const amounts = Object.fromEntries(r.led.map((t) => [t.desc, t.amount]));
  expect(amounts).toEqual({ old: -50, gone: -10, split: -120, new: 30 }); // closed rows untouched, "late" kept out
  expect(r.st.integrity?.closedImport).toMatchObject({ close: "2025-01-31", added: 1, removed: 1, changed: 1 });
  expect(r.st.integrity?.brokenSplits).toEqual([r.sid]);
  expect(r.log[0]).toMatchObject({ actor: "sync", kind: "ingest", after: { files: { "a.json": { added: 1, removed: 0 } }, droppedSplits: [r.sid] } });
});

test("close date: meta currency / closed business type, trips, payroll and tags in the closed period are refused", async () => {
  const h = home();
  await setup(h);
  statement(h, "a.json", [{ id: "t", date: "2025-01-10", amount: -50 }]);
  const trip = { id: "t1", name: "Berlin", start: "2025-01-05", end: "2025-01-08", country: "DE", nights: 3, businessDays: 4 };
  const pay = { id: "r1", period: "2025-01", payDate: "2025-01-31", gross: 100, employerTaxes: 0, employeeWithholding: 0, benefits: 0, net: 100, provider: "X", payments: [] };
  const r = await run(
    h,
    Effect.gen(function* () {
      const b = yield* Books;
      const id = (yield* b.ledger("co"))[0]!.id;
      yield* b.putDoc("co", "trips", [trip]);
      yield* b.putDoc("co", "books", { closeDate: "2025-01-31" });
      return {
        currency: yield* Effect.flip(b.setMeta("co", { currency: "USD" })),
        types: yield* Effect.flip(b.setMeta("co", { types: { "2025": "osek-murshe" } })),
        laterType: yield* Effect.result(b.setMeta("co", { types: { "2025": "osek-zair", "2026": "osek-murshe" } })),
        trip: yield* Effect.flip(b.putDoc("co", "trips", [{ ...trip, nights: 2 }])),
        payroll: yield* Effect.flip(b.putDoc("co", "payroll", [pay])),
        tags: yield* Effect.flip(b.putDoc("co", "tags", { groups: [], tags: [{ id: "x", name: "X" }], on: { [id]: ["x"] } })),
      };
    }),
  );
  for (const k of ["currency", "types", "trip", "payroll", "tags"] as const) expect(r[k]._tag, k).toBe("ClosedPeriod");
  expect(r.laterType._tag).toBe("Success");
});
