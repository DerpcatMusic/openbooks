// Port of test_connectors.py's connector cases (the reader/CSV cases belong to the readers' tests), plus Mercury API,
// One Zero OTP and bridge coverage. No real credentials or network: fetch and the scraper are faked.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ConnectionStore, ConnectionVault, Scraper, connect, disconnect, handle, mercurySync, scrape, status, sync } from "./index.ts";
import type { Conn, ScrapeCmd, ScrapeResult } from "./index.ts";
import { run } from "./scrape.ts";

let dir: string;
beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbooks-conn-"))));
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

/** In-memory ConnectionStore + a fake vault with storage's shape (reveal/conceal, VaultLocked). "unlocked" seals secret/pending into `sealed`. */
function memStore(mode: "plaintext" | "unlocked" | "locked" = "plaintext") {
  let rows: Record<string, Conn> = {};
  const locked = { _tag: "VaultLocked" as const };
  const store = Layer.succeed(ConnectionStore)({
    dir: () => dir,
    rows: () => Effect.sync(() => structuredClone(rows)),
    putRows: (_e, r) => Effect.sync(() => void (rows = structuredClone(r))),
  });
  const vault = Layer.succeed(ConnectionVault)({
    reveal: (_e, _p, row) => {
      if (row.sealed === undefined) return Effect.succeed(row);
      if (mode === "locked") return Effect.fail(locked);
      const { sealed, ...rest } = row;
      return Effect.succeed({ ...rest, ...JSON.parse(sealed as string) });
    },
    conceal: (_e, _p, row) => {
      if (mode === "plaintext") return Effect.succeed(row);
      if (mode === "locked") return Effect.fail(locked);
      const { secret, pending, ...rest } = row;
      return Effect.succeed({ ...rest, sealed: JSON.stringify({ secret, pending }) });
    },
  });
  const set = (r: Record<string, Conn>) => void (rows = r);
  return { layer: Layer.mergeAll(store, vault), rows: () => rows, set };
}
const fakeScraper = (f: (cmd: ScrapeCmd) => ScrapeResult) => {
  const calls: ScrapeCmd[] = [];
  return { calls, layer: Layer.succeed(Scraper)({ run: (cmd) => Effect.sync(() => (calls.push(cmd), f(cmd))) }) };
};
type R = ConnectionStore | ConnectionVault | Scraper;
const go = <A, E>(eff: Effect.Effect<A, E, R>, store: Layer.Layer<ConnectionStore | ConnectionVault>, scraper: Layer.Layer<Scraper>) =>
  Effect.runPromise(eff.pipe(Effect.provide(Layer.mergeAll(store, scraper))));
const inbox = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, "inbox", f), "utf8"));
const put = (f: string, o: unknown) => {
  fs.mkdirSync(path.join(dir, "inbox"), { recursive: true });
  fs.writeFileSync(path.join(dir, "inbox", f), JSON.stringify(o));
};
const T = (k: Record<string, unknown>) => ({ type: "normal", status: "completed", originalCurrency: "ILS", ...k });
const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10) + "T00:00:00.000Z";

describe("scrape command checks (scrape.mjs)", () => {
  it("rejects bad commands before touching the network, never echoing credentials", async () => {
    expect((await run({ action: "scrape", companyId: "nope", credentials: {} })).errorMessage).toContain("unknown companyId");
    const r = await run({ action: "scrape", companyId: "discount", credentials: { id: "000000018", password: "hunter2pw" } });
    expect(r.errorType).toBe("INVALID_INPUT");
    expect(r.errorMessage).toBe("missing login fields: num");
    expect(JSON.stringify(r)).not.toContain("hunter2pw");
    expect((await run({ action: "trigger", companyId: "leumi", phoneNumber: "+972500000000" })).errorMessage).toBe("trigger is only for One Zero");
    expect((await run({ action: "scrape", companyId: "oneZero", credentials: { email: "a@b.c", password: "x" } })).errorMessage).toContain("otpLongTermToken");
    expect((await run("nope")).errorMessage).toBe("stdin is not one JSON command");
  });

  it("the subprocess bridge gives the same answers as the in-process scraper", async () => {
    const cmd: ScrapeCmd = { action: "scrape", companyId: "discount", credentials: { id: "000000018", password: "hunter2pw" } };
    const viaBridge = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* Scraper).run(cmd);
      }).pipe(Effect.provide(Scraper.bridge)),
    );
    const viaDirect = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* Scraper).run(cmd);
      }).pipe(Effect.provide(Scraper.direct)),
    );
    expect(viaBridge).toEqual(viaDirect);
    expect(viaBridge.errorMessage).toBe("missing login fields: num");
  }, 30_000);
});

describe("connect, sync, disconnect", () => {
  it("validates the provider key", async () => {
    const s = memStore();
    expect(await go(connect("t", { provider: "../etc" }), s.layer, Scraper.direct)).toEqual({ error: "Unknown provider" });
    expect(await go(handle("t", "/api/sync", { provider: "a b" }), s.layer, Scraper.direct)).toEqual({ error: "Unknown provider" });
    expect(await go(handle("t", "/api/state", {}), s.layer, Scraper.direct)).toBeNull();
    expect(await go(connect("t", {}), s.layer, Scraper.direct)).toEqual({ error: "Pick a bank" });
  });

  it("a failed login saves nothing and never echoes credentials (real scraper, rejected before the network)", async () => {
    const s = memStore();
    const r = await go(connect("t", { provider: "yahav", credentials: { username: "someuser", password: "s3cretpass" } }), s.layer, Scraper.direct);
    expect("error" in r && r.error).toContain("nationalID");
    expect(JSON.stringify(r)).not.toMatch(/s3cretpass|someuser/);
    const r2 = await go(connect("t", { provider: "nosuchbank", credentials: { x: "y" } }), s.layer, Scraper.direct);
    expect("error" in r2 && r2.error).toContain("unknown companyId");
    expect(s.rows()).toEqual({});
  });

  it("scraper errors never echo credentials", async () => {
    const f = fakeScraper(() => ({ success: false, errorType: "GENERIC", errorMessage: "login as someuser with s3cretpass failed" }));
    const exit = await Effect.runPromise(
      Effect.flip(scrape({ action: "scrape", companyId: "leumi", credentials: { username: "someuser", password: "s3cretpass" } })).pipe(
        Effect.provide(f.layer),
      ),
    );
    expect(exit.message).toBe("leumi: login as ••• with ••• failed");
    const known = fakeScraper(() => ({ success: false, errorType: "INVALID_PASSWORD", name: "Leumi" }));
    const x = await Effect.runPromise(Effect.flip(scrape({ action: "scrape", companyId: "leumi" })).pipe(Effect.provide(known.layer)));
    expect(x.message).toBe("Leumi: the bank rejected the login details");
  });

  it("keeps history the bank no longer shows; a second login at the same bank gets its own key and file", async () => {
    const s = memStore();
    put("leumi-sync.json", {
      source: "scraper",
      companyId: "leumi",
      accounts: [
        {
          accountNumber: "777",
          txns: [
            T({ identifier: 1, date: day(500), processedDate: day(500), chargedAmount: -1, description: "old" }),
            T({ identifier: 3, date: day(450), chargedAmount: -9, description: "old pending", status: "pending" }),
          ],
        },
        { accountNumber: "888", txns: [T({ identifier: 4, date: day(400), chargedAmount: 2, description: "closed account" })] },
      ],
    });
    const f = fakeScraper(() => ({
      success: true,
      name: "Leumi",
      accounts: [{ accountNumber: "777", txns: [T({ identifier: 2, date: day(5), processedDate: day(5), chargedAmount: 5, description: "new" })] }],
    }));
    const L = [s.layer, f.layer] as const;
    expect(await go(connect("t", { provider: "leumi", credentials: { username: "user-one", password: "pass-one-xyz", junk: "  " } }), ...L)).toEqual({});
    expect(f.calls[0]!.credentials).toEqual({ username: "user-one", password: "pass-one-xyz" });
    const written = inbox("leumi-sync.json");
    expect(written.accounts[0].txns.map((t: { description: string }) => t.description)).toEqual(["old", "new"]); // pending never kept
    expect(written.accounts[1].accountNumber).toBe("888");
    expect(fs.readdirSync(path.join(dir, "inbox")).filter((n) => n.endsWith(".tmp"))).toEqual([]); // atomic write leaves no temp file

    expect(await go(connect("t", { provider: "leumi", credentials: { username: "user-two", password: "pass-two-xyz" } }), ...L)).toEqual({});
    expect(Object.keys(s.rows()).sort()).toEqual(["leumi", "leumi:2"]);
    expect(fs.existsSync(path.join(dir, "inbox", "leumi-2-sync.json"))).toBe(true);
    const st = await go(status("t"), ...L);
    expect(st.map((x) => [x.provider, x.type, x.connected, x.accounts])).toEqual([
      ["leumi", "leumi", true, ["Leumi ••777", "Leumi ••888"]],
      ["leumi:2", "leumi", true, ["Leumi ••777"]],
    ]);
    expect(st[1]!.file).toBe("leumi-2-sync.json");
    expect(JSON.stringify(st)).not.toMatch(/pass-one-xyz|user-one|pass-two-xyz|user-two/);

    expect(await go(handle("t", "/api/sync", {}), ...L)).toEqual({});
    expect(f.calls.length).toBe(4);
    expect(await go(handle("t", "/api/disconnect", { provider: "leumi:2" }), ...L)).toEqual({});
    expect(Object.keys(s.rows())).toEqual(["leumi"]);
    expect(await go(disconnect("t", "leumi:2"), ...L)).toEqual({ error: "leumi:2 isn't connected" });
    expect(await go(sync("t", "max"), ...L)).toEqual({ error: "max isn't connected" });
  });

  it("a failed sync records lastError and joins errors", async () => {
    const s = memStore();
    let ok = true;
    const f = fakeScraper(() => (ok ? { success: true, name: "Max", accounts: [] } : { success: false, errorType: "TIMEOUT", name: "Max" }));
    await go(connect("t", { provider: "max", credentials: { username: "u1", password: "p1" } }), s.layer, f.layer);
    await go(connect("t", { provider: "max", credentials: { username: "u2", password: "p2" } }), s.layer, f.layer);
    ok = false;
    const msg = "Max: the bank's website timed out (try again; it may be down or have changed)";
    expect(await go(sync("t"), s.layer, f.layer)).toEqual({ error: `${msg}; ${msg}` });
    expect(s.rows()["max:2"]!.lastError).toBe(msg);
    expect(s.rows()["max"]!.secret).toEqual({ username: "u1", password: "p1" });
  });

  it("secrets go through the vault: sealed when saved, opened to sync, VaultLocked when locked; status works either way", async () => {
    const s = memStore("unlocked");
    const f = fakeScraper(() => ({ success: true, name: "Max", accounts: [{ accountNumber: "5678" }] }));
    expect(await go(connect("t", { provider: "max", credentials: { username: "u1", password: "p1" } }), s.layer, f.layer)).toEqual({});
    const row = s.rows().max!;
    expect(row.secret).toBeUndefined();
    expect(row.sealed).toBeTruthy();
    expect(row.accounts).toEqual(["Max ••5678"]); // status fields stay plaintext
    expect(await go(sync("t", "max"), s.layer, f.layer)).toEqual({});
    expect(f.calls[1]!.credentials).toEqual({ username: "u1", password: "p1" });

    const locked = memStore("locked");
    locked.set(structuredClone(s.rows()));
    const e = await Effect.runPromise(Effect.flip(sync("t")).pipe(Effect.provide(Layer.mergeAll(locked.layer, f.layer))));
    expect(e._tag).toBe("VaultLocked");
    const e2 = await Effect.runPromise(
      Effect.flip(connect("t", { provider: "max", credentials: { username: "u2", password: "p2" } })).pipe(
        Effect.provide(Layer.mergeAll(locked.layer, f.layer)),
      ),
    );
    expect(e2._tag).toBe("VaultLocked");
    expect((await go(status("t"), locked.layer, f.layer))[0]).toMatchObject({ provider: "max", connected: true, pending: false, accounts: ["Max ••5678"] });
  });
});

describe("One Zero OTP", () => {
  it("step 1 sends the SMS and keeps a pending login; step 2 saves the long-term token and syncs", async () => {
    const s = memStore();
    const f = fakeScraper((cmd) =>
      cmd.action === "trigger"
        ? { success: true, otpContext: "ctx-123" }
        : cmd.action === "verify"
          ? { success: true, otpLongTermToken: "long-token" }
          : { success: true, name: "One Zero", accounts: [{ accountNumber: "1234567", txns: [] }] },
    );
    const L = [s.layer, f.layer] as const;
    expect(await go(connect("t", { provider: "onezero", credentials: { email: "a@b.c", password: "pw" } }), ...L)).toEqual({
      error: "Email, password and phone number are all required",
    });
    expect(await go(connect("t", { provider: "onezero", otpCode: "1" }), ...L)).toEqual({ error: "Start again: enter email, password and phone first" });
    expect(await go(connect("t", { provider: "onezero", credentials: { email: "a@b.c", password: "pw", phoneNumber: "050-123-4567" } }), ...L)).toEqual({});
    expect(f.calls[0]).toEqual({ action: "trigger", companyId: "oneZero", phoneNumber: "+972501234567" });
    expect(s.rows().onezero).toEqual({ pending: { email: "a@b.c", password: "pw", otpContext: "ctx-123" } });
    expect((await go(status("t"), ...L))[0]).toMatchObject({ provider: "onezero", connected: false, pending: true });

    expect(await go(connect("t", { provider: "onezero", otpCode: " 654321 " }), ...L)).toEqual({});
    expect(f.calls[1]).toEqual({ action: "verify", companyId: "oneZero", otpContext: "ctx-123", otpCode: "654321" });
    expect(f.calls[2]).toEqual({ action: "scrape", companyId: "oneZero", credentials: { email: "a@b.c", password: "pw", otpLongTermToken: "long-token" } });
    const c = s.rows().onezero!;
    expect(c.pending).toBeUndefined();
    expect(c.secret).toEqual({ email: "a@b.c", password: "pw", otpLongTermToken: "long-token" });
    expect(c.accounts).toEqual(["One Zero ••4567"]);
    expect(inbox("onezero-sync.json")).toMatchObject({ source: "onezero", accounts: [{ accountNumber: "1234567" }] });
  });

  it("a wrong code is masked and keeps the pending login", async () => {
    const s = memStore();
    const f = fakeScraper((cmd) =>
      cmd.action === "trigger"
        ? { success: true, otpContext: "ctx-abc" }
        : { success: false, errorType: "GENERIC", errorMessage: "code 999111 for ctx-abc rejected" },
    );
    await go(connect("t", { provider: "onezero", email: "a@b.c", password: "pw", phoneNumber: "+972500000000" }), s.layer, f.layer); // top-level fields still accepted
    expect(await go(connect("t", { provider: "onezero", otpCode: "999111" }), s.layer, f.layer)).toEqual({ error: "oneZero: code ••• for ••• rejected" });
    expect(s.rows().onezero!.pending?.otpContext).toBe("ctx-abc");
  });
});

describe("Mercury", () => {
  type Route = (u: URL) => unknown;
  function mockFetch(route: Route) {
    const seen: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit) => {
        const u = new URL(input);
        seen.push(u);
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-secret");
        const r = route(u);
        return typeof r === "number" ? new Response("{}", { status: r }) : new Response(typeof r === "string" ? r : JSON.stringify(r), { status: 200 });
      }),
    );
    return seen;
  }
  const dep = (i: number) => ({ id: `d${i}`, amount: -1, postedAt: `2025-01-${String((i % 28) + 1).padStart(2, "0")}` });

  it("syncs deposit (offset pages) and credit (cursor pages) accounts, keeps float literals, archives covered exports", async () => {
    const seen = mockFetch((u) => {
      const p = u.pathname.replace("/api/v1", "");
      if (p === "/accounts")
        return {
          accounts: [
            { id: "A", accountNumber: "9876543210", kind: "checking", currentBalance: 10.5 },
            { id: "B", nickname: "Ops" },
          ],
        };
      if (p === "/account/A/transactions") {
        const off = Number(u.searchParams.get("offset"));
        return { transactions: off === 0 ? Array.from({ length: 500 }, (_, i) => dep(i)) : [dep(500)] };
      }
      if (p === "/account/B/transactions") return '{"transactions":[{"id":"b1","amount":-20.0,"createdAt":"2024-12-31"}]}';
      if (p === "/credit") return '{"accounts":[{"id":"C","status":"active","currentBalance":120.0},{"id":"X","status":"deleted"}]}';
      if (p === "/transactions") {
        const after = u.searchParams.get("start_after");
        return after
          ? { transactions: [{ id: "c2", amount: -3, postedAt: "2025-02-02" }], page: { nextPage: "c2" } }
          : { transactions: [{ id: "c1", amount: -2 }], page: { nextPage: "c1" } };
      }
      return 404;
    });
    put("mercury-old.json", { transactions: [{ id: "d1" }, { id: "b1" }] });
    put("mercury-partly.json", { transactions: [{ id: "d1" }, { id: "zz" }] });
    put("mercury-2-sync.json", { transactions: [{ id: "d1" }] });

    const names = await Effect.runPromise(mercurySync(dir, "tok-secret", "mercury-sync.json"));
    expect(names).toEqual(["Mercury Checking ••3210", "Ops", "Mercury Credit"]);
    const raw = fs.readFileSync(path.join(dir, "inbox", "mercury-sync.json"), "utf8");
    expect(raw).toContain('"amount": -20.0'); // Python's json round trip keeps it a float: str(-20.0) feeds the uid
    expect(raw).toContain('"currentBalance": -120.0');
    const out = JSON.parse(raw);
    expect(out.transactions.length).toBe(504);
    expect(out.transactions[0]).toEqual({ accountId: "C", id: "c1", amount: -2 }); // no date sorts first
    expect(out.transactions[1]).toMatchObject({ id: "b1", accountId: "B" });
    expect(out.accounts.map((a: { kind: string | null }) => a.kind)).toEqual(["checking", null, "credit"]);
    expect(seen.filter((u) => u.pathname.endsWith("/account/A/transactions")).map((u) => u.searchParams.get("offset"))).toEqual(["0", "500"]);
    expect(fs.readdirSync(path.join(dir, "archive"))).toEqual(["mercury-old.json"]);
    expect(fs.readdirSync(path.join(dir, "inbox")).sort()).toEqual(["mercury-2-sync.json", "mercury-partly.json", "mercury-sync.json"]);
  });

  it("validates the token before saving; a refused token saves nothing and isn't echoed", async () => {
    const s = memStore();
    mockFetch(() => 401);
    const r = await go(connect("t", { provider: "mercury", credentials: { token: "tok-secret" } }), s.layer, Scraper.direct);
    expect(r).toEqual({ error: "Mercury refused the token (401). Check it's an active read-only API token." });
    expect(s.rows()).toEqual({});
    expect(await go(connect("t", { provider: "mercury" }), s.layer, Scraper.direct)).toEqual({ error: "Paste the API token" });
  });

  it("connects and syncs right away; a credit endpoint error is skipped, a later API error lands in lastError", async () => {
    const s = memStore();
    let down = false;
    mockFetch((u) => {
      const p = u.pathname.replace("/api/v1", "");
      if (down) return 500;
      if (p === "/accounts") return { accounts: [{ id: "A", accountNumber: "1111" }] };
      if (p === "/credit") return 403;
      return { transactions: [] };
    });
    expect(await go(connect("t", { provider: "mercury", token: "tok-secret" }), s.layer, Scraper.direct)).toEqual({});
    expect(s.rows().mercury).toMatchObject({ secret: { token: "tok-secret" }, accounts: ["Mercury Account ••1111"], lastError: null });
    down = true;
    expect(await go(sync("t", "mercury"), s.layer, Scraper.direct)).toEqual({ error: "Mercury API 500 on /accounts" });
    expect(s.rows().mercury!.lastError).toBe("Mercury API 500 on /accounts");
  });
});
