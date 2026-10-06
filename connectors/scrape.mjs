// Israeli banks and credit cards via the open-source israeli-bank-scrapers. Called by connectors.py.
// stdin: one JSON command, stdout: one JSON line. Credentials arrive on stdin only and are never printed.
//   {action:"scrape", companyId, credentials, startDate?}          -> {success, name, accounts:[{accountNumber, balance, txns}]}
//   One Zero only (its mobile API with an SMS code, no browser):
//   {action:"trigger", companyId:"oneZero", phoneNumber}            -> {success, otpContext}       (sends an SMS)
//   {action:"verify",  companyId:"oneZero", otpContext, otpCode}    -> {success, otpLongTermToken}
// Every other company logs in through the bank's website in a headless Chrome: a system Chrome/Chromium
// (or PUPPETEER_EXECUTABLE_PATH, or `npx puppeteer browsers install chrome`) is required.
import fs from "node:fs";
import path from "node:path";
import { CompanyTypes, SCRAPERS, createScraper } from "israeli-bank-scrapers";

const ONE_ZERO = CompanyTypes.oneZero;
const short = id => SCRAPERS[id].name.replace(/^Bank | Bank$/g, ""); // "Bank Hapoalim" -> "Hapoalim"
const fail = (errorType, errorMessage, id) => ({ success: false, errorType, errorMessage, ...(SCRAPERS[id] ? { name: short(id) } : {}) });

/** Login fields the library needs for a scrape (One Zero: the long-term token replaces the SMS step). */
const loginFields = id => (id === ONE_ZERO ? ["email", "password", "otpLongTermToken"] : SCRAPERS[id].loginFields);

/** Returns an error message for a malformed command, before anything touches the network. */
function check(cmd) {
  const id = cmd?.companyId;
  if (!Object.values(CompanyTypes).includes(id)) return `unknown companyId ${JSON.stringify(String(id ?? "")).slice(0, 40)}`;
  const need = keys => {
    const missing = keys.filter(k => !String(cmd[k] ?? "").trim());
    return missing.length ? `missing ${missing.join(", ")}` : null;
  };
  if (cmd.action === "trigger" || cmd.action === "verify") {
    if (id !== ONE_ZERO) return `${cmd.action} is only for One Zero`;
    return need(cmd.action === "trigger" ? ["phoneNumber"] : ["otpContext", "otpCode"]);
  }
  if (cmd.action !== "scrape") return "unknown action";
  const missing = loginFields(id).filter(k => !String(cmd.credentials?.[k] ?? "").trim());
  return missing.length ? `missing login fields: ${missing.join(", ")}` : null;
}

async function chrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const bin of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"])
    for (const d of dirs) if (fs.existsSync(path.join(d, bin))) return path.join(d, bin);
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(mac)) return mac;
  try { // `npx puppeteer browsers install chrome` puts one in puppeteer's cache
    const p = (await import("puppeteer")).default.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {}
  return null;
}

async function run(cmd) {
  const bad = check(cmd);
  if (bad) return fail("INVALID_INPUT", bad, cmd?.companyId);
  const id = cmd.companyId;
  const opts = { companyId: id, startDate: new Date(cmd.startDate || Date.now() - 365 * 864e5) };
  if (id !== ONE_ZERO) {
    opts.executablePath = await chrome();
    if (!opts.executablePath)
      return fail("NO_BROWSER", "needs Chrome or Chromium to log in like the bank's website. Install Google Chrome or Chromium, or run `cd connectors && npx puppeteer browsers install chrome`.", id);
  }
  const scraper = createScraper(opts);
  if (cmd.action === "trigger") {
    const r = await scraper.triggerTwoFactorAuth(cmd.phoneNumber);
    return r.success ? { success: true, otpContext: scraper.otpContext } : r; // the library keeps it in memory; we hand it back across processes
  }
  if (cmd.action === "verify") {
    scraper.otpContext = cmd.otpContext;
    const r = await scraper.getLongTermTwoFactorToken(cmd.otpCode);
    return r.success ? { success: true, otpLongTermToken: r.longTermTwoFactorAuthToken } : r;
  }
  const credentials = Object.fromEntries(loginFields(id).map(k => [k, String(cmd.credentials[k]).trim()]));
  const r = await scraper.scrape(credentials);
  return r.success ? { success: true, name: short(id), accounts: r.accounts ?? [] } : { ...r, name: short(id) };
}

let input = "", out;
for await (const chunk of process.stdin) input += chunk;
let cmd;
try { cmd = JSON.parse(input); } catch { cmd = null; } // never echo stdin: it carries credentials
try { out = cmd ? await run(cmd) : fail("INVALID_INPUT", "stdin is not one JSON command"); } catch (e) { out = fail("GENERAL_ERROR", String(e?.message || e)); }
process.stdout.write("\n" + JSON.stringify(out) + "\n"); // last line is ours, whatever a dependency printed before it
