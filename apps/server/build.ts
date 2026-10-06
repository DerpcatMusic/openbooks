// One-file release build: `bun apps/server/build.ts [target...|--all]` -> dist/openbooks-<target>[.exe].
// Embeds the web build as `web/**` (served from memory via Bun.embeddedFiles) and connectors/scrape.mjs bundled with its
// dependencies as `scrape.js`, the fallback run as `BUN_BE_BUN=1 openbooks scrape.js` if the scrapers ever fail in-process.
// Entry: apps/server/src/main.ts once it exists, else the spike entry. See docs/architecture.md "Distribution".
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, "stage");
export const TARGETS = ["bun-linux-x64", "bun-darwin-arm64", "bun-darwin-x64", "bun-windows-x64"] as const;

const entry = [path.join(import.meta.dir, "src/main.ts"), path.join(import.meta.dir, "build-spike/main.ts")].find((f) => fs.existsSync(f))!;
// SvelteKit static build once apps/web has one; until then the legacy app/ build.
const web = [path.join(ROOT, "apps/web/build"), path.join(ROOT, "app")].find((d) => fs.existsSync(path.join(d, "index.html")));
if (!web) throw new Error("no web build: run the apps/web build first");

/** Stages embedded files under fixed names: compile.assets names them by the asset path's basename. */
async function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.cpSync(web!, path.join(STAGE, "web"), { recursive: true });
  const r = await Bun.build({ entrypoints: [path.join(ROOT, "connectors/scrape.mjs")], target: "bun", minify: true, outdir: STAGE, naming: "scrape.js" });
  if (!r.success) throw new AggregateError(r.logs, "scrape.mjs bundle failed");
}

export async function build(targets: readonly string[]) {
  await stage();
  const outs: { target: string; file: string; mb: number }[] = [];
  for (const target of targets) {
    const file = path.join(DIST, `openbooks-${target.replace(/^bun-/, "")}${target.includes("windows") ? ".exe" : ""}`);
    const r = await Bun.build({
      entrypoints: [entry],
      minify: true,
      compile: { target: target as Bun.Build.CompileTarget, outfile: file, assets: [path.join(STAGE, "web"), path.join(STAGE, "scrape.js")] },
    });
    if (!r.success) throw new AggregateError(r.logs, `compile ${target} failed`);
    outs.push({ target, file: path.relative(ROOT, file), mb: +(fs.statSync(file).size / 2 ** 20).toFixed(1) });
  }
  return outs;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const host = `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  const targets = args.includes("--all") ? TARGETS : args.length ? args : [host];
  console.log(`entry ${path.relative(ROOT, entry)}, web ${path.relative(ROOT, web)}`);
  console.table(await build(targets));
}
