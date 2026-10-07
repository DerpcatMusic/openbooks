// Port of test_ai.py: a fake LLM provider (an in-process HTTP server answering scripted SSE) drives the agent loop through the real
// TS server. Proves read tools run on their own, a write waits for Approve/Deny, API keys never reach /api/state, /api/ai/config or
// the SSE stream, the vault seals the key (locked → 423), he/en follow `lang`, and the Origin/Host guard covers /api/ai.
// Never calls a real provider. Ports 8943 (fake provider) and 8944 (server).
import { createServer, type IncomingMessage, type Server } from "node:http";
import { request } from "node:http";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { http, type Running, startTs, testBooks } from "./testing.ts";

const KEY = "sk-ant-TESTSECRET-0123456789";
const FAKE = 8943,
  PORT = 8944;
const BASE = `http://127.0.0.1:${FAKE}/v1`;
type J = Record<string, any>;

// ---------- the fake provider ----------
const calls: { url: string; headers: IncomingMessage["headers"]; body: J }[] = [];
let script: (string[] | { status: number; body: J })[] = [];
let fake: Server;
const ev = (d: unknown) => `data: ${JSON.stringify(d)}`;
const anthText = (t: string) => [
  ev({ type: "message_start" }),
  ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } }),
  ev({ type: "message_stop" }),
];
const anthTool = (id: string, name: string, args: J) => {
  const s = JSON.stringify(args);
  return [
    ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Looking. " } }),
    ev({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id, name, input: {} } }),
    ev({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: s.slice(0, 5) } }),
    ev({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: s.slice(5) } }),
    ev({ type: "message_delta", delta: { stop_reason: "tool_use" } }),
    ev({ type: "message_stop" }),
  ];
};
const oaiTool = (id: string, name: string, args: J) => {
  const s = JSON.stringify(args);
  return [
    ev({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }] } }] }),
    ev({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: s.slice(0, 4) } }] } }] }),
    ev({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: s.slice(4) } }] }, finish_reason: "tool_calls" }] }),
    "data: [DONE]",
  ];
};
const oaiText = (t: string) => [ev({ choices: [{ index: 0, delta: { content: t } }] }), "data: [DONE]"];

// ---------- the app ----------
let home: string, clean: () => void, srv: Running;
beforeAll(async () => {
  [home, clean] = testBooks();
  fake = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      calls.push({ url: `${req.url}`, headers: req.headers, body: b ? JSON.parse(b) : {} });
      const next = script.shift() ?? { status: 500, body: { error: "script ran out" } };
      if (Array.isArray(next)) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(next.map((l) => `${l}\n\n`).join(""));
      } else res.writeHead(next.status, { "Content-Type": "application/json" }).end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((ok) => fake.listen(FAKE, "127.0.0.1", ok));
  srv = await startTs(home, { OPENBOOKS_PORT: String(PORT) });
});
afterAll(async () => {
  srv.stop();
  await new Promise((ok) => fake.close(ok));
  clean();
});

const req = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await http(PORT, body === undefined ? "GET" : "POST", path, body, { "Content-Type": "application/json", ...headers });
  return [r.status, r.body.toString()] as const;
};
/** POST /api/ai; on(ev) runs as each event arrives (the stream waits on a confirm). */
const stream = (body: J, on?: (e: J) => unknown) =>
  new Promise<[string, J[]]>((ok, no) => {
    const data = Buffer.from(JSON.stringify(body));
    const r = request(
      { host: "127.0.0.1", port: PORT, method: "POST", path: "/api/ai", headers: { "Content-Type": "application/json", "Content-Length": data.length } },
      (res) => {
        expect(res.headers["content-type"]).toBe("text/event-stream");
        let raw = "",
          buf = "";
        const evs: J[] = [];
        res.on("data", (c: Buffer) => {
          raw += c;
          buf += c;
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const l = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (l.startsWith("data: ")) {
              const e = JSON.parse(l.slice(6));
              evs.push(e);
              void on?.(e);
            }
          }
        });
        res.on("end", () => ok([raw, evs]));
      },
    );
    r.on("error", no);
    r.end(data);
  });
const state = async (e = "acme") => JSON.parse((await req(`/api/state?e=${e}`))[1]);
const ask = (content: string, extra: J = {}) => ({ messages: [{ role: "user", content }], entity: "acme", ...extra });

test("the in-app AI end to end", { timeout: 60_000 }, async () => {
  const cloud = ((await state()).txns as J[]).filter((t) => t.desc === "Cloud Host").map((t) => t.id);
  expect(cloud).toHaveLength(2);

  // not configured: a clear error (localized), no provider call
  let [, evs] = await stream(ask("hi"));
  expect(evs.at(-1)).toMatchObject({ type: "error", error: expect.stringContaining("Settings") });
  [, evs] = await stream(ask("hi", { lang: "he" }));
  expect(evs.at(-1)!.error).toContain("הגדרות");
  expect(calls).toHaveLength(0);

  // settings: key stored, only ever shown masked; bad input → 400
  let [st, out] = await req("/api/ai/config", { provider: "anthropic", model: "", base: BASE, key: KEY });
  expect(st).toBe(200);
  expect(out).not.toContain(KEY);
  expect(JSON.parse(out)).toMatchObject({ keys: { anthropic: "sk-…6789" }, ready: true });
  expect(JSON.parse(out).providers.anthropic.model).toBe("claude-sonnet-5-5");
  for (const p of ["/api/ai/config", "/api/state?e=acme", "/api/state"]) expect((await req(p))[1]).not.toContain(KEY);
  [st, out] = await req("/api/ai/config", { provider: "anthropic", model: "claude-opus-5-5", base: BASE }); // no key typed: keeps the old one
  expect(JSON.parse(out)).toMatchObject({ ready: true, model: "claude-opus-5-5", keys: { anthropic: "sk-…6789" } });
  expect(await req("/api/ai/config", { provider: "nope" })).toEqual([400, JSON.stringify({ error: "unknown provider" })]);
  expect((await req("/api/ai/config", { provider: "custom", base: "file:///etc", lang: "he" }))[0]).toBe(400);

  // Anthropic: a read tool runs by itself, a write pauses for Approve, then runs
  script = [
    anthTool("tu1", "list_transactions", { search: "cloud" }),
    anthTool("tu2", "classify", { ids: cloud, category: "expense:software" }),
    anthText("Done: **2** set."),
  ];
  const seen: string[] = [];
  let raw: string;
  [raw, evs] = await stream(ask("What did Cloud Host cost?", { year: 2026 }), async (e) => {
    if (e.type !== "confirm") return;
    expect(e.summary).toContain("expense:software");
    expect(e.summary).toContain("2 transaction");
    const now = (await state()).txns as J[];
    expect(cloud.map((id) => now.find((t) => t.id === id)!.category)).not.toContain("expense:software"); // not written before Approve
    seen.push(e.id);
    expect((await req("/api/ai/confirm", { id: e.id, approve: true }))[1]).toBe('{"ok":true}');
  });
  const kinds = evs.map((x) => x.type);
  expect(kinds.filter((k) => k === "tool")).toHaveLength(2);
  expect(kinds.filter((k) => k === "confirm")).toHaveLength(1);
  expect(kinds.at(-1)).toBe("done");
  const done = evs.filter((x) => x.type === "tool_done");
  expect(done[0]!.ok).toBe(true);
  expect(new Set(done[0]!.txns)).toEqual(new Set(cloud));
  expect(done[1]!.ok).toBe(true);
  expect(
    evs
      .filter((x) => x.type === "text")
      .map((x) => x.text)
      .join(""),
  ).toMatch(/Done: \*\*2\*\* set\.$/);
  const after = (await state()).txns as J[];
  for (const id of cloud) expect(after.find((t) => t.id === id)!.category).toBe("expense:software");
  expect(calls).toHaveLength(3);
  const first = calls[0]!;
  expect(first.url).toBe("/v1/messages");
  expect(first.headers["x-api-key"]).toBe(KEY);
  expect(first.headers["anthropic-version"]).toBe("2023-06-01");
  expect(first.body).toMatchObject({ model: "claude-opus-5-5", stream: true });
  expect(first.body.system).toContain("acme");
  expect(first.body.system).toContain("not tax or legal advice");
  expect(first.body.tools.map((t: J) => t.name)).toContain("bank_sync");
  for (const t of first.body.tools) expect(Object.keys(t.input_schema.properties ?? {})).not.toEqual(expect.arrayContaining(["entity"]));
  const second = calls[1]!.body.messages as J[];
  expect(second.at(-1)!.role).toBe("user");
  expect(second.at(-1)!.content[0].type).toBe("tool_result");
  expect(second.at(-1)!.content[0].content).toContain("Cloud Host");
  expect(raw).not.toContain(KEY);
  expect((await req("/api/ai/confirm", { id: seen[0], approve: true }))[1]).toBe('{"ok":false}'); // used up

  // Hebrew: the system prompt and the Approve card follow lang
  calls.length = 0;
  script = [anthTool("h1", "classify", { ids: cloud, category: "expense:software" }), anthText("בוצע")];
  [, evs] = await stream(ask("סווג", { lang: "he" }), (e) => e.type === "confirm" && req("/api/ai/confirm", { id: e.id, approve: false }));
  expect(evs.find((x) => x.type === "confirm")!.summary).toContain("לסווג 2 תנועות");
  expect(calls[0]!.body.system).toContain("ממשק האפליקציה בעברית");

  // OpenAI-compatible (Ollama: no key): a denied write never runs; the model is told
  await req("/api/ai/config", { provider: "ollama", model: "llama3.2", base: BASE });
  calls.length = 0;
  script = [oaiTool("c1", "set_rules", { rules: [] }), oaiText("OK, left the rules alone.")];
  const rules = (await state()).rules;
  [, evs] = await stream(ask("clear rules"), (e) => e.type === "confirm" && req("/api/ai/confirm", { id: e.id, approve: false }));
  expect((await state()).rules).toEqual(rules);
  expect(evs.find((x) => x.type === "tool_done")!.ok).toBe(false);
  expect(evs.at(-1)!.type).toBe("done");
  expect(calls[0]!.url).toBe("/v1/chat/completions");
  expect(calls[0]!.headers.authorization).toBeUndefined();
  expect(calls[0]!.body.messages[0].role).toBe("system");
  expect(calls[0]!.body.tools[0].type).toBe("function");
  const msgs = calls[1]!.body.messages as J[];
  expect(msgs.at(-2)!.tool_calls[0].function.name).toBe("set_rules");
  expect(msgs.at(-1)!.role).toBe("tool");
  expect(msgs.at(-1)!.content).toContain("declined");

  // provider errors never echo the key
  await req("/api/ai/config", { provider: "anthropic", model: "", base: BASE });
  script = [{ status: 401, body: { error: { message: `invalid x-api-key ${KEY}` } } }];
  [raw, evs] = await stream(ask("hi"));
  expect(evs.at(-1)!.type).toBe("error");
  expect(evs.at(-1)!.error).toContain("401");
  expect(raw).not.toContain(KEY);
  script = [{ status: 401, body: { error: `bad key ${KEY}` } }];
  [st, out] = await req("/api/ai/test", {});
  expect(st).toBe(400);
  expect(out).not.toContain(KEY);
  script = [anthText("OK")];
  expect(JSON.parse((await req("/api/ai/test", {}))[1])).toEqual({ ok: true, model: "claude-sonnet-5-5", reply: "OK" });

  // step cap: a model that keeps calling tools stops after 8 model calls
  calls.length = 0;
  script = Array.from({ length: 8 }, (_, i) => anthTool(`t${i}`, "balances", {}));
  [, evs] = await stream(ask("loop"));
  expect(calls).toHaveLength(8);
  expect(evs.at(-1)!.type).toBe("done");
  expect(evs.at(-2)!.text).toContain("Stopped");

  // Ollama model list from /api/tags beside /v1
  const tags = createServer((_, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ models: [{ name: "llama3.2" }] })));
  await new Promise<void>((ok) => tags.listen(8945, "127.0.0.1", ok));
  expect(JSON.parse((await req("/api/ai/models", { base: "http://127.0.0.1:8945/v1" }))[1])).toEqual({ models: ["llama3.2"] });
  await new Promise((ok) => tags.close(ok));

  // Origin / Host guard on every AI endpoint
  for (const [path, body] of [
    ["/api/ai", ask("hi")],
    ["/api/ai/config", { provider: "openai", key: "x" }],
    ["/api/ai/confirm", { id: "x", approve: true }],
    ["/api/ai/config", undefined],
  ] as const) {
    expect((await req(path, body, { Origin: "https://evil.example" }))[0], path).toBe(403);
    expect((await req(path, body, { Host: "evil.example:80" }))[0], path).toBe(403);
  }
  expect(JSON.parse((await req("/api/ai/config"))[1]).provider).toBe("anthropic"); // the forbidden write didn't land

  // the vault seals the key: locked → 423 and an error event, never the key
  expect((await req("/api/vault/setup", { passphrase: "correct horse" }))[0]).toBe(200);
  expect((await req("/api/vault/lock", {}))[0]).toBe(200);
  expect((await req("/api/ai/config"))[0]).toBe(423);
  [, evs] = await stream(ask("hi"));
  expect(evs.at(-1)).toMatchObject({ type: "error", error: "unlock OpenBooks in the app first" });
  expect((await req("/api/vault/unlock", { passphrase: "correct horse" }))[0]).toBe(200);
  expect(JSON.parse((await req("/api/ai/config"))[1]).keys.anthropic).toBe("sk-…6789");

  // the secret row is invisible to the books
  expect(((await state()).entities as J[]).map((x) => x.id)).not.toContain("_ai");
});

test("⌘K: /api/tools lists the registry, /api/tools/run runs one on the current business", async () => {
  const tools = JSON.parse((await req("/api/tools"))[1]).tools as J[];
  expect(tools).toHaveLength(16);
  expect(tools.find((t) => t.name === "bank_sync")).toMatchObject({
    kind: "write",
    palette: { label: { en: "Sync banks", he: "סנכרון בנקים" }, icon: "refresh" },
  });
  const [st, out] = await req("/api/tools/run", { name: "profit_and_loss", entity: "zz-il", args: {}, lang: "he" });
  expect(st).toBe(200);
  expect(JSON.parse(out).result.entity).toBe("zz-il");
  expect(JSON.parse((await req("/api/tools/run", { name: "bank_sync", entity: "acme" }))[1]).error).toContain("No connected bank");
  expect((await req("/api/tools/run", { name: "list_rules", entity: "ghost" }))[0]).toBe(404);
});
