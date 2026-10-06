// read(): picks the statement reader for a file exactly like books.py read().
import type { CsvProfile, EntityMeta, StatementCheck, StatementRow } from "@openbooks/schema";
import { bitCsv } from "./readers/bit.ts";
import { csvDecode, mappedCsv } from "./readers/csv.ts";
import { mercuryCsv, mercuryJson } from "./readers/mercury.ts";
import { onezeroJson, onezeroPdf } from "./readers/onezero.ts";
import { scraperJson } from "./readers/scraper.ts";
import { parseJson, uidAmount } from "./uid.ts";

/** A statement file. For PDFs the caller passes `pdftotext -layout` output as `text`; read() fills `text` for JSON and mapped CSV. */
export interface ReadFile {
  name: string;
  bytes: Uint8Array;
  text?: string;
}
export interface ReadContext {
  meta: EntityMeta;
  profile: { bitName?: string };
  csvProfiles: CsvProfile[];
  /** Check periods of the inbox's sibling `*.pdf` One Zero statements (unparseable ones contribute none), for onezeroJson's cut-off. */
  siblingPdfPeriods: () => (readonly [string, string])[];
}
export interface ReadResult {
  rows: StatementRow[];
  checks: StatementCheck[];
}
export type Reader = (file: ReadFile, ctx: ReadContext) => ReadResult;

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }); // Path.read_text(): strict, BOM kept (json.loads then rejects it, as JSON.parse does)

/** Throws for a file that isn't a statement we know (ingest lists it with ok = 0). */
export function read(file: ReadFile, ctx: ReadContext): ReadResult & { uidAmount: (r: StatementRow) => string } {
  return { ...pick(file, ctx), uidAmount };
}

function pick(f: ReadFile, ctx: ReadContext): ReadResult {
  const i = f.name.lastIndexOf(".");
  const s = i > 0 ? f.name.slice(i).toLowerCase() : ""; // Path.suffix: ".bashrc" has none
  if (s === ".pdf") return onezeroPdf(f);
  if (s === ".json") {
    const text = utf8.decode(f.bytes);
    const d = parseJson(text);
    if (typeof d !== "object" || d === null || Array.isArray(d)) throw new TypeError("not a JSON object"); // Python: .get on a list/None raises
    const src = (d as { source?: unknown }).source;
    return (src === "onezero" ? onezeroJson : src === "scraper" ? scraperJson : mercuryJson)({ ...f, text }, ctx);
  }
  if (s === ".csv") {
    const text = csvDecode(f.bytes);
    if (text.split("\n", 1)[0]!.includes("Date (UTC)")) return mercuryCsv(f); // Python's mercury_csv re-reads the file as strict UTF-8
    const m = mappedCsv({ ...f, text }, ctx);
    if (m) return m;
    return bitCsv(f, ctx); // Python's bit() re-reads the file as strict UTF-8 too
  }
  throw new Error("unsupported");
}
