// Moves self-hosted books into the browser app: reads OPENBOOKS_HOME (books.db + <entity>/inbox|proofs|attachments) and writes the
// JSON that the browser app's "Restore backup" takes (apps/web/src/lib/local/store.ts, Backup). Secrets (bank tokens) stay behind.
//   bun scripts/local/export-backup.ts [home=$OPENBOOKS_HOME] [out=openbooks-backup.json]
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const home = process.argv[2] ?? process.env.OPENBOOKS_HOME;
const out = process.argv[3] ?? "openbooks-backup.json";
if (!home) throw new Error("usage: export-backup.ts <OPENBOOKS_HOME> [out.json]");

const db = new Database(join(home, "books.db"), { readonly: true });
const kv: Record<string, unknown> = {};
const blobs: Record<string, string> = {};
const json = (s: string) => JSON.parse(s) as unknown;

for (const { id, meta } of db.query<{ id: string; meta: string }, []>("select id, meta from entity").all()) kv[`entity/${id}`] = json(meta);
for (const d of db.query<{ entity: string; name: string; value: string }, []>("select entity, name, value from doc").all())
  kv[`doc/${d.entity}/${d.name}`] = json(d.value);
for (const { entity } of db.query<{ entity: string }, []>("select distinct entity from rule").all())
  kv[`rules/${entity}`] = db
    .query<{ match: string; category: string }, [string]>("select match, category from rule where entity = ? order by pos")
    .all(entity)
    .map((r) => [r.match, r.category]);
// Parsed transactions and statement checks go across as they are: the browser can't re-read bank PDFs (no pdftotext there).
for (const { entity } of db.query<{ entity: string }, []>("select distinct entity from txn").all())
  kv[`txns/${entity}`] = db
    .query<{ data: string }, [string]>("select data from txn where entity = ? order by date, id")
    .all(entity)
    .map((t) => json(t.data));
for (const { entity } of db.query<{ entity: string }, []>("select distinct entity from statement").all())
  kv[`stmts/${entity}`] = db
    .query<{ file: string; checks: string; ok: number }, [string]>("select file, checks, ok from statement where entity = ?")
    .all(entity)
    .map((s) => ({ file: s.file, checks: json(s.checks), ok: !!s.ok }));

const walk = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])) : [];
for (const k of Object.keys(kv).filter((k) => k.startsWith("entity/"))) {
  const e = k.slice(7);
  for (const sub of ["inbox", "proofs", "attachments"])
    for (const f of walk(join(home, e, sub))) blobs[`${e}/${relative(join(home, e), f)}`] = readFileSync(f).toString("base64");
}

writeFileSync(out, JSON.stringify({ app: "openbooks-local", v: 1, kv, blobs }));
console.log(`${out}: ${Object.keys(kv).length} records, ${Object.keys(blobs).length} files`);
