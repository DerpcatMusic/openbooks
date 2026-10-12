// Builds the GitHub Pages site into _site/: the landing page (site/) at the root, the app in demo mode at /demo and the
// browser-only app (your own books, kept in IndexedDB) at /app.
// The demo's data is a snapshot of the real server's answers over examples/showcase, so every number is the engine's own.
// bun scripts/demo/build.ts   (OPENBOOKS_PAGES_BASE defaults to /openbooks, the GitHub Pages project path)
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const OUT = join(ROOT, "_site");
const pages = process.env.OPENBOOKS_PAGES_BASE ?? "/openbooks";
const base = `${pages}/demo`;
const appBase = `${pages}/app`;
const sh = (cmd: string[], cwd = ROOT, env: Record<string, string> = {}) => {
  const r = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} exited ${r.exitCode}`);
};

sh(["bun", "scripts/demo/generate.ts"]);

// snapshot
const home = mkdtempSync(join(tmpdir(), "ob-pages-"));
cpSync(join(ROOT, "examples/showcase"), home, { recursive: true });
const port = 20000 + Math.floor(Math.random() * 20000);
const server = Bun.spawn(["bun", "apps/server/src/main.ts"], {
  cwd: ROOT,
  env: { ...process.env, OPENBOOKS_HOME: home, OPENBOOKS_PORT: String(port) },
  stdout: "ignore",
  stderr: "inherit",
});
const api = async (path: string, body?: unknown) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(
        `http://127.0.0.1:${port}${path}`,
        body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {},
      );
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i > 50) throw e;
      await Bun.sleep(100);
    }
  }
};
let data;
try {
  const { person } = await api("/api/person");
  await api("/api/person", { ...person, residence: "il" });
  const first = await api("/api/state");
  const ids: string[] = first.entities.map((e: { id: string }) => e.id);
  data = {
    default: first.entity.id,
    state: Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await api(`/api/state?e=${id}`)]))),
    get: Object.fromEntries(await Promise.all(["/api/person", "/api/vault", "/api/ai/config", "/api/tools"].map(async (p) => [p, await api(p)]))),
  };
} finally {
  server.kill();
  rmSync(home, { recursive: true, force: true });
}

// app in demo mode
sh(["bunx", "vp", "build"], join(ROOT, "apps/web"), { OPENBOOKS_BASE: base, VITE_DEMO: "1", OPENBOOKS_OUT: "build-demo" });
// app in browser-only mode
sh(["bunx", "vp", "build"], join(ROOT, "apps/web"), { OPENBOOKS_BASE: appBase, VITE_LOCAL: "1", OPENBOOKS_OUT: "build-local" });
rmSync(OUT, { recursive: true, force: true });
cpSync(join(ROOT, "site"), OUT, { recursive: true });
cpSync(join(ROOT, "apps/web/build-demo"), join(OUT, "demo"), { recursive: true });
mkdirSync(join(OUT, "demo/demo"));
writeFileSync(join(OUT, "demo/demo/data.json"), JSON.stringify(data));
cpSync(join(ROOT, "apps/web/build-local"), join(OUT, "app"), { recursive: true });
// GitHub Pages answers every missing path with the root 404.html: that is the SPA fallback for deep demo links.
// Deep /app links can't use the demo's shell (different base): the root 404 bounces them to /app/, which restores the URL before the app starts.
const demo404 = readFileSync(join(OUT, "demo/404.html"), "utf8");
writeFileSync(join(OUT, "demo/index.html"), demo404);
const script = (js: string) => `<script>${js}</script>`;
const head = (html: string, js: string) => html.replace("<head>", `<head>${script(js)}`);
writeFileSync(
  join(OUT, "404.html"),
  head(
    demo404,
    `if(location.pathname.startsWith(${JSON.stringify(appBase + "/")})){sessionStorage.obRedirect=location.href;location.replace(${JSON.stringify(appBase + "/")})}`,
  ),
);
const app404 = head(
  readFileSync(join(OUT, "app/404.html"), "utf8"),
  `try{var r=sessionStorage.obRedirect;if(r){delete sessionStorage.obRedirect;history.replaceState(null,"",r)}}catch(e){}`,
);
writeFileSync(join(OUT, "app/404.html"), app404);
writeFileSync(join(OUT, "app/index.html"), app404);
writeFileSync(join(OUT, ".nojekyll"), "");
console.log(`_site ready (demo at ${base}/, your own books at ${appBase}/)`);
