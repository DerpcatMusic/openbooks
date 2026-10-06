// Throwaway entry for the distribution spike (item 2.10): proves what the real apps/server/src/main.ts needs inside one
// `bun build --compile` binary. `spike serve` serves the embedded web build from memory; `spike selftest` checks
// static serving, bun:sqlite, israeli-bank-scrapers + puppeteer-core with system Chrome (about:blank only), and the
// BUN_BE_BUN scrape.js fallback, then prints one JSON line. Never touches a bank.
import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// build.ts embeds the web build as `web/**` and the fallback scraper as `scrape.js`. From source, the folder is read from disk.
const STATIC = "web";
const DEV_STATIC = ["apps/web/build", "app"].find((d) => fs.existsSync(path.join(d, "index.html"))) ?? "app";

/** URL path -> Blob for every embedded file under `dir/` (compile.assets keeps build-time relative paths as names). */
export function embeddedStatic(dir: string): Map<string, Blob> {
  const files = new Map<string, Blob>();
  for (const blob of Bun.embeddedFiles as (Blob & { name: string })[]) if (blob.name.startsWith(`${dir}/`)) files.set(blob.name.slice(dir.length), blob);
  return files;
}

function openDb(file: string) {
  const db = new Database(file, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  return db;
}

function serve(port: number, db: Database) {
  const embedded = embeddedStatic(STATIC);
  const root = path.resolve(DEV_STATIC); // dev fallback: not compiled, nothing embedded
  const file = (p: string): Blob | null => {
    if (embedded.size) return embedded.get(p) ?? null;
    const f = path.join(root, path.normalize(p));
    return f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile() ? Bun.file(f) : null;
  };
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      if (p === "/api/db") return Response.json(db.query("select sqlite_version() as v").get());
      // SPA: unknown paths get index.html. Blob.type comes from the file extension.
      const blob = file(p === "/" ? "/index.html" : p) ?? file("/index.html");
      return blob ? new Response(blob) : new Response("not found", { status: 404 });
    },
  });
}

function findChrome(): string | null {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env) return env;
  const names = process.platform === "win32" ? ["chrome.exe", "msedge.exe"] : ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"];
  for (const d of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean))
    for (const n of names) if (fs.existsSync(path.join(d, n))) return path.join(d, n);
  const fixed = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  return fixed.find((f) => fs.existsSync(f)) ?? null;
}

type Check = { ok: boolean; [k: string]: unknown };
const attempt = async (f: () => Promise<Omit<Check, "ok">>): Promise<Check> => {
  try {
    return { ok: true, ...(await f()) };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.stack ?? e).slice(0, 600) };
  }
};

async function selftest(): Promise<Record<string, Check>> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ob-spike-"));
  const out: Record<string, Check> = {};

  out.static = await attempt(async () => {
    const db = openDb(path.join(tmp, "serve.db"));
    const server = serve(0, db);
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const index = await fetch(`${base}/`);
      const html = await index.text();
      const asset = html.match(/(?:src|href)="\/?(assets\/[^"]+)"/)?.[1];
      const a = asset ? await fetch(`${base}/${asset}`) : null;
      const spa = await fetch(`${base}/some/client/route`);
      const db = (await (await fetch(`${base}/api/db`)).json()) as { v: string };
      const embedded = embeddedStatic(STATIC).size;
      if (index.status !== 200 || !html.includes("<html") || !a?.ok || !(await spa.text()).includes("<html")) throw new Error("static serving failed");
      return { embedded, fromMemory: embedded > 0, asset, assetType: a.headers.get("content-type"), sqlite: db.v };
    } finally {
      await server.stop(true);
      db.close(); // Windows cannot delete an open db file
    }
  });

  out.sqlite = await attempt(async () => {
    const db = openDb(path.join(tmp, "books.db"));
    db.run("create table t (id integer primary key, v text)");
    db.query("insert into t (v) values ($v)").run({ v: "שלום" });
    const row = db.query("select v from t").get() as { v: string };
    db.close();
    if (row.v !== "שלום") throw new Error("round trip failed");
    return { version: (new Database(":memory:").query("select sqlite_version() as v").get() as { v: string }).v };
  });

  out.scrapersImport = await attempt(async () => {
    const { SCRAPERS, CompanyTypes } = await import("israeli-bank-scrapers");
    return { companies: Object.keys(SCRAPERS).length, hasHapoalim: CompanyTypes.hapoalim in SCRAPERS };
  });

  const chrome = findChrome();
  out.chromeInBinary = await attempt(async () => {
    if (!chrome) throw new Error("no system Chrome found");
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-first-run"] });
    try {
      const page = await browser.newPage();
      await page.goto("about:blank");
      return { chrome, version: await browser.version(), url: page.url() };
    } finally {
      await browser.close();
    }
  });

  // The library's own launch path (puppeteer, not -core), still only to about:blank: a page from a scraper instance.
  out.scraperBrowser = await attempt(async () => {
    if (!chrome) throw new Error("no system Chrome found");
    const { createScraper, CompanyTypes } = await import("israeli-bank-scrapers");
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
    try {
      // Constructing a scraper with an injected browser proves the bundled module graph links; scrape() is never called.
      const scraper = createScraper({ companyId: CompanyTypes.hapoalim, startDate: new Date(), browser: browser as never, skipCloseBrowser: true });
      const page = await browser.newPage();
      await page.goto("about:blank");
      return { scraper: scraper.constructor.name, url: page.url() };
    } finally {
      await browser.close();
    }
  });

  out.scrapeFallback = await attempt(async () => {
    const blob = (Bun.embeddedFiles as (Blob & { name: string })[]).find((b) => b.name === "scrape.js");
    if (!blob) throw new Error("scrape.js not embedded (run the compiled binary)");
    const script = path.join(tmp, "scrape.js");
    await Bun.write(script, blob);
    // A malformed command: scrape.mjs validates before any network call, so this never reaches a bank.
    const proc = Bun.spawn([process.execPath, script], {
      env: { ...process.env, BUN_BE_BUN: "1" },
      stdin: new TextEncoder().encode(JSON.stringify({ action: "scrape", companyId: "nope" })),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, code] = [await new Response(proc.stdout).text(), await proc.exited];
    const last = JSON.parse(stdout.trim().split("\n").at(-1) ?? "null") as { errorType?: string };
    if (last?.errorType !== "INVALID_INPUT") throw new Error(`unexpected: ${stdout.slice(0, 200)} ${await new Response(proc.stderr).text()}`);
    return { code, reply: last };
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

const [cmd = "serve", ...rest] = process.argv.slice(2);
if (cmd === "selftest") {
  const r = await selftest();
  console.log(JSON.stringify({ platform: `${process.platform}-${process.arch}`, bun: Bun.version, ...r }));
  process.exit(Object.values(r).every((c) => c.ok) ? 0 : 1);
} else if (cmd === "serve") {
  const port = Number(rest[0] ?? process.env.PORT ?? 8902);
  const s = serve(port, openDb(path.join(os.tmpdir(), "ob-spike.db")));
  console.log(`serving ${STATIC} on http://127.0.0.1:${s.port}`);
} else {
  console.error("usage: spike [serve [port] | selftest]");
  process.exit(2);
}
