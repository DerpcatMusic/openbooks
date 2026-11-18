// SimpleFIN, Wise and Enable Banking connectors against a fake fetch (never the real APIs), and the rows the scraper reader makes of their files.
import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { read } from "../read.ts";
import { ebJwt } from "./banks.ts";
import { ConnectionStore, ConnectionVault, Scraper, connect, enableBankingCallback, status, sync } from "./index.ts";
import type { Conn } from "./index.ts";

let dir: string;
beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbooks-banks-"))));
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

/** In-memory store with a vault that seals secret/pending into `sealed`, like the real one. */
function memStore() {
  let rows: Record<string, Conn> = {};
  const store = Layer.succeed(ConnectionStore)({
    dir: () => dir,
    rows: () => Effect.sync(() => structuredClone(rows)),
    putRows: (_e, r) => Effect.sync(() => void (rows = structuredClone(r))),
  });
  const vault = Layer.succeed(ConnectionVault)({
    reveal: (_e, _p, row) => {
      if (row.sealed === undefined) return Effect.succeed(row);
      const { sealed, ...rest } = row;
      return Effect.succeed({ ...rest, ...JSON.parse(sealed as string) });
    },
    conceal: (_e, _p, row) => {
      const { secret, pending, ...rest } = row;
      return Effect.succeed({ ...rest, sealed: JSON.stringify({ secret, pending }) });
    },
  });
  return { layer: Layer.mergeAll(store, vault, Scraper.direct), rows: () => rows };
}
const go = <A, E>(eff: Effect.Effect<A, E, ConnectionStore | ConnectionVault | Scraper>, l: Layer.Layer<ConnectionStore | ConnectionVault | Scraper>) =>
  Effect.runPromise(eff.pipe(Effect.provide(l)));
const inbox = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, "inbox", f), "utf8"));
const rowsOf = (f: string) =>
  read({ name: f, bytes: fs.readFileSync(path.join(dir, "inbox", f)) }, { meta: { name: "t" }, profile: {}, csvProfiles: [], siblingPdfPeriods: () => [] });

type Call = { method: string; url: URL; headers: Record<string, string>; body: unknown };
/** route returns a JSON body, a number (status), or {status, body, headers, text}. */
function fakeFetch(route: (c: Call) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const c: Call = {
        method: init.method ?? "GET",
        url: new URL(input),
        headers: Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
        body: init.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(c);
      const r = route(c) as { status?: number; text?: string; body?: unknown; headers?: Record<string, string> } | number | string;
      if (typeof r === "number") return new Response("{}", { status: r });
      if (r && typeof r === "object" && "status" in r) return new Response(r.text ?? JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
      return new Response(JSON.stringify(r), { status: 200 });
    }),
  );
  return calls;
}

describe("SimpleFIN / Lunch Flow", () => {
  const ACCESS = "https://user1:pa%24s@bridge.fake/simplefin";
  const token = Buffer.from("https://bridge.fake/simplefin/claim/ONCE").toString("base64");
  const unix = (d: string) => Date.parse(d + "T12:00:00Z") / 1000;
  const acct = (extra: Record<string, unknown> = {}) => ({
    errlist: [],
    connections: [],
    accounts: [
      {
        id: "ACT-0001",
        name: "Checking",
        conn_id: "c1",
        currency: "USD",
        balance: "100.50",
        "balance-date": 1,
        transactions: [
          { id: "t1", posted: unix("2026-10-01"), amount: "-20.25", description: "COFFEE" },
          { id: "t2", posted: unix("2026-10-02"), amount: "120.75", description: "PAYROLL" },
          { id: "t3", posted: 0, amount: "-5", description: "HOLD", pending: true },
        ],
      },
    ],
    ...extra,
  });

  it("claims the setup token once, authenticates with the embedded credentials, and the reader reconciles the balance", async () => {
    const s = memStore();
    const calls = fakeFetch((c) => (c.method === "POST" ? { status: 200, text: ACCESS } : acct()));
    expect(await go(connect("t", { provider: "simplefin", credentials: { setupToken: token } }), s.layer)).toEqual({});
    expect(calls[0]).toMatchObject({ method: "POST" });
    expect(calls[0]!.url.href).toBe("https://bridge.fake/simplefin/claim/ONCE");
    const get = calls[1]!;
    expect(get.url.pathname).toBe("/simplefin/accounts");
    expect(get.url.searchParams.has("start-date")).toBe(true);
    expect(get.headers.authorization).toBe("Basic " + Buffer.from("user1:pa$s").toString("base64"));
    expect(get.url.username).toBe(""); // credentials travel in the header, not the URL
    expect(s.rows().simplefin!.sealed).toBeTruthy();
    expect(JSON.stringify(await go(status("t"), s.layer))).not.toContain("pa%24s");
    const { rows, checks } = rowsOf("simplefin-sync.json");
    expect(rows.map((r) => [r.date, r.amount, r.desc])).toEqual([
      ["2026-10-01", -20.25, "COFFEE"],
      ["2026-10-02", 120.75, "PAYROLL"],
    ]); // the pending hold is left for the sync after it posts
    expect(checks).toMatchObject([{ total: 100.5, parsed: 100.5, balance: true }]);
    expect(inbox("simplefin-sync.json").accounts[0]).toMatchObject({ currency: "USD", balance: 100.5 });
  });

  it("a claimed or unknown token (403) and a malformed one are refused without saving", async () => {
    const s = memStore();
    fakeFetch(() => 403);
    expect((await go(connect("t", { provider: "simplefin", credentials: { setupToken: token } }), s.layer)) as { error: string }).toMatchObject({
      error: expect.stringContaining("already claimed"),
    });
    expect(await go(connect("t", { provider: "simplefin", credentials: { setupToken: "%%%" } }), s.layer)).toEqual({
      error: "That isn't a SimpleFIN setup token",
    });
    expect(s.rows().simplefin).toBeUndefined();
  });

  it("an errors array is shown, the data that did arrive is kept, and 90-day windows cover the first year", async () => {
    const s = memStore();
    let get = 0;
    const calls = fakeFetch((c) => {
      if (c.method === "POST") return { status: 200, text: ACCESS };
      return ++get === 1 ? acct({ errlist: [{ code: "con.auth", msg: "Log in to your bank again" }] }) : { errlist: [], connections: [], accounts: [] };
    });
    const r = await go(connect("t", { provider: "simplefin", credentials: { setupToken: token } }), s.layer);
    expect(r).toEqual({ error: "SimpleFIN: Log in to your bank again" });
    expect(inbox("simplefin-sync.json").accounts[0].txns).toHaveLength(2);
    const gets = calls.filter((c) => c.method === "GET");
    expect(gets.length).toBe(5); // 365 days in windows of at most 90
    for (const g of gets) expect(Number(g.url.searchParams.get("end-date")) - Number(g.url.searchParams.get("start-date"))).toBeLessThanOrEqual(90 * 86400);
    // the next sync asks only for the time since this one
    calls.length = 0;
    await go(sync("t", "simplefin"), s.layer);
    expect(calls).toHaveLength(1);
    expect(inbox("simplefin-sync.json").accounts[0].txns).toHaveLength(2); // history from before the window is kept
  });

  it("a revoked access URL says so", async () => {
    const s = memStore();
    fakeFetch((c) => (c.method === "POST" ? { status: 200, text: ACCESS } : acct()));
    await go(connect("t", { provider: "simplefin", credentials: { setupToken: token } }), s.layer);
    fakeFetch(() => 403);
    expect(await go(sync("t", "simplefin"), s.layer)).toMatchObject({ error: expect.stringContaining("refused the access URL") });
    expect(s.rows().simplefin!.lastError).not.toMatch(/pa%24s|user1/); // the secret stays inside the sealed part
  });
});

describe("Wise", () => {
  const stmt = (txs: unknown[], end: number) => ({ transactions: txs, endOfStatementBalance: { value: end, currency: "EUR" } });
  const tx = (ref: string, v: number, description: string, type = v < 0 ? "DEBIT" : "CREDIT") => ({
    date: "2026-10-05T10:00:00.000Z",
    amount: { value: v, currency: "EUR" },
    type,
    details: { description },
    referenceNumber: ref,
  });
  const route =
    (statement: (c: Call) => unknown) =>
    (c: Call): unknown => {
      const p = c.url.pathname;
      if (p === "/v2/profiles") return [{ id: 7, type: "PERSONAL" }];
      if (p === "/v4/profiles/7/balances")
        return [
          { id: 1, currency: "EUR", type: "STANDARD", amount: { value: 90 } },
          { id: 2, currency: "USD", type: "STANDARD", amount: { value: 50 } },
        ];
      if (p.endsWith("/statement.json")) return statement(c);
      return 404;
    };

  it("one account per currency balance; a conversion is out of one balance and into the other; balances reconcile", async () => {
    const s = memStore();
    const seen: Record<string, number> = {};
    const usd = (v: number) => ({ amount: { value: v, currency: "USD" } });
    const calls = fakeFetch(
      route((c) => {
        if (seen[c.url.pathname]) return stmt([], 0); // older windows are empty: the walk back stops
        seen[c.url.pathname] = 1;
        return c.url.pathname.includes("/balance-statements/1/")
          ? stmt([tx("CONVERSION-9", -100, "Converted 100 EUR to 108 USD"), tx("TRANSFER-1", 190, "Salary")], 90)
          : {
              transactions: [
                { ...tx("CONVERSION-9", 108, "Converted 100 EUR to 108 USD"), ...usd(108) },
                { ...tx("CARD-1", -58, "Hotel"), ...usd(-58) },
              ],
              endOfStatementBalance: { value: 50, currency: "USD" },
            };
      }),
    );
    expect(await go(connect("t", { provider: "wise", credentials: { wiseToken: "tok-secret-1" } }), s.layer)).toEqual({});
    expect(calls[0]!.headers.authorization).toBe("Bearer tok-secret-1");
    expect((await go(status("t"), s.layer))[0]!.accounts).toEqual(["Wise ••EUR", "Wise ••USD"]);
    const { rows, checks } = rowsOf("wise-sync.json");
    expect(rows.map((r) => [r.account, r.amount, r.desc])).toEqual([
      ["Wise ••EUR", -100, "Converted 100 EUR to 108 USD"],
      ["Wise ••EUR", 190, "Salary"],
      ["Wise ••USD", 108, "Converted 100 EUR to 108 USD"],
      ["Wise ••USD", -58, "Hotel"],
    ]);
    expect(checks.map((k) => [k.label, k.parsed, k.total])).toEqual([
      ["Wise ••EUR", 90, 90],
      ["Wise ••USD", 50, 50],
    ]);
    expect(inbox("wise-sync.json").accounts.map((a: { currency: string }) => a.currency)).toEqual(["EUR", "USD"]);
  });

  it("a 403 on statements (strong customer authentication) is a clear message that suggests CSV, not a crash", async () => {
    const s = memStore();
    fakeFetch(route(() => ({ status: 403, body: { error: "forbidden" }, headers: { "x-2fa-approval": "abc" } })));
    const r = (await go(connect("t", { provider: "wise", credentials: { wiseToken: "tok-secret-1" } }), s.layer)) as { error: string };
    expect(r.error).toContain("strong customer authentication");
    expect(r.error).toContain("CSV");
    expect(s.rows().wise).toMatchObject({ lastError: r.error }); // saved, with the reason shown on the connection
  });

  it("a refused token is rejected before anything is saved", async () => {
    const s = memStore();
    fakeFetch(() => 401);
    expect(await go(connect("t", { provider: "wise", credentials: { wiseToken: "bad" } }), s.layer)).toEqual({
      error: "Wise refused the API token. Check it's an active personal token.",
    });
    expect(s.rows().wise).toBeUndefined();
  });
});

describe("Enable Banking", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const ORIGIN = "http://127.0.0.1:8787";
  const creds = { appId: "app-1", privateKey, country: "FI", bank: "Nordea" };
  const btx = (id: string, amount: string, ind: "DBIT" | "CRDT", extra: Record<string, unknown> = {}) => ({
    entry_reference: id,
    transaction_amount: { amount, currency: "EUR" },
    credit_debit_indicator: ind,
    booking_date: "2026-10-03",
    remittance_information: ["Invoice 7"],
    ...extra,
  });
  const route = (c: Call): unknown => {
    const p = c.url.pathname;
    if (p === "/aspsps") return { aspsps: [{ name: "Nordea", country: "FI", maximum_consent_validity: 15552000 }] };
    if (p === "/auth") return { url: "https://nordea.fake/login?x=1", authorization_id: "a1" };
    if (p === "/sessions")
      return {
        session_id: "sess-1",
        accounts: [{ uid: "uid-1", account_id: { iban: "FI2112345600000785" }, currency: "EUR" }],
        access: { valid_until: "2027-04-01T00:00:00Z" },
      };
    if (p === "/accounts/uid-1/balances")
      return {
        balances: [
          { balance_type: "ITAV", balance_amount: { amount: "999", currency: "EUR" } },
          { balance_type: "CLBD", balance_amount: { amount: "70.00", currency: "EUR" } },
        ],
      };
    if (p === "/accounts/uid-1/transactions")
      return c.url.searchParams.get("continuation_key") === "k1"
        ? { transactions: [btx("e3", "100.00", "CRDT", { debtor: { name: "ACME OY" } })], continuation_key: null }
        : {
            transactions: [btx("e1", "20.00", "DBIT", { creditor: { name: "Cafe" } }), btx("e2", "10.00", "DBIT", { remittance_information: [] })],
            continuation_key: "k1",
          };
    return 404;
  };

  it("signs RS256 JWTs with kid = app id that verify against the public key", () => {
    const jwt = ebJwt("app-1", privateKey, 1_700_000_000);
    const [h, p, sig] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "RS256", kid: "app-1" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(createPublicKey(publicKey), Buffer.from(sig, "base64url"))).toBe(true);
    expect(() => ebJwt("app-1", "not a key")).toThrow();
  });

  it("authorizes at the bank, finishes at the callback, and pages transactions by continuation key", async () => {
    const s = memStore();
    const calls = fakeFetch(route);
    expect(await go(connect("t", { provider: "enablebanking", credentials: creds }), s.layer)).toMatchObject({ error: expect.stringContaining("127.0.0.1") });
    expect(await go(connect("t", { provider: "enablebanking", credentials: { ...creds, bank: "Nope" }, origin: ORIGIN }), s.layer)).toMatchObject({
      error: expect.stringContaining("No bank called"),
    });
    expect(await go(connect("t", { provider: "enablebanking", credentials: creds, origin: ORIGIN }), s.layer)).toEqual({});
    const auth = calls.find((c) => c.url.pathname === "/auth")!;
    expect(auth.body).toMatchObject({
      aspsp: { name: "Nordea", country: "FI" },
      redirect_url: ORIGIN + "/api/enablebanking/callback",
      psu_type: "personal",
    });
    expect(auth.headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const until = Date.parse((auth.body as { access: { valid_until: string } }).access.valid_until);
    expect(until - Date.now()).toBeLessThanOrEqual(15552000 * 1000); // never past the bank's own limit
    const st = (await go(status("t"), s.layer))[0]!;
    expect(st).toMatchObject({ connected: false, pending: true, authUrl: "https://nordea.fake/login?x=1" });
    expect(JSON.stringify(st)).not.toContain("PRIVATE KEY");

    const state = (auth.body as { state: string }).state;
    expect(await go(enableBankingCallback("t", { state: state + "x", code: "c" }), s.layer)).toMatchObject({
      error: expect.stringContaining("isn't one OpenBooks started"),
    });
    expect(await go(enableBankingCallback("t", { state, code: "the-code" }), s.layer)).toEqual({});
    expect(calls.find((c) => c.url.pathname === "/sessions")!.body).toEqual({ code: "the-code" });
    expect(await go(enableBankingCallback("t", { state, code: "again" }), s.layer)).toMatchObject({ error: expect.stringContaining("already used") });

    const after = (await go(status("t"), s.layer))[0]!;
    expect(after).toMatchObject({ connected: true, pending: false, expiresAt: "2027-04-01T00:00:00Z", accounts: ["Enable Banking ••0785"] });
    expect(after.authUrl).toBeUndefined();
    const txCalls = calls.filter((c) => c.url.pathname.endsWith("/transactions"));
    expect(txCalls.map((c) => c.url.searchParams.get("continuation_key"))).toEqual([null, "k1"]);
    expect(txCalls[0]!.url.searchParams.get("transaction_status")).toBe("BOOK");
    const { rows, checks } = rowsOf("enablebanking-sync.json");
    expect(rows.map((r) => [r.amount, r.desc, r.memo])).toEqual([
      [-20, "Cafe", "Invoice 7"],
      [-10, "Bank transaction", ""], // no counterparty and no remittance text
      [100, "ACME OY", "Invoice 7"],
    ]);
    expect(checks).toMatchObject([{ total: 70, parsed: 70, balance: true }]); // the closing booked balance, not the available one
  });

  it("an expired consent says to reconnect, and reconnecting starts a new authorization with the saved app", async () => {
    const s = memStore();
    const calls = fakeFetch(route);
    await go(connect("t", { provider: "enablebanking", credentials: creds, origin: ORIGIN }), s.layer);
    const state = (calls.find((c) => c.url.pathname === "/auth")!.body as { state: string }).state;
    await go(enableBankingCallback("t", { state, code: "c" }), s.layer);
    const row = structuredClone(s.rows());
    const sealed = JSON.parse(row.enablebanking!.sealed as string);
    sealed.secret.validUntil = "2020-01-01T00:00:00Z";
    row.enablebanking!.sealed = JSON.stringify(sealed);
    s.rows()["enablebanking"] = row.enablebanking!;
    expect(await go(sync("t", "enablebanking"), s.layer)).toEqual({ error: "The bank consent has expired. Reconnect to keep syncing." });
    calls.length = 0;
    expect(await go(connect("t", { provider: "enablebanking", reconnect: true, origin: ORIGIN }), s.layer)).toEqual({});
    expect(Object.keys(s.rows())).toEqual(["enablebanking"]); // same connection, not an "enablebanking:2"
    expect(calls.find((c) => c.url.pathname === "/auth")).toBeTruthy();
  });
});
