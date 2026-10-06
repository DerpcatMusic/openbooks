import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { openDb } from "./db.ts";
import { makeVault, type VaultOptions } from "./vault.ts";

// books.py's schema (docs/architecture.md); db.ts (item 2.5) owns the real one.
const SCHEMA = `
create table if not exists entity (id text primary key, meta text not null);
create table if not exists doc    (entity text, name text, value text not null, primary key (entity, name));
create table if not exists rule   (entity text, pos integer, match text, category text, primary key (entity, pos));
create table if not exists secret (entity text, provider text, value text not null, primary key (entity, provider));
create table if not exists txn    (entity text, id text, date text, amount real, account text, desc text, source text, data text not null, primary key (entity, id));
create index if not exists txn_date on txn (entity, date);
create table if not exists statement (entity text, file text, sig text, checks text, ok integer, primary key (entity, file));`;

// Synthetic secrets only.
const BANK = { secret: { token: "tok-SYNTHETIC-123" }, lastSync: "2026-01-01T00:00:00", lastError: null, accounts: [{ id: "a1", name: "Checking" }] };
const ONEZERO = { pending: { email: "x@example.com", password: "pw-SYNTHETIC", otpContext: "ctx" }, accounts: [] };
const AI = { provider: "anthropic", model: "m", base: "", keys: { anthropic: "sk-SYNTHETIC-abcdefgh" } };
const FAST: VaultOptions = { N: 2 ** 10, failDelay: 0 };

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "ob-vault-"));
  dirs.push(dir);
  const db = new Database(join(dir, "books.db"), { create: true });
  db.exec("pragma journal_mode=wal");
  db.exec(SCHEMA);
  db.query("insert into entity values (?, ?)").run("acme", JSON.stringify({ name: "Acme", kind: "us-llc" }));
  const put = db.query("insert or replace into secret values (?, ?, ?)");
  put.run("acme", "mercury", JSON.stringify(BANK));
  put.run("acme", "onezero", JSON.stringify(ONEZERO));
  put.run("_ai", "config", JSON.stringify(AI));
  db.query("insert into doc values (?, ?, ?)").run("acme", "profile", JSON.stringify({ x: 1 }));
  return { dir, db, put };
}
const rows = (db: Database) =>
  Object.fromEntries(
    db
      .query<{ entity: string; provider: string; value: string }, []>("select * from secret")
      .all()
      .map((r) => [`${r.entity}/${r.provider}`, JSON.parse(r.value) as Record<string, unknown>]),
  );
const run = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromise(e);
const fails = async <A, E>(e: Effect.Effect<A, E>) => {
  const x = await Effect.runPromiseExit(e);
  if (Exit.isSuccess(x)) throw new Error("expected failure");
  const err = x.cause.reasons[0];
  return err && "error" in err ? (err.error as { _tag: string })._tag : "defect";
};

describe("vault", () => {
  test("no plaintext token left in books.db or its WAL after setup (secure_delete + checkpoint)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-vault-"));
    dirs.push(dir);
    const db = openDb(dir);
    const put = db.query("insert or replace into secret values (?, ?, ?)");
    // a few writes so the token sits in WAL frames and, after an auto-style checkpoint, in the main file too
    put.run("acme", "mercury", JSON.stringify(BANK));
    db.run("pragma wal_checkpoint(PASSIVE)");
    put.run("acme", "mercury", JSON.stringify({ ...BANK, lastError: "x" }));
    put.run("acme", "onezero", JSON.stringify(ONEZERO));
    const bytes = () =>
      ["books.db", "books.db-wal"]
        .map((f) => join(dir, f))
        .filter(existsSync)
        .map((f) => readFileSync(f).toString("latin1"))
        .join("");
    expect(bytes()).toContain("tok-SYNTHETIC-123"); // the test can see it before
    const v = await run(makeVault(db, FAST));
    await run(v.setup("correct horse"));
    for (const t of ["tok-SYNTHETIC-123", "pw-SYNTHETIC"]) expect(bytes()).not.toContain(t);
    await run(v.change("correct horse", "battery staple"));
    expect(bytes()).not.toContain("tok-SYNTHETIC-123");
    // plaintext mode, disconnect: a deleted row's bytes are zeroed too (secure_delete)
    put.run("acme", "plain", JSON.stringify({ secret: { token: "tok-DELETED-456" } }));
    db.run("pragma wal_checkpoint(TRUNCATE)");
    db.query("delete from secret where provider = 'plain'").run();
    db.run("pragma wal_checkpoint(TRUNCATE)");
    expect(bytes()).not.toContain("tok-DELETED-456");
    db.close();
  });

  test("plaintext mode until setup; setup seals only sensitive fields", async () => {
    const { db } = fixture();
    const v = await run(makeVault(db, FAST));
    expect(await run(v.status)).toBe("plaintext");
    await run(v.setup("correct horse"));
    expect(await run(v.status)).toBe("unlocked");
    const r = rows(db);
    expect(r["_vault/kdf"]).toMatchObject({ v: 1, kdf: "scrypt", N: 1024, r: 8, p: 1 });
    expect(r["acme/mercury"]).toEqual({ lastSync: BANK.lastSync, lastError: null, accounts: BANK.accounts, sealed: expect.any(Object) });
    expect(r["acme/onezero"]).toEqual({ accounts: [], sealed: expect.any(Object) });
    expect(r["_ai/config"]).toEqual({ provider: "anthropic", model: "m", base: "", sealed: expect.any(Object) });
    const raw = db.query<{ v: string }, []>("select group_concat(value) as v from secret").get()!.v;
    expect(raw).not.toContain("SYNTHETIC");
    expect(await run(v.reveal("acme", "mercury", r["acme/mercury"]!))).toEqual(BANK);
    expect(await run(v.reveal("_ai", "config", r["_ai/config"]!))).toEqual(AI);
    expect(await fails(v.setup("again"))).toBe("VaultExists");
  });

  test("wrong passphrase fails; right one unlocks (NFKC-normalized)", async () => {
    const { db } = fixture();
    await run(Effect.flatMap(makeVault(db, FAST), (v) => v.setup("ﬁsh")));
    const v = await run(makeVault(db, FAST)); // a fresh process: locked
    expect(await run(v.status)).toBe("locked");
    expect(await fails(v.unlock("nope"))).toBe("WrongPassphrase");
    expect(await run(v.status)).toBe("locked");
    await run(v.unlock("fish")); // U+FB01 normalizes to "fi"
    expect(await run(v.status)).toBe("unlocked");
  });

  test("wrong passphrase waits failDelay", async () => {
    const { db } = fixture();
    const v = await run(makeVault(db, { N: 2 ** 10, failDelay: 200 }));
    await run(v.setup("pw"));
    const t = Date.now();
    await fails(v.unlock("bad"));
    expect(Date.now() - t).toBeGreaterThanOrEqual(190);
  });

  test("locked: status still readable, secrets refused, nothing written in plaintext", async () => {
    const { db } = fixture();
    const v = await run(makeVault(db, FAST));
    await run(v.setup("pw"));
    await run(v.lock);
    expect(await run(v.status)).toBe("locked");
    const m = rows(db)["acme/mercury"]!;
    expect(await fails(v.reveal("acme", "mercury", m))).toBe("VaultLocked");
    expect(await fails(v.seal("acme", "mercury", { secret: 1 }))).toBe("VaultLocked");
    expect(await fails(v.open("acme", "mercury", m.sealed as never))).toBe("VaultLocked");
    expect(await fails(v.conceal("acme", "mercury", BANK))).toBe("VaultLocked");
    // an unsealed row (no secrets) passes through while locked
    expect(await run(v.reveal("acme", "x", { accounts: [] }))).toEqual({ accounts: [] });
  });

  test("tamper detection: flipped bit, moved envelope, garbage", async () => {
    const { db } = fixture();
    const v = await run(makeVault(db, FAST));
    await run(v.setup("pw"));
    const env = (await run(v.seal("acme", "mercury", { secret: { token: "t" } }))) as { v: 1; iv: string; ct: string };
    const ct = Buffer.from(env.ct, "base64");
    ct[0]! ^= 1;
    expect(await fails(v.open("acme", "mercury", { ...env, ct: ct.toString("base64") }))).toBe("Tampered");
    expect(await fails(v.open("acme", "mercury:2", env))).toBe("Tampered"); // AAD binds the row
    expect(await fails(v.open("other", "mercury", env))).toBe("Tampered");
    expect(await fails(v.reveal("acme", "mercury", { sealed: { v: 1, iv: "", ct: "" } }))).toBe("Tampered");
    expect(await fails(v.reveal("acme", "mercury", { sealed: "nonsense" }))).toBe("Tampered");
    expect(await run(v.open("acme", "mercury", env))).toEqual({ secret: { token: "t" } });
  });

  test("nonce uniqueness: same plaintext, different IV and ciphertext every time", async () => {
    const { db } = fixture();
    const v = await run(makeVault(db, FAST));
    await run(v.setup("pw"));
    const envs = await Promise.all(Array.from({ length: 200 }, () => run(v.seal("acme", "m", { secret: "same" }))));
    expect(new Set(envs.map((e) => e.iv)).size).toBe(200);
    expect(new Set(envs.map((e) => e.ct)).size).toBe(200);
    expect(Buffer.from(envs[0]!.iv, "base64").length).toBe(12);
  });

  test("change keeps data, old passphrase stops working, new salt", async () => {
    const { db } = fixture();
    const v = await run(makeVault(db, FAST));
    await run(v.setup("old"));
    const salt = rows(db)["_vault/kdf"]!.salt;
    expect(await fails(v.change("wrong", "new"))).toBe("WrongPassphrase");
    await run(v.change("old", "new"));
    expect(rows(db)["_vault/kdf"]!.salt).not.toBe(salt);
    const v2 = await run(makeVault(db, FAST));
    expect(await fails(v2.unlock("old"))).toBe("WrongPassphrase");
    await run(v2.unlock("new"));
    const r = rows(db);
    expect(await run(v2.reveal("acme", "mercury", r["acme/mercury"]!))).toEqual(BANK);
    expect(await run(v2.reveal("acme", "onezero", r["acme/onezero"]!))).toEqual(ONEZERO);
    expect(await run(v2.reveal("_ai", "config", r["_ai/config"]!))).toEqual(AI);
  });

  test("change aborts untouched when a row is tampered", async () => {
    const { db, put } = fixture();
    const v = await run(makeVault(db, FAST));
    await run(v.setup("old"));
    const m = rows(db)["acme/mercury"]!;
    put.run("acme", "mercury", JSON.stringify({ ...m, sealed: { v: 1, iv: (m.sealed as { iv: string }).iv, ct: "AAAA" } }));
    const before = rows(db);
    expect(await fails(v.change("old", "new"))).toBe("Tampered");
    expect(rows(db)).toEqual(before);
    await run(Effect.flatMap(makeVault(db, FAST), (v2) => v2.unlock("old")));
  });

  test("reset wipes only sealed secrets and the kdf row", async () => {
    const { db } = fixture();
    const v = await run(makeVault(db, FAST));
    await run(v.setup("pw"));
    await run(v.reset);
    expect(await run(v.status)).toBe("plaintext");
    expect(rows(db)).toEqual({
      "acme/mercury": { lastSync: BANK.lastSync, lastError: null, accounts: BANK.accounts },
      "acme/onezero": { accounts: [] },
      "_ai/config": { provider: "anthropic", model: "m", base: "" },
    });
    expect(db.query("select count(*) as n from entity").get()).toEqual({ n: 1 });
    expect(db.query("select value from doc").get()).toEqual({ value: '{"x":1}' });
  });

  test("migration: plaintext books.py wrote into a sealed db gets sealed on unlock, newer fields win", async () => {
    const { db, put } = fixture();
    await run(Effect.flatMap(makeVault(db, FAST), (v) => v.setup("pw")));
    // books.py reconnects Mercury (dict.update keeps `sealed`) and adds a new scraper bank
    const m = rows(db)["acme/mercury"]!;
    put.run("acme", "mercury", JSON.stringify({ ...m, secret: { token: "tok-SYNTHETIC-NEW" } }));
    put.run("acme", "hapoalim", JSON.stringify({ secret: { userCode: "u", password: "p-SYNTHETIC" }, accounts: [] }));
    const v = await run(makeVault(db, FAST));
    await run(v.unlock("pw"));
    const r = rows(db);
    expect(JSON.stringify(r)).not.toContain("SYNTHETIC");
    expect(await run(v.reveal("acme", "mercury", r["acme/mercury"]!))).toEqual({ ...BANK, secret: { token: "tok-SYNTHETIC-NEW" } });
    expect(await run(v.reveal("acme", "hapoalim", r["acme/hapoalim"]!))).toEqual({ secret: { userCode: "u", password: "p-SYNTHETIC" }, accounts: [] });
  });

  test("conceal/reveal round trip; plaintext mode passes rows through", async () => {
    const { db } = fixture();
    const v = await run(makeVault(db, FAST));
    expect(await run(v.conceal("acme", "mercury", BANK))).toEqual(BANK);
    await run(v.setup("pw"));
    const sealed = await run(v.conceal("acme", "mercury", BANK));
    expect(sealed.secret).toBeUndefined();
    expect(await run(v.reveal("acme", "mercury", sealed))).toEqual(BANK);
  });

  test("errors carry no secrets", async () => {
    const { db } = fixture();
    const v = await run(makeVault(db, FAST));
    await run(v.setup("hunter2-SYNTHETIC"));
    const x = await Effect.runPromiseExit(v.change("hunter2-WRONG", "x"));
    expect(JSON.stringify(x) + String(x)).not.toMatch(/hunter2|SYNTHETIC/);
  });
});
