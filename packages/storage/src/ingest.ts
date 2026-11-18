// books.py ingest(): parse an entity's inbox into books.db, only when a statement file was added, changed or removed.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { currencyOf } from "@openbooks/core";
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

/** What one ingest did, for the audit log: rows added/removed per statement file, and what the close date kept out. */
export interface IngestSummary {
  files: Record<string, { added: number; removed: number }>;
  /** Changes inside the closed period that were not made: the closed rows stay as they were. */
  blocked?: { close: string; added: number; removed: number; changed: number };
  /** Splits that added up before this ingest and no longer do (the transaction's amount changed or it is gone). */
  droppedSplits?: string[];
}
export interface IngestOptions {
  /** The books' close date: rows dated on or before it are never added, removed or changed by an ingest. */
  close?: string | null;
  /** doc "splits", to report the splits this ingest breaks. */
  splitsOk?: (id: string, amount: number | undefined) => boolean;
  /** Called inside the ingest's transaction (the audit row commits with the rows). */
  audit?: (s: IngestSummary) => void;
}

type Row = [string, string, string, number, string, string, string, string];
const fileOf = (data: string) => {
  const f = (JSON.parse(data) as { file?: unknown }).file;
  return typeof f === "string" ? f : "";
};

/**
 * Re-reads every statement when the {file: sig} map differs from the statement table (overlapping statements dedupe
 * against each other), then replaces the entity's txn + statement rows in one transaction. Returns whether it re-ingested.
 * Rows on or before `opts.close` keep their stored version: a closed period is never changed by a new, edited or synced statement.
 * ctx: everything but siblingPdfPeriods, which this fills in.
 */
export function ingest(db: Database, inbox: string, e: string, read: Read, ctx: Omit<ReadContext, "siblingPdfPeriods">, opts: IngestOptions = {}): boolean {
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

  const txns: Row[] = [];
  const stmts: [string, string, string, string, number][] = [];
  const seen = new Set<string>(),
    books = currencyOf(ctx.meta);
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
      if (row.currency === books) delete row.currency; // absent = the books' currency: the rows of a one-currency entity stay as before
      txns.push([e, id, r.date, r.amount, r.account, r.desc, r.source, JSON.stringify({ id, ...row })]);
    }
  }
  db.transaction(() => {
    const old = db
      .query<{ id: string; date: string; amount: number; account: string; desc: string; source: string; data: string }, [string]>(
        "select id, date, amount, account, desc, source, data from txn where entity = ? order by date, rowid",
      )
      .all(e);
    const was = new Map(old.map((o) => [o.id, [e, o.id, o.date, o.amount, o.account, o.desc, o.source, o.data] as Row]));
    const closed = (date: string) => !!opts.close && date <= opts.close;
    const blocked = { added: 0, removed: 0, changed: 0 };
    const now = new Set(txns.map((t) => t[1]));
    const rows = txns.flatMap((t): Row[] => {
      if (!closed(t[2])) return [t];
      const o = was.get(t[1]);
      if (!o) return (blocked.added++, []);
      if (o.join("\u0000") !== t.join("\u0000")) blocked.changed++;
      return [o];
    });
    for (const o of old)
      if (closed(o.date) && !now.has(o.id)) {
        blocked.removed++;
        rows.push(was.get(o.id)!);
      }
    const kept = new Set(rows.map((t) => t[1]));
    const files: IngestSummary["files"] = {};
    const tally = (f: string, k: "added" | "removed") => ((files[f] ??= { added: 0, removed: 0 })[k] += 1);
    for (const t of rows) if (!was.has(t[1])) tally(fileOf(t[7]), "added");
    for (const o of old) if (!kept.has(o.id)) tally(fileOf(o.data), "removed");
    const amounts = new Map(rows.map((t) => [t[1], t[3]]));
    const dropped = opts.splitsOk ? old.filter((o) => opts.splitsOk!(o.id, o.amount) && !opts.splitsOk!(o.id, amounts.get(o.id))).map((o) => o.id) : [];
    opts.audit?.({
      files,
      ...(blocked.added || blocked.removed || blocked.changed ? { blocked: { close: opts.close!, ...blocked } } : {}),
      ...(dropped.length ? { droppedSplits: dropped } : {}),
    });
    db.query("delete from txn where entity = ?").run(e);
    db.query("delete from statement where entity = ?").run(e);
    const it = db.query("insert into txn values (?, ?, ?, ?, ?, ?, ?, ?)"),
      is = db.query("insert into statement values (?, ?, ?, ?, ?)");
    for (const t of rows) it.run(...t);
    for (const s of stmts) is.run(...s);
  }).immediate();
  return true;
}
