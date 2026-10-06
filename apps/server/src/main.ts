// `openbooks` (serve, the default), `openbooks mcp` (MCP over stdio), `openbooks selftest` (the release smoke check).
import { resolve } from "node:path";
import { startServer } from "./server.ts";

const [cmd = "serve"] = process.argv.slice(2);

if (cmd === "selftest") {
  const { selftest } = await import("./selftest.ts");
  const r = await selftest();
  console.log(JSON.stringify({ platform: `${process.platform}-${process.arch}`, bun: Bun.version, ...r }));
  process.exit(Object.values(r).every((c) => c.ok) ? 0 : 1);
} else if (cmd === "mcp") {
  console.log = console.error; // stdout carries the protocol only
  const { ManagedRuntime } = await import("effect");
  const { serveMcpStdio } = await import("@openbooks/tools");
  const { defaultLayer } = await import("./services.ts");
  const rt = ManagedRuntime.make(defaultLayer({ home: resolve(process.env.OPENBOOKS_HOME ?? "entities") }));
  const h = serveMcpStdio((eff) => rt.runPromiseExit(eff));
  console.error(`openbooks-mcp: books at ${resolve(process.env.OPENBOOKS_HOME ?? "entities")}`);
  const quit = () => void h.close().finally(() => rt.dispose().finally(() => process.exit(0)));
  process.stdin.on("end", quit);
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
} else if (cmd === "serve") {
  const s = await startServer({
    home: resolve(process.env.OPENBOOKS_HOME ?? "entities"),
    port: Number(process.env.OPENBOOKS_PORT ?? 8765),
  });
  console.log(`OpenBooks → ${s.url}  (Ctrl+C to stop)`);
  const quit = () => void s.stop().finally(() => process.exit(0)); // closes books.db; the vault key goes with the process
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  if (process.stdout.isTTY)
    Bun.spawn([process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", s.url], {
      stdio: ["ignore", "ignore", "ignore"],
    });
} else {
  console.error("usage: openbooks [serve | mcp | selftest]");
  process.exit(2);
}
