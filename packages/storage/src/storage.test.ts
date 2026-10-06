import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { afterAll, describe, expect, test } from "vitest";
import { pyRound, pyStr } from "@openbooks/core";
import type { StatementCheck, StatementRow } from "@openbooks/schema";
import { Books, booksLayer, ChangesLive, openDb, type Read } from "./index.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const tmps: string[] = [];
afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

// ---------- a mini reader: books.py mercury_json + bit, enough to prove storage parity until @openbooks/importers lands ----------
const miniRead: Read = (file) => {
  const text = new TextDecoder().decode(file.bytes).replace(/^﻿/, "");
  if (file.name.toLowerCase().endsWith(".json")) {
    const ints: boolean[] = []; // per transaction, in order: was the JSON amount an integer literal (Python int)?
    const d = JSON.parse(text, (k, v, ctx?: { source?: string }) => {
      if (k === "amount") ints.push(/^-?\d+$/.test(ctx?.source ?? ""));
      return v;
    }) as { accounts: { id: string; name: string; currentBalance: number }[]; transactions: Record<string, any>[] };
    const names = new Map(d.accounts.map((a) => [a.id, a.name]));
    const isInt = new Map<StatementRow, boolean>();
    const rows: StatementRow[] = [];
    d.transactions.forEach((t, i) => {
      if (["cancelled", "failed", "reversed", "blocked"].includes(t.status)) return;
      const r = {
        date: (t.postedAt || t.createdAt).slice(0, 10),
        amount: t.amount,
        desc: t.counterpartyName || t.bankDescription || "",
        memo: [t.bankDescription, t.note, t.externalMemo].filter(Boolean).join(" "),
        mcat: t.mercuryCategory || "",
        kind: t.kind,
        source: "mercury",
        account: names.get(t.accountId) ?? "Mercury",
        file: file.name,
        page: i + 1,
        key: t.id,
      };
      isInt.set(r, ints[i]!);
      rows.push(r);
    });
    const dates = rows.map((r) => r.date).sort();
    const checks: StatementCheck[] = d.accounts.map((a) => ({
      file: file.name,
      label: a.name,
      period: dates.length ? [dates[0]!, dates.at(-1)!] : ["", ""],
      parsed: pyRound(rows.filter((r) => r.account === a.name).reduce((s, r) => s + r.amount, 0)),
      total: a.currentBalance,
      balance: true,
    }));
    return { rows, checks, uidAmount: (r) => pyStr(r.amount, isInt.get(r)) };
  }
  if (file.name.toLowerCase().endsWith(".csv")) {
    const rows: StatementRow[] = [];
    text.split("\n").forEach((line, i) => {
      const r = line.split(",").map((x) => x.trim());
      if (r.length >= 8 && r[0] === "Done" && r[5] === "Credit" && r[3] && r[6] !== "") {
        const [d, m, y] = r[7]!.split(".");
        rows.push({
          date: `20${y}-${m}-${d}`,
          amount: Number(r[3]),
          desc: `bit: ${r[6]} ${r[1]}`,
          source: "bit",
          account: "bit",
          who: r[6]!,
          file: file.name,
          page: i + 1,
          key: r[1]!,
        });
      }
    });
    if (!rows.length) throw new Error("not a bit export");
    return { rows, checks: [], uidAmount: (r) => pyStr(r.amount) };
  }
  throw new Error("unsupported");
};

// ---------- synthetic books: examples/demo (JSON era) + statements ----------
const mercury = (txns: string[]) =>
  `{"accounts": [{"id": "a1", "name": "Mercury Checking ••1234", "currentBalance": 1112.5}], "transactions": [${txns.join(", ")}]}`;
const T = {
  stripe: `{"id": "t1", "amount": 1200, "postedAt": "2025-03-01T10:00:00Z", "counterpartyName": "Stripe", "kind": "externalTransfer", "accountId": "a1"}`,
  openai: `{"id": "t2", "amount": -20.5, "createdAt": "2025-03-02T10:00:00Z", "counterpartyName": "OpenAI", "kind": "debitCardTransaction", "accountId": "a1", "mercuryCategory": "Software"}`,
  distro: `{"id": "t3", "amount": 33.0, "postedAt": "2025-01-15T10:00:00Z", "bankDescription": "DistroKid payout", "note": "royalties", "kind": "externalTransfer", "accountId": "a1"}`,
  failed: `{"id": "t4", "amount": -99, "postedAt": "2025-03-03T10:00:00Z", "counterpartyName": "Nope", "kind": "x", "status": "failed", "accountId": "a1"}`,
  ads: `{"id": "t5", "amount": -100, "postedAt": "2024-12-30T10:00:00Z", "counterpartyName": "Meta Ads", "kind": "x", "accountId": "a1"}`,
};
const BIT =
  "﻿Status,Ref,x,Amount,y,Type,Name,Date\nDone,r1,,150.00,,Credit,דנה לוי,05.02.25\nDone,r2,,80,,Debit,Someone,06.02.25\nDone,r3,,42.5,,Credit,Avi,07.02.25\n";

function books(): string {
  const home = mkdtempSync(join(tmpdir(), "ob-storage-"));
  tmps.push(home);
  cpSync(join(ROOT, "examples/demo"), home, { recursive: true });
  const acme = join(home, "acme");
  mkdirSync(join(acme, "inbox"));
  mkdirSync(join(acme, "data"));
  writeFileSync(
    join(acme, "data/journal.json"),
    JSON.stringify([
      {
        id: "je1",
        date: "2025-06-30",
        memo: "Owner draw",
        lines: [
          { account: "equity:owner", debit: 500 },
          { account: "asset:cash", credit: 500 },
        ],
      },
    ]),
  );
  writeFileSync(join(acme, "data/invoices.json"), JSON.stringify([{ n: 1, to: "Ünïcode Ltd" }]));
  writeFileSync(
    join(acme, "data/connections.json"),
    JSON.stringify({ mercury: { secret: "tok", lastSync: "2025-03-04T00:00:00+00:00", accounts: ["Checking"] } }),
  );
  writeFileSync(join(acme, "inbox/mercury-2025.json"), mercury([T.stripe, T.openai, T.distro, T.failed]));
  writeFileSync(join(acme, "inbox/mercury-old.JSON"), mercury([T.ads, T.stripe])); // overlaps t1: counted once
  writeFileSync(join(acme, "inbox/junk.csv"), "hello,world\n"); // unreadable
  writeFileSync(join(acme, "inbox/notes.txt"), "not a statement");
  mkdirSync(join(acme, "proofs/2023"), { recursive: true });
  writeFileSync(join(acme, "proofs/2023/cert.pdf"), "");
  mkdirSync(join(acme, "attachments/abc"), { recursive: true });
  writeFileSync(join(acme, "attachments/abc/receipt.pdf"), "");
  mkdirSync(join(home, "noa/inbox"));
  writeFileSync(join(home, "noa/inbox/bit.csv"), BIT);
  return home;
}

const run = <A, E>(home: string, eff: Effect.Effect<A, E, Books>) =>
  Effect.runPromise(Effect.provide(eff, booksLayer({ home, read: miniRead }).pipe(Layer.provide(ChangesLive))));

const MARK = "update txn set data = json_set(data, '$._marker', 1) where rowid in (select min(rowid) from txn group by entity)";
const MARKED = "select count(*) from txn where json_extract(data, '$._marker') = 1";
const sql = (home: string, q: string) => {
  const db = new Database(join(home, "books.db"));
  try {
    return db.query(q).values();
  } finally {
    db.close();
  }
};
describe("books.db", () => {
  test("created 0600, WAL, books.py schema", () => {
    const home = mkdtempSync(join(tmpdir(), "ob-db-"));
    tmps.push(home);
    const db = openDb(home);
    expect(statSync(join(home, "books.db")).mode & 0o777).toBe(0o600);
    expect(db.query("pragma journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.query("pragma busy_timeout").values()).toEqual([[10000]]);
    const names = db
      .query<{ name: string }, []>("select name from sqlite_master order by name")
      .all()
      .map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["doc", "entity", "rule", "secret", "statement", "txn", "txn_date"]));
    db.close();
  });
});

describe("Books", () => {
  test("migrates the JSON era, ingests, dedupes, categorizes, and re-ingests only on change", async () => {
    const home = books();
    const r = await run(
      home,
      Effect.gen(function* () {
        const b = yield* Books;
        const es = yield* b.entities;
        const led = yield* b.ledger("acme");
        const st = yield* b.state("acme");
        return { es, led, st, rules: yield* b.rules("noa"), journal: yield* b.doc("acme", "journal", []) };
      }),
    );
    expect(r.es.map((e) => e.id)).toEqual(["acme", "noa"]);
    expect(r.es[1]).toMatchObject({ name: "נועה כהן · עוסק זעיר", kind: "il-osek-zair" });
    expect(r.rules).toEqual([["bit:", "business:clients"]]);
    expect(r.journal).toHaveLength(1);
    expect(r.led.map((t) => [t.date, t.desc, t.category, t.why])).toEqual([
      ["2024-12-30", "Meta Ads", "expense:advertising", "Meta Ads"],
      ["2025-01-15", "DistroKid payout", "revenue:music-royalties", "DistroKid"],
      ["2025-03-01", "Stripe", "revenue:plugin-sales", "Stripe"],
      ["2025-03-02", "OpenAI", "cogs:ai-models", "OpenAI"],
      ["2025-06-30", "Owner draw", "equity:owner", "journal"],
      ["2025-06-30", "Owner draw", "asset:cash", "journal"],
    ]);
    expect(r.st.inbox).toEqual(["junk.csv", "mercury-2025.json", "mercury-old.JSON"]);
    expect(r.st.unreadable).toEqual(["junk.csv"]);
    expect(r.st.checks.map((c) => [c.file, c.period])).toEqual([
      ["mercury-old.JSON", ["2024-12-30", "2025-03-01"]],
      ["mercury-2025.json", ["2025-01-15", "2025-03-02"]],
    ]);
    expect(r.st.years).toEqual([2023, 2024, 2025]);
    expect(r.st.proofs).toEqual({ 2023: ["cert.pdf"], 2024: [], 2025: [] });
    expect(r.st.attachments).toEqual({ abc: ["receipt.pdf"] });
    expect(Object.keys(r.st.docs)).toEqual(["invoices", "journal"]);
    expect(r.st.connections).toEqual([
      {
        provider: "mercury",
        type: "mercury",
        connected: true,
        pending: false,
        lastSync: "2025-03-04T00:00:00+00:00",
        lastError: null,
        accounts: ["Checking"],
        file: "mercury-sync.json",
      },
    ]);
    expect(Object.keys(r.st.taxTables)).toEqual(["il", "us"]);

    await run(
      home,
      Effect.flatMap(Books, (b) => b.ingest("noa")),
    );
    sql(home, MARK);
    await run(
      home,
      Effect.flatMap(Books, (b) => b.ledger("acme")),
    );
    expect(sql(home, MARKED)).toEqual([[2]]); // unchanged inbox: no re-ingest

    const f = join(home, "acme/inbox/junk.csv");
    utimesSync(f, new Date(), new Date(Date.now() + 5000));
    await run(
      home,
      Effect.flatMap(Books, (b) => b.ingest("acme")),
    );
    expect(sql(home, MARKED)).toEqual([[1]]); // touched: acme re-read (noa kept its tag)
  });

  test("writes: rules, docs, csv-profiles, meta, entities", async () => {
    const home = books();
    const r = await run(
      home,
      Effect.gen(function* () {
        const b = yield* Books;
        yield* b.ingest("acme");
        yield* b.setRules("acme", [
          ["  Stripe, Inc ", " revenue:sales "],
          ["", "x"],
          ["y", " "],
        ]);
        yield* b.putDoc("acme", "planner", { a: 1 });
        yield* b.putDoc("acme", "invoices", null);
        yield* b.putDoc("_app", "taxtables", { il: { 2099: { note: "override" } } });
        yield* b.putDoc("acme", "csv-profiles", []);
        const stmtsAfterProfiles = (yield* b.checks("acme")).inbox; // csv-profiles cleared the statement rows → ingest again
        yield* b.setMeta("acme", { short: "Acme" });
        const bad = yield* Effect.flip(b.createEntity("Bad Id", { name: "x" }));
        const dup = yield* Effect.flip(b.createEntity("acme", { name: "x" }));
        yield* b.createEntity("new-co", { name: "New", kind: "us-llc" });
        const unknown = yield* Effect.flip(b.ledger("nope"));
        const st = yield* b.state("acme");
        return { st, bad, dup, unknown, stmtsAfterProfiles, es: yield* b.entities };
      }),
    );
    expect(r.st.rules).toEqual([["Stripe  Inc", "revenue:sales"]]);
    expect(r.st.docs).toMatchObject({ planner: { a: 1 } });
    expect(r.st.docs).not.toHaveProperty("invoices");
    expect(r.st.taxTables.il).toHaveProperty("2099", { note: "override" });
    expect(r.st.taxTables.il).toHaveProperty("2025");
    expect(r.stmtsAfterProfiles).toHaveLength(3);
    expect(r.st.entity).toMatchObject({ id: "acme", short: "Acme", name: "Acme Audio LLC" });
    expect(r.bad._tag).toBe("BadInput");
    expect(r.dup).toMatchObject({ _tag: "BadInput", message: "that id exists" });
    expect(r.unknown._tag).toBe("UnknownEntity");
    expect(r.es.map((e) => e.id)).toEqual(["acme", "new-co", "noa"]);
    expect(statSync(join(home, "new-co/inbox")).isDirectory()).toBe(true);
  });
});
