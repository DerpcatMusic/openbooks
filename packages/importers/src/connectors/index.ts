// Live bank connections (port of connectors.py). Mercury (public API, read-only token) and Israeli banks and credit cards
// through israeli-bank-scrapers: One Zero over its own mobile API with an SMS code, every other bank by logging in to its
// website in a headless Chrome. Israeli open-banking APIs are open only to licensed providers, so this is the same login
// the bank's website gets; a 2FA or captcha change on the bank's side can break it.
// Any entity can connect any provider, several times over: connections are keyed "<provider>" or "<provider>:<n>", where
// <provider> is "mercury", "onezero" or an israeli-bank-scrapers companyId ("hapoalim", "max", ...).
// Secrets live only in books.db behind ConnectionStore (never sent to the browser, never logged, never echoed in errors).
// A sync writes inbox/<provider>[-<n>]-sync.json, which ingest reads like any other statement.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context, Data, Effect, Layer } from "effect";
import type { ScrapeCmd, ScrapeResult, ScrapedAccount, ScrapedTxn } from "./scrape.ts";

export type { ScrapeCmd, ScrapeResult } from "./scrape.ts";

/** A failure whose message is safe to show the user (never carries credentials). */
export class ConnectorError extends Data.TaggedError("ConnectorError")<{ readonly message: string }> {}
const fail = (message: string) => new ConnectorError({ message });

// ---------- where connections live: `secret` rows (storage) opened/sealed by the vault ----------
export interface Pending {
  email: string;
  password: string;
  otpContext: string;
}
/** One `secret` row as stored: {secret, pending, lastSync, lastError, accounts} in plaintext mode, or with `sealed` instead of secret/pending. */
export interface Conn {
  secret?: Record<string, string>;
  pending?: Pending;
  sealed?: unknown;
  lastSync?: string | null;
  lastError?: string | null;
  accounts?: string[];
  [k: string]: unknown;
}
/** Structural stand-ins for storage's VaultLocked / Tampered (importers can't import storage: dependency direction). */
export interface VaultError {
  readonly _tag: "VaultLocked" | "Tampered";
}
/** Raw `secret` rows of one entity. Storage implements it over books.db. */
export class ConnectionStore extends Context.Service<
  ConnectionStore,
  {
    /** The entity's folder (`<home>/<id>`); the inbox is `<dir>/inbox`. */
    readonly dir: (entity: string) => string;
    readonly rows: (entity: string) => Effect.Effect<Record<string, Conn>>;
    /** Replaces every row of the entity in one transaction (books.py put_secrets). */
    readonly putRows: (entity: string, rows: Record<string, Conn>) => Effect.Effect<void>;
  }
>()("openbooks/ConnectionStore") {}
/** The part of storage's Vault connectors use: wire the real one with `Layer.effect(ConnectionVault, Effect.gen(function* () { return yield* Vault }))`. */
export class ConnectionVault extends Context.Service<
  ConnectionVault,
  {
    readonly reveal: (entity: string, provider: string, row: Conn) => Effect.Effect<Conn, VaultError>;
    readonly conceal: (entity: string, provider: string, row: Conn) => Effect.Effect<Conn, VaultError>;
  }
>()("openbooks/ConnectionVault") {}

/** Every connection of the entity, opened. Locked vault (and a sealed row): VaultLocked. */
const load = (e: string) =>
  Effect.gen(function* () {
    const [store, vault] = [yield* ConnectionStore, yield* ConnectionVault];
    const rows = yield* store.rows(e);
    const out: Record<string, Conn> = {};
    for (const [k, row] of Object.entries(rows)) out[k] = yield* vault.reveal(e, k, row);
    return out;
  });
/** Seals each (revealed) row, then replaces the entity's rows. Locked: VaultLocked, nothing written. */
const save = (e: string, conns: Record<string, Conn>) =>
  Effect.gen(function* () {
    const [store, vault] = [yield* ConnectionStore, yield* ConnectionVault];
    const out: Record<string, Conn> = {};
    for (const [k, row] of Object.entries(conns)) out[k] = yield* vault.conceal(e, k, row);
    yield* store.putRows(e, out);
  });

// ---------- the scraper: in-process (Bun) or the subprocess bridge ----------
const NOT_INSTALLED = "Bank connectors aren't installed: bun install (with PUPPETEER_SKIP_DOWNLOAD=1)";
const CLI = fileURLToPath(new URL("./scrape-cli.ts", import.meta.url));

/** Runs scrape-cli.ts with the command on stdin and reads the last stdout line. stderr is dropped: it may echo request bodies. */
const bridge = (cmd: ScrapeCmd) =>
  Effect.callback<ScrapeResult, ConnectorError>((resume) => {
    const p = spawn(process.execPath, [CLI], { cwd: path.dirname(CLI), env: { ...process.env, BUN_BE_BUN: "1" }, stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d: Buffer) => (out += d));
    p.on("error", () => resume(Effect.fail(fail(NOT_INSTALLED))));
    p.on("close", (code) => {
      try {
        resume(Effect.succeed(JSON.parse(out.trim().split("\n").at(-1)!) as ScrapeResult));
      } catch {
        resume(Effect.fail(fail(`${cmd.companyId} connector crashed (exit ${code})`)));
      }
    });
    p.stdin.end(JSON.stringify(cmd));
    return Effect.sync(() => void p.kill());
  });

export class Scraper extends Context.Service<Scraper, { readonly run: (cmd: ScrapeCmd) => Effect.Effect<ScrapeResult, ConnectorError> }>()(
  "openbooks/Scraper",
) {
  /** israeli-bank-scrapers loaded into this process (works under Bun 1.4, puppeteer included). */
  static readonly direct = Layer.succeed(Scraper)({
    run: (cmd) =>
      Effect.tryPromise({ try: () => import("./scrape.ts"), catch: () => fail(NOT_INSTALLED) }).pipe(Effect.flatMap((m) => Effect.promise(() => m.run(cmd)))),
  });
  /** Fallback: one subprocess per command (same code, `bun scrape-cli.ts`), killed on timeout. */
  static readonly bridge = Layer.succeed(Scraper)({ run: bridge });
}

const ERRORS: Record<string, string> = {
  INVALID_PASSWORD: "the bank rejected the login details",
  CHANGE_PASSWORD: "the bank wants a new password: change it on its website first",
  ACCOUNT_BLOCKED: "the bank says the account is blocked",
  TIMEOUT: "the bank's website timed out (try again; it may be down or have changed)",
  TWO_FACTOR_RETRIEVER_MISSING: "the bank asked for a one-time code, which this connector can't answer for this bank",
};

/** One scraper command; a failure becomes a ConnectorError with every credential masked. */
export const scrape = (cmd: ScrapeCmd) =>
  Effect.gen(function* () {
    const label = cmd.companyId;
    const scraper = yield* Scraper;
    // ponytail: in-process runs can't be killed, a timed-out scrape keeps its Chrome until the library gives up
    const r = yield* scraper.run(cmd).pipe(Effect.timeoutOrElse({ duration: "600 seconds", orElse: () => Effect.fail(fail(`${label} timed out`)) }));
    if (r.success) return r;
    let msg = (r.errorType && ERRORS[r.errorType]) || r.errorMessage || r.errorType || "failed";
    for (const v of [...Object.values(cmd.credentials ?? {}), cmd.phoneNumber, cmd.otpCode, cmd.otpContext])
      if (typeof v === "string" && v.length >= 3) msg = msg.replaceAll(v, "•••");
    return yield* fail(`${r.name || label}: ${Array.from(msg).slice(0, 300).join("")}`);
  });

// ---------- helpers ----------
const KEY = /^[A-Za-z][A-Za-z0-9]{1,31}(:\d{1,3})?$/;
const now = () => new Date().toISOString().slice(0, 19) + "+00:00"; // Python isoformat(timespec="seconds") in UTC
/** Python str() for what JSON can hold: objects never become "[object Object]". */
const str = (v: unknown): string => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v as string));
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** "hapoalim:2" -> "hapoalim" */
export const kind = (key: string) => key.split(":")[0]!;
/** "hapoalim:2" -> "hapoalim-2-sync.json" */
export const inboxFile = (key: string) => `${key.replaceAll(":", "-")}-sync.json`;
const last4 = (n: unknown) => str(n).slice(-4);

/** Writes `.name.tmp` then renames: a dotfile isn't a statement, so ingest never sees a half-written sync. */
export const writeInbox = (dir: string, name: string, obj: unknown) =>
  Effect.promise(async () => {
    const inbox = path.join(dir, "inbox");
    await fs.mkdir(inbox, { recursive: true });
    const tmp = path.join(inbox, `.${name}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(obj, null, 1));
    await fs.rename(tmp, path.join(inbox, name));
  });

const readJson = (file: string) =>
  fs.readFile(file, "utf8").then(
    (t) => JSON.parse(t) as Record<string, unknown>,
    () => null,
  );

// ---------- Mercury ----------
// OPENBOOKS_MERCURY_API: tests point it at a local fake; never set it otherwise (the token goes wherever it points)
const MERCURY = process.env.OPENBOOKS_MERCURY_API ?? "https://api.mercury.com/api/v1";
type Json = Record<string, unknown>;
const J = JSON as unknown as { rawJSON(s: string): unknown; isRawJSON(v: unknown): v is { rawJSON: string } };
/** JSON.parse that keeps `-20.0` a float literal when re-serialized, as Python's json round trip does: the uid hashes str(amount). */
const parseKeepFloats = (text: string) =>
  JSON.parse(text, (_k, v: unknown, ctx?: { source?: string }) =>
    typeof v === "number" && Number.isInteger(v) && ctx?.source && !/^-?\d+$/.test(ctx.source) ? J.rawJSON(`${v}.0`) : v,
  ) as Json;
const num = (v: unknown) => (J.isRawJSON(v) ? Number(v.rawJSON) : Number(v ?? 0) || 0);

class HttpStatus {
  constructor(readonly code: number) {}
}

export const mercury = (token: string, p: string, params: Record<string, string | number> = {}) =>
  Effect.tryPromise({
    try: async () => {
      const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
      const r = await fetch(`${MERCURY}${p}${q ? `?${q}` : ""}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new HttpStatus(r.status);
      return { body: await r.text() };
    },
    catch: (x) =>
      x instanceof HttpStatus
        ? fail(
            x.code === 401 || x.code === 403
              ? `Mercury refused the token (${x.code}). Check it's an active read-only API token.`
              : `Mercury API ${x.code} on ${p}`,
          )
        : fail(`Can't reach Mercury: ${(x as Error)?.message ?? "network error"}`),
  }).pipe(Effect.map(({ body }) => parseKeepFloats(body))); // bad JSON is a defect, like json.load raising in Python

/** Mercury's cursor pagination: page.nextPage -> start_after. */
const cursorPages = (token: string, p: string, key: string, params: Record<string, string | number>) =>
  Effect.gen(function* () {
    const out: Json[] = [];
    let after: string | undefined;
    for (;;) {
      const d = yield* mercury(token, p, { ...params, ...(after ? { start_after: after } : {}) });
      const items = (d[key] as Json[] | undefined) ?? [];
      out.push(...items);
      const nxt = (d.page as Json | null | undefined)?.nextPage as string | undefined;
      if (!nxt || nxt === after || !items.length) return out;
      after = nxt;
    }
  });

const title = (s: string) => s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());

export const mercurySync = (dir: string, token: string, file = "mercury-sync.json") =>
  Effect.gen(function* () {
    const accounts: Json[] = [];
    for (const a of yield* cursorPages(token, "/accounts", "accounts", {})) {
      const n = str(a.accountNumber || "");
      const name = n ? `Mercury ${title(str(a.kind || "account"))} ••${n.slice(-4)}` : a.nickname || a.name || "Mercury";
      accounts.push({ id: a.id, name, kind: a.kind ?? null, currentBalance: "currentBalance" in a ? a.currentBalance : 0 });
    }
    const txns = new Map<string, Json>();
    for (const a of accounts.slice()) {
      // deposit accounts: offset pagination
      for (let off = 0; ; off += 500) {
        const d = yield* mercury(token, `/account/${String(a.id)}/transactions`, { limit: 500, offset: off, start: "2015-01-01" });
        const ts = (d.transactions as Json[] | undefined) ?? [];
        for (const t of ts) txns.set(String(t.id), { accountId: a.id, ...t });
        if (ts.length < 500) break;
      }
    }
    // no credit product (or endpoint not available for this token): skip
    const credit = yield* mercury(token, "/credit").pipe(
      Effect.map((d) => (d.accounts as Json[] | undefined) ?? []),
      Effect.catchTag("ConnectorError", () => Effect.succeed([] as Json[])),
    );
    for (const [i, c] of credit.filter((x) => x.status !== "deleted").entries()) {
      // ponytail: Mercury reports what you owe as a positive number; card rows sum negative, so the books' balance is -owed
      const owed = Math.abs(num(c.currentBalance));
      const float = J.isRawJSON(c.currentBalance) || !Number.isInteger(owed);
      accounts.push({
        id: c.id,
        name: "Mercury Credit" + (i ? ` ${i + 1}` : ""),
        kind: "credit",
        currentBalance: float ? J.rawJSON(`${-owed}${Number.isInteger(owed) ? ".0" : ""}`) : -owed,
      });
      for (const t of yield* cursorPages(token, "/transactions", "transactions", { accountId: String(c.id), limit: 1000, start: "2015-01-01" }))
        txns.set(String(t.id), { accountId: c.id, ...t });
    }
    const at = (t: Json) => str(t.postedAt || t.createdAt || "");
    const transactions = [...txns.values()].sort((x, y) => (at(x) < at(y) ? -1 : at(x) > at(y) ? 1 : 0));
    yield* writeInbox(dir, file, { source: `Mercury API sync ${now().slice(0, 10)}`, exportedAt: now(), accounts, transactions });
    // older exports fully contained in the sync would double their reconciliation rows: archive them
    yield* Effect.promise(async () => {
      const inbox = path.join(dir, "inbox");
      for (const f of await fs.readdir(inbox)) {
        if (!/^mercury-.*\.json$/.test(f) || f.endsWith("-sync.json")) continue; // this or another Mercury connection's live sync
        const old = await readJson(path.join(inbox, f));
        const ts = old?.transactions;
        if (!Array.isArray(ts) || !ts.every((t: Json) => t && "id" in t)) continue;
        if (ts.every((t: Json) => txns.has(String(t.id)))) {
          await fs.mkdir(path.join(dir, "archive"), { recursive: true });
          await fs.rename(path.join(inbox, f), path.join(dir, "archive", f));
        }
      }
    });
    return accounts.map((a) => String(a.name));
  });

// ---------- Israeli banks and cards ----------
/** Scrape one company and write inbox/<file>. Banks only show about a year, so older rows of the previous sync are kept. */
export const scraperSync = (dir: string, company: string, creds: Record<string, string>, file: string) =>
  Effect.gen(function* () {
    const d = new Date();
    const start = isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 365));
    const r = yield* scrape({ action: "scrape", companyId: company, credentials: creds, startDate: start });
    const accts: ScrapedAccount[] = r.accounts ?? [];
    const prev = yield* Effect.promise(() => readJson(path.join(dir, "inbox", file)));
    const old = Array.isArray(prev?.accounts) ? (prev.accounts as ScrapedAccount[]) : [];
    const sig = (t: ScrapedTxn) => JSON.stringify([String(t.date ?? "").slice(0, 10), t.chargedAmount ?? null, t.description ?? null, t.identifier ?? null]);
    const fresh = new Set(accts.flatMap((a) => (a.txns ?? []).map(sig)));
    for (const oa of old) {
      // before the new window, completed, and not seen again: history the bank no longer shows
      const keep = (oa.txns ?? []).filter((t) => String(t.date ?? "").slice(0, 10) < start && t.status !== "pending" && !fresh.has(sig(t)));
      if (!keep.length) continue;
      const na = accts.find((a) => a.accountNumber === oa.accountNumber);
      if (na) na.txns = [...keep, ...(na.txns ?? [])];
      else accts.push({ ...oa, txns: keep });
    }
    const name = r.name || company;
    yield* writeInbox(dir, file, { source: "scraper", companyId: company, name, syncedAt: now(), startDate: start, accounts: accts });
    return accts.map((a) => `${name} ••${last4(a.accountNumber)}`);
  });

export const onezeroSync = (dir: string, s: Record<string, string>, file = "onezero-sync.json") =>
  Effect.gen(function* () {
    const credentials = { email: s.email!, password: s.password!, otpLongTermToken: s.otpLongTermToken! };
    const r = yield* scrape({ action: "scrape", companyId: "oneZero", credentials }); // library caps history at one year
    const accts = r.accounts ?? [];
    yield* writeInbox(dir, file, { source: "onezero", syncedAt: now(), accounts: accts });
    return accts.map((a) => `One Zero ••${last4(a.accountNumber)}`);
  });

const runSync = (dir: string, key: string, c: Conn) => {
  const t = kind(key),
    f = inboxFile(key),
    s = c.secret ?? {};
  if (t === "mercury") return mercurySync(dir, s.token ?? "", f);
  if (t === "onezero") return onezeroSync(dir, s, f);
  return scraperSync(dir, t, s, f);
};

/** Syncs one connection, records lastSync/lastError, saves. Returns the error message or null. */
const syncOne = (e: string, conns: Record<string, Conn>, key: string) =>
  Effect.gen(function* () {
    const store = yield* ConnectionStore;
    const c = conns[key]!;
    const r = yield* runSync(store.dir(e), key, c).pipe(
      Effect.map((accounts) => ({ accounts })),
      Effect.catchTag("ConnectorError", (x) => Effect.succeed({ error: x.message })),
      // never the defect's message: it could carry request data
      Effect.catchDefect((d) => Effect.succeed({ error: `Sync failed: ${(d as { code?: string; name?: string })?.code ?? (d as Error)?.name ?? "Error"}` })),
    );
    if ("accounts" in r) Object.assign(c, { accounts: r.accounts, lastSync: now(), lastError: null });
    else c.lastError = r.error;
    yield* save(e, conns);
    return c.lastError ?? null;
  });

// ---------- the API ----------
export interface Status {
  provider: string;
  type: string;
  connected: boolean;
  pending: boolean;
  lastSync: string | null;
  lastError: string | null;
  accounts: string[];
  file: string;
}

/** Non-secret view of every connection this entity has. Works while the vault is locked: a sealed row then counts as connected. */
export const status = (e: string) =>
  Effect.gen(function* () {
    const [store, vault] = [yield* ConnectionStore, yield* ConnectionVault];
    const conns = yield* store.rows(e);
    const out: Status[] = [];
    for (const k of Object.keys(conns).sort()) {
      const c = yield* vault
        .reveal(e, k, conns[k]!)
        .pipe(Effect.orElseSucceed(() => ({ ...conns[k]!, secret: conns[k]!.secret ?? (conns[k]!.sealed ? {} : undefined) })));
      out.push({
        provider: k,
        type: kind(k),
        connected: !!c.secret,
        pending: !!c.pending,
        lastSync: c.lastSync ?? null,
        lastError: c.lastError ?? null,
        accounts: c.accounts ?? [],
        file: inboxFile(k),
      });
    }
    return out;
  });

export type Body = Record<string, unknown>;
type Result = { error: string } | Record<string, never>;
const err = (error: string): Result => ({ error });

/** Sync one connection (exact key) or, without one, every connected one. Errors of several are joined with "; ". */
export const sync = (e: string, provider = "") =>
  Effect.gen(function* () {
    const p = provider.trim();
    if (p && !KEY.test(p)) return err("Unknown provider");
    const conns = yield* load(e);
    if (p && !conns[p]?.secret) return err(`${p} isn't connected`);
    const keys = p ? [p] : Object.keys(conns).filter((k) => conns[k]!.secret);
    const errs: string[] = [];
    for (const k of keys) {
      const x = yield* syncOne(e, conns, k);
      if (x) errs.push(x);
    }
    return errs.length ? err(errs.join("; ")) : ({} as Result);
  });

export const disconnect = (e: string, provider: string) =>
  Effect.gen(function* () {
    const p = provider.trim();
    if (p && !KEY.test(p)) return err("Unknown provider");
    const conns = yield* load(e);
    if (!(p in conns)) return err(`${p} isn't connected`);
    delete conns[p];
    yield* save(e, conns);
    return {} as Result;
  });

/** body: {provider: "<provider>" or "<provider>:<n>", credentials: {...}, otpCode?}. Connecting a provider that is already
 * connected adds "<provider>:2", "<provider>:3", ...; nothing is saved for a bank whose login didn't work. */
export const connect = (e: string, body: Body) =>
  Effect.gen(function* () {
    const store = yield* ConnectionStore;
    let p = str(body.provider || "").trim();
    if (p && !KEY.test(p)) return err("Unknown provider");
    if (!p) return err("Pick a bank");
    const conns = yield* load(e);
    // already connected: this is another login at the same bank (an OTP answer is for the pending key itself)
    if (!p.includes(":") && conns[p]?.secret && !body.otpCode) {
      for (let n = 2; n < 1000; n++)
        if (!(`${p}:${n}` in conns)) {
          p = `${p}:${n}`;
          break;
        }
    }
    const t = kind(p);
    const cr = (body.credentials && typeof body.credentials === "object" ? body.credentials : {}) as Body;
    const field = (k: string) => str(cr[k] || body[k] || "").trim(); // top-level fields: what older callers send
    if (t === "mercury") {
      const token = field("token");
      if (!token) return err("Paste the API token");
      yield* mercury(token, "/accounts", { limit: 1 }); // validates before saving
      conns[p] = { ...conns[p], secret: { token }, lastError: null };
    } else if (t === "onezero" && body.otpCode) {
      // One Zero step 2
      const pend = conns[p]?.pending;
      if (!pend) return err("Start again: enter email, password and phone first");
      const r = yield* scrape({ action: "verify", companyId: "oneZero", otpContext: pend.otpContext, otpCode: str(body.otpCode).trim() });
      const c = conns[p]!;
      delete c.pending;
      Object.assign(c, { secret: { email: pend.email, password: pend.password, otpLongTermToken: r.otpLongTermToken ?? "" }, lastError: null });
    } else if (t === "onezero") {
      // One Zero step 1: sends the SMS
      const f = { email: field("email"), password: field("password"), phoneNumber: field("phoneNumber") };
      if (!f.email || !f.password || !f.phoneNumber) return err("Email, password and phone number are all required");
      if (f.phoneNumber.startsWith("0")) f.phoneNumber = "+972" + f.phoneNumber.slice(1).replaceAll("-", ""); // 050-... -> +97250...
      const r = yield* scrape({ action: "trigger", companyId: "oneZero", phoneNumber: f.phoneNumber });
      conns[p] = { ...conns[p], pending: { email: f.email, password: f.password, otpContext: r.otpContext ?? "" } };
      yield* save(e, conns);
      return {} as Result;
    } else {
      // any israeli-bank-scrapers company: log in and sync first; nothing is saved unless that works
      const creds: Record<string, string> = {};
      for (const [k, v] of Object.entries(cr)) if ((typeof v === "string" || Number.isInteger(v)) && String(v).trim()) creds[k] = String(v).trim();
      const accounts = yield* scraperSync(store.dir(e), t, creds, inboxFile(p));
      conns[p] = { secret: creds, accounts, lastSync: now(), lastError: null };
      yield* save(e, conns);
      return {} as Result;
    }
    yield* save(e, conns);
    const x = yield* syncOne(e, conns, p); // first sync right away
    return x ? err(x) : ({} as Result);
  }).pipe(Effect.catchTag("ConnectorError", (x) => Effect.succeed(err(x.message))));

const PATHS: Record<string, (e: string, body: Body) => Effect.Effect<Result, VaultError, ConnectionStore | ConnectionVault | Scraper>> = {
  "/api/connect": connect,
  "/api/sync": (e, b) => sync(e, str(b.provider || "")),
  "/api/disconnect": (e, b) => disconnect(e, str(b.provider || "")),
};

/** books.py's connectors.handle: null = not ours, {error} = failed, {} = done (the server then sends state). */
export const handle = (e: string, p: string, body: Body) => (Object.hasOwn(PATHS, p) ? PATHS[p]!(e, body) : Effect.succeed(null));
