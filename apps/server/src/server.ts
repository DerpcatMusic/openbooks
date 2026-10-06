// Bun.serve on 127.0.0.1: books.py's HTTP API with the same paths, JSON and status codes, plus /api/events (SSE) and /api/vault/*.
// /mcp is MCP Streamable HTTP over the tool registry; /api/ai* is the in-app AI (packages/tools), /api/tools* the ⌘K bar's tools.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, normalize, resolve, sep } from "node:path";
import { classify } from "@openbooks/core";
import { csvPreview, handle, read } from "@openbooks/importers";
import type { EntityMeta, Rule, StatementCheck } from "@openbooks/schema";
import { Cause, Effect, Exit, Fiber, type Layer, ManagedRuntime, Stream } from "effect";
import { ask, configureAi, decide, langOf, loadAi, mcpHttpHandler, ollamaModels, paletteTools, publicAi, runTool, testAi } from "@openbooks/tools";
import { foreign } from "./guard.ts";
import { buildPack } from "./pack.ts";
import { Books, Changes, defaultLayer, type Services, Vault } from "./services.ts";

export interface ServerOptions {
  /** OPENBOOKS_HOME: books.db + one folder per entity */
  home: string;
  /** 0 = any free port */
  port: number;
  /** the built web app on disk (apps/web/build); used when nothing is embedded under `web/` */
  appDir?: string;
  /** services; default: defaultLayer({ home }) */
  layer?: Layer.Layer<Services>;
  /** Chrome for the proof-pack cover */
  chrome?: string;
}

type R = Services;
const RESERVED = new Set(["form", "profile", "overrides"]);
const KINDS = [".pdf", ".csv", ".json"];
const ext = (f: string) => (f.includes(".") ? f.slice(f.lastIndexOf(".")).toLowerCase() : "");
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const enc = new TextEncoder();

/** Thrown inside handlers to answer with a JSON error (books.py send_json(..., code)). */
class Reply {
  constructor(
    readonly body: unknown,
    readonly status: number,
  ) {}
}

/** URL path → Blob for every file embedded under `dir/` (apps/server/build.ts embeds the web build as `web/**`). */
export function embeddedStatic(dir: string): Map<string, Blob> {
  const files = new Map<string, Blob>();
  for (const blob of Bun.embeddedFiles as (Blob & { name: string })[]) if (blob.name.startsWith(`${dir}/`)) files.set(blob.name.slice(dir.length), blob);
  return files;
}

export async function startServer(o: ServerOptions) {
  const home = resolve(o.home);
  const rt = ManagedRuntime.make(o.layer ?? defaultLayer({ home }));
  await rt.runPromise(Effect.void); // build the services now: inbox watchers and the data_version poll start with the server
  const run = <A, E>(eff: Effect.Effect<A, E, R>) => rt.runPromise(eff);
  const embedded = embeddedStatic("web");
  const appDir = resolve(o.appDir ?? join(import.meta.dir, "../../web/build"));

  const mcp = mcpHttpHandler((eff) => rt.runPromiseExit(eff));
  const books = <A, E>(f: (b: Books["Service"]) => Effect.Effect<A, E, R>) => run(Books.use(f));
  /**
   * "You" (docs/architecture.md § Country packs, person level): one doc(_app, "person") = { residence, facts }. Until it's saved,
   * GET derives it from every business's old per-entity `advisor` doc (+ profile discharge/serviceMonths); the first non-empty
   * answer per key wins, so nothing is lost. `saved: false` tells the app to store the merge once.
   */
  const person = () =>
    books((bs) =>
      Effect.gen(function* () {
        const p = yield* bs.doc<{ residence: string; facts: Record<string, unknown> } | null>("_app", "person", null);
        if (p) return { person: p, saved: true };
        const facts: Record<string, unknown> = {};
        for (const x of yield* bs.entities) {
          const prof = yield* bs.doc<Record<string, unknown>>(x.id, "profile", {});
          const from = { ...(yield* bs.doc<Record<string, unknown>>(x.id, "advisor", {})), discharge: prof.discharge, serviceMonths: prof.serviceMonths };
          for (const [k, v] of Object.entries(from)) if ((facts[k] === undefined || facts[k] === "") && v !== undefined && v !== null && v !== "") facts[k] = v;
        }
        return { person: { residence: "", facts }, saved: false };
      }),
    );
  const vault = <A, E>(f: (v: Vault["Service"]) => Effect.Effect<A, E, R>) => run(Vault.use(f));
  const publish = (c: Parameters<Changes["Service"]["publish"]>[0]) => run(Changes.use((ch) => ch.publish(c)));
  const state = (e: string) => books((b) => b.state(e)).then((s) => json(s));
  /** books.py Entity(eid): a known id ([a-z0-9-]+, JSON-era folders migrate on the way) or KeyError → 404. */
  const entity = async (id: string | null) => {
    if (!id || !/^[a-z0-9-]+$/.test(id) || !(await books((b) => b.entities)).some((x) => x.id === id)) throw new Reply({ error: "unknown entity" }, 404);
    return id;
  };

  const file = (p: string): Blob | null => {
    if (embedded.size) return embedded.get(p) ?? null;
    const f = join(appDir, normalize(p));
    return (f === appDir || f.startsWith(appDir + sep)) && existsSync(f) && statSync(f).isFile() ? Bun.file(f) : null;
  };
  const staticFile = (path: string) => {
    let p: string;
    try {
      p = decodeURIComponent(path);
    } catch {
      return new Response("not found", { status: 404 });
    }
    if (p.endsWith("/")) p += "index.html";
    // SPA: unknown non-API paths get index.html (books.py answered 404; the SvelteKit fallback page needs this)
    const blob = file(p) ?? (p.startsWith("/api/") || p.startsWith("/files/") ? null : file("/index.html"));
    return blob ? new Response(blob) : new Response("not found", { status: 404 });
  };

  const sendFile = (path: string, ctype = "application/pdf") =>
    new Response(Bun.file(path), {
      headers: { "Content-Type": ctype, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(basename(path))}` },
    });

  /** /files/<entity>/inbox/<name>, /files/<entity>/proofs/<year>/<name>, /files/<entity>/attachments/<txn>/<name> */
  const files = (path: string) => {
    let p: string;
    try {
      p = realpathSync(join(home, decodeURIComponent(path.slice("/files/".length))));
    } catch {
      return json({ error: "not found" }, 404);
    }
    const roots = readdirSync(home)
      .filter((d) => statSync(join(home, d)).isDirectory())
      .flatMap((d) => ["inbox", "proofs", "attachments"].map((s) => join(home, d, s)))
      .filter(existsSync)
      .map((r) => realpathSync(r));
    if (!statSync(p).isFile() || !roots.some((r) => p.startsWith(r + sep))) return json({ error: "not found" }, 404);
    const types: Record<string, string> = { ".csv": "text/csv; charset=utf-8", ".json": "application/json" };
    return sendFile(p, types[ext(p)] ?? "application/pdf");
  };

  const events = (req: Request, server: Bun.Server<unknown>) => {
    server.timeout(req, 0);
    let fiber: Fiber.Fiber<unknown, unknown> | undefined, ping: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const send = (s: string) => {
          try {
            c.enqueue(enc.encode(s));
          } catch {
            /* closed */
          }
        };
        fiber = rt.runFork(
          Changes.use((ch) =>
            Effect.flatMap(ch.version, (v) => {
              send(`event: hello\ndata: ${JSON.stringify({ v })}\n\n`);
              return Stream.runForEach(ch.subscribe, (x) => Effect.sync(() => send(`event: change\ndata: ${JSON.stringify(x)}\n\n`)));
            }),
          ),
        );
        ping = setInterval(() => send(": ping\n\n"), 25_000);
      },
      cancel() {
        clearInterval(ping);
        if (fiber) rt.runFork(Fiber.interrupt(fiber));
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  };

  /** POST /api/ai: the agent loop as SSE (text/tool/confirm/tool_done/error/done); closing the stream interrupts it. */
  const aiStream = (req: Request, server: Bun.Server<unknown>, body: Record<string, unknown>) => {
    server.timeout(req, 0); // a write can wait minutes for Approve
    let fiber: Fiber.Fiber<unknown, unknown> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const emit = (ev: unknown) => {
          try {
            c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
          } catch {
            /* closed */
          }
        };
        const close = Effect.sync(() => {
          try {
            c.close();
          } catch {
            /* closed */
          }
        });
        fiber = rt.runFork(ask(body, emit).pipe(Effect.ensuring(close)));
      },
      cancel() {
        if (fiber) rt.runFork(Fiber.interrupt(fiber));
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  };
  const aiApi = async (path: string, req: Request, server: Bun.Server<unknown>, body: Record<string, unknown>) => {
    const lang = langOf(body.lang);
    switch (path) {
      case "/api/ai":
        return aiStream(req, server, body);
      case "/api/ai/config":
        return json(await run(configureAi(body, lang)));
      case "/api/ai/test":
        return json(await run(testAi(lang))); // the saved settings: the UI saves first
      case "/api/ai/models":
        return json(await run(ollamaModels(body.base, lang)));
      case "/api/ai/confirm":
        return json({ ok: decide(String(body.id), body.approve === true) });
    }
    return json({ error: "not found" }, 404);
  };

  const vaultApi = async (path: string, body: Record<string, unknown>) => {
    const pass = (k: string) => {
      const v = body[k];
      if (typeof v !== "string" || !v) throw new Reply({ error: "passphrase required" }, 400);
      return v;
    };
    const exit = await rt.runPromiseExit(
      Vault.use((v): Effect.Effect<void, { _tag: string }> => {
        switch (path) {
          case "/api/vault/setup":
            return v.setup(pass("passphrase"));
          case "/api/vault/unlock":
            return v.unlock(pass("passphrase"));
          case "/api/vault/lock":
            return v.lock;
          case "/api/vault/change":
            return v.change(pass("passphrase"), pass("newPassphrase"));
          case "/api/vault/reset":
            return v.reset;
          default:
            throw new Reply({ error: "not found" }, 404);
        }
      }),
    );
    if (Exit.isFailure(exit)) {
      const err = Cause.squash(exit.cause);
      if (err instanceof Reply) throw err;
      const tag = (err as { _tag?: string })._tag;
      if (tag === "VaultExists") return json({ error: "a vault passphrase is already set" }, 409);
      if (tag === "NoVault") return json({ error: "no vault passphrase is set" }, 409);
      if (tag === "WrongPassphrase") return json({ error: "wrong passphrase" }, 401);
      throw err;
    }
    return json({ status: await vault((v) => v.status) });
  };

  const get = async (u: URL, req: Request, server: Bun.Server<unknown>) => {
    const q = u.searchParams,
      path = u.pathname;
    if (path === "/api/events") return events(req, server);
    if (path === "/api/state") {
      // unknown or missing ?e= opens the first business; none yet → the app shows setup
      try {
        return await state(await entity(q.get("e")));
      } catch (x) {
        if (!(x instanceof Reply)) throw x;
        const es = await books((b) => b.entities);
        return es[0] ? state(es[0].id) : json({ entities: [], setup: true });
      }
    }
    if (path === "/api/person") return json(await person());
    if (path === "/api/vault") return json({ status: await vault((v) => v.status) });
    if (path === "/api/ai/config") return json(publicAi(await run(loadAi)));
    if (path === "/api/tools") return json({ tools: paletteTools() });
    if (path === "/api/pack") {
      const e = await entity(q.get("e"));
      if (q.get("year") === null) throw new Reply({ error: "unknown entity" }, 404); // books.py: KeyError → this 404
      const year = Number.parseInt(q.get("year")!, 10);
      if (!Number.isInteger(year)) throw new Reply({ error: "bad year" }, 400);
      const st = await books((b) => b.state(e));
      const out = await buildPack({
        dir: join(home, e),
        entity: e,
        year,
        port: server.port!,
        checks: st.checks as StatementCheck[],
        ...(o.chrome ? { chrome: o.chrome } : {}),
      });
      return sendFile(out);
    }
    if (path.startsWith("/files/")) return files(path);
    return staticFile(path);
  };

  const post = async (u: URL, req: Request, server: Bun.Server<unknown>) => {
    const q = u.searchParams,
      path = u.pathname;
    const raw = new Uint8Array(await req.arrayBuffer());
    const body = () => {
      try {
        const b = JSON.parse(new TextDecoder().decode(raw));
        if (typeof b !== "object" || b === null) throw new Error();
        return b as Record<string, unknown>;
      } catch {
        throw new Reply({ error: "bad JSON" }, 400);
      }
    };
    if (path === "/api/ai" || path.startsWith("/api/ai/")) return aiApi(path, req, server, raw.length ? body() : {});
    if (path === "/api/tools/run") {
      // ⌘K: the click is the user's yes; the tool runs on the app's current business
      const b = body();
      const e = await entity(typeof b.entity === "string" ? b.entity : null);
      const r = await rt.runPromiseExit(runTool(String(b.name), b.args ?? {}, { entity: e, lang: langOf(b.lang), via: "palette", confirmed: true }));
      if (r._tag === "Success") return json({ ok: true, result: r.value });
      const f = Cause.squash(r.cause) as { _tag?: string; message?: string };
      if (f?._tag === "ToolError") return json({ error: f.message }, 400);
      throw f;
    }
    if (path.startsWith("/api/vault/")) return vaultApi(path, raw.length ? body() : {});
    if (path === "/api/entity") {
      // {id, name, short, kind, currency, flag}: add a business
      const { id = "", ...meta } = body();
      const exit = await rt.runPromiseExit(Books.use((b) => b.createEntity(String(id), meta as EntityMeta)));
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause) as { _tag?: string; message?: string };
        if (err._tag === "BadInput") return json({ error: err.message }, 400);
        throw err;
      }
      return state(String(id));
    }
    if (path === "/api/person") {
      // {residence, facts}: replaces doc(_app, "person"); facts are flat answers (string | number | boolean)
      const { residence, facts } = body();
      const ok = (v: unknown) => ["string", "number", "boolean"].includes(typeof v);
      if (
        typeof residence !== "string" ||
        !/^[a-z]{2}$/.test(residence) ||
        typeof facts !== "object" ||
        !facts ||
        Array.isArray(facts) ||
        !Object.values(facts).every(ok)
      )
        return json({ error: "bad person" }, 400);
      await books((bs) => bs.putDoc("_app", "person", { residence, facts }));
      return json(await person());
    }
    const e = await entity(q.get("e"));
    const dir = join(home, e);
    if (path === "/api/attach") {
      // raw file body; ?txn=<id>&name=<file>: a receipt or invoice for one transaction
      const txn = q.get("txn") ?? "",
        name = basename(q.get("name") ?? "");
      if (!/^[A-Za-z0-9-]+$/.test(txn) || !name || name === "." || name === "..") return json({ error: "bad attachment" }, 400);
      mkdirSync(join(dir, "attachments", txn), { recursive: true });
      writeFileSync(join(dir, "attachments", txn, name), raw);
      await publish({ entity: e, topics: ["docs"] });
      return state(e);
    }
    if (path === "/api/upload") {
      // raw file body; ?e=il&to=auto|inbox|proofs&year=2025&name=...
      const name = basename(q.get("name") ?? "");
      let to = q.get("to") ?? "";
      if (!KINDS.includes(ext(name))) return json({ error: "only PDF, CSV or JSON" }, 400);
      if (to === "auto") to = (await looksLikeStatement(e, name, raw)) ? "inbox" : "proofs"; // statements go to the books, anything else is a proof
      let dest = join(dir, "inbox");
      if (to !== "inbox") {
        const y = Number.parseInt(q.get("year") ?? "", 10);
        if (!Number.isInteger(y)) return json({ error: "bad year" }, 400);
        dest = join(dir, "proofs", String(y));
      }
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, name), raw);
      if (to !== "inbox") await publish({ entity: e, topics: ["docs"] }); // inbox: the ingest in state() publishes
      return state(e);
    }
    const b = body();
    if (path === "/api/csv-preview") {
      // {text, profile?}: column mapping for "Import a CSV from any bank"
      try {
        if (typeof b.text !== "string") throw new Error();
        return json(csvPreview(b.text, (b.profile ?? undefined) as Parameters<typeof csvPreview>[1]));
      } catch {
        return json({ error: "can't read that as CSV" }, 400);
      }
    }
    switch (path) {
      case "/api/category": {
        // {ids, category, rule?}
        const ids = b.ids as string[],
          category = String(b.category);
        if (!Array.isArray(ids)) throw new Reply({ error: "bad request" }, 400);
        await books((bs) =>
          Effect.gen(function* () {
            const r = classify(ids, category, yield* bs.rules(e), yield* bs.doc(e, "overrides", {}), (b.rule as string) || undefined);
            if (b.rule) yield* bs.setRules(e, r.rules);
            yield* bs.putDoc(e, "overrides", r.overrides);
          }),
        );
        break;
      }
      case "/api/rules":
        if (!Array.isArray(b.rules)) throw new Reply({ error: "bad request" }, 400);
        await books((bs) =>
          bs.setRules(
            e,
            (b.rules as [unknown, unknown][]).map(([m, c]) => [String(m), String(c)] as Rule),
          ),
        );
        break;
      case "/api/form": {
        // {year, values: {key: value|null}}
        const values = b.values as Record<string, unknown>;
        await books((bs) =>
          Effect.gen(function* () {
            const form = yield* bs.doc<Record<string, Record<string, unknown>>>(e, "form", {});
            const y = (form[String(b.year)] ??= {});
            for (const [k, v] of Object.entries(values))
              if (v === null) delete y[k];
              else y[k] = v;
            yield* bs.putDoc(e, "form", form);
          }),
        );
        break;
      }
      case "/api/profile":
        await books((bs) => Effect.flatMap(bs.doc(e, "profile", {}), (p) => bs.putDoc(e, "profile", { ...p, ...b })));
        break;
      case "/api/meta": {
        // {name?, short?, flag?, currency?, types?: {year: business type}}: rename or change structure
        const patch = Object.fromEntries(Object.entries(b).filter(([k]) => ["name", "short", "flag", "currency", "types"].includes(k)));
        await books((bs) => bs.setMeta(e, patch));
        break;
      }
      case "/api/doc": {
        // {name, value|null}: invoices, journal, customers, planner, ...
        const name = b.name;
        if (typeof name !== "string" || !/^[a-z0-9-]+$/.test(name) || RESERVED.has(name)) return json({ error: "bad name" }, 400);
        await books((bs) => bs.putDoc(e, name, b.value ?? null));
        break;
      }
      case "/api/year": {
        // {year, remove?}: a tax year exists once it has a documents folder (or transactions)
        const y = Math.trunc(Number(b.year));
        if (!Number.isFinite(y)) throw new Reply({ error: "bad request" }, 400);
        const d = join(dir, "proofs", String(y));
        if (!(y >= 1990 && y <= 2100)) return json({ error: "bad year" }, 400);
        if (b.remove) {
          if (existsSync(d) && !readdirSync(d).length) rmdirSync(d);
        } else mkdirSync(d, { recursive: true });
        await publish({ entity: e, topics: ["docs"] });
        break;
      }
      case "/api/taxtables": {
        // {country, year, table|null}: books.py rewrote taxtables.json; here the edit is an override in doc(_app, "taxtables")
        const country = String(b.country),
          year = String(b.year);
        await books((bs) =>
          Effect.gen(function* () {
            const t = yield* bs.doc<Record<string, Record<string, unknown>>>("_app", "taxtables", {});
            (t[country] ??= {})[year] = b.table ?? null;
            yield* bs.putDoc("_app", "taxtables", t);
          }),
        );
        break;
      }
      case "/api/connect":
      case "/api/sync":
      case "/api/disconnect": {
        // a locked vault fails VaultLocked → 423 (below); secrets never leave the connector
        const r = await run(handle(e, path, b));
        if (r && "error" in r) return json(r, 400);
        break;
      }
      default:
        return json({ error: "not found" }, 404);
    }
    return state(e);
  };

  /** upload to=auto: does a statement reader take this file? */
  const looksLikeStatement = async (e: string, name: string, bytes: Uint8Array) => {
    const tmp = mkdtempSync(join(tmpdir(), "openbooks-up-"));
    try {
      const p = join(tmp, name);
      writeFileSync(p, bytes);
      const text = ext(name) === ".pdf" ? new TextDecoder().decode(Bun.spawnSync(["pdftotext", "-layout", p, "-"]).stdout) : undefined;
      const [meta, profile, csvProfiles] = await books((b) =>
        Effect.all([Effect.map(b.entities, (es) => es.find((x) => x.id === e)!), b.doc(e, "profile", {}), b.doc(e, "csv-profiles", [])]),
      );
      read(text === undefined ? { name, bytes } : { name, bytes, text }, { meta, profile, csvProfiles, siblingPdfPeriods: () => [] });
      return true;
    } catch {
      return false;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: o.port,
    idleTimeout: 255, // the proof pack waits for Chrome
    async fetch(req, server) {
      const u = new URL(req.url);
      if (u.pathname === "/mcp") {
        // books.py → mcp_server.http: another site (Origin) or a DNS-rebound name (Host) gets a JSON-RPC 403
        if (foreign(req.headers))
          return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Forbidden: MCP is only served to local clients" } }, 403);
        return mcp.fetch(req);
      }
      if (foreign(req.headers)) return json({ error: "forbidden" }, 403);
      try {
        if (req.method === "GET" || req.method === "HEAD") return await get(u, req, server);
        if (req.method === "POST") return await post(u, req, server);
        return json({ error: "method not allowed" }, 501);
      } catch (x) {
        if (x instanceof Reply) return json(x.body, x.status);
        const err = x instanceof Error ? x : Cause.isCause(x) ? Cause.squash(x) : x;
        if (err instanceof Reply) return json(err.body, err.status);
        const tag = (err as { _tag?: string })?._tag;
        if (tag === "VaultLocked") return json({ error: "unlock OpenBooks in the app first" }, 423);
        if (tag === "AIError") return json({ error: (err as Error).message }, 400);
        if (tag === "UnknownEntity") return json({ error: "unknown entity" }, 404);
        console.error(`${req.method} ${u.pathname}: ${(err as Error)?.name ?? "error"}`); // never the message: it could carry request data
        return json({ error: "internal error" }, 500);
      }
    },
  });

  return {
    server,
    url: `http://127.0.0.1:${server.port}`,
    port: server.port!,
    runtime: rt,
    /** stop serving and release the services (closes books.db) */
    async stop() {
      await server.stop(true);
      await mcp.close();
      await rt.dispose(); // interrupts the watchers and the poll, closes books.db
    },
  };
}
