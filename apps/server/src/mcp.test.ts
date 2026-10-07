// Port of test_mcp.py against the TS server (`openbooks mcp` over stdio, /mcp over HTTP), a parity run of the same tool calls
// against the legacy mcp_server.py (structuredContent must match), and a real SDK Client round trip over both transports.
// Throwaway books in temp dirs; ports 8941-8949.
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { http, ROOT, type Running, startTs, testBooks } from "./testing.ts";

const MAIN = join(ROOT, "apps/server/src/main.ts");

// ---------- line-delimited JSON-RPC over a child's stdio ----------
type J = Record<string, any>;
const META = (caps: J = {}) => ({
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": caps,
});
class Rpc {
  p: ChildProcess;
  n = 0;
  q: J[] = [];
  waiters: ((m: J) => void)[] = [];
  constructor(cmd: string[], home: string) {
    this.p = spawn(cmd[0]!, cmd.slice(1), { cwd: ROOT, env: { ...process.env, OPENBOOKS_HOME: home }, stdio: ["pipe", "pipe", "ignore"] });
    createInterface(this.p.stdout!).on("line", (l) => {
      const m = JSON.parse(l) as J;
      const w = this.waiters.shift();
      if (w) w(m);
      else this.q.push(m);
    });
  }
  next = () => (this.q.length ? Promise.resolve(this.q.shift()!) : new Promise<J>((r) => this.waiters.push(r)));
  async rpc(method: string, params?: J, notify = false): Promise<J> {
    const msg = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
    if (notify) {
      this.p.stdin!.write(JSON.stringify(msg) + "\n");
      return {};
    }
    const id = ++this.n;
    this.p.stdin!.write(JSON.stringify({ ...msg, id }) + "\n");
    const r = await this.next();
    expect(r.id).toBe(id);
    return r;
  }
  /** modern tools/call → result */
  call = async (name: string, args: J, params: J = {}) => (await this.rpc("tools/call", { name, arguments: args, _meta: META(), ...params })).result as J;
  out: Record<string, J> = {};
  async tool(name: string, args: J = {}, ok = true): Promise<any> {
    const r = await this.call(name, args);
    expect(r.isError ?? false, `${name}: ${r.content?.[0]?.text}`).toBe(!ok);
    if (ok && this.out[name]) conforms(r.structuredContent, this.out[name], name);
    return r.structuredContent ?? r.content[0].text;
  }
  async close() {
    this.p.stdin!.end();
    return new Promise<number | null>((r) => (this.p.exitCode !== null ? r(this.p.exitCode) : this.p.on("exit", (c) => r(c))));
  }
}
/** test_mcp.conforms: the JSON Schema subset outputSchemas use ($ref into $defs too). */
function conforms(v: unknown, s: J, path: string, root: J = s) {
  if (s.$ref) s = root.$defs[s.$ref.split("/").pop()];
  if (s.anyOf) {
    const ok = s.anyOf.some((x: J) => {
      try {
        conforms(v, x, path, root);
        return true;
      } catch {
        return false;
      }
    });
    expect(ok, `${path}: ${JSON.stringify(v)}`).toBe(true);
    return;
  }
  const ts: string[] = typeof s.type === "string" ? [s.type] : (s.type ?? []);
  const is: Record<string, () => boolean> = {
    object: () => typeof v === "object" && v !== null && !Array.isArray(v),
    array: () => Array.isArray(v),
    string: () => typeof v === "string",
    null: () => v === null,
    boolean: () => typeof v === "boolean",
    integer: () => Number.isInteger(v),
    number: () => typeof v === "number",
  };
  expect(!ts.length || ts.some((t) => is[t]!()), `${path}: ${JSON.stringify(v)} is not ${ts.join("|")}`).toBe(true);
  if (is.object!()) {
    for (const k of s.required ?? []) expect(k in (v as J), `${path}.${k} missing`).toBe(true);
    for (const [k, x] of Object.entries(v as J))
      if (s.properties?.[k]) conforms(x, s.properties[k], `${path}.${k}`, root);
      else if (typeof s.additionalProperties === "object") conforms(x, s.additionalProperties, `${path}.${k}`, root);
  }
  if (Array.isArray(v)) v.forEach((x, i) => conforms(x, s.items ?? {}, `${path}[${i}]`, root));
}

// ---------- test_mcp.main() over stdio ----------
describe("openbooks mcp (stdio)", () => {
  let home: string, clean: () => void;
  beforeAll(() => {
    [home, clean] = testBooks();
  });
  afterAll(() => clean());

  test("legacy handshake", async () => {
    const s = new Rpc(["bun", MAIN, "mcp"], home);
    const r = (await s.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } })).result;
    expect(r.protocolVersion).toBe("2025-06-18");
    expect(Object.keys(r.capabilities)).toEqual(expect.arrayContaining(["tools", "resources", "prompts"]));
    expect(r.serverInfo.name).toBe("openbooks");
    await s.rpc("notifications/initialized", undefined, true); // no answer: the next reply must be the ping's
    expect((await s.rpc("ping")).result).toBeDefined();
    // a legacy client never gets elicitation: big writes need confirm: true
    const t = (await s.rpc("tools/call", { name: "set_rules", arguments: { rules: [] } })).result;
    expect(t.isError && t.content[0].text).toContain("confirm: true");
    expect(await s.close()).toBe(0);
  });

  test("tools, confirmation, resources, prompts (2026-07-28)", { timeout: 60_000 }, async () => {
    const s = new Rpc(["bun", MAIN, "mcp"], home);
    const modern = { _meta: META() };
    const d = (await s.rpc("server/discover", modern)).result;
    expect(d.supportedVersions).toEqual(["2026-07-28"]);
    expect(d.capabilities.extensions).toHaveProperty(["io.modelcontextprotocol/ui"]);
    const e = (await s.rpc("tools/list", { _meta: { ...META(), "io.modelcontextprotocol/protocolVersion": "1900-01-01" } })).error;
    expect(e.code).toBe(-32022);
    expect(e.data.requested).toBe("1900-01-01");
    expect((await s.rpc("tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } })).error.code).toBe(-32602);
    expect((await s.rpc("nope", modern)).error.code).toBe(-32601);

    const tools = Object.fromEntries(((await s.rpc("tools/list", modern)).result.tools as J[]).map((t) => [t.name, t]));
    expect(Object.keys(tools)).toHaveLength(16);
    expect(Object.keys(tools).filter((n) => /secret|token|credential|connect/.test(n))).toEqual([]);
    s.out = Object.fromEntries((Object.entries(tools) as [string, J][]).map(([n, t]) => [n, t.outputSchema]));
    for (const [n, t] of Object.entries(tools) as [string, J][]) {
      const an = t.annotations;
      expect(Object.keys(an).sort(), n).toEqual(["destructiveHint", "idempotentHint", "openWorldHint", "readOnlyHint", "title"]);
      expect(t.description.startsWith("WRITES"), n).toBe(!an.readOnlyHint);
      expect(an.openWorldHint, n).toBe(n === "bank_sync");
      expect(t.inputSchema.properties, n).toHaveProperty("entity");
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(t.outputSchema.type, n).toBe("object");
    }
    expect(tools.set_rules.annotations.destructiveHint).toBe(true);
    expect(tools.add_journal_entry.annotations.destructiveHint).toBe(false);
    expect(tools.profit_and_loss._meta.ui.resourceUri).toBe("ui://openbooks/pnl");

    expect((await s.tool("list_entities")).entities.map((x: J) => x.id)).toEqual(["acme", "zz-il"]);
    const tx = await s.tool("list_transactions", { uncategorized: true });
    expect(tx.total).toBe(3);
    expect(tx.transactions[0].date).toBe("2026-03-01"); // default entity = first; newest first
    expect((await s.tool("list_transactions", { category: "revenue" })).sum).toBe(1000);
    expect((await s.tool("list_transactions", { search: "cloud", limit: 1 })).total).toBe(2);
    await s.tool("list_transactions", { limit: 501 }, false);
    await s.tool("list_transactions", { bogus: 1 }, false);
    await s.tool("list_transactions", { entity: "ghost" }, false);

    const p = (await s.tool("profit_and_loss", { from: "2026-01", to: "2026-12" })).total;
    expect(p).toEqual({ revenue: 1000, cogs: 0, gross: 1000, opex: 0, operating: 1000, other: 0, uncategorized: -100, net: 900 });

    const host = (tx.transactions as J[]).filter((t) => t.desc === "Cloud Host").sort((a, b) => a.date.localeCompare(b.date));
    await s.tool("classify", { ids: [host[0]!.id], category: "Software" }, false);
    await s.tool("classify", { ids: ["missing"], category: "expense:software" }, false);
    let r = await s.tool("classify", { ids: [host[0]!.id], category: "expense:software" });
    expect(r.transactions[0]).toMatchObject({ category: "expense:software", why: "manual" });
    const g = await s.tool("get_transaction", { id: host[1]!.id });
    expect(g.transaction).toMatchObject({ amount: -50, file: "mercury-test.json" });
    expect(g.attachments).toEqual([]);
    expect((await s.tool("suggest_category", { id: host[1]!.id })).suggestions[0].account).toBe("expense:software");
    r = await s.tool("classify", { ids: [tx.transactions[0].id], category: "expense:equipment", rule: "Card Shop" });
    expect(r.ruleMatches).toBe(1);
    expect((await s.tool("list_rules")).rules[0]).toEqual(["Card Shop", "expense:equipment"]);
    await s.tool("set_rules", { rules: [["x", "nonsense"]] }, false);

    // confirmation before big writes: confirm: true without elicitation, input requests with it
    const rules = (await s.tool("list_rules")).rules;
    expect(await s.tool("set_rules", { rules }, false)).toContain("confirm: true");
    expect((await s.tool("set_rules", { rules, confirm: true })).rules).toEqual(rules);
    const many = Array(21).fill(host[1]!.id);
    expect((await s.call("classify", { ids: many, category: "expense:software" })).isError).toBe(true); // no elicitation capability
    const el = { _meta: META({ elicitation: {} }) };
    const ask = await s.call("classify", { ids: many, category: "ask", confirm: true }, el); // "ask" leaves the books as they were
    expect(ask.resultType).toBe("input_required"); // confirm: true can't skip asking a client that can be asked
    expect(ask.inputRequests.confirm.method).toBe("elicitation/create");
    expect(ask.inputRequests.confirm.params.requestedSchema.properties.confirm.type).toBe("boolean");
    const yes = { confirm: { action: "accept", content: { confirm: true } } };
    r = await s.call("classify", { ids: many, category: "ask" }, { ...el, inputResponses: yes, requestState: ask.requestState });
    expect(r.isError ?? false).toBe(false);
    expect(r.structuredContent.transactions[0].why).toBe("manual");
    r = await s.call("classify", { ids: many, category: "expense:meals" }, { ...el, inputResponses: yes, requestState: ask.requestState });
    expect(r.isError && r.content[0].text).toContain("other arguments"); // a yes for one change doesn't cover another
    const form = { _meta: META({ elicitation: { form: {} } }) };
    r = await s.call("set_rules", { rules: [] }, form);
    r = await s.call("set_rules", { rules: [] }, { ...form, inputResponses: { confirm: { action: "decline" } }, requestState: r.requestState });
    expect(r.isError).toBe(true);
    expect((await s.tool("list_rules")).rules).toEqual(rules);
    expect((await s.call("set_rules", { rules: [] }, { _meta: META({ elicitation: { url: {} } }) })).isError).toBe(true); // url-only can't show a form

    const unbalanced = [
      { account: "expense:software", debit: 10 },
      { account: "equity:owner", credit: 9 },
    ];
    await s.tool("add_journal_entry", { date: "2026-05-01", memo: "unbalanced", lines: unbalanced }, false);
    const je = await s.tool("add_journal_entry", {
      date: "2026-05-01",
      memo: "Paid personally",
      lines: [
        { account: "expense:software", debit: 10 },
        { account: "equity:owner", credit: 10 },
      ],
    });
    expect(je.entry.id).toMatch(/^je/);
    const pm = await s.tool("profit_and_loss", { from: "2026-01", to: "2026-12", group_by: "month" });
    expect(pm.total).toMatchObject({ opex: 60, uncategorized: -50 });
    expect(pm.months.map((m: J) => m.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-05"]);

    const b = await s.tool("balances", { date: "2026-12-31" });
    expect(b.balances).toEqual({ "Mercury Checking ••0001": 1430, "Mercury Credit": -30 });
    expect(b.cash).toBe(1430);
    expect((await s.tool("chart_of_accounts")).accounts).toContainEqual({
      account: "expense:software",
      label: "Software and Subscriptions",
      type: "expense",
      pl: "expense",
      transactions: 2,
    });

    const inv = (await s.tool("create_invoice", { customer: "New Customer", items: [{ desc: "Consulting", qty: 2, price: 150 }], issued: "2026-06-01" }))
      .invoice;
    expect(inv).toMatchObject({ status: "draft", number: null, kind: "invoice", due: "2026-07-01", total: 300 });
    const ls = (await s.tool("list_invoices")).invoices;
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ customerName: "New Customer", state: "draft" });

    const us = await s.tool("tax_summary", { year: 2026 });
    expect(us.ownerContributions).toEqual({ count: 2, total: 510 }); // 500 wire + 10 journal
    expect(us.obligations[0].due).toBe("2027-04-15");
    const il = await s.tool("tax_summary", { entity: "zz-il", year: 2026 });
    expect(il).toMatchObject({ turnover: 10000, taxable: 7000, grossTax: 700, credits: 700, due: 0 });

    expect((await s.tool("bank_status")).connections).toEqual([]);
    expect(await s.tool("bank_sync", {}, false)).toContain("No connected bank");
    expect(await s.tool("bank_sync", { provider: "hapoalim:2" }, false)).toContain("No connected bank");
    expect(await s.tool("bank_sync", { provider: "no such bank" }, false)).toContain("provider"); // Python: "bad format"; Effect names the pattern

    // resources
    const res = ((await s.rpc("resources/list", modern)).result.resources as J[]).map((x) => x.uri);
    expect(res).toEqual(
      expect.arrayContaining([
        "openbooks://entities",
        "openbooks://acme/summary",
        "openbooks://zz-il/statements",
        "openbooks://acme/rules",
        "ui://openbooks/pnl",
      ]),
    );
    const tpl = ((await s.rpc("resources/templates/list", modern)).result.resourceTemplates as J[]).map((x) => x.uriTemplate);
    expect(tpl).toEqual(["openbooks://{entity}/summary", "openbooks://{entity}/statements", "openbooks://{entity}/rules"]);
    const read = async (uri: string) => JSON.parse((await s.rpc("resources/read", { ...modern, uri })).result.contents[0].text);
    expect((await read("openbooks://entities")).entities.map((x: J) => x.id)).toEqual(["acme", "zz-il"]);
    const sm = await read("openbooks://acme/summary");
    expect(sm.uncategorized).toBe(1);
    expect(sm.profitAndLoss).toHaveProperty("net");
    expect(sm.balances).toHaveProperty(["Mercury Credit"]);
    const stm = (await read("openbooks://acme/statements")).statements;
    expect(stm[0]).toMatchObject({ file: "mercury-test.json", readable: true });
    expect(stm[0].checks.map((c: J) => c.difference)).toEqual([0, 0]);
    expect((await read("openbooks://zz-il/rules")).rules).toEqual([["Client Ltd", "business:client"]]);
    expect((await s.rpc("resources/read", { ...modern, uri: "openbooks://ghost/rules" })).error.code).toBe(-32602);
    const ui = (await s.rpc("resources/read", { ...modern, uri: "ui://openbooks/pnl" })).result.contents[0];
    expect(ui.mimeType).toBe("text/html;profile=mcp-app");
    expect(ui.text).toContain("ui/notifications/tool-result");
    expect(ui.text).not.toMatch(/(src|href)\s*=|https?:\/\/|fetch\(/); // the view must not touch the network

    // prompts
    const ps = Object.fromEntries(((await s.rpc("prompts/list", modern)).result.prompts as J[]).map((x) => [x.name, x]));
    expect(Object.keys(ps).sort()).toEqual(["explain-pl", "monthly-close", "review-uncategorized", "tax-prep"]);
    expect((ps["tax-prep"]!.arguments as J[]).filter((a) => a.required).map((a) => a.name)).toEqual(["year"]);
    const text = async (name: string, a: J) => (await s.rpc("prompts/get", { ...modern, name, arguments: a })).result.messages[0].content.text as string;
    expect(await text("tax-prep", { year: "2025" })).toContain("5472");
    expect(await text("tax-prep", { year: "2025", entity: "zz-il" })).toContain("1301");
    expect(await text("monthly-close", { month: "2026-02" })).toContain("2026-01");
    expect(await text("monthly-close", { month: "2026-02" })).toContain("openbooks://acme/statements");
    expect(await text("explain-pl", { from: "2026-01", to: "2026-03" })).toContain("from=2026-01 to=2026-03");
    expect(await text("review-uncategorized", {})).toContain("suggest_category");
    expect((await s.rpc("prompts/get", { ...modern, name: "tax-prep", arguments: {} })).error.code).toBe(-32602);
    expect((await s.rpc("prompts/get", { ...modern, name: "tax-prep", arguments: { year: "20x5" } })).error.code).toBe(-32602);
    expect(await s.close()).toBe(0);
  });
});

// ---------- test_mcp.http_checks() against /mcp ----------
describe("/mcp (Streamable HTTP)", () => {
  let home: string, clean: () => void, srv: Running;
  const port = 8942;
  beforeAll(async () => {
    [home, clean] = testBooks();
    srv = await startTs(home, { OPENBOOKS_PORT: String(port) });
  });
  afterAll(() => {
    srv.stop();
    clean();
  });
  const H = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const post = async (body: unknown, headers: Record<string, string> = {}, method = "POST") => {
    const r = await http(port, method, "/mcp", body, { ...H, ...headers });
    const t = r.body.toString();
    return [r.status, t ? (JSON.parse(t.startsWith("event:") ? t.slice(t.indexOf("data:") + 5) : t) as J) : null] as const;
  };
  const modern = (id: number, method: string, params: J = {}, name?: string, headers: Record<string, string> = {}) =>
    post(
      { jsonrpc: "2.0", id, method, params: { ...params, _meta: META() } },
      { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method, ...(name ? { "Mcp-Name": name } : {}), ...headers },
    );

  test("the same answers and guards as books.py's /mcp", async () => {
    let [code, r] = await modern(1, "server/discover");
    expect(code).toBe(200);
    expect(r!.result.supportedVersions).toEqual(["2026-07-28"]);
    [code, r] = await modern(2, "tools/call", { name: "list_entities", arguments: {} }, "list_entities");
    expect(code).toBe(200);
    expect(r!.result.structuredContent.entities.map((x: J) => x.id)).toEqual(["acme", "zz-il"]);
    const b64 = `=?base64?${Buffer.from("openbooks://acme/rules").toString("base64")}?=`; // Mcp-Name in the base64 sentinel form
    [code, r] = await modern(3, "resources/read", { uri: "openbooks://acme/rules" }, b64);
    expect(code).toBe(200);
    expect(r!.result.contents[0].text).toContain("Owner Transfer");
    [code, r] = await modern(4, "tools/call", { name: "list_entities", arguments: {} }, "balances");
    expect([code, r!.error.code]).toEqual([400, -32020]);
    [code, r] = await post({ jsonrpc: "2.0", id: 5, method: "tools/list", params: { _meta: META() } }, { "MCP-Protocol-Version": "2026-07-28" });
    expect([code, r!.error.code]).toEqual([400, -32020]); // Mcp-Method missing
    expect((await modern(6, "nope/nope"))[0]).toBe(404);
    [code, r] = await modern(7, "tools/list", {}, undefined, { Origin: `http://localhost:${port}` });
    expect(code).toBe(200);
    expect(r!.result.tools).toHaveLength(16);
    [code, r] = await modern(8, "tools/list", {}, undefined, { Origin: "http://evil.example" });
    expect([code, r!.error.code]).toEqual([403, -32600]);
    expect((await modern(9, "tools/list", {}, undefined, { Host: `evil.example:${port}` }))[0]).toBe(403); // DNS rebinding
    // legacy (2025-xx) client: initialize, notification, version header, no session ids
    [code, r] = await post({
      jsonrpc: "2.0",
      id: 10,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    expect(code).toBe(200);
    expect(r!.result.protocolVersion).toBe("2025-11-25");
    expect(await post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "MCP-Protocol-Version": "2025-11-25" })).toEqual([202, null]);
    [code, r] = await post(
      { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "set_rules", arguments: { rules: [] } } },
      { "MCP-Protocol-Version": "2025-11-25" },
    );
    expect(code).toBe(200);
    expect(r!.result.isError && r!.result.content[0].text).toContain("confirm: true");
    expect((await post({ jsonrpc: "2.0", id: 12, method: "ping" }, { "MCP-Protocol-Version": "1999-01-01" }))[0]).toBe(400);
    expect((await post(undefined, {}, "GET"))[0]).toBe(405);
    expect((await post(undefined, {}, "DELETE"))[0]).toBe(405);
  });

  test("SDK Client round trip over HTTP: modern elicitation, legacy confirm", async () => {
    for (const pin of [true, false]) {
      let asked = 0;
      const c = new Client(
        { name: "t", version: "1" },
        { capabilities: { elicitation: { form: {} } }, ...(pin ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {}) },
      );
      c.setRequestHandler("elicitation/create", async () => {
        asked++;
        return { action: "accept", content: { confirm: true } };
      });
      await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      expect((await c.listTools()).tools).toHaveLength(16);
      const lt = (await c.callTool({ name: "list_transactions", arguments: { entity: "acme" } })).structuredContent as J;
      const id = (lt.transactions as J[]).find((t) => !t.id.startsWith("je"))!.id;
      const args = { entity: "acme", ids: Array(21).fill(id), category: "ask" };
      const r = await c.callTool({ name: "classify", arguments: args });
      expect([r.isError ?? false, asked]).toEqual(pin ? [false, 1] : [true, 0]);
      if (!pin) expect((await c.callTool({ name: "classify", arguments: { ...args, confirm: true } })).isError ?? false).toBe(false);
      expect((await c.readResource({ uri: "ui://openbooks/pnl" })).contents[0]!.mimeType).toBe("text/html;profile=mcp-app");
      await c.close();
    }
  });
});

test("SDK Client round trip over stdio (openbooks mcp)", { timeout: 30_000 }, async () => {
  const [home, clean] = testBooks();
  try {
    const c = new Client({ name: "t", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    await c.connect(
      new StdioClientTransport({
        command: "bun",
        args: [MAIN, "mcp"],
        env: { ...process.env, OPENBOOKS_HOME: home } as Record<string, string>,
        stderr: "ignore",
      }),
    );
    expect(c.getServerVersion()?.name).toBe("openbooks");
    const p = (await c.callTool({ name: "profit_and_loss", arguments: { from: "2026-01", to: "2026-12" } })).structuredContent as J;
    expect(p.total.revenue).toBe(1000);
    expect((await c.listPrompts()).prompts).toHaveLength(4);
    expect((await c.getPrompt({ name: "tax-prep", arguments: { year: "2025" } })).messages[0]!.content).toMatchObject({ type: "text" });
    await c.close();
  } finally {
    clean();
  }
});
