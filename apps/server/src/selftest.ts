// `openbooks selftest` (scripts/release/smoke.ts runs it from a foreign cwd): the real server serving the embedded web build
// against a throwaway books.db, bun:sqlite, israeli-bank-scrapers + puppeteer-core with system Chrome (about:blank only) and the
// BUN_BE_BUN scrape.js fallback. One JSON object out; never touches a bank. Ported from 2.10's build-spike/main.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { embeddedStatic, startServer } from "./server.ts";

type Check = { ok: boolean; [k: string]: unknown };
const attempt = async (f: () => Promise<Omit<Check, "ok">>): Promise<Check> => {
  try {
    return { ok: true, ...(await f()) };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.stack ?? e).slice(0, 600) };
  }
};

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

export async function selftest(): Promise<Record<string, Check>> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ob-selftest-"));
  const out: Record<string, Check> = {};

  out.static = await attempt(async () => {
    const s = await startServer({ home: path.join(tmp, "home"), port: 0 });
    try {
      const index = await fetch(`${s.url}/`);
      const html = await index.text();
      const asset = html.match(/(?:src|href)="\/?((?:assets|_app)\/[^"]+)"/)?.[1]; // legacy app/ (Vite) or apps/web (SvelteKit)
      const a = asset ? await fetch(`${s.url}/${asset}`) : null;
      const spa = await fetch(`${s.url}/some/client/route`);
      const st = (await (await fetch(`${s.url}/api/state`)).json()) as { setup?: boolean };
      const embedded = embeddedStatic("web").size;
      if (index.status !== 200 || !html.includes("<html") || !a?.ok || !(await spa.text()).includes("<html") || !st.setup)
        throw new Error("static serving failed");
      return { embedded, fromMemory: embedded > 0, asset, assetType: a.headers.get("content-type"), api: true };
    } finally {
      await s.stop(); // closes books.db: Windows cannot delete an open file
    }
  });

  out.sqlite = await attempt(async () => {
    const db = new Database(path.join(tmp, "t.db"), { create: true, strict: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run("create table t (id integer primary key, v text)");
    db.query("insert into t (v) values ($v)").run({ v: "שלום" });
    const row = db.query("select v, sqlite_version() as version from t").get() as { v: string; version: string };
    db.close();
    if (row.v !== "שלום") throw new Error("round trip failed");
    return { version: row.version };
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

  out.scraperBrowser = await attempt(async () => {
    if (!chrome) throw new Error("no system Chrome found");
    const { createScraper, CompanyTypes } = await import("israeli-bank-scrapers");
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
    try {
      // constructing a scraper with an injected browser proves the bundled module graph links; scrape() is never called
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
    // a malformed command: scrape.mjs validates before any network call, so this never reaches a bank
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
