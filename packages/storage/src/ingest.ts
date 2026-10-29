// books.py ingest(): parse an entity's inbox into books.db, only when a statement file was added, changed or removed.
import type { Database } from "bun:sqlite";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ls, pySorted, pySuffix } from "./db.ts";
import { KINDS, parseStatements, type Read, type ReadContext, type StatementFile } from "./parse.ts";

export { KINDS, uid, type Read, type ReadContext, type StatementFile } from "./parse.ts";

/** `<st_mtime_ns>:<st_size>`, the same string books.py stores. */
export const sigOf = (f: string) => {
  const s = statSync(f, { bigint: true });
  return `${s.mtimeNs}:${s.size}`;
};

function pdftotext(path: string): string | undefined {
  try {
    const p = Bun.spawnSync(["pdftotext", "-layout", path, "-"]);
    return p.exitCode === 0 ? p.stdout.toString() : undefined;
  } catch {
    return undefined; // no poppler: the reader fails and the PDF is listed unreadable, like books.py
  }
}

const load = (path: string, name: string): StatementFile => {
  const bytes = readFileSync(path);
  return pySuffix(name).toLowerCase() === ".pdf" ? { name, bytes, text: pdftotext(path) } : { name, bytes };
};

/**
 * Re-reads every statement when the {file: sig} map differs from the statement table (overlapping statements dedupe
 * against each other), then replaces the entity's txn + statement rows in one transaction. Returns whether it re-ingested.
 * ctx: everything but siblingPdfPeriods, which this fills in.
 */
export function ingest(db: Database, inbox: string, e: string, read: Read, ctx: Omit<ReadContext, "siblingPdfPeriods">): boolean {
  const files = pySorted(ls(inbox).filter((n) => KINDS.includes(pySuffix(n).toLowerCase())));
  const sig = new Map(files.map((f) => [f, sigOf(join(inbox, f))]));
  const known = db.query<{ file: string; sig: string }, [string]>("select file, sig from statement where entity = ?").all(e);
  if (known.length === sig.size && known.every((k) => sig.get(k.file) === k.sig)) return false;

  const { txns, stmts } = parseStatements(
    files.map((name) => ({ name, get: () => load(join(inbox, name), name) })),
    (n) => sig.get(n)!,
    e,
    read,
    ctx,
  );
  db.transaction(() => {
    db.query("delete from txn where entity = ?").run(e);
    db.query("delete from statement where entity = ?").run(e);
    const it = db.query("insert into txn values (?, ?, ?, ?, ?, ?, ?, ?)"),
      is = db.query("insert into statement values (?, ?, ?, ?, ?)");
    for (const t of txns) it.run(...t);
    for (const s of stmts) is.run(...s);
  }).immediate();
  return true;
}
