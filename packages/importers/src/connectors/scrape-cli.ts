// Subprocess entry for Scraper.bridge: stdin = one JSON command (never argv: other users can read argv), stdout = one JSON line.
import { run } from "./scrape.ts";

let input = "";
for await (const chunk of process.stdin) input += chunk;
let cmd: unknown = null;
try {
  cmd = JSON.parse(input);
} catch {} // never echo stdin: it carries credentials
process.stdout.write("\n" + JSON.stringify(await run(cmd)) + "\n"); // last line is ours, whatever a dependency printed before it
