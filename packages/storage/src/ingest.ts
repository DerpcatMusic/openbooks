// books.py ingest(): parse an entity's inbox into books.db, only when a statement file was added, changed or removed.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CsvProfile, EntityMeta, StatementCheck, StatementRow } from "@openbooks/schema";
import { ls, pySorted, pySuffix } from "./db.ts";

/** @openbooks/importers read() contract (docs/architecture.md "Importers"). */
export interface StatementFile {
  name: string;
  bytes: Uint8Array;
  text?: string; // PDFs: `pdftotext -layout` output
}
export interface ReadContext {
  meta: EntityMeta;
  profile: { bitName?: string };
  csvProfiles: CsvProfile[];
  siblingPdfPeriods: () => (readonly [string, string])[];
}
export type Read = (
  file: StatementFile,
  ctx: ReadContext,
) => { rows: readonly StatementRow[]; checks: readonly StatementCheck[]; uidAmount: (r: StatementRow) => string };

export const KINDS = [".pdf", ".csv", ".json"];

/** uid = first 12 hex of sha1("source|date|amount|desc|key"), amount as Python's str(). */
export const uid = (r: StatementRow, amount: string) =>
  createHash("sha1").update(`${r.source}|${r.date}|${amount}|${r.desc}|${r.key}`).digest("hex").slice(0, 12);

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

  let pdfPeriods: (readonly [string, string])[] | undefined; // books.py re-parses the PDFs for every One Zero sync file; once per ingest here
  const full: ReadContext = {
    ...ctx,
    siblingPdfPeriods: () =>
      (pdfPeriods ??= files
        .filter((n) => n.endsWith(".pdf")) // books.py: glob("*.pdf"), case-sensitive
        .flatMap((n) => {
          try {
            return read(load(join(inbox, n), n), full).checks.map((c) => c.period);
          } catch {
            return [];
          }
        })),
  };

  const txns: [string, string, string, number, string, string, string, string][] = [];
  const stmts: [string, string, string, string, number][] = [];
  const seen = new Set<string>();
  for (const f of files) {
    let out: ReturnType<Read>;
    try {
      out = read(load(join(inbox, f), f), full);
    } catch {
      stmts.push([e, f, sig.get(f)!, "[]", 0]); // not a statement we know: listed, never breaks the books
      continue;
    }
    stmts.push([e, f, sig.get(f)!, JSON.stringify(out.checks), 1]);
    for (const r of out.rows) {
      const id = uid(r, out.uidAmount(r));
      if (seen.has(id)) continue; // overlapping statements count once
      seen.add(id);
      const { key: _, ...row } = r;
      txns.push([e, id, r.date, r.amount, r.account, r.desc, r.source, JSON.stringify({ id, ...row })]);
    }
  }
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
