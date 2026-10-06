// The TS server over HTTP (a Bun subprocess on a temp copy of examples/demo): what books.py doesn't have or parity can't compare.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { foreign } from "./guard.ts";
import { merge } from "./pack.ts";
import { demoHome, http, type Running, startTs } from "./testing.ts";

const hasSqlite3 = (() => {
  try {
    execSync("sqlite3 -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const TOKEN = "tok-very-secret-123";
let s: Running, home: string, clean: () => void, mercury: Server;
/** Authorization headers the fake Mercury API saw (it refuses every token: no real bank is ever called). */
const seen: string[] = [];
beforeAll(async () => {
  mercury = createServer((req, res) => {
    seen.push(String(req.headers.authorization));
    res.writeHead(401).end();
  });
  await new Promise<void>((ok) => mercury.listen(0, "127.0.0.1", ok));
  [home, clean] = demoHome();
  // a JSON-era entity with a bank connection: migrates into books.db (secret table) on first sight
  mkdirSync(join(home, "bank", "data"), { recursive: true });
  writeFileSync(join(home, "bank", "entity.json"), JSON.stringify({ name: "Bank Co", kind: "other", currency: "USD" }));
  writeFileSync(
    join(home, "bank", "data", "connections.json"),
    JSON.stringify({ mercury: { secret: { token: TOKEN }, lastSync: null, accounts: ["Checking"] } }),
  );
  s = await startTs(home, { OPENBOOKS_MERCURY_API: `http://127.0.0.1:${(mercury.address() as { port: number }).port}` });
}, 30_000);
afterAll(() => {
  s?.stop();
  mercury?.close();
  clean?.();
});

const post = (path: string, body: unknown) => http(s.port, "POST", path, body);

test("foreign(): books.py's Origin/Host rules", () => {
  const h = (o: Record<string, string>) => foreign(new Headers(o));
  expect(h({ host: "127.0.0.1:8901" })).toBe(false);
  expect(h({ host: "localhost" })).toBe(false);
  expect(h({ host: "[::1]:8901", origin: "http://[::1]:8901" })).toBe(false);
  expect(h({ host: "127.0.0.1:8901", origin: "http://LOCALHOST:5173" })).toBe(false);
  expect(h({ host: "127.0.0.1:8901", origin: "http://evil.example" })).toBe(true);
  expect(h({ host: "127.0.0.1:8901", origin: "null" })).toBe(true);
  expect(h({ host: "127.0.0.1:8901", origin: "http://127.0.0.1.evil.example" })).toBe(true);
  expect(h({ host: "evil.example" })).toBe(true);
  expect(h({ host: "user@127.0.0.1" })).toBe(false); // urlparse drops userinfo, like books.py
  expect(h({})).toBe(true);
});

test("pdf-lib merge keeps every page in order", async () => {
  const doc = async (n: number) => {
    const d = await PDFDocument.create();
    for (let i = 0; i < n; i++) d.addPage([100 + i, 100]);
    return d.save();
  };
  const out = await PDFDocument.load(await merge([await doc(1), await doc(3), await doc(2)]));
  expect(out.getPageCount()).toBe(6);
  expect(out.getPages().map((p) => p.getWidth())).toEqual([100, 100, 101, 102, 100, 101]);
});

test("guard on /files, /api/events and static too", async () => {
  for (const p of ["/", "/files/acme/inbox/x.pdf", "/api/events", "/api/vault"])
    expect((await http(s.port, "GET", p, undefined, { Origin: "https://evil.example" })).status).toBe(403);
});

test("static app/ and SPA fallback; /api/ai and /mcp are live", async () => {
  const index = await http(s.port, "GET", "/");
  expect(index.status).toBe(200);
  expect(index.body.toString()).toContain("<html");
  expect((await http(s.port, "GET", "/some/route")).body.toString()).toContain("<html");
  expect((await http(s.port, "GET", "/api/ai/config")).json()).toMatchObject({ ready: false });
  expect((await http(s.port, "GET", "/api/ai/nope")).status).not.toBe(501);
  expect((await http(s.port, "POST", "/mcp", {})).status).toBe(415); // no Content-Type (the SDK); not 501 (ai.test.ts / mcp.test.ts cover the rest)
});

test("taxtables: edits are _app overrides merged over the tables", async () => {
  const st = (await post("/api/taxtables?e=acme", { country: "zz", year: 2031, table: { rate: 0.1 } })).json() as { taxTables: Record<string, unknown> };
  expect(st.taxTables.zz).toEqual({ "2031": { rate: 0.1 } });
  const il = Object.keys(((st.taxTables.il ?? {}) as object) || {});
  if (il.length) {
    const y = il[0]!;
    const st2 = (await post("/api/taxtables?e=acme", { country: "il", year: y, table: null })).json() as { taxTables: { il: Record<string, unknown> } };
    expect(st2.taxTables.il[y]).toBeUndefined();
  }
});

test("person: derived from per-entity advisor docs until saved, then one _app doc", async () => {
  await post("/api/doc?e=noa", { name: "advisor", value: { isWoman: true, childBirthYears: "" } });
  await post("/api/doc?e=acme", { name: "advisor", value: { childBirthYears: "2019, 2022", isWoman: false } });
  const get = async () =>
    (await http(s.port, "GET", "/api/person")).json() as { person: { residence: string; facts: Record<string, unknown> }; saved: boolean };
  const d = await get();
  expect(d.saved).toBe(false);
  expect(d.person.facts).toMatchObject({ childBirthYears: "2019, 2022" }); // empty answers never shadow real ones
  expect(Object.keys(d.person.facts)).toContain("isWoman");
  expect((await post("/api/person", { residence: "ISR", facts: {} })).status).toBe(400);
  expect((await post("/api/person", { residence: "il", facts: { x: { y: 1 } } })).status).toBe(400);
  const saved = (await post("/api/person", { residence: "il", facts: { ...d.person.facts, degreeType: "BA" } })).json() as typeof d;
  expect(saved).toEqual({ saved: true, person: { residence: "il", facts: { ...d.person.facts, degreeType: "BA" } } });
  expect(await get()).toEqual(saved);
  await post("/api/doc?e=noa", { name: "advisor", value: null });
  await post("/api/doc?e=acme", { name: "advisor", value: null });
});

test("SSE: hello, then a change per write", async () => {
  const got: string[] = [];
  const req = request({ host: "127.0.0.1", port: s.port, path: "/api/events" });
  const done = new Promise<void>((ok) =>
    req.on("response", (res) => {
      expect(res.headers["content-type"]).toBe("text/event-stream");
      res.on("data", (c: Buffer) => {
        got.push(c.toString());
        if (got.join("").includes("event: change")) ok();
      });
    }),
  );
  req.end();
  await new Promise((r) => setTimeout(r, 300));
  await post("/api/doc?e=acme", { name: "customers", value: [{ name: "x" }] });
  await done;
  req.destroy();
  const text = got.join("");
  expect(text).toMatch(/^event: hello\ndata: \{"v":\d+\}\n\n/);
  const change = JSON.parse(/event: change\ndata: (.*)\n/.exec(text)![1]!);
  expect(change).toMatchObject({ entity: "acme", topics: ["docs"], docs: ["customers"] });
  expect(change.v).toBeGreaterThan(0);
});

describe("vault", () => {
  const conn = async () =>
    ((await http(s.port, "GET", "/api/state?e=bank")).json() as { connections: { connected: boolean; accounts: string[] }[] }).connections[0];
  test("plaintext → setup seals → lock → 423 → unlock → change → reset", async () => {
    expect(await conn()).toMatchObject({ connected: true, accounts: ["Checking"] });
    expect((await http(s.port, "GET", "/api/vault")).json()).toEqual({ status: "plaintext" });
    expect((await post("/api/vault/unlock", { passphrase: "x" })).status).toBe(409);
    expect((await post("/api/vault/setup", {})).status).toBe(400);
    expect((await post("/api/vault/setup", { passphrase: "correct horse" })).json()).toEqual({ status: "unlocked" });
    expect((await post("/api/vault/setup", { passphrase: "again" })).status).toBe(409);
    // the row is sealed (scrubbing old page images from the file is the storage vault's job: secure_delete + checkpoint)
    if (hasSqlite3) {
      const row = execSync(`sqlite3 "${join(home, "books.db")}" "select value from secret where entity = 'bank'"`).toString();
      expect(row).toContain('"sealed"');
      expect(row).not.toContain(TOKEN);
    }
    expect(await conn()).toMatchObject({ connected: true, accounts: ["Checking"] }); // status stays readable

    expect((await post("/api/vault/lock", {})).json()).toEqual({ status: "locked" });
    const locked = await post("/api/sync?e=bank", { provider: "mercury" });
    expect(locked.status).toBe(423);
    expect(locked.json()).toEqual({ error: "unlock OpenBooks in the app first" });

    const t0 = Date.now();
    expect((await post("/api/vault/unlock", { passphrase: "wrong" })).status).toBe(401);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
    expect((await post("/api/vault/unlock", { passphrase: "correct horse" })).json()).toEqual({ status: "unlocked" });
    // unlocked: the sealed secret opens and reaches the connector (the fake API refuses it: a 400, never the token)
    const sync = await post("/api/sync?e=bank", { provider: "mercury" });
    expect(seen).toEqual([`Bearer ${TOKEN}`]);
    expect(sync.status).toBe(400);
    expect(sync.body.toString()).not.toContain(TOKEN);

    expect((await post("/api/vault/change", { passphrase: "nope", newPassphrase: "battery staple" })).status).toBe(401);
    expect((await post("/api/vault/change", { passphrase: "correct horse", newPassphrase: "battery staple" })).status).toBe(200);
    await post("/api/vault/lock", {});
    expect((await post("/api/vault/unlock", { passphrase: "battery staple" })).status).toBe(200);

    expect((await post("/api/vault/reset", {})).json()).toEqual({ status: "plaintext" });
    expect(await conn()).toMatchObject({ connected: false, accounts: ["Checking"] }); // banks need reconnecting
    expect((await post("/api/disconnect?e=bank", { provider: "mercury" })).json()).toMatchObject({ connections: [] });
  }, 30_000);
});

const chrome = (() => {
  try {
    return execSync("command -v google-chrome-stable || command -v chromium || command -v google-chrome", { shell: "/bin/sh" }).toString().trim();
  } catch {
    return "";
  }
})();
test.skipIf(!chrome)(
  "proof pack: Chrome cover + statement and proof PDFs",
  async () => {
    const proof = await PDFDocument.create();
    proof.addPage();
    proof.addPage();
    expect((await http(s.port, "POST", "/api/upload?e=noa&to=proofs&year=2025&name=cert.pdf", await proof.save())).status).toBe(200);
    expect((await http(s.port, "GET", "/api/pack?e=noa")).status).toBe(404); // books.py: no year → KeyError → "unknown entity"
    const r = await http(s.port, "GET", "/api/pack?e=noa&year=2025");
    expect(r.status).toBe(200);
    expect(r.type).toBe("application/pdf");
    const pack = await PDFDocument.load(r.body);
    expect(pack.getPageCount()).toBeGreaterThanOrEqual(3); // cover (≥1) + the 2-page proof
  },
  90_000,
);
