// App-wide overflow and labelling check. Loads every route in headless Chrome (DevTools protocol, no extra deps) for both demo
// businesses (acme = US LLC, noa = Israeli osek) at 375 px and 1280 px × English/Hebrew × light/dark, plus privacy mode at 375 px,
// and opens the drawers, dialogs, pickers and menus each screen has. Fails if
//   - the page scrolls horizontally, or
//   - a text-bearing control (button, link, tab, badge, cell, label, heading…) has content wider than its box
//     (scrollWidth > clientWidth), a fixed-height control's text spills vertically, a badge wraps onto two lines, or an element
//     pokes out of the viewport while not inside a horizontal scroll container (tables and tab strips scroll on purpose), or
//   - a button, link or form field has no accessible name (icon-only buttons need aria-label).
// Run: bun run --cwd apps/web check:overflow
//   OB_URL=http://localhost:5173  use a running dev server (proxying a server on demo data); otherwise the script starts the API on
//                                 a temp copy of the demo data (port OB_PORT, default 8904) and `vp dev` on OB_PORT+1.
//   ONLY=<substring>              only cases whose label contains it (e.g. ONLY=/invoices, ONLY="noa /tax")
//   SHOTS=<dir>                   also save a screenshot per case;  JOBS=<n> parallel windows (default 1);  CHROME=<binary>
import { spawn, type Subprocess } from "bun";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const CHROME = process.env.CHROME ?? "google-chrome-stable";
const SHOTS = process.env.SHOTS;
const ONLY = process.env.ONLY ?? "";
const JOBS = Number(process.env.JOBS ?? 1); // ponytail: parallel windows hang in headless Chrome here (navigations stall), so 1 by default

/** Runs in the page; returns problems as short strings. */
function audit(): string[] {
  const bad: string[] = [];
  const name = (el: Element) => {
    const ui = el.closest("[data-ui]")?.getAttribute("data-ui");
    const txt = (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 50);
    return `${el.tagName.toLowerCase()}${ui ? `[${ui}]` : ""} "${txt}"`;
  };
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) bad.push(`page scrolls horizontally: ${de.scrollWidth} > ${de.clientWidth}`);
  // behind an open modal (top layer) nothing is visible or reachable: audit only the modal then
  const modal = document.querySelector<HTMLElement>("dialog[open]:modal");
  const hidden = (el: Element) =>
    el.closest("[popover]:not(:popover-open), dialog:not([open]), .sr-only, [inert], [aria-hidden=true]") !== null ||
    el.getClientRects().length === 0 ||
    (modal !== null && !modal.contains(el) && !el.closest("[popover]:popover-open"));
  const inScroller = (el: Element) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true;
    return false;
  };
  const sel = "button, a, label, th, td, select, h1, h2, h3, p, dt, dd, [role=tab], [role=radio], [role=switch], [role=menuitem], [role=tooltip], [data-ui]";
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    if (hidden(el) || el.closest(".form-page")) continue; // the 1301 form overlay is a fixed-size printed page
    const cs = getComputedStyle(el);
    if (cs.display === "inline" || cs.display === "contents") continue;
    if (!/auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1)
      bad.push(`${name(el)}: content ${el.scrollWidth}px wider than box ${el.clientWidth}px`);
    const fixedH = cs.height !== "auto" && /^(button|a)$/i.test(el.tagName) ? true : el.matches("[data-ui=badge], [role=tab], [role=radio]");
    if (fixedH && !/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1)
      bad.push(`${name(el)}: text spills vertically (${el.scrollHeight} > ${el.clientHeight})`);
    if (el.matches("[data-ui=badge]") && el.getBoundingClientRect().height > 1.8 * (parseFloat(cs.lineHeight) || 20)) bad.push(`${name(el)}: badge wraps`);
    const r = el.getBoundingClientRect();
    if ((r.right > innerWidth + 1 || r.left < -1) && !inScroller(el))
      bad.push(`${name(el)}: outside the viewport (${Math.round(r.left)}..${Math.round(r.right)} of ${innerWidth})`);
  }
  // every control has an accessible name
  for (const el of document.querySelectorAll<HTMLElement>(
    "button, a[href], [role=button], [role=tab], [role=radio], [role=switch], input:not([type=hidden]), select, textarea",
  )) {
    // .sr-only fields (e.g. a file input inside its visible label) still need a name; display:none ones don't
    if (el.matches(".sr-only") ? el.closest("[popover]:not(:popover-open), dialog:not([open])") : hidden(el)) continue;
    const field = el as HTMLInputElement;
    const named =
      (el.getAttribute("aria-label") ?? "").trim() ||
      el.getAttribute("aria-labelledby") ||
      (el.getAttribute("title") ?? "").trim() ||
      (el.matches("input, select, textarea") ? (field.labels?.length ?? 0) > 0 || field.placeholder : (el.textContent ?? "").trim());
    if (!named) bad.push(`${el.outerHTML.slice(0, 90)}: no accessible name`);
  }
  return bad;
}

// --- minimal CDP client: one Chrome, one window per job (background tabs would be throttled to a crawl)
const PARALLEL = ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"];
async function chrome() {
  const dir = mkdtempSync(join(tmpdir(), "ob-overflow-"));
  const proc = spawn(
    [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${dir}`, ...PARALLEL, "about:blank"],
    {
      stderr: "pipe",
      stdout: "ignore",
    },
  );
  let buf = "";
  const reader = proc.stderr.getReader();
  while (!/ws:\/\/\S+/.test(buf)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`chrome exited: ${buf}`);
    buf += new TextDecoder().decode(value);
  }
  const ws = new WebSocket(buf.match(/ws:\/\/\S+/)![0]);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const waiting = new Map<number, (m: { result?: any; error?: { message: string } }) => void>();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    // "Leave site?" (a form left dirty by an open state) and alerts: accept, or the next navigation never answers
    if (m.method === "Page.javascriptDialogOpening") void send("Page.handleJavaScriptDialog", { accept: true }, m.sessionId).catch(() => {});
    waiting.get(m.id)?.(m);
    waiting.delete(m.id);
  });
  const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
    new Promise((ok, fail) => {
      const n = ++id;
      const timer = setTimeout(() => {
        waiting.delete(n);
        fail(new Error(`${method}: no answer in 30 s`));
      }, 30_000);
      waiting.set(n, (m) => (clearTimeout(timer), m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
  const tab = async () => {
    const { targetId } = await send("Target.createTarget", { url: "about:blank", newWindow: true });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const page = (method: string, params: object = {}) => send(method, params, sessionId);
    const evaluate = async (expr: string) => {
      const r = await page("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    await page("Page.enable");
    return { page, evaluate };
  };
  const close = () => {
    ws.close();
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
  };
  return { tab, close };
}

// --- servers: a running dev server (OB_URL), or our own API on a temp copy of the demo data + vp dev
const kids: Subprocess[] = [];
let home = "";
const up = async (url: string) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
let BASE = process.env.OB_URL ?? "";
if (!BASE) {
  const port = Number(process.env.OB_PORT ?? 8904);
  home = mkdtempSync(join(tmpdir(), "ob-overflow-home-"));
  cpSync(join(ROOT, "examples/demo"), home, { recursive: true });
  cpSync(join(ROOT, "examples/statements"), home, { recursive: true });
  kids.push(
    spawn(["bun", "apps/server/src/main.ts"], {
      cwd: ROOT,
      env: { ...process.env, OPENBOOKS_HOME: home, OPENBOOKS_PORT: String(port) },
      stdout: "ignore",
      stderr: "ignore",
    }),
    spawn(["bunx", "vp", "dev", "--port", String(port + 1), "--strictPort"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, OPENBOOKS_API: `http://127.0.0.1:${port}` },
      stdout: "ignore",
      stderr: "ignore",
    }),
  );
  BASE = `http://localhost:${port + 1}`;
}
const cleanup = () => {
  for (const k of kids) k.kill();
  if (home) rmSync(home, { recursive: true, force: true });
};
for (let i = 0; i < 120 && !(await up(`${BASE}/api/state?e=noa`)); i++) await Bun.sleep(500);
if (!(await up(`${BASE}/api/state?e=noa`))) {
  cleanup();
  throw new Error(`no app with demo data at ${BASE}`);
}

// --- what to visit
const sleep = (ms: number) => `new Promise(r => setTimeout(r, ${ms}))`;
const click = (selector: string) => `document.querySelector(${JSON.stringify(selector)})?.click()`;
const clickText = (selector: string, re: string) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})].find(x => /${re}/.test(x.textContent))?.click()`;
const noaState = await (await fetch(`${BASE}/api/state?e=noa`)).json();
const inv: string | undefined = noaState.docs?.invoices?.[0]?.id;
const year: number = noaState.years?.at(-1) ?? new Date().getFullYear();

/** [entity, path, setup snippet run after load (not a separate case), extra states opened one at a time: [name, snippet]] */
type Route = { e: string; path: string; setup?: string; opens?: [string, string][] };
const ROW = "main tbody tr[tabindex]";
const both = (path: string, r: Omit<Route, "e" | "path"> = {}): Route[] => ["acme", "noa"].map((e) => ({ e, path, ...r }));
const reports = (tab: string): Omit<Route, "e" | "path"> => ({
  setup: `${click("main [popovertarget]")}; await ${sleep(100)}; [...document.querySelectorAll("[popover] button")].find(x => x.textContent.trim() === "${year}")?.click(); await ${sleep(200)};${
    tab === "gl" ? `${clickText("main button", "Expand|פתיחת")}; await ${sleep(200)};` : ""
  }`,
  opens: [["period picker", click("main [popovertarget]")]],
});
const ROUTES: Route[] = [
  ...both("/home", { opens: [["⌘K", click("aside button[aria-keyshortcuts]")]] }),
  ...both("/transactions", {
    opens: [
      ["drawer", click(ROW)],
      ["drawer category", `${click(ROW)}; await ${sleep(400)}; ${click("[data-ui=drawer] button[aria-haspopup=listbox]")}`],
      ["period picker", click("main [popovertarget]")],
    ],
  }),
  ...both("/invoices", { opens: [["drawer", click(ROW)]] }),
  { e: "acme", path: "/invoices", opens: [["new", clickText("main button", "New invoice|חשבונית חדשה")]] },
  ...(inv ? [{ e: "noa", path: `/invoices/${inv}/doc` }] : []),
  ...both("/review"),
  ...both("/reports/pl", reports("pl")),
  { e: "acme", path: "/reports/bs", ...reports("bs") },
  ...both("/reports/cf", reports("cf")),
  ...both("/reports/gl", reports("gl")),
  ...both("/counterparties", { opens: [["row", click(ROW)]] }),
  ...both("/rules", {
    opens: [
      ["peek", click("main td button[title]")],
      ["category", click("main button[aria-haspopup=listbox]")],
    ],
  }),
  ...both("/accounts"),
  ...both("/journal", { opens: [["entry", click("main section button")]] }),
  ...both("/documents"),
  ...both("/connections", {
    opens: [
      ["login form", `[...document.querySelectorAll("main button[aria-pressed]")][1]?.click()`],
      ["csv", `[...document.querySelectorAll("main button[aria-pressed]")].at(-1)?.click()`],
    ],
  }),
  ...both("/settings", { opens: [["vault prompt", clickText("main button", "Unlock|פתיחת")]] }),
  ...both("/setup"),
  { e: "acme", path: "/tax/us" },
  { e: "noa", path: "/tax/il" },
  { e: "noa", path: "/tax/il/review" },
  ...both("/planner"),
  ...both("/taxximizer", { setup: `${click("main li button[aria-expanded]")}; await ${sleep(200)};` }),
  ...both("/you"),
  { e: "noa", path: `/print/${year}` },
  { e: "noa", path: `/print/${year}/1301` },
  {
    e: "acme",
    path: "/dev/ui",
    opens: [
      ["dialog", "location.search += '&open=dialog'"],
      ["drawer", "location.search += '&open=drawer'"],
    ],
  },
];

type Case = { r: Route; width: number; lang: string; theme: string; priv: boolean; open?: [string, string] };
const cases: Case[] = [];
for (const r of ROUTES)
  for (const width of [375, 1280])
    for (const lang of ["en", "he"]) {
      for (const theme of ["light", "dark"]) cases.push({ r, width, lang, theme, priv: false });
      if (width === 375) cases.push({ r, width, lang, theme: "light", priv: true });
      for (const open of r.opens ?? []) cases.push({ r, width, lang, theme: "light", priv: false, open });
    }
const label = (c: Case) => `${c.r.e} ${c.r.path} ${c.width}px ${c.lang} ${c.theme}${c.priv ? " private" : ""}${c.open ? ` [${c.open[0]}]` : ""}`;
const todo = cases.filter((c) => label(c).includes(ONLY));

const READY = "main [data-ui=page-header], main h1, body > * h1, .inv-doc .sheet, .form-page, [data-gallery-ready]";
const failures: string[] = [];
const b = await chrome();
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    b.close();
    cleanup();
    process.exit(130);
  });
let next = 0,
  done = 0;
async function worker() {
  const t = await b.tab();
  let script = "";
  for (let c = todo[next++]; c; c = todo[next++]) {
    const name = label(c),
      t0 = Date.now();
    try {
      await one(t, c, name, script, (id) => (script = id));
    } catch (e) {
      failures.push(`${name}: ${(e as Error).message}`);
    }
    if (process.env.VERBOSE) console.log(`  ${name} ${Date.now() - t0} ms`);
    if (++done % 50 === 0) console.log(`  ${done}/${todo.length}`);
  }
}
type Tab = Awaited<ReturnType<Awaited<ReturnType<typeof chrome>>["tab"]>>;
async function one(t: Tab, c: Case, name: string, script: string, setScript: (id: string) => void) {
  {
    await t.page("Emulation.setDeviceMetricsOverride", { width: c.width, height: 900, deviceScaleFactor: 1, mobile: c.width < 768 });
    await t.page("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: c.theme },
        { name: "prefers-reduced-motion", value: "reduce" },
      ],
    });
    if (script) await t.page("Page.removeScriptToEvaluateOnNewDocument", { identifier: script });
    const ls = { "ob-lang": c.lang, "ob-theme": c.theme, "ob-private": c.priv ? "1" : "0", "ob-entity": c.r.e };
    setScript(
      (
        await t.page("Page.addScriptToEvaluateOnNewDocument", {
          source: `for (const [k, v] of Object.entries(${JSON.stringify(ls)})) localStorage.setItem(k, v);`,
        })
      ).identifier,
    );
    const url = `${BASE}${c.r.path}${c.r.path.includes("?") ? "&" : "?"}e=${c.r.e}&lang=${c.lang}&theme=${c.theme}`;
    const run = async (snippet?: string) => {
      await t.page("Page.navigate", { url });
      const ok = await t.evaluate(
        `(async () => { for (let i = 0; i < 150; i++) { if (document.querySelector(${JSON.stringify(READY)})) { await document.fonts.ready; await ${sleep(300)}; return true; } await ${sleep(100)}; } return false; })()`,
      );
      if (!ok) return false;
      if (c.r.setup) await t.evaluate(`(async () => { ${c.r.setup} })()`);
      if (snippet) {
        await t.evaluate(`(async () => { ${snippet}; })()`);
        // the dev gallery's open=… is a reload
        if (snippet.startsWith("location."))
          await t.evaluate(`(async () => { for (let i = 0; i < 100 && !document.querySelector("[data-gallery-ready]"); i++) await ${sleep(100)}; })()`);
      }
      await t.evaluate(`(async () => { await ${sleep(c.open ? 450 : 250)}; })()`);
      return true;
    };
    if (!(await run(c.open?.[1]))) failures.push(`${name}: did not render`);
    else {
      for (const p of (await t.evaluate(`(${audit.toString()})()`)) as string[]) failures.push(`${name}: ${p}`);
      if (c.r.path === "/dev/ui" && !c.open && c.theme === "light" && !c.priv) {
        // every menu, and the tooltip
        const menus: number = await t.evaluate(`document.querySelectorAll("main [data-ui=menu-trigger]").length`);
        for (let i = 0; i < menus; i++) {
          await t.evaluate(`(async () => { document.querySelectorAll("main [data-ui=menu-trigger]")[${i}].click(); await ${sleep(150)}; })()`);
          for (const p of (await t.evaluate(`(${audit.toString()})()`)) as string[]) failures.push(`${name} menu ${i + 1}: ${p}`);
          await t.evaluate(`document.querySelectorAll("[data-ui=menu]:popover-open").forEach(m => m.hidePopover())`);
        }
        await t.evaluate(`(async () => { document.querySelector("main [data-ui=tooltip] button").focus(); await ${sleep(150)}; })()`);
        for (const p of (await t.evaluate(`(${audit.toString()})()`)) as string[]) failures.push(`${name} tooltip: ${p}`);
      }
      if (SHOTS) {
        const { data } = await t.page("Page.captureScreenshot", { format: "png", captureBeyondViewport: !c.open });
        await Bun.write(join(SHOTS, `${name.replace(/\W+/g, "-")}.png`), Buffer.from(data, "base64"));
      }
    }
  }
}
try {
  await Promise.all(Array.from({ length: JOBS }, worker));
} finally {
  b.close();
  cleanup();
}

const uniq = [...new Set(failures)].sort();
if (uniq.length) {
  console.error(`overflow check: ${uniq.length} problem(s)\n${uniq.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`overflow check: ok (${todo.length} cases: ${ROUTES.length} routes × acme/noa × 375/1280 px × en/he × light/dark, privacy at 375, open states)`);
