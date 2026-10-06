// books.db: one SQLite file, schema byte-for-byte books.py's (docs/architecture.md "Storage"), so both apps open the same file.
import { Database } from "bun:sqlite";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const SCHEMA = `
create table if not exists entity (id text primary key, meta text not null);
create table if not exists doc    (entity text, name text, value text not null, primary key (entity, name));
create table if not exists rule   (entity text, pos integer, match text, category text, primary key (entity, pos));
create table if not exists secret (entity text, provider text, value text not null, primary key (entity, provider));
create table if not exists txn    (entity text, id text, date text, amount real, account text, desc text, source text, data text not null, primary key (entity, id));
create index if not exists txn_date on txn (entity, date);
create table if not exists statement (entity text, file text, sig text, checks text, ok integer, primary key (entity, file));
`;

/** Real entity ids (books.py Entity()); pseudo-entities (`_ai`, `_vault`, `_app`) can never match. */
export const isEntityId = (e: string) => /^[a-z0-9-]+$/.test(e);

/** `$home/books.db`: created owner-only (it holds bank credentials), WAL, 10 s busy timeout, secure_delete, schema ensured. */
export function openDb(home: string): Database {
  mkdirSync(home, { recursive: true });
  const p = join(home, "books.db");
  if (!existsSync(p)) closeSync(openSync(p, "a", 0o600));
  const db = new Database(p);
  db.run("pragma journal_mode=wal");
  db.run("pragma busy_timeout=10000");
  db.run("pragma secure_delete=on"); // freed space is zeroed: no plaintext secret survives a vault seal or a disconnect
  db.run(SCHEMA);
  return db;
}

/** Python's sorted() on str: code-point order, i.e. UTF-8 byte order (JS's default sort compares UTF-16 units, which differs above U+FFFF). */
export const pySorted = (xs: Iterable<string>) => [...xs].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

/** pathlib's Path.suffix: ".json" for "a.json", "" for ".json" or "a." */
export function pySuffix(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i) : "";
}

/** Entries of a directory, or [] if it doesn't exist (books.py's `if x.exists()` guards). */
export const ls = (dir: string): string[] => (existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir) : []);

/** Python str.splitlines() separators. */
// oxlint-disable-next-line no-control-regex -- \x1c-\x1e are line breaks to Python
const LINES = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/**
 * books.py _migrate: first run on a JSON-era folder (entity.json, data/*.json, rules.csv) moves it into books.db; files stay as a backup.
 * Call inside a transaction; throws (→ rollback) on malformed files, like books.py.
 */
export function migrate(db: Database, eid: string, folder: string): void {
  const meta: unknown = JSON.parse(readFileSync(join(folder, "entity.json"), "utf8"));
  db.query("insert into entity values (?, ?)").run(eid, JSON.stringify(meta));
  const data = join(folder, "data");
  for (const f of pySorted(ls(data).filter((n) => n.endsWith(".json")))) {
    const v: unknown = JSON.parse(readFileSync(join(data, f), "utf8"));
    const stem = f.slice(0, -".json".length);
    if (stem === "connections")
      for (const [prov, conn] of Object.entries(v as Record<string, unknown>))
        db.query("insert into secret values (?, ?, ?)").run(eid, prov, JSON.stringify(conn));
    else db.query("insert into doc values (?, ?, ?)").run(eid, stem, JSON.stringify(v));
  }
  const rf = join(folder, "rules.csv");
  const lines = existsSync(rf) ? readFileSync(rf, "utf8").split(LINES) : [];
  const ins = db.query("insert into rule values (?, ?, ?, ?)");
  let pos = 0;
  for (const l of lines) {
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf(",");
    if (i < 0) throw new Error(`rules.csv: no comma in ${JSON.stringify(l)}`); // books.py's unpack fails the same way
    ins.run(eid, pos++, l.slice(0, i), l.slice(i + 1).trim());
  }
}
