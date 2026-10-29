// Reading statement files into transactions, with no sqlite or fs: ingest.ts feeds it files from the inbox folder, and the browser-only
// mode (apps/web/src/lib/local) feeds it files from IndexedDB.
import { sha1Hex } from "@openbooks/core";
import type { CsvProfile, EntityMeta, StatementCheck, StatementRow } from "@openbooks/schema";

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
export const uid = (r: StatementRow, amount: string) => sha1Hex(`${r.source}|${r.date}|${amount}|${r.desc}|${r.key}`).slice(0, 12);

export type ParsedTxn = [e: string, id: string, date: string, amount: number, account: string, desc: string, source: string, data: string];
export type ParsedStatement = [e: string, file: string, sig: string, checks: string, ok: number];

/**
 * Reads every statement (files sorted by the caller; `get` loads one lazily). Overlapping statements dedupe against each other;
 * a file no reader takes is listed with ok = 0 and never breaks the books. sig(name) = the file's change signature.
 */
export function parseStatements(
  files: readonly { name: string; get: () => StatementFile }[],
  sig: (name: string) => string,
  e: string,
  read: Read,
  ctx: Omit<ReadContext, "siblingPdfPeriods">,
) {
  let pdfPeriods: (readonly [string, string])[] | undefined; // books.py re-parses the PDFs for every One Zero sync file; once per ingest here
  const full: ReadContext = {
    ...ctx,
    siblingPdfPeriods: () =>
      (pdfPeriods ??= files
        .filter((f) => f.name.endsWith(".pdf")) // books.py: glob("*.pdf"), case-sensitive
        .flatMap((f) => {
          try {
            return read(f.get(), full).checks.map((c) => c.period);
          } catch {
            return [];
          }
        })),
  };
  const txns: ParsedTxn[] = [];
  const stmts: ParsedStatement[] = [];
  const seen = new Set<string>();
  for (const { name: f, get } of files) {
    let out: ReturnType<Read>;
    try {
      out = read(get(), full);
    } catch {
      stmts.push([e, f, sig(f), "[]", 0]); // not a statement we know: listed, never breaks the books
      continue;
    }
    stmts.push([e, f, sig(f), JSON.stringify(out.checks), 1]);
    for (const r of out.rows) {
      const id = uid(r, out.uidAmount(r));
      if (seen.has(id)) continue; // overlapping statements count once
      seen.add(id);
      const { key: _, ...row } = r;
      txns.push([e, id, r.date, r.amount, r.account, r.desc, r.source, JSON.stringify({ id, ...row })]);
    }
  }
  return { txns, stmts };
}
