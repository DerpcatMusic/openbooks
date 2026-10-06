// The secret vault (docs/architecture.md "Secrets: the vault"): scrypt → AES-256-GCM over the sensitive fields of `secret` rows.
// The key lives in this object only (non-extractable CryptoKey); never logged, never in an error, never on disk.
import type { Database } from "bun:sqlite";
import { scrypt } from "node:crypto";
import { Context, Data, Effect, Semaphore } from "effect";

export interface Envelope {
  v: 1;
  iv: string; // b64, 12 bytes
  ct: string; // b64, ciphertext ‖ 16-byte tag
}
interface Kdf {
  v: 1;
  kdf: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string;
  check: Envelope;
}
type Row = Record<string, unknown>;

// Errors carry no data on purpose: nothing secret can leak through them.
export class VaultLocked extends Data.TaggedError("VaultLocked") {}
export class VaultExists extends Data.TaggedError("VaultExists") {}
export class NoVault extends Data.TaggedError("NoVault") {}
export class WrongPassphrase extends Data.TaggedError("WrongPassphrase") {}
export class Tampered extends Data.TaggedError("Tampered") {}

export interface VaultApi {
  status: Effect.Effect<"plaintext" | "locked" | "unlocked">;
  setup(passphrase: string): Effect.Effect<void, VaultExists>;
  /** Verifies, keeps the key in memory, then seals any plaintext secrets books.py wrote meanwhile. */
  unlock(passphrase: string): Effect.Effect<void, WrongPassphrase | NoVault>;
  lock: Effect.Effect<void>;
  /** New salt + key; every row re-sealed in one transaction. Leaves the vault unlocked with the new key. */
  change(old: string, next: string): Effect.Effect<void, WrongPassphrase | NoVault | Tampered>;
  /** Forgot passphrase: drops every `sealed` field and the kdf row. Books and non-secret status stay. */
  reset: Effect.Effect<void>;
  seal(entity: string, provider: string, fields: object): Effect.Effect<Envelope, VaultLocked>;
  open(entity: string, provider: string, env: Envelope): Effect.Effect<object, VaultLocked | Tampered>;
  /** A stored row with its sealed fields opened (plaintext fields books.py wrote later win). Unsealed rows pass through, even when locked. */
  reveal(entity: string, provider: string, row: Row): Effect.Effect<Row, VaultLocked | Tampered>;
  /** The row to store: sensitive fields moved into `sealed` (pass a revealed row). Plaintext mode: unchanged. Locked: VaultLocked, never plaintext. */
  conceal(entity: string, provider: string, row: Row): Effect.Effect<Row, VaultLocked>;
}

export class Vault extends Context.Service<Vault, VaultApi>()("openbooks/Vault") {}

export interface VaultOptions {
  /** scrypt cost. Default 2^17 (the doc's). Tests only: pass 2^10 or so to stay fast. */
  N?: number;
  /** Delay after a wrong passphrase, ms. Default 1000; tests pass 0. */
  failDelay?: number;
  /** Called after every commit that changed `secret` rows (wire to Changes: topic "secrets"). */
  changed?: () => void;
}

/** Fields that get sealed in any `secret` row: bank `secret`/`pending`, AI `keys`. */
export const SENSITIVE = ["secret", "pending", "keys"] as const;
const KDF_ROW = ["_vault", "kdf"] as const;
const CHECK = "openbooks-vault-check";
const enc = new TextEncoder();
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const aad = (entity: string, provider: string) => enc.encode(`openbooks|${entity}|${provider}`);
const isEnvelope = (x: unknown): x is Envelope =>
  typeof x === "object" && x !== null && (x as Envelope).v === 1 && typeof (x as Envelope).iv === "string" && typeof (x as Envelope).ct === "string";

// Bounds on parameters read from the file: a doctored kdf row must not make us allocate gigabytes.
const validKdf = (k: Kdf) =>
  k?.v === 1 &&
  k.kdf === "scrypt" &&
  typeof k.salt === "string" &&
  Number.isInteger(Math.log2(k.N)) &&
  k.N >= 2 ** 10 &&
  k.N <= 2 ** 20 &&
  Number.isInteger(k.r) &&
  k.r >= 1 &&
  k.r <= 16 &&
  Number.isInteger(k.p) &&
  k.p >= 1 &&
  k.p <= 4;

function derive(passphrase: string, salt: Uint8Array, N: number, r: number, p: number): Promise<CryptoKey> {
  return new Promise<Buffer>((ok, fail) => {
    try {
      // maxmem: scrypt needs 128·N·r bytes (128 MiB at the default); node's 32 MiB default refuses it.
      scrypt(passphrase.normalize("NFKC"), salt, 32, { N, r, p, maxmem: 256 * N * r }, (e, k) => (e ? fail(new Error("scrypt failed")) : ok(k)));
    } catch {
      fail(new Error("scrypt failed"));
    }
  }).then((raw) => {
    const bytes = new Uint8Array(raw);
    raw.fill(0);
    const key = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]); // copies the bytes synchronously
    bytes.fill(0);
    return key;
  });
}

async function sealWith(key: CryptoKey, entity: string, provider: string, plain: Uint8Array<ArrayBuffer>): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(entity, provider) }, key, plain);
  return { v: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

/** null = wrong key or tampered (GCM can't tell which). */
async function openWith(key: CryptoKey, entity: string, provider: string, env: unknown): Promise<Uint8Array | null> {
  if (!isEnvelope(env)) return null;
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv), additionalData: aad(entity, provider) }, key, unb64(env.ct)));
  } catch {
    return null;
  }
}

async function openRow(key: CryptoKey, entity: string, provider: string, env: unknown): Promise<Row | null> {
  const plain = await openWith(key, entity, provider, env);
  return plain && (JSON.parse(new TextDecoder().decode(plain)) as Row);
}

const onlyTampered = (x: unknown) => {
  if (x instanceof Tampered) return x;
  throw x;
};

const split = (row: Row) => {
  const rest: Row = {};
  const hidden: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "sealed") continue;
    if ((SENSITIVE as readonly string[]).includes(k)) hidden[k] = v;
    else rest[k] = v;
  }
  return { rest, hidden, sealed: row.sealed };
};

async function sealRow(key: CryptoKey, entity: string, provider: string, row: Row): Promise<Row> {
  const { rest, hidden } = split(row);
  if (!Object.keys(hidden).length) return rest;
  return { ...rest, sealed: await sealWith(key, entity, provider, enc.encode(JSON.stringify(hidden))) };
}

/** The row with its envelope opened, newer plaintext fields on top; throws Tampered if the envelope won't open. */
async function revealRow(key: CryptoKey, entity: string, provider: string, row: Row): Promise<Row> {
  const { rest, hidden, sealed } = split(row);
  if (sealed === undefined) return { ...rest, ...hidden };
  const opened = await openRow(key, entity, provider, sealed);
  if (!opened) throw new Tampered();
  return { ...rest, ...opened, ...hidden };
}

export function makeVault(db: Database, opts: VaultOptions = {}): Effect.Effect<VaultApi> {
  return Effect.gen(function* () {
    const N = opts.N ?? 2 ** 17;
    const failDelay = opts.failDelay ?? 1000;
    const mutex = yield* Semaphore.make(1);
    let key: CryptoKey | null = null;

    const kdfRow = (): Kdf | null => {
      const r = db.query<{ value: string }, [string, string]>("select value from secret where entity = ? and provider = ?").get(...KDF_ROW);
      return r ? (JSON.parse(r.value) as Kdf) : null;
    };
    const userRows = () =>
      db.query<{ entity: string; provider: string; value: string }, []>("select entity, provider, value from secret where entity != '_vault'").all();

    /** Compute new values off-transaction (crypto is async), then write them in one transaction only if no row changed meanwhile; retry otherwise. */
    const rewrite = async (fn: (entity: string, provider: string, row: Row) => Promise<Row>, kdf: Kdf | null | undefined) => {
      for (let attempt = 0; ; attempt++) {
        const rows = userRows();
        const out: { entity: string; provider: string; old: string; value: string }[] = [];
        for (const r of rows) {
          const value = JSON.stringify(await fn(r.entity, r.provider, JSON.parse(r.value) as Row));
          if (value !== r.value) out.push({ entity: r.entity, provider: r.provider, old: r.value, value });
        }
        const ok = db.transaction(() => {
          const upd = db.query("update secret set value = ? where entity = ? and provider = ? and value = ?");
          for (const o of out) if (upd.run(o.value, o.entity, o.provider, o.old).changes !== 1) throw new Error("secret row changed meanwhile");
          if (kdf === null) db.query("delete from secret where entity = ? and provider = ?").run(...KDF_ROW);
          else if (kdf) db.query("insert or replace into secret values (?, ?, ?)").run(...KDF_ROW, JSON.stringify(kdf));
          return true;
        });
        try {
          ok();
        } catch (e) {
          if (attempt < 5 && e instanceof Error && e.message === "secret row changed meanwhile") continue;
          throw e;
        }
        if (out.length || kdf !== undefined) {
          // Old plaintext pages: secure_delete (openDb) zeroes freed cells/pages; the checkpoint copies the sealed pages over the
          // old ones in the main file and truncates the WAL, which still held the plaintext frames. A reader in another process
          // (books.py) can keep the checkpoint from finishing: then the WAL is scrubbed at its next full checkpoint.
          db.run("pragma wal_checkpoint(TRUNCATE)");
          opts.changed?.();
        }
        return;
      }
    };

    const newKdf = async (passphrase: string) => {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const k = await derive(passphrase, salt, N, 8, 1);
      const kdf: Kdf = { v: 1, kdf: "scrypt", N, r: 8, p: 1, salt: b64(salt), check: await sealWith(k, ...KDF_ROW, enc.encode(CHECK)) };
      return { k, kdf };
    };

    /** The stored kdf's key for this passphrase, or a failure after the delay. */
    const verify = (passphrase: string) =>
      Effect.gen(function* () {
        const kdf = kdfRow();
        if (!kdf) return yield* new NoVault();
        const k = validKdf(kdf) ? yield* Effect.promise(() => derive(passphrase, unb64(kdf.salt), kdf.N, kdf.r, kdf.p)) : null;
        const check = k && (yield* Effect.promise(() => openWith(k, ...KDF_ROW, kdf.check)));
        if (!k || !check || new TextDecoder().decode(check) !== CHECK) {
          yield* Effect.sleep(failDelay);
          return yield* new WrongPassphrase();
        }
        return k;
      });

    const needKey = Effect.suspend(() => (key ? Effect.succeed(key) : Effect.fail(new VaultLocked())));
    const locked = <A, E>(eff: Effect.Effect<A, E>) => mutex.withPermits(1)(eff);
    // Migration: plaintext fields books.py wrote get sealed, merged over what was sealed before (newer wins).
    // If the old envelope won't open (tampered), the fresh plaintext replaces it.
    const sealPlaintext = (k: CryptoKey) =>
      rewrite(async (e, p, row) => {
        const { hidden, sealed } = split(row);
        if (!Object.keys(hidden).length) return row;
        const old = sealed === undefined ? {} : await openRow(k, e, p, sealed);
        return sealRow(k, e, p, { ...row, ...old, ...hidden });
      }, undefined);

    const api: VaultApi = {
      status: Effect.sync(() => (key ? "unlocked" : kdfRow() ? "locked" : "plaintext")),
      setup: (passphrase) =>
        locked(
          Effect.gen(function* () {
            if (kdfRow()) return yield* new VaultExists();
            const { k, kdf } = yield* Effect.promise(() => newKdf(passphrase));
            yield* Effect.promise(() => rewrite((e, p, row) => sealRow(k, e, p, row), kdf));
            key = k;
          }),
        ),
      unlock: (passphrase) =>
        locked(
          Effect.gen(function* () {
            const k = yield* verify(passphrase);
            key = k;
            yield* Effect.promise(() => sealPlaintext(k));
          }),
        ),
      lock: Effect.sync(() => {
        key = null;
      }),
      change: (old, next) =>
        locked(
          Effect.gen(function* () {
            const k = yield* verify(old);
            const { k: k2, kdf } = yield* Effect.promise(() => newKdf(next));
            const bad = yield* Effect.promise(() =>
              rewrite(async (e, p, row) => sealRow(k2, e, p, await revealRow(k, e, p, row)), kdf).then(() => null, onlyTampered),
            );
            if (bad) return yield* Effect.fail(bad); // nothing written: the old passphrase still works
            key = k2;
          }),
        ),
      reset: locked(
        Effect.promise(() =>
          rewrite(async (_e, _p, row) => {
            const { sealed: _, ...rest } = row;
            return rest;
          }, null),
        ).pipe(Effect.tap(() => Effect.sync(() => (key = null)))),
      ),
      seal: (entity, provider, fields) =>
        needKey.pipe(Effect.flatMap((k) => Effect.promise(() => sealWith(k, entity, provider, enc.encode(JSON.stringify(fields)))))),
      open: (entity, provider, env) =>
        needKey.pipe(
          Effect.flatMap((k) => Effect.promise(() => openRow(k, entity, provider, env))),
          Effect.flatMap((o) => (o ? Effect.succeed(o) : Effect.fail(new Tampered()))),
        ),
      reveal: (entity, provider, row) =>
        row.sealed === undefined
          ? Effect.succeed(row)
          : needKey.pipe(
              Effect.flatMap((k) => Effect.promise(() => revealRow(k, entity, provider, row).catch(onlyTampered))),
              Effect.flatMap((r) => (r instanceof Tampered ? Effect.fail(r) : Effect.succeed(r))),
            ),
      conceal: (entity, provider, row) =>
        Effect.suspend(() => {
          if (!kdfRow()) return Effect.succeed(row);
          return needKey.pipe(Effect.flatMap((k) => Effect.promise(() => sealRow(k, entity, provider, row))));
        }),
    };
    return api;
  });
}
