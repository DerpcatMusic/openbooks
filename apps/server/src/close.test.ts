// The close date (books doc "books" = { closeDate }): /api/category, /api/rules, /api/doc (journal, reconciliations) and the MCP write
// tools refuse anything dated on or before it with HTTP 409 and a message that names the date. acme (testing.ts) has Mercury
// transactions on Jan 10, Jan 15, Feb 3, Feb 20 and Mar 1 2026; the close date below locks the first three.
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { http, type Running, startTs, testBooks } from "./testing.ts";

type J = Record<string, any>;
const CLOSE = "2026-02-15";
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
const state = async () => (await http(s.port, "GET", "/api/state?e=acme")).json() as J;
const idOn = async (date: string) => (await state()).txns.find((t: J) => t.date === date).id as string;
const setClose = (date: string | null) => post("/api/doc", { name: "books", value: date ? { closeDate: date } : null });
const doc = (name: string, value: unknown) => post("/api/doc", { name, value });
const je = (id: string, date: string, memo = "adjustment") => ({
  id,
  date,
  memo,
  lines: [
    { account: "expense:other", debit: 5, credit: 0 },
    { account: "equity:owner", debit: 0, credit: 5 },
  ],
});
const rec = (ym: string) => ({ "Mercury Checking ••0001": { [ym]: { ending: 100, cleared: [], done: false } } });

test("category: closed rows get a 409 naming the date, open rows still change", async () => {
  const jan = await idOn("2026-01-15"),
    mar = await idOn("2026-03-01");
  expect((await post("/api/category", { ids: [jan], category: "expense:software" })).status).toBe(200); // not closed yet
  expect((await setClose(CLOSE)).status).toBe(200);
  const r = await post("/api/category", { ids: [jan], category: "expense:meals" });
  expect(r.status).toBe(409);
  expect((r.json() as J).error).toContain(CLOSE);
  expect((await post("/api/category", { ids: [mar], category: "expense:meals" })).status).toBe(200);
  const st = await state();
  expect(st.txns.find((t: J) => t.id === jan).category).toBe("expense:software");
  expect(st.txns.find((t: J) => t.id === mar).category).toBe("expense:meals");
});

test("a rule that reaches closed rows is refused whole: nothing half-saved", async () => {
  const mar = await idOn("2026-03-01"),
    before = (await state()).rules;
  // "Cloud Host" also matches Feb 3, which is closed
  expect((await post("/api/category", { ids: [mar], category: "expense:hosting", rule: "Cloud Host" })).status).toBe(409);
  expect((await state()).rules).toEqual(before);
  // "Card Shop" only matches Mar 1
  expect((await post("/api/category", { ids: [mar], category: "expense:meals", rule: "Card Shop" })).status).toBe(200);
  expect((await state()).rules[0]).toEqual(["Card Shop", "expense:meals"]);
});

test("/api/rules: replacing rules that file closed rows is refused, a harmless change isn't", async () => {
  const rules = (await state()).rules as [string, string][];
  expect((await post("/api/rules", { rules: [] })).status).toBe(409); // Jan 10 would fall back to "ask"
  expect((await state()).rules).toEqual(rules);
  expect((await post("/api/rules", { rules: [...rules, ["Nothing Matches", "expense:other"]] })).status).toBe(200);
});

test("journal: closed entries can't be added, edited, moved or deleted; open ones can", async () => {
  expect((await doc("journal", [je("a", "2026-01-20")])).status).toBe(409);
  expect((await doc("journal", [je("b", "2026-03-05")])).status).toBe(200);
  expect((await doc("journal", [je("b", "2026-03-05", "edited")])).status).toBe(200);
  expect((await doc("journal", [je("b", "2026-02-01")])).status).toBe(409); // moved into the closed period
  // an entry that was already there before closing
  await setClose(null);
  expect((await doc("journal", [je("old", "2026-01-20"), je("b", "2026-03-05")])).status).toBe(200);
  await setClose(CLOSE);
  expect((await doc("journal", [je("old", "2026-01-20", "changed"), je("b", "2026-03-05")])).status).toBe(409);
  expect((await doc("journal", [je("b", "2026-03-05")])).status).toBe(409); // deleted
  expect((await doc("journal", [je("old", "2026-01-20"), je("b", "2026-03-05", "still open")])).status).toBe(200); // only the open one changed
});

test("reconciliations: a month the close date has reached is locked", async () => {
  expect((await doc("reconciliations", rec("2026-01"))).status).toBe(409);
  expect((await doc("reconciliations", rec("2026-02"))).status).toBe(409); // the close date falls inside February
  expect((await doc("reconciliations", rec("2026-03"))).status).toBe(200);
});

test("the MCP write tools refuse with the same message", async () => {
  const H = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const META = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const tool = async (name: string, args: J) => {
    const r = await http(
      s.port,
      "POST",
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: META } },
      {
        ...H,
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
      },
    );
    const t = r.body.toString();
    return JSON.parse(t.startsWith("event:") ? t.slice(t.indexOf("data:") + 5) : t).result as J;
  };
  const jan = await idOn("2026-01-10"),
    mar = await idOn("2026-03-01");
  let r = await tool("classify", { ids: [jan], category: "expense:software" });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain(CLOSE);
  r = await tool("classify", { ids: [mar], category: "expense:software" });
  expect(r.isError ?? false).toBe(false);
  r = await tool("add_journal_entry", {
    date: "2026-01-05",
    memo: "late",
    lines: [
      { account: "expense:other", debit: 5 },
      { account: "equity:owner", credit: 5 },
    ],
  });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain(CLOSE);
  r = await tool("add_journal_entry", {
    date: "2026-03-05",
    memo: "open",
    lines: [
      { account: "expense:other", debit: 5 },
      { account: "equity:owner", credit: 5 },
    ],
  });
  expect(r.isError ?? false).toBe(false);
  r = await tool("set_rules", { rules: [], confirm: true });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain(CLOSE);
});

test("moving the close date back reopens the period", async () => {
  const jan = await idOn("2026-01-15");
  expect((await post("/api/category", { ids: [jan], category: "expense:meals" })).status).toBe(409);
  expect((await setClose("2026-01-01")).status).toBe(200);
  expect((await post("/api/category", { ids: [jan], category: "expense:meals" })).status).toBe(200);
  expect((await setClose(null)).status).toBe(200); // cleared: no close date at all
  expect((await post("/api/category", { ids: [await idOn("2026-01-10")], category: "expense:meals" })).status).toBe(200);
});
