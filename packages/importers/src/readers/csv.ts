// Any bank's CSV: the user maps its columns once (doc "csv-profiles"), matching files are read on every ingest.
// Port of books.py csv_decode/csv_table/csv_sig/csv_date/money/csv_rows/mapped_csv/csv_preview, bit-identical:
// Python's csv module, str.strip/split/splitlines, float() and round() are reproduced below, not approximated.
import type { CsvProfile, StatementCheck, StatementRow } from "@openbooks/schema";
import { pyRound } from "@openbooks/core";
import { intAmount, parseJson } from "../uid.ts";

// ---------- Python string/number semantics ----------
/** str.isspace() / re's \s for str patterns, as a character-class body. */
const WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const STRIP = new RegExp(`^[${WS}]+|[${WS}]+$`, "g");
const SPLIT = new RegExp(`[${WS}]+`);
export const pyStrip = (s: string): string => s.replace(STRIP, "");
/** " ".join(s.split()) */
export const squash = (s: string): string => pyStrip(s).split(SPLIT).filter(Boolean).join(" ");
/** str.splitlines() (no keepends) */
export const splitlines = (s: string): string[] => {
  // oxlint-disable-next-line no-control-regex -- Python's line boundaries include \x1c-\x1e
  const out = s.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (out.at(-1) === "") out.pop();
  return out;
};

/** Value of a Unicode decimal digit (\p{Nd} blocks are runs of ten starting at 0). */
const digitValue = (ch: string): number => {
  let cp = ch.codePointAt(0)!,
    n = 0;
  for (; /\p{Nd}/u.test(String.fromCodePoint(cp - 1)); cp--) n++;
  return n % 10;
};
// oxlint-disable-next-line no-control-regex -- the ASCII range
const asciiDigits = (s: string): string => s.replace(/[^\x00-\x7f]/gu, (c) => (/\p{Nd}/u.test(c) ? String(digitValue(c)) : c));
const D = "\\p{Nd}(?:_?\\p{Nd})*";
const FLOAT = new RegExp(`^[+-]?(?:(?:(?:${D})?\\.${D}|${D}\\.?)(?:[eE][+-]?${D})?|inf(?:inity)?|nan)$`, "iu");
/** Python float(s); null where Python raises ValueError. */
export function pyFloat(s: string): number | null {
  s = pyStrip(s);
  if (!FLOAT.test(s)) return null;
  const t = asciiDigits(s).replaceAll("_", "").toLowerCase();
  const sign = t.startsWith("-") ? -1 : 1;
  const body = t.replace(/^[+-]/, "");
  return body.startsWith("inf") ? sign * Infinity : body === "nan" ? NaN : Number(t);
}

/** round(x, 2), passing nan/inf through. */
export const round2 = (x: number): number => (Number.isFinite(x) ? pyRound(x, 2) : x);

/** The uid prints a Python int 0 as "0": uid.ts only learns int-ness from parsed JSON, so hand it a literal 0. */
const INT0 = parseJson('{"a":0}') as object;

// ---------- Python's csv.reader (excel dialect, any delimiter), fed like io.StringIO: lines end at "\n" only ----------
const FIELD_LIMIT = 131072;
type State = "start" | "field0" | "field" | "quoted" | "quote" | "crnl";
export function* pyCsv(text: string, delim = ","): Generator<string[]> {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let fields: string[] = [],
    field = "",
    len = 0,
    state = "start" as State,
    i = 0;
  const save = () => {
    fields.push(field);
    field = "";
    len = 0;
  };
  const add = (c: string) => {
    if (len >= FIELD_LIMIT) throw new Error(`field larger than field limit (${FIELD_LIMIT})`);
    field += c;
    len++;
  };
  const eol = (c: string | null): State => (c === null ? "start" : "crnl");
  const step = (c: string | null) => {
    const nl = c === "\n" || c === "\r";
    switch (state) {
      case "start":
        if (c === null) return;
        if (nl) return void (state = "crnl");
        state = "field0";
        return step(c);
      case "field0":
        if (nl || c === null) {
          save();
          state = eol(c);
        } else if (c === '"') state = "quoted";
        else if (c === delim) save();
        else {
          add(c);
          state = "field";
        }
        return;
      case "field":
        if (nl || c === null) {
          save();
          state = eol(c);
        } else if (c === delim) {
          save();
          state = "field0";
        } else add(c);
        return;
      case "quoted":
        if (c === null) return;
        if (c === '"') state = "quote";
        else add(c);
        return;
      case "quote":
        if (c === '"') {
          add(c);
          state = "quoted";
        } else if (c === delim) {
          save();
          state = "field0";
        } else if (nl || c === null) {
          save();
          state = eol(c);
        } else {
          add(c);
          state = "field";
        }
        return;
      case "crnl":
        if (c === null) state = "start";
        else if (!nl) throw new Error("new-line character seen in unquoted field - do you need to open the file with newline=''?");
    }
  };
  for (;;) {
    fields = [];
    field = "";
    len = 0;
    state = "start" as State;
    do {
      const line = lines[i++];
      if (line === undefined) {
        if (len !== 0 || state === "quoted") {
          save();
          break;
        }
        return;
      }
      for (const c of line) step(c);
      step(null);
    } while (state !== "start");
    yield fields;
  }
}

// ---------- books.py ----------
const CP1255 =
  "\u20ac\ufffd\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\ufffd\u2039\ufffd\ufffd\ufffd\ufffd\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\ufffd\u203a\ufffd\ufffd\ufffd\ufffd" +
  "\u00a0\u00a1\u00a2\u00a3\u20aa\u00a5\u00a6\u00a7\u00a8\u00a9\u00d7\u00ab\u00ac\u00ad\u00ae\u00af\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u00f7\u00bb\u00bc\u00bd\u00be\u00bf" +
  "\u05b0\u05b1\u05b2\u05b3\u05b4\u05b5\u05b6\u05b7\u05b8\u05b9\ufffd\u05bb\u05bc\u05bd\u05be\u05bf\u05c0\u05c1\u05c2\u05c3\u05f0\u05f1\u05f2\u05f3\u05f4\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd" +
  "\u05d0\u05d1\u05d2\u05d3\u05d4\u05d5\u05d6\u05d7\u05d8\u05d9\u05da\u05db\u05dc\u05dd\u05de\u05df\u05e0\u05e1\u05e2\u05e3\u05e4\u05e5\u05e6\u05e7\u05e8\u05e9\u05ea\ufffd\ufffd\u200e\u200f\ufffd";

/** UTF-8 (one BOM dropped), else cp1255 with replacement: Israeli banks' Excel-era exports. Python's cp1255 table, not WHATWG's. */
export function csvDecode(b: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    let s = "";
    for (const x of b) s += x < 0x80 ? String.fromCharCode(x) : CP1255[x - 0x80];
    return s;
  }
}

/** All rows (cells stripped), split on whichever of comma, semicolon or tab splits the first 30 lines into the most cells. */
export function csvTable(text: string): [string[][], string] {
  text = text.replace(/^\ufeff+/, "");
  const head = splitlines(text).slice(0, 30).join("\n");
  let delim = ",",
    best = -1;
  for (const d of [",", ";", "\t"]) {
    let n = 0;
    for (const r of pyCsv(head, d)) if (r.length > 1) n += r.length;
    if (n > best) {
      best = n;
      delim = d;
    }
  }
  return [Array.from(pyCsv(text, delim), (r) => r.map(pyStrip)), delim];
}

/** A profile matches a file whose header row has these cells (the UI computes the same). */
export const csvSig = (row: readonly string[]): string => row.filter(Boolean).join("|");

const DATE = /(\p{Nd}{1,4})[./-](\p{Nd}{1,2})[./-](\p{Nd}{1,4})/u;
/** '31/12/2025', '12/31/25', '2025-12-31', '31.12.2025 10:30' -> '2025-12-31' (fmt: DD/MM/YYYY, MM/DD/YYYY or YYYY-MM-DD); else null. */
export function csvDate(s: string | null | undefined, fmt: string | null | undefined): string | null {
  const m = DATE.exec(s || "");
  if (!m) return null;
  const [, a, b, c] = m as unknown as [string, string, string, string];
  const [ys, ms, ds] = fmt === "YYYY-MM-DD" ? [a, b, c] : fmt === "MM/DD/YYYY" ? [c, a, b] : [c, b, a];
  // oxlint-disable-next-line no-misused-spread -- len() counts code points
  const y = Number(asciiDigits(ys)) + ([...ys].length === 2 ? 2000 : 0),
    mo = Number(asciiDigits(ms)),
    d = Number(asciiDigits(ds));
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(2000, mo, 0)).getUTCDate()) return null;
  if (mo === 2 && d === 29 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const NOISE = new RegExp(`[${WS}\\u200e\\u200f\\u202a-\\u202e₪$€£]|NIS|ILS|USD|EUR|ש["״”]ח`, "gu");
/** '₪1,234.50', '-$5', '(12.00)', '12.00-', '1.234,56 €', '−3,5' -> number; blank or not a number -> null. */
export function money(s: string | null | undefined): number | null {
  let t = (s || "").replace(NOISE, "").replaceAll("−", "-");
  const neg = t.startsWith("-") || t.startsWith("(") || t.endsWith("-");
  t = t.replace(/^[()+-]+|[()+-]+$/g, "");
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replaceAll(".", "").replaceAll(",", ".") : t.replaceAll(",", "");
  else if (t.includes(",")) t = /^\p{Nd}+,\p{Nd}{1,2}$/u.test(t) ? t.replaceAll(",", ".") : t.replaceAll(",", "");
  else if (t.split(".").length > 2) t = t.replaceAll(".", "");
  const v = pyFloat(t);
  return v === null ? null : neg ? -v : v;
}

type Profile = CsvProfile & Record<string, unknown>;
/** isinstance(v, int): bools are ints in Python. */
const col = (v: unknown): number | null => (typeof v === "boolean" ? Number(v) : Number.isInteger(v) ? (v as number) : null);

/**
 * Rows below the header, mapped by profile p: {dateCol, dateFormat, descCol, amountCol | debitCol+creditCol, memoCol?, refCol?, invert?, account}.
 * Lines without a date or an amount (totals, footers, blank lines) are skipped. Debit/credit both blank or zero make
 * `abs(cr or 0) - abs(dr or 0)` a Python int 0, so the uid hashes "0", not "0.0": such rows are marked via intAmount.
 */
export function csvRows(table: readonly string[][], p: CsvProfile, file: string, first = 1): StatementRow[] {
  const q = p as Profile,
    rows: StatementRow[] = [],
    dupes = new Map<string, number>();
  table.forEach((r, i) => {
    const cell = (k: string) => {
      const c = col(q[k]);
      return c !== null && c >= 0 && c < r.length ? r[c]! : "";
    };
    const date = csvDate(cell("dateCol"), q.dateFormat === undefined ? "DD/MM/YYYY" : q.dateFormat);
    let amt: number | null,
      isInt = false;
    if (col(q.amountCol) !== null) amt = money(cell("amountCol"));
    else {
      const dr = money(cell("debitCol")),
        cr = money(cell("creditCol"));
      amt = dr === null && cr === null ? null : Math.abs(cr ?? 0) - Math.abs(dr ?? 0);
      isInt = !cr && !dr && !Number.isNaN(cr) && !Number.isNaN(dr); // both falsy in Python (None/0.0; nan is truthy)
    }
    if (!date || amt === null) return;
    amt = round2(q.invert ? -amt : amt);
    if (isInt) amt = 0; // Python int 0 has no sign
    const desc = squash(cell("descCol"));
    let k = cell("refCol");
    if (!k) {
      const dk = JSON.stringify([date, amt, desc]),
        n = (dupes.get(dk) ?? -1) + 1;
      dupes.set(dk, n);
      k = `#${n}`;
    }
    const row: StatementRow = {
      date,
      amount: amt,
      desc,
      memo: cell("memoCol"),
      source: "csv",
      account: (q.account as string) || (q.name as string) || "CSV",
      file,
      page: i + first,
      key: `${q.account ?? "None"}|${k}`,
    };
    rows.push(isInt ? intAmount(row, INT0, "a") : row);
  });
  return rows;
}

/** (rows, checks) via the first saved profile whose header row is in this file; null if none is. */
export function mappedCsv(
  file: { name: string; bytes: Uint8Array; text?: string },
  ctx: { csvProfiles: readonly CsvProfile[] },
): { rows: StatementRow[]; checks: StatementCheck[] } | null {
  const [table] = csvTable(file.text ?? csvDecode(file.bytes));
  for (const p of ctx.csvProfiles) {
    const h = table.slice(0, 60).findIndex((r) => csvSig(r) === p.headerSignature);
    if (h >= 0) return { rows: csvRows(table.slice(h + 1), p, file.name, h + 2), checks: [] };
  }
  return null;
}

export interface CsvPreview {
  delimiter: string;
  rows: string[][];
  header: number;
  lines: number;
  parsed?: StatementRow[];
}
/**
 * POST /api/csv-preview {text, profile?}: the first rows, a guess at the header row (the first with the most filled cells),
 * and, given a draft profile, how the first rows would be read. Throws where books.py answers 400 ("can't read that as CSV").
 */
export function csvPreview(text: string, profile?: CsvProfile | null): CsvPreview {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  const [table, delimiter] = csvTable(text);
  const rows = table.slice(0, 40); // untruncated: the UI builds the header signature from these cells
  const filled = rows.map((r) => r.filter(Boolean).length);
  const out: CsvPreview = { delimiter, rows, header: filled.length ? filled.indexOf(Math.max(...filled)) : 0, lines: table.length };
  if (profile && Object.keys(profile).length) {
    const h = "headerRow" in profile ? col(profile.headerRow) : out.header;
    if (h === null) throw new TypeError("headerRow must be an int");
    out.parsed = csvRows(table.slice(h + 1), profile, "", h + 2).slice(0, 12); // slice() wraps negatives like Python's
  }
  return out;
}
