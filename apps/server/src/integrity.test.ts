// Issued documents over HTTP: /api/doc numbers them on the server and refuses to edit, delete, renumber or backdate them; /api/print
// counts prints (original, then copies); /api/audit reads the history the writes left, with their actor (MCP calls are "mcp").
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { http, type Running, startTs, testBooks } from "./testing.ts";

type J = Record<string, any>;
let s: Running, clean: () => void;
beforeAll(async () => {
  let home: string;
  [home, clean] = testBooks();
  s = await startTs(home);
}, 30_000);
afterAll(() => {
  s?.stop();
  clean?.();
});

const post = (path: string, body: unknown) => http(s.port, "POST", `${path}?e=acme`, body);
const invoices = async () => ((await http(s.port, "GET", "/api/state?e=acme")).json() as J).docs.invoices as J[];
const save = (value: unknown) => post("/api/doc", { name: "invoices", value });
const inv = (id: string, o: J = {}) => ({
  id,
  kind: "invoice",
  number: null,
  customer: null,
  items: [{ desc: "x", qty: 1, price: 10 }],
  issued: "2026-03-10",
  status: "draft",
  ...o,
});

test("/api/doc: the server numbers issued documents and refuses edit, delete, renumber and backdate", async () => {
  expect((await save([inv("a"), inv("b")])).status).toBe(200);
  expect((await save([inv("a", { status: "open", number: "INV-0777" }), inv("b")])).status).toBe(200);
  let docs = await invoices();
  expect(docs.map((d) => d.number)).toEqual(["INV-0001", null]);
  const a = docs[0]!;
  for (const bad of [[{ ...a, items: [] }, docs[1]], [{ ...a, number: "INV-0002" }, docs[1]], [{ ...a, status: "draft" }, docs[1]], [docs[1]], null]) {
    const r = await save(bad);
    expect(r.status, JSON.stringify(bad)).toBe(400);
    expect((r.json() as J).error).toContain("INV-0001");
  }
  const back = await save([a, { ...docs[1], status: "open", issued: "2026-03-09" }]);
  expect(back.status).toBe(400);
  expect((back.json() as J).error).toContain("2026-03-10");
  // payment moves stay allowed
  expect((await save([{ ...a, status: "paid", paidDate: "2026-03-12" }, docs[1]])).status).toBe(200);
  docs = await invoices();
  expect(docs[0]).toMatchObject({ number: "INV-0001", status: "paid" });
});

test("/api/print: 1 for the original, then copies; a credit cancels the original", async () => {
  const p = async (id: string) => (await post("/api/print", { id })).json() as J;
  expect(await p("b")).toEqual({ prints: 0 }); // a draft isn't counted
  expect(await p("a")).toEqual({ prints: 1 });
  expect(await p("a")).toEqual({ prints: 2 });
  expect((await post("/api/print", { id: "nope" })).status).toBe(400);
  const docs = await invoices();
  expect((await save([...docs, { id: "cr", kind: "credit", status: "open", cancels: "a", issued: "2026-03-12", items: [] }])).status).toBe(200);
  const after = await invoices();
  expect(after.find((d) => d.id === "a")).toMatchObject({ status: "cancelled", cancelledBy: "cr", prints: 2 });
  expect(after.find((d) => d.id === "cr")).toMatchObject({ number: "CN-0001", ref: "INV-0001", items: [{ price: -10 }] });
});

test("/api/audit: the writes above, newest first, filterable; MCP writes are the mcp actor", async () => {
  const META = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const args = { entity: "acme", customer: "Zed", items: [{ desc: "y", price: 5 }] };
  const r = await http(
    s.port,
    "POST",
    "/mcp",
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_invoice", arguments: args, _meta: META } },
    {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "create_invoice",
    },
  );
  expect(r.status).toBe(200);
  const all = ((await http(s.port, "GET", "/api/audit?e=acme")).json() as J).entries as J[];
  expect(all[0]).toMatchObject({ actor: "mcp", kind: "doc", target: "invoices" });
  expect(all.some((x) => x.kind === "print" && x.target === "invoices/INV-0001")).toBe(true);
  const prints = ((await http(s.port, "GET", "/api/audit?e=acme&kind=print")).json() as J).entries as J[];
  expect(prints.map((x) => x.after)).toEqual([{ prints: 2 }, { prints: 1 }]);
  expect((await http(s.port, "GET", "/api/audit?e=acme&from=nope")).status).toBe(400);
});
