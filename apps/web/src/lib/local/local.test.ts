import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vite-plus/test";
import { route } from "./routes.ts";
import { Local } from "./store.ts";

const DUMP = JSON.stringify({
  accounts: [{ id: "a1", name: "Checking", currentBalance: 1250.25 }],
  transactions: [
    {
      id: "t1",
      amount: 1000,
      kind: "externalTransfer",
      accountId: "a1",
      createdAt: "2025-01-02T00:00:00Z",
      postedAt: "2025-01-03T09:00:00Z",
      status: "sent",
      counterpartyName: "Client",
      bankDescription: "WIRE IN",
    },
    { id: "t2", amount: 250.25, kind: "other", accountId: "a1", createdAt: "2025-01-31T00:00:00Z", counterpartyName: null, bankDescription: "Interest" },
  ],
});
const PDF = new Uint8Array([37, 80, 68, 70]); // "%PDF": stored as is, never parsed
const fresh = () => Local.open(`t${Math.random()}`, new IDBFactory());
const call = async (db: Local, method: string, path: string, body?: unknown) => {
  const r = await route(db, method, new URL(path, "http://x"), body === undefined || body instanceof Blob ? (body as Blob | undefined) : JSON.stringify(body));
  return { status: r.status, body: r.headers.get("Content-Type")?.includes("json") ? await r.json() : await r.arrayBuffer() } as { status: number; body: any };
};
const setup = async () => {
  const db = await fresh();
  expect((await call(db, "GET", "/api/state")).body).toEqual({ entities: [], setup: true });
  const made = await call(db, "POST", "/api/entity", { id: "acme", name: "Acme LLC", short: "Acme", kind: "us-llc", currency: "USD", flag: "🇺🇸" });
  expect(made.status).toBe(200);
  return db;
};

test("first run is empty, then an entity persists across a reopen of the database", async () => {
  const idb = new IDBFactory();
  const db = await Local.open("p", idb);
  await call(db, "POST", "/api/entity", { id: "acme", name: "Acme LLC", kind: "us-llc", currency: "USD" });
  await call(db, "POST", "/api/person", { residence: "us", facts: { llc: true } });
  const again = await Local.open("p", idb);
  expect((await call(again, "GET", "/api/state")).body.entity).toMatchObject({ id: "acme", name: "Acme LLC" });
  expect((await call(again, "GET", "/api/person")).body).toEqual({ person: { residence: "us", facts: { llc: true } }, saved: true });
  expect((await call(again, "POST", "/api/entity", { id: "acme", name: "x" })).status).toBe(400);
});

test("upload a statement → txns, then a category + rule reclassify them", async () => {
  const db = await setup();
  const up = await call(db, "POST", "/api/upload?e=acme&to=auto&year=2025&name=mercury.json", new Blob([DUMP]));
  expect(up.body.txns).toHaveLength(2);
  expect(up.body.inbox).toEqual(["mercury.json"]);
  const wire = up.body.txns.find((t: any) => t.desc.includes("WIRE") || t.desc.includes("Client"));
  const cat = await call(db, "POST", "/api/category?e=acme", { ids: [wire.id], category: "revenue:sales", rule: "Client" });
  expect(cat.body.txns.find((t: any) => t.id === wire.id).category).toBe("revenue:sales");
  expect(cat.body.rules[0]).toEqual(["Client", "revenue:sales"]);
  expect((await call(db, "POST", "/api/rules?e=acme", { rules: [] })).body.rules).toEqual([]);
  // the same file again changes nothing (txns dedupe by uid)
  expect((await call(db, "POST", "/api/upload?e=acme&to=inbox&year=2025&name=mercury.json", new Blob([DUMP]))).body.txns).toHaveLength(2);
});

test("form values, docs, meta and years save; null removes", async () => {
  const db = await setup();
  await call(db, "POST", "/api/form?e=acme", { year: 2025, values: { a: "1", b: "2" } });
  const s = (await call(db, "POST", "/api/form?e=acme", { year: 2025, values: { b: null } })).body;
  expect(s.form).toEqual({ "2025": { a: "1" } });
  expect((await call(db, "POST", "/api/doc?e=acme", { name: "invoices", value: [{ n: 1 }] })).body.docs.invoices).toEqual([{ n: 1 }]);
  expect((await call(db, "POST", "/api/doc?e=acme", { name: "form", value: 1 })).status).toBe(400);
  expect((await call(db, "POST", "/api/meta?e=acme", { name: "Acme Inc" })).body.entity.name).toBe("Acme Inc");
  expect((await call(db, "POST", "/api/year?e=acme", { year: 2024 })).body.years).toContain(2024);
  expect((await call(db, "POST", "/api/year?e=acme", { year: 2024, remove: true })).body.years).not.toContain(2024);
});

test("PDFs go to proofs and are served back; server-only routes answer 403", async () => {
  const db = await setup();
  const up = await call(db, "POST", "/api/upload?e=acme&to=auto&year=2025&name=receipt.pdf", new Blob([PDF]));
  expect(up.body.proofs["2025"]).toEqual(["receipt.pdf"]);
  const f = await call(db, "GET", "/files/acme/proofs/2025/receipt.pdf");
  expect([...new Uint8Array(f.body)]).toEqual([...PDF]);
  expect((await call(db, "GET", "/files/acme/proofs/2025/none.pdf")).status).toBe(404);
  const { PDFDocument } = await import("pdf-lib");
  const real = await PDFDocument.create();
  real.addPage();
  real.addPage();
  await call(db, "POST", "/api/upload?e=acme&to=proofs&year=2025&name=real.pdf", new Blob([(await real.save()) as BlobPart]));
  expect((await call(db, "GET", "/api/pack?e=acme&year=2025")).status).toBe(400); // receipt.pdf is not a real PDF
  await db.upload("acme", "real2.pdf", await real.save(), "proofs", 2024);
  const pack = await call(db, "GET", "/api/pack?e=acme&year=2024");
  expect((await PDFDocument.load(pack.body)).getPageCount()).toBe(2);
  expect((await call(db, "GET", "/api/pack?e=acme&year=2020")).status).toBe(404);
  for (const p of ["/api/sync?e=acme", "/api/connect?e=acme", "/api/ai", "/api/vault/setup", "/api/tools/run"])
    expect((await call(db, "POST", p, {})).status).toBe(403);
});

test("export → import into a fresh database restores books and files", async () => {
  const a = await setup();
  await call(a, "POST", "/api/upload?e=acme&to=auto&year=2025&name=mercury.json", new Blob([DUMP]));
  await call(a, "POST", "/api/upload?e=acme&to=auto&year=2025&name=receipt.pdf", new Blob([PDF]));
  await call(a, "POST", "/api/form?e=acme", { year: 2025, values: { a: "1" } });
  const backup = JSON.parse(JSON.stringify(await a.export()));
  const b = await fresh();
  await b.import(backup);
  expect(b.state("acme")).toEqual(a.state("acme"));
  expect([...(await b.blob("acme/proofs/2025/receipt.pdf"))!]).toEqual([...PDF]);
  await expect(b.import({ nope: 1 } as never)).rejects.toThrow("not an OpenBooks backup");
});

test("the server's write checks: closed period (409), unbalanced journal (400), rule objects", async () => {
  const db = await setup();
  const up = await call(db, "POST", "/api/upload?e=acme&to=inbox&year=2025&name=mercury.json", new Blob([DUMP]));
  const id = up.body.txns[0].id;
  expect((await call(db, "POST", "/api/doc?e=acme", { name: "books", value: { closeDate: "2025-12-31" } })).status).toBe(200);
  expect((await call(db, "POST", "/api/category?e=acme", { ids: [id], category: "revenue:sales" })).status).toBe(409);
  expect(
    (
      await call(db, "POST", "/api/rules?e=acme", {
        rules: [
          ["Client", "revenue:sales"],
          ["Interest", "revenue:sales"],
        ],
      })
    ).status,
  ).toBe(409);
  const je = { id: "j1", date: "2026-01-05", memo: "x", lines: [{ account: "revenue:sales", debit: 5 }] };
  expect((await call(db, "POST", "/api/doc?e=acme", { name: "journal", value: [je] })).status).toBe(400);
  expect((await call(db, "POST", "/api/rules?e=acme", { rules: [{ nope: 1 }] })).status).toBe(400);
  expect((await call(db, "POST", "/api/doc?e=acme", { name: "books", value: {} })).status).toBe(200);
  const obj = { when: [{ field: "text", op: "contains", value: "WIRE" }], then: { account: "revenue:sales" } };
  expect((await call(db, "POST", "/api/rules?e=acme", { rules: [obj] })).body.rules).toEqual([obj]);
});
