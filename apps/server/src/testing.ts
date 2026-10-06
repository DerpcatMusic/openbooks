// Test helpers (Node: Vitest runs under Node, so servers run as subprocesses and are tested over HTTP).
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../../..");

/** examples/demo copied into a fresh temp dir (+ examples/statements: synthetic statements and docs); returns [home, cleanup]. */
export function demoHome(statements = false): [string, () => void] {
  const dir = mkdtempSync(join(tmpdir(), "openbooks-server-test-"));
  cpSync(join(ROOT, "examples/demo"), join(dir, "home"), { recursive: true, preserveTimestamps: true });
  if (statements) cpSync(join(ROOT, "examples/statements"), join(dir, "home"), { recursive: true, preserveTimestamps: true });
  return [join(dir, "home"), () => rmSync(dir, { recursive: true, force: true })];
}

export const freePort = () =>
  new Promise<number>((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });

export interface Res {
  status: number;
  type: string;
  body: Buffer;
  json: () => unknown;
}
export function http(port: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const data = body === undefined ? undefined : body instanceof Uint8Array ? body : Buffer.from(JSON.stringify(body));
  return new Promise((ok, no) => {
    const r = request({ host: "127.0.0.1", port, method, path, headers: { ...(data ? { "Content-Length": String(data.length) } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const b = Buffer.concat(chunks);
        ok({ status: res.statusCode!, type: String(res.headers["content-type"] ?? ""), body: b, json: () => JSON.parse(b.toString("utf8")) });
      });
    });
    r.on("error", no);
    if (data) r.write(data);
    r.end();
  });
}

async function up(port: number, p: ChildProcess) {
  for (let i = 0; i < 200; i++) {
    if (p.exitCode !== null) throw new Error(`server exited ${p.exitCode}`);
    try {
      await http(port, "GET", "/api/vault");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error("server didn't start");
}

export interface Running {
  port: number;
  stop: () => void;
}
/** the TS server (bun apps/server/src/main.ts) on home */
export async function startTs(home: string, env: Record<string, string> = {}): Promise<Running> {
  const port = env.OPENBOOKS_PORT ? Number(env.OPENBOOKS_PORT) : await freePort();
  const p = spawn("bun", [join(ROOT, "apps/server/src/main.ts")], {
    env: { ...process.env, OPENBOOKS_HOME: home, OPENBOOKS_PORT: String(port), ...env },
    stdio: "ignore",
  });
  await up(port, p);
  return { port, stop: () => p.kill() };
}
// ---------- test_mcp.books(): two small entities ----------
const mercury = (txns: [string, string, number, string, string][]) => ({
  source: "test",
  accounts: [
    { id: "a1", name: "Mercury Checking ••0001", currentBalance: 1430 },
    { id: "c1", name: "Mercury Credit", currentBalance: -30 },
  ],
  transactions: txns.map(([acct, date, amt, who, mcat], i) => ({
    id: `t${i}`,
    accountId: acct,
    amount: amt,
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
/** test_mcp.py books(): acme (us-llc, 5 Mercury txns, 2 rules) and zz-il (osek zair, 1 txn) in a fresh temp dir. */
export function testBooks(): [string, () => void] {
  const home = mkdtempSync(join(tmpdir(), "openbooks-mcp-test-"));
  const us = join(home, "acme");
  mkdirSync(join(us, "inbox"), { recursive: true });
  writeFileSync(join(us, "entity.json"), JSON.stringify({ name: "Acme Test LLC", short: "Acme", kind: "us-llc", currency: "USD", flag: "us" }));
  writeFileSync(join(us, "rules.csv"), "Example Customer,revenue:services\nOwner Transfer,equity:owner\n");
  writeFileSync(
    join(us, "inbox/mercury-test.json"),
    JSON.stringify(
      mercury([
        ["a1", "2026-01-10", 1000, "Example Customer", ""],
        ["a1", "2026-01-15", -20, "Cloud Host", "Software"],
        ["a1", "2026-02-03", -50, "Cloud Host", "Software"],
        ["a1", "2026-02-20", 500, "Owner Transfer", ""],
        ["c1", "2026-03-01", -30, "Card Shop", ""],
      ]),
    ),
  );
  const il = join(home, "zz-il");
  mkdirSync(join(il, "inbox"), { recursive: true });
  writeFileSync(join(il, "entity.json"), JSON.stringify({ name: "Test Osek", short: "Osek", kind: "il-osek-zair", currency: "ILS", flag: "il" }));
  writeFileSync(join(il, "rules.csv"), "Client Ltd,business:client\n");
  writeFileSync(join(il, "inbox/bank.json"), JSON.stringify(mercury([["a1", "2026-04-01", 10000, "Client Ltd", ""]])));
  return [home, () => rmSync(home, { recursive: true, force: true })];
}
