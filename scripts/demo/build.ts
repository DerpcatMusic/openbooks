// Builds the GitHub Pages site into _site/: the landing page (site/) at the root and the app in demo mode at /demo.
// The demo's data is a snapshot of the real server's answers over examples/showcase, so every number is the engine's own.
// bun scripts/demo/build.ts   (OPENBOOKS_PAGES_BASE defaults to /openbooks, the GitHub Pages project path)
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const OUT = join(ROOT, "_site");
const base = `${process.env.OPENBOOKS_PAGES_BASE ?? "/openbooks"}/demo`;
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
rmSync(OUT, { recursive: true, force: true });
cpSync(join(ROOT, "site"), OUT, { recursive: true });
cpSync(join(ROOT, "apps/web/build-demo"), join(OUT, "demo"), { recursive: true });
mkdirSync(join(OUT, "demo/demo"));
writeFileSync(join(OUT, "demo/demo/data.json"), JSON.stringify(data));
// GitHub Pages answers every missing path with the root 404.html: that is the SPA fallback for deep demo links.
cpSync(join(OUT, "demo/404.html"), join(OUT, "demo/index.html"));
cpSync(join(OUT, "demo/404.html"), join(OUT, "404.html"));
writeFileSync(join(OUT, ".nojekyll"), "");
console.log(`_site ready (demo at ${base}/)`);
