// Split transactions, review marks, the chart, journal checks and books dates through the HTTP API: validation answers 400, the close
// date answers 409, and everything the ledger shows follows (acme from testing.ts: five Mercury transactions, Jan 10 to Mar 1 2026).
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
const state = async () => (await http(s.port, "GET", "/api/state?e=acme")).json() as J;
const doc = (name: string, value: unknown) => post("/api/doc", { name, value });
const rowsOf = async (id: string) => ((await state()).txns as J[]).filter((t) => t.id === id || t.id.startsWith(`${id}~`));
const idOn = async (date: string) => ((await state()).txns as J[]).find((t) => t.date === date)?.id?.split("~")[0] as string;
const tool = (name: string, args: J) => post("/api/tools/run", { name, args, entity: "acme" });
const L = (account: string, amount: number, extra: J = {}) => ({ account, amount, ...extra });

test("a split becomes one ledger row per line; the lines add up to the transaction to the cent", async () => {
  const id = await idOn("2026-02-03"); // Cloud Host -50
  const before = await rowsOf(id);
  expect(before).toHaveLength(1);
  expect((await doc("splits", { [id]: [L("expense:software", -33.34), L("expense:hosting", -16.66)] })).status).toBe(200);
  const rows = await rowsOf(id);
  expect(rows.map((r) => [r.id, r.amount, r.category, r.why])).toEqual([
    [`${id}~0`, -33.34, "expense:software", "split"],
    [`${id}~1`, -16.66, "expense:hosting", "split"],
  ]);
  const st = await state();
  expect(st.docs.splits[id]).toHaveLength(2); // the doc comes back to the screens
  expect(Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100)).toBe(-5000);
});

test("lines that don't add up, a single line, an unknown transaction or an unusable account are refused with 400", async () => {
  const id = await idOn("2026-02-03");
  for (const bad of [[L("expense:software", -33.34), L("expense:hosting", -16.65)], [L("expense:software", -50)], [L("expense:software", -50), L("ask", 0)], [L("expense:software", -25), L("ask", -25)]]) {
    const r = await doc("splits", { [id]: bad });
    expect(r.status).toBe(400);
    expect((r.json() as J).error).toContain(id);
  }
  expect((await doc("splits", { nope: [L("expense:a", -1), L("expense:b", -1)] })).status).toBe(400);
  expect(await rowsOf(id)).toHaveLength(2); // the earlier split is as it was
});

test("an archived account takes no new split line", async () => {
  const id = await idOn("2026-03-01");
  expect((await doc("coa", { "expense:old": { archived: true } })).status).toBe(200);
  expect((await doc("splits", { [id]: [L("expense:old", -10), L("expense:meals", -20)] })).status).toBe(400);
  const cur = { ...(await state()).docs.splits, [id]: [L("expense:meals", -10), L("expense:other", -20)] };
  expect((await doc("splits", cur)).status).toBe(200);
  const { [id]: _gone, ...rest } = cur;
  expect((await doc("splits", rest)).status).toBe(200); // unsplit
  expect(await rowsOf(id)).toHaveLength(1);
});

test("close date: splitting, re-splitting or unsplitting a closed transaction is refused whole; an open one is fine", async () => {
  const jan = await idOn("2026-01-15"),
    mar = await idOn("2026-03-01");
  expect((await doc("books", { closeDate: "2026-02-15" })).status).toBe(200);
  const r = await doc("splits", { ...(await state()).docs.splits, [jan]: [L("expense:software", -10), L("expense:hosting", -10)] });
  expect(r.status).toBe(409);
  expect((r.json() as J).error).toContain("2026-02-15");
  expect(await rowsOf(jan)).toHaveLength(1);
  expect((await doc("splits", { ...(await state()).docs.splits, [mar]: [L("expense:meals", -10), L("expense:other", -20)] })).status).toBe(200);
  // a split that was made before the close date can't be removed or changed afterwards
  const feb = await idOn("2026-02-03");
  expect((await doc("splits", {})).status).toBe(409); // would unsplit Feb 3 (closed through Feb 15)
  expect(await rowsOf(feb)).toHaveLength(2);
  expect((await doc("splits", { ...(await state()).docs.splits, [mar]: [L("expense:meals", -5), L("expense:other", -25)] })).status).toBe(200);
});

test("the MCP-style split_transaction tool: validates, splits, replaces and unsplits; closed rows are refused", async () => {
  await doc("books", null);
  const id = await idOn("2026-01-15"); // Cloud Host -20
  let r = await tool("split_transaction", { id, lines: [L("expense:software", 12.5), L("expense:hosting", 7)] });
  expect(r.status).toBe(400);
  expect((r.json() as J).error).toContain("0.5");
  r = await tool("split_transaction", { id, lines: [L("expense:software", 12.5), L("expense:hosting", 7.5, { memo: "dns" })] });
  expect(r.status).toBe(200);
  const out = (r.json() as J).result;
  expect(out).toMatchObject({ id, split: true, amount: -20 });
  expect(out.transactions.map((t: J) => [t.id, t.amount, t.category])).toEqual([[`${id}~0`, -12.5, "expense:software"], [`${id}~1`, -7.5, "expense:hosting"]]);
  // a split line's `~` id means its transaction
  r = await tool("split_transaction", { id: `${id}~1`, lines: [L("expense:software", 5), L("expense:hosting", 15)] }); // replaces the earlier split
  expect((r.json() as J).result.transactions.map((t: J) => t.amount)).toEqual([-5, -15]);
  // classify refuses a split line
  r = await tool("classify", { ids: [`${id}~0`], category: "expense:meals" });
  expect(r.status).toBe(400);
  expect((r.json() as J).error).toContain("split_transaction");
  r = await tool("split_transaction", { id, lines: [] });
  expect((r.json() as J).result).toMatchObject({ split: false });
  expect(await rowsOf(id)).toHaveLength(1);
  await doc("books", { closeDate: "2026-02-15" });
  r = await tool("split_transaction", { id, lines: [L("expense:software", 5), L("expense:hosting", 15)] });
  expect(r.status).toBe(400); // the tool reports the close date as its own error
  expect((r.json() as J).error).toContain("2026-02-15");
  await doc("books", null);
});

test("review marks: any open transaction, but a closed one's mark can't change", async () => {
  const jan = await idOn("2026-01-15"),
    mar = await idOn("2026-03-01");
  expect((await doc("reviewed", { [jan]: true })).status).toBe(200);
  expect((await doc("books", { closeDate: "2026-02-15" })).status).toBe(200);
  expect((await doc("reviewed", { [jan]: true, [mar]: true })).status).toBe(200); // an open one
  expect((await doc("reviewed", { [mar]: true })).status).toBe(409); // un-reviewing the closed Jan 15
  expect((await doc("reviewed", { [jan]: true, [mar]: true, [await idOn("2026-01-10")]: true })).status).toBe(409);
  await doc("books", null);
});

test("books dates: no future close date, close not before start, start only earlier; an entries start date leaves earlier rows out", async () => {
  expect((await doc("books", { closeDate: "2999-01-01" })).status).toBe(400);
  expect((await doc("books", { closeDate: "not a date" })).status).toBe(400);
  expect((await doc("books", { startDate: "2026-02-01", closeDate: "2026-01-31" })).status).toBe(400);
  expect((await doc("books", { startDate: "2026-02-01" })).status).toBe(200);
  const st = await state();
  expect((st.txns as J[]).every((t) => t.date >= "2026-02-01")).toBe(true);
  expect(new Set((st.txns as J[]).map((t) => t.id.split("~")[0])).size).toBe(3); // Feb 3, Feb 20, Mar 1
  expect((await doc("books", { startDate: "2026-02-02" })).status).toBe(400); // later: refused
  expect((await doc("books", { startDate: "2026-01-01" })).status).toBe(200); // earlier
  expect(new Set(((await state()).txns as J[]).map((t) => t.id.split("~")[0])).size).toBe(5);
  expect((await doc("books", { startDate: "2026-01-01", closeDate: "2026-02-15" })).status).toBe(200);
  expect((await doc("books", { startDate: "2026-03-01", closeDate: "2026-02-15" })).status).toBe(400);
  await doc("books", { startDate: "2026-01-01", closeDate: "2026-02-15" });
  // the start date changes which rows exist; with books closed through Feb 15 it can't drop closed ones
  expect((await doc("books", { startDate: null, closeDate: "2026-02-15" })).status).toBe(200); // clearing it = moving to the beginning; nothing earlier exists, so nothing is added
  await doc("books", null);
});

test("journal entries: must balance in cents, have a debit and a credit, use no archived account and not predate the start date", async () => {
  const je = (id: string, lines: J[], date = "2026-03-05") => ({ id, date, memo: "adj", lines });
  const ok = [{ account: "expense:other", debit: 5, credit: 0 }, { account: "equity:owner", debit: 0, credit: 5 }];
  const bad = async (entry: J) => {
    const r = await doc("journal", [entry]);
    expect(r.status).toBe(400);
    return (r.json() as J).error as string;
  };
  expect(await bad(je("u", [{ account: "expense:other", debit: 5.01 }, { account: "equity:owner", credit: 5 }]))).toContain("debits that do not equal credits");
  expect(await bad(je("d", [{ account: "expense:other", debit: 5 }, { account: "expense:meals", debit: 5 }]))).toContain("credit");
  expect(await bad(je("a", [{ account: "expense:old", debit: 5 }, { account: "equity:owner", credit: 5 }]))).toContain("archived");
  expect((await doc("journal", [je("good", ok)])).status).toBe(200);
  await doc("books", { startDate: "2026-03-01" });
  expect(await bad(je("early", ok, "2026-02-01"))).toContain("before the books' entries start date");
  expect((await doc("journal", [je("good", ok), je("later", ok, "2026-03-09")])).status).toBe(200);
  await doc("books", null);
  await doc("journal", null);
});

test("archiving the account a rule files into skips that rule; unarchiving brings the rows back; the close date protects closed rows", async () => {
  const jan = await idOn("2026-01-10"); // Example Customer -> revenue:services by rule
  expect(((await state()).txns as J[]).find((t) => t.id === jan)?.category).toBe("revenue:services");
  await doc("books", { closeDate: "2026-02-15" });
  expect((await doc("coa", { "revenue:services": { archived: true } })).status).toBe(409); // Jan 10 would fall back to ask
  await doc("books", null);
  expect((await doc("coa", { "revenue:services": { archived: true } })).status).toBe(200);
  expect(((await state()).txns as J[]).find((t) => t.id === jan)).toMatchObject({ category: "ask", why: "" });
  expect((await doc("coa", {})).status).toBe(200);
  expect(((await state()).txns as J[]).find((t) => t.id === jan)?.category).toBe("revenue:services");
});
