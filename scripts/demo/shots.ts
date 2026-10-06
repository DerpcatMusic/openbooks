// Screenshots of the built demo for the README and landing page (site/img). Needs _site served at /openbooks
// (bun scripts/demo/build.ts, then any static server) and Chrome: bun scripts/demo/shots.ts http://127.0.0.1:8972/openbooks/demo
import puppeteer from "puppeteer-core";

const demo = process.argv[2] ?? "http://127.0.0.1:8972/openbooks/demo";
const chrome = process.env.CHROME ?? "/usr/bin/google-chrome-stable";
const SHOTS: [string, string, string?][] = [
  ["home", "/home"],
  ["reports", "/reports"],
  ["transactions", "/transactions"],
  ["invoices", "/invoices"],
  ["tax-il", "/tax/il?e=noa", "he"],
  ["taxximizer", "/taxximizer?e=noa"],
];
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--hide-scrollbars"] });
try {
  for (const theme of ["dark", "light"] as const)
    for (const [name, path, lang = "en"] of SHOTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
      await page.emulateMediaFeatures([
        { name: "prefers-color-scheme", value: theme },
        { name: "prefers-reduced-motion", value: "reduce" },
      ]);
      await page.evaluateOnNewDocument(
        (th: string, l: string) => {
          localStorage.setItem("ob-theme", th);
          localStorage.setItem("ob-lang", l);
          localStorage.setItem("ob-entity", "acme");
        },
        theme,
        lang,
      );
      await page.goto(demo + path, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 1200));
      await page.screenshot({ path: `site/img/${name}-${theme}.webp`, type: "webp", quality: 82 });
      await page.close();
    }
} finally {
  await browser.close();
}
