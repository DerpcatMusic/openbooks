// Release smoke: builds the host binary and runs its `selftest` from a foreign cwd (proves nothing is read from the repo).
// `bun scripts/release/smoke.ts` -> exit 0 when embedded static serving, bun:sqlite, the scrapers + system Chrome
// (about:blank only) and the BUN_BE_BUN scrape.js fallback all work. Needs Chrome/Chromium; never contacts a bank.
// ponytail: selftest lives in the spike entry; move it to `openbooks selftest` in src/main.ts when 2.8 lands.
import os from "node:os";
import path from "node:path";
import { build } from "../../apps/server/build.ts";

const host = `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const [out] = await build([host]);
console.table([out]);
const proc = Bun.spawn([path.resolve(import.meta.dir, "../..", out!.file), "selftest"], { cwd: os.tmpdir(), stdout: "pipe", stderr: "inherit" });
const report = JSON.parse(await new Response(proc.stdout).text()) as Record<string, unknown>;
console.log(JSON.stringify(report, null, 2));
process.exit(await proc.exited);
