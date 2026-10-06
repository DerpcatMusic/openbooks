// One Zero: the "פירוט תנועות שקליות" PDF (via pdftotext, = books.py onezero) and the live-sync JSON (= books.py onezero_json).
// Also the small Python-compat helpers the Israeli readers share (bit.ts, scraper.ts).
import { spawnSync } from "node:child_process";
import type { EntityMeta, StatementCheck, StatementRow } from "@openbooks/schema";
import { pyRound } from "@openbooks/core";
import { intAmount, parseJson, pyFloatStr, uidAmount } from "../uid.ts";

export type ReaderFile = { name: string; bytes: Uint8Array; text?: string };
export type ReaderOut = { rows: StatementRow[]; checks: StatementCheck[] };

/** Python's str.isspace() set: `\s` in its `re`, and what str.split()/str.strip() cut on (JS `\s` differs: \x1c-\x1f, \x85, the BOM). */
export const PYWS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const wsRun = new RegExp(`[${PYWS}]+`);
const edges = new RegExp(`^[${PYWS}]+|[${PYWS}]+$`, "g");
/** " ".join(s.split()) */
export const pyWords = (s: string): string => s.split(wsRun).filter(Boolean).join(" ");
export const pyStrip = (s: string): string => s.replace(edges, "");

const FLOAT = /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/;
const SPECIAL = /^([+-]?)(?:(inf|infinity)|nan)$/i;
/** Python float(s) for a str: throws where Python raises ValueError (JS Number("") would be 0, Number("0x1") 1). */
export function pyFloat(s: string): number {
  const t = pyStrip(s);
  if (FLOAT.test(t)) return Number(t.replaceAll("_", ""));
  const m = SPECIAL.exec(t);
  if (m) return m[2] ? (m[1] === "-" ? -Infinity : Infinity) : NaN;
  throw new Error(`could not convert string to float: '${s}'`);
}
/** books.py num(): "1,234.50" → 1234.5 */
export const num = (s: string): number => pyFloat(s.replaceAll(",", ""));

/** Strict UTF-8 (Python read_text()); a BOM is kept, so JSON with one fails as it does in json.loads. */
export const utf8 = (b: Uint8Array, stripBom = false): string => new TextDecoder("utf-8", { fatal: true, ignoreBOM: !stripBom }).decode(b);

/**
 * A JSON statement, parsed with uid.ts's parseJson (so read()'s uidAmount knows integer literals once a reader calls intAmount),
 * plus `isInt(holder, key)`: was holder[key] an integer literal? (Python str(12) is "12", str(12.0) "12.0".)
 */
export function parseStatementJson(file: ReaderFile): { data: any; isInt: (holder: object, key: string) => boolean } {
  const data = parseJson(file.text ?? utf8(file.bytes));
  // ponytail: probes uid.ts's literal map through intAmount/uidAmount; a direct export from uid.ts would be cleaner
  const isInt = (h: object, k: string) => uidAmount(intAmount({ amount: NaN } as StatementRow, h, k)) !== "nan";
  return { data, isInt };
}

/** Python str(v) for a JSON value (f-strings, str()). */
export const pyS = (v: unknown, isInt = false): string =>
  v === null || v === undefined
    ? "None"
    : v === true
      ? "True"
      : v === false
        ? "False"
        : typeof v === "number"
          ? isInt
            ? String(v)
            : pyFloatStr(v)
          : String(v as string); // ponytail: lists/dicts would print Python-style; statements never put them here

// ---------- PDF ----------
/** `pdftotext -layout <pdf> -` as books.py runs it (check=True, text=True: UTF-8, universal newlines). */
export function pdftotext(bytes: Uint8Array): string {
  const p = spawnSync("pdftotext", ["-layout", "-", "-"], { input: bytes, maxBuffer: 1 << 30 });
  if (p.error) throw p.error;
  if (p.status !== 0) throw new Error(`pdftotext exited ${p.status}: ${p.stderr.toString()}`);
  return utf8(p.stdout, true).replace(/\r\n?/g, "\n");
}

const AMT = new RegExp(`([\\d,]+(?:\\.\\d+)?)[${PYWS}]*ש”ח`, "g");
const DATE = /(\d\d)\/(\d\d)\/(\d{4})/g;
const PERIOD = new RegExp(`\\d\\d/\\d\\d/\\d{4}[${PYWS}]*-[${PYWS}]*\\d\\d/`);
const iso = (m: RegExpMatchArray) => `${m[3]}-${m[2]}-${m[1]}`;
const amts = (l: string) => [...l.matchAll(AMT)].map((m) => m[1]!);
const dates = (l: string) => [...l.matchAll(DATE)].map(iso);

/** One Zero PDF → credits (with page numbers), reconciled against the PDF's own total. `file.text` = pdftotext output if the caller already ran it. */
export function onezeroPdf(file: ReaderFile): ReaderOut {
  const text = (file.text ?? pdftotext(file.bytes)).replace(/[‪-‮‎‏]/g, "");
  const lines = text.split("\n"); // not a line-break split that would eat the \f page breaks
  const rows: StatementRow[] = [];
  let page = 1;
  lines.forEach((l, i) => {
    page += l.split("\f").length - 1;
    const a = amts(l),
      d = dates(l);
    if (a.length === 3 && d.length === 2 && num(a[1]!)) {
      // a description cell wraps around the amounts line; its lines read bottom-up
      if (i + 1 >= lines.length) throw new Error("list index out of range");
      const mid = l.replace(AMT, "").replace(DATE, "");
      const desc = pyWords(`${lines[i + 1]} ${mid} ${lines.at(i - 1)}`.replaceAll("\f", "")); // lines[-1] for i = 0, as in Python
      rows.push({ date: d[1]!, amount: num(a[1]!), desc, source: "bank", account: "One Zero", file: file.name, page, key: a[0]! });
    }
  });
  const totalLine = lines.find((l) => l.includes("סך כל הזיכויים"));
  const t = totalLine === undefined ? null : new RegExp(AMT.source).exec(totalLine);
  if (!t) throw new Error("One Zero PDF without a credits total");
  const periodLine = lines.find((l) => PERIOD.test(l));
  if (periodLine === undefined) throw new Error("One Zero PDF without a period");
  // Python keeps every date on that line; normally exactly the two ends
  const period = dates(periodLine) as unknown as [string, string];
  const parsed = pyRound(rows.reduce((s, r) => s + r.amount, 0));
  return { rows, checks: [{ file: file.name, label: "One Zero statement", period, parsed, total: num(t[1]!) }] };
}

// ---------- sync JSON ----------
/**
 * One Zero live sync (connectors). PDFs already cover their periods, so only what's after the latest PDF counts;
 * credits only unless meta.import is "all". chargedAmount is taken straight from JSON: intAmount makes an integer literal hash as "300", not "300.0".
 */
export function onezeroJson(file: ReaderFile, ctx: { meta: EntityMeta; siblingPdfPeriods: () => (readonly [string, string])[] }): ReaderOut {
  const { data, isInt } = parseStatementJson(file);
  const cut = ctx.siblingPdfPeriods().reduce((m, p) => (p[1] > m ? p[1] : m), "");
  const rows: StatementRow[] = [];
  for (const a of data.accounts) {
    for (const t of a.txns ?? []) {
      const date: string = t.date.slice(0, 10),
        amt: number = t.chargedAmount;
      if (date > cut && (amt > 0 || ctx.meta.import === "all")) {
        const r: StatementRow = {
          date,
          amount: amt,
          desc: t.description ?? "",
          source: "bank",
          account: "One Zero",
          file: file.name,
          page: rows.length + 1,
          key: "identifier" in t ? pyS(t.identifier, isInt(t, "identifier")) : "",
        };
        rows.push(intAmount(r, t, "chargedAmount"));
      }
    }
    // no reconciliation row: a filtered slice (credits after the last PDF) can't add up to the bank balance
  }
  return { rows, checks: [] };
}
