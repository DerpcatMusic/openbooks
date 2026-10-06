// Israeli banks and credit cards via the open-source israeli-bank-scrapers (port of connectors/scrape.mjs).
// One command in, one plain-JSON result out; credentials are never printed or put in a result.
//   {action:"scrape", companyId, credentials, startDate?}          -> {success, name, accounts:[{accountNumber, balance, txns}]}
//   One Zero only (its mobile API with an SMS code, no browser):
//   {action:"trigger", companyId:"oneZero", phoneNumber}            -> {success, otpContext}       (sends an SMS)
//   {action:"verify",  companyId:"oneZero", otpContext, otpCode}    -> {success, otpLongTermToken}
// Every other company logs in through the bank's website in a headless Chrome: a system Chrome/Chromium
// (or PUPPETEER_EXECUTABLE_PATH, or `npx puppeteer browsers install chrome`) is required.
// Runs in-process under Bun (Scraper.direct) or as a subprocess through scrape-cli.ts (Scraper.bridge).
import fs from "node:fs";
import path from "node:path";
import { CompanyTypes, SCRAPERS, createScraper } from "israeli-bank-scrapers";
import type { ScraperCredentials, ScraperOptions } from "israeli-bank-scrapers";

export interface ScrapeCmd {
  action: "scrape" | "trigger" | "verify";
  companyId: string;
  credentials?: Record<string, string>;
  startDate?: string;
  phoneNumber?: string;
  otpContext?: string;
  otpCode?: string;
}
export interface ScrapeResult {
  success: boolean;
  name?: string;
  errorType?: string;
  errorMessage?: string;
  accounts?: ScrapedAccount[];
  otpContext?: string;
  otpLongTermToken?: string;
}
export interface ScrapedAccount {
  accountNumber?: string;
  balance?: number;
  txns?: ScrapedTxn[];
  [k: string]: unknown;
}
export type ScrapedTxn = Record<string, unknown> & { date?: string; chargedAmount?: number; description?: string; identifier?: unknown; status?: string };

type Id = keyof typeof SCRAPERS;
const ONE_ZERO = CompanyTypes.oneZero;
const known = (id: unknown): id is Id => (Object.values(CompanyTypes) as unknown[]).includes(id);
const short = (id: Id) => SCRAPERS[id].name.replace(/^Bank | Bank$/g, ""); // "Bank Hapoalim" -> "Hapoalim"
const fail = (errorType: string, errorMessage: string, id?: unknown): ScrapeResult => ({
  success: false,
  errorType,
  errorMessage,
  ...(known(id) ? { name: short(id) } : {}),
});

/** Login fields the library needs for a scrape (One Zero: the long-term token replaces the SMS step). */
const loginFields = (id: Id): readonly string[] => (id === ONE_ZERO ? ["email", "password", "otpLongTermToken"] : SCRAPERS[id].loginFields);

/** Returns an error message for a malformed command, before anything touches the network. */
export function check(cmd: Partial<ScrapeCmd> | null): string | null {
  const id = cmd?.companyId;
  if (!known(id)) return `unknown companyId ${JSON.stringify(String(id ?? "")).slice(0, 40)}`;
  const c = cmd as Record<string, unknown>;
  const need = (keys: string[]) => {
    const missing = keys.filter((k) => !(typeof c[k] === "string" || typeof c[k] === "number" ? String(c[k]) : "").trim());
    return missing.length ? `missing ${missing.join(", ")}` : null;
  };
  if (cmd?.action === "trigger" || cmd?.action === "verify") {
    if (id !== ONE_ZERO) return `${cmd.action} is only for One Zero`;
    return need(cmd.action === "trigger" ? ["phoneNumber"] : ["otpContext", "otpCode"]);
  }
  if (cmd?.action !== "scrape") return "unknown action";
  const missing = loginFields(id).filter((k) => !String(cmd.credentials?.[k] ?? "").trim());
  return missing.length ? `missing login fields: ${missing.join(", ")}` : null;
}

async function chrome(): Promise<string | null> {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const bin of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"])
    for (const d of dirs) if (fs.existsSync(path.join(d, bin))) return path.join(d, bin);
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(mac)) return mac;
  try {
    // `npx puppeteer browsers install chrome` puts one in puppeteer's cache
    const p = (await import("puppeteer")).default.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {}
  return null;
}

async function exec(cmd: ScrapeCmd): Promise<ScrapeResult> {
  const bad = check(cmd);
  if (bad) return fail("INVALID_INPUT", bad, cmd?.companyId);
  const id = cmd.companyId as Id;
  const opts = { companyId: id, startDate: new Date(cmd.startDate || Date.now() - 365 * 864e5) } as ScraperOptions;
  if (id !== ONE_ZERO) {
    const executablePath = await chrome();
    if (!executablePath)
      return fail(
        "NO_BROWSER",
        "needs Chrome or Chromium to log in like the bank's website. Install Google Chrome or Chromium, or run `npx puppeteer browsers install chrome`.",
        id,
      );
    Object.assign(opts, { executablePath });
  }
  const scraper = createScraper(opts);
  const otp = scraper as unknown as { otpContext?: string }; // the library keeps it in memory; we hand it back across calls
  if (cmd.action === "trigger") {
    const r = await scraper.triggerTwoFactorAuth(cmd.phoneNumber!);
    return r.success ? { success: true, otpContext: otp.otpContext! } : (r as ScrapeResult);
  }
  if (cmd.action === "verify") {
    otp.otpContext = cmd.otpContext!;
    const r = await scraper.getLongTermTwoFactorToken(cmd.otpCode!);
    return r.success ? { success: true, otpLongTermToken: r.longTermTwoFactorAuthToken } : (r as ScrapeResult);
  }
  const credentials = Object.fromEntries(loginFields(id).map((k) => [k, String(cmd.credentials![k]).trim()])) as unknown as ScraperCredentials;
  const r = await scraper.scrape(credentials);
  return r.success
    ? { success: true, name: short(id), accounts: (r.accounts ?? []) as unknown as ScrapedAccount[] }
    : { ...(r as ScrapeResult), name: short(id) };
}

/** Never throws. The result goes through JSON so in-process and subprocess runs hand back the same plain data. */
export async function run(cmd: unknown): Promise<ScrapeResult> {
  let out: ScrapeResult;
  try {
    out = cmd && typeof cmd === "object" ? await exec(cmd as ScrapeCmd) : fail("INVALID_INPUT", "stdin is not one JSON command");
  } catch (e) {
    out = fail("GENERAL_ERROR", String((e as Error)?.message || e));
  }
  return JSON.parse(JSON.stringify(out)) as ScrapeResult;
}
